// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Control Flow Analysis: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §4 (third pipeline item)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { computeDominatorTree } from "../../src/optimizer/dominators.js";
import { analyzeControlFlow } from "../../src/optimizer/cfa.js";
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

describe("optimizer/cfa — back-edge and natural-loop detection", () => {
  it("a program with NO loops (if/else diamond only) has zero back edges and zero natural loops", () => {
    const fn = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return y\nend\n");
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    expect(cfa.backEdges).toEqual([]);
    expect(cfa.naturalLoops).toEqual([]);
  });

  it("a simple while loop: exactly one back edge (loop_body -> loop_header), one natural loop containing exactly {header, body}", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    const header = blockIdByLabel(fn, "loop_header");
    const body = blockIdByLabel(fn, "loop_body");

    expect(cfa.backEdges).toEqual([{ from: body, to: header }]);
    expect(cfa.naturalLoops).toHaveLength(1);
    expect(cfa.naturalLoops[0]!.headerBlockId).toBe(header);
    expect([...cfa.naturalLoops[0]!.bodyBlockIds].sort()).toEqual([header, body].sort());
  });

  it("nested while loops: exactly TWO back edges and TWO natural loops, and the OUTER loop's body correctly includes every block of the inner loop (natural loops include nested loops fully — this is standard, correct compiler theory, not a bug)", () => {
    const fn = lowerOk(
      "function f(): int\n" +
      "  let i = 0\n  let total = 0\n" +
      "  while i < 3\n" +
      "    let j = 0\n" +
      "    while j < 3\n" +
      "      total = total + 1\n" +
      "      j = j + 1\n" +
      "    end\n" +
      "    i = i + 1\n" +
      "  end\n" +
      "  return total\nend\n"
    );
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    expect(cfa.backEdges).toHaveLength(2);
    expect(cfa.naturalLoops).toHaveLength(2);

    const outerLoop = cfa.naturalLoops.find(l => l.bodyBlockIds.size === Math.max(...cfa.naturalLoops.map(x => x.bodyBlockIds.size)))!;
    const innerLoop = cfa.naturalLoops.find(l => l !== outerLoop)!;

    // The inner loop's entire body must be a SUBSET of the outer loop's body.
    for (const id of innerLoop.bodyBlockIds) {
      expect(outerLoop.bodyBlockIds.has(id)).toBe(true);
    }
    // The outer loop's body must be strictly larger (it contains at
    // least the inner loop plus the outer loop's own header).
    expect(outerLoop.bodyBlockIds.size).toBeGreaterThan(innerLoop.bodyBlockIds.size);
  });

  it("SUBTLE, MATHEMATICALLY CORRECT CASE: a while loop containing a break — the break-target path is NOT part of the natural loop's body by the strict definition (it never reaches back to the header without leaving the loop), even though it is syntactically 'inside' the loop in the UR source", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 100\n    if i == 10\n      break\n    end\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    expect(cfa.naturalLoops).toHaveLength(1);
    const loop = cfa.naturalLoops[0]!;
    const header = blockIdByLabel(fn, "loop_header");
    const body = blockIdByLabel(fn, "loop_body");
    const thenBlock = fn.blocks.find(b => b.label === "then")!; // the break's own block

    expect(loop.bodyBlockIds.has(header)).toBe(true);
    expect(loop.bodyBlockIds.has(body)).toBe(true);
    // The break's block branches straight to loop_exit — it is not part
    // of the cycle back to the header, so it is correctly EXCLUDED from
    // bodyBlockIds by the textbook natural-loop definition.
    expect(loop.bodyBlockIds.has(thenBlock.id)).toBe(false);
  });

  it("a back edge is only ever reported for a real dominance relationship — no back edge exists between sibling branches of an if/else", () => {
    const fn = lowerOk("function f(a: int): int\n  if a > 0\n    return 1\n  else\n    return 2\n  end\nend\n");
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    expect(cfa.backEdges).toEqual([]);
  });

  it("analyzeControlFlow never mutates the IRFunction it analyzes", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const before = stringify(fn);
    analyzeControlFlow(fn, dt);
    expect(stringify(fn)).toBe(before);
  });

  it("SCOPE CHECK (per review): the ControlFlowAnalysis result exposes only backEdges/naturalLoops - no loop-nest-forest, canonicalization, or rotation concept exists anywhere in the type", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    expect(Object.keys(cfa).sort()).toEqual(["backEdges", "naturalLoops"]);
    if (cfa.naturalLoops.length > 0) {
      expect(Object.keys(cfa.naturalLoops[0]!).sort()).toEqual(["backEdge", "bodyBlockIds", "headerBlockId"]);
    }
  });
});
