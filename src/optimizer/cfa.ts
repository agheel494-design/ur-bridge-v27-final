// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Control Flow Analysis
// Level 2.9, OPTIMIZER_SPEC.md §4 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// THIRD item from OPTIMIZER_SPEC.md §2.1's fixed pipeline, per the
// review-mandated one-item-per-batch execution rule. Explicit scope
// (per review): Back Edge Detection + Natural Loop Detection (header,
// body) ONLY. The following are explicitly NOT implemented here and
// must not be added without a new, separately-reviewed scope decision:
//   - Loop Nest Forest (nesting relationships between multiple loops)
//   - Loop Canonicalization
//   - Loop Rotation
//   - Loop Simplification
//
// Analysis only (matches Dominator Tree's own rule 1) — this file never
// mutates the IRFunction it analyzes, and is built entirely on top of
// the DominatorTree computed by src/optimizer/dominators.ts (item 2) —
// it does not recompute dominance itself.

import type { IRFunction } from "../shared/ir.js";
import type { DominatorTree } from "./dominators.js";

export interface BackEdge {
  /** The block whose terminator jumps back... */
  readonly from: number;
  /** ...to this block, which the Dominator Tree confirms dominates `from`. */
  readonly to: number;
}

export interface NaturalLoop {
  /** The loop header — the back edge's target, and the sole entry point into the loop body. */
  readonly headerBlockId: number;
  /** The specific back edge that identified this loop. */
  readonly backEdge: BackEdge;
  /** Every block id that is part of this loop, including the header itself. */
  readonly bodyBlockIds: ReadonlySet<number>;
}

export interface ControlFlowAnalysis {
  readonly backEdges: readonly BackEdge[];
  readonly naturalLoops: readonly NaturalLoop[];
}

function successorsOf(fn: IRFunction, blockId: number): number[] {
  const block = fn.blocks.find(b => b.id === blockId)!;
  switch (block.terminator.kind) {
    case "branch": return [block.terminator.target];
    case "cond_branch": return [block.terminator.thenTarget, block.terminator.elseTarget];
    case "return":
    case "return_void":
      return [];
  }
}

/**
 * Standard natural-loop-body computation for a single back edge
 * `(n -> d)` where `d` dominates `n` (already confirmed by the caller
 * via the DominatorTree before this function is invoked): a backward
 * traversal from `n`, along predecessor edges, stopping at `d`,
 * collecting every visited block plus `d` itself.
 */
function computeNaturalLoopBody(fn: IRFunction, backEdgeFrom: number, header: number): Set<number> {
  const preds = new Map<number, number[]>();
  for (const block of fn.blocks) preds.set(block.id, []);
  for (const block of fn.blocks) {
    for (const succ of successorsOf(fn, block.id)) {
      if (preds.has(succ)) preds.get(succ)!.push(block.id);
    }
  }

  const body = new Set<number>([header]);
  const worklist: number[] = [backEdgeFrom];
  while (worklist.length > 0) {
    const m = worklist.pop()!;
    if (!body.has(m)) {
      body.add(m);
      for (const p of preds.get(m) ?? []) {
        if (!body.has(p)) worklist.push(p);
      }
    }
  }
  return body;
}

/**
 * Identifies every back edge and natural loop in `fn`, using the
 * already-computed `dominatorTree` (item 2 — never recomputed here).
 *
 * A CFG edge `A -> B` is a back edge iff `B` dominates `A` — the
 * textbook definition. Each back edge identifies exactly one natural
 * loop, headed by `B`.
 */
export function analyzeControlFlow(fn: IRFunction, dominatorTree: DominatorTree): ControlFlowAnalysis {
  const backEdges: BackEdge[] = [];
  for (const block of fn.blocks) {
    for (const succ of successorsOf(fn, block.id)) {
      if (dominatorTree.dominates(succ, block.id)) {
        backEdges.push({ from: block.id, to: succ });
      }
    }
  }

  const naturalLoops: NaturalLoop[] = backEdges.map(backEdge => ({
    headerBlockId: backEdge.to,
    backEdge,
    bodyBlockIds: computeNaturalLoopBody(fn, backEdge.from, backEdge.to),
  }));

  return { backEdges, naturalLoops };
}
