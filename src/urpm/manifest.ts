// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Manifest (urpm.json)
//
// Defines the schema for a project's manifest file (urpm.json) and the
// corresponding lock file (urpm.lock).
//
// No dependency on src/compiler, src/runtime, src/cli, src/lsp.
// ─────────────────────────────────────────────────────────────────────────────

// ── Semver ────────────────────────────────────────────────────────────────────

/**
 * A parsed semantic version: major.minor.patch[-prerelease][+build].
 * Only numeric major/minor/patch are supported in Phase 2.
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string | undefined;
  build?: string | undefined;
}

/**
 * A version constraint (dependency range).
 * Supported operators: ^, ~, =, >=, <=, >, <, *.
 */
export interface VersionConstraint {
  /** Raw string as written in urpm.json, e.g. "^1.2.0" */
  raw: string;
  operator: "^" | "~" | "=" | ">=" | "<=" | ">" | "<" | "*";
  version: SemVer;
}

/** Parse a version string like "1.2.3" or "0.4.1-alpha" into a SemVer. */
export function parseSemVer(s: string): SemVer | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9._-]+))?(?:\+([a-zA-Z0-9._-]+))?$/.exec(s.trim());
  if (!m) return undefined;
  return {
    major: parseInt(m[1]!, 10),
    minor: parseInt(m[2]!, 10),
    patch: parseInt(m[3]!, 10),
    prerelease: m[4],
    build: m[5],
  };
}

/** Serialize a SemVer back to its canonical string. */
export function semVerToString(v: SemVer): string {
  let s = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease) s += `-${v.prerelease}`;
  if (v.build) s += `+${v.build}`;
  return s;
}

/** Parse a version constraint like "^1.2.0" or ">=2.0.0". */
export function parseVersionConstraint(raw: string): VersionConstraint | undefined {
  const trimmed = raw.trim();

  const OPS = [">=", "<=", "^", "~", ">", "<", "=", "*"] as const;
  type Op = typeof OPS[number];

  for (const op of OPS) {
    if (op === "*") {
      if (trimmed === "*") {
        return { raw, operator: "*", version: { major: 0, minor: 0, patch: 0 } };
      }
      continue;
    }
    if (trimmed.startsWith(op)) {
      const vStr = trimmed.slice(op.length).trim();
      const version = parseSemVer(vStr);
      if (!version) return undefined;
      return { raw, operator: op as Op, version };
    }
  }

  // Plain version string → treat as "="
  const version = parseSemVer(trimmed);
  if (!version) return undefined;
  return { raw, operator: "=", version };
}

/**
 * Returns true if `v` satisfies `constraint`.
 * Implements standard semver range semantics:
 *   ^1.2.3  → >=1.2.3 <2.0.0  (compatible with major)
 *   ~1.2.3  → >=1.2.3 <1.3.0  (compatible with minor)
 *   *       → any version
 */
export function satisfies(v: SemVer, constraint: VersionConstraint): boolean {
  const c = constraint.version;
  const cmp = compareSemVer(v, c);

  switch (constraint.operator) {
    case "*":  return true;
    case "=":  return cmp === 0;
    case ">":  return cmp > 0;
    case "<":  return cmp < 0;
    case ">=": return cmp >= 0;
    case "<=": return cmp <= 0;
    case "~": {
      // >=c.major.c.minor.c.patch <c.major.(c.minor+1).0
      if (cmp < 0) return false;
      return v.major === c.major && v.minor === c.minor;
    }
    case "^": {
      // >=c <(c.major+1).0.0  (for c.major > 0)
      // >=0.c.minor.c.patch <0.(c.minor+1).0  (for c.major === 0 && c.minor > 0)
      // >=0.0.c.patch <0.0.(c.patch+1)         (for c.major === 0 && c.minor === 0)
      if (cmp < 0) return false;
      if (c.major > 0) return v.major === c.major;
      if (c.minor > 0) return v.major === 0 && v.minor === c.minor;
      return v.major === 0 && v.minor === 0 && v.patch === c.patch;
    }
  }
}

/** Compare two SemVers: returns -1, 0, or 1. Ignores prerelease/build for ordering. */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

// ── Manifest (urpm.json) ──────────────────────────────────────────────────────

export interface PackageDependency {
  /** Name of the dependency as declared in urpm.json */
  name: string;
  /** Raw version constraint string, e.g. "^1.0.0" */
  constraint: string;
  /** Slice 8B: explicit registry pin (per direct instruction, Registry Selection Contract - explicit beats inheritance, absence means inherit from the parent). Undefined means "inherit". */
  registry?: string;
  /** Parsed constraint (populated by ManifestLoader) */
  parsed?: VersionConstraint | undefined;
}

export interface Manifest {
  /** Package name, e.g. "my-project" */
  name: string;
  /** Package version, e.g. "1.0.0" */
  version: string;
  /** Parsed version */
  parsedVersion?: SemVer | undefined;
  /** Human-readable description */
  description?: string | undefined;
  /** Author string */
  author?: string | undefined;
  /** SPDX license identifier */
  license?: string | undefined;
  /** Main entry point (relative path) */
  main?: string | undefined;
  /** Runtime dependencies */
  dependencies: PackageDependency[];
  /** Dev-only dependencies (tests, build tools) */
  devDependencies: PackageDependency[];
  /**
   * Gate V1-PKG-MANIFEST-PRESERVATION: every top-level manifest.json
   * key URPM does not itself recognize (e.g. the FFI resolver's own
   * "runtime"/"module"/"exports"/"nativeLibrary" — see
   * src/cli/index.ts's own separate, manifest-aware FFI resolution
   * logic) is preserved here, VERBATIM, as its own real, parsed JSON
   * value — never interpreted, never validated, never entering
   * dependency-resolution semantics (confirmed by design: resolver.ts/
   * dependency-graph.ts only ever read `.dependencies`/
   * `.devDependencies`, never this field). This is JSON VALUE
   * preservation, not text preservation: nested objects/arrays are
   * preserved as real, structured values, not opaque strings.
   */
  extra?: Record<string, unknown> | undefined;
}

/** Creates an empty Manifest with sensible defaults. */
export function makeManifest(name: string, version = "0.1.0"): Manifest {
  return {
    name,
    version,
    parsedVersion: parseSemVer(version),
    dependencies: [],
    devDependencies: [],
  };
}

// ── Lock file (urpm.lock) ─────────────────────────────────────────────────────

export interface LockedPackage {
  /** Package name */
  name: string;
  /** Exact resolved version */
  version: string;
  /** Resolved SemVer */
  parsedVersion?: SemVer | undefined;
  /** Content hash (sha256 of package archive, hex-encoded) */
  integrity: string;
  /** Resolved URL or local path */
  resolved: string;
  /** Transitive dependency names and resolved versions */
  dependencies: Record<string, string>;
}

export interface LockFile {
  /** Lock file format version */
  lockfileVersion: number;
  /** Map from package name to locked entry */
  packages: Map<string, LockedPackage>;
}

/** Creates an empty lock file. */
export function makeLockFile(): LockFile {
  return { lockfileVersion: 1, packages: new Map() };
}

// ── JSON serialization ────────────────────────────────────────────────────────

/** Serialize a Manifest to plain JSON-compatible object. */
export function manifestToJson(m: Manifest): Record<string, unknown> {
  const deps: Record<string, string> = {};
  for (const d of m.dependencies) deps[d.name] = d.constraint;
  const devDeps: Record<string, string> = {};
  for (const d of m.devDependencies) devDeps[d.name] = d.constraint;

  return {
    name: m.name,
    version: m.version,
    ...(m.description ? { description: m.description } : {}),
    ...(m.author ? { author: m.author } : {}),
    ...(m.license ? { license: m.license } : {}),
    ...(m.main ? { main: m.main } : {}),
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    ...(Object.keys(devDeps).length ? { devDependencies: devDeps } : {}),
    // Gate V1-PKG-MANIFEST-PRESERVATION: re-emit every preserved
    // unknown field verbatim, spread at the top level — NOT nested
    // under an "extra" wrapper in the actual written file, so the
    // installed manifest.json's own shape matches the original
    // exactly, field-for-field.
    ...(m.extra ? m.extra : {}),
  };
}

/** Parse a plain JSON object into a Manifest. Returns undefined on invalid input. */
export function manifestFromJson(obj: unknown): Manifest | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const o = obj as Record<string, unknown>;

  if (typeof o["name"] !== "string" || typeof o["version"] !== "string") return undefined;

  const parseDeps = (raw: unknown): PackageDependency[] => {
    if (typeof raw !== "object" || raw === null) return [];
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" || (typeof v === "object" && v !== null && typeof (v as Record<string, unknown>)["constraint"] === "string"))
      .map(([name, v]) => {
        const constraint = typeof v === "string" ? v : (v as Record<string, unknown>)["constraint"] as string;
        const registry = typeof v === "object" && v !== null && typeof (v as Record<string, unknown>)["registry"] === "string" ? (v as Record<string, unknown>)["registry"] as string : undefined;
        return { name, constraint, registry, parsed: parseVersionConstraint(constraint) };
      });
  };

  return {
    name: o["name"] as string,
    version: o["version"] as string,
    parsedVersion: parseSemVer(o["version"] as string),
    description: typeof o["description"] === "string" ? o["description"] : undefined,
    author: typeof o["author"] === "string" ? o["author"] : undefined,
    license: typeof o["license"] === "string" ? o["license"] : undefined,
    main: typeof o["main"] === "string" ? o["main"] : undefined,
    dependencies: parseDeps(o["dependencies"]),
    devDependencies: parseDeps(o["devDependencies"]),
    // Gate V1-PKG-MANIFEST-PRESERVATION: capture every top-level key
    // NOT already recognized above, verbatim, as its own real JSON
    // value (object/array/string/number/boolean/null — whatever it
    // actually is) — never interpreted here. Known keys are excluded
    // explicitly so they are never duplicated between the named
    // fields above and this bucket.
    extra: (() => {
      const KNOWN_KEYS = new Set(["name", "version", "description", "author", "license", "main", "dependencies", "devDependencies"]);
      const extra: Record<string, unknown> = {};
      let hasAny = false;
      for (const [key, value] of Object.entries(o)) {
        if (KNOWN_KEYS.has(key)) continue;
        extra[key] = value;
        hasAny = true;
      }
      return hasAny ? extra : undefined;
    })(),
  };
}

/** Serialize a LockFile to a plain JSON-compatible object. */
export function lockFileToJson(lf: LockFile): Record<string, unknown> {
  const pkgs: Record<string, unknown> = {};
  for (const [name, locked] of lf.packages) {
    pkgs[name] = {
      version: locked.version,
      integrity: locked.integrity,
      resolved: locked.resolved,
      dependencies: locked.dependencies,
    };
  }
  return { lockfileVersion: lf.lockfileVersion, packages: pkgs };
}

/** Parse a plain JSON object into a LockFile. */
export function lockFileFromJson(obj: unknown): LockFile | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o["lockfileVersion"] !== "number") return undefined;

  const lf = makeLockFile();
  lf.lockfileVersion = o["lockfileVersion"] as number;

  const pkgs = o["packages"];
  if (typeof pkgs !== "object" || pkgs === null) return lf;

  for (const [name, rawPkg] of Object.entries(pkgs as Record<string, unknown>)) {
    if (typeof rawPkg !== "object" || rawPkg === null) continue;
    const p = rawPkg as Record<string, unknown>;
    lf.packages.set(name, {
      name,
      version: typeof p["version"] === "string" ? p["version"] : "0.0.0",
      parsedVersion: parseSemVer(typeof p["version"] === "string" ? p["version"] : "0.0.0"),
      integrity: typeof p["integrity"] === "string" ? p["integrity"] : "",
      resolved: typeof p["resolved"] === "string" ? p["resolved"] : "",
      dependencies: (typeof p["dependencies"] === "object" && p["dependencies"] !== null)
        ? p["dependencies"] as Record<string, string>
        : {},
    });
  }
  return lf;
}
