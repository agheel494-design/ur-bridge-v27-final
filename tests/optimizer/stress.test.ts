// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Stress Tests
// Level 2.9 Review & Stabilization, per explicit review request
// ─────────────────────────────────────────────────────────────────────────────
//
// Real, large synthetic programs — deeply nested loops, long straight-
// line sequences, and wide call graphs — pushed through the FULL
// optimizer pipeline (Dominator Tree, Control Flow Analysis, Dataflow
// Framework via DCE's Liveness, Constant Folding, Optimization
// Validator), under real, enforced time bounds. The goal is
// specifically to confirm the worklist-based dataflow engine (§5)
// converges and does not hang or degrade catastrophically as block
// count grows — not to make any performance claim.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { computeDominatorTree } from "../../src/optimizer/dominators.js";
import { analyzeControlFlow } from "../../src/optimizer/cfa.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import { validateOptimization } from "../../src/optimizer/validate.js";
import type { IRFunction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse errors: ${JSON.stringify(errors)}`);
  const ir = lowerToIR(program, "stress.ur", "stress");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

/** Synthesizes a function with N sequentially nested while loops (loop 2 inside loop 1's body, etc.) — produces roughly 3N+1 basic blocks (entry, then header/body/exit per loop level, nested). */
function nestedLoops(depth: number): string {
  const lines: string[] = ["function main(): int"];
  for (let i = 0; i < depth; i++) {
    lines.push(`  let i${i} = 0`);
  }
  lines.push("  let total = 0");
  for (let i = 0; i < depth; i++) {
    lines.push(`  ${"  ".repeat(i)}while i${i} < 3`);
  }
  lines.push(`  ${"  ".repeat(depth)}total = total + 1`);
  for (let i = depth - 1; i >= 0; i--) {
    lines.push(`  ${"  ".repeat(i)}i${i} = i${i} + 1`);
    lines.push(`  ${"  ".repeat(i)}end`);
  }
  lines.push("  return total");
  lines.push("end");
  return lines.join("\n") + "\n";
}

/** Synthesizes a function with N sequential (non-nested) if/else diamonds, each contributing 4 blocks — produces roughly 4N+1 basic blocks, a wide/flat CFG shape rather than deeply nested. */
function manyDiamonds(count: number): string {
  const lines: string[] = ["function main(): int", "  let total = 0"];
  for (let i = 0; i < count; i++) {
    lines.push(`  if total % 2 == 0`);
    lines.push(`    total = total + ${i}`);
    lines.push(`  else`);
    lines.push(`    total = total + ${i + 1}`);
    lines.push(`  end`);
  }
  lines.push("  return total");
  lines.push("end");
  return lines.join("\n") + "\n";
}

/** Synthesizes a single function with N straight-line statements (a mix of dead and live constant arithmetic) — stresses Constant Folding's fixed-point loop and DCE's per-block work on ONE very large basic block. */
function longStraightLine(count: number): string {
  const lines: string[] = ["function main(): int", "  let total = 0"];
  for (let i = 0; i < count; i++) {
    lines.push(`  let dead${i} = (${i} + 1) * 2`); // foldable AND dead
  }
  lines.push("  total = 1 + 2");
  lines.push("  return total");
  return lines.join("\n") + "\nend\n";
}

describe("optimizer stress tests — large programs through the full pipeline, under a real time bound", () => {
  it("deeply nested while loops (10 levels, ~31 blocks): Dominator Tree + CFA + full pipeline complete well within 5 seconds", () => {
    const src = nestedLoops(10);
    const fn = lowerOk(src);
    expect(fn.blocks.length).toBeGreaterThan(20);

    const start = Date.now();
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    const optimized = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
    const optValidation = validateOptimization(fn, optimized);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(5000);
    expect(cfa.naturalLoops.length).toBe(10); // exactly 10 nested loops detected
    expect(validateFunction(optimized)).toEqual([]);
    expect(optValidation.valid).toBe(true);
  });

  it("a WIDE CFG — 200 sequential if/else diamonds (~801 blocks): full pipeline completes within 10 seconds, worklist converges", () => {
    const src = manyDiamonds(200);
    const fn = lowerOk(src);
    expect(fn.blocks.length).toBeGreaterThan(400);

    const start = Date.now();
    const dt = computeDominatorTree(fn);
    const cfa = analyzeControlFlow(fn, dt);
    const optimized = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10000);
    expect(cfa.backEdges).toEqual([]); // no loops in this shape, purely diamonds
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("a very large single basic block (2000 dead-and-foldable statements): Constant Folding's fixed-point loop and DCE both converge within 10 seconds", () => {
    const src = longStraightLine(2000);
    const fn = lowerOk(src);

    const start = Date.now();
    const optimized = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10000);
    // Everything genuinely dead should be gone; only the live "total = 1+2; return total" remains.
    expect(optimized.blocks.flatMap(b => b.instructions).length).toBeLessThan(10);
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("an EVEN LARGER single basic block (10,000 dead-and-foldable statements, per explicit review request to push further toward the actual breaking point): converges within 30 seconds", () => {
    const src = longStraightLine(10000);
    const fn = lowerOk(src);
    expect(fn.blocks[0]!.instructions.length).toBeGreaterThan(20000);

    const start = Date.now();
    const optimized = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(30000);
    expect(optimized.blocks.flatMap(b => b.instructions).length).toBeLessThan(10);
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("a wide call graph — 100 functions in a chain, each with dead code: full-module optimization completes within 10 seconds", () => {
    let src = "";
    for (let i = 0; i < 100; i++) {
      src += `function f${i}(x: int): int\n  let dead${i} = ${i} * 2\n  return ${i === 99 ? "x + 1" : `f${i + 1}(x) + 1`}\nend\n`;
    }
    src += "function main(): int\n  return f0(0)\nend\n";

    const { tokens } = lex(src);
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const ir = lowerToIR(program, "stress.ur", "stress");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;

    const start = Date.now();
    const allFns = ir.value.functions;
    const optimizedFns = allFns.map(fn => {
      const siblings = allFns.filter(f => f.qualifiedName !== fn.qualifiedName);
      return runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass], siblings);
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10000);
    for (const fn of optimizedFns) {
      const siblings = optimizedFns.filter(f => f.qualifiedName !== fn.qualifiedName);
      expect(validateFunction(fn, siblings)).toEqual([]);
    }
  });

  it("repeated dataflow runs on a large function do not leak time (rough linearity check, not a strict performance assertion)", () => {
    const smallFn = lowerOk(nestedLoops(3));
    const largeFn = lowerOk(nestedLoops(12));

    const smallStart = Date.now();
    runPipeline(smallFn, [constantFoldingPass, deadCodeEliminationPass]);
    const smallElapsed = Date.now() - smallStart;

    const largeStart = Date.now();
    runPipeline(largeFn, [constantFoldingPass, deadCodeEliminationPass]);
    const largeElapsed = Date.now() - largeStart;

    // Not a strict complexity bound - just confirms the larger case
    // doesn't take some wildly disproportionate multiple (e.g. 1000x)
    // of the smaller one, which would suggest a real algorithmic issue.
    expect(largeElapsed).toBeLessThan(Math.max(2000, smallElapsed * 200 + 1000));
  });
});
