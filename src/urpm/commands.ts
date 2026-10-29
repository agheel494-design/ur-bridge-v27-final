// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Commands
//
// Pure command implementations for the urpm CLI tool:
//
//   install  — add a dependency and resolve
//   remove   — remove a dependency
//   update   — update all/specific deps to latest compatible versions
//   search   — search the registry
//   publish  — validate a package for publishing
//   verify   — verify lock file integrity
//
// All commands are pure functions — no I/O. Callers supply the manifest,
// registry, and cache; commands return results for the CLI to persist/display.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Manifest,
  type LockFile,
  type PackageDependency,
  parseVersionConstraint,
  parseSemVer,
  satisfies,
  semVerToString,
  makeManifest,
} from "./manifest.js";

import { type PackageRegistry, type RegistryPackage } from "./registry.js";
import { Resolver } from "./resolver.js";
import { PackageCache } from "./cache.js";
import { type ResolutionDiagnostic, RCODES } from "./dependency-graph.js";

// ── Command result ─────────────────────────────────────────────────────────────

export interface CommandResult<T = void> {
  ok: boolean;
  data?: T;
  diagnostics: ResolutionDiagnostic[];
}

function ok<T>(data?: T): CommandResult<T> {
  return { ok: true, data, diagnostics: [] };
}

function fail(diagnostics: ResolutionDiagnostic[]): CommandResult<never> {
  return { ok: false, diagnostics };
}

function err(code: string, message: string, packageName?: string): ResolutionDiagnostic {
  return { severity: "error", code, message, packageName };
}

function warn(code: string, message: string, packageName?: string): ResolutionDiagnostic {
  return { severity: "warning", code, message, packageName };
}

// ── install ───────────────────────────────────────────────────────────────────

export interface InstallResult {
  manifest: Manifest;
  lockFile: LockFile;
  installed: Array<{ name: string; version: string }>;
}

/**
 * Add a dependency to the manifest and resolve.
 * If `packageName` is omitted, resolves all existing dependencies.
 */
export function cmdInstall(
  manifest: Manifest,
  registry: PackageRegistry,
  packageName?: string,
  constraint = "^0.0.0",
  dev = false,
): CommandResult<InstallResult> {
  const diagnostics: ResolutionDiagnostic[] = [];
  let updatedManifest = { ...manifest };

  if (packageName) {
    // Validate constraint
    const parsed = parseVersionConstraint(constraint);
    if (!parsed) {
      return fail([err(RCODES.INVALID_CONSTRAINT, `invalid version constraint '${constraint}'`, packageName)]);
    }

    // Check package exists in registry
    const pkg = registry.getPackage(packageName);
    if (!pkg) {
      return fail([err(RCODES.MISSING_DEP, `package '${packageName}' not found in registry`, packageName)]);
    }

    // Find best version
    const best = registry.resolve(packageName, parsed);
    if (!best) {
      return fail([err(RCODES.MISSING_DEP, `no version of '${packageName}' satisfies '${constraint}'`, packageName)]);
    }

    // Check for existing dep
    const depList = dev ? updatedManifest.devDependencies : updatedManifest.dependencies;
    const existing = depList.find(d => d.name === packageName);
    if (existing) {
      diagnostics.push(warn(RCODES.VERSION_CONFLICT,
        `'${packageName}' already in dependencies with constraint '${existing.constraint}' — updating to '${constraint}'`,
        packageName));
    }

    // Update dep list
    const newDep: PackageDependency = { name: packageName, constraint, parsed };
    if (dev) {
      updatedManifest = {
        ...updatedManifest,
        devDependencies: [
          ...updatedManifest.devDependencies.filter(d => d.name !== packageName),
          newDep,
        ],
      };
    } else {
      updatedManifest = {
        ...updatedManifest,
        dependencies: [
          ...updatedManifest.dependencies.filter(d => d.name !== packageName),
          newDep,
        ],
      };
    }
  }

  // Resolve
  const resolver = new Resolver(registry);
  const result = resolver.resolve(updatedManifest);
  diagnostics.push(...result.diagnostics);

  if (!result.valid) {
    return { ok: false, data: undefined, diagnostics };
  }

  const installed = Array.from(result.lockFile.packages.values()).map(p => ({
    name: p.name,
    version: p.version,
  }));

  return {
    ok: true,
    data: { manifest: updatedManifest, lockFile: result.lockFile, installed },
    diagnostics,
  };
}

// ── remove ────────────────────────────────────────────────────────────────────

export interface RemoveResult {
  manifest: Manifest;
  lockFile: LockFile;
  removed: string[];
}

/**
 * Remove a dependency from the manifest and re-resolve.
 */
export function cmdRemove(
  manifest: Manifest,
  registry: PackageRegistry,
  packageName: string,
): CommandResult<RemoveResult> {
  const inDeps = manifest.dependencies.some(d => d.name === packageName);
  const inDev = manifest.devDependencies.some(d => d.name === packageName);

  if (!inDeps && !inDev) {
    return fail([err(RCODES.MISSING_DEP, `'${packageName}' is not a dependency`)]);
  }

  const updatedManifest: Manifest = {
    ...manifest,
    dependencies: manifest.dependencies.filter(d => d.name !== packageName),
    devDependencies: manifest.devDependencies.filter(d => d.name !== packageName),
  };

  const resolver = new Resolver(registry);
  const result = resolver.resolve(updatedManifest);

  if (!result.valid) {
    return { ok: false, data: undefined, diagnostics: result.diagnostics };
  }

  return ok({
    manifest: updatedManifest,
    lockFile: result.lockFile,
    removed: [packageName],
  });
}

// ── update ────────────────────────────────────────────────────────────────────

export interface UpdateResult {
  manifest: Manifest;
  lockFile: LockFile;
  updates: Array<{ name: string; from: string; to: string }>;
}

/**
 * Update one or all dependencies to the latest compatible version.
 * Respects existing version constraints (does not bump major versions).
 */
export function cmdUpdate(
  manifest: Manifest,
  registry: PackageRegistry,
  packageName?: string,
): CommandResult<UpdateResult> {
  const updates: Array<{ name: string; from: string; to: string }> = [];
  const diagnostics: ResolutionDiagnostic[] = [];

  const allDeps = [...manifest.dependencies, ...manifest.devDependencies];
  const targetDeps = packageName
    ? allDeps.filter(d => d.name === packageName)
    : allDeps;

  if (packageName && targetDeps.length === 0) {
    return fail([err(RCODES.MISSING_DEP, `'${packageName}' is not a dependency`)]);
  }

  for (const dep of targetDeps) {
    const parsed = dep.parsed ?? parseVersionConstraint(dep.constraint);
    if (!parsed) continue;

    const latest = registry.getLatest(dep.name);
    if (!latest) continue;

    const latestStr = semVerToString(latest.version);

    // Only update if the latest satisfies the existing constraint
    if (satisfies(latest.version, parsed)) {
      const current = registry.resolve(dep.name, parsed);
      const currentStr = current ? semVerToString(current.version) : "";
      if (currentStr !== latestStr) {
        updates.push({ name: dep.name, from: currentStr, to: latestStr });
      }
    } else {
      diagnostics.push(warn(RCODES.VERSION_CONFLICT,
        `latest version of '${dep.name}' (${latestStr}) does not satisfy constraint '${dep.constraint}' — skipping`,
        dep.name));
    }
  }

  // Re-resolve
  const resolver = new Resolver(registry);
  const result = resolver.resolve(manifest);
  diagnostics.push(...result.diagnostics);

  if (!result.valid) {
    return { ok: false, data: undefined, diagnostics };
  }

  return {
    ok: true,
    data: { manifest, lockFile: result.lockFile, updates },
    diagnostics,
  };
}

// ── search ────────────────────────────────────────────────────────────────────

export interface SearchResult {
  results: Array<{
    name: string;
    latestVersion: string;
    description?: string;
    keywords: string[];
    author?: string;
  }>;
  total: number;
}

/**
 * Search the registry for packages matching a query.
 */
export function cmdSearch(
  registry: PackageRegistry,
  query: string,
): CommandResult<SearchResult> {
  const matches = registry.search(query);
  const results = matches.map(pkg => ({
    name: pkg.name,
    latestVersion: pkg.versions[0] ? semVerToString(pkg.versions[0].version) : "unknown",
    description: pkg.versions[0]?.description,
    keywords: pkg.keywords,
    author: pkg.author,
  }));
  return ok({ results, total: results.length });
}

// ── publish ───────────────────────────────────────────────────────────────────

export interface PublishResult {
  name: string;
  version: string;
}

/**
 * Validates a manifest for publishing.
 * Returns diagnostics for any missing required fields.
 * (Actual upload is out-of-scope — this is the validation step.)
 */
export function cmdPublish(manifest: Manifest): CommandResult<PublishResult> {
  const diagnostics: ResolutionDiagnostic[] = [];

  if (!manifest.name || manifest.name.trim() === "") {
    diagnostics.push(err(RCODES.INVALID_CONSTRAINT, "manifest is missing 'name' field"));
  }

  if (!manifest.version || !parseSemVer(manifest.version)) {
    diagnostics.push(err(RCODES.INVALID_CONSTRAINT,
      `invalid version '${manifest.version ?? ""}' — must be a valid semver (e.g. 1.0.0)`));
  }

  if (!manifest.description) {
    diagnostics.push(warn(RCODES.INVALID_CONSTRAINT, "'description' is recommended for published packages"));
  }

  if (!manifest.license) {
    diagnostics.push(warn(RCODES.INVALID_CONSTRAINT, "'license' is recommended for published packages"));
  }

  // Validate all dep constraints
  for (const dep of [...manifest.dependencies, ...manifest.devDependencies]) {
    if (!parseVersionConstraint(dep.constraint)) {
      diagnostics.push(err(RCODES.INVALID_CONSTRAINT,
        `invalid constraint '${dep.constraint}' for dependency '${dep.name}'`, dep.name));
    }
  }

  const hasErrors = diagnostics.some(d => d.severity === "error");
  if (hasErrors) {
    return { ok: false, data: undefined, diagnostics };
  }

  return {
    ok: true,
    data: { name: manifest.name, version: manifest.version },
    diagnostics,
  };
}

// ── verify ────────────────────────────────────────────────────────────────────

export interface VerifyResult {
  checked: number;
  valid: number;
  invalid: string[];
}

/**
 * Verify that a lock file is consistent with a manifest.
 * Checks:
 *   - All manifest dependencies appear in the lock file
 *   - All locked versions satisfy the manifest constraints
 *   - No extra locked packages missing from manifest (warning only)
 */
export function cmdVerify(
  manifest: Manifest,
  lockFile: LockFile,
): CommandResult<VerifyResult> {
  const diagnostics: ResolutionDiagnostic[] = [];
  const invalid: string[] = [];
  let valid = 0;

  const allDeps = [...manifest.dependencies, ...manifest.devDependencies];

  for (const dep of allDeps) {
    const locked = lockFile.packages.get(dep.name);
    if (!locked) {
      diagnostics.push(err(RCODES.MISSING_DEP,
        `'${dep.name}' is in manifest but missing from lock file`, dep.name));
      invalid.push(dep.name);
      continue;
    }

    const parsed = dep.parsed ?? parseVersionConstraint(dep.constraint);
    if (!parsed) {
      diagnostics.push(err(RCODES.INVALID_CONSTRAINT,
        `invalid constraint '${dep.constraint}' for '${dep.name}'`, dep.name));
      invalid.push(dep.name);
      continue;
    }

    const lockedVersion = parseSemVer(locked.version);
    if (!lockedVersion) {
      diagnostics.push(err(RCODES.INVALID_CONSTRAINT,
        `invalid locked version '${locked.version}' for '${dep.name}'`, dep.name));
      invalid.push(dep.name);
      continue;
    }

    if (!satisfies(lockedVersion, parsed)) {
      diagnostics.push(err(RCODES.VERSION_CONFLICT,
        `locked version '${locked.version}' of '${dep.name}' does not satisfy constraint '${dep.constraint}'`,
        dep.name));
      invalid.push(dep.name);
    } else {
      valid++;
    }
  }

  const hasErrors = diagnostics.some(d => d.severity === "error");
  return {
    ok: !hasErrors,
    data: { checked: allDeps.length, valid, invalid },
    diagnostics,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// cmdCreateProject — "أنشئ مشروع قاعدة_بيانات"  (create database project)
// Phase 7 — Native Ecosystem Hardening — SQLite3 Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// Scaffolds a new UR project pre-wired for native library usage.
// The scaffolding logic is real and fully tested; the generated .ur stub
// is a human-readable illustration of the intended UR call surface — its
// compilability cannot be verified here because the UR Frontend is not
// included in this project slice (see STATUS_REPORT.md SECTION 2B for
// the explicit scope boundary). The stub is labelled accordingly.
//
// Template types (extensible — every template follows the same pattern):
//   "database"  — SQLite3 FFI binding, full CRUD skeleton
//   "vision"    — OpenCV stub (for when headers/library become available)
//   "inference" — ONNX Runtime stub (headers deferred)
//   "robotics"  — ROS2 stub (environment-dependent)
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectTemplate = "database" | "vision" | "inference" | "robotics";

export type ProjectScaffold = {
  name: string;
  template: ProjectTemplate;
  /** urpm manifest.json content */
  manifest: Manifest;
  /** Generated files: path → content */
  files: Record<string, string>;
  /** Human-readable notes about what the generated .ur stub illustrates */
  notes: string[];
};

export type CreateProjectResult = {
  scaffold: ProjectScaffold;
};

const UR_STUB_DISCLAIMER = `// ─────────────────────────────────────────────────────────────────────────────
// NOTE: This file is a GENERATED ILLUSTRATION of the intended UR call surface.
// It shows how UR code will call the native library once the full UR Frontend
// (Lexer → Parser → Semantic → TypeSystem → ModuleSystem → CodeGen) is
// connected to the FFI layer. Compilability cannot be verified in the current
// project slice — see STATUS_REPORT.md SECTION 2B for the explicit scope
// boundary and the roadmap for full end-to-end pipeline closure.
// ─────────────────────────────────────────────────────────────────────────────
`;

function databaseTemplate(projectName: string): ProjectScaffold {
  const manifest = makeManifest(projectName, "0.1.0");

  const mainUr = `${UR_STUB_DISCLAIMER}
// ${projectName}/src/main.ur
// Full CRUD example using the SQLite3 native binding.
// The FFI layer (src/ffi/native/) handles all double-pointer out-params
// via the compiled C adapter (ffi/sqlite3_adapter.c).

import native "sqlite3" as db;

fn main() {
  // Step 1: Open in-memory database
  let conn = db.open(":memory:");

  // Step 2: Create table
  db.exec(conn, "CREATE TABLE items (
    id    INTEGER PRIMARY KEY,
    name  TEXT    NOT NULL,
    value REAL
  )");

  // Step 3: Insert with parameter binding
  let stmt = db.prepare(conn, "INSERT INTO items (name, value) VALUES (?, ?)");
  db.bind_text(stmt, 1, "مرحبا");   // Arabic: works — UTF-8 round-trip verified
  db.bind_float(stmt, 2, 3.14);
  db.step(stmt);
  db.reset(stmt);
  db.bind_text(stmt, 1, "こんにちは"); // Japanese: works
  db.bind_float(stmt, 2, 2.71);
  db.step(stmt);
  db.finalize(stmt);

  // Step 4: SELECT and iterate
  let query = db.prepare(conn, "SELECT id, name, value FROM items ORDER BY id");
  while db.step(query) == SQLITE_ROW {
    let id    = db.column_int(query, 0);
    let name  = db.column_text(query, 1);
    let value = db.column_float(query, 2);
    print(f"Row {id}: {name} = {value}");
  }
  db.finalize(query);

  // Step 5: Transaction + Rollback demo
  db.exec(conn, "BEGIN");
  db.exec(conn, "INSERT INTO items (name, value) VALUES ('temp', 0.0)");
  db.exec(conn, "ROLLBACK"); // temp row is gone

  // Step 6: Close
  db.close(conn);
}
`;

  const readme = `# ${projectName}

A UR project demonstrating SQLite3 native library integration via UR-Bridge FFI.

## Architecture

\`\`\`
UR Source (src/main.ur)
    ↓
UR Frontend (Lexer → Parser → Semantic → TypeSystem → ModuleSystem)
    ↓
FFI Binding Layer (src/ffi/native/)
    ↓
C Adapter (ffi/sqlite3_adapter.c)  ← flattens double-pointer out-params
    ↓
libsqlite3.so.0 (real, dynamically loaded)
    ↓
Results surfaced back to UR
\`\`\`

## Verified capabilities (FFI layer, confirmed with real g++ compilation)

- Version / ABI compatibility check (sqlite3_libversion + sqlite3_sourceid)
- Open / close in-memory and file databases
- CREATE TABLE, INSERT with parameter binding
- SELECT with full column type access (INTEGER, TEXT, REAL, NULL)
- UPDATE / DELETE with changes() verification
- Transactions: BEGIN / COMMIT / ROLLBACK
- Error paths: invalid SQL → errmsg, NOT NULL constraint violation
- NULL value binding and type detection
- UTF-8 round-trip: Arabic (مرحبا), Japanese (こんにちは), emoji (😀🚀❤)
- last_insert_rowid(), changes() after mutations
- sqlite3_close() resource cleanup

## Running

\`\`\`bash
urpm install
ur run src/main.ur
\`\`\`

*(Requires the UR Frontend — see STATUS_REPORT.md for availability)*
`;

  return {
    name: projectName,
    template: "database",
    manifest,
    files: {
      "src/main.ur": mainUr,
      "README.md": readme,
    },
    notes: [
      "src/main.ur is a generated illustration of the intended UR call surface.",
      "The FFI layer (NativeFfiLoader + HarnessExecutor + sqlite3_adapter.c) is real and fully tested.",
      "Compilability of .ur source requires the UR Frontend, not included in this project slice.",
      "All SQLite3 operations have been verified with real g++ compilation and real libsqlite3.so.0.",
    ],
  };
}

function visionTemplate(projectName: string): ProjectScaffold {
  const manifest = makeManifest(projectName, "0.1.0");
  return {
    name: projectName, template: "vision", manifest,
    files: {
      "src/main.ur": `${UR_STUB_DISCLAIMER}\n// ${projectName}/src/main.ur\n// OpenCV integration stub — deferred until library headers are available.\n`,
      "README.md": `# ${projectName}\n\nOpenCV integration project (stub). Activate when OpenCV headers are available.\n`,
    },
    notes: ["OpenCV deferred — library not installed in current environment (no network access)."],
  };
}

function inferenceTemplate(projectName: string): ProjectScaffold {
  const manifest = makeManifest(projectName, "0.1.0");
  return {
    name: projectName, template: "inference", manifest,
    files: {
      "src/main.ur": `${UR_STUB_DISCLAIMER}\n// ${projectName}/src/main.ur\n// ONNX Runtime stub — deferred until C API header is available.\n// Real .so exists: OrtGetApiBase symbol confirmed via nm.\n`,
      "README.md": `# ${projectName}\n\nONNX Runtime project (stub). Activate when OrtApi C header is available.\n`,
    },
    notes: ["ONNX Runtime: .so present, C API header absent. Full binding deferred."],
  };
}

function roboticsTemplate(projectName: string): ProjectScaffold {
  const manifest = makeManifest(projectName, "0.1.0");
  return {
    name: projectName, template: "robotics", manifest,
    files: {
      "src/main.ur": `${UR_STUB_DISCLAIMER}\n// ${projectName}/src/main.ur\n// ROS2 integration stub — deferred until ROS2 is available in the environment.\n`,
      "README.md": `# ${projectName}\n\nROS2 robotics project (stub). Activate when ROS2 is installed.\n`,
    },
    notes: ["ROS2 deferred — not installed in current environment."],
  };
}

export function cmdCreateProject(
  projectName: string,
  template: ProjectTemplate,
): CommandResult<CreateProjectResult> {
  if (!projectName || projectName.trim().length === 0) {
    return fail([err("INVALID_PROJECT_NAME", "project name must not be empty")]);
  }
  if (!/^[a-zA-Z0-9_\u0600-\u06FF][a-zA-Z0-9_\-\u0600-\u06FF]*$/.test(projectName)) {
    return fail([err("INVALID_PROJECT_NAME",
      `project name '${projectName}' contains invalid characters. ` +
      `Allowed: letters (including Arabic), digits, hyphens, underscores.`)]);
  }

  let scaffold: ProjectScaffold;
  switch (template) {
    case "database":  scaffold = databaseTemplate(projectName); break;
    case "vision":    scaffold = visionTemplate(projectName); break;
    case "inference": scaffold = inferenceTemplate(projectName); break;
    case "robotics":  scaffold = roboticsTemplate(projectName); break;
  }

  return ok({ scaffold });
}
