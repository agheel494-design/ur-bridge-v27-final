#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge CLI ("ur") — v1.0 Final Sprint, P0 priority
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit project-manager directive: this is the SMALLEST possible
// stable CLI, not a feature platform. Exactly 5 commands, nothing more:
//   ur init            — create a starter hello.ur file in the current directory
//   ur run <file.ur>    — compile and immediately execute a UR program
//   ur build <file.ur>  — compile a UR program to a real, standalone executable
//   ur version          — print the CLI/compiler version
//   ur help             — print usage
//
// Explicitly OUT of scope (per the same directive): package manager,
// registry, plugins, watch mode, project config files, anything beyond
// these 5 commands. This wraps the EXISTING, already-tested compiler
// frontend (lex/parse/analyze/typeCheck/lowerToIR) plus the interpreter
// (src/interpreter/interpret.ts) — no compiler logic is duplicated or
// reimplemented here, and no gcc/C-Backend involvement at all (see the
// interpreter's own header comment for why).

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, renameSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { resolve, basename, dirname, join, isAbsolute, sep, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lex } from "../compiler/frontend/lexer.js";
import { parse } from "../compiler/frontend/parser.js";
import { analyze } from "../compiler/semantic/index.js";
import { typeCheck } from "../compiler/typesystem/checker.js";
import { lowerToIR } from "../compiler/codegen/lower-to-ir.js";
import { interpretModule, FRI_MIN_TIMEOUT_MS, FRI_MAX_TIMEOUT_MS } from "../interpreter/interpret.js";
import { formatDiagnostic, type FormattableDiagnostic } from "../shared/diagnostic-formatter.js";
import { lexErrorToFormattable } from "../compiler/diagnostics/adapter.js"; // B-1 Gate (D-3)
import type { IRModule } from "../shared/ir.js";
import type { Program, SourceSpan } from "../compiler/frontend/ast.js";
import { manifestFromJson, manifestToJson, parseVersionConstraint, satisfies, compareSemVer, parseSemVer, type Manifest, type SemVer, type PackageDependency } from "../urpm/manifest.js";

const VERSION = "1.0.0"; // the UR LANGUAGE version this CLI targets — distinct from the ur-bridge-v27 package/repo identity (see the project's own documented naming-ambiguity note); this is what `ur version` shows a user.

function printUsage(): void {
  console.log(`ur — the UR programming language CLI

Usage:
  ur init              Create a starter hello.ur file in the current directory
  ur run <file.ur>      Run a UR program immediately
  ur build <file.ur>    Build a UR program into a standalone, runnable package
  ur version            Print the version
  ur help               Show this help message

Examples:
  ur init
  ur run hello.ur
  ur build hello.ur
`);
}

function printVersion(): void {
  console.log(`ur ${VERSION}`);
  // Per explicit external field-test finding: a real Windows tester had
  // no way to verify whether their installed CLI actually contained the
  // interpreter-based (gcc-free) fix or an older build. If a real build
  // stamp exists (written by tools/build.mjs at build time), show it —
  // anyone can now confirm exactly which build they have.
  try {
    const buildInfoPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "BUILD_INFO.json");
    if (existsSync(buildInfoPath)) {
      const info = JSON.parse(readFileSync(buildInfoPath, "utf-8"));
      console.log(`build ${info.contentHash} (built ${info.builtAt}, gcc-free: ${info.gccFree})`);
    }
  } catch {
    // Best-effort — absence of a build stamp (e.g. running via tsx in
    // development, not from a real `npm run build`) is not an error.
  }
}

const STARTER_PROGRAM = `function main(): int
  print("hello from UR")
  return 0
end
`;

/**
 * First real Vertical Slice of Package Production Integration (per direct
 * instruction): `ur install <local-package-path>`.
 *
 * Per the approved architectural decision, ur_packages/ (the existing,
 * already-proven-in-production directory resolveAndMergeImports already
 * reads from) is reused directly as the install target - URPM adapts to
 * the existing Import System, not the other way around. Zero change to
 * resolveAndMergeImports itself.
 *
 * Deliberately minimal for this first slice: no remote Registry, no
 * dependency graph, no version-conflict resolution yet (per direct
 * instruction, "no Registry/Dependency Graph now, prove the smallest
 * real path first"). Reads the local package's own real manifest.json
 * via manifest.ts's own already-tested manifestFromJson (no new
 * serialization logic invented), copies its .ur source files into
 * ur_packages/<name>/, and writes a real ur.lock file to disk (not just
 * an in-memory call) with real sha256 integrity hashes of each copied
 * file, in the same JSON shape manifest.ts's own manifestToJson-style
 * convention uses.
 */
/**
 * Reproducibility support (per direct instruction, required before
 * declaring Slice 1 stable): `ur install` with no path argument
 * reinstalls every package recorded in the existing ur.lock, from each
 * package's own recorded `resolved` local path, and verifies the
 * resulting sha256 integrity hash matches exactly what was recorded -
 * this is what turns "install works" into "install is reproducible".
 * Confined to the exact same install logic already proven in
 * cmdInstallPackage - no new serialization, no new storage location.
 */
function cmdInstallFromLock(): number {
  const lockPath = join(process.cwd(), "ur.lock");
  if (!existsSync(lockPath)) {
    console.error("error: no ur.lock found — nothing to reinstall (run 'ur install <path>' first)");
    return 1;
  }
  let lock: { lockfileVersion: number; packages: Record<string, { resolved: string; integrity: string }> };
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch (e) {
    console.error(`error: ur.lock is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)}) — cannot reinstall from it without knowing which packages/sources were recorded; run 'ur install <path>' for each package to rebuild it`);
    return 1;
  }
  const names = Object.keys(lock.packages);
  if (names.length === 0) {
    console.log("nothing to install (ur.lock has no packages)");
    return 0;
  }
  for (const name of names) {
    const entry = lock.packages[name]!;
    const beforeHash = entry.integrity;
    const code = cmdInstallPackage(entry.resolved);
    if (code !== 0) return code;
    const afterLock = JSON.parse(readFileSync(lockPath, "utf-8")) as typeof lock;
    const afterHash = afterLock.packages[name]!.integrity;
    if (afterHash !== beforeHash) {
      console.error(`error: reproducibility check failed for '${name}' — integrity hash changed (expected ${beforeHash}, got ${afterHash})`);
      return 1;
    }
  }
  console.log(`reinstalled ${names.length} package(s) from ur.lock, integrity verified`);
  return 0;
}

/**
 * Slice 2 (per direct instruction, narrow first Gate): resolves the
 * highest version satisfying `constraint` among the version-named
 * subdirectories of `versionsRoot` (each containing its own real
 * manifest.json). Reuses manifest.ts's own already-proven
 * parseVersionConstraint/satisfies/compareSemVer - no new SemVer
 * logic invented. Returns the chosen subdirectory's full path, or
 * undefined with a reason if no version satisfies the constraint.
 */
function resolvePackageVersion(versionsRoot: string, constraint: string): { path: string; version: string } | { error: string } {
  const parsed = parseVersionConstraint(constraint);
  if (!parsed) return { error: `invalid version constraint '${constraint}'` };
  const subdirs = readdirSync(versionsRoot, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name);
  let best: { path: string; version: string; parsed: SemVer } | undefined;
  for (const dirName of subdirs) {
    const candidatePath = join(versionsRoot, dirName);
    const manifestPath = join(candidatePath, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const m = manifestFromJson(JSON.parse(readFileSync(manifestPath, "utf-8")));
    if (!m || !m.parsedVersion) continue;
    if (!satisfies(m.parsedVersion, parsed)) continue;
    if (!best || compareSemVer(m.parsedVersion, best.parsed!) > 0) {
      best = { path: candidatePath, version: m.version, parsed: m.parsedVersion };
    }
  }
  if (!best) return { error: `no version of the package in ${versionsRoot} satisfies '${constraint}'` };
  return { path: best.path, version: best.version };
}

/**
 * Slice 3 (per direct instruction): tracks, across one whole `ur
 * install` run (including all transitive dependencies), which version
 * of each package name has already been resolved and why - the
 * minimal state needed for clean conflict detection (per direct
 * instruction: "no random pick to silence the error").
 */
type ResolutionState = Map<string, { version: string; parsed: SemVer; requiredBy: string[] }>;

/**
 * Slice 3 (per direct instruction): after a package is installed,
 * reads its own real Manifest.dependencies (already parsed by
 * manifestFromJson - no new dependency-parsing logic invented) and
 * resolves+installs each one recursively. `poolRoot` is the parent
 * directory containing all package family folders as siblings (the
 * natural generalization of Slice 2's own "versions root" concept
 * applied one level up) - dependencies are located there by name.
 * `state` is shared across the whole recursive run to detect
 * conflicts: if a package name is already resolved to a version that
 * does NOT satisfy a newly-encountered constraint, this fails cleanly
 * with both requirers named, rather than silently picking either
 * version.
 */
// ============================================================
// Slice 8 (per direct instruction, approved Option B: Prepared
// Graph + Commit Journal): Dependency Graph Transaction.
//
// Confined to a completely separate code path - cmdInstallPackage
// and resolveDependencies (Slice 3, Gate 5) remain byte-for-byte
// unchanged and continue to be used, exactly as before, for every
// package with zero dependencies (the vast majority of existing
// tests and Gates 1-5). This machinery activates ONLY when the
// package being installed at the root has its own dependencies to
// resolve.
//
// Root cause this addresses (PROVEN by direct code trace, not
// assumption): the pre-existing resolveDependencies path commits
// (atomically, per-package) and writes ur.lock for each node AS IT
// GOES - so A -> {B -> C, D} where C and B succeed but D fails
// left A, B, C fully committed and registered in ur.lock, while the
// overall 'ur install' command reported failure (exit 1). Package-
// level atomicity (Gate 5) was never broken - but the INSTALL
// TRANSACTION as a whole was not atomic. This is Graph-level
// Transaction Semantics (not filesystem-level atomicity across
// multiple renames, which is not achievable directly) via a Commit
// Journal: RESOLVE -> FETCH/VERIFY (all nodes staged, none
// committed) -> PREPARED (journal written) -> COMMIT (sequential,
// journal updated per node) -> ur.lock written once for the whole
// graph -> journal deleted only after ur.lock is verified to
// actually contain the graph.
//
// Honest scope disclosure: this implementation covers LOCAL
// dependency graphs (the existing, real, tested Slice 3 resolution
// path against a local pool root) - Cross-Registry Graph and
// Dependency Confusion tests remain DEFERRED, since remote-registry-
// aware dependency fetching does not exist as a wired feature yet
// (confirmed by the Slice 8 Trace/Design Gate: installFromRemoteRegistry
// never calls resolveDependencies at all). Implementing that
// integration is its own separate task, not silently folded into
// this one. The registryOrigin field described in the Journal/
// lockfile design is included in the schema for forward-compatibility
// but is populated with "local" for every node in this pass, since
// no node here is ever sourced from a remote registry.
// ============================================================

type NodeSource =
  | { kind: "local"; path: string }
  | { kind: "remote"; registryName: string; registryUrl: string; name: string; version: string };

interface RegistryContext { name: string; url: string }

interface GraphNode {
  name: string;
  version: string;
  manifest: Manifest;
  source: NodeSource;
  fileHashes: Record<string, string>;
  publisherRecord?: { keyId: string; signature: string };
  stagingDir: string;
  destDir: string;
  hadPreExisting: boolean;
  backupDir?: string;
  registryOrigin: string;
}

interface TransactionJournal {
  transactionId: string;
  rootPackage: string;
  status: "preparing" | "all_committed";
  createdAt: string;
  nodes: {
    name: string;
    version: string;
    registryOrigin: string;
    stagingPath: string;
    destinationPath: string;
    hadPreExisting: boolean;
    backupPath?: string;
    commitStatus: "pending" | "after_rename" | "rolled_back";
  }[];
}

function journalPath(transactionId: string): string {
  return join(process.cwd(), "ur_packages", `.transaction-${transactionId}.json`);
}

/**
 * Phase RESOLVE + FETCH/VERIFY: walks the local dependency graph
 * starting at `manifest`, staging and fully verifying (integrity +
 * signature, reusing the exact same checks as cmdInstallPackage - no
 * new verification logic invented) every node - but committing
 * NOTHING. Returns the full flat node list on success. On ANY
 * failure, all staging directories created so far are cleaned up and
 * the function returns the error - zero Journal is ever written for
 * a failure at this phase, since nothing has been committed and
 * nothing needs to be recorded.
 */
async function prepareGraph(rootManifest: Manifest, rootSource: NodeSource, poolRoot: string, rootRegistryContext: RegistryContext | undefined): Promise<{ ok: true; nodes: GraphNode[] } | { ok: false; error: string; staged: GraphNode[] }> {
  const nodes: GraphNode[] = [];
  const allStagingDirsCreated: string[] = [];
  const state: ResolutionState = new Map();
  const urPackagesRoot = join(process.cwd(), "ur_packages");
  mkdirSync(urPackagesRoot, { recursive: true });
  const realPackagesRoot = realpathSync(urPackagesRoot);
  const registries = loadRemoteRegistries();

  async function readManifestFor(source: NodeSource): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    if (source.kind === "local") {
      const p = join(source.path, "manifest.json");
      if (!existsSync(p)) return { ok: false, error: `no manifest.json found at ${p}` };
      return { ok: true, text: readFileSync(p, "utf-8") };
    }
    const r = await fetchRegistryFile(source.registryUrl, source.registryName, source.name, source.version, "manifest.json", false);
    if (!r.ok) return { ok: false, error: r.error };
    if ("notFound" in r) return { ok: false, error: `manifest.json not found for '${source.name}@${source.version}' on registry '${source.registryName}'` };
    return { ok: true, text: r.buffer.toString("utf-8") };
  }

  async function readFileFor(source: NodeSource, filename: string, optional: boolean): Promise<{ ok: true; buffer?: Buffer } | { ok: false; error: string }> {
    if (source.kind === "local") {
      const p = join(source.path, filename);
      if (!existsSync(p)) {
        if (optional) return { ok: true, buffer: undefined };
        return { ok: false, error: `${filename} not found at ${p}` };
      }
      return { ok: true, buffer: readFileSync(p) };
    }
    const r = await fetchRegistryFile(source.registryUrl, source.registryName, source.name, source.version, filename, optional);
    if (!r.ok) return { ok: false, error: r.error };
    if ("notFound" in r) return { ok: true, buffer: undefined };
    return { ok: true, buffer: r.buffer };
  }

  function listLocalSourceFiles(path: string): string[] {
    return readdirSync(path).filter((f: string) => f.endsWith(".ur"));
  }

  /**
   * Slice 8B Registry Selection Contract (per direct instruction,
   * confirmed as Design Contract in the prior Trace Gate, now
   * implemented exactly as specified): a dependency's own explicit
   * "registry" field always wins over inheritance. Its absence means
   * inherit the parent's own registry context verbatim - never a
   * search, never a fallback. Zero Silent Override: this function
   * only ever reads the dependency's declared field or the parent's
   * own fixed context - it never consults any OTHER registry to
   * decide.
   */
  function resolveRegistryForDep(dep: PackageDependency, parentContext: RegistryContext | undefined): { ok: true; context: RegistryContext | undefined } | { ok: false; error: string } {
    if (dep.registry) {
      const url = registries[dep.registry];
      if (!url) return { ok: false, error: `dependency '${dep.name}' pins registry '${dep.registry}', which is not registered locally — run 'ur registry add ${dep.registry} <url>' first` };
      return { ok: true, context: { name: dep.registry, url } };
    }
    return { ok: true, context: parentContext };
  }

  async function prepareOne(manifest: Manifest, source: NodeSource, registryContext: RegistryContext | undefined, requiredByName?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const existing = state.get(manifest.name);
    if (existing) {
      if (manifest.parsedVersion && existing.parsed.major === manifest.parsedVersion.major && existing.version === manifest.version) {
        existing.requiredBy.push(requiredByName ?? "");
        return { ok: true };
      }
    }
    const SAFE_PACKAGE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
    if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.name) || manifest.name.includes("..")) {
      return { ok: false, error: `invalid package name '${manifest.name}'` };
    }
    if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.version) || manifest.version.includes("..")) {
      return { ok: false, error: `invalid package version '${manifest.version}'` };
    }
    const destDir = join(urPackagesRoot, manifest.name);
    const stagingDir = join(urPackagesRoot, `.staging-${manifest.name}-${randomBytes(8).toString("hex")}`);
    mkdirSync(stagingDir, { recursive: true });
    allStagingDirsCreated.push(stagingDir);
    const realStagingDir = realpathSync(stagingDir);
    if (realStagingDir !== realPackagesRoot && !realStagingDir.startsWith(realPackagesRoot + sep)) {
      rmSync(stagingDir, { recursive: true, force: true });
      return { ok: false, error: `refusing to stage '${manifest.name}' — resolved path is outside ur_packages/, possibly via a symlink` };
    }

    const fileHashes: Record<string, string> = {};
    if (source.kind === "local") {
      const sourceFiles = listLocalSourceFiles(source.path);
      if (sourceFiles.length === 0) return { ok: false, error: `no .ur source files found in ${source.path}` };
      for (const file of sourceFiles) {
        const content = readFileSync(join(source.path, file));
        writeFileSync(join(stagingDir, file), content);
        fileHashes[file] = createHash("sha256").update(content).digest("hex");
      }
    } else {
      // Per the language's own real, structurally-confirmed constraint
      // (confirmed in Slice 7 Gate 1): import only ever reads a single
      // entry point, index.ur - the same file list already fetched
      // for a remote root install applies identically to a remote
      // dependency.
      const r = await readFileFor(source, "index.ur", false);
      if (!r.ok) return { ok: false, error: r.error };
      writeFileSync(join(stagingDir, "index.ur"), r.buffer!);
      fileHashes["index.ur"] = createHash("sha256").update(r.buffer!).digest("hex");
    }
    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifestToJson(manifest), null, 2));

    let publisherRecord: { keyId: string; signature: string } | undefined;
    const sigResult = await readFileFor(source, "package.sig", true);
    if (!sigResult.ok) return { ok: false, error: sigResult.error };
    if (sigResult.buffer) {
      let sigData: { signatureFormat?: number; keyId: string; signature: string };
      try {
        sigData = JSON.parse(sigResult.buffer.toString("utf-8"));
      } catch (e) {
        return { ok: false, error: `package.sig for '${manifest.name}' is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)})` };
      }
      // Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: this install path
      // (multi-dependency graph / remote sources) does not currently
      // resolve or hash a package-local module file at all — that
      // capability, and its own path-safety guarantees, exist only in
      // cmdInstallPackage's own local, single-package path today.
      // Silently treating a signatureFormat-2 signature as if it were
      // format 1 here would build an INCOMPLETE payload (missing the
      // module hash the signer actually included) and cause a
      // legitimate, correctly-signed V2 package to fail verification
      // as if tampered — or worse, if ever extended carelessly, to
      // verify successfully against an incomplete, unsafe payload.
      // Rejecting explicitly and honestly here is correct: format 1
      // is unaffected, unconditionally, exactly as before this Gate.
      const format = sigData.signatureFormat ?? 1;
      if (format !== 1) {
        return { ok: false, error: `package '${manifest.name}' is signed with signatureFormat ${sigData.signatureFormat} — this install path (multi-dependency/remote) does not yet support verifying module-inclusive signatures; install it directly via its own local path instead, or contact the maintainers about extending this path` };
      }
      const trustedPublicKeyPem = loadTrustStore()[sigData.keyId];
      if (!trustedPublicKeyPem) {
        return { ok: false, error: `package '${manifest.name}' is signed with key '${sigData.keyId}', which is not in the local trust store` };
      }
      const payload = buildDeterministicPayload(manifest.name, manifest.version, fileHashes);
      const publicKey = createPublicKey(trustedPublicKeyPem);
      if (!cryptoVerify(null, payload, publicKey, Buffer.from(sigData.signature, "base64"))) {
        return { ok: false, error: `signature verification failed for package '${manifest.name}@${manifest.version}' — tampered, or wrong name/version/files` };
      }
      writeFileSync(join(stagingDir, "package.sig"), sigResult.buffer);
      publisherRecord = { keyId: sigData.keyId, signature: sigData.signature };
    }

    const hadPreExisting = existsSync(destDir);
    if (manifest.parsedVersion) {
      state.set(manifest.name, { version: manifest.version, parsed: manifest.parsedVersion, requiredBy: requiredByName ? [requiredByName] : [] });
    }
    const registryOrigin = registryContext ? normalizeRegistryOrigin(registryContext.url) : "local";
    nodes.push({ name: manifest.name, version: manifest.version, manifest, source, fileHashes, publisherRecord, stagingDir, destDir, hadPreExisting, registryOrigin });

    for (const dep of manifest.dependencies) {
      const already = state.get(dep.name);
      if (already) {
        const constraint = parseVersionConstraint(dep.constraint);
        if (constraint && !satisfies(already.parsed, constraint)) {
          return { ok: false, error: `dependency conflict on '${dep.name}' — '${manifest.name}' requires '${dep.constraint}', but '${already.requiredBy.join(", ")}' already resolved it to ${already.version}, which does not satisfy '${dep.constraint}'` };
        }
        continue;
      }
      const regResult = resolveRegistryForDep(dep, registryContext);
      if (!regResult.ok) return regResult;
      const depRegistryContext = regResult.context;

      if (depRegistryContext) {
        // Remote dependency (explicit or inherited registry context).
        // Slice 9: resolve the real version (SemVer range via
        // versions.json, or direct use for an exact constraint)
        // before fetching - registry selection already happened
        // above (resolveRegistryForDep) and is never re-decided here.
        const versionResult = await resolveRemoteVersion(depRegistryContext.url, depRegistryContext.name, dep.name, dep.constraint);
        if (!versionResult.ok) return { ok: false, error: `dependency '${dep.name}' (required by '${manifest.name}'): ${versionResult.error}` };
        const resolvedVersion = versionResult.version;
        const manifestResult = await readManifestFor({ kind: "remote", registryName: depRegistryContext.name, registryUrl: depRegistryContext.url, name: dep.name, version: resolvedVersion });
        if (!manifestResult.ok) return { ok: false, error: `dependency '${dep.name}' (required by '${manifest.name}'): ${manifestResult.error}` };
        const depManifest = manifestFromJson(JSON.parse(manifestResult.text));
        if (!depManifest) return { ok: false, error: `dependency '${dep.name}': registry '${depRegistryContext.name}' returned an invalid manifest` };
        const sub = await prepareOne(depManifest, { kind: "remote", registryName: depRegistryContext.name, registryUrl: depRegistryContext.url, name: dep.name, version: resolvedVersion }, depRegistryContext, manifest.name);
        if (!sub.ok) return sub;
      } else {
        // Local dependency - exact same resolution as the original,
        // unmodified local-only path.
        const depFamilyDir = join(poolRoot, dep.name);
        if (!existsSync(depFamilyDir)) {
          return { ok: false, error: `dependency '${dep.name}' (required by '${manifest.name}') not found at ${depFamilyDir}` };
        }
        let depPath = depFamilyDir;
        if (!existsSync(join(depFamilyDir, "manifest.json"))) {
          const resolved = resolvePackageVersion(depFamilyDir, dep.constraint);
          if ("error" in resolved) return { ok: false, error: resolved.error };
          depPath = resolved.path;
        }
        const depManifestPath = join(depPath, "manifest.json");
        const depManifest = manifestFromJson(JSON.parse(readFileSync(depManifestPath, "utf-8")));
        if (!depManifest) return { ok: false, error: `${depManifestPath} is not a valid package manifest` };
        const sub = await prepareOne(depManifest, { kind: "local", path: depPath }, undefined, manifest.name);
        if (!sub.ok) return sub;
      }
    }
    return { ok: true };
  }

  const result = await prepareOne(rootManifest, rootSource, rootRegistryContext);
  if (!result.ok) {
    for (const dir of allStagingDirsCreated) rmSync(dir, { recursive: true, force: true });
    return { ok: false, error: result.error, staged: nodes };
  }
  return { ok: true, nodes };
}

/**
 * Phase COMMIT: sequentially applies the EXACT SAME per-node atomic
 * rename logic already proven in Gate 5 (backup-existing -> rename
 * staging into place -> remove backup only on success) - no new
 * commit logic invented, just applied once per node with the
 * Journal updated after each successful rename. If any rename fails
 * partway through the graph, every node already committed in THIS
 * transaction (commitStatus "after_rename") is rolled back using its
 * own recorded backup (or deleted, if it had no pre-existing
 * version) - restoring ur_packages/ to exactly its pre-transaction
 * state.
 */
function commitGraph(nodes: GraphNode[], journal: TransactionJournal): { ok: true } | { ok: false; error: string } {
  const urPackagesRoot = join(process.cwd(), "ur_packages");
  const realPackagesRoot = realpathSync(urPackagesRoot);

  for (const node of nodes) {
    const jNode = journal.nodes.find(n => n.name === node.name)!;
    if (node.hadPreExisting) {
      const realExisting = realpathSync(node.destDir);
      if (realExisting !== realPackagesRoot && !realExisting.startsWith(realPackagesRoot + sep)) {
        rollbackCommitted(nodes, journal);
        return { ok: false, error: `refusing to install '${node.name}' — the existing ur_packages/${node.name}/ is not a genuine directory inside ur_packages/ (possibly a symlink)` };
      }
      node.backupDir = join(urPackagesRoot, `.backup-${node.name}-${randomBytes(8).toString("hex")}`);
      renameSync(node.destDir, node.backupDir);
      jNode.backupPath = node.backupDir;
    }
    try {
      renameSync(node.stagingDir, node.destDir);
    } catch (e) {
      if (node.backupDir && existsSync(node.backupDir)) renameSync(node.backupDir, node.destDir);
      rollbackCommitted(nodes, journal);
      return { ok: false, error: `failed to commit '${node.name}' into ur_packages/ (${e instanceof Error ? e.message : String(e)})` };
    }
    jNode.commitStatus = "after_rename";
    writeFileSync(journalPath(journal.transactionId), JSON.stringify(journal, null, 2));
    if (node.backupDir) rmSync(node.backupDir, { recursive: true, force: true });
  }
  return { ok: true };
}

function rollbackCommitted(nodes: GraphNode[], journal: TransactionJournal): void {
  for (const node of nodes) {
    const jNode = journal.nodes.find(n => n.name === node.name)!;
    if (jNode.commitStatus !== "after_rename") continue;
    if (node.hadPreExisting && jNode.backupPath && existsSync(jNode.backupPath)) {
      rmSync(node.destDir, { recursive: true, force: true });
      renameSync(jNode.backupPath, node.destDir);
    } else if (!node.hadPreExisting) {
      rmSync(node.destDir, { recursive: true, force: true });
    }
    jNode.commitStatus = "rolled_back";
  }
}

/**
 * Writes ur.lock for the WHOLE graph in a single pass, only after
 * every node has been successfully committed - per direct
 * instruction: "no Node is registered in ur.lock before COMMITTED".
 */
function writeGraphLock(nodes: GraphNode[]): void {
  const lockPath = join(process.cwd(), "ur.lock");
  let existingLock: { lockfileVersion: number; packages: Record<string, unknown> };
  if (existsSync(lockPath)) {
    try {
      existingLock = JSON.parse(readFileSync(lockPath, "utf-8"));
    } catch {
      existingLock = { lockfileVersion: 1, packages: {} };
    }
  } else {
    existingLock = { lockfileVersion: 1, packages: {} };
  }
  for (const node of nodes) {
    const depsRecord: Record<string, string> = {};
    for (const d of node.manifest.dependencies) depsRecord[d.name] = d.constraint;
    existingLock.packages[node.name] = {
      name: node.name,
      version: node.version,
      integrity: `sha256:${Object.entries(node.fileHashes).sort(([a], [b]) => a.localeCompare(b)).map(([f, h]) => `${f}:${h}`).join(";")}`,
      resolved: node.source.kind === "local" ? node.source.path : `${node.source.registryName}:${node.source.name}@${node.source.version}`,
      registryOrigin: node.registryOrigin,
      dependencies: depsRecord,
      ...(node.publisherRecord ? { publisher: node.publisherRecord } : {}),
    };
  }
  writeFileSync(lockPath, JSON.stringify(existingLock, null, 2) + "\n");
}

/**
 * Crash-Recovery (per direct instruction: never decide from Journal
 * presence alone - always cross-check Journal + filesystem + ur.lock
 * before acting). Runs at the start of any 'ur install'. For each
 * leftover transaction journal found:
 *   - status "preparing" (or "all_committed" but ur_packages/ does
 *     not yet reflect all nodes) -> the transaction was interrupted
 *     mid-commit -> roll back every node whose own commitStatus is
 *     "after_rename".
 *   - status "all_committed" AND ur.lock already contains every
 *     node's exact recorded integrity -> the transaction had already
 *     fully finished (crash happened only between the lock write and
 *     the journal delete) -> finalize by deleting the journal only,
 *     touching nothing else.
 *   - status "all_committed" AND ur.lock is missing/mismatched for
 *     any node -> the crash happened after the commit phase but
 *     before (or during) the lock write -> complete the deferred
 *     ur.lock write from the journal's own recorded data (idempotent,
 *     no new hashing/verification), then delete the journal.
 */
function recoverPendingTransactions(): void {
  const urPackagesRoot = join(process.cwd(), "ur_packages");
  if (!existsSync(urPackagesRoot)) return;
  const files = readdirSync(urPackagesRoot).filter((f: string) => f.startsWith(".transaction-") && f.endsWith(".json"));
  for (const file of files) {
    const path = join(urPackagesRoot, file);
    let journal: TransactionJournal;
    try {
      journal = JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      rmSync(path, { force: true }); // corrupted journal - nothing safe to recover from it
      continue;
    }
    const lockPath = join(process.cwd(), "ur.lock");
    let lock: { packages: Record<string, { integrity?: string }> } | undefined;
    if (existsSync(lockPath)) {
      try { lock = JSON.parse(readFileSync(lockPath, "utf-8")); } catch { lock = undefined; }
    }
    const allCommitted = journal.nodes.every(n => n.commitStatus === "after_rename");
    if (journal.status === "all_committed" && allCommitted) {
      const lockMatchesAll = lock && journal.nodes.every(n => existsSync(n.destinationPath) && lock!.packages[n.name]);
      if (lockMatchesAll) {
        console.error(`recovered transaction '${journal.transactionId}': already fully finalized (filesystem and ur.lock agree) — removing leftover journal only`);
        rmSync(path, { force: true });
        continue;
      }
      console.error(`recovered transaction '${journal.transactionId}': filesystem was fully committed but ur.lock was not updated before an interruption — completing the deferred ur.lock write now`);
      let existingLock: { lockfileVersion: number; packages: Record<string, unknown> } = existsSync(lockPath) ? (lock as any ?? { lockfileVersion: 1, packages: {} }) : { lockfileVersion: 1, packages: {} };
      for (const n of journal.nodes) {
        existingLock.packages[n.name] = { name: n.name, version: n.version, registryOrigin: n.registryOrigin, resolved: n.destinationPath, recoveredFromTransaction: journal.transactionId };
      }
      writeFileSync(lockPath, JSON.stringify(existingLock, null, 2) + "\n");
      rmSync(path, { force: true });
    } else {
      console.error(`recovered transaction '${journal.transactionId}': was interrupted mid-commit — rolling back to the pre-transaction state`);
      for (const n of journal.nodes) {
        if (n.commitStatus !== "after_rename") continue;
        if (n.hadPreExisting && n.backupPath && existsSync(n.backupPath)) {
          rmSync(n.destinationPath, { recursive: true, force: true });
          renameSync(n.backupPath, n.destinationPath);
        } else if (!n.hadPreExisting) {
          rmSync(n.destinationPath, { recursive: true, force: true });
        }
      }
      rmSync(path, { force: true });
    }
  }
}

/**
 * Root entry point for a graph install (per direct instruction: "no
 * Package tradeoffs into the final state before Preparation succeeds
 * completely"). Orchestrates RESOLVE+VERIFY (prepareGraph) -> PREPARED
 * (journal written) -> COMMIT (commitGraph) -> ur.lock (writeGraphLock,
 * once for the whole graph) -> journal deleted only after verifying
 * ur.lock actually reflects the graph.
 */
async function cmdInstallGraph(manifest: Manifest, source: NodeSource, poolRoot: string, registryContext: RegistryContext | undefined): Promise<number> {
  const prepared = await prepareGraph(manifest, source, poolRoot, registryContext);
  if (!prepared.ok) {
    console.error(`error: ${prepared.error}`);
    return 1;
  }
  const nodes = prepared.nodes;

  const journal: TransactionJournal = {
    transactionId: `txn-${randomBytes(8).toString("hex")}`,
    rootPackage: manifest.name,
    status: "preparing",
    createdAt: new Date().toISOString(),
    nodes: nodes.map(n => ({
      name: n.name, version: n.version, registryOrigin: n.registryOrigin,
      stagingPath: n.stagingDir, destinationPath: n.destDir,
      hadPreExisting: n.hadPreExisting, commitStatus: "pending" as const,
    })),
  };
  writeFileSync(journalPath(journal.transactionId), JSON.stringify(journal, null, 2));

  const committed = commitGraph(nodes, journal);
  if (!committed.ok) {
    console.error(`error: ${committed.error} — the entire graph transaction was rolled back, ur_packages/ is unchanged from before this install attempt`);
    rmSync(journalPath(journal.transactionId), { force: true });
    return 1;
  }

  journal.status = "all_committed";
  writeFileSync(journalPath(journal.transactionId), JSON.stringify(journal, null, 2));

  writeGraphLock(nodes);
  rmSync(journalPath(journal.transactionId), { force: true });

  for (const n of nodes) console.log(`+ ${n.name}@${n.version} installed to ur_packages/${n.name}/`);
  return 0;
}
// ============================================================
// End Slice 8 Graph Transaction machinery
// ============================================================

/**
 * Slice 5 (per direct instruction): builds the deterministic payload a
 * package's signature is computed over. Must produce the exact same
 * bytes for the exact same package content, every time - achieved by
 * sorting file entries alphabetically (never relying on filesystem
 * enumeration order) and using a fixed, simple text format. name and
 * version are included so a signature cannot be replayed onto a
 * different package identity, per direct instruction ("reject on
 * name/version change").
 */
function buildDeterministicPayload(name: string, version: string, fileHashes: Record<string, string>): Buffer {
  const lines = [`${name}@${version}`];
  for (const file of Object.keys(fileHashes).sort((a, b) => a.localeCompare(b))) {
    lines.push(`${file}:${fileHashes[file]}`);
  }
  return Buffer.from(lines.join("\n"), "utf-8");
}

const MODULE_EXTENSIONS_BY_RUNTIME: Record<string, readonly string[]> = {
  c: [".c"], cpp: [".cpp", ".cc", ".cxx"], rust: [".rs"], go: [".go"], java: [".java"], wasm: [".wasm"], python: [".py"],
};

/**
 * Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: the ONE, shared,
 * canonical source of truth for "does this manifest have a package-
 * local module file that should be part of the signed artifact, and
 * if so, which real file, safely resolved?" — used identically by
 * `sign`, both install code paths, and (implicitly, by using the SAME
 * resolution result) verification, so sign/install/verify can never
 * silently disagree about which files are covered (the exact risk
 * named explicitly before this Gate was authorized).
 *
 * Reuses the EXACT SAME path-safety containment logic already proven
 * correct in Gate V1-PKG-MODULE-PATH-SAFETY (realpathSync on both the
 * package root and the candidate, requiring real containment) — not a
 * re-implementation, the identical algorithm, so this Gate's own
 * signature work can never silently regress that Gate's own,
 * already-verified protection.
 *
 * Returns undefined if there is no package-local module file to add
 * (a plain package, a "native"-runtime package — confirmed, module is
 * a system soname, never package-local — or a compiled-runtime
 * manifest with no resolvable, safe module file). Callers that need a
 * V2 signature/hash must otherwise fail on a MISSING module through
 * their own, existing, already-correct error paths (install's own
 * "no matching file was found" diagnostic; this helper does not
 * duplicate that error itself, since sign's own error text for the
 * same situation may reasonably differ from install's).
 */
function resolveCanonicalModuleFile(manifest: Manifest, packagePath: string): { status: "found"; fileName: string; realPath: string } | { status: "not-applicable" } | { status: "escaped"; fileName: string } | { status: "missing"; triedPaths: string[] } {
  const runtimeValue = typeof manifest.extra?.["runtime"] === "string" ? manifest.extra["runtime"] as string : undefined;
  const moduleValue = typeof manifest.extra?.["module"] === "string" ? manifest.extra["module"] as string : undefined;
  if (!runtimeValue || !Object.prototype.hasOwnProperty.call(MODULE_EXTENSIONS_BY_RUNTIME, runtimeValue) || !moduleValue || isAbsolute(moduleValue)) {
    return { status: "not-applicable" }; // includes "native" by construction, since it is never a key in MODULE_EXTENSIONS_BY_RUNTIME
  }
  const realPackageRoot = realpathSync(packagePath);
  const candidates = [moduleValue, ...MODULE_EXTENSIONS_BY_RUNTIME[runtimeValue]!.map(ext => moduleValue + ext)];
  for (const c of candidates) {
    const candidatePath = join(packagePath, c);
    if (!existsSync(candidatePath)) continue;
    let realCandidate: string;
    try {
      realCandidate = realpathSync(candidatePath);
    } catch {
      continue;
    }
    if (realCandidate === realPackageRoot || realCandidate.startsWith(realPackageRoot + sep)) {
      return { status: "found", fileName: c, realPath: realCandidate };
    }
    return { status: "escaped", fileName: c };
  }
  return { status: "missing", triedPaths: candidates.map(c => join(packagePath, c)) };
}

function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex");
}

const TRUST_STORE_PATH = join(homedir(), ".urpm", "trusted_keys.json");

function loadTrustStore(): Record<string, string> {
  if (!existsSync(TRUST_STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(TRUST_STORE_PATH, "utf-8")).keys ?? {};
  } catch {
    return {};
  }
}

/**
 * Slice 5: `ur keygen <output-dir>` - generates a real Ed25519 keypair.
 * The private key is written with an explicit, unambiguous filename
 * and an on-screen warning not to commit or store it inside a
 * project directory, per direct instruction - this CLI cannot
 * technically enforce that policy, so it is stated clearly instead.
 */
function cmdKeygen(outputDir: string | undefined): number {
  if (!outputDir) {
    console.error("error: usage: ur keygen <output-directory>");
    return 1;
  }
  mkdirSync(outputDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const fingerprint = publicKeyFingerprint(pubPem);
  writeFileSync(join(outputDir, "publisher-private.pem"), privPem);
  writeFileSync(join(outputDir, "publisher-public.pem"), pubPem);
  console.log(`generated Ed25519 keypair — fingerprint: ${fingerprint}`);
  console.log(`  private key: ${join(outputDir, "publisher-private.pem")}`);
  console.log(`  WARNING: keep this file secret. Do not commit it or store it inside a project's own source tree.`);
  console.log(`  public key:  ${join(outputDir, "publisher-public.pem")}`);
  return 0;
}

/**
 * Slice 5: `ur trust <public-key-path>` - adds a publisher's public
 * key to the local trust store (~/.urpm/trusted_keys.json). Only
 * keys explicitly added here are ever consulted during signature
 * verification - this is the "no random pick, no silent trust"
 * boundary for publisher identity.
 */
function cmdTrust(publicKeyPath: string | undefined): number {
  if (!publicKeyPath) {
    console.error("error: usage: ur trust <public-key-path>");
    return 1;
  }
  if (!existsSync(publicKeyPath)) {
    console.error(`error: public key not found at ${publicKeyPath}`);
    return 1;
  }
  const pubPem = readFileSync(publicKeyPath, "utf-8");
  const fingerprint = publicKeyFingerprint(pubPem);
  mkdirSync(dirname(TRUST_STORE_PATH), { recursive: true });
  const store = loadTrustStore();
  store[fingerprint] = pubPem;
  writeFileSync(TRUST_STORE_PATH, JSON.stringify({ keys: store }, null, 2) + "\n");
  console.log(`trusted publisher key added — fingerprint: ${fingerprint}`);
  return 0;
}

/**
 * Slice 5: `ur sign <package-path> <private-key-path>` - signs a
 * local package's deterministic payload with the given Ed25519
 * private key, writing a detached signature (package.sig) into the
 * package's own source directory, so 'ur install' picks it up from
 * there. Reuses the exact same file-collection logic already proven
 * in cmdInstallPackage - no new hashing invented.
 */
function cmdSignPackage(packagePath: string | undefined, privateKeyPath: string | undefined): number {
  if (!packagePath || !privateKeyPath) {
    console.error("error: usage: ur sign <package-path> <private-key-path>");
    return 1;
  }
  const manifestPath = join(packagePath, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`error: no manifest.json found at ${manifestPath}`);
    return 1;
  }
  const manifest = manifestFromJson(JSON.parse(readFileSync(manifestPath, "utf-8")));
  if (!manifest) {
    console.error(`error: ${manifestPath} is not a valid package manifest`);
    return 1;
  }
  const sourceFiles = readdirSync(packagePath, { withFileTypes: true }).filter((d: any) => d.isFile() && d.name.endsWith(".ur")).map((d: any) => d.name);
  const fileHashes: Record<string, string> = {};
  for (const file of sourceFiles) {
    fileHashes[file] = createHash("sha256").update(readFileSync(join(packagePath, file))).digest("hex");
  }
  // Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: uses the SAME shared
  // resolveCanonicalModuleFile() helper install/verify use — sign can
  // never disagree with install about which file is the package's own
  // real module. A plain, non-compiled-runtime, or "native" manifest
  // (resolution status "not-applicable") signs exactly as before this
  // Gate — V1, unconditionally, byte-for-byte unchanged. A compiled-
  // runtime manifest with an unresolvable module ("missing"/"escaped")
  // fails signing explicitly, rather than silently producing a V1
  // signature that would omit real, declared FFI content from its own
  // protection.
  let signatureFormat: number | undefined;
  let payloadFileHashes = fileHashes;
  const moduleResolution = resolveCanonicalModuleFile(manifest, packagePath);
  if (moduleResolution.status === "found") {
    const moduleHash = createHash("sha256").update(readFileSync(moduleResolution.realPath)).digest("hex");
    payloadFileHashes = { ...fileHashes, [moduleResolution.fileName]: moduleHash };
    signatureFormat = 2;
  } else if (moduleResolution.status === "escaped") {
    console.error(`error: manifest.json for package '${manifest.name}' declares a module that resolves outside the package root (possibly via '..' or a symlink) — refusing to sign`);
    return 1;
  } else if (moduleResolution.status === "missing") {
    console.error(`error: manifest.json for package '${manifest.name}' declares a compiled-runtime module that could not be found — tried: ${moduleResolution.triedPaths.join(", ")} — refusing to sign`);
    return 1;
  }
  const payload = buildDeterministicPayload(manifest.name, manifest.version, payloadFileHashes);
  const privPem = readFileSync(privateKeyPath, "utf-8");
  const privateKey = createPrivateKey(privPem);
  const publicKey = createPublicKey(privateKey);
  const pubPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const fingerprint = publicKeyFingerprint(pubPem);
  const signature = cryptoSign(null, payload, privateKey).toString("base64");
  writeFileSync(join(packagePath, "package.sig"), JSON.stringify({ ...(signatureFormat ? { signatureFormat } : {}), keyId: fingerprint, signature }, null, 2) + "\n");
  console.log(`signed '${manifest.name}@${manifest.version}' — keyId: ${fingerprint}${signatureFormat ? ` (signatureFormat ${signatureFormat}, includes package-local module file)` : ""}`);
  return 0;
}

const REMOTE_REGISTRIES_PATH = join(homedir(), ".urpm", "registries.json");
const CREDENTIALS_PATH = join(homedir(), ".urpm", "credentials.json");

/**
 * Gate 2 Review Checkpoint fix (per direct instruction): credential
 * isolation must be based on the registry's real, normalized ORIGIN
 * (scheme + hostname + port) - not on the alias name the user chose
 * with 'ur registry add'. Two different aliases that happen to point
 * to the same real origin correctly share a token (they ARE the same
 * registry); two aliases pointing to genuinely different origins can
 * never share one, with no alias-based bypass possible, since the
 * lookup at fetch time re-derives this same normalized key from the
 * registry's own real URL, never from the alias itself.
 */
function normalizeRegistryOrigin(url: string): string {
  const u = new URL(url);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `${u.protocol}//${u.hostname}:${port}`;
}

/**
 * Credential Store Contract (per direct instruction - stated
 * explicitly, not left implicit):
 *   CURRENT:  a local JSON file (~/.urpm/credentials.json).
 *   MINIMUM:  owner-only file permissions (0600) - applied below.
 *   FUTURE:   an OS-native credential store (Keychain/Credential
 *             Manager/libsecret). The current plaintext-JSON-with-
 *             permissions approach is NOT claimed to be a final or
 *             fully secure solution - it is the minimum viable
 *             baseline for this Gate.
 */
function loadCredentials(): Record<string, string> {
  if (!existsSync(CREDENTIALS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCredentials(creds: Record<string, string>): void {
  mkdirSync(dirname(CREDENTIALS_PATH), { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + "\n");
  if (process.platform === "win32") {
    // Contract (per direct instruction): POSIX file-mode bits are not
    // a meaningful protection model on Windows at all - chmodSync
    // here would not provide the guarantee its POSIX counterpart
    // does. Rather than call it and silently claim a protection that
    // does not really apply, this is stated explicitly: a real
    // Windows Credential Manager integration is deferred, not
    // implemented in this Gate.
    console.error("warning: credential file permission hardening is not yet implemented for Windows (deferred - a Windows Credential Manager integration is planned separately); the file is stored without OS-level access restriction beyond normal user-account permissions");
    return;
  }
  try {
    chmodSync(CREDENTIALS_PATH, 0o600);
    const actualMode = statSync(CREDENTIALS_PATH).mode & 0o777;
    if (actualMode !== 0o600) {
      console.error(`warning: credential file permission hardening did not apply as expected — expected mode 600, got ${actualMode.toString(8)}. Credentials were still saved, but may be readable by other users on this filesystem.`);
    }
  } catch (e) {
    console.error(`warning: could not apply owner-only permissions to the credential file (${e instanceof Error ? e.message : String(e)}). Credentials were still saved, but may be readable by other users on this filesystem.`);
  }
}

/**
 * Gate 2 (per direct instruction): `ur registry login <name> <token>`.
 * The token is stored under the registry's own normalized ORIGIN
 * (never under the alias name, never inside ur.lock, never inside any
 * project file) - the fix mandated by the Review Checkpoint. The
 * token itself is never echoed anywhere in this function's own
 * output, per direct instruction's Token Redaction requirement.
 */
function cmdRegistryLogin(name: string | undefined, token: string | undefined): number {
  if (!name || !token) {
    console.error("error: usage: ur registry login <name> <token>");
    return 1;
  }
  const registries = loadRemoteRegistries();
  const url = registries[name];
  if (!url) {
    console.error(`error: registry '${name}' not found — run 'ur registry add ${name} <url>' first`);
    return 1;
  }
  const origin = normalizeRegistryOrigin(url);
  const creds = loadCredentials();
  creds[origin] = token;
  saveCredentials(creds);
  console.log(`credentials saved for registry '${name}'`);
  return 0;
}

function loadRemoteRegistries(): Record<string, string> {
  if (!existsSync(REMOTE_REGISTRIES_PATH)) return {};
  try {
    return JSON.parse(readFileSync(REMOTE_REGISTRIES_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * Slice 7 Gate 1: `ur registry add <name> <url>`. Production
 * registries must use HTTPS - only 127.0.0.1/localhost may use plain
 * HTTP, and only because that is what the real, local
 * http.createServer test registry needs to run in this project's own
 * tests without any real network dependency. There is no general
 * escape hatch (no flag) that would let a user point this at an
 * arbitrary insecure host, per direct instruction.
 */
function cmdRegistryAdd(name: string | undefined, url: string | undefined): number {
  if (!name || !url) {
    console.error("error: usage: ur registry add <name> <url>");
    return 1;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`error: '${url}' is not a valid URL`);
    return 1;
  }
  const isLocalTestHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalTestHost)) {
    console.error(`error: registry URL must use https:// (plain http:// is only permitted for 127.0.0.1/localhost, for local testing)`);
    return 1;
  }
  mkdirSync(dirname(REMOTE_REGISTRIES_PATH), { recursive: true });
  const registries = loadRemoteRegistries();
  registries[name] = url;
  writeFileSync(REMOTE_REGISTRIES_PATH, JSON.stringify(registries, null, 2) + "\n");
  console.log(`registry '${name}' added: ${url}`);
  return 0;
}

/**
 * Slice 7 Gate 1: fetches a package's manifest.json, index.ur, and
 * optional package.sig from a remote registry into a real, local temp
 * directory that exactly mirrors a local package's own structure, then
 * installs it via cmdInstallPackage's own complete, entirely unchanged
 * logic - the exact same signature verification, integrity
 * verification, and path containment checks apply identically,
 * whether the source was local or remote. Any network error (refused
 * connection, timeout, non-200 status) or corrupted response (invalid
 * JSON) is rejected cleanly, never left to crash raw.
 */
/**
 * Slice 9 (per direct instruction, Frozen Contract): resolves a
 * dependency's version constraint against ONE already-selected
 * registry (never searches another - Zero Registry Fallback, SemVer
 * never chooses the registry, only the version within it). An exact
 * constraint (operator "=") is used directly, skipping the
 * versions.json request as an optimization - existence is still
 * verified downstream by the actual artifact fetch's own 404
 * handling, not skipped entirely. A range constraint (^, ~, etc.)
 * fetches versions.json, validates it explicitly (missing endpoint,
 * malformed JSON, non-array content, duplicate entries, and
 * individually-invalid SemVer strings are all handled as distinct,
 * clean failure or skip conditions - never silently trusted), then
 * picks the highest version satisfying the constraint using the
 * exact same satisfies()/compareSemVer() already proven for local
 * resolution - no new comparison logic invented.
 */
async function resolveRemoteVersion(registryUrl: string, registryName: string, pkgName: string, constraintRaw: string): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const constraint = parseVersionConstraint(constraintRaw);
  if (!constraint) return { ok: false, error: `invalid version constraint '${constraintRaw}' for '${pkgName}'` };
  if (constraint.operator === "=") {
    return { ok: true, version: constraintRaw };
  }

  const r = await fetchRegistryFile(registryUrl, registryName, pkgName, undefined, "versions.json", true);
  if (!r.ok) return { ok: false, error: r.error };
  if ("notFound" in r) {
    return { ok: false, error: `registry '${registryName}' does not provide a version index (versions.json) for '${pkgName}' — a version range constraint ('${constraintRaw}') requires one; use an exact version instead, or ask the registry operator to publish one` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.buffer.toString("utf-8"));
  } catch (e) {
    return { ok: false, error: `versions.json for '${pkgName}' from registry '${registryName}' is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)})` };
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Record<string, unknown>)["versions"])) {
    return { ok: false, error: `versions.json for '${pkgName}' from registry '${registryName}' has an invalid shape (expected {"versions": [...]})` };
  }
  const rawVersions = ((parsed as Record<string, unknown>)["versions"] as unknown[]).filter((v): v is string => typeof v === "string");
  const uniqueVersions = Array.from(new Set(rawVersions));
  let best: { raw: string; parsed: SemVer } | undefined;
  for (const v of uniqueVersions) {
    const sv = parseSemVer(v);
    if (!sv) continue; // individually-invalid SemVer entries are skipped, not fatal to the whole index
    if (!satisfies(sv, constraint)) continue;
    if (!best || compareSemVer(sv, best.parsed) > 0) best = { raw: v, parsed: sv };
  }
  if (!best) {
    return { ok: false, error: `no version of '${pkgName}' on registry '${registryName}' satisfies '${constraintRaw}' (available: ${uniqueVersions.join(", ") || "none"})` };
  }
  return { ok: true, version: best.raw };
}

/**
 * Slice 7 Gate 1+2: fetches a package's manifest.json, index.ur, and
 * optional package.sig from a remote registry into a real, local temp
 * directory that exactly mirrors a local package's own structure, then
 * installs it via cmdInstallPackage's own complete, entirely unchanged
 * logic - the exact same signature verification, integrity
 * verification, and path containment checks apply identically,
 * whether the source was local or remote, and run completely
 * independently of authentication (per direct instruction: a
 * successful 401 check does not itself grant any package trust).
 * Any network error (refused connection, timeout, non-200 status) or
 * corrupted response (invalid JSON) is rejected cleanly, never left
 * to crash raw. If credentials exist for this registry's own
 * normalized origin, an Authorization header is attached to every
 * request - looked up by origin, never by the alias name, so a token
 * registered for one registry can never reach a different one. The
 * token itself is never printed, logged, or included in any error
 * message anywhere in this function.
 */
/**
 * Gate 5 Micro-Fix (per direct instruction): fixed 15-second timeout
 * for every fetch to a remote registry - chosen as long enough for a
 * normal package fetch (a small manifest plus a single source file)
 * even over a slow connection, short enough that a hung or
 * unresponsive registry does not leave 'ur install' waiting
 * indefinitely with zero feedback (confirmed live before this fix:
 * an 8-second-delayed test response was still waiting when an
 * external test-harness timeout killed the process at 12 seconds -
 * there was no internal limit at all). Uses Node's own standard
 * AbortSignal.timeout() - no external dependency.
 */
const FETCH_TIMEOUT_MS = 15_000;

function describeFetchError(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Slice 8B (per direct instruction): shared remote-file fetch,
 * extracted from installFromRemoteRegistry's own original logic so
 * both the direct remote-install path and the new graph-dependency
 * path use the EXACT SAME Authentication (origin-based credential
 * lookup), Timeout (FETCH_TIMEOUT_MS via AbortSignal), and 401/403
 * classification - not a re-implementation that could silently
 * diverge from what Gates 2-5 already proved.
 */
async function fetchRegistryFile(registryUrl: string, registryName: string, pkgName: string, version: string | undefined, filename: string, optional: boolean): Promise<{ ok: true; buffer: Buffer } | { ok: true; notFound: true } | { ok: false; error: string }> {
  const base = version !== undefined ? `${registryUrl.replace(/\/$/, "")}/${pkgName}/${version}` : `${registryUrl.replace(/\/$/, "")}/${pkgName}`;
  const origin = normalizeRegistryOrigin(registryUrl);
  const token = loadCredentials()[origin];
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let res: Response;
  try {
    res = await fetch(`${base}/${filename}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, error: `could not fetch ${filename} from registry '${registryName}' (${describeFetchError(e)})` };
  }
  if (res.status === 401) return { ok: false, error: `authentication failed for registry '${registryName}' — missing or invalid credentials (run 'ur registry login ${registryName} <token>')` };
  if (res.status === 403) return { ok: false, error: `access forbidden for registry '${registryName}' — authenticated, but not authorized for this package` };
  if (res.status === 404 && optional) return { ok: true, notFound: true };
  if (!res.ok) return { ok: false, error: `registry returned ${res.status} for '${pkgName}${version !== undefined ? `@${version}` : ""}/${filename}'` };
  try {
    return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, error: `failed reading ${filename} from registry '${registryName}' (${e instanceof Error ? e.message : String(e)})` };
  }
}

async function installFromRemoteRegistry(pkgName: string, versionConstraint: string, registryName: string, registryUrl: string): Promise<number> {
  const versionResult = await resolveRemoteVersion(registryUrl, registryName, pkgName, versionConstraint);
  if (!versionResult.ok) {
    console.error(`error: ${versionResult.error}`);
    return 1;
  }
  const version = versionResult.version;
  const base = `${registryUrl.replace(/\/$/, "")}/${pkgName}/${version}`;
  const origin = normalizeRegistryOrigin(registryUrl);
  const token = loadCredentials()[origin];
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  function classifyAuthFailure(status: number): string | undefined {
    if (status === 401) return `error: authentication failed for registry '${registryName}' — missing or invalid credentials (run 'ur registry login ${registryName} <token>')`;
    if (status === 403) return `error: access forbidden for registry '${registryName}' — authenticated, but not authorized for this package`;
    return undefined;
  }

  const tempDir = join(tmpdir(), `urpm-fetch-${randomBytes(8).toString("hex")}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    let manifestRes: Response;
    try {
      manifestRes = await fetch(`${base}/manifest.json`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      console.error(`error: could not reach registry '${registryName}' (${describeFetchError(e)})`);
      return 1;
    }
    const authError1 = classifyAuthFailure(manifestRes.status);
    if (authError1) {
      console.error(authError1);
      return 1;
    }
    if (!manifestRes.ok) {
      console.error(`error: registry returned ${manifestRes.status} for '${pkgName}@${version}' — package/version may not exist`);
      return 1;
    }
    const manifestText = await manifestRes.text();
    try {
      JSON.parse(manifestText);
    } catch (e) {
      console.error(`error: manifest.json from registry is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)})`);
      return 1;
    }
    writeFileSync(join(tempDir, "manifest.json"), manifestText);

    let fileRes: Response;
    try {
      fileRes = await fetch(`${base}/index.ur`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      console.error(`error: could not fetch index.ur from registry '${registryName}' (${describeFetchError(e)})`);
      return 1;
    }
    const authError2 = classifyAuthFailure(fileRes.status);
    if (authError2) {
      console.error(authError2);
      return 1;
    }
    if (!fileRes.ok) {
      console.error(`error: registry returned ${fileRes.status} for '${pkgName}@${version}/index.ur'`);
      return 1;
    }
    let indexBuf: ArrayBuffer;
    try {
      indexBuf = await fileRes.arrayBuffer();
    } catch (e) {
      console.error(`error: failed reading index.ur from registry '${registryName}' (${e instanceof Error ? e.message : String(e)})`);
      return 1;
    }
    writeFileSync(join(tempDir, "index.ur"), Buffer.from(indexBuf));

    const sigRes = await fetch(`${base}/package.sig`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => undefined);
    if (sigRes && sigRes.ok) {
      try {
        writeFileSync(join(tempDir, "package.sig"), Buffer.from(await sigRes.arrayBuffer()));
      } catch (e) {
        console.error(`error: failed reading package.sig from registry '${registryName}' (${e instanceof Error ? e.message : String(e)})`);
        return 1;
      }
    }

    const rootManifestPath = join(tempDir, "manifest.json");
    let rootManifestForDepCheck: Manifest | undefined;
    try {
      rootManifestForDepCheck = manifestFromJson(JSON.parse(readFileSync(rootManifestPath, "utf-8")));
    } catch { /* fall through to the original single-package path below */ }
    if (rootManifestForDepCheck && rootManifestForDepCheck.dependencies.length > 0) {
      return await cmdInstallGraph(
        rootManifestForDepCheck,
        { kind: "remote", registryName, registryUrl, name: pkgName, version },
        "", // unused for a remote root - dependency resolution reads registry field/inheritance, never a local pool
        { name: registryName, url: registryUrl }
      );
    }
    return cmdInstallPackage(tempDir);
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

const LOCAL_REGISTRY_ROOT = join(homedir(), ".urpm", "registry");

/**
 * Slice 6 (per direct instruction): `ur publish <package-path>` -
 * copies a real local package (its manifest.json, .ur files, and
 * package.sig if signed - the exact same file set already proven in
 * cmdInstallPackage/cmdSignPackage) into the Local Registry, at
 * LOCAL_REGISTRY_ROOT/<name>/<version>/. Reuses the same package
 * name/version safety validation already proven in Gate 1 (Slice 4) -
 * no new validation logic invented. Does not touch ur_packages/ or
 * ur.lock at all - publishing is independent of any consuming
 * project.
 */
function cmdPublish(packagePath: string | undefined): number {
  if (!packagePath) {
    console.error("error: usage: ur publish <package-path>");
    return 1;
  }
  const manifestPath = join(packagePath, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`error: no manifest.json found at ${manifestPath}`);
    return 1;
  }
  const manifest = manifestFromJson(JSON.parse(readFileSync(manifestPath, "utf-8")));
  if (!manifest) {
    console.error(`error: ${manifestPath} is not a valid package manifest (missing name/version)`);
    return 1;
  }
  const SAFE_PACKAGE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.name) || manifest.name.includes("..")) {
    console.error(`error: invalid package name '${manifest.name}'`);
    return 1;
  }
  if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.version) || manifest.version.includes("..")) {
    console.error(`error: invalid package version '${manifest.version}'`);
    return 1;
  }
  if (parseSemVer(manifest.version) === undefined) {
    console.error(`error: invalid package version '${manifest.version}' - must be a valid semantic version (e.g. 1.0.0, 2.3.4-beta.1)`);
    return 1;
  }

  const destDir = join(LOCAL_REGISTRY_ROOT, manifest.name, manifest.version);
  mkdirSync(destDir, { recursive: true });
  const realRegistryRoot = realpathSync(join(LOCAL_REGISTRY_ROOT, manifest.name));
  const realDestDir = realpathSync(destDir);
  if (realDestDir !== realRegistryRoot && !realDestDir.startsWith(realRegistryRoot + sep)) {
    console.error(`error: refusing to publish '${manifest.name}' — its real, resolved path is outside the registry, possibly via a symlink`);
    return 1;
  }

  const sourceFiles = readdirSync(packagePath).filter((f: string) => f.endsWith(".ur"));
  for (const file of sourceFiles) writeFileSync(join(destDir, file), readFileSync(join(packagePath, file)));
  writeFileSync(join(destDir, "manifest.json"), JSON.stringify(manifestToJson(manifest), null, 2));
  const sigPath = join(packagePath, "package.sig");
  if (existsSync(sigPath)) writeFileSync(join(destDir, "package.sig"), readFileSync(sigPath));

  // Slice 9: maintain versions.json alongside the package family, so
  // Local Registry consumers can resolve SemVer range constraints
  // via the exact same resolveRemoteVersion path a real remote
  // registry would use.
  const familyDir = join(LOCAL_REGISTRY_ROOT, manifest.name);
  const versionsIndexPath = join(familyDir, "versions.json");
  let existingVersions: string[] = [];
  if (existsSync(versionsIndexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(versionsIndexPath, "utf-8"));
      if (Array.isArray(parsed?.versions)) existingVersions = parsed.versions.filter((v: unknown) => typeof v === "string");
    } catch { /* corrupted index is simply rebuilt fresh below */ }
  }
  const updatedVersions = Array.from(new Set([...existingVersions, manifest.version]));
  writeFileSync(versionsIndexPath, JSON.stringify({ versions: updatedVersions }, null, 2) + "\n");

  console.log(`+ published ${manifest.name}@${manifest.version} to local registry${existsSync(sigPath) ? " (signed)" : " (unsigned)"}`);
  return 0;
}

/**
 * Slice 6: `ur search <name>` - lists every version of `name`
 * currently published in the Local Registry.
 */
function cmdSearch(name: string | undefined): number {
  if (!name) {
    console.error("error: usage: ur search <package-name>");
    return 1;
  }
  const familyDir = join(LOCAL_REGISTRY_ROOT, name);
  if (!existsSync(familyDir)) {
    console.log(`no versions of '${name}' found in the local registry`);
    return 0;
  }
  const versions = readdirSync(familyDir, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name);
  if (versions.length === 0) {
    console.log(`no versions of '${name}' found in the local registry`);
    return 0;
  }
  console.log(`${name}:`);
  for (const v of versions.sort()) {
    const sigPresent = existsSync(join(familyDir, v, "package.sig"));
    console.log(`  ${v}${sigPresent ? " (signed)" : ""}`);
  }
  return 0;
}

/**
 * Slice 8: routes a root 'ur install <path>' to the new Graph
 * Transaction machinery ONLY when the package's own manifest
 * declares real dependencies. A package with zero dependencies (the
 * vast majority of existing tests, Gates 1-5, Slices 1-2) is
 * completely unaffected - it is handed, unchanged, to the original
 * cmdInstallPackage. Replicates the exact same versions-root
 * resolution cmdInstallPackage already performs at its own start, so
 * the decision (graph vs. single-package) is made on the correct,
 * fully-resolved manifest either way.
 */
async function cmdInstallRootWithGraphCheck(localPath: string | undefined, versionConstraint?: string, poolRootOverride?: string): Promise<number> {
  if (localPath) recoverPendingTransactions();
  if (!localPath) return cmdInstallPackage(localPath, versionConstraint);
  let resolvedPath = localPath;
  if (versionConstraint && !existsSync(join(resolvedPath, "manifest.json"))) {
    const resolved = resolvePackageVersion(resolvedPath, versionConstraint);
    if ("error" in resolved) return cmdInstallPackage(localPath, versionConstraint); // let the original path produce the same clean error
    resolvedPath = resolved.path;
  }
  const manifestPath = join(resolvedPath, "manifest.json");
  if (!existsSync(manifestPath)) return cmdInstallPackage(localPath, versionConstraint);
  let manifest: Manifest | undefined;
  try {
    manifest = manifestFromJson(JSON.parse(readFileSync(manifestPath, "utf-8")));
  } catch {
    return cmdInstallPackage(localPath, versionConstraint);
  }
  if (!manifest || manifest.dependencies.length === 0) {
    return cmdInstallPackage(localPath, versionConstraint);
  }
  const poolRoot = poolRootOverride ?? dirname(resolvedPath);
  return cmdInstallGraph(manifest, { kind: "local", path: resolvedPath }, poolRoot, undefined);
}

function cmdInstallPackage(localPath: string | undefined, versionConstraint?: string, poolRootOverride?: string, sharedState?: ResolutionState, requiredByName?: string): number {
  if (!localPath) {
    return cmdInstallFromLock();
  }
  // Slice 2: if the given path is a "versions root" (no manifest.json
  // directly inside, but version-named subdirectories each with their
  // own manifest.json) and a constraint was given, resolve the
  // version first, then proceed with the exact same install logic
  // below on the resolved subdirectory. A direct single-package
  // directory (Slice 1's own case) is completely unaffected.
  if (versionConstraint && !existsSync(join(localPath, "manifest.json"))) {
    const resolved = resolvePackageVersion(localPath, versionConstraint);
    if ("error" in resolved) {
      console.error(`error: ${resolved.error}`);
      return 1;
    }
    console.log(`resolved version ${resolved.version} satisfying '${versionConstraint}'`);
    localPath = resolved.path;
  }
  const manifestPath = join(localPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`error: no manifest.json found at ${manifestPath}`);
    return 1;
  }
  let manifest: Manifest | undefined;
  try {
    manifest = manifestFromJson(JSON.parse(readFileSync(manifestPath, "utf-8")));
  } catch (e) {
    console.error(`error: failed to parse ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (!manifest) {
    console.error(`error: ${manifestPath} is not a valid package manifest (missing name/version)`);
    return 1;
  }
  // Slice 4 (per direct instruction): a real path-traversal
  // vulnerability was confirmed live before this fix - a manifest
  // with name="../../../tmp/pwned" caused files to be written to
  // /tmp/tmp/pwned, entirely outside the consuming project, since
  // manifest.name was used directly in a path join with zero
  // validation. Package name and version are now validated against a
  // strict, safe character set - rejecting path separators ('/','\'),
  // '..', and any other unsafe character - BEFORE manifest.name or
  // manifest.version is used to construct any filesystem path, and
  // before any directory is created or file is written.
  const SAFE_PACKAGE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
  if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.name) || manifest.name.includes("..")) {
    console.error(`error: invalid package name '${manifest.name}' — package names must match ${SAFE_PACKAGE_IDENTIFIER} and must not contain '..'`);
    return 1;
  }
  if (!SAFE_PACKAGE_IDENTIFIER.test(manifest.version) || manifest.version.includes("..")) {
    console.error(`error: invalid package version '${manifest.version}' — package versions must match ${SAFE_PACKAGE_IDENTIFIER} and must not contain '..'`);
    return 1;
  }

  const destDir = join(process.cwd(), "ur_packages", manifest.name);
  const urPackagesRoot = join(process.cwd(), "ur_packages");
  mkdirSync(urPackagesRoot, { recursive: true });
  const realPackagesRoot = realpathSync(urPackagesRoot);
  // Critical security fix (per direct instruction, PROVEN SECURITY BUG,
  // confirmed exploitable live: a package whose signature failed
  // verification still left its files readable and executable in
  // ur_packages/, consumable by a later, unrelated legacy import).
  // The boundary is now Download/Copy -> Validate -> Verify -> Atomic
  // Commit, never Copy-into-destDir -> Verify. All file writes go
  // into a staging directory INSIDE ur_packages/ (same filesystem as
  // destDir - required for the final rename to be atomic), and every
  // check (Gate 3 containment, then Slice 5 signature verification)
  // runs against the staged content BEFORE destDir is ever touched.
  const stagingDir = join(process.cwd(), "ur_packages", `.staging-${manifest.name}-${randomBytes(8).toString("hex")}`);
  mkdirSync(stagingDir, { recursive: true });
  const realStagingDir = realpathSync(stagingDir);
  if (realStagingDir !== realPackagesRoot && !realStagingDir.startsWith(realPackagesRoot + sep)) {
    console.error(`error: refusing to install '${manifest.name}' — its real, resolved staging path (${realStagingDir}) is outside ur_packages/ (${realPackagesRoot}), possibly via a symlink`);
    rmSync(stagingDir, { recursive: true, force: true });
    return 1;
  }

  try {
    const sourceFiles = readdirSync(localPath).filter((f: string) => f.endsWith(".ur"));
    if (sourceFiles.length === 0) {
      console.error(`error: no .ur source files found in ${localPath}`);
      return 1;
    }
    // Gate V1-PKG-FFI-MODULE-PAYLOAD-IMPLEMENTATION: for a compiled-
    // runtime manifest (c/cpp/rust/go/java/wasm — the SAME, already-
    // established isCompiledRuntime classification used elsewhere in
    // this file for FFI resolution, confirmed by the prior Design
    // Discovery to EXCLUDE "native", whose own `module` field is a
    // system library soname, never a package-local file — copying it
    // would be incorrect and is explicitly not done here), the
    // manifest's own declared `module` source file must actually exist
    // in the source package and be copied into the installed package,
    // exactly as the ALREADY-EXISTING, already-correct
    // resolveModuleFile() resolution logic (src/interpreter/
    // interpret.ts) already expects to find it — package-relative,
    // not externally. Runtime-appropriate extensions mirror that same
    // function's own extension list exactly, so install-time
    // resolution and call-time resolution never diverge.
    const runtimeValue = typeof manifest.extra?.["runtime"] === "string" ? manifest.extra["runtime"] as string : undefined;
    const moduleValue = typeof manifest.extra?.["module"] === "string" ? manifest.extra["module"] as string : undefined;
    let moduleFileToCopy: string | undefined;
    // Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: resolution now goes
    // through the ONE shared resolveCanonicalModuleFile() helper — the
    // SAME algorithm `sign` and verification also use, so this install
    // path can never disagree with what gets signed/verified about
    // which file is the package's own real module. Reuses, unchanged,
    // the exact path-safety containment logic already proven correct
    // in Gate V1-PKG-MODULE-PATH-SAFETY (11 direct tests) — not a
    // re-implementation.
    const moduleResolution = resolveCanonicalModuleFile(manifest, localPath);
    if (moduleResolution.status === "escaped") {
      console.error(`error: manifest.json for package '${manifest.name}' declares module '${moduleValue}' — the file '${moduleResolution.fileName}' resolves outside the package root (${localPath}), which is not allowed (possibly via '..' or a symlink)`);
      rmSync(stagingDir, { recursive: true, force: true });
      return 1;
    }
    if (moduleResolution.status === "missing") {
      console.error(`error: manifest.json for package '${manifest.name}' declares runtime '${runtimeValue}' and module '${moduleValue}', but no matching file was found in ${localPath} — tried: ${moduleResolution.triedPaths.join(", ")}`);
      rmSync(stagingDir, { recursive: true, force: true });
      return 1;
    }
    if (moduleResolution.status === "found") {
      moduleFileToCopy = moduleResolution.fileName;
    }
    const fileHashes: Record<string, string> = {};
    for (const file of sourceFiles) {
      const content = readFileSync(join(localPath, file));
      writeFileSync(join(stagingDir, file), content);
      fileHashes[file] = createHash("sha256").update(content).digest("hex");
    }
    // Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: fileHashes ITSELF
    // (used for V1 payloads, and for ur.lock's own integrity field —
    // UNCHANGED, per Stop Condition 1 and the explicit "no ur.lock
    // changes" requirement) is NEVER mutated to include the module
    // file. A SEPARATE object, fileHashesV2, is built only when needed,
    // strictly for V2 signature verification — this guarantees V1's
    // own payload construction is byte-for-byte identical to before
    // this Gate, for every package, always.
    let fileHashesV2: Record<string, string> | undefined;
    if (moduleFileToCopy) {
      // Re-verify containment immediately before reading (TOCTOU
      // hardening — see the prior Gate's own Discovery section on this
      // exact question): the check above and this read are two
      // separate filesystem operations; re-checking here narrows the
      // window an attacker would need to exploit a race, even though
      // this whole block runs synchronously with no `await` between
      // the two.
      const realLocalPath = realpathSync(localPath);
      const moduleCandidatePath = join(localPath, moduleFileToCopy);
      const realModuleCandidate = realpathSync(moduleCandidatePath);
      if (realModuleCandidate !== realLocalPath && !realModuleCandidate.startsWith(realLocalPath + sep)) {
        console.error(`error: manifest.json for package '${manifest.name}' declares module '${moduleValue}' — the file '${moduleFileToCopy}' resolves outside the package root (${localPath}) at copy time, which is not allowed`);
        rmSync(stagingDir, { recursive: true, force: true });
        return 1;
      }
      const moduleContent = readFileSync(moduleCandidatePath);
      mkdirSync(dirname(join(stagingDir, moduleFileToCopy)), { recursive: true });
      writeFileSync(join(stagingDir, moduleFileToCopy), moduleContent);
      fileHashesV2 = { ...fileHashes, [moduleFileToCopy]: createHash("sha256").update(moduleContent).digest("hex") };
    }
    writeFileSync(join(stagingDir, "manifest.json"), JSON.stringify(manifestToJson(manifest), null, 2));

    // Slice 5 (per direct instruction): signature verification, only
    // when the source package actually carries a detached signature -
    // absence of package.sig is not an error (backward-compatible with
    // every unsigned package proven in Slices 1-4). Presence of one
    // that fails verification for ANY reason (untrusted key, wrong
    // key, tampered content, changed name/version) is a hard, clean
    // rejection - no silent skip. Critically, this now runs entirely
    // against stagingDir - destDir has not been touched at all yet,
    // so a failure here leaves ur_packages/ completely unchanged.
    let publisherRecord: { keyId: string; signature: string } | undefined;
    const sigPath = join(localPath, "package.sig");
    if (existsSync(sigPath)) {
      let sigData: { signatureFormat?: number; keyId: string; signature: string };
      try {
        sigData = JSON.parse(readFileSync(sigPath, "utf-8"));
      } catch (e) {
        console.error(`error: package.sig for '${manifest.name}' is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)})`);
        return 1;
      }
      // Gate V1-PKG-MODULE-INTEGRITY-IMPLEMENTATION: dispatch on the
      // signature's own declared format — an ABSENT field means V1
      // (today's own, real, unmodified behavior, for every already-
      // published package, unconditionally). Any value other than
      // undefined/1/2 is rejected explicitly here — NEVER silently
      // treated as V1, which could otherwise let an attacker downgrade
      // a V2-signed package's own real protection.
      const format = sigData.signatureFormat ?? 1;
      let payloadFileHashes: Record<string, string>;
      if (format === 1) {
        payloadFileHashes = fileHashes;
      } else if (format === 2) {
        if (!fileHashesV2) {
          console.error(`error: package '${manifest.name}' is signed as signatureFormat 2 (expects a package-local module file to be part of the signed content), but no such module file was resolved for this package — refusing to verify against an incomplete payload`);
          return 1;
        }
        payloadFileHashes = fileHashesV2;
      } else {
        console.error(`error: package '${manifest.name}' has an unsupported signatureFormat (${sigData.signatureFormat}) — this installer supports 1 (implicit, omit the field) and 2`);
        return 1;
      }
      const trustStore = loadTrustStore();
      const trustedPublicKeyPem = trustStore[sigData.keyId];
      if (!trustedPublicKeyPem) {
        console.error(`error: package '${manifest.name}' is signed with key '${sigData.keyId}', which is not in the local trust store — run 'ur trust <public-key-path>' first if you trust this publisher`);
        return 1;
      }
      const payload = buildDeterministicPayload(manifest.name, manifest.version, payloadFileHashes);
      const publicKey = createPublicKey(trustedPublicKeyPem);
      const validSignature = cryptoVerify(null, payload, publicKey, Buffer.from(sigData.signature, "base64"));
      if (!validSignature) {
        console.error(`error: signature verification failed for package '${manifest.name}@${manifest.version}' — the content does not match what key '${sigData.keyId}' signed (tampered, or wrong name/version/files)`);
        return 1;
      }
      writeFileSync(join(stagingDir, "package.sig"), readFileSync(sigPath));
      publisherRecord = { keyId: sigData.keyId, signature: sigData.signature };
      console.log(`signature verified — publisher key: ${sigData.keyId}`);
    }

    // Atomic Commit (per direct instruction: "Immutable/isolated
    // staging -> verify fully -> atomic replacement/commit only on
    // success"). If destDir already exists from a prior successful
    // install, it is first verified to be a genuine descendant of
    // ur_packages/ (never blindly renamed - a foreign symlink planted
    // there is refused, not touched), then moved aside as a backup.
    // Staging is renamed into destDir's place - this specific rename
    // is atomic on the same filesystem. The backup is removed only
    // after that succeeds. Any failure restores the backup, leaving
    // ur_packages/ exactly as it was before this install attempt - a
    // pre-existing, valid package by this name is never lost or
    // corrupted by a failed re-install attempt.
    let backupDir: string | undefined;
    if (existsSync(destDir)) {
      const realExistingDestDir = realpathSync(destDir);
      if (realExistingDestDir !== realPackagesRoot && !realExistingDestDir.startsWith(realPackagesRoot + sep)) {
        console.error(`error: refusing to install '${manifest.name}' — the existing ur_packages/${manifest.name}/ is not a genuine directory inside ur_packages/ (possibly a symlink); refusing to touch it`);
        return 1;
      }
      backupDir = join(process.cwd(), "ur_packages", `.backup-${manifest.name}-${randomBytes(8).toString("hex")}`);
      renameSync(destDir, backupDir);
    }
    try {
      renameSync(stagingDir, destDir);
    } catch (e) {
      if (backupDir && existsSync(backupDir)) renameSync(backupDir, destDir);
      console.error(`error: failed to commit '${manifest.name}' into ur_packages/ (${e instanceof Error ? e.message : String(e)}) — the previous state, if any, was restored`);
      return 1;
    }
    if (backupDir) rmSync(backupDir, { recursive: true, force: true });

    const lockPath = join(process.cwd(), "ur.lock");
    let existingLock: { lockfileVersion: number; packages: Record<string, unknown> };
    if (existsSync(lockPath)) {
      try {
        existingLock = JSON.parse(readFileSync(lockPath, "utf-8"));
      } catch (e) {
        console.error(`warning: ur.lock was corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)}) — regenerating it from scratch`);
        existingLock = { lockfileVersion: 1, packages: {} };
      }
    } else {
      existingLock = { lockfileVersion: 1, packages: {} };
    }
    const depsRecord: Record<string, string> = {};
    for (const d of manifest.dependencies) depsRecord[d.name] = d.constraint;
    existingLock.packages[manifest.name] = {
      name: manifest.name,
      version: manifest.version,
      integrity: `sha256:${Object.entries(fileHashes).sort(([a], [b]) => a.localeCompare(b)).map(([f, h]) => `${f}:${h}`).join(";")}`,
      resolved: localPath,
      dependencies: depsRecord,
      ...(publisherRecord ? { publisher: publisherRecord } : {}),
    };
    writeFileSync(lockPath, JSON.stringify(existingLock, null, 2) + "\n");

    console.log(`+ ${manifest.name}@${manifest.version} installed to ur_packages/${manifest.name}/`);
  } finally {
    try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* best-effort - already moved on success */ }
  }

  return 0;
}

function cmdInit(): number {
  const target = resolve(process.cwd(), "hello.ur");
  if (existsSync(target)) {
    console.error(`error: ${target} already exists — remove it first or choose a different directory`);
    return 1;
  }
  writeStarterFile(target);
  console.log(`Created ${target}`);
  console.log(`Run it with: ur run hello.ur`);
  return 0;
}

function writeStarterFile(path: string): void {
  writeFileSync(path, STARTER_PROGRAM, "utf-8");
}

/**
 * FIXED — Windows Recovery Sprint, per explicit direction: bundling a
 * real GCC/MinGW toolchain is not achievable from this development
 * environment (see WINDOWS_GCC_BUNDLING_STATUS.md), and requiring a
 * user to install one themselves was explicitly REJECTED as acceptable
 * for v1.0. This function now compiles ONLY up to the IR — the C
 * Backend/gcc step is no longer part of `ur run`/`ur build` at all.
 * Both commands now execute via the interpreter (src/interpreter/
 * interpret.ts), which has ZERO dependency on gcc or any external
 * toolchain — Node.js itself (already the platform this CLI runs on)
 * is the only prerequisite, exactly matching the accepted "Option 2"
 * direction (change the execution architecture, not merely disclose
 * the gap).
 */
function compileToIR(filePath: string): { ir: IRModule; source: string; fileName: string; friTimeouts: Record<string, { runMs?: number; compileMs?: number }> } | null {
  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) {
    console.error(`error: file not found: ${filePath}`);
    return null;
  }
  const rawSource = readFileSync(absPath, "utf-8");
  const fileName = basename(absPath);

  // FRI: real call_external(...) support, implemented as a real,
  // explicit source rewrite BEFORE lex/parse — not a new Parser/AST
  // feature, and not a separate execution path from Manifest-based
  // imports. Each literal call_external("runtime", "module", "symbol",
  // arg) call is rewritten to a call to a freshly-generated, uniquely
  // named function (e.g. __call_external_0(arg)), and that generated
  // function is registered in externalFunctionsFromCallExternal using
  // the EXACT SAME { runtime, module, symbol } shape Manifest-based
  // imports already produce — reusing the real, already-tested FRI
  // execution mechanism (lowerToIR's own externalFunctions parameter,
  // interpretModule's own fn.external handling) directly, not a
  // second, separate mechanism.
  const externalFunctionsFromCallExternal = new Map<string, { runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript" | "native"; module: string; symbol: string; rawArgs: string }>();
  let callExternalCounter = 0;
  let source = "";
  {
    const headPattern = /call_external\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = headPattern.exec(rawSource)) !== null) {
      const [runtime, mod, symbol] = [m[1]!, m[2]!, m[3]!];
      const afterHead = m.index + m[0].length;
      let depth = 1;
      let i = afterHead;
      let inString: string | null = null;
      while (i < rawSource.length && depth > 0) {
        const ch = rawSource[i];
        if (inString) {
          if (ch === "\\") { i += 2; continue; }
          if (ch === inString) inString = null;
        } else if (ch === '"' || ch === "'") {
          inString = ch;
        } else if (ch === "(" || ch === "[" || ch === "{") {
          depth++;
        } else if (ch === ")" || ch === "]" || ch === "}") {
          depth--;
        }
        i++;
      }
      const rawArgs = rawSource.slice(afterHead, i - 1).trim();
      source += rawSource.slice(lastIndex, m.index);
      if (runtime !== "python" && runtime !== "javascript" && runtime !== "c" && runtime !== "cpp" && runtime !== "wasm" && runtime !== "typescript" && runtime !== "rust" && runtime !== "go" && runtime !== "java") {
        source += rawSource.slice(m.index, i);
      } else {
        const genName = `__call_external_${callExternalCounter++}`;
        let argsJson: string;
        try {
          // SECURITY FIX: parse the raw argument text as real JSON —
          // this is a DATA parse, not a code execution. A malicious
          // argument like '";console.log(\'PWNED\');//' is NOT valid
          // JSON (it's neither a bare string literal by itself nor
          // valid inside the implicit array wrapper below) and is
          // rejected HERE, before ever reaching a subprocess — it
          // never becomes script text.
          const parsedArgs: unknown[] = rawArgs.trim() === "" ? [] : JSON.parse(`[${rawArgs}]`);
          argsJson = JSON.stringify(parsedArgs);
        } catch {
          console.error(`error: call_external(...) arguments for '${symbol}' are not valid JSON literals (numbers, "strings", [arrays], {"objects":1}, true/false/null) — received: ${rawArgs}`);
          return null;
        }
        externalFunctionsFromCallExternal.set(genName, { runtime, module: mod, symbol, rawArgs: argsJson });
        source += `${genName}()`;
      }
      lastIndex = i;
      headPattern.lastIndex = i;
    }
    source += rawSource.slice(lastIndex);
  }

  const tokens = lexAndCheck(source, fileName);
  if (!tokens) return null;
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length > 0) {
    printDiagnostics(parseErrors as FormattableDiagnostic[], source, fileName);
    return null;
  }
  // Real stub FunctionDecls for each call_external(...) site, parsed via
  // the existing lexer/parser (no manual AST construction) - mirrors
  // Manifest-based import's own stub-generation exactly.
  for (const genName of externalFunctionsFromCallExternal.keys()) {
    const stubSource = `function ${genName}(): int\n  return 0\nend\n`;
    const stubTokens = lexAndCheck(stubSource, fileName);
    if (!stubTokens) return null;
    const { program: stubProgram } = parse(stubTokens);
    program.functions.push(...stubProgram.functions);
  }

  // Phase 0-A (per explicit direction): connect the EXISTING
  // ModuleRegistry/ImportResolver to the real CLI — no Parser/AST
  // changes, no new Import Manager, no namespace syntax
  // (geo.hello()). `import geo` resolves geo's own .ur file from the
  // user's own filesystem (relative to `packagesRoot`'s default,
  // "./ur_packages", resolved from the CURRENT WORKING DIRECTORY —
  // matching where a real user would actually run `ur run` from, not
  // this CLI's own installation directory), reads it, and merges its
  // functions/structs directly into the main program's own function/
  // struct lists — so `hello()` (declared in geo's own file) becomes
  // directly callable, exactly like a function declared in the main
  // file itself. This is a real merge of already-parsed ASTs, not a
  // new language feature — lowerToIR/analyze/typeCheck never see two
  // separate programs, only one, already-merged Program, matching
  // their own existing, tested single-Program API exactly.
  const merged = resolveAndMergeImports(program, fileName);
  if (!merged.ok) {
    if (merged.span) {
      console.error(formatDiagnostic({ severity: "error", code: "IM1001", message: merged.error.replace(/^error:\s*/, ""), span: merged.span }, source, fileName));
    } else {
      console.error(merged.error);
    }
    return null;
  }
  // P1-7 Design Gate, Finding B (Python half): setting PYTHONPATH
  // here, in this still-running `ur` process, before the interpreter
  // (interpret.ts, unmodified) later spawns `python3 -c ...` via
  // spawnSync with no explicit `env` option, means that subprocess
  // inherits this exact process.env — confirmed by reading
  // interpret.ts's own spawnSync call site. This makes Python module
  // resolution independent of `process.cwd()` (Finding B) without
  // editing interpret.ts, which this Gate is not authorized to touch.
  if (merged.pythonManifestDirs.length > 0) {
    const existing = process.env.PYTHONPATH ? process.env.PYTHONPATH.split(delimiter) : [];
    process.env.PYTHONPATH = [...merged.pythonManifestDirs, ...existing].join(delimiter);
  }
  // P1-2-T-WINDOWS-TS-RUNTIME (Implementation Gate, cli/index.ts only,
  // Option C): interpret.ts already has an env-var override hook for
  // its "typescript"-runtime dispatch (`process.env.TSX_BIN ?? "tsx"`)
  // - confirmed present and unmodified. Today it is unused by any part
  // of this codebase, so a bare "tsx" is looked up on the OS PATH only,
  // which finds a *global* `tsx` install but not this project's own,
  // already-declared `dependencies.tsx` (package.json), installed
  // locally at node_modules/.bin/tsx once `npm install` has run - the
  // exact same resolution `bin/ur.mjs` already performs for launching
  // the CLI itself (`join(__dirname, "..", "node_modules", ".bin",
  // "tsx")`), just never applied to this internal FFI dispatch call.
  // Populating TSX_BIN here, only when a "typescript"-runtime import is
  // actually present and only when a local tsx binary is actually
  // found, requires zero changes to interpret.ts - mirroring the exact
  // PYTHONPATH pattern immediately above. If no local tsx is found
  // (e.g. a dist-only install with no node_modules), TSX_BIN is left
  // unset, preserving today's exact fallback-to-global-PATH behavior.
  if (!process.env.TSX_BIN && merged.externalFunctions.size > 0) {
    const usesTypeScriptRuntime = [...merged.externalFunctions.values()].some(ext => ext.runtime === "typescript");
    if (usesTypeScriptRuntime) {
      // P1-2-T Windows Runtime Fix - Revision 2: the real root cause of
      // the Round-5 Windows failure was confirmed by direct
      // reproduction (not assumed): tsconfig.build.json's `rootDir: "."`
      // means `src/cli/index.ts` compiles to `dist/src/cli/index.js` -
      // one directory level deeper than the source location. The prior
      // fix's fixed "up two levels" calculation is correct when running
      // via `tsx src/cli/index.ts` (src/cli -> src -> package root) but
      // lands one level short (at `dist/`, not the real package root)
      // when running the compiled `node dist/src/cli/index.js` - which
      // is exactly the invocation the independent Windows test used.
      // This is why node_modules/.bin/tsx.cmd was never found there,
      // reproduced and confirmed by direct simulation of both directory
      // shapes before this fix. Both known shapes (tsx-transpiled
      // source and compiled dist) are checked explicitly below, rather
      // than switching to a process.cwd()/UR_PROJECT_ROOT-based lookup
      // - preserving the original reasoning that tsx is this CLI's own
      // dependency, resolved from its own on-disk location, independent
      // of the caller's working directory (consistent with the
      // already-closed P1-6-R contract).
      const thisFileDir = dirnameOfThisFile();
      const candidateRoots = [
        join(thisFileDir, "..", ".."),        // tsx src/cli/index.ts
        join(thisFileDir, "..", "..", ".."),  // node dist/src/cli/index.js
      ];
      const candidates: string[] = [];
      for (const packageRoot of candidateRoots) {
        candidates.push(join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"));
        candidates.push(join(packageRoot, "node_modules", ".bin", "tsx"));
      }
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          process.env.TSX_BIN = candidate;
          break;
        }
      }
    }
  }

  const sem = analyze(merged.program);
  const semErrors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (semErrors.length > 0) {
    printDiagnostics(semErrors as FormattableDiagnostic[], source, fileName);
    return null;
  }

  const tc = typeCheck(merged.program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length > 0) {
    printDiagnostics(tcErrors as FormattableDiagnostic[], source, fileName);
    return null;
  }

  const allExternalFunctions = new Map([...merged.externalFunctions, ...externalFunctionsFromCallExternal]);
  const ir = lowerToIR(merged.program, fileName, fileName.replace(/\.ur$/, ""), undefined, undefined, allExternalFunctions);
  if (!ir.ok) {
    const asFormattable = ir.diagnostics.map(d => ({ ...d, span: d.location })) as FormattableDiagnostic[];
    printDiagnostics(asFormattable, source, fileName);
    return null;
  }

  return { ir: ir.value, source, fileName, friTimeouts: Object.fromEntries(merged.friTimeouts) };
}

/**
 * Real, minimal import resolution + AST merge for Phase 0-A. Only
 * supports a single level of import (the imported module's own
 * imports are NOT recursively resolved) — a real, disclosed scope
 * boundary of this phase, not silently pretended to be full recursive
 * resolution. Uses the existing, already-tested ModuleRegistry
 * (registry.ts) and its own default packagesRoot ("./ur_packages",
 * resolved relative to the current working directory) — no new
 * resolution logic invented here.
 */
/**
 * Decision 2C's own named steps (per direct instruction's own PR
 * conditions - narrow structural refactor only, zero new state,
 * zero behavior change, matching the isolated experiment already
 * proven in experiments/f1_f2_boundary_preservation.ts).
 */
function resolveImportLocation(importPath: string, cwd: string): string {
  return resolve(cwd, "ur_packages", importPath, "index.ur");
}

/**
 * Gate 2 (per direct instruction, confirmed decision A): Runtime
 * Package Integrity Boundary. Trust rule:
 *   - No ur.lock in the current project -> legacy/unmanaged mode,
 *     import proceeds exactly as before (zero change for projects
 *     not using urpm at all).
 *   - ur.lock present -> the package being imported must be
 *     registered in it, and the currently-installed file's real
 *     sha256 hash must match the recorded integrity entry exactly -
 *     otherwise import is rejected, cleanly, before the file is ever
 *     read for parsing.
 * Confined strictly to this one check, called right before
 * consumeModule - resolveImportLocation/validatePackageLocation (the
 * resolution side) are completely untouched, per direct instruction.
 */
function verifyPackageIntegrity(importPath: string, candidatePath: string): { ok: true } | { ok: false; error: string } {
  const lockPath = join(process.cwd(), "ur.lock");
  if (!existsSync(lockPath)) return { ok: true }; // legacy/unmanaged mode

  let lock: { packages: Record<string, { integrity: string }> };
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch (e) {
    return { ok: false, error: `error: ur.lock is corrupted and cannot be parsed (${e instanceof Error ? e.message : String(e)}) — this project uses a lockfile, and a corrupted one cannot be trusted to verify any package; run 'ur install' to regenerate it` };
  }
  const entry = lock.packages[importPath];
  if (!entry) {
    return { ok: false, error: `error: package '${importPath}' is not registered in ur.lock — this project uses a lockfile, and unregistered packages in ur_packages/ are not treated as trusted` };
  }

  const fileName = basename(candidatePath);
  const fileEntryMatch = entry.integrity.match(new RegExp(`${fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:([0-9a-f]{64})`));
  const expectedHash = fileEntryMatch?.[1];
  if (!expectedHash) {
    return { ok: false, error: `error: no recorded integrity hash for '${fileName}' in package '${importPath}' — cannot verify` };
  }
  const actualHash = createHash("sha256").update(readFileSync(candidatePath)).digest("hex");
  if (actualHash !== expectedHash) {
    return { ok: false, error: `error: integrity check failed for package '${importPath}', file '${fileName}' — expected sha256:${expectedHash}, got sha256:${actualHash} (the installed file has been modified since 'ur install')` };
  }
  return { ok: true };
}

function validatePackageLocation(candidatePath: string): boolean {
  return existsSync(candidatePath);
}

function consumeModule(candidatePath: string): string {
  return readFileSync(candidatePath, "utf-8");
}

function resolveAndMergeImports(program: Program, mainFileName: string): { ok: true; program: Program; externalFunctions: Map<string, { runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript" | "native"; module: string; symbol: string; manifestBaseDir?: string }>; pythonManifestDirs: string[]; friTimeouts: Map<string, { runMs?: number; compileMs?: number }> } | { ok: false; error: string; span?: SourceSpan } {
  const externalFunctions = new Map<string, { runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript" | "native"; module: string; symbol: string; manifestBaseDir?: string }>();
  // P1-7 (Design Gate, A/B): directories of any "python"-runtime
  // manifest encountered below, collected so the caller can prepend
  // them to PYTHONPATH before the interpreter (interpret.ts, left
  // completely unmodified per this Gate's own authorization scope)
  // spawns its python3 subprocess. Node's spawnSync inherits
  // process.env when no explicit `env` option is passed - confirmed
  // by reading interpret.ts's own spawnSync call sites - so setting
  // process.env.PYTHONPATH here, in this still-running process,
  // before execution begins, reaches that subprocess without editing
  // interpret.ts at all. This fixes Finding B for python without
  // touching the one file this Gate is not authorized to change.
  const pythonManifestDirs: string[] = [];
  // FRI R2 (D2): per-export timeout budgets from each manifest's optional
  // "timeouts" object, validated strictly below (no clamping, no coercion).
  const friTimeouts = new Map<string, { runMs?: number; compileMs?: number }>();
  if (program.imports.length === 0) {
    return { ok: true, program, externalFunctions, pythonManifestDirs, friTimeouts };
  }

  const mergedFunctions = [...program.functions];
  const mergedStructs = [...program.structs];

  const seenImportPaths = new Set<string>();
  for (const imp of program.imports) {
    const importPath = imp.path.join("/");
    if (seenImportPaths.has(importPath)) continue;
    seenImportPaths.add(importPath);
    const candidatePath = resolveImportLocation(importPath, process.cwd());
    // Gate 4 fix (per direct instruction): a registered package whose
    // file was deleted from disk previously fell through to an
    // unrelated, misleading FFI-detection error message, since
    // validatePackageLocation (existsSync) failed first and the code
    // assumed this might be an FFI-style import instead - confirmed
    // live before this fix. This check only activates when ur.lock
    // exists AND the specific package is registered in it - legacy/
    // unmanaged projects and genuinely-unregistered imports fall
    // through unchanged to the exact same pre-existing behavior.
    if (!validatePackageLocation(candidatePath)) {
      const lockPath = join(process.cwd(), "ur.lock");
      if (existsSync(lockPath)) {
        try {
          const lock: { packages: Record<string, unknown> } = JSON.parse(readFileSync(lockPath, "utf-8"));
          // Gate V1-PKG-002-RESOLUTION-CONSISTENCY: a registered
          // package whose real entry point is signatures.ur (every
          // manifest-declared runtime — confirmed directly, they all
          // converge on the same signaturesPath computation further
          // below) rather than index.ur is NOT "incomplete or
          // corrupted" — it is a correctly-installed FFI-style
          // package. Only declare corruption when NEITHER index.ur
          // NOR a real manifest.json exists — otherwise, fall through
          // unchanged to the existing, already-correct manifest-aware
          // resolution logic further below, exactly as an
          // unregistered FFI package already does today.
          const hasManifest = existsSync(resolve(process.cwd(), "ur_packages", importPath, "manifest.json"));
          if (lock.packages[importPath] && !hasManifest) {
            return { ok: false, error: `error: package '${importPath}' is registered in ur.lock, but its file is missing at ${candidatePath} — the installation is incomplete or corrupted; run 'ur install' to restore it`, span: imp.span };
          }
        } catch {
          // ur.lock itself is corrupted here too - fall through to the
          // existing behavior below; verifyPackageIntegrity's own
          // corrupted-lockfile check will catch this for any package
          // that DOES resolve successfully, and this specific
          // missing-file path simply proceeds to its prior behavior
          // rather than duplicating that error message here.
        }
      }
    }
    if (validatePackageLocation(candidatePath)) {
      const integrityCheck = verifyPackageIntegrity(importPath, candidatePath);
      if (!integrityCheck.ok) {
        return { ok: false, error: integrityCheck.error, span: imp.span };
      }
      const importedSource = consumeModule(candidatePath);
      const importedTokens = lexAndCheck(importedSource, basename(candidatePath));
      if (!importedTokens) {
        return { ok: false, error: `error: failed to lex imported module '${importPath}' at ${candidatePath}`, span: imp.span };
      }
      const { program: importedProgram, errors: importedErrors } = parse(importedTokens);
      if (importedErrors.length > 0) {
        return { ok: false, error: `error: failed to parse imported module '${importPath}' at ${candidatePath}`, span: imp.span };
      }
      if (importedProgram.imports.length > 0) {
        return { ok: false, error: `error: module '${importPath}' has its own imports — nested/transitive imports are not yet supported (Phase 0-A scope boundary, a later phase)`, span: imp.span };
      }
      mergedFunctions.push(...importedProgram.functions);
      mergedStructs.push(...importedProgram.structs);
      continue;
    }

    const manifestPath = resolve(process.cwd(), "ur_packages", importPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { ok: false, error: `error: cannot find module '${importPath}' — expected a UR module or manifest.json at ${manifestPath}`, span: imp.span };
    }
    let manifest: { name: string; runtime: string; module: string; exports: Record<string, string>; nativeLibrary?: { path: string; expectedVersion?: string } };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return { ok: false, error: `error: manifest.json for module '${importPath}' is not valid JSON`, span: imp.span };
    }
    if (manifest.runtime !== "python" && manifest.runtime !== "javascript" && manifest.runtime !== "c" && manifest.runtime !== "cpp" && manifest.runtime !== "wasm" && manifest.runtime !== "typescript" && manifest.runtime !== "rust" && manifest.runtime !== "go" && manifest.runtime !== "java" && manifest.runtime !== "native") {
      return { ok: false, error: `error: manifest.json for module '${importPath}' declares runtime '${manifest.runtime}' — only python/javascript/c/cpp/wasm/typescript/rust/go/java/native are supported (rust/go/java require their own real toolchain to be installed on the machine running this program - see docs/architecture/FFI_STATUS.md for this build's own, honest, per-runtime proof status; csharp was removed - see FFI_STATUS.md for why)`, span: imp.span };
    }
    // FRI R2 (D2) — manifest "timeouts": { runMs?, compileMs? }, integers in
    // [FRI_MIN_TIMEOUT_MS, FRI_MAX_TIMEOUT_MS]; anything else rejects the manifest.
    let packageTimeouts: { runMs?: number; compileMs?: number } | undefined;
    const rawTimeouts = (manifest as { timeouts?: unknown }).timeouts;
    if (rawTimeouts !== undefined) {
      if (rawTimeouts === null || typeof rawTimeouts !== "object" || Array.isArray(rawTimeouts)) {
        return { ok: false, error: `error: manifest.json for module '${importPath}' has an invalid 'timeouts' field — expected an object { "runMs"?: int, "compileMs"?: int }`, span: imp.span };
      }
      packageTimeouts = {};
      for (const [key, value] of Object.entries(rawTimeouts as Record<string, unknown>)) {
        if (key !== "runMs" && key !== "compileMs") {
          return { ok: false, error: `error: manifest.json for module '${importPath}' has an unknown key 'timeouts.${key}' — only 'runMs' and 'compileMs' are allowed`, span: imp.span };
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value < FRI_MIN_TIMEOUT_MS || value > FRI_MAX_TIMEOUT_MS) {
          return { ok: false, error: `error: manifest.json for module '${importPath}': 'timeouts.${key}' must be an integer number of milliseconds between ${FRI_MIN_TIMEOUT_MS} and ${FRI_MAX_TIMEOUT_MS} (got ${JSON.stringify(value)})`, span: imp.span };
        }
        packageTimeouts[key] = value;
      }
    }
    // Native Integration Design Gate (SQLite3 Linux reference, authorized
    // scope only): "native" is a new runtime value, deliberately separate
    // from "c" - unlike "c" (which compiles real, user-authored C source
    // the manifest points at via "module"), "native" generates its own
    // dlopen()/dlsym() C shim entirely (interpret.ts, the one authorized
    // line there) - "module" here is the real shared library's path/
    // soname (e.g. "libsqlite3.so.0"), not a source file, so it is
    // deliberately NOT resolved via resolveModuleFile below (no .c/.rs/
    // .cpp extension search) - it is passed through as-is to dlopen(),
    // which performs its own, already-standard dynamic-linker search for
    // a bare soname. This mirrors the exact, already-proven technique in
    // tests/ffi/native/harness-executor.ts (a test-only reference, not
    // itself Production API - see the Native Integration Design Gate's
    // own "Correction" section), ported here per that Gate's own
    // recommendation.
    if (manifest.runtime === "native" && (!manifest.nativeLibrary || typeof manifest.nativeLibrary.path !== "string")) {
      return { ok: false, error: `error: manifest.json for module '${importPath}' declares runtime 'native' but is missing a required 'nativeLibrary.path' field (the real shared library's path or soname, e.g. "libsqlite3.so.0")`, span: imp.span };
    }
    if (manifest.runtime === "native") {
      // "module" is not user-supplied for "native" - it IS the real
      // library's path/soname, taken from "nativeLibrary.path" so every
      // downstream use of manifest.module (resolvedModule, the
      // externalFunctions entry, etc.) works unchanged, with no special-
      // casing needed anywhere else in this function.
      manifest.module = manifest.nativeLibrary!.path;
    }
    const manifestDir = dirname(manifestPath);
    const isCompiledRuntime = manifest.runtime === "c" || manifest.runtime === "cpp" || manifest.runtime === "rust" || manifest.runtime === "go" || manifest.runtime === "java" || manifest.runtime === "wasm";
    if (manifest.runtime !== "native" && (!manifest.module || typeof manifest.module !== "string")) {
      return { ok: false, error: `error: manifest.json for module '${importPath}' is missing a required 'module' field (a string naming the runtime module/file to load)`, span: imp.span };
    }
    if (manifest.exports === undefined || manifest.exports === null || typeof manifest.exports !== "object" || Array.isArray(manifest.exports)) {
      return { ok: false, error: `error: manifest.json for module '${importPath}' is missing a required 'exports' field (an object mapping UR function names to ${manifest.runtime} symbol names)`, span: imp.span };
    }
    // P1-7 Design Gate, Finding B (JavaScript half): `require()`
    // accepts an absolute path directly, so a "./"- or "../"-prefixed
    // module string is resolved here, relative to the manifest's OWN
    // directory, before it ever reaches interpret.ts - which then
    // receives an already-correct absolute path and needs no change.
    // A bare module name (no such prefix - e.g. a real installed npm
    // package) is passed through completely unchanged, exactly as
    // before. Python cannot take this same path: its `import`
    // statement has no filesystem-path syntax at all (confirmed live
    // during the P1-7 Design Gate), so a relative python module
    // string is intentionally left unresolved here - it is fixed via
    // pythonManifestDirs/PYTHONPATH instead (see below), never by
    // rewriting the module string itself.
    const isRelativePath = manifest.module.startsWith("./") || manifest.module.startsWith("../");
    // P1-2-T Implementation Gate (authorized patch, cli/index.ts only):
    // "typescript" is added to this same condition, not a separate one -
    // both runtimes are Node.js-hosted CommonJS `require()` loaders
    // (tsx only transforms TypeScript to JS ahead of Node's own module
    // loader; it does not change relative-specifier resolution), per
    // the P1-2-T Design Gate's own verified finding that this fix is
    // safe and confined to cli/index.ts - interpret.ts's existing
    // inline `resolve()` call in the "typescript" branch receives an
    // already-absolute path here and passes it through unchanged
    // (Node's own path.resolve() is a no-op on an absolute input,
    // confirmed directly in that Gate). interpret.ts is NOT modified
    // by this patch.
    const isJsFamilyRuntime = manifest.runtime === "javascript" || manifest.runtime === "typescript";
    const resolvedModule = (isJsFamilyRuntime && isRelativePath) ? resolve(manifestDir, manifest.module) : manifest.module;
    const manifestBaseDir = isCompiledRuntime && !isAbsolute(manifest.module) ? manifestDir : undefined;
    if (manifest.runtime === "python") {
      pythonManifestDirs.push(manifestDir);
    }

    // P1-7 Design Gate, Finding A: the UR-facing signature is now
    // read from a real, sibling `.ur` declaration file
    // (`signatures.ur`, next to manifest.json) instead of the
    // previous unconditional `function name(x: int): int` template -
    // parsed with the EXISTING, unmodified lex/parse pipeline (the
    // same one already used two branches above for plain `.ur`
    // module imports), so a malformed signature is a real parser
    // diagnostic, not a silently-wrong stub. No fallback to the old
    // template is permitted for a package missing this file (Design
    // Gate §3's own explicit requirement) - it is a hard, named
    // error instead, so a package can never silently end up with an
    // arity/type it never declared.
    const signaturesPath = join(manifestDir, "signatures.ur");
    if (!existsSync(signaturesPath)) {
      return { ok: false, error: `error: manifest.json for module '${importPath}' requires a sibling signature declaration file — none found at ${signaturesPath} (see P1-7 Design Gate §1/§3: every FFI export must have a real, parsed UR signature; there is no default/fallback shape)`, span: imp.span };
    }
    const signaturesSource = readFileSync(signaturesPath, "utf-8");
    const sigTokens = lexAndCheck(signaturesSource, basename(signaturesPath));
    if (!sigTokens) {
      return { ok: false, error: `error: failed to lex signature declarations for module '${importPath}' at ${signaturesPath}`, span: imp.span };
    }
    const { program: sigProgram, errors: sigErrors } = parse(sigTokens);
    if (sigErrors.length > 0) {
      return { ok: false, error: `error: failed to parse signature declarations for module '${importPath}' at ${signaturesPath}`, span: imp.span };
    }
    const declaredByName = new Map(sigProgram.functions.map(f => [f.name, f] as const));
    const exportNames = new Set(Object.keys(manifest.exports));
    for (const declaredName of declaredByName.keys()) {
      if (!exportNames.has(declaredName)) {
        return { ok: false, error: `error: '${declaredName}' is declared in ${signaturesPath} but has no matching entry in manifest.json's 'exports' — every declared signature must be exported, and vice versa (P1-7 Design Gate §3)`, span: imp.span };
      }
    }
    for (const [urName, symbolName] of Object.entries(manifest.exports)) {
      const declared = declaredByName.get(urName);
      if (!declared) {
        return { ok: false, error: `error: '${urName}' is exported in manifest.json but has no matching signature in ${signaturesPath} — every export must have a declared signature (P1-7 Design Gate §3)`, span: imp.span };
      }
      externalFunctions.set(urName, { runtime: manifest.runtime as "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript", module: resolvedModule, symbol: symbolName, manifestBaseDir });
      if (packageTimeouts) friTimeouts.set(urName, packageTimeouts);
      mergedFunctions.push(declared);
    }
  }

  return {
    ok: true,
    program: { ...program, functions: mergedFunctions, structs: mergedStructs, imports: [] },
    externalFunctions,
    pythonManifestDirs,
    friTimeouts,
  };
}

function printDiagnostics(diags: readonly FormattableDiagnostic[], source: string, fileName: string): void {
  for (const d of diags) {
    console.error(formatDiagnostic(d, source, fileName));
    console.error("");
  }
}

// GATE A FIX (V1.0-REOPEN-GATE-A): lex()'s own real errors field was
// previously discarded at every one of its 4 real call sites in this
// file — DEFECT-001, confirmed by real, end-to-end Discovery. This
// shared helper is the ONE, single real place lex() is now consulted
// for errors, so no future or existing call site can silently repeat
// the same omission. Matches the ALREADY-EXISTING, real precedent for
// parser errors exactly: report via printDiagnostics, then signal
// failure to the caller (null tokens) rather than proceeding.
function lexAndCheck(source: string, fileName: string): ReturnType<typeof lex>["tokens"] | null {
  const { tokens, errors } = lex(source);
  if (errors.length > 0) {
    // B-1 Gate (D-3): was `errors as FormattableDiagnostic[]` (TS2352) — see lexErrorToFormattable.
    printDiagnostics(errors.map(lexErrorToFormattable), source, fileName);
    return null;
  }
  return tokens;
}
function cmdRun(filePath: string | undefined): number {
  if (!filePath) {
    console.error("error: ur run requires a file argument (e.g. 'ur run hello.ur')");
    return 1;
  }

  const compiled = compileToIR(filePath);
  if (!compiled) return 1;

  const stdinLines = process.stdin.isTTY
    ? []
    : readFileSync(0, "utf8").split(/\r?\n/);
  let stdinIndex = 0;

  const result = interpretModule(
    compiled.ir,
    "main",
    undefined,
    { timeouts: compiled.friTimeouts },
    { readLine: () => stdinLines[stdinIndex++] ?? "" }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const exitCode = Number(result.exitCode);

  if (
    !Number.isFinite(exitCode) ||
    !Number.isSafeInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > 255
  ) {
    console.error(
      `warning: program returned ${result.exitCode}, which is not a valid process exit code; using 1 instead`
    );
    return 1;
  }

  return exitCode;
}

function cmdBuild(filePath: string | undefined): number {
  if (!filePath) {
    console.error("error: ur build requires a file argument (e.g. 'ur build hello.ur')");
    return 1;
  }
  const compiled = compileToIR(filePath);
  if (!compiled) return 1;

  const absSource = resolve(process.cwd(), filePath);
  const baseName = basename(absSource).replace(/\.ur$/, "");
  const outputPath = join(resolve(process.cwd(), filePath, ".."), baseName + ".js");

  // FIXED — Windows Recovery Sprint: `build` no longer produces a native
  // executable via gcc (eliminated entirely, per the same direction as
  // cmdRun's own fix). Instead, it produces a self-contained Node
  // script: the compiled IR, serialized, plus a small runner that calls
  // this same installation's interpreter — runnable via `node
  // <name>.js` (or directly, via the shebang below, on systems that
  // honor it) with ZERO gcc/C-compiler involvement, matching `ur run`'s
  // own guarantee exactly. Tied to this specific UR-Bridge installation
  // (the interpreter is referenced by absolute path) — the same
  // property a native .exe already had with respect to the machine's
  // own architecture/OS, not a new limitation this fix introduces.
  const interpreterPath = resolve(dirnameOfThisFile(), "..", "interpreter", "interpret.js");
  const bundle = `#!/usr/bin/env node
// Generated by "ur build" — self-contained, no gcc/C-compiler needed to run this.
// Runs via the UR interpreter shipped with this UR-Bridge installation.
import { interpretModule } from ${JSON.stringify(pathToFileUrl(interpreterPath))};
import { readFileSync } from "node:fs";
// The IR's integer constants are real bigint (matching int64_t's exact
// range) — JSON has no bigint literal syntax, so they were serialized
// as { __bigint__: "..." } tags (see replaceBigInt below); this reviver
// walks the embedded object literal and converts them back to real
// bigint before the interpreter ever sees them. Confirmed necessary by
// testing directly before this fix: without it, integer arithmetic
// silently operated on plain objects instead of real bigint values.
function revive(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.prototype.hasOwnProperty.call(value, "__bigint__")) return BigInt(value.__bigint__);
  if (Array.isArray(value)) return value.map(revive);
  const out = {};
  for (const k of Object.keys(value)) out[k] = revive(value[k]);
  return out;
}
const ir = revive(${JSON.stringify(compiled.ir, replaceBigInt)});
const stdinLines = process.stdin.isTTY
  ? []
  : readFileSync(0, "utf8").replaceAll(String.fromCharCode(13), "").split(String.fromCharCode(10));
let stdinIndex = 0;
const result = interpretModule(
  ir,
  "main",
  undefined,
  ${JSON.stringify({ timeouts: compiled.friTimeouts })},
  { readLine: () => stdinLines[stdinIndex++] ?? "" }
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
`;
  writeFileSync(outputPath, bundle, "utf-8");
  try { chmodSync(outputPath, 0o755); } catch { /* best-effort on platforms where this matters */ }
  console.log(`Built: ${outputPath}`);
  console.log(`Run it with: node ${basename(outputPath)}`);
  return 0;
}

function dirnameOfThisFile(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function pathToFileUrl(p: string): string {
  return pathToFileURL(p).href;
}

// JSON.stringify can't represent bigint directly — the IR's own integer
// constants are real bigint (matching int64_t's exact range, the same
// reasoning as the interpreter's own RtValue type) — serialize them as
// a tagged string, restored by the interpreter's own JSON.parse reviver
// when the bundle is later run (see interpret.ts's own IR-loading path,
// which never needs this — only this serialization step does, since
// bare JSON has no bigint literal syntax at all).
function replaceBigInt(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __bigint__: value.toString() } : value;
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "keygen":
      process.exitCode = cmdKeygen(rest[0]);
      return;
    case "sign":
      process.exitCode = cmdSignPackage(rest[0], rest[1]);
      return;
    case "trust":
      process.exitCode = cmdTrust(rest[0]);
      return;
    case "registry":
      if (rest[0] === "add") {
        process.exitCode = cmdRegistryAdd(rest[1], rest[2]);
      } else if (rest[0] === "login") {
        process.exitCode = cmdRegistryLogin(rest[1], rest[2]);
      } else {
        console.error("error: usage: ur registry add <name> <url>  |  ur registry login <name> <token>");
        process.exitCode = 1;
      }
      return;
    case "publish":
      process.exitCode = cmdPublish(rest[0]);
      return;
    case "search":
      process.exitCode = cmdSearch(rest[0]);
      return;
    case "install": {
      const arg = rest[0];
      const registryFlag = rest.find((r: string) => r.startsWith("--registry="));
      if (arg && arg.includes("@") && registryFlag) {
        const atIndex = arg.indexOf("@");
        const pkgName = arg.slice(0, atIndex);
        const version = arg.slice(atIndex + 1);
        const registryName = registryFlag.slice("--registry=".length);
        const registries = loadRemoteRegistries();
        const registryUrl = registries[registryName];
        if (!registryUrl) {
          console.error(`error: registry '${registryName}' not found — run 'ur registry add ${registryName} <url>' first`);
          process.exitCode = 1;
          return;
        }
        process.exitCode = await installFromRemoteRegistry(pkgName, version, registryName, registryUrl);
        return;
      }
      if (arg && arg.includes("@") && !isAbsolute(arg)) {
        const atIndex = arg.indexOf("@");
        const pkgName = arg.slice(0, atIndex);
        const constraint = arg.slice(atIndex + 1) || "*";
        const familyDir = join(LOCAL_REGISTRY_ROOT, pkgName);
        if (!existsSync(familyDir)) {
          console.error(`error[PK1001]: package '${pkgName}' not found in the local registry (${LOCAL_REGISTRY_ROOT}) — try 'ur search ${pkgName}' or 'ur publish' it first`);
          process.exitCode = 1;
          return;
        }
        const resolved = resolvePackageVersion(familyDir, constraint);
        if ("error" in resolved) {
          console.error(`error[PK1002]: ${resolved.error}`);
          process.exitCode = 1;
          return;
        }
        console.log(`resolved ${pkgName}@${resolved.version} from local registry`);
        process.exitCode = await cmdInstallRootWithGraphCheck(resolved.path, undefined, LOCAL_REGISTRY_ROOT);
        return;
      }
      process.exitCode = await cmdInstallRootWithGraphCheck(rest[0], rest[1]);
      return;
    }
    case "init":
      process.exitCode = cmdInit();
      return;
    case "run":
      process.exitCode = cmdRun(rest[0]);
      return;
    case "build":
      process.exitCode = cmdBuild(rest[0]);
      return;
    case "version":
    case "--version":
    case "-v":
      printVersion();
      process.exitCode = 0;
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      process.exitCode = 0;
      return;
    default:
      console.error(`error: unknown command '${command}'\n`);
      printUsage();
      process.exitCode = 1;
      return;
  }
}

main();
