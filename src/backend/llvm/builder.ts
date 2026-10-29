// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Builder
// ─────────────────────────────────────────────────────────────────────────────
//
// Produces ONLY real, typed LLVM objects - never text.

import type { IRModule, IRFunction, IRInstruction } from "../../shared/ir.js";
import type { LLVMModule, LLVMInstruction, LLVMValueRef, LLVMTerminator, LLVMType } from "./types.js";
import { validateForLLVM, validateLLVMModule } from "./validator.js";
import { validateMemoryModel } from "./memory-validator.js";
import { validateControlFlow } from "./control-flow-validator.js";
import { LLVMModuleAssembler, LLVMFunctionAssembler } from "./module.js";

const COMPARISON_OP_TO_LLVM_PREDICATE: Record<string, "eq" | "ne" | "slt" | "sle" | "sgt" | "sge"> = {
  eq: "eq", neq: "ne", lt: "slt", lte: "sle", gt: "sgt", gte: "sge",
};

export function buildLLVMModule(module: IRModule): LLVMModule {
  const memoryValidation = validateMemoryModel(module);
  if (!memoryValidation.ok) {
    throw new Error(`LLVM Backend Builder: cannot build - memory model violation(s) - ${memoryValidation.errors.join("; ")}`);
  }

  const preValidation = validateForLLVM(module);
  if (!preValidation.ok) {
    throw new Error(`LLVM Backend Builder: cannot build - ${preValidation.errors.join("; ")}`);
  }

  const moduleAssembler = new LLVMModuleAssembler();
  for (const fn of module.functions) {
    moduleAssembler.addFunction(buildFunction(fn));
  }
  const built = moduleAssembler.finish();

  const postValidation = validateLLVMModule(built);
  if (!postValidation.ok) {
    throw new Error(`LLVM Backend Builder: internal error - built an invalid LLVMModule - ${postValidation.errors.join("; ")}`);
  }

  const cfgValidation = validateControlFlow(built);
  if (!cfgValidation.ok) {
    throw new Error(`LLVM Backend Builder: internal error - built an LLVMModule with control-flow violations - ${cfgValidation.errors.join("; ")}`);
  }

  return built;
}

function irTypeToLLVM(type: string): LLVMType {
  if (type === "i64") return "i64";
  throw new Error(`LLVM Backend Builder: internal error - unsupported IRType '${type}' reached the Builder`);
}

function buildFunction(fn: IRFunction) {
  const llvmReturnType: LLVMType = fn.returnType === "bool" ? "i1" : "i64";
  const assembler = new LLVMFunctionAssembler(fn.sourceName, llvmReturnType, []);

  // Unique labels across the whole function - real fix for nested-if
  // label collisions (multiple "then"/"else"/"merge" blocks across
  // nesting levels): the block's own real, unique id is appended.
  const blockIdToLabel = new Map<number, string>(fn.blocks.map(b => [b.id, `${b.label}_${b.id}`] as const));

  const idMap = new Map<number, LLVMValueRef>();
  const slotToAllocaId = new Map<number, number>();
  let nextLLVMId = 0;
  const allBlockInstructions = new Map<number, LLVMInstruction[]>();

  function refFor(irId: number): LLVMValueRef {
    const ref = idMap.get(irId);
    if (ref === undefined) throw new Error(`LLVM Backend Builder: internal error - no LLVM value built yet for IR id ${irId}`);
    return ref;
  }

  // alloca is always allocated once, lazily, and its instruction is
  // recorded into entry's own instruction list (block id === fn.entryBlock)
  // regardless of which block first references the slot - matching
  // the Transitional Entry Visibility Rule's own real requirement
  // that alloca lives in entry.
  function allocaRefForSlot(slot: number): LLVMValueRef {
    let allocaId = slotToAllocaId.get(slot);
    if (allocaId === undefined) {
      allocaId = nextLLVMId++;
      const entryInstructions = allBlockInstructions.get(fn.entryBlock)!;
      entryInstructions.push({ kind: "alloca", id: allocaId, allocatedType: "i64" });
      slotToAllocaId.set(slot, allocaId);
    }
    return { kind: "ref", id: allocaId };
  }

  for (const block of fn.blocks) {
    allBlockInstructions.set(block.id, []);
  }

  for (const block of fn.blocks) {
    const llvmInstructions = allBlockInstructions.get(block.id)!;
    for (const inst of block.instructions as readonly IRInstruction[]) {
      if (inst.kind === "const") {
        const value = BigInt((inst.value as { kind: "const_int"; value: bigint }).value);
        idMap.set(inst.id, { kind: "immediate", value });
        llvmInstructions.push({ kind: "const_i64", id: nextLLVMId++, value });
      } else if (inst.kind === "binop") {
        const left = refFor(inst.left.id);
        const right = refFor(inst.right.id);
        const llvmId = nextLLVMId++;
        const predicate = COMPARISON_OP_TO_LLVM_PREDICATE[inst.op];
        if (predicate !== undefined) {
          llvmInstructions.push({ kind: "icmp", id: llvmId, predicate, left, right });
        } else {
          llvmInstructions.push({ kind: "add", id: llvmId, left, right });
        }
        idMap.set(inst.id, { kind: "ref", id: llvmId });
      } else if (inst.kind === "load") {
        const pointer = allocaRefForSlot(inst.slot);
        const llvmId = nextLLVMId++;
        llvmInstructions.push({ kind: "load", id: llvmId, type: irTypeToLLVM(inst.type), pointer });
        idMap.set(inst.id, { kind: "ref", id: llvmId });
      } else if (inst.kind === "store") {
        const pointer = allocaRefForSlot(inst.slot);
        const value = refFor(inst.value.id);
        llvmInstructions.push({ kind: "store", value, pointer });
      }
    }
  }

  for (const block of fn.blocks) {
    const terminator = buildTerminator(block.terminator, blockIdToLabel, refFor);
    assembler.addBlock({ label: blockIdToLabel.get(block.id)!, instructions: allBlockInstructions.get(block.id)!, terminator });
  }

  return assembler.finish();
}

function buildTerminator(irTerminator: IRFunction["blocks"][number]["terminator"], blockIdToLabel: ReadonlyMap<number, string>, refFor: (id: number) => LLVMValueRef): LLVMTerminator {
  if (irTerminator.kind === "return") {
    const t = irTerminator as { kind: "return"; value: { id: number } };
    return { kind: "ret", value: refFor(t.value.id) };
  }
  if (irTerminator.kind === "cond_branch") {
    const t = irTerminator as { kind: "cond_branch"; condition: { id: number }; thenTarget: number; elseTarget: number };
    const trueLabel = blockIdToLabel.get(t.thenTarget);
    const falseLabel = blockIdToLabel.get(t.elseTarget);
    if (trueLabel === undefined || falseLabel === undefined) {
      throw new Error(`LLVM Backend Builder: internal error - cond_branch targets a block id with no known label`);
    }
    return { kind: "condBr", condition: refFor(t.condition.id), trueTarget: trueLabel, falseTarget: falseLabel };
  }
  if (irTerminator.kind === "branch") {
    const t = irTerminator as { kind: "branch"; target: number };
    const targetLabel = blockIdToLabel.get(t.target);
    if (targetLabel === undefined) {
      throw new Error(`LLVM Backend Builder: internal error - branch targets a block id with no known label`);
    }
    return { kind: "br", target: targetLabel };
  }
  throw new Error(`LLVM Backend Builder: internal error - unsupported terminator kind '${irTerminator.kind}' reached the Builder`);
}
