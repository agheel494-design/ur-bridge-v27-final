// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Liveness Analysis
// Level 2.9, OPTIMIZER_SPEC.md §5/§6.2
// ─────────────────────────────────────────────────────────────────────────────
//
// A concrete USER of the generic Dataflow Framework (src/optimizer/
// dataflow.ts) — built as a separate, independent module, per explicit
// review instruction that the framework itself must contain zero
// analysis-specific logic. This file is that logic, for exactly one
// analysis: Liveness.
//
// Backward analysis. Fact = the set of SSA value ids that may still be
// used somewhere reachable from this program point ("live"). Feeds
// Dead Code Elimination (§6.2): an instruction whose defined id is
// never live, and which has no side effect, is a removal candidate.

import type { IRFunction, IRBasicBlock, IRInstruction, IRValueRef } from "../shared/ir.js";
import { runDataflow, type DataflowAnalysis } from "./dataflow.js";

export type LiveSet = ReadonlySet<number>;

function setsEqual(a: LiveSet, b: LiveSet): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function unionAll(sets: readonly LiveSet[]): LiveSet {
  const result = new Set<number>();
  for (const s of sets) for (const x of s) result.add(x);
  return result;
}

/** Every SSA id an instruction reads (its operands) — never its own defined id. */
function usesOf(inst: IRInstruction): number[] {
  switch (inst.kind) {
    case "binop": return [inst.left.id, inst.right.id];
    case "unop": return [inst.operand.id];
    case "call": return inst.args.map((a: IRValueRef) => a.id);
    case "store": return [inst.value.id];
    case "array_load": return [inst.index.id];
    case "array_length": return [];
    case "array_store": return [inst.index.id, inst.value.id];
    case "field_load": return [];
    case "field_store": return [inst.value.id];
    case "param":
    case "const":
    case "load":
      return [];
  }
}

/** The SSA id an instruction defines, if any (store/array_store/field_store define none — analogous to a void call). */
function defOf(inst: IRInstruction): number | undefined {
  return inst.kind === "store" || inst.kind === "array_store" || inst.kind === "field_store" ? undefined : inst.id;
}

function usesOfTerminator(term: IRBasicBlock["terminator"]): number[] {
  switch (term.kind) {
    case "return": return [term.value.id];
    case "cond_branch": return [term.condition.id];
    case "branch":
    case "return_void":
      return [];
  }
}

/** Walks one block's instructions in reverse, starting from its live-OUT fact, producing its live-IN fact — the standard backward liveness transfer. */
function transferBlock(block: IRBasicBlock, liveOut: LiveSet): LiveSet {
  const live = new Set<number>(liveOut);
  for (let i = block.instructions.length - 1; i >= 0; i--) {
    const inst = block.instructions[i]!;
    const def = defOf(inst);
    if (def !== undefined) live.delete(def);
    for (const use of usesOf(inst)) live.add(use);
  }
  return live;
}

const livenessAnalysis: DataflowAnalysis<LiveSet> = {
  direction: "backward",
  boundaryFact: new Set(),
  equal: setsEqual,
  meet: unionAll,
  transfer: (block, liveOutFromSuccessors) => {
    // The terminator's own uses (e.g. `return v` uses v) are live
    // going into this block's OUT before we walk instructions backward.
    const withTerminatorUses = new Set(liveOutFromSuccessors);
    for (const use of usesOfTerminator(block.terminator)) withTerminatorUses.add(use);
    return transferBlock(block, withTerminatorUses);
  },
};

/** Per-block live-IN/live-OUT sets for `fn`, via the generic Dataflow Framework. */
export function computeLiveness(fn: IRFunction): { in: ReadonlyMap<number, LiveSet>; out: ReadonlyMap<number, LiveSet> } {
  return runDataflow(fn, livenessAnalysis);
}

// Re-exported for Dead Code Elimination's own per-instruction walk,
// which needs the same uses/def logic at finer granularity than the
// per-block in/out result above.
export { usesOf, defOf, usesOfTerminator };
