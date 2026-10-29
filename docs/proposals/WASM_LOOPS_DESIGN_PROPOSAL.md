# WASM_LOOPS_DESIGN_PROPOSAL.md

**Status: DESIGN PROPOSAL v2 — NOT APPROVED, NOT IMPLEMENTED.**
Revised per direct review — corrects the rejection rationale for
while-inside-while, defines "one level" precisely with explicit
examples, adds a real Loop Context Model, expands Acceptance Criteria.

## Goal

Extend WASM Backend support for control flow involving `while`
beyond the current single-level shapes (basic `while`, `while`+`break`,
`while`+`continue` — all already implemented, real, and tested) to
real nesting combinations.

## Real finding, CORRECTED per direct review

Direct inspection of the real, existing `br`/`br_if` encoding
(`emit-wasm.ts`) confirms: branch depths are **hardcoded literal
numbers per known shape** (e.g. `OPCODE_BR, encodeULEB128(2), //
break: exit the block (depth 2 from inside the nested if: if=0,
loop=1, block=2)`) — **not** computed by any real, dynamic
Control Stack. This is the real, concrete mechanism: WASM's own
`br`/`br_if` targets an enclosing structured construct (`block`/
`loop`/`if`) by counting outward through however many such
constructs are actually open at that point in the bytecode — a real,
general, always-computable number, not something WASM itself limits.

**Corrected conclusion (per direct review — this was stated too
strongly in the prior draft)**: `while` inside `while` is **NOT
architecturally impossible** — WASM itself has no such limitation.
The real constraint is that **this Emitter's own current code has no
general mechanism to compute that depth dynamically** — every existing
encoder hardcodes the literal number for its own one, specific, known
shape. Building nested-loop support therefore requires building a
real, dynamic depth-tracking mechanism first (§ Loop Context Model
below) — genuinely more work than a single-level `if`-inside-`while`
needs, but a real, scoped, later phase, not a permanent boundary.
**Restated precisely**: `while` inside `while` is deferred in THIS
phase because the dynamic depth-tracking mechanism this phase builds
is intentionally scoped to one level first (proven correctness before
generalizing further) — not because of any real limit in WASM or an
unfixable architectural wall.

## Loop Context Model (per direct request — required before any code)

### Structural diagram

```
EmitContextStack (grows as the emitter opens real WASM structural
constructs; shrinks as it closes them — real LIFO, matching WASM's
own real block-scope nesting exactly):

        top
   ┌──────────────┐
   │ IfContext    │  ← e.g. an `if` opened inside a loop's own body
   ├──────────────┤
   │ LoopContext  │  ← a `while` (real: OPCODE_BLOCK + OPCODE_LOOP pair)
   ├──────────────┤
   │ (function's own outer scope — not a stack entry, the implicit floor)
   └──────────────┘

break    → walks the stack OUTWARD from the top, targets the
           nearest LoopContext found.
continue → same real search, same nearest LoopContext — but a
           DIFFERENT real target within it (see the precise
           arithmetic below — continue and break do NOT share the
           same real depth, even though they resolve to the same
           LoopContext entry).
```

### Real, precise depth arithmetic — CORRECTED per direct feedback ("computed from the stack's own real length" was imprecise; the real quantity is a weighted count of real WASM structural wrappers, not the raw stack index)

```typescript
type EmitContext =
  | { readonly kind: "loop" }
  | { readonly kind: "if" };

// A real, growing array acting as the Control Stack.
const contextStack: EmitContext[] = [];
```

Each `EmitContext` kind corresponds to a different real number of
actual WASM structural wrappers it will emit:
- `IfContext` → **1** real wrapper (`OPCODE_IF...OPCODE_END`; the
  presence or absence of `OPCODE_ELSE` does not add a wrapper — it is
  a marker inside the same one).
- `LoopContext` → **2** real wrappers (`OPCODE_BLOCK` outer,
  `OPCODE_LOOP` inner — the real, existing pattern already used by
  every current `while` encoder).

**Real algorithm** (walking the stack from its own top outward,
stopping at the first `LoopContext` found — not simply `stack.length`):

```typescript
function computeBreakDepth(stack: readonly EmitContext[]): number {
  let depth = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === "if") { depth += 1; continue; }
    // stack[i].kind === "loop": break targets the OUTER of its 2
    // real wrappers (the block) - one more than continue needs.
    return depth + 1;
  }
  throw new Error("break outside any loop - real bug if reached, Layer 1 must have already rejected this");
}

function computeContinueDepth(stack: readonly EmitContext[]): number {
  let depth = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].kind === "if") { depth += 1; continue; }
    // stack[i].kind === "loop": continue targets the INNER of its 2
    // real wrappers (the loop itself) directly.
    return depth;
  }
  throw new Error("continue outside any loop - same real-bug note as above");
}
```

**The algorithm reproduces the CURRENT, already-supported behavior
exactly** (not invented, and **tested live** — this exact algorithm
was run against the known-correct values before being written into
this document, not merely asserted correct on paper) — **for the
cases already implemented and real today**: a `break` directly inside
a loop body (zero `IfContext`s passed) →
`computeBreakDepth` returns `1` — matches the real, existing comment
`OPCODE_BR, encodeULEB128(1)` for that exact case. A `break` inside
one nested `if` inside a loop (one `IfContext` passed) →
`computeBreakDepth` returns `2` — matches the real, existing comment
`// break: exit the block (depth 2 from inside the nested if: if=0,
loop=1, block=2)`. `continue` in the same two cases returns `0` and
`1` respectively — matches the real, existing `continue: branch to
the loop itself (depth 1 from inside the nested if: if=0, loop=1)`
comment exactly.

**Scope of this confirmation, stated precisely (per direct
correction)**: this proves the algorithm correctly reproduces
already-supported, already-real behavior — it does NOT by itself
prove correctness for the new, not-yet-implemented cases this
proposal targets (`while` inside `if`) or the explicitly deferred
`while` inside `while`. It is the reference formula this phase's own
real implementation will be built against and tested with real
execution for the NEW cases specifically — not proof of those new
cases' own correctness in advance of implementing and testing them.

### Invariants (per direct request)

1. **Every `LoopContext` has exactly one real loop label** — it
   corresponds to exactly one real `OPCODE_BLOCK`+`OPCODE_LOOP` pair;
   no `LoopContext` is ever split across two real wrapper pairs.
2. **An `IfContext` never changes which `LoopContext` a `break`/
   `continue` targets** — it only adds `+1` to the real computed
   depth (per the algorithm above); the nearest enclosing
   `LoopContext` is always the real target, regardless of how many
   `IfContext`s sit between the branch site and it.
3. **The number of real WASM structural wrappers actually open at any
   point equals the weighted sum of the stack's own real contents**
   (each `IfContext` contributing 1, each `LoopContext` contributing
   2) — **not** the raw `stack.length` (a `LoopContext` is one stack
   entry but two real wrappers — this is the real distinction the
   prior draft's "computed from the stack's own real length" wording
   did not make precise, corrected here explicitly).
4. **Push happens immediately before encoding a construct's own
   body; pop happens immediately after its own closing `OPCODE_END`
   is emitted** — real LIFO discipline, with zero real WASM construct
   ever left open across a context pop.

## Supported Capabilities (proposed — every open question answered explicitly, with concrete examples)

| Question | Proposed answer |
|---|---|
| `while`/`break`/`continue` (single-level) | Already real and working — unchanged. |
| `if` inside `while`'s own body — e.g. `while i < n: if arr[i] == x: ... end; i = i + 1 end` | **Yes — this phase's own primary target.** |
| `while` inside an `if`'s own branch — e.g. `if cond: while i < n: ... end end` | **Yes — this phase's own secondary target.** |
| `while` inside `while` — e.g. `while i < n: while j < m: ... end end` | **Explicitly deferred** — see the corrected rationale above (a real, scoped, later phase building on this phase's own Loop Context Model, not a permanent wall). |
| Precise meaning of "one level" for this phase | Exactly the two bullet points above (`if`-in-`while`, `while`-in-`if`) — **not** `while`-in-`while`, and **not** `if`-in-`while`-in-`if` (a second level of nesting on either side). |

## Explicitly NOT Supported (binding scope boundary for this phase)

- `while` inside `while`.
- Any nesting two levels deep in either direction (e.g. `if` inside
  `while` inside `if`, or `while` inside `if` inside `while`).
- Loops inside the already-supported deep `if`-nesting from the prior
  Milestone (e.g. `while` inside the innermost `if` of a
  triply-nested `if`).
- `for` loops (no such UR-level construct exists — moot).
- `switch`/`match`, exceptions, recursion — restated per standing policy.

## Acceptance Criteria (expanded per direct request)

- [ ] Existing single-level `while`/`while`+`break`/`while`+`continue`
      still compile and execute correctly — zero regression.
- [ ] `if` inside `while` (no `break`/`continue` inside the `if`)
      compiles to real, valid WASM and executes correctly.
- [ ] `while` inside an `if`'s own branch compiles and executes
      correctly.
- [ ] `break` inside a nested `if`-within-`while` computes the
      correct real depth and executes correctly (exits the real
      loop, not the `if`).
- [ ] `continue` inside a nested `if`-within-`while` computes the
      correct real depth and executes correctly (continues the real
      loop, not falls through incorrectly).
- [ ] The generated `.wasm` bytecode is structurally verified (real
      decode/inspection, not merely "no exception thrown").
- [ ] The bytecode is actually executed via real
      `WebAssembly.instantiate` + function call, with real, checked
      results — matching this project's own established evidence
      standard (`layer2-nested-if-execution.test.ts`'s own pattern).
- [ ] `while` inside `while` is explicitly rejected with a clear
      diagnostic — confirmed live, not merely assumed from the
      Validator's own source.
- [ ] All 250 existing tests (WASM + LLVM) remain green.

## Files Expected to Change (Impact Analysis)

- `src/backend/wasm/emit-wasm.ts` — real, new logic implementing the
  Loop Context Model above; the three existing `while` encoders'
  own body-encoding step changes from "encode a fixed statement
  sequence" to "encode via the same context-stack-aware recursion
  `encodeReturnBlockBody` already uses for `if`, extended to also
  push/pop `loop` contexts."
- `src/backend/wasm/wasm-cfg-validation.ts` — Layer 1 needs a new,
  real structural check recognizing `if`-inside-`while` and
  `while`-inside-`if` as valid shapes (analogous to
  `isNestedIfStructureValid`, reasoning about loop headers this time).
- `src/backend/wasm/call-graph.ts` — not expected to change.

## Regression Strategy

Same real, proven three-step order as the prior Milestone: Layer 1
classifier extension first, tested in isolation (unwired); then the
real emitter/Loop Context Model changes, tested via real
`WebAssembly.instantiate` execution; only then wiring, proven via a
real testability-seam test (mirroring `layer1-wiring-proof.test.ts`).
Full regression (all 250 existing tests) re-run after each step.

## Explicit ask

Approval of: the corrected while-inside-while rationale (a real,
scoped, later-phase deferral, not a permanent architectural wall),
the Loop Context Model, the Supported Capabilities table (with "one
level" now defined by concrete example), and the expanded Acceptance
Criteria — before any implementation begins.
