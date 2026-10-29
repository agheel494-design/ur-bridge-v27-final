// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Runtime Core Function Table
// Level 2.4 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────
//
// The single source of truth for the Runtime Core function table specified
// in RUNTIME_SPEC.md §4.3. Both the Lowering pass (which populates
// IRModule.externs with these entries on every module) and the Backend
// (which emits matching C prototypes and wires the main() wrapper) import
// from here — neither hardcodes this table independently.
//
// SCOPE (Level 2.4, per approved implementation order): only
// ur_runtime_init/ur_runtime_shutdown are actually WIRED (called) by this
// phase's Backend — the print/input entries are declared here as part of
// the fixed contract, but no UR-level construct calls them yet (that is
// the explicitly later "print()/input()" step, per the approved order).
// Declaring the full table now, rather than only the two currently-wired
// entries, avoids a second IRModule.externs population pass later and
// matches RUNTIME_SPEC.md §4.3's table exactly.
// ─────────────────────────────────────────────────────────────────────────────

// CORRECTION found during implementation (documented, not silently
// fixed): the RUNTIME_SPEC.md §4.4 draft illustrated ur_runtime_init(void)
// directly referencing UR_RUNTIME_ABI_REQUIRED as if visible across
// translation units — this does not work in C (macros are per-translation-
// unit; ur_runtime.c cannot see a #define from the generated program's
// separately-compiled .c file). Fixed by passing the ABI-required value
// as a real function parameter: ur_runtime_init(int64_t abi_required).
// The generated main() wrapper passes its own UR_RUNTIME_ABI_REQUIRED
// macro value as this argument. See runtime/ur_runtime.c for the check.

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME AUDIT — Per-function usage status (updated whenever this table
// changes; see the Runtime Audit report for the full verification method).
//
//   Function              | Status
//   ----------------------|---------------------------------------------
//   ur_runtime_init       | CALLED — by Backend (emit-c.ts), discovered
//                         | via lifecycleRole === "init", never by name.
//   ur_runtime_shutdown   | CALLED — by Backend (emit-c.ts), discovered
//                         | via lifecycleRole === "shutdown".
//   ur_print_int          | RESERVED — not yet called by Lowering or
//   ur_print_float        | Backend. Wiring `print`/`اطبع` as a builtin
//   ur_print_bool         | identifier in lower-to-ir.ts is the next,
//   ur_print_string       | explicitly separate step (Level 2.5).
//   ur_input_string       | RESERVED — same as above, for `input`.
//   ur_free               | RESERVED — same as above; will be called by
//                         | future generated code once string ownership
//                         | is wired (Level 2.5).
//   ur_panic              | RESERVED — implemented and tested directly
//                         | (tests/runtime/*), but no Compiler-emitted
//                         | call site exists yet (e.g. the div/mod-by-
//                         | zero check from RUNTIME_SPEC.md §7.3 is
//                         | still deferred pending control-flow support).
//
// "RESERVED" here means: declared in this table, implemented and unit-
// tested in runtime/ur_runtime.c directly, present in every generated
// program's linked binary — but not yet reachable from any UR source
// program, because no Compiler stage emits a call to it yet. This is NOT
// dead code in the sense of being untested or unreferenced by the build;
// it is intentionally-staged functionality per the approved Level 2.4 →
// 2.5 implementation order.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExternSymbol, IRType } from "./ir.js";
import type { BuiltinId } from "./builtins.js";

export const RUNTIME_CORE_EXTERNS: readonly ExternSymbol[] = [
  { name: "ur_runtime_init",     returnType: "void",   parameterTypes: ["i64"],      callingConvention: "c", kind: "runtime", lifecycleRole: "init" },
  { name: "ur_runtime_shutdown", returnType: "void",   parameterTypes: [],           callingConvention: "c", kind: "runtime", lifecycleRole: "shutdown" },
  { name: "ur_print_int",        returnType: "void",   parameterTypes: ["i64"],      callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_print_float",      returnType: "void",   parameterTypes: ["f64"],      callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_print_bool",       returnType: "void",   parameterTypes: ["bool"],     callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_print_string",     returnType: "void",   parameterTypes: ["string"],   callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_input_string",     returnType: "string", parameterTypes: [],           callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_free",             returnType: "void",   parameterTypes: ["string"],   callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
  { name: "ur_panic",            returnType: "void",   parameterTypes: ["string"],   callingConvention: "c", kind: "runtime", lifecycleRole: "none" },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Builtin Registry (revised per engineering review — replaces the earlier,
// buggy "match by type signature alone" approach)
// ─────────────────────────────────────────────────────────────────────────────
//
// PROBLEM FOUND: matching an extern purely by its (parameterTypes,
// returnType) signature breaks the moment two Runtime functions share a
// signature — confirmed empirically: ur_print_string, ur_free, and
// ur_panic are ALL (string) -> void. A structural-only lookup for "free"
// would have non-deterministically resolved to whichever of the three
// happened to appear first in the array — silently calling the WRONG
// function (e.g. printing a string instead of freeing it).
//
// FIX: an explicit BuiltinId → concrete-extern-name mapping, kept HERE
// (the one file the Runtime Audit already sanctions for Runtime name
// literals) rather than in the IR (IRModule/ExternSymbol are NOT extended
// with any Print/Free-specific field — they remain fully general) or in
// Lowering (lower-to-ir.ts never contains a Runtime function name
// literal — it only calls resolveBuiltinExtern() and uses the returned
// ExternSymbol.name).
const BUILTIN_EXTERN_NAMES: Record<BuiltinId, string | Partial<Record<IRType, string>>> = {
  Print: { i64: "ur_print_int", f64: "ur_print_float", bool: "ur_print_bool", string: "ur_print_string" },
  Input: "ur_input_string",
  Free: "ur_free",
  Panic: "ur_panic",
  // call_external is handled entirely within Lowering (lower-to-ir.ts),
  // before ever reaching resolveBuiltinExtern() - it does not map to a
  // Runtime C extern at all (it produces a real FRI external-call IR
  // function directly). This entry exists only to satisfy the exhaustive
  // Record type; reaching it is an internal error.
  CallExternal: "__internal_error_call_external_should_never_reach_resolveBuiltinExtern",
};

/**
 * Resolves a BuiltinId (optionally qualified by the argument's IRType, for
 * the overloaded "Print" builtin) to its concrete ExternSymbol. Returns
 * undefined if no mapping exists (e.g. Print for a type with no Runtime
 * print variant) — callers must handle this as "builtin not supported for
 * this type" rather than assuming a match always exists.
 */
export function resolveBuiltinExtern(builtinId: BuiltinId, argType?: IRType): ExternSymbol | undefined {
  const entry = BUILTIN_EXTERN_NAMES[builtinId];
  const name = typeof entry === "string" ? entry : (argType !== undefined ? entry[argType] : undefined);
  if (!name) return undefined;
  return RUNTIME_CORE_EXTERNS.find(e => e.name === name);
}
