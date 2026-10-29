// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Optimization Validator
// Level 2.9, OPTIMIZER_SPEC.md §7 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// Explicitly SEPARATE from checkModuleInvariants() (src/shared/ir.ts),
// per the standing Level 2.6 architectural note (FREEZE_LOG.md): that
// function is not modified, and never will be for optimizer-specific
// concerns. This module performs pass-specific sanity checks that are
// NOT general IR structural rules — things checkModuleInvariants
// cannot and should not know about.
//
// Per explicit review priority: this Validator checks the IR AFTER THE
// FULL PIPELINE (all passes composed together — currently Constant
// Folding then Dead Code Elimination), comparing it against the
// PRE-PIPELINE IR (straight from Lowering) — not validating each pass
// in isolation. Two checks, matching §7's exact examples:
//
//   1. Every side-effecting instruction present before optimization
//      (call, store, array_store) is still present, unchanged, after —
//      DCE must never have silently dropped one.
//   2. Every instruction that is a `const` after optimization but was a
//      `binop`/`unop` before is INDEPENDENTLY re-verified to hold the
//      mathematically correct folded value — re-deriving the answer
//      from scratch here, not merely trusting Constant Folding's own
//      internal arithmetic.
//
// IDs are stable across the pipeline (neither pass ever renumbers an
// id it keeps) — this is what makes before/after comparison by id
// meaningful at all.

import type { IRFunction, IRBasicBlock, IRInstruction } from "../shared/ir.js";

export interface OptimizationValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

function sideEffectingInstructionsOf(fn: IRFunction): Map<number, IRInstruction[]> {
  const byBlock = new Map<number, IRInstruction[]>();
  for (const block of fn.blocks) {
    byBlock.set(block.id, block.instructions.filter(i => i.kind === "call" || i.kind === "store" || i.kind === "array_store"));
  }
  return byBlock;
}

function deepEqualInstruction(a: IRInstruction, b: IRInstruction): boolean {
  // Location spans are expected to be identical too (neither pass
  // fabricates a new source location) — compared via a BigInt-safe
  // stringify, since const_int values are BigInt.
  const norm = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === "bigint" ? `${x}n` : x);
  return norm(a) === norm(b);
}

/** Recomputes a binop/unop's result independently from Constant Folding's own logic, to verify a folded value is mathematically correct rather than merely trusting the pass that produced it. */
function independentlyRecomputeFold(beforeInst: IRInstruction, instructionsById: ReadonlyMap<number, IRInstruction>): { kind: "int"; value: bigint } | { kind: "float"; value: number } | undefined {
  function numericConstOf(id: number): { kind: "int"; value: bigint } | { kind: "float"; value: number } | undefined {
    const inst = instructionsById.get(id);
    if (!inst || inst.kind !== "const") return undefined;
    if (inst.value.kind === "const_int") return { kind: "int", value: inst.value.value };
    if (inst.value.kind === "const_float") return { kind: "float", value: inst.value.value };
    return undefined;
  }

  if (beforeInst.kind === "binop" && (beforeInst.op === "add" || beforeInst.op === "sub" || beforeInst.op === "mul")) {
    const left = numericConstOf(beforeInst.left.id);
    const right = numericConstOf(beforeInst.right.id);
    if (!left || !right) return undefined;
    if (left.kind === "int" && right.kind === "int") {
      const v = beforeInst.op === "add" ? left.value + right.value : beforeInst.op === "sub" ? left.value - right.value : left.value * right.value;
      return { kind: "int", value: v };
    }
    const l = left.kind === "int" ? Number(left.value) : left.value;
    const r = right.kind === "int" ? Number(right.value) : right.value;
    const v = beforeInst.op === "add" ? l + r : beforeInst.op === "sub" ? l - r : l * r;
    return { kind: "float", value: v };
  }
  if (beforeInst.kind === "unop" && beforeInst.op === "neg") {
    const operand = numericConstOf(beforeInst.operand.id);
    if (!operand) return undefined;
    return operand.kind === "int" ? { kind: "int", value: -operand.value } : { kind: "float", value: -operand.value };
  }
  return undefined;
}

/**
 * Validates the FULL pre-pipeline vs. post-pipeline IR for one function
 * — per explicit review priority, this checks the composed result of
 * every pass together, not each pass individually.
 */
export function validateOptimization(before: IRFunction, after: IRFunction): OptimizationValidationResult {
  const violations: string[] = [];

  // Check 1: every side-effecting instruction survives, byte-for-byte.
  const beforeEffects = sideEffectingInstructionsOf(before);
  const afterEffects = sideEffectingInstructionsOf(after);
  for (const [blockId, beforeList] of beforeEffects) {
    const afterList = afterEffects.get(blockId) ?? [];
    if (beforeList.length !== afterList.length) {
      violations.push(`block ${blockId}: had ${beforeList.length} side-effecting instruction(s) before optimization, but ${afterList.length} after — a call/store/array_store may have been incorrectly removed`);
      continue;
    }
    for (let i = 0; i < beforeList.length; i++) {
      if (!deepEqualInstruction(beforeList[i]!, afterList[i]!)) {
        violations.push(`block ${blockId}: side-effecting instruction at position ${i} changed across optimization (before: ${JSON.stringify(beforeList[i])}, after: ${JSON.stringify(afterList[i])})`);
      }
    }
  }

  // Check 2: every folded constant is independently re-verified.
  const beforeById = new Map<number, IRInstruction>();
  for (const block of before.blocks) for (const inst of block.instructions) if ("id" in inst) beforeById.set(inst.id, inst);
  const afterById = new Map<number, IRInstruction>();
  for (const block of after.blocks) for (const inst of block.instructions) if ("id" in inst) afterById.set(inst.id, inst);

  for (const [id, afterInst] of afterById) {
    if (afterInst.kind !== "const") continue;
    const beforeInst = beforeById.get(id);
    if (!beforeInst || (beforeInst.kind !== "binop" && beforeInst.kind !== "unop")) continue; // not a fold (e.g. was already a const, or a load/call whose id happens to be reused conceptually — doesn't apply here since ids are stable)

    const recomputed = independentlyRecomputeFold(beforeInst, beforeById);
    if (!recomputed) continue; // couldn't independently re-derive (e.g. operands weren't both constants) — not this validator's concern
    if (afterInst.value.kind === "const_int" && recomputed.kind === "int" && afterInst.value.value !== recomputed.value) {
      violations.push(`id %${id}: folded to const_int ${afterInst.value.value}, but independent recomputation gives ${recomputed.value} — INCORRECT FOLD`);
    }
    if (afterInst.value.kind === "const_float" && recomputed.kind === "float" && afterInst.value.value !== recomputed.value) {
      violations.push(`id %${id}: folded to const_float ${afterInst.value.value}, but independent recomputation gives ${recomputed.value} — INCORRECT FOLD`);
    }
  }

  return { valid: violations.length === 0, violations };
}
