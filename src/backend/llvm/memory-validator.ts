// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Memory Model Validator
// ─────────────────────────────────────────────────────────────────────────────
//
// Real checks: slot exists; no load before first store to the same
// slot (evaluated along each real DFS execution path from entry, not
// per-block in isolation); no store to unknown slot; slot ids/names
// unique within the function.

import type { IRModule, IRFunction, IRBasicBlock } from "../../shared/ir.js";

export interface LLVMValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateMemoryModel(module: IRModule): LLVMValidationResult {
  const errors: string[] = [];
  for (const fn of module.functions) {
    validateFunctionMemoryModel(fn, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateFunctionMemoryModel(fn: IRFunction, errors: string[]): void {
  const seenIds = new Set<number>();
  const seenNames = new Set<string>();
  for (const slot of fn.locals) {
    if (seenIds.has(slot.id)) {
      errors.push(`function '${fn.sourceName}': duplicate local slot id ${slot.id}.`);
    }
    seenIds.add(slot.id);
    if (seenNames.has(slot.name)) {
      errors.push(`function '${fn.sourceName}': duplicate local slot name '${slot.name}'.`);
    }
    seenNames.add(slot.name);
  }

  const knownSlotIds = new Set(fn.locals.map(s => s.id));

  if (fn.blocks.length === 1) {
    validateBlockMemoryModel(fn.sourceName, fn.blocks[0]!, knownSlotIds, new Set(), errors);
    return;
  }

  const blockById = new Map(fn.blocks.map(b => [b.id, b] as const));
  const visitedWithState = new Set<string>();
  function walk(blockId: number, storedSlots: ReadonlySet<number>): void {
    const block = blockById.get(blockId);
    if (block === undefined) return;
    const stateKey = `${blockId}:${[...storedSlots].sort().join(",")}`;
    if (visitedWithState.has(stateKey)) return;
    visitedWithState.add(stateKey);

    const storedAfterThisBlock = new Set(storedSlots);
    validateBlockMemoryModel(fn.sourceName, block, knownSlotIds, storedAfterThisBlock, errors);

    const t = block.terminator;
    if (t.kind === "branch") {
      walk((t as { target: number }).target, storedAfterThisBlock);
    } else if (t.kind === "cond_branch") {
      const ct = t as { thenTarget: number; elseTarget: number };
      walk(ct.thenTarget, storedAfterThisBlock);
      walk(ct.elseTarget, storedAfterThisBlock);
    }
  }
  walk(fn.entryBlock, new Set());
}

function validateBlockMemoryModel(fnName: string, block: IRBasicBlock, knownSlotIds: ReadonlySet<number>, storedSlots: Set<number>, errors: string[]): void {
  for (const inst of block.instructions) {
    if (inst.kind === "load") {
      if (!knownSlotIds.has(inst.slot)) {
        errors.push(`function '${fnName}': load references slot ${inst.slot}, which does not exist.`);
        continue;
      }
      if (!storedSlots.has(inst.slot)) {
        errors.push(`function '${fnName}': load from slot ${inst.slot} occurs before any store to it.`);
      }
    } else if (inst.kind === "store") {
      if (!knownSlotIds.has(inst.slot)) {
        errors.push(`function '${fnName}': store targets slot ${inst.slot}, which does not exist.`);
        continue;
      }
      storedSlots.add(inst.slot);
    }
  }
}
