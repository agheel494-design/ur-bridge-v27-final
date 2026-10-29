// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dead Code Elimination (DCE)
// Level 2.9, OPTIMIZER_SPEC.md §6.2 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// SIXTH item from OPTIMIZER_SPEC.md §2.1's fixed pipeline, per the
// review-mandated one-item-per-batch execution rule. Uses Liveness
// Analysis (src/optimizer/liveness.ts — a separate, independent module
// built on the generic Dataflow Framework, never baked into it).
//
// Per §6.2's exact text: side-effecting instructions are NEVER removed,
// regardless of liveness — `call` (may have Runtime/user side effects,
// e.g. print()), `store`/`array_store` (mutates a slot that might still
// be read later), and every terminator. Only PURE, locally-owned
// SSA-defining instructions with a genuinely dead result (`const`,
// `binop`, `unop`, `load`, `array_load`, `param`) are eligible.
//
// Purely local per block, using the already-computed live-OUT fact for
// that block (from the Dataflow Framework) as the starting point for a
// single backward walk — never mutates the CFG, never deletes a block.

import type { IRFunction, IRBasicBlock, IRInstruction } from "../shared/ir.js";
import type { OptimizationPass } from "./pass.js";
import { computeLiveness, usesOf, defOf, usesOfTerminator } from "./liveness.js";

const SIDE_EFFECTING_KINDS = new Set(["call", "store", "array_store"]);
// NOTE on which entries are load-bearing (found while proving the test
// suite catches real regressions, not merely claiming it does):
// `store`/`array_store` are ALREADY protected structurally — `defOf()`
// returns `undefined` for both (they never define an SSA id), so the
// `def !== undefined` guard below excludes them regardless of whether
// they appear in this set. Their presence here is intentional,
// self-documenting redundancy, not the actual enforcement mechanism.
// `call` is the one entry that is genuinely load-bearing: a non-void
// `call` DOES define an id, and would be incorrectly eligible for
// removal without this explicit protection — confirmed directly by
// removing "call" from this set and observing both a Golden Test and a
// Unit Test fail (a `print()` call was incorrectly deleted).

function eliminateDeadCodeInBlock(block: IRBasicBlock, liveOut: ReadonlySet<number>): IRBasicBlock {
  const live = new Set<number>(liveOut);
  for (const use of usesOfTerminator(block.terminator)) live.add(use);

  const kept: IRInstruction[] = [];
  // Walk in reverse (matching the same direction Liveness itself
  // walks) so that "is this def live AT THIS POINT" is evaluated
  // correctly against everything AFTER it, before we fold this
  // instruction's own uses into the running live set.
  for (let i = block.instructions.length - 1; i >= 0; i--) {
    const inst = block.instructions[i]!;
    const def = defOf(inst);

    if (def !== undefined && !SIDE_EFFECTING_KINDS.has(inst.kind) && !live.has(def)) {
      // Dead: defines a value nothing live ever uses, and has no
      // side effect. Removed — and crucially, its OWN uses are NOT
      // added to `live`, since the instruction that would have
      // consumed them no longer exists.
      continue;
    }

    kept.push(inst);
    if (def !== undefined) live.delete(def);
    for (const use of usesOf(inst)) live.add(use);
  }
  kept.reverse();

  const changed = kept.length !== block.instructions.length;
  return changed ? { ...block, instructions: kept } : block;
}

export const deadCodeEliminationPass: OptimizationPass = {
  name: "dead-code-elimination",
  run(fn: IRFunction): IRFunction {
    const liveness = computeLiveness(fn);
    const newBlocks = fn.blocks.map(block => eliminateDeadCodeInBlock(block, liveness.out.get(block.id) ?? new Set()));
    const changed = newBlocks.some((b, i) => b !== fn.blocks[i]);
    return changed ? { ...fn, blocks: newBlocks } : fn;
  },
};
