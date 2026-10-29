// ─────────────────────────────────────────────────────────────────────────────
// UR LLVM Backend — Shared Types
// Design: docs/proposals/LLVM_BACKEND_DESIGN_PROPOSAL.md
// ─────────────────────────────────────────────────────────────────────────────
//
// Real, typed, in-memory LLVM object model. Builder produces ONLY
// these real objects — never text. Printer is the ONLY stage that
// converts these objects to .ll text.

export type LLVMType = "i64" | "i32" | "i1" | "void" | "ptr";

export type LLVMICmpPredicate = "eq" | "ne" | "slt" | "sle" | "sgt" | "sge";

export type LLVMInstruction =
  | { readonly kind: "const_i64"; readonly id: number; readonly value: bigint }
  | { readonly kind: "add"; readonly id: number; readonly left: LLVMValueRef; readonly right: LLVMValueRef }
  | { readonly kind: "alloca"; readonly id: number; readonly allocatedType: LLVMType }
  | { readonly kind: "load"; readonly id: number; readonly type: LLVMType; readonly pointer: LLVMValueRef }
  | { readonly kind: "store"; readonly value: LLVMValueRef; readonly pointer: LLVMValueRef }
  | { readonly kind: "icmp"; readonly id: number; readonly predicate: LLVMICmpPredicate; readonly left: LLVMValueRef; readonly right: LLVMValueRef };

export type LLVMValueRef =
  | { readonly kind: "ref"; readonly id: number }
  | { readonly kind: "immediate"; readonly value: bigint };

/** A basic block's own real terminator. Builder currently produces 'ret'/'br'/'condBr'. */
export type LLVMTerminator =
  | { readonly kind: "ret"; readonly value: LLVMValueRef }
  | { readonly kind: "br"; readonly target: string }
  | { readonly kind: "condBr"; readonly condition: LLVMValueRef; readonly trueTarget: string; readonly falseTarget: string };

export interface LLVMBasicBlock {
  readonly label: string;
  readonly instructions: readonly LLVMInstruction[];
  readonly terminator: LLVMTerminator;
}

export interface LLVMFunction {
  readonly name: string;
  readonly returnType: LLVMType;
  readonly params: readonly { readonly name: string; readonly type: LLVMType }[];
  readonly blocks: readonly LLVMBasicBlock[];
}

export interface LLVMModule {
  readonly functions: readonly LLVMFunction[];
}
