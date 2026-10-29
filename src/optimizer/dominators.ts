// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dominator Tree
// Level 2.9, OPTIMIZER_SPEC.md §3 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// SECOND item from OPTIMIZER_SPEC.md §2.1's fixed pipeline, per the
// review-mandated one-item-per-batch execution rule. Three explicit
// scope rules apply (per review) and are enforced by this file's
// design, not merely stated in a comment:
//
//   1. Analysis only — computing or querying a DominatorTree NEVER
//      mutates the IRFunction it was computed from. Every function in
//      this file takes an IRFunction (or values derived from one) and
//      returns new, independent data — nothing here writes back onto
//      any IR field.
//   2. Depends ONLY on the CFG shape (blocks, terminators, the
//      predecessor relation derived from them) — never on SSA value
//      ids, instructions, or local slots. `computeDominatorTree()`
//      never reads `block.instructions` at all.
//   3. Computes ONLY the dominance relation (immediate dominators,
//      and the `dominates()` query built from them) — no loop
//      detection, no natural-loop/back-edge identification. Those are
//      explicitly the next item (Control Flow Analysis, OPTIMIZER_SPEC.md
//      §4) and are NOT implemented here.
//
// Algorithm: the standard iterative dominance algorithm (Cooper,
// Harvey, Kennedy — "A Simple, Fast Dominance Algorithm") via
// reverse-postorder iteration to a fixed point.

import type { IRFunction, IRBasicBlock } from "../shared/ir.js";

/**
 * The result of dominance analysis for one function — an analysis
 * artifact only (§3, rule 1). Never attached to `IRFunction` itself.
 */
export interface DominatorTree {
  readonly entryBlockId: number;
  /** Immediate dominator of every reachable block. The entry block maps to itself (the conventional base case). Unreachable blocks (already flagged separately by checkModuleInvariants) are simply absent. */
  readonly immediateDominator: ReadonlyMap<number, number>;
  /** True iff `a` dominates `b` — every path from the entry block to `b` passes through `a`. Every reachable block dominates itself. False if either block is unreachable/unknown. */
  dominates(a: number, b: number): boolean;
}

function successorsOf(block: IRBasicBlock): number[] {
  switch (block.terminator.kind) {
    case "branch": return [block.terminator.target];
    case "cond_branch": return [block.terminator.thenTarget, block.terminator.elseTarget];
    case "return":
    case "return_void":
      return [];
  }
}

/** Reverse postorder starting from `entry`, computed via a standard iterative DFS (no recursion, so no stack-depth concern for large functions). */
function reversePostorder(entry: number, blocksById: ReadonlyMap<number, IRBasicBlock>): number[] {
  const visited = new Set<number>();
  const postorder: number[] = [];
  // Iterative post-order DFS using an explicit stack of (node, child-index) frames.
  const stack: Array<{ id: number; childIndex: number; children: number[] }> = [];
  visited.add(entry);
  stack.push({ id: entry, childIndex: 0, children: successorsOf(blocksById.get(entry)!) });

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.childIndex < frame.children.length) {
      const child = frame.children[frame.childIndex]!;
      frame.childIndex++;
      if (!visited.has(child) && blocksById.has(child)) {
        visited.add(child);
        stack.push({ id: child, childIndex: 0, children: successorsOf(blocksById.get(child)!) });
      }
    } else {
      postorder.push(frame.id);
      stack.pop();
    }
  }
  return postorder.reverse(); // reverse postorder
}

/**
 * Computes the Dominator Tree for one IRFunction — Dom(n) only, per
 * the three scope rules above. Reads only `fn.blocks`' ids and
 * terminators (never `instructions`), and `fn.entryBlock`.
 */
export function computeDominatorTree(fn: IRFunction): DominatorTree {
  const blocksById = new Map(fn.blocks.map(b => [b.id, b] as const));
  const entry = fn.entryBlock;

  // Predecessor relation, derived purely from terminators (rule 2).
  const preds = new Map<number, number[]>();
  for (const block of fn.blocks) preds.set(block.id, []);
  for (const block of fn.blocks) {
    for (const succ of successorsOf(block)) {
      if (preds.has(succ)) preds.get(succ)!.push(block.id);
    }
  }

  const rpo = reversePostorder(entry, blocksById);
  const rpoIndex = new Map<number, number>();
  rpo.forEach((id, i) => rpoIndex.set(id, i));

  const idom = new Map<number, number>();
  idom.set(entry, entry);

  function intersect(a: number, b: number): number {
    let finger1 = a;
    let finger2 = b;
    while (finger1 !== finger2) {
      while ((rpoIndex.get(finger1) ?? -1) > (rpoIndex.get(finger2) ?? -1)) {
        finger1 = idom.get(finger1)!;
      }
      while ((rpoIndex.get(finger2) ?? -1) > (rpoIndex.get(finger1) ?? -1)) {
        finger2 = idom.get(finger2)!;
      }
    }
    return finger1;
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of rpo) {
      if (node === entry) continue;
      const nodePreds = (preds.get(node) ?? []).filter(p => idom.has(p));
      if (nodePreds.length === 0) continue; // not yet reachable in this pass (or truly unreachable)
      let newIdom = nodePreds[0]!;
      for (let i = 1; i < nodePreds.length; i++) {
        newIdom = intersect(newIdom, nodePreds[i]!);
      }
      if (idom.get(node) !== newIdom) {
        idom.set(node, newIdom);
        changed = true;
      }
    }
  }

  function dominates(a: number, b: number): boolean {
    if (!idom.has(a) || !idom.has(b)) return false;
    let cursor = b;
    while (true) {
      if (cursor === a) return true;
      if (cursor === entry) return a === entry;
      const next = idom.get(cursor);
      if (next === undefined || next === cursor) return false;
      cursor = next;
    }
  }

  return { entryBlockId: entry, immediateDominator: idom, dominates };
}
