// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Validator
// ─────────────────────────────────────────────────────────────────────────────
//
// Two real, distinct validation stages:
//   1. validateForLLVM(IRModule)      — PRE-build: general acyclic-CFG
//      check (return/cond_branch/branch terminators only, no cycles)
//      - supports straight-line, if-without-else, if-with-else,
//      nested-if, merge-after-branches. Rejects while/for/switch
//      (different terminator kinds entirely) and real loops (cycle
//      detection).
//   2. validateLLVMModule(LLVMModule) — POST-build: SSA/reference
//      well-formedness on the real, built LLVMModule object.
//
// TRANSITIONAL RULE (per explicit decision, NOT Dominance Analysis):
//   "Temporary Rule: Entry-defined values are treated as globally
//   visible only because the current CFG is acyclic and restricted.
//   This rule MUST be removed when full dominance analysis is
//   introduced."
// Scoped exactly: ONLY 'alloca' and 'const_i64' ids from the real
// entry block (fn.blocks[0]) are treated as visible everywhere else.
// Does NOT generalize to any then/else/merge-defined value.

import type { IRModule, IRFunction } from "../../shared/ir.js";
import type { LLVMModule, LLVMFunction, LLVMBasicBlock, LLVMValueRef } from "./types.js";

export interface LLVMValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

// ── Stage 1: pre-build IR-scope validation (general acyclic CFG) ────────────

export function validateForLLVM(module: IRModule): LLVMValidationResult {
  const errors: string[] = [];

  if (module.functions.length !== 1) {
    errors.push(`Phase 1 supports exactly one function (found ${module.functions.length}) - multi-function programs are deferred.`);
  }

  for (const fn of module.functions) {
    validateFunction(fn, errors);
  }

  return { ok: errors.length === 0, errors };
}

function validateFunction(fn: IRFunction, errors: string[]): void {
  if (fn.returnType !== "i64" && fn.returnType !== "bool") {
    errors.push(`function '${fn.sourceName}': Phase 1 only supports i64 or bool return type (found '${fn.returnType}') - other types are deferred.`);
  }
  if (fn.params.length !== 0) {
    errors.push(`function '${fn.sourceName}': Phase 1 supports zero-parameter functions only (found ${fn.params.length}) - parameters are deferred.`);
  }

  const blockById = new Map(fn.blocks.map(b => [b.id, b] as const));
  for (const block of fn.blocks) {
    validateBlockInstructions(fn.sourceName, block, errors);
    validateTerminatorKind(fn.sourceName, block, errors);
  }

  const cycleError = findRealCycle(fn.sourceName, fn.blocks, blockById);
  if (cycleError !== undefined) errors.push(cycleError);
}

function validateBlockInstructions(fnName: string, block: IRFunction["blocks"][number], errors: string[]): void {
  for (const inst of block.instructions) {
    if (inst.kind === "const") {
      if (inst.type !== "i64" || inst.value.kind !== "const_int") {
        errors.push(`function '${fnName}': Phase 1 only supports i64 integer constants (found a '${inst.type}' const of kind '${inst.value.kind}').`);
      }
    } else if (inst.kind === "binop") {
      const comparisonOps = new Set(["eq", "neq", "lt", "lte", "gt", "gte"]);
      if (inst.op !== "add" && !comparisonOps.has(inst.op)) {
        errors.push(`function '${fnName}': Phase 1 only supports the 'add' binop and i64 comparisons (eq/neq/lt/lte/gt/gte) (found '${inst.op}').`);
      }
      if (comparisonOps.has(inst.op) && inst.type !== "bool") {
        errors.push(`function '${fnName}': comparison binop '${inst.op}' must produce a 'bool' result (found '${inst.type}').`);
      }
    } else if (inst.kind === "load" || inst.kind === "store") {
      continue;
    } else {
      errors.push(`function '${fnName}': instruction kind '${inst.kind}' is not supported in Phase 1.`);
    }
  }
}

function validateTerminatorKind(fnName: string, block: IRFunction["blocks"][number], errors: string[]): void {
  const kind = block.terminator.kind;
  if (kind !== "return" && kind !== "cond_branch" && kind !== "branch") {
    errors.push(`function '${fnName}', block '${block.label}': Phase 1 only supports 'return'/'cond_branch'/'branch' terminators (found '${kind}') - while/for/switch are deferred.`);
  }
}

function findRealCycle(fnName: string, blocks: readonly IRFunction["blocks"][number][], blockById: ReadonlyMap<number, IRFunction["blocks"][number]>): string | undefined {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>(blocks.map(b => [b.id, WHITE] as const));

  function successors(block: IRFunction["blocks"][number]): number[] {
    const t = block.terminator;
    if (t.kind === "branch") return [(t as { target: number }).target];
    if (t.kind === "cond_branch") {
      const ct = t as { thenTarget: number; elseTarget: number };
      return [ct.thenTarget, ct.elseTarget];
    }
    return [];
  }

  function dfs(blockId: number): string | undefined {
    color.set(blockId, GRAY);
    const block = blockById.get(blockId);
    if (block !== undefined) {
      for (const succ of successors(block)) {
        const succColor = color.get(succ);
        if (succColor === GRAY) {
          return `function '${fnName}': the block graph contains a real cycle (a loop) - while/for loops are explicitly out of scope for this Milestone.`;
        }
        if (succColor === WHITE) {
          const result = dfs(succ);
          if (result !== undefined) return result;
        }
      }
    }
    color.set(blockId, BLACK);
    return undefined;
  }

  for (const block of blocks) {
    if (color.get(block.id) === WHITE) {
      const result = dfs(block.id);
      if (result !== undefined) return result;
    }
  }
  return undefined;
}

// ── Stage 2: post-build LLVM Module structural/SSA validation ───────────────

export function validateLLVMModule(module: LLVMModule): LLVMValidationResult {
  const errors: string[] = [];
  for (const fn of module.functions) {
    validateLLVMFunction(fn, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateLLVMFunction(fn: LLVMFunction, errors: string[]): void {
  if (fn.blocks.length === 0) {
    errors.push(`LLVM function '${fn.name}': has zero basic blocks.`);
    return;
  }

  // TRANSITIONAL RULE: only alloca/const_i64 ids from the real entry
  // block (fn.blocks[0]) are pre-defined for every OTHER block.
  const entryBlock = fn.blocks[0]!;
  const entryGloballyVisibleIds = new Set<number>();
  for (const inst of entryBlock.instructions) {
    if (inst.kind === "alloca" || inst.kind === "const_i64") {
      entryGloballyVisibleIds.add(inst.id);
    }
  }

  for (const block of fn.blocks) {
    const preDefinedIds = block === entryBlock ? new Set<number>() : entryGloballyVisibleIds;
    validateLLVMBlock(fn.name, block, preDefinedIds, errors);
  }
}

function validateLLVMBlock(fnName: string, block: LLVMBasicBlock, preDefinedIds: ReadonlySet<number>, errors: string[]): void {
  if (block.terminator === undefined || block.terminator === null) {
    errors.push(`LLVM function '${fnName}', block '${block.label}': has no terminator.`);
    return;
  }

  const definedIds = new Set<number>(preDefinedIds);
  for (const inst of block.instructions) {
    for (const ref of instructionOperandRefs(inst)) {
      checkRef(fnName, block.label, ref, definedIds, errors);
    }
    const definedId = instructionDefinedId(inst);
    if (definedId !== undefined) {
      if (definedIds.has(definedId) && !preDefinedIds.has(definedId)) {
        errors.push(`LLVM function '${fnName}', block '${block.label}': SSA violation - %${definedId} is defined more than once.`);
      }
      definedIds.add(definedId);
    }
  }
  if (block.terminator.kind === "ret") {
    checkRef(fnName, block.label, block.terminator.value, definedIds, errors);
  } else if (block.terminator.kind === "condBr") {
    checkRef(fnName, block.label, block.terminator.condition, definedIds, errors);
  }
}

function instructionOperandRefs(inst: LLVMBasicBlock["instructions"][number]): readonly LLVMValueRef[] {
  if (inst.kind === "add") return [inst.left, inst.right];
  if (inst.kind === "load") return [inst.pointer];
  if (inst.kind === "store") return [inst.value, inst.pointer];
  if (inst.kind === "icmp") return [inst.left, inst.right];
  return [];
}

function instructionDefinedId(inst: LLVMBasicBlock["instructions"][number]): number | undefined {
  if (inst.kind === "store") return undefined;
  return inst.id;
}

function checkRef(fnName: string, blockLabel: string, ref: LLVMValueRef, definedIds: ReadonlySet<number>, errors: string[]): void {
  if (ref.kind === "immediate") return;
  if (!definedIds.has(ref.id)) {
    errors.push(`LLVM function '${fnName}', block '${blockLabel}': invalid reference - %${ref.id} is used but was never defined (a dangling SSA reference).`);
  }
}
