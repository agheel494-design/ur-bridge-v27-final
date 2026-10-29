// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Control Flow Validator
// ─────────────────────────────────────────────────────────────────────────────
//
// Real checks: no branch to a nonexistent block; no block with an
// empty label; no duplicate block labels; a single entry block; every
// block ends with a terminator.

import type { LLVMModule, LLVMFunction, LLVMBasicBlock } from "./types.js";

export interface LLVMValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateControlFlow(module: LLVMModule): LLVMValidationResult {
  const errors: string[] = [];
  for (const fn of module.functions) {
    validateFunctionControlFlow(fn, errors);
  }
  return { ok: errors.length === 0, errors };
}

function validateFunctionControlFlow(fn: LLVMFunction, errors: string[]): void {
  const seenLabels = new Set<string>();
  let entryCount = 0;

  for (const block of fn.blocks) {
    if (block.label === undefined || block.label === null || block.label === "") {
      errors.push(`LLVM function '${fn.name}': a basic block has no label.`);
      continue;
    }
    if (seenLabels.has(block.label)) {
      errors.push(`LLVM function '${fn.name}': duplicate basic block label '${block.label}'.`);
    }
    seenLabels.add(block.label);
    if (block.label === "entry") entryCount++;
    if (block.terminator === undefined || block.terminator === null) {
      errors.push(`LLVM function '${fn.name}', block '${block.label}': has no terminator.`);
    }
  }

  if (entryCount > 1) {
    errors.push(`LLVM function '${fn.name}': ${entryCount} blocks are labeled 'entry' - a function must have exactly one entry block.`);
  }

  const knownLabels = new Set(fn.blocks.map(b => b.label));
  for (const block of fn.blocks) {
    checkBranchTargets(fn.name, block, knownLabels, errors);
  }
}

function checkBranchTargets(fnName: string, block: LLVMBasicBlock, knownLabels: ReadonlySet<string>, errors: string[]): void {
  const term = block.terminator;
  if (term.kind === "br") {
    if (!knownLabels.has(term.target)) {
      errors.push(`LLVM function '${fnName}', block '${block.label}': branches to '${term.target}', which is not a real block.`);
    }
  } else if (term.kind === "condBr") {
    if (!knownLabels.has(term.trueTarget)) {
      errors.push(`LLVM function '${fnName}', block '${block.label}': conditional branch's true-target '${term.trueTarget}' is not a real block.`);
    }
    if (!knownLabels.has(term.falseTarget)) {
      errors.push(`LLVM function '${fnName}', block '${block.label}': conditional branch's false-target '${term.falseTarget}' is not a real block.`);
    }
  }
}
