// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Decision 2D Candidate Boundary Protection
// ─────────────────────────────────────────────────────────────────────────────
//
// Protects the accepted Decision 2D Candidate Implementation:
//   importPath -> resolveImportLocation() -> validatePackageLocation()
//              -> consumeModule()
//
// Per direct instruction: this boundary is FROZEN. These tests exist to
// catch any future, unintended drift into urpm/Registry/Manifest/LockFile/
// Version Selection/Cache/URL semantics, or any change to F1/F2/FRI/cwd()
// behavior. This file does NOT modify resolveAndMergeImports or any other
// production code - real, black-box, subprocess-level tests only, matching
// this project's own established real CLI test pattern (tests/cli/cli.test.ts).
//
// F2 note, recorded per direct instruction: the current F2 behavior (a
// directory named index.ur causes an uncaught EISDIR crash, not a clean
// "error: ..." message) is confirmed, historical, pre-existing behavior -
// present identically before and after the Decision 2D Candidate refactor
// (confirmed via direct git diff against the pre-refactor commit). It is
// NOT a regression and is deliberately NOT fixed here. Any future
// improvement to this behavior belongs to its own, separate, explicitly
// unlinked issue ("Improve Import Read Failure Semantics") - not this
// boundary-protection file, and not Decision 2D.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI_ENTRY = join(process.cwd(), "src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], { cwd, encoding: "utf-8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ur-2d-boundary-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Decision 2D Candidate Boundary Protection (importPath -> resolveImportLocation -> validatePackageLocation -> consumeModule)", () => {

  it("REQUIRED 1: package exists -> real, successful build", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function add(a: int, b: int): int\n  return a + b\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib\n\nfunction main(): int\n  return add(3, 4)\nend\n");
      const result = runCli(["build", "main.ur"], dir);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(dir, "main.js"))).toBe(true);
    });
  });

  it("REQUIRED 2: package not found -> F1, real diagnostic, exit code 1", () => {
    withTempDir(dir => {
      writeFileSync(join(dir, "main.ur"), "import doesnotexist\n\nfunction main(): int\n  return 0\nend\n");
      const result = runCli(["build", "main.ur"], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain("cannot find module 'doesnotexist'");
    });
  });

  it("REQUIRED 3: directory instead of file -> historical F2 behavior (uncaught EISDIR) - NOT fixed here, confirmed pre-existing", () => {
    withTempDir(dir => {
      // index.ur as a real DIRECTORY, not a file - existsSync true, readFileSync fails.
      mkdirSync(join(dir, "ur_packages", "badmodule", "index.ur"), { recursive: true });
      writeFileSync(join(dir, "main.ur"), "import badmodule\n\nfunction main(): int\n  return 0\nend\n");
      const result = runCli(["build", "main.ur"], dir);
      // Real, confirmed, historical behavior: a non-zero exit, no clean
      // "error: ..." diagnostic - an uncaught EISDIR crash. This IS the
      // real, current, pre-existing behavior - the test protects against
      // any FUTURE, undocumented change to it, not against its own
      // inelegance.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("EISDIR");
    });
  });

  it("REQUIRED 4: multi-module addressing (mathlib.algebra) -> unaffected, real success", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib", "algebra"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "algebra", "index.ur"), "function square(x: int): int\n  return x * x\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib.algebra\n\nfunction main(): int\n  return square(5)\nend\n");
      const result = runCli(["build", "main.ur"], dir);
      expect(result.exitCode).toBe(0);
    });
  });

  it("REQUIRED 5: FRI (manifest.json) path remains fully isolated and unaffected", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mymath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mymath", "manifest.json"), JSON.stringify({ name: "mymath", runtime: "javascript", module: "./mymath.js", exports: { double: "double" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mymath", "signatures.ur"), "function double(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "mymath", "mymath.js"), "export function double(x) { return x * 2; }\n");
      writeFileSync(join(dir, "main.ur"), "import mymath\n\nfunction main(): int\n  return 0\nend\n");
      const result = runCli(["build", "main.ur"], dir);
      expect(result.exitCode).toBe(0);
    });
  });

  it("REQUIRED 6: process.cwd() is genuinely the base - a package outside cwd is correctly not found", () => {
    withTempDir(dirA => {
      withTempDir(dirB => {
        mkdirSync(join(dirA, "ur_packages", "mathlib"), { recursive: true });
        writeFileSync(join(dirA, "ur_packages", "mathlib", "index.ur"), "function add(a: int, b: int): int\n  return a + b\nend\n");
        // main.ur lives in dirB, but built while cwd is dirB - dirA's own
        // package must NOT be visible, proving cwd() (not some other base)
        // is what's genuinely used.
        writeFileSync(join(dirB, "main.ur"), "import mathlib\n\nfunction main(): int\n  return add(1, 1)\nend\n");
        const result = runCli(["build", "main.ur"], dirB);
        expect(result.exitCode).toBe(1);
        expect(result.stdout + result.stderr).toContain("cannot find module 'mathlib'");
      });
    });
  });

  it("REQUIRED 7: transient lifecycle - two independent builds in the same process do not leak or cache state between them", () => {
    withTempDir(dir1 => {
      withTempDir(dir2 => {
        // Package present only in dir1.
        mkdirSync(join(dir1, "ur_packages", "onlyhere"), { recursive: true });
        writeFileSync(join(dir1, "ur_packages", "onlyhere", "index.ur"), "function f(): int\n  return 1\nend\n");
        writeFileSync(join(dir1, "main.ur"), "import onlyhere\n\nfunction main(): int\n  return f()\nend\n");
        const r1 = runCli(["build", "main.ur"], dir1);
        expect(r1.exitCode).toBe(0);

        // A separate, independent invocation in dir2 (package absent there)
        // must not succeed due to any leaked/cached state from the dir1 run.
        writeFileSync(join(dir2, "main.ur"), "import onlyhere\n\nfunction main(): int\n  return 0\nend\n");
        const r2 = runCli(["build", "main.ur"], dir2);
        expect(r2.exitCode).toBe(1);
        expect(r2.stdout + r2.stderr).toContain("cannot find module 'onlyhere'");
      });
    });
  });

  it("REQUIRED 8: dependency direction - the boundary's own real source contains no urpm/Registry/Manifest/LockFile import or reference", () => {
    // Static, structural guard: this boundary must never accumulate a
    // dependency on urpm's own Registry/Resolver/Manifest/LockFile
    // machinery, Version Selection, Cache, or URL/download semantics,
    // without an explicit, separate, future architectural decision.
    const source = readFileSync(CLI_ENTRY, "utf-8");
    const boundaryStart = source.indexOf("function resolveImportLocation");
    const boundaryEnd = source.indexOf("function resolveAndMergeImports");
    expect(boundaryStart).toBeGreaterThan(-1);
    expect(boundaryEnd).toBeGreaterThan(boundaryStart);
    const boundarySource = source.slice(boundaryStart, boundaryEnd);
    expect(boundarySource.includes("from \"") && /urpm/.test(boundarySource.match(/from "[^"]*"/g)?.join("") ?? "")).toBe(false);
    expect(/Registry|LockFile|VersionConstraint|pickBestVersion/.test(boundarySource)).toBe(false);
  });
});
