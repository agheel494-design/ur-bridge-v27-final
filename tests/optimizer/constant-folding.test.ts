// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Constant Folding: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §6.1 (fifth pipeline item, first real pass)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import type { IRFunction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

function countKinds(fn: IRFunction, kinds: string[]): number {
  return fn.blocks.flatMap(b => b.instructions).filter(i => kinds.includes(i.kind)).length;
}

describe("optimizer/constant-folding — in-scope: int/float add/sub/mul, unary minus", () => {
  it("2 + 3 folds to a single const(5), eliminating the binop entirely", () => {
    const fn = lowerOk("function f(): int\n  return 2 + 3\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(countKinds(optimized, ["binop"])).toBe(0);
    const constInst = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 5n);
    expect(constInst).toBeDefined();
  });

  it("10 - 4 folds correctly (subtraction)", () => {
    const fn = lowerOk("function f(): int\n  return 10 - 4\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    const c = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 6n);
    expect(c).toBeDefined();
  });

  it("6 * 7 folds correctly (multiplication)", () => {
    const fn = lowerOk("function f(): int\n  return 6 * 7\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    const c = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 42n);
    expect(c).toBeDefined();
  });

  it("unary minus on an int constant folds correctly (-5)", () => {
    const fn = lowerOk("function f(): int\n  return -5\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(countKinds(optimized, ["unop"])).toBe(0);
    const c = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === -5n);
    expect(c).toBeDefined();
  });

  it("float addition folds correctly (1.5 + 2.5 = 4.0) - searches for the SPECIFIC folded value, not merely the first float const in the block (the original 1.5/2.5 operand consts may still be present but unused)", () => {
    const fn = lowerOk("function f(): float\n  return 1.5 + 2.5\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(countKinds(optimized, ["binop"])).toBe(0);
    const c = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_float" && i.value.value === 4.0);
    expect(c).toBeDefined();
  });

  it("CONFIRMED LIMITATION (fixed): a chained expression (2+3)*4 folds FULLY to a single const(20) within one pass invocation - not just the innermost operation", () => {
    const fn = lowerOk("function f(): int\n  return (2 + 3) * 4\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(countKinds(optimized, ["binop"])).toBe(0);
    const c = optimized.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 20n);
    expect(c).toBeDefined();
  });
});

describe("optimizer/constant-folding — explicitly OUT of scope for this batch (must remain untouched)", () => {
  it("division is NOT folded, even for a non-zero constant divisor (zero-divisor handling deferred)", () => {
    const fn = lowerOk("function f(): float\n  return 10 / 2\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn); // true no-op — division is entirely untouched
  });

  it("modulo is NOT folded", () => {
    const fn = lowerOk("function f(): int\n  return 10 % 3\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("comparison operators are NOT folded (eq)", () => {
    const fn = lowerOk("function f(): bool\n  return 2 == 2\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("COVERAGE GAP FOUND AND CLOSED (per review's direct question about untested operators): neq is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return 2 != 3\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("COVERAGE GAP FOUND AND CLOSED: lt is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return 2 < 3\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("COVERAGE GAP FOUND AND CLOSED: lte is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return 2 <= 3\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("COVERAGE GAP FOUND AND CLOSED: gt is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return 3 > 2\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("COVERAGE GAP FOUND AND CLOSED: gte is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return 3 >= 2\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("boolean 'not' (!) is NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return !true\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("boolean 'and'/'or' are NOT folded", () => {
    const fn = lowerOk("function f(): bool\n  return true and false\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("no branch/if(true) simplification occurs - control flow is completely untouched even when the condition is a foldable constant expression", () => {
    const fn = lowerOk("function f(): int\n  if 1 == 1\n    return 10\n  else\n    return 20\n  end\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    // The CFG shape (block count) must be completely unchanged - this
    // pass never touches control flow, only individual instructions.
    expect(optimized.blocks.length).toBe(fn.blocks.length);
  });
});

describe("optimizer/constant-folding — no-op behavior and Pass Contract compliance", () => {
  it("a non-constant binop (variable + variable) is left completely untouched", () => {
    const fn = lowerOk("function f(x: int, y: int): int\n  return x + y\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn); // true reference-identity no-op
  });

  it("a function with nothing foldable at all (pure variables, a while loop) is a true no-op — same reference, matching the Pass Framework's own no-op guarantee", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(optimized).toBe(fn);
  });

  it("Pass Contract: the pass's output always passes structural validation (checkModuleInvariants)", () => {
    const fn = lowerOk("function f(): int\n  return (2 + 3) * 4 - 1\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass]);
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("folding one function's constants does not affect a DIFFERENT function's instructions (Pass Independence, verified across two separate runPipeline calls)", () => {
    const fnA = lowerOk("function f(): int\n  return 2 + 3\nend\n");
    const fnB = lowerOk("function g(): int\n  return 10 - 4\nend\n");
    const optimizedA = runPipeline(fnA, [constantFoldingPass]);
    const optimizedB = runPipeline(fnB, [constantFoldingPass]);
    const cA = optimizedA.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 5n);
    const cB = optimizedB.blocks[0]!.instructions.find(i => i.kind === "const" && i.value.kind === "const_int" && i.value.value === 6n);
    expect(cA).toBeDefined();
    expect(cB).toBeDefined();
  });
});
