// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: FFI (fn.external) Contract Protection
// ─────────────────────────────────────────────────────────────────────────────
//
// Real, black-box, subprocess-level tests protecting the real, existing
// fn.external FFI contract, matching this project's own established real
// CLI test pattern (tests/cli/cli.test.ts). Every assertion here was
// verified against real, observed behavior BEFORE being written — none
// are assumptions.
//
// Correction, disclosed honestly: an earlier report described fn.external
// as "tested live successfully" based only on observing a clean UrPanic
// on a failure case - not a real success case. This file adds the missing
// real success-case evidence, and documents the real, correct convention
// discovered while probing it. SUPERSEDED (RB3-TEST-REALIGNMENT, DR-RB3-05 = P1-7 Finding B): a "./"- or
// "../"-relative javascript/typescript `module` is now resolved relative to
// the manifest's OWN directory (not cwd); a bare module name is unchanged.
// Python modules are made importable via the manifest directory on PYTHONPATH.
//
// Also documented: each successful external call emits a real, observed
// side effect - a console.log line on the child process's own stdout,
// from the generated wrapper script itself - independent of the UR
// program's own explicit print statements.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
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
  const dir = mkdtempSync(join(tmpdir(), "ur-ffi-boundary-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("FFI (fn.external) Contract Protection", () => {

  it("REQUIRED 1: successful FFI call -> real, correct value returned", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mymath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mymath", "manifest.json"), JSON.stringify({
        name: "mymath", runtime: "javascript",
        // Real, observed convention: relative to cwd, not to manifest.json's own dir.
        module: "./mymath.js",
        exports: { double: "double" },
      }));
      // DR-RB3-05 (P1-7 Finding B): a "./"-relative JS/TS module resolves relative to the manifest's OWN directory.
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mymath", "signatures.ur"), "function double(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "mymath", "mymath.js"), "export function double(x) { return x * 2; }\n");
      writeFileSync(join(dir, "main.ur"), "import mymath\n\nfunction main(): int\n  return double(21)\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(42);
    });
  });

  it("REQUIRED 2: FFI to a nonexistent module -> clean UrPanic, not a raw crash", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "nomod"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "nomod", "manifest.json"), JSON.stringify({
        name: "nomod", runtime: "javascript", module: "./does_not_exist_at_all.js", exports: { f: "f" },
      }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "nomod", "signatures.ur"), "function f(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "main.ur"), "import nomod\n\nfunction main(): int\n  return f(1)\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(101);
      // DR-RB3-05 (R2 structured failure contract): the panic carries the typed prefix FRI_FAILED:
      expect(result.stderr).toContain("UR panic: FRI_FAILED: external call 'f'");
    });
  });

  it("REQUIRED 3: external function name maps to a symbol that does not exist in the real target module -> clean UrPanic", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mymath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mymath", "mymath.js"), "export function double(x) { return x * 2; }\n");
      writeFileSync(join(dir, "ur_packages", "mymath", "manifest.json"), JSON.stringify({
        name: "mymath", runtime: "javascript", module: "./mymath.js",
        exports: { nonexistentFn: "doesNotExistInJs" },
      }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mymath", "signatures.ur"), "function nonexistentFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mymath\n\nfunction main(): int\n  return nonexistentFn(5)\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(101);
      // DR-RB3-05 (R2 structured failure contract): the panic carries the typed prefix FRI_FAILED:
      expect(result.stderr).toContain("UR panic: FRI_FAILED: external call 'nonexistentFn'");
    });
  });

  it("REQUIRED 4: no runtime argument-count/type check exists inside the interpreter itself - a real UR-level type error (undefined function) is caught by TypeCheck, before ever reaching FFI", () => {
    // Per direct instruction: do not assert behavior that was not proven
    // to exist. Probed directly: the interpreter's own real code performs
    // no arg-count/type validation for external calls. The real, observed
    // enforcement point is TypeCheck/Semantic - calling a name with the
    // wrong identity at all fails there, before any external call occurs.
    withTempDir(dir => {
      writeFileSync(join(dir, "main.ur"), "function main(): int\n  return notARealFunction(5)\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain("undefined function");
    });
  });

  it("REQUIRED 5: multiple external calls in the same program each execute correctly and independently", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mymath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mymath", "mymath.js"), "export function double(x) { return x * 2; }\nexport function square(x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "mymath", "manifest.json"), JSON.stringify({
        name: "mymath", runtime: "javascript", module: "./mymath.js",
        exports: { double: "double", square: "square" },
      }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mymath", "signatures.ur"), "function double(x: int): int\n  return 0\nend\nfunction square(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mymath\n\nfunction main(): int\n  return double(3) + square(4)\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(22); // double(3)=6, square(4)=16, 6+16=22
    });
  });

  it("REQUIRED 6: FFI results compose correctly with ordinary local IR (regular function calls/arithmetic) - no interference", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mymath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mymath", "mymath.js"), "export function double(x) { return x * 2; }\n");
      writeFileSync(join(dir, "ur_packages", "mymath", "manifest.json"), JSON.stringify({
        name: "mymath", runtime: "javascript", module: "./mymath.js",
        exports: { double: "double" },
      }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mymath", "signatures.ur"), "function double(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mymath\n\nfunction localAdd(a: int, b: int): int\n  return a + b\nend\n\nfunction main(): int\n  return localAdd(double(3), double(4))\nend\n");
      const result = runCli(["run", "main.ur"], dir);
      expect(result.exitCode).toBe(14); // double(3)=6, double(4)=8, localAdd(6,8)=14
    });
  });
});
