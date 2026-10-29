// ─────────────────────────────────────────────────────────────────────────────
// UR — Semantic: Builtins Registry
// Level 2.5 — Builtins Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// A pure data table of builtin function signatures — completely separate
// from Semantic Analyzer's resolution LOGIC (semantic/index.ts). Adding,
// removing, or changing a builtin's arity requires ONLY an edit to this
// file; semantic/index.ts's walkCall() never special-cases any specific
// builtin name (no `if (name === "print")` anywhere) — it performs one
// generic lookup against this registry, exactly the same way it looks up
// user-declared functions in the scope table.
//
// Resolution order (semantic/index.ts's walkCall):
//   1. Symbol Table (user-declared functions/imports) — checked first,
//      so a user-defined function of the same name always takes
//      precedence over a builtin (consistent with the Lowering pass's
//      identical precedence rule in lower-to-ir.ts).
//   2. Builtins Registry (this file) — checked only if step 1 finds nothing.
//   3. SE1002 undefined function — if neither finds it.
//
// This registry mirrors (but is NOT the same file as, and NOT imported by)
// src/shared/runtime-table.ts's RUNTIME_CORE_EXTERNS. That table describes
// Runtime C functions (ur_print_int, ur_print_float, ...) — an IR/Backend
// concept. This registry describes UR-LANGUAGE builtin identifiers
// (print, input) — a Semantic concept. lower-to-ir.ts is the one place
// that bridges the two (dispatching a UR-level `print` call to the
// correct `ur_print_*` Runtime function based on argument type).
// ─────────────────────────────────────────────────────────────────────────────

import type { BuiltinId } from "../../shared/builtins.js";

export type BuiltinFunctionSignature = {
  readonly name: string;
  /** Fixed argument count this builtin requires. */
  readonly arity: number;
  /** The shared, Runtime-agnostic identifier this UR-source name maps to — see src/shared/builtins.ts. */
  readonly id: BuiltinId;
};

export const BUILTINS_REGISTRY: ReadonlyMap<string, BuiltinFunctionSignature> = new Map([
  ["print", { name: "print", arity: 1, id: "Print" }],
  ["input", { name: "input", arity: 0, id: "Input" }],
  ["free",  { name: "free",  arity: 1, id: "Free" }],
  ["call_external", { name: "call_external", arity: 4, id: "CallExternal" }],
]);

/** Looks up a builtin by name. Returns undefined if not a known builtin — callers fall through to their own "undefined function" handling. */
export function lookupBuiltin(name: string): BuiltinFunctionSignature | undefined {
  return BUILTINS_REGISTRY.get(name);
}
