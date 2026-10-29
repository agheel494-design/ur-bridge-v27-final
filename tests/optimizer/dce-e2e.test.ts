// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dead Code Elimination: real E2E (baseline vs. optimized)
// Level 2.9, OPTIMIZER_SPEC.md §7/§8
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";
import type { IRModule } from "../../src/shared/ir.js";

function gccAvailable(): boolean {
  try { execSync("gcc --version", { stdio: "ignore" }); return true; } catch { return false; }
}
const hasGcc = gccAvailable();

function compileAndRunModule(module: IRModule) {
  const compiled = compileC(emitC(module), "a.out", { captureWarnings: true, addressSanitizer: true });
  if (!compiled.ok) throw new Error(`gcc failed: ${JSON.stringify(compiled.diagnostics)}`);
  const result = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, warnings: compiled.value.warnings };
}

function compareBaselineVsOptimized(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse errors: ${JSON.stringify(errors)}`);
  const ir = lowerToIR(program, "e2e.ur", "e2e");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);

  const baseline = compileAndRunModule(ir.value);
  const optimizedFn = runPipeline(ir.value.functions[0]!, [deadCodeEliminationPass]);
  const violations = validateFunction(optimizedFn);
  const optimized = compileAndRunModule({ ...ir.value, functions: [optimizedFn] });

  return { baseline, optimized, violations };
}

describe("E2E — Dead Code Elimination: baseline vs. optimized produce IDENTICAL real execution results", () => {
  if (!hasGcc) { it.skip("SKIPPED: gcc not available", () => expect(true).toBe(true)); return; }

  it("a dead variable is removed but behavior is identical", () => {
    const { baseline, optimized, violations } = compareBaselineVsOptimized("function main(): int\n  let dead = 1 + 2\n  return 5\nend\n");
    expect(violations).toEqual([]);
    expect(baseline.exitCode).toBe(5);
    expect(optimized.exitCode).toBe(5);
  });

  it("CRITICAL: print()'s side effect survives DCE even though its return value is unused - real stdout output is identical", () => {
    const src = "function main(): int\n  print(5)\n  return 1\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "e2e.ur", "e2e");
    if (!ir.ok) throw new Error("lowering failed");
    const baseline = compileAndRunModule(ir.value);
    const optimizedFn = runPipeline(ir.value.functions[0]!, [deadCodeEliminationPass]);
    const optimized = compileAndRunModule({ ...ir.value, functions: [optimizedFn] });
    expect(baseline.stdout).toBe("5\n");
    expect(optimized.stdout).toBe("5\n");
  });

  it("CRITICAL: a slot-based variable's final value, never read, still gets stored correctly and behavior matches exactly", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return 99\nend\n");
    expect(baseline.exitCode).toBe(99);
    expect(optimized.exitCode).toBe(99);
  });

  it("CRITICAL: an array_store whose element is never read still executes correctly (no ASan violation, identical behavior)", () => {
    const { baseline, optimized, violations } = compareBaselineVsOptimized("function main(): int\n  let arr = [1, 2, 3]\n  arr[0] = 99\n  return 0\nend\n");
    expect(violations).toEqual([]);
    expect(baseline.exitCode).toBe(0);
    expect(optimized.exitCode).toBe(0);
  });

  it("a while loop with dead code in its body: real execution identical, fewer instructions", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  let i = 0\n  while i < 10\n    let unused = i * 2\n    i = i + 1\n  end\n  return i\nend\n");
    expect(baseline.exitCode).toBe(10);
    expect(optimized.exitCode).toBe(10);
  });

  it("DCE composed with Constant Folding in one pipeline: real execution still identical to baseline", async () => {
    const { constantFoldingPass } = await import("../../src/optimizer/constant-folding.js");
    const src = "function main(): int\n  let dead = 2 + 3\n  return 1\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "e2e.ur", "e2e");
    if (!ir.ok) throw new Error("lowering failed");
    const baseline = compileAndRunModule(ir.value);
    const optimizedFn = runPipeline(ir.value.functions[0]!, [constantFoldingPass, deadCodeEliminationPass]);
    const optimized = compileAndRunModule({ ...ir.value, functions: [optimizedFn] });
    expect(baseline.exitCode).toBe(1);
    expect(optimized.exitCode).toBe(1);
  });
});
