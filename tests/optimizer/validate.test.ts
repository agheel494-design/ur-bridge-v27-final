// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Optimization Validator: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §7 (item 7, after Copy Propagation's removal)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit review priority: validates the FULL composed pipeline
// (Constant Folding + Dead Code Elimination run together), not each
// pass in isolation.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { runPipeline } from "../../src/optimizer/pass.js";
import { validateOptimization } from "../../src/optimizer/validate.js";
import type { IRFunction, IRInstruction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

const FULL_PIPELINE = [constantFoldingPass, deadCodeEliminationPass];

describe("optimizer/validate — real, valid pipeline results (zero violations expected)", () => {
  it("a program with folded constants and dead code removed: full pipeline validates clean", () => {
    const before = lowerOk("function f(): int\n  print(2 + 3)\n  let dead = 10 - 4\n  return 1\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const result = validateOptimization(before, after);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("a program with a slot-based variable (if/else) and dead code: full pipeline validates clean", () => {
    const before = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  let dead = 1 + 2\n  return 99\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });

  it("a program with arrays, structs, and while loops together: full pipeline validates clean", () => {
    const before = lowerOk(
      "struct Point\n  x: int\n  y: int\nend\n" +
      "function f(): int\n" +
      "  let p = Point(1, 2)\n" +
      "  let arr = [1, 2, 3]\n" +
      "  let i = 0\n" +
      "  let dead = 5 + 5\n" +
      "  while i < 3\n" +
      "    p.x = p.x + arr[i]\n" +
      "    i = i + 1\n" +
      "  end\n" +
      "  return p.x\n" +
      "end\n"
    );
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });

  it("a no-op case (nothing to fold or remove): trivially valid", () => {
    const before = lowerOk("function f(x: int, y: int): int\n  return x + y\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });
});

describe("optimizer/validate — CHECK 1: side-effect preservation (catches a real class of bugs structural validation cannot)", () => {
  it("detects a removed call (print) that structural validation alone would miss", () => {
    const before = lowerOk("function f(): int\n  print(5)\n  return 1\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const corrupted: IRFunction = {
      ...after,
      blocks: after.blocks.map(b => ({ ...b, instructions: b.instructions.filter(i => i.kind !== "call") })),
    };
    const result = validateOptimization(before, corrupted);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("side-effecting instruction"))).toBe(true);
  });

  it("detects a removed store (slot-based assignment) that structural validation alone would miss", () => {
    const before = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return 99\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const corrupted: IRFunction = {
      ...after,
      blocks: after.blocks.map(b => ({ ...b, instructions: b.instructions.filter(i => i.kind !== "store") })),
    };
    const result = validateOptimization(before, corrupted);
    expect(result.valid).toBe(false);
  });

  it("detects a removed array_store", () => {
    const before = lowerOk("function f(): int\n  let arr = [1, 2, 3]\n  arr[0] = 99\n  return 0\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const corrupted: IRFunction = {
      ...after,
      blocks: after.blocks.map(b => ({ ...b, instructions: b.instructions.filter(i => i.kind !== "array_store") })),
    };
    const result = validateOptimization(before, corrupted);
    expect(result.valid).toBe(false);
  });

  it("a genuinely dead (non-side-effecting) instruction being removed is NOT flagged as a violation", () => {
    const before = lowerOk("function f(): int\n  let dead = 1 + 2\n  return 5\nend\n");
    const after = runPipeline(before, FULL_PIPELINE); // DCE legitimately removes the dead const/binop
    expect(validateOptimization(before, after).valid).toBe(true);
  });
});

describe("optimizer/validate — CHECK 2: independent fold re-verification (catches a class of bugs structural validation cannot)", () => {
  it("detects a MATHEMATICALLY WRONG folded value, even though it is structurally a well-formed const", () => {
    const before = lowerOk("function f(): int\n  return 2 + 3\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const corrupted: IRFunction = {
      ...after,
      blocks: after.blocks.map(b => ({
        ...b,
        instructions: b.instructions.map((i: IRInstruction) =>
          i.kind === "const" && i.value.kind === "const_int" && i.value.value === 5n
            ? { ...i, value: { kind: "const_int" as const, value: 999n } }
            : i
        ),
      })),
    };
    const result = validateOptimization(before, corrupted);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.includes("INCORRECT FOLD"))).toBe(true);
  });

  it("a correct fold (subtraction) is verified as correct, not flagged", () => {
    const before = lowerOk("function f(): int\n  return 10 - 4\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });

  it("a correct float fold is verified as correct", () => {
    const before = lowerOk("function f(): float\n  return 1.5 + 2.5\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });

  it("a correct unary-minus fold is verified as correct", () => {
    const before = lowerOk("function f(): int\n  return -5\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });

  it("a chained fold ((2+3)*4=20) is independently re-verified as correct", () => {
    const before = lowerOk("function f(): int\n  return (2 + 3) * 4\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    expect(validateOptimization(before, after).valid).toBe(true);
  });
});

describe("optimizer/validate — never mutates its inputs", () => {
  it("validateOptimization does not mutate either the before or after IRFunction", () => {
    const before = lowerOk("function f(): int\n  print(2 + 3)\n  return 1\nend\n");
    const after = runPipeline(before, FULL_PIPELINE);
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const beforeSnapshot = stringify(before);
    const afterSnapshot = stringify(after);
    validateOptimization(before, after);
    expect(stringify(before)).toBe(beforeSnapshot);
    expect(stringify(after)).toBe(afterSnapshot);
  });
});
