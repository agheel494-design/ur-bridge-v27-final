// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dataflow Framework: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §5 (fourth pipeline item)
// ─────────────────────────────────────────────────────────────────────────────
//
// Deliberately uses only ABSTRACT, illustrative boolean analyses
// (forward reachability, backward can-reach-a-return) rather than any
// named concrete analysis (Liveness, Reaching Definitions/Copies,
// Available Expressions) — proving the engine itself is genuinely
// analysis-agnostic, per explicit review instruction that the
// framework must contain zero analysis-specific logic. Liveness and
// Reaching Copies (as real users of this engine) are separate,
// independent modules for a later batch, not tested here.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { runDataflow, type DataflowAnalysis } from "../../src/optimizer/dataflow.js";
import type { IRFunction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

/** Abstract forward analysis: "is this block reachable from the entry?" Not Liveness/ReachingDefs/etc. — a pure engine-exercising example. */
function makeReachabilityAnalysis(entryBlockId: number): DataflowAnalysis<boolean> {
  return {
    direction: "forward",
    boundaryFact: false,
    equal: (a, b) => a === b,
    meet: (facts) => facts.some(f => f),
    transfer: (block, fact) => (block.id === entryBlockId ? true : fact),
  };
}

/** Abstract backward analysis: "can this block eventually reach a return?" Also a pure engine-exercising example, not a named concrete analysis. */
const canReachReturnAnalysis: DataflowAnalysis<boolean> = {
  direction: "backward",
  boundaryFact: false,
  equal: (a, b) => a === b,
  meet: (facts) => facts.some(f => f),
  transfer: (block, fact) => (block.terminator.kind === "return" || block.terminator.kind === "return_void") ? true : fact,
};

describe("optimizer/dataflow — generic engine, forward direction", () => {
  it("forward reachability: every block in a straight-through while loop is reachable from entry", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    const result = runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    expect([...result.out.values()].every(v => v === true)).toBe(true);
  });

  it("forward reachability: the entry block's own IN is false (nothing flows INTO the entry from within the function)", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const result = runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    expect(result.in.get(fn.entryBlock)).toBe(false);
    expect(result.out.get(fn.entryBlock)).toBe(true); // transfer forces entry's OUT to true
  });

  it("forward reachability on an if/else diamond: both branches and the merge are all reachable", () => {
    const fn = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return y\nend\n");
    const result = runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    expect([...result.out.values()].every(v => v === true)).toBe(true);
  });
});

describe("optimizer/dataflow — generic engine, backward direction", () => {
  it("backward can-reach-return: every block in a function with a single return can reach it", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const result = runDataflow(fn, canReachReturnAnalysis);
    expect([...result.in.values()].every(v => v === true)).toBe(true);
  });

  it("backward can-reach-return: a function with multiple return statements (if/else, both branches return) - every block reaches SOME return", () => {
    const fn = lowerOk("function f(a: int): int\n  if a > 0\n    return 1\n  else\n    return 2\n  end\nend\n");
    const result = runDataflow(fn, canReachReturnAnalysis);
    expect([...result.in.values()].every(v => v === true)).toBe(true);
  });
});

describe("optimizer/dataflow — mandatory determinism (per review)", () => {
  it("running the SAME analysis on the SAME function twice produces bit-identical in/out maps", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  let total = 0\n  while i < 3\n    let j = 0\n    while j < 3\n      total = total + 1\n      j = j + 1\n    end\n    i = i + 1\n  end\n  return total\nend\n");
    const analysis = makeReachabilityAnalysis(fn.entryBlock);
    const resultA = runDataflow(fn, analysis);
    const resultB = runDataflow(fn, analysis);
    expect([...resultA.out.entries()]).toEqual([...resultB.out.entries()]);
    expect([...resultA.in.entries()]).toEqual([...resultB.in.entries()]);
  });

  it("determinism holds for the backward direction too", () => {
    const fn = lowerOk("function f(a: int): int\n  if a > 0\n    return 1\n  else\n    return 2\n  end\nend\n");
    const resultA = runDataflow(fn, canReachReturnAnalysis);
    const resultB = runDataflow(fn, canReachReturnAnalysis);
    expect([...resultA.in.entries()]).toEqual([...resultB.in.entries()]);
  });
});

describe("optimizer/dataflow — analysis independence and purity", () => {
  it("runDataflow never mutates the IRFunction it analyzes", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const before = stringify(fn);
    runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    expect(stringify(fn)).toBe(before);
  });

  it("SCOPE CHECK (per review): DataflowResult exposes only in/out - no analysis-specific concept (live sets, reaching definitions, etc.) is baked into the framework's own return type", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const result = runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    expect(Object.keys(result).sort()).toEqual(["in", "out"]);
  });

  it("two completely different analyses run independently on the same function without interfering with each other", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const reachResult = runDataflow(fn, makeReachabilityAnalysis(fn.entryBlock));
    const returnResult = runDataflow(fn, canReachReturnAnalysis);
    // Different directions, different semantics, no shared mutable state -> both fully valid and independently correct.
    expect([...reachResult.out.values()].every(v => v === true)).toBe(true);
    expect([...returnResult.in.values()].every(v => v === true)).toBe(true);
  });
});
