// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Builtin Identifiers
// Level 2.5 — Builtins Integration (revised per engineering review)
// ─────────────────────────────────────────────────────────────────────────────
//
// A closed, stable identifier for each UR-language builtin — NOT tied to
// any specific Runtime C function name, NOT part of the IR (IRModule/
// ExternSymbol remain exactly as frozen; see IR_SPEC.md). This is the
// shared vocabulary that lets:
//
//   - Semantic (src/compiler/semantic/builtins-registry.ts) know "print"
//     the UR identifier corresponds to BuiltinId "Print", for name/arity
//     resolution during semantic analysis.
//   - The Runtime Registry (src/shared/runtime-table.ts's
//     resolveBuiltinExtern()) know how to map BuiltinId "Print" (plus,
//     for Print specifically, the argument's IRType) to the correct
//     concrete Runtime C function — WITHOUT the IR itself ever knowing
//     what "Print" means.
//
// This lives in src/shared/ (not src/compiler/semantic/) specifically so
// that src/shared/runtime-table.ts can reference it without creating a
// backward dependency from the shared/IR layer onto a Compiler stage —
// preserving the Frontend → IR → Backend → Runtime one-directional
// dependency graph verified in the Runtime Audit.
//
// Adding a new builtin (println, strlen, concat, ...) means: one new
// value here, one new entry in builtins-registry.ts, one new mapping in
// runtime-table.ts's resolver — NEVER a change to IRModule/ExternSymbol,
// and NEVER a change to the Backend.
// ─────────────────────────────────────────────────────────────────────────────

export type BuiltinId = "Print" | "Input" | "Free" | "Panic" | "CallExternal";
