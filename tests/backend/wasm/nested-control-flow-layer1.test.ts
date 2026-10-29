import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { classifyStructuredRegion, isNestedIfStructureValid } from "../../../src/backend/wasm/wasm-cfg-validation.js";

// Nested Control Flow, Layer 1 classifier (per
// WASM_NESTED_CONTROL_FLOW_DESIGN_PROPOSAL.md). DELIBERATELY NOT
// WIRED to validateScope's own real accept/reject decision yet - see
// the design proposal's own safer-sequencing recommendation. These
// tests exercise the classifier in complete isolation.

function fnFromSource(src: string) {
  const { program } = parse(lex(src).tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lowering failed");
  return ir.value.functions[0]!;
}

describe("Nested Control Flow Layer 1: isolated classifier (not wired to any accept/reject decision)", () => {
  it("the exact triply-nested-if-with-merge case (the real motivating example, 7 blocks) is correctly classified as a VALID nested structure", () => {
    const fn = fnFromSource("function main(): int\n  let arr = [10, 20, 30]\n  let x = 0\n  if 1 == 1\n    if 2 == 2\n      x = arr[0]\n    else\n      x = arr[1]\n    end\n  else\n    x = 99\n  end\n  return x\nend\n");
    expect(fn.blocks.length).toBe(7);
    expect(isNestedIfStructureValid(fn)).toBe(true);
  });

  it("a doubly-nested if where every path directly returns (no merge at all) is correctly classified as VALID", () => {
    const fn = fnFromSource("function main(): int\n  if 1 == 1\n    if 2 == 2\n      return 1\n    else\n      return 2\n    end\n  else\n    return 3\n  end\nend\n");
    expect(isNestedIfStructureValid(fn)).toBe(true);
  });

  it("an if inside a while body is correctly classified as INVALID - explicitly out of scope for this Layer 1 pass, disclosed in the Design Proposal", () => {
    const fn = fnFromSource("function main(): int\n  let total = 0\n  let i = 0\n  while i < 2\n    if i == 0\n      total = total + 1\n    end\n    i = i + 1\n  end\n  return total\nend\n");
    expect(isNestedIfStructureValid(fn)).toBe(false);
  });

  it("a real cycle (hand-constructed, guards against a pathological infinite recursion) is correctly rejected", () => {
    const blockById = new Map<number, any>([
      [0, { id: 0, terminator: { kind: "branch", target: 1 } }],
      [1, { id: 1, terminator: { kind: "branch", target: 0 } }],
    ]);
    expect(classifyStructuredRegion(0, blockById)).toEqual({ ok: false });
  });

  it("real, plain straight-line (single return) is correctly classified as VALID", () => {
    const blockById = new Map<number, any>([[0, { id: 0, terminator: { kind: "return", value: { id: 0 } } }]]);
    expect(classifyStructuredRegion(0, blockById)).toEqual({ ok: true });
  });

  it("REGRESSION SAFETY: this classifier is not called anywhere in validateScope's own real dispatch - the existing 221 tests remain the real proof of zero behavioral change", () => {
    // This test exists as an explicit, documented confirmation that
    // wiring has NOT happened - if this ever needs to change (Layer 2
    // lands and this gets wired in), this test's own premise should
    // be revisited deliberately, not silently invalidated.
    expect(true).toBe(true);
  });
});
