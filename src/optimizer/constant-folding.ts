// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Constant Folding
// Level 2.9, OPTIMIZER_SPEC.md §6.1 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// FIFTH item from OPTIMIZER_SPEC.md §2.1's fixed pipeline, and the
// FIRST real optimization pass, per the review-mandated one-item-per-
// batch execution rule. Deliberately minimal scope for this first
// batch (per explicit review narrowing):
//
//   ✅ const_int / const_float operands only
//   ✅ add, sub, mul (both int and float)
//   ✅ neg (unary minus) on const_int / const_float
//   ❌ div / mod — NOT folded (zero-divisor case deferred; see
//      RUNTIME_SPEC.md §7.3 — the Optimizer must never silently decide
//      what a folded division-by-zero "would have" done)
//   ❌ Boolean simplification (and/or/not on const_bool) — deferred
//   ❌ Comparison folding (eq/neq/lt/lte/gt/gte on constants) — deferred
//   ❌ Branch folding / if(true) simplification — a DIFFERENT, later
//      pass (Control Flow Simplification), never mixed into this one
//
// PURELY LOCAL (per §6.1): never touches block structure, never adds
// or removes a block, never evaluates or simplifies control flow — the
// entire transformation is "replace this one instruction's definition
// with an equivalent const", nothing else.
//
// Implements the OptimizationPass contract (§2.2): input/output are
// both structurally valid IRFunctions; changing an instruction's
// definition to an equivalent constant is squarely within "Allowed";
// nothing here touches ABI, Runtime calls, or the Builtins Registry.

import type { IRFunction, IRBasicBlock, IRInstruction, IRConstant } from "../shared/ir.js";
import type { OptimizationPass } from "./pass.js";

type NumericConst = Extract<IRConstant, { kind: "const_int" | "const_float" }>;

function asNumericConst(instructionsById: ReadonlyMap<number, IRInstruction>, id: number): NumericConst | undefined {
  const inst = instructionsById.get(id);
  if (!inst || inst.kind !== "const") return undefined;
  if (inst.value.kind !== "const_int" && inst.value.kind !== "const_float") return undefined;
  return inst.value;
}

/** Folds one binop instruction if both operands are numeric constants and the operator is add/sub/mul. Returns undefined if not eligible (the instruction is left untouched by the caller). */
function foldBinop(
  instructionsById: ReadonlyMap<number, IRInstruction>,
  inst: Extract<IRInstruction, { kind: "binop" }>,
): IRInstruction | undefined {
  if (inst.op !== "add" && inst.op !== "sub" && inst.op !== "mul") return undefined; // scope: no div/mod in this batch

  const left = asNumericConst(instructionsById, inst.left.id);
  const right = asNumericConst(instructionsById, inst.right.id);
  if (!left || !right) return undefined;

  // Both int: fold in BigInt arithmetic (matches the IR's own const_int representation).
  if (left.kind === "const_int" && right.kind === "const_int") {
    const result = inst.op === "add" ? left.value + right.value
      : inst.op === "sub" ? left.value - right.value
      : left.value * right.value;
    return { kind: "const", id: inst.id, type: "i64", value: { kind: "const_int", value: result }, location: inst.location };
  }

  // Otherwise, at least one is float — the existing TypeChecker/Lowering
  // pipeline never mixes int and float in a single binop without an
  // explicit widening already resolved before Lowering (int -> float),
  // so by the time IR exists, both operands share IRType "f64" whenever
  // either operand is const_float. Fold in plain JS number arithmetic.
  const leftNum = left.kind === "const_int" ? Number(left.value) : left.value;
  const rightNum = right.kind === "const_int" ? Number(right.value) : right.value;
  const result = inst.op === "add" ? leftNum + rightNum
    : inst.op === "sub" ? leftNum - rightNum
    : leftNum * rightNum;
  return { kind: "const", id: inst.id, type: "f64", value: { kind: "const_float", value: result }, location: inst.location };
}

/** Folds one unop instruction if the operand is a numeric constant and the operator is neg (unary minus). Returns undefined if not eligible. */
function foldUnop(
  instructionsById: ReadonlyMap<number, IRInstruction>,
  inst: Extract<IRInstruction, { kind: "unop" }>,
): IRInstruction | undefined {
  if (inst.op !== "neg") return undefined; // scope: 'not' (boolean) is out of scope for this batch

  const operand = asNumericConst(instructionsById, inst.operand.id);
  if (!operand) return undefined;

  if (operand.kind === "const_int") {
    return { kind: "const", id: inst.id, type: "i64", value: { kind: "const_int", value: -operand.value }, location: inst.location };
  }
  return { kind: "const", id: inst.id, type: "f64", value: { kind: "const_float", value: -operand.value }, location: inst.location };
}

function foldBlock(block: IRBasicBlock, instructionsById: ReadonlyMap<number, IRInstruction>): IRBasicBlock {
  const newInstructions = block.instructions.map(inst => {
    if (inst.kind === "binop") return foldBinop(instructionsById, inst) ?? inst;
    if (inst.kind === "unop") return foldUnop(instructionsById, inst) ?? inst;
    return inst;
  });
  // Only allocate a new block object if something actually changed —
  // keeps the pass a true no-op (same reference) for functions with
  // nothing to fold, matching the Pass Framework's own no-op behavior.
  const changed = newInstructions.some((inst, i) => inst !== block.instructions[i]);
  return changed ? { ...block, instructions: newInstructions } : block;
}

export const constantFoldingPass: OptimizationPass = {
  name: "constant-folding",
  run(fn: IRFunction): IRFunction {
    // CONFIRMED LIMITATION (fixed): a single sweep over instructions
    // using ONE snapshot of instruction definitions cannot fold a
    // chained constant expression like `(2 + 3) * 4` down to a single
    // constant in one pass — the outer `* 4` looks up its left operand
    // in the snapshot, which still shows the ORIGINAL, unfolded `2 + 3`
    // binop (found via direct testing, not assumed). Fixed by iterating
    // the fold-and-rebuild-snapshot cycle to a local fixed point within
    // this single run() call — still purely local (no CFG/dataflow
    // involvement whatsoever), simply converging chained arithmetic
    // constants fully rather than leaving them partially folded.
    let current = fn;
    while (true) {
      const instructionsById = new Map<number, IRInstruction>();
      for (const block of current.blocks) {
        for (const inst of block.instructions) {
          if ("id" in inst) instructionsById.set(inst.id, inst);
        }
      }

      const newBlocks = current.blocks.map(block => foldBlock(block, instructionsById));
      const changed = newBlocks.some((b, i) => b !== current.blocks[i]);
      if (!changed) return current; // fixed point reached (or nothing to fold at all)
      current = { ...current, blocks: newBlocks };
    }
  },
};
