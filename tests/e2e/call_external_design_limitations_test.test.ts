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

function run(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "ur-callext-limit-"));
  try {
    writeFileSync(join(dir, "test.ur"), src);
    return runCli(dir, ["run", "test.ur"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("call_external(...): documented, intentional design limitation (per CALL_EXTERNAL_DESIGN_LIMITATIONS.md) - not a bug", () => {
  it("a let-variable argument is rejected with a clear, specific error (not a crash, not silently wrong)", () => {
    const result = run("function main(): int\n  let n = 25\n  let x = call_external(\"python\", \"math\", \"sqrt\", n)\n  return x\nend\n");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not valid JSON literals");
  });

  it("a nested call_external(...) argument is rejected with a clear, specific error", () => {
    const result = run("function main(): int\n  let x = call_external(\"python\", \"math\", \"sqrt\", call_external(\"python\", \"math\", \"pow\", 2, 6))\n  return x\nend\n");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not valid JSON literals");
  });

  it("WORKAROUND, confirmed working: Manifest-based import does NOT share this limitation - a real let-variable works correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-manifest-let-"));
    try {
      mkdirSync(join(dir, "ur_packages", "pymath"), { recursive: true });
      // DR-RB3-03 (R1-Q2: float -> int rejected): math.isqrt is the int-returning equivalent of math.sqrt.
      writeFileSync(join(dir, "ur_packages", "pymath", "manifest.json"), JSON.stringify({ name: "pymath", runtime: "python", module: "math", exports: { sqrtFn: "isqrt" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "pymath", "signatures.ur"), "function sqrtFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import pymath\n\nfunction main(): int\n  let n = 25\n  return sqrtFn(n)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
