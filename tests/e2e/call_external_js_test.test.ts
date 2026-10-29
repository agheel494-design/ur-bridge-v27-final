import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // RB3-TEST-REALIGNMENT (DR-RB3-02): capture stderr on success too - it is the diagnostics channel.
  const r = spawnSync(process.execPath, [TSX_CLI, CLI_PATH, ...args], { cwd, encoding: "utf-8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}


// RB3-TEST-REALIGNMENT - DR-RB3-02 (APPROVED): foreign stdout is NOT a UR result channel (it is routed to UR
// stderr as diagnostics); results travel only on the typed result channel (UR_FRI_RESULT_PATH).
// DR-RB3-03 (APPROVED; PM rulings R1-Q1/R1-Q2): call_external is int-only. A non-int result is rejected with a
// typed panic that carries the EXACT produced value - that typed-channel value is the oracle used below.
function expectTypedResult(r: { exitCode: number; stderr: string }, kind: "string" | "other", producedValue: string): void {
  expect(r.exitCode).toBe(101);
  expect(r.stderr).toContain(`declared return type 'int' but produced ${kind} ${JSON.stringify(producedValue)}`);
}
function noExecutedLine(r: { stdout: string; stderr: string }, marker: string): void {
  // an executed injection (console.log / print) would emit the marker as its OWN line on stdout or stderr
  expect(r.stdout.split(/\r?\n/).includes(marker)).toBe(false);
  expect(r.stderr.split(/\r?\n/).includes(marker)).toBe(false);
}

function run(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "ur-jsbug-"));
  try {
    writeFileSync(join(dir, "test.ur"), src);
    return runCli(dir, ["run", "test.ur"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("JavaScript Bridge bug fixes: Global Objects vs modules, non-numeric args, array literals", () => {
  it("Bug 1 fix: call_external('javascript','Math','sqrt',25) = 5 (Math is a Global Object, not require()'d)", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"Math\", \"sqrt\", 25)\n  return x\nend\n");
    expect(result.exitCode).toBe(5);
  });

  it("[DR-RB3-02/03] Date.now() returns a real, full timestamp through the typed int result channel (formerly: read from stdout)", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"Date\", \"now\")\n  if x > 1000000000000\n    return 1\n  end\n  return 0\nend\n");
    expect(result.exitCode).toBe(1);
  });

  it("[DR-RB3-02/03] Bug 3 fix: an array literal argument reaches JSON.stringify intact - verified on the typed result channel (formerly: stdout)", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"JSON\", \"stringify\", [\"a\", \"b\", 1])\n  return x\nend\n");
    expectTypedResult(result, "string", '["a","b",1]');
  });

  it("[DR-RB3-02/03] Bug 2 fix: a non-numeric string argument (fs.readdirSync('.')) works and lists real files - verified on the typed result channel", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"fs\", \"readdirSync\", \".\")\n  return x\nend\n");
    expect(result.exitCode).toBe(101);
    expect(result.stderr).toContain("declared return type 'int' but produced other");
    expect(result.stderr).toContain('\\"test.ur\\"');
  });

  it("[DR-RB3-02/03] os.platform() (a real Node built-in module) returns the real platform string - verified on the typed result channel", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"os\", \"platform\")\n  return x\nend\n");
    expectTypedResult(result, "string", process.platform);
  });

  it("[DR-RB3-03] zero-argument call_external still works (Date.now takes none; int result - formerly Math.random, whose float result is rejected by R1-Q2)", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"Date\", \"now\")\n  return 0\nend\n");
    expect(result.exitCode).toBe(0);
  });
});

describe("JavaScript Bridge: escaped quotes and Unicode arguments (per direct review request)", () => {
  it("[DR-RB3-02/03] a string argument containing an escaped quote does not break the generated script - exact value on the typed result channel", () => {
    const result = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["a\\"b"])\n  return x\nend\n');
    expectTypedResult(result, "string", JSON.stringify(['a"b']));
  });

  it("[DR-RB3-02/03] Unicode string arguments (Arabic, Chinese, Hindi) are preserved exactly - exact value on the typed result channel", () => {
    const result = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["مرحبا", "你好", "नमस्ते"])\n  return x\nend\n');
    expectTypedResult(result, "string", JSON.stringify(["مرحبا", "你好", "नमस्ते"]));
  });
});

describe("[DR-RB3-02] Manifest-based imports return results on the typed channel; foreign values are NOT printed to UR stdout", () => {
  it("[DR-RB3-02/03/04] import pymath -> sqrtFn(81) returns 9 on the typed channel (int via math.isqrt) and prints nothing to UR stdout (formerly: '9.0' expected on stdout)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-stdout-scope-"));
    try {
      mkdirSync(join(dir, "ur_packages", "pymath"), { recursive: true });
      // DR-RB3-03: float -> int is rejected (R1-Q2), so the int-returning math.isqrt is used.
      writeFileSync(join(dir, "ur_packages", "pymath", "manifest.json"), JSON.stringify({ name: "pymath", runtime: "python", module: "math", exports: { sqrtFn: "isqrt" } }));
      // DR-RB3-04: a sibling signatures.ur is mandatory (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "pymath", "signatures.ur"), "function sqrtFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import pymath\n\nfunction main(): int\n  return sqrtFn(81)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(9);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
