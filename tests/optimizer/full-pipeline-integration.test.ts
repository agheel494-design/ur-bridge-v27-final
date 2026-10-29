// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Full Pipeline Integration Test
// Level 2.9, OPTIMIZER_SPEC.md §2.1's exact fixed pipeline order
// ─────────────────────────────────────────────────────────────────────────────
//
// Exercises every stage in the exact order §2.1 specifies:
//
//   IRModule (Lowering) -> IR Verifier -> Constant Folding ->
//   Dead Code Elimination -> Optimization Validator -> IR Verifier ->
//   Backend -> real execution
//
// (Dominator Analysis / Loop Detection are computed as part of the
// fixed pipeline but are not exercised directly here, since neither
// Constant Folding nor DCE currently consumes them — per §3/§4's own
// text. This test focuses on the parts of the pipeline that actually
// transform and validate the IR end-to-end.)

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { checkModuleInvariants } from "../../src/shared/ir.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import { validateOptimization } from "../../src/optimizer/validate.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";
import type { IRModule } from "../../src/shared/ir.js";

function gccAvailable(): boolean {
  try { execSync("gcc --version", { stdio: "ignore" }); return true; } catch { return false; }
}
const hasGcc = gccAvailable();

/** Runs the EXACT fixed pipeline order from OPTIMIZER_SPEC.md section 2.1, stage by stage, asserting each stage's own contract before proceeding to the next. Optimizes EVERY function in the module (not just the first) — a real bug was found and fixed here: an earlier draft kept only ir.value.functions[0], silently dropping every other function, which caused a genuine link failure ("undefined reference to main") for multi-function programs where main isn't declared first. */
function runFullFixedPipeline(src: string) {
  // Stage: Lowering.
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) throw new Error(`parse errors: ${JSON.stringify(parseErrors)}`);
  const sem = analyze(program);
  if (sem.diagnostics.length) throw new Error(`semantic errors: ${JSON.stringify(sem.diagnostics)}`);
  const types = typeCheck(program);
  if (types.diagnostics.length) throw new Error(`type errors: ${JSON.stringify(types.diagnostics)}`);
  const ir = lowerToIR(program, "pipeline.ur", "pipeline");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);

  // Stage: IR Verifier (pre-optimization).
  const preOptViolations = checkModuleInvariants(ir.value);
  if (preOptViolations.length) throw new Error(`pre-optimization IR invalid: ${JSON.stringify(preOptViolations)}`);

  let totalInstructionsBefore = 0;
  let totalInstructionsAfter = 0;
  const optimizedFunctions = ir.value.functions.map(beforeFn => {
    totalInstructionsBefore += beforeFn.blocks.flatMap(b => b.instructions).length;
    const siblings = ir.value.functions.filter(f => f.qualifiedName !== beforeFn.qualifiedName);

    // Stage: Constant Folding, then Dead Code Elimination (fixed order).
    const afterFn = runPipeline(beforeFn, [constantFoldingPass, deadCodeEliminationPass], siblings);

    // Stage: Optimization Validator.
    const optValidation = validateOptimization(beforeFn, afterFn);
    if (!optValidation.valid) throw new Error(`Optimization Validator failed for '${beforeFn.sourceName}': ${JSON.stringify(optValidation.violations)}`);

    // Stage: IR Verifier, again, post-optimization.
    const postOptViolations = validateFunction(afterFn, siblings);
    if (postOptViolations.length) throw new Error(`post-optimization IR invalid for '${afterFn.sourceName}': ${JSON.stringify(postOptViolations)}`);

    totalInstructionsAfter += afterFn.blocks.flatMap(b => b.instructions).length;
    return afterFn;
  });

  // Stage: Backend — every function in the module, not just one.
  const optimizedModule: IRModule = { ...ir.value, functions: optimizedFunctions };
  const compiled = compileC(emitC(optimizedModule), "a.out", { captureWarnings: true, addressSanitizer: true });
  if (!compiled.ok) throw new Error(`gcc failed: ${JSON.stringify(compiled.diagnostics)}`);
  const result = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);

  return {
    exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    warnings: compiled.value.warnings,
    instructionsBefore: totalInstructionsBefore,
    instructionsAfter: totalInstructionsAfter,
  };
}

describe("Level 2.9 — full fixed pipeline integration (OPTIMIZER_SPEC.md section 2.1, exact order)", () => {
  if (!hasGcc) { it.skip("SKIPPED: gcc not available", () => expect(true).toBe(true)); return; }

  it("a program combining folding, dead code, control flow, and print(): every stage passes, real execution correct", () => {
    const src = [
      "function main(): int",
      "  let dead = 2 + 3",
      "  let i = 0",
      "  let total = 0",
      "  while i < 5",
      "    total = total + i",
      "    i = i + 1",
      "  end",
      "  print(total)",
      "  return total",
      "end",
      "",
    ].join("\n");
    const result = runFullFixedPipeline(src);
    expect(result.exitCode).toBe(10); // 0+1+2+3+4
    expect(result.stdout).toBe("10\n");
    expect(result.warnings.trim()).toBe("");
    expect(result.instructionsAfter).toBeLessThan(result.instructionsBefore); // the dead code was genuinely removed
  });

  it("a struct + array program: every pipeline stage passes, real execution correct, ASan clean", () => {
    const src = [
      "struct Point",
      "  x: int",
      "  y: int",
      "end",
      "function main(): int",
      "  let p = Point(1, 2)",
      "  let arr = [10, 20, 30]",
      "  let dead = 100 - 50",
      "  p.x = p.x + arr[1]",
      "  return p.x",
      "end",
      "",
    ].join("\n");
    const result = runFullFixedPipeline(src);
    expect(result.exitCode).toBe(21); // 1 + 20
    expect(result.warnings.trim()).toBe("");
  });

  it("a function-call-heavy program with a foldable constant argument: every stage passes", () => {
    const src = [
      "function double(x: int): int",
      "  return x * 2",
      "end",
      "function main(): int",
      "  return double(2 + 3)",
      "end",
      "",
    ].join("\n");
    const result = runFullFixedPipeline(src);
    expect(result.exitCode).toBe(10); // double(5) = 10
  });

  it("recursion combined with the full pipeline: every stage passes, real execution correct", () => {
    const src = [
      "function fact(n: int): int",
      "  if n <= 1",
      "    return 1",
      "  end",
      "  let dead = 1 + 1",
      "  return n * fact(n - 1)",
      "end",
      "function main(): int",
      "  return fact(5)",
      "end",
      "",
    ].join("\n");
    const result = runFullFixedPipeline(src);
    expect(result.exitCode).toBe(120);
  });
});
