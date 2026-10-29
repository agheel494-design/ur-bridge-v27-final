import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
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
  const dir = mkdtempSync(join(tmpdir(), "ur-attack-"));
  try {
    writeFileSync(join(dir, "test.ur"), src);
    return runCli(dir, ["run", "test.ur"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("SECURITY FIX: call_external arguments travel via real argv + JSON.parse/json.loads, never spliced into executed script text", () => {
  it("[DR-RB3-02] JavaScript: a malicious string argument attempting to break out of quoting does NOT execute - it arrives as data (exact value on the typed result channel) and no PWNED line is ever emitted", () => {
    const result = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["\\";console.log(\'PWNED\');//"])\n  return x\nend\n');
    expectTypedResult(result, "string", JSON.stringify(['";console.log(\'PWNED\');//']));
    noExecutedLine(result, "PWNED");
  });

  it("Python: a malicious string argument attempting os.system('touch <marker file>') does NOT execute it - the marker file is never created", () => {
    const markerPath = join(tmpdir(), `ur-attack-marker-${Date.now()}.txt`);
    if (existsSync(markerPath)) rmSync(markerPath);
    try {
      const result = run(`function main(): int\n  let x = call_external("python", "json", "dumps", ["\\";import os;os.system('touch ${markerPath}');//"])\n  return x\nend\n`);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      if (existsSync(markerPath)) rmSync(markerPath);
    }
  });

  it("[DR-RB3-02] all special shell/code characters together (`, $, backslash, quotes, ;, &&, ||) are preserved as literal data - exact value on the typed result channel", () => {
    const result = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["`$\\\\\'\\";&&||"])\n  return x\nend\n');
    expectTypedResult(result, "string", JSON.stringify(["`$\\'\";&&||"]));
  });

  it("a malformed (non-JSON) argument is rejected with a clear compile error, never reaching a subprocess", () => {
    const result = run("function main(): int\n  let x = call_external(\"javascript\", \"Math\", \"abs\", notValidJson)\n  return x\nend\n");
    expect(result.exitCode).not.toBe(0);
  });

  it("[DR-RB3-02/03] REGRESSION: legitimate numeric/array/string arguments still work correctly after the security fix", () => {
    const r1 = run('function main(): int\n  let x = call_external("javascript", "Math", "sqrt", 25)\n  return x\nend\n');
    expect(r1.exitCode).toBe(5);
    const r2 = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["a", "b", 1])\n  return x\nend\n');
    expectTypedResult(r2, "string", '["a","b",1]');
  });
});

describe("Bug-002 (independent Windows review): distinguishing intended FFI capability from an actual injection bypass", () => {
  it("[DR-RB3-02] os.system() called deliberately with a valid string argument executes normally (intended FFI capability): its output arrives on UR stderr (the diagnostics channel), never on UR stdout", () => {
    const result = run('function main(): int\n  let x = call_external("python", "os", "system", "echo PWNED_TEST_MARKER")\n  return x\nend\n');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("PWNED_TEST_MARKER");
    expect(result.stdout).not.toContain("PWNED_TEST_MARKER");
  });

  it("[DR-RB3-02] REGRESSION CONFIRMATION: the injection vulnerability remains fixed - the payload arrives as exact data and INJECTION_MARKER is never emitted as an executed line", () => {
    const result = run('function main(): int\n  let x = call_external("javascript", "JSON", "stringify", ["\\";console.log(\'INJECTION_MARKER\');//"])\n  return x\nend\n');
    expectTypedResult(result, "string", JSON.stringify(['";console.log(\'INJECTION_MARKER\');//']));
    noExecutedLine(result, "INJECTION_MARKER");
  });
});

describe("[DR-RB3-02] security oracle (replacement for the stdout-based checks): data arrival + no execution", () => {
  it("Python: a breakout payload arrives as exact data (len() of the literal string) and its os.system() never runs", () => {
    const payload = "\";import os;os.system('echo PWNED');//";
    const result = run('function main(): int\n  let x = call_external("python", "builtins", "len", "\\";import os;os.system(\'echo PWNED\');//")\n  return x\nend\n');
    expect(result.exitCode).toBe([...payload].length);
    noExecutedLine(result, "PWNED");
  });
});
