# UR-Bridge WASM Backend — Guide

**Status: user-facing documentation for the WASM Backend as shipped
in RC2. Every capability and limitation below is drawn directly from
`WASM_BACKEND_SPEC.md`'s own corrected Feature Matrix and this
project's own test suite — not aspirational.**

---

## V1.0 contract update (DR-RB3-01, APPROVED, Option A)
The RC2 lists below are kept for history. **For V1.0, the following are ACCEPTED** and verified to produce the same
result as the C backend (`tests/backend/wasm/emit-wasm.test.ts`, entries tagged `[DR-RB3-01]`):
- unary minus;
- value reuse / fan-out;
- conditional array allocation in one `if`/`else` branch;
- arrays inside `if`/`else`;
- `print()` after an `if`/`else` merge;
- function calls with arguments;
- nested array literals.

**Still REJECTED:**
- allocating an array **inside a loop body** (WASM1002, deferred to 3.1B.6);
- the remaining `wasm-only-reject` fixtures (e.g. reuse of an `array_load` result, a bool value gap, nativeptr multi-use).

**Also ACCEPTED (DR-RB3-01, amended):** floats (`float` return values and `f64` arithmetic) and the host builtins
`input`/`print`/`free`. They are verified by differential fixtures 27, 29, 35 and 34, and by
`tests/backend/wasm/emit-wasm.test.ts`. The RC2 statements below that say otherwise are superseded.

---

## What The WASM Backend Currently Supports (RC2)

- Integer constants and arithmetic (`add`/`sub`/`mul`), comparisons.
- Local variables (scalar).
- `if`/`else` (both return-only and value-merging forms).
- `while` loops, `break`, `continue`.
- Function declarations and direct (zero-argument) calls between UR
  functions in the same module.
- `return` / `return_void`.
- **Arrays**: fixed-size array literals, `array_load`/`array_store`
  with either a constant or a dynamically-computed index (including
  inside a loop body, with the loop's own mutated variable as the
  index), with mandatory runtime bounds checking on every access.

## What The WASM Backend Does NOT Yet Support (RC2)

Verified directly against the shipped code, not inferred:

- **Floating-point** (`const`/`binop`) — rejected with a precise
  diagnostic ("floats are a later sub-phase"). Planned for a future
  milestone (see `UR_BRIDGE_V28_MASTER_ROADMAP.md`).
- **Unary operators** (`neg`/`not`) — rejected with a precise
  diagnostic. Also planned for v28.
- **Function calls with arguments** — only zero-argument calls are
  supported today. Also planned for v28.
- **Conditional array allocation** — an array declared inside only one
  branch of `if`/`else`, or repeatedly inside a loop body, is rejected.
  Every array must be allocated in the function's entry block. Planned
  for v28 (3.1B.6).
- **Runtime imports / Builtins** (`print`, `input`, `free`) — the WASM
  Backend cannot yet call out to host functions. Planned for v28
  (3.1C).
- **Garbage collection / `free` for arrays** — arrays are allocated via
  a simple bump allocator and never freed. A program that allocates
  many arrays in a loop will eventually exhaust the single WASM memory
  page. Not currently planned for any specific milestone (see
  `UR_BRIDGE_V28_MASTER_ROADMAP.md`'s v29 definition).
- **Structs** — exist in the language and the C Backend, but their
  interaction with the WASM Backend's own array model has not been
  designed (out of scope for v28, per the roadmap).
- **Nested control flow combined with arrays** (e.g. `if` inside
  `while`) — cleanly rejected, not yet supported.

## Memory Model Summary

- One WASM linear memory page, one mutable `i32` Global as a bump
  allocator, starting at address 8 (addresses 0-7 permanently
  reserved).
- Every array's layout: an 8-byte `length` header, followed by
  8-byte-aligned `i64` elements — `elementAddress = arrayBase + 8 +
  index * 8`.
- Bounds checking is mandatory and unconditional on every array
  access — an out-of-bounds index (including a negative one) always
  traps at runtime (`unreachable`), never silently reads/writes wrong
  memory.

Full details: `WASM_MEMORY_MODEL_SPEC.md`.

## Known, Tracked Issues

As of RC2, all previously-tracked WASM Backend issues are FIXED (see
`issues/` directory for the historical record of each). No currently
open issue is known to affect WASM Backend correctness.

## Diagnostics

Every rejection the WASM Backend produces uses one of four codes
(`WASM1001`-`WASM1004`), each with a specific, human-readable message
naming exactly what construct triggered it and, where applicable,
which future milestone is expected to lift the restriction. If you
encounter a rejection message that seems imprecise or wrong, this is
worth reporting — this project's own `BUG_REPORT_TEMPLATE.md`
(`quality-templates/`) is the right format.

## Verifying Output Yourself

Every `.wasm` module this Backend produces can be checked directly:

```typescript
const bytes = emitWasmModule(ir.value);
console.log(WebAssembly.validate(bytes)); // should be true
```

This project's own test suite uses exactly this check throughout —
see `USAGE_EXAMPLES.md` for a complete, runnable example.
