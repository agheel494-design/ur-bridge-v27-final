// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dataflow Framework
// Level 2.9, OPTIMIZER_SPEC.md §5 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// FOURTH item from OPTIMIZER_SPEC.md §2.1's fixed pipeline, per the
// review-mandated one-item-per-batch execution rule. This file is
// STRICTLY GENERIC, per explicit review instruction: it contains no
// concept of Liveness, Reaching Definitions, Reaching Copies, or
// Available Expressions — those are all future USERS of this engine
// (separate, independent modules, built in later batches), never
// baked into the engine itself.
//
// Analysis-only, matching every other item in this phase: never
// mutates the IRFunction it runs over.
//
// This framework does not own, hold a reference to, or manage
// invalidation of DominatorTree (§3) or ControlFlowAnalysis (§4) — nor
// do those own or manage THIS framework's results. Every analysis
// takes whatever inputs it needs as plain parameters (per review's
// explicit "analyses stay independent of each other" instruction).

import type { IRFunction, IRBasicBlock } from "../shared/ir.js";

export interface DataflowAnalysis<Fact> {
  readonly direction: "forward" | "backward";
  /** The fact at the boundary: the entry block's IN (forward) or the exit block(s)' OUT (backward). */
  readonly boundaryFact: Fact;
  /** Fixed-point comparison — must be a genuine equality check for `Fact`, not reference identity, unless `Fact` values are always interned. */
  equal(a: Fact, b: Fact): boolean;
  /** Combines facts flowing in from multiple predecessors (forward) or successors (backward). Called with zero facts for a block with no such edges (returns the analysis's own appropriate "empty" value, e.g. an empty set). */
  meet(facts: readonly Fact[]): Fact;
  /** Computes this block's OUT (forward) or IN (backward) fact, given its IN (forward) or OUT (backward) fact. The analysis itself decides whether and how to look inside `block.instructions` — this framework never does so on the analysis's behalf. */
  transfer(block: IRBasicBlock, fact: Fact): Fact;
}

export interface DataflowResult<Fact> {
  readonly in: ReadonlyMap<number, Fact>;
  readonly out: ReadonlyMap<number, Fact>;
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

/**
 * Runs a generic worklist-based dataflow analysis to a fixed point.
 *
 * Determinism (mandatory, per review): blocks are always processed in
 * a fixed, reproducible order — ascending block id — regardless of
 * insertion order into the worklist. The same function and the same
 * analysis always converge to bit-identical `in`/`out` maps across
 * repeated runs.
 */
export function runDataflow<Fact>(fn: IRFunction, analysis: DataflowAnalysis<Fact>): DataflowResult<Fact> {
  const blocksById = new Map(fn.blocks.map(b => [b.id, b] as const));
  const preds = new Map<number, number[]>();
  const succs = new Map<number, number[]>();
  for (const block of fn.blocks) { preds.set(block.id, []); succs.set(block.id, successorsOf(block)); }
  for (const block of fn.blocks) {
    for (const s of succs.get(block.id)!) {
      if (preds.has(s)) preds.get(s)!.push(block.id);
    }
  }

  const predecessorsOf = (id: number) => preds.get(id) ?? [];
  const successorsOfId = (id: number) => succs.get(id) ?? [];
  const inputEdgesOf = (id: number) => analysis.direction === "forward" ? predecessorsOf(id) : successorsOfId(id);

  const inFacts = new Map<number, Fact>();
  const outFacts = new Map<number, Fact>();
  for (const block of fn.blocks) {
    inFacts.set(block.id, analysis.boundaryFact);
    outFacts.set(block.id, analysis.boundaryFact);
  }

  // Deterministic processing order: ascending block id, always — never
  // dependent on worklist insertion order.
  const orderedIds = fn.blocks.map(b => b.id).sort((a, b) => a - b);

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of orderedIds) {
      const block = blocksById.get(id)!;
      const incoming = inputEdgesOf(id).map(edgeId => analysis.direction === "forward" ? outFacts.get(edgeId)! : inFacts.get(edgeId)!);
      const meetResult = analysis.meet(incoming);
      const transferResult = analysis.transfer(block, meetResult);

      // Forward: meetResult is this block's IN, transferResult is its OUT.
      // Backward: meetResult is this block's OUT, transferResult is its IN.
      const meetTarget = analysis.direction === "forward" ? inFacts : outFacts;
      const transferTarget = analysis.direction === "forward" ? outFacts : inFacts;

      if (!analysis.equal(meetTarget.get(id)!, meetResult)) {
        meetTarget.set(id, meetResult);
        changed = true;
      }
      if (!analysis.equal(transferTarget.get(id)!, transferResult)) {
        transferTarget.set(id, transferResult);
        changed = true;
      }
    }
  }

  return { in: inFacts, out: outFacts };
}
