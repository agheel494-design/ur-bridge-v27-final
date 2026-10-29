# WASM Struct Return produces raw internal TypeError instead of controlled unsupported-feature diagnostic

**Status**: OPEN — not linked to Phase 3R (Interpreter fix, closed at commit c9495fb).

## Summary

A UR function returning a `struct` value, when compiled through the
real WASM Backend (`emit-wasm.ts`), does not produce a real, controlled
`WasmUnsupportedError`/`WASM_CODES` diagnostic (as its own existing
test comment implies: "struct-typed parameters/returns/imports remain
rejected"). Instead, it crashes internally with an uncaught, raw
`TypeError: Cannot read properties of undefined (reading 'map')`.

## Real evidence

- Confirmed live via direct invocation of `emitWasmModule()` on a real
  IR module for a struct-returning function (`makePoint(): Point`,
  `return Point(3, 4)`).
- `Parser`/`Semantic`/`TypeCheck` all pass cleanly (zero errors) —
  the failure is exclusively inside WASM emission itself.
- The failure is a real, uncaught internal exception, not any of the
  real, existing `WASM_CODES` diagnostic values.
- Confirmed: zero use of `resultStructSlot` (the same real IRInstruction
  field the C Backend consumes correctly for this case) anywhere in
  `emit-wasm.ts`.

## Explicit scope note

This is **not** the same defect class as the Interpreter's own
(already-fixed) gap — the Interpreter's gap was a clean, missing
consumption of real, existing IR metadata. This is a real, unguarded
internal crash in WASM Backend's own emission code for a case its own
test suite already documents as unsupported. Two open questions, not
decided here: (1) should this become a real, controlled rejection
diagnostic, or (2) should Struct Return actually be implemented for
WASM. No evidence yet favors one over the other — a separate,
independent decision is needed before either is pursued.
