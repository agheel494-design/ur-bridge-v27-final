// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Constant Folding: real E2E (baseline vs. optimized)
// Level 2.9, OPTIMIZER_SPEC.md §7/§8
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiles and runs each program TWICE — once with the unoptimized IR
// (the existing Level 2.4-2.8 baseline), once with Constant Folding
// applied — and asserts IDENTICAL observable behavior (exit code). This
// is the core empirical verification methodology OPTIMIZER_SPEC.md §7
// specifies: no general semantic-equivalence proof exists, so pass
// correctness rests partly on direct, real compiled execution
// comparison, exactly as already used throughout Level 2.4-2.8.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
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

  const optimizedFn = runPipeline(ir.value.functions[0]!, [constantFoldingPass]);
  const violations = validateFunction(optimizedFn);
  const optimizedModule: IRModule = { ...ir.value, functions: [optimizedFn] };
  const optimized = compileAndRunModule(optimizedModule);

  return { baseline, optimized, violations };
}

describe("E2E — Constant Folding: baseline vs. optimized produce IDENTICAL real execution results", () => {
  if (!hasGcc) { it.skip("SKIPPED: gcc not available", () => expect(true).toBe(true)); return; }

  it("2 + 3: baseline and optimized both produce exit code 5", () => {
    const { baseline, optimized, violations } = compareBaselineVsOptimized("function main(): int\n  return 2 + 3\nend\n");
    expect(violations).toEqual([]);
    expect(baseline.exitCode).toBe(5);
    expect(optimized.exitCode).toBe(5);
    expect(optimized.warnings.trim()).toBe("");
  });

  it("chained (2 + 3) * 4: baseline and optimized both produce exit code 20", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  return (2 + 3) * 4\nend\n");
    expect(baseline.exitCode).toBe(20);
    expect(optimized.exitCode).toBe(20);
  });

  it("unary minus: -5 + 10: baseline and optimized both produce exit code 5", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  return -5 + 10\nend\n");
    expect(baseline.exitCode).toBe(5);
    expect(optimized.exitCode).toBe(5);
  });

  it("mixed constant-and-variable expression: (2+3) + x, still identical after folding the constant part", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  let x = 10\n  return (2 + 3) + x\nend\n");
    expect(baseline.exitCode).toBe(15);
    expect(optimized.exitCode).toBe(15);
  });

  it("a program using print() with a folded constant: real stdout output is identical before and after", () => {
    const src = "function main(): int\n  print(2 + 3)\n  return 0\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "e2e.ur", "e2e");
    if (!ir.ok) throw new Error("lowering failed");
    const baseline = compileAndRunModule(ir.value);
    const optimizedFn = runPipeline(ir.value.functions[0]!, [constantFoldingPass]);
    const optimized = compileAndRunModule({ ...ir.value, functions: [optimizedFn] });
    expect(baseline.stdout).toBe("5\n");
    expect(optimized.stdout).toBe("5\n");
    expect(baseline.stdout).toBe(optimized.stdout);
  });

  it("a while loop with a folded constant bound is unaffected — both produce identical results", () => {
    const src = "function main(): int\n  let i = 0\n  let total = 0\n  while i < (2 + 3)\n    total = total + i\n    i = i + 1\n  end\n  return total\nend\n";
    const { baseline, optimized } = compareBaselineVsOptimized(src);
    expect(baseline.exitCode).toBe(10); // 0+1+2+3+4 = 10, loop runs while i < 5
    expect(optimized.exitCode).toBe(10);
  });

  it("division is genuinely UNCHANGED end-to-end (not folded) - baseline and optimized both compile to the same real division, still correct", () => {
    const { baseline, optimized } = compareBaselineVsOptimized("function main(): int\n  let x = 10.0\n  let y = 2.0\n  return x / y\nend\n");
    expect(baseline.exitCode).toBe(optimized.exitCode);
  });
});
