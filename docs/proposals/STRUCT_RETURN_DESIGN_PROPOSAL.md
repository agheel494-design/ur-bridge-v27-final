# STRUCT_RETURN_DESIGN_PROPOSAL.md

**Status: DESIGN PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.** Highest
priority per direct instruction: this real constraint (confirmed live,
`tests/examples/language-fundamentals.test.ts`) blocks real programs
more than any backend feature — prioritized above `WASM Loops`.

## Goal

Allow a function to declare `struct` as its own return type (e.g.
`function makePoint(a: int, b: int): Point`) and `return` a real,
constructed struct value — scoped to the **C Backend only** in this
first phase (matching the established "one real step, one backend,
at a time" discipline that worked for LLVM/WASM). WASM and LLVM
struct-return support is explicitly a separate, later proposal.

## Real finding that scopes this proposal

`IRFunction.returnType: IRType`, and `IRType = "i64" | "f64" | "bool"
| "string" | "void"` (confirmed directly, `src/shared/ir.ts`) — **no
struct representation exists in the return-type position at all**.
Struct construction (`Point(3, 4)`) is currently a `let`-only special
form (confirmed directly, `ir-builder.ts`), allocating a real
`IRLocalSlot` with its own `structLayout` — not a general expression
usable in a `return` statement.

**This means the real fix touches the shared IR shape** (used by all
three backends), not just the C Backend's own emitter — but the
actual C-side code generation is genuinely simple (C already supports
returning a struct by value directly: `struct Point f(...) { ...
return p; }` is valid, ordinary C). The real work is almost entirely
at the IR/lowering level, not the C emission level.

## Two real design options for the IR-level representation

**Option A**: add a real, optional field to `IRFunction` —
`returnStructLayout?: StructLayoutResult` — alongside the existing
`returnType: IRType`, with `returnType` set to a sentinel (e.g.
`"void"`, reinterpreted) when a real struct return is present. Real
risk: overloading `returnType`'s own meaning is a real, ongoing
source of confusion for every future reader of this field.

**Option B (recommended)**: widen `IRFunction.returnType`'s own real
type to a proper union: `IRType | { readonly kind: "struct"; readonly
layout: StructLayoutResult }` — a real, explicit, self-documenting
representation, matching how `IRLocalSlot.structLayout` already
works. Every existing call site that reads `fn.returnType` as a plain
`IRType` string needs updating to handle the new union case — a real,
mechanical but non-trivial change across `emit-c.ts`, `emit-wasm.ts`
(even though WASM struct-return itself is out of scope, the type
itself is shared and must compile), and the LLVM Backend's own
`builder.ts`.

## Explicitly NOT Supported (binding scope boundary)

- WASM struct return (a real, separate later proposal — WASM's own
  multi-value return or memory-based return convention needs its own
  real design).
- LLVM struct return (same reasoning — LLVM's own struct-return ABI,
  real, separate later proposal).
- Nested structs as a return type (a struct containing another struct
  field) — real, additional complexity deferred.
- Returning an array (explicitly, this proposal is struct-only — the
  array-as-parameter limitation is a separate, distinct proposal, not
  addressed here).

## Real, concrete example this phase must make work

```
struct Point
  x: int
  y: int
end

function makePoint(a: int, b: int): Point
  return Point(a, b)
end

function main(): int
  let p = makePoint(3, 4)
  return p.x + p.y
end
```

## Acceptance Criteria

- [ ] The exact example above compiles via the real pipeline (Lexer
      through IR) with zero errors.
- [ ] The generated C code is real, valid C that a real `gcc` accepts
      and links.
- [ ] Real execution (via real `gcc` compile + standalone run,
      matching this project's own established evidence standard)
      returns the correct value.
- [ ] All 250+ existing tests (across LLVM/WASM/C) remain green — the
      IR type widening must not break WASM/LLVM code that never
      touches struct returns.
- [ ] A permanent regression test (a 4th real example program, or an
      extension of `language-fundamentals.test.ts`) confirms this
      specific capability going forward.

## Files Expected to Change (Impact Analysis)

- `src/shared/ir.ts` — `IRFunction.returnType`'s own real type widened
  (Option B).
- `src/compiler/codegen/ir-builder.ts` / `lower-to-ir.ts` — real
  lowering support for `return <StructConstructorCall>`.
- `src/backend/c/emit-c.ts` — real C struct-return code generation
  (the genuinely simple part).
- `src/backend/wasm/emit-wasm.ts`, `src/backend/llvm/*` — must
  continue to compile and behave correctly for every existing,
  non-struct-return program (the type is shared even though these
  backends don't yet implement struct return themselves) — a real,
  required regression check, not an assumption.

## Explicit ask

Approval of Option B (a real, explicit union type for
`IRFunction.returnType`) and the C-Backend-only scope, before any
implementation begins.
