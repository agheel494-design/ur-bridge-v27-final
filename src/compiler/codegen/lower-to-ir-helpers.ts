// ─────────────────────────────────────────────────────────────────────────────
// UR — Compiler Pipeline: IR Lowering — shared helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Extracted from lower-to-ir.ts (Architecture Freeze Audit). Both
// lower-to-ir.ts (lowerToIR itself) and ir-builder.ts (class IRBuilder)
// need these three functions - living in a third, shared file avoids a
// real (non-type-only) circular dependency between the other two.

import type { BlockStatement, IfStatement, Statement } from "../frontend/ast.js";
import { T_INT, T_FLOAT, T_BOOL, T_STRING, T_CHAR, T_UNKNOWN, tArray, tStruct, type URType } from "../typesystem/types.js";
import type { IRType, IRBinOp, IRUnOp, IRValueRef } from "../../shared/ir.js";

export function toIRType(t: URType): IRType {
  if (t.kind === "Primitive") {
    switch (t.name) {
      case "Int":    return "i64";
      case "Float":  return "f64";
      case "Bool":   return "bool";
      case "String": return "string";
      case "Char":   return "i64"; // V1-STABILIZATION-S1 (ratified Design): char is a Unicode scalar value (U+0000..U+10FFFF) per UR_LANGUAGE_SPEC_1_0.md §6.1 — represented as a real integer, matching Byte's own already-established i64 mapping, not a string
      case "Byte":   return "i64"; // Byte has no dedicated IR type in this phase; treated as a general integer, matching Int — range-checking (0-255) is a Tier 1 type-checker concern, not an IR representation concern
      case "NativePtr": return "ptr"; // Native Pointer ABI Gate B (authorized, narrow scope) — opaque foreign-pointer handle, Native FFI boundary only
    }
  }
  if (t.kind === "Unknown") return "void"; // convention: no return-type annotation → resolveOptionalTypeRef returns T_UNKNOWN
  // Gate R1-F: URType.kind === "Array" maps to the IR's own existing,
  // already-used "array_ref" representation — the same mapping
  // already applied at three other call sites in ir-builder.ts
  // (`kind === "Array" ? "array_ref" : toIRType(...)`), confirmed
  // directly (Gate R1.4) to be the established, correct pattern for
  // this exact case. This closes the one, precisely-localized gap
  // found by Gate R1.3 (an Array-kind return type previously fell
  // through to the "void" fallback below, since it was never an
  // explicitly handled case here).
  if (t.kind === "Array") return "array_ref";
  // Anything else (Map/Set/Tuple/Optional/Function/GenericParam/Error)
  // is out of scope for this phase — callers must check for CG1001 before
  // this would ever be reached for a well-scoped program.
  return "void";
}

export const BINOP_MAP: Record<string, IRBinOp> = {
  "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
  "==": "eq", "!=": "neq", "<": "lt", "<=": "lte", ">": "gt", ">=": "gte",
  "&&": "and", "||": "or",
};

export const UNOP_MAP: Record<string, IRUnOp> = { "-": "neg", "!": "not" };

// ── Lowering state ────────────────────────────────────────────────────────────

export type FnSignature = { qualifiedName: string; returnType: URType; paramTypes: URType[] };

/** A variable's current binding: either a plain SSA value (no branch has forced it into memory), or a slot-backed binding (reads become `load`, writes become `store`). */
export type VarBinding =
  | { readonly kind: "ssa"; readonly ref: IRValueRef }
  | { readonly kind: "slot"; readonly slotId: number };

/**
 * Collects the set of OUTER variable names reassigned anywhere inside a
 * block (recursively through nested if/else and while — a variable
 * reassigned inside a doubly-nested construct still needs promotion at
 * the OUTERMOST branch/loop that could make its value ambiguous at a
 * merge/loop-header point). Used to decide which variables must be
 * promoted to a local slot before lowering a branch's or loop's body —
 * see CFG_SPEC.md §1 for why this is needed instead of phi nodes. Only
 * plain-identifier assignment targets count (matching the existing
 * Level 2.1-2.5 scope: member/index assignment targets are already
 * rejected elsewhere as unsupported).
 *
 * Shared by both if/else (Phase 2.6.2) and while (Phase 2.6.3) — the
 * exact same mechanism, applied to whichever block(s) are conditionally/
 * repeatedly executed.
 */
export function collectAssignedNames(block: BlockStatement): Set<string> {
  const names = new Set<string>();
  function walkBlock(b: BlockStatement): void {
    for (const s of b.statements) walkStatement(s);
  }
  function walkStatement(s: Statement): void {
    if (s.kind === "Assignment" && s.target.kind === "Identifier") {
      names.add(s.target.name);
    } else if (s.kind === "IfStatement") {
      walkBlock(s.thenBranch);
      if (s.elseBranch) {
        if (s.elseBranch.kind === "IfStatement") walkStatement(s.elseBranch);
        else walkBlock(s.elseBranch);
      }
    } else if (s.kind === "WhileStatement") {
      walkBlock(s.body);
    } else if (s.kind === "ForStatement") {
      walkBlock(s.body);
    }
  }
  walkBlock(block);
  return names;
}

/** Convenience wrapper: the union of names assigned across both branches of an if/else (Phase 2.6.2 call site, unchanged in spirit from before this generalization). */
export function collectAssignedNamesInIf(stmt: import("../frontend/ast.js").IfStatement): Set<string> {
  const names = collectAssignedNames(stmt.thenBranch);
  if (stmt.elseBranch) {
    if (stmt.elseBranch.kind === "IfStatement") {
      for (const n of collectAssignedNamesInIf(stmt.elseBranch)) names.add(n);
    } else {
      for (const n of collectAssignedNames(stmt.elseBranch)) names.add(n);
    }
  }
  return names;
}

