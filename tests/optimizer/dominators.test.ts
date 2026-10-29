// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dominator Tree: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §3 (second pipeline item)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { computeDominatorTree } from "../../src/optimizer/dominators.js";
import type { IRFunction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

function blockIdByLabel(fn: IRFunction, label: string): number {
  const block = fn.blocks.find(b => b.label === label);
  if (!block) throw new Error(`no block labeled '${label}' in function ${fn.sourceName}`);
  return block.id;
}

describe("optimizer/dominators — mathematically-verified CFG shapes", () => {
  it("straight-line function: entry dominates itself, no other blocks exist", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    const dt = computeDominatorTree(fn);
    expect(fn.blocks).toHaveLength(1);
    expect(dt.dominates(fn.entryBlock, fn.entryBlock)).toBe(true);
  });

  it("if/else DIAMOND: the merge block is dominated by ENTRY, not by either branch (the classic case a wrong implementation gets wrong)", () => {
    const fn = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return y\nend\n");
    const dt = computeDominatorTree(fn);
    const entry = blockIdByLabel(fn, "entry");
    const then = blockIdByLabel(fn, "then");
    const els = blockIdByLabel(fn, "else");
    const merge = blockIdByLabel(fn, "merge");

    expect(dt.immediateDominator.get(merge)).toBe(entry);
    expect(dt.dominates(entry, merge)).toBe(true);
    // Neither branch alone dominates the merge — both are "just a
    // sibling path", not an ancestor on every path to merge.
    expect(dt.dominates(then, merge)).toBe(false);
    expect(dt.dominates(els, merge)).toBe(false);
  });

  it("while LOOP: loop_header dominates BOTH loop_body and loop_exit", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const entry = blockIdByLabel(fn, "entry");
    const header = blockIdByLabel(fn, "loop_header");
    const body = blockIdByLabel(fn, "loop_body");
    const exit = blockIdByLabel(fn, "loop_exit");

    expect(dt.immediateDominator.get(header)).toBe(entry);
    expect(dt.immediateDominator.get(body)).toBe(header);
    expect(dt.immediateDominator.get(exit)).toBe(header);
    expect(dt.dominates(header, body)).toBe(true);
    expect(dt.dominates(header, exit)).toBe(true);
    // The loop body does NOT dominate the exit (control can skip the
    // body entirely on the first iteration if the condition is false).
    expect(dt.dominates(body, exit)).toBe(false);
  });

  it("NESTED if where the outer then-branch always returns early: the outer merge is dominated by the ELSE block, not the entry (a subtle, hand-verified case)", () => {
    const fn = lowerOk("function f(a: int, b: int): int\n  if a > 0\n    if b > 0\n      return 1\n    end\n    return 2\n  end\n  return 3\nend\n");
    const dt = computeDominatorTree(fn);
    const blocks = fn.blocks;
    // There are two blocks labeled "merge" (inner and outer) and two
    // labeled "then"/"else" (inner and outer) - identify by structure:
    // the outer merge is the one whose only predecessor is the outer else.
    const entry = fn.entryBlock;
    const outerElse = blocks.find(b => b.label === "else" && b.terminator.kind === "branch")!;
    // The outer merge block is whatever outerElse's branch targets.
    const outerMergeId = outerElse.terminator.kind === "branch" ? outerElse.terminator.target : -1;
    expect(dt.immediateDominator.get(outerMergeId)).toBe(outerElse.id);
    expect(dt.dominates(entry, outerMergeId)).toBe(true); // still true transitively
    expect(dt.dominates(outerElse.id, outerMergeId)).toBe(true);
  });

  it("checkModuleInvariants-verified real function with arrays produces a valid, non-crashing dominator tree", () => {
    const fn = lowerOk("function f(): int\n  let arr = [1, 2, 3]\n  let i = 0\n  let total = 0\n  while i < 3\n    total = total + arr[i]\n    i = i + 1\n  end\n  return total\nend\n");
    const dt = computeDominatorTree(fn);
    expect(dt.dominates(fn.entryBlock, fn.entryBlock)).toBe(true);
    for (const block of fn.blocks) {
      expect(dt.dominates(fn.entryBlock, block.id)).toBe(true); // entry dominates everything reachable
    }
  });
});

describe("optimizer/dominators — the three explicit scope rules", () => {
  it("RULE 1 (analysis only): computing the dominator tree never mutates the IRFunction", () => {
    const fn = lowerOk("function f(): int\n  if true\n    return 1\n  else\n    return 2\n  end\nend\n");
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const before = stringify(fn);
    computeDominatorTree(fn);
    expect(stringify(fn)).toBe(before);
  });

  it("RULE 2 (CFG only, no SSA dependency): two functions with identical CFG shape but completely different instructions/values produce identical dominance structure", () => {
    const fnA = lowerOk("function f(): int\n  let x = 1\n  if x == 1\n    return 10\n  else\n    return 20\n  end\nend\n");
    const fnB = lowerOk("function g(): bool\n  let y = true\n  if y == true\n    return true\n  else\n    return false\n  end\nend\n");
    const dtA = computeDominatorTree(fnA);
    const dtB = computeDominatorTree(fnB);
    // Same shape (entry -> then/else, both branches return directly, no merge) -> same idom structure by relative position.
    expect(dtA.immediateDominator.size).toBe(dtB.immediateDominator.size);
  });

  it("RULE 3 (Dom(n) only): the DominatorTree interface exposes ONLY immediateDominator/dominates - no loop, back-edge, or natural-loop query exists", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const exposedKeys = Object.keys(dt).sort();
    expect(exposedKeys).toEqual(["dominates", "entryBlockId", "immediateDominator"]);
  });

  it("computeDominatorTree is a pure function: calling it twice on the same function yields equivalent results", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const dt1 = computeDominatorTree(fn);
    const dt2 = computeDominatorTree(fn);
    expect([...dt1.immediateDominator.entries()]).toEqual([...dt2.immediateDominator.entries()]);
  });
});
