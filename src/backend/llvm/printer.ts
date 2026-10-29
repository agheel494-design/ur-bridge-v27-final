// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Printer
// ─────────────────────────────────────────────────────────────────────────────

import type { LLVMModule, LLVMFunction, LLVMBasicBlock, LLVMInstruction, LLVMValueRef, LLVMType } from "./types.js";

function printType(type: LLVMType): string {
  return type === "ptr" ? "ptr" : type;
}

function printValueRef(ref: LLVMValueRef): string {
  return ref.kind === "immediate" ? ref.value.toString() : `%${ref.id}`;
}

function printInstruction(inst: LLVMInstruction): string {
  if (inst.kind === "const_i64") return "";
  if (inst.kind === "add") return `  %${inst.id} = add i64 ${printValueRef(inst.left)}, ${printValueRef(inst.right)}`;
  if (inst.kind === "alloca") return `  %${inst.id} = alloca ${printType(inst.allocatedType)}`;
  if (inst.kind === "load") return `  %${inst.id} = load ${printType(inst.type)}, ptr ${printValueRef(inst.pointer)}`;
  if (inst.kind === "icmp") return `  %${inst.id} = icmp ${inst.predicate} i64 ${printValueRef(inst.left)}, ${printValueRef(inst.right)}`;
  return `  store i64 ${printValueRef(inst.value)}, ptr ${printValueRef(inst.pointer)}`;
}

function printBlock(block: LLVMBasicBlock, returnType: LLVMType): string {
  const lines: string[] = [`${block.label}:`];
  for (const inst of block.instructions) {
    const printed = printInstruction(inst);
    if (printed !== "") lines.push(printed);
  }
  const term = block.terminator;
  if (term.kind === "ret") {
    lines.push(`  ret ${printType(returnType)} ${printValueRef(term.value)}`);
  } else if (term.kind === "br") {
    lines.push(`  br label %${term.target}`);
  } else if (term.kind === "condBr") {
    lines.push(`  br i1 ${printValueRef(term.condition)}, label %${term.trueTarget}, label %${term.falseTarget}`);
  }
  return lines.join("\n");
}

function printFunction(fn: LLVMFunction): string {
  const params = fn.params.map(p => `i64 %${p.name}`).join(", ");
  const body = fn.blocks.map(b => printBlock(b, fn.returnType)).join("\n");
  return `define ${printType(fn.returnType)} @${fn.name}(${params}) {\n${body}\n}`;
}

export function printLLVMModule(module: LLVMModule): string {
  if (module.functions.length === 0) {
    return "; LLVM Backend - empty module (no functions)\n";
  }
  return module.functions.map(printFunction).join("\n\n") + "\n";
}
