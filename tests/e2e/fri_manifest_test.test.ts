import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, CLI_PATH, ...args], { cwd, encoding: "utf-8" });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
  }
}

describe("FRI: real end-to-end external library call via manifest.json (Python)", () => {
  it("English: import mathlib -> sqrtFn(81) calls real Python math.sqrt via manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-fri-en-"));
    try {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      // DR-RB3-03 (R1-Q2: float -> int rejected): math.isqrt is the int-returning equivalent of math.sqrt.
      writeFileSync(join(dir, "ur_packages", "mathlib", "manifest.json"), JSON.stringify({ name: "mathlib", runtime: "python", module: "math", exports: { sqrtFn: "isqrt" } }));
      // DR-RB3-05 (P1-7 Finding B): a "./"-relative JS/TS module resolves relative to the manifest's OWN directory.
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "mathlib", "signatures.ur"), "function sqrtFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import mathlib\n\nfunction main(): int\n  return sqrtFn(81)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(9);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Arabic: استورد رياضيات -> جذر(25) calls real Python math.sqrt via manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-fri-ar-"));
    try {
      mkdirSync(join(dir, "ur_packages", "رياضيات"), { recursive: true });
      // DR-RB3-03 (R1-Q2: float -> int rejected): math.isqrt is the int-returning equivalent of math.sqrt.
      writeFileSync(join(dir, "ur_packages", "رياضيات", "manifest.json"), JSON.stringify({ name: "رياضيات", runtime: "python", module: "math", exports: { "جذر": "isqrt" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "رياضيات", "signatures.ur"), "function جذر(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "استورد رياضيات\n\nدالة main(): عدد\n  أرجع جذر(25)\nنهاية\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("unsupported runtime in manifest produces a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-fri-badrt-"));
    try {
      mkdirSync(join(dir, "ur_packages", "x"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "x", "manifest.json"), JSON.stringify({ name: "x", runtime: "perl", module: "m", exports: { f: "g" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "x", "signatures.ur"), "function f(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import x\n\nfunction main(): int\n  return 0\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("perl");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("FRI: multi-call reuse and a second backend (JavaScript), per independent review request", () => {
  it("multiple external calls with variable reuse (3x sqrt, summed) produce the correct result", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-fri-multi-"));
    try {
      mkdirSync(join(dir, "ur_packages", "m"), { recursive: true });
      // DR-RB3-03 (R1-Q2: float -> int rejected): math.isqrt is the int-returning equivalent of math.sqrt.
      writeFileSync(join(dir, "ur_packages", "m", "manifest.json"), JSON.stringify({ name: "m", runtime: "python", module: "math", exports: { sq: "isqrt" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "m", "signatures.ur"), "function sq(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import m\n\nfunction main(): int\n  let a = sq(25)\n  let b = sq(81)\n  let c = sq(144)\n  return a + b + c\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(26);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a SECOND, different backend (JavaScript, via a real .js module and require()) works through the same manifest.json design", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-fri-js-"));
    try {
      mkdirSync(join(dir, "ur_packages", "jsmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "jsmath", "mathlib.js"), "module.exports.cube = function(x) { return x * x * x; };\n");
      writeFileSync(join(dir, "ur_packages", "jsmath", "manifest.json"), JSON.stringify({ name: "jsmath", runtime: "javascript", module: "./mathlib.js", exports: { cubeFn: "cube" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "jsmath", "signatures.ur"), "function cubeFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import jsmath\n\nfunction main(): int\n  return cubeFn(3)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(27);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("FRI: call_external(...) builtin syntax, per direct request", () => {
  it("[DR-RB3-03] the independent review's case, realigned to the int contract (R1-Q1/R1-Q2): call_external('python','math','isqrt',25) = 5", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-callext-"));
    try {
      writeFileSync(join(dir, "test-python.ur"), "function main(): int\n  let x = call_external(\"python\", \"math\", \"isqrt\", 25)\n  return x\nend\n");
      const result = runCli(dir, ["run", "test-python.ur"]);
      expect(result.exitCode).toBe(5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
