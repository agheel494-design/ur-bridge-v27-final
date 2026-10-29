# Root Cause Analysis Report — WASM `fibonacci.ur` Defect

**Team A deliverable. Investigation only, per explicit instruction —
no fix implemented or merged.**

**UPGRADED per explicit review**: the original version of this report
inferred the root cause from static code reading (correctly, but
without direct execution evidence). This version adds the requested
direct proof — an execution trace of `encodeExpr()`'s actual call
order during real WASM generation for the minimal reproduction,
confirming the mechanism directly rather than inferring it.

---

## Direct Evidence: Execution Trace (not static inference)

**Method**: a fully isolated, temporary, instrumented copy of
`emit-wasm.ts` was created (never touching the real repository —
built in `/tmp`, briefly staged inside the project only to resolve
module paths correctly, then deleted immediately; confirmed zero
trace remains: `tsc --noEmit` clean, file absence verified directly).
The instrumented copy logs, in exact real execution order: every call
to `encodeExpr(id)`, and exactly when each `store`'s `local.set` is
actually emitted.

**Full trace output for the minimal 2-iteration reproduction**:

```
STORE slot0 (local#0) = value id9
  encodeExpr(id=9) called
  emitted: local.set #0                    ← local#0 (a) is overwritten HERE

STORE slot1 (local#1) = value id8
  encodeExpr(id=8) called                  ← id8 ("temp") is computed HERE, AFTER local#0 was already overwritten
  encodeExpr(id=6) called                  ← id6 (original "load slot0" for a) is RE-EMITTED here, reading local#0's NEW value
  encodeExpr(id=7) called
  emitted: local.set #1

STORE slot2 (local#2) = value id12
  ...

Runtime result: 2  (this exact minimal 2-iteration reproduction — C
Backend gives `1` for the same source, confirmed earlier in this
document's own narrowing table; the full 10-iteration
`examples/fibonacci.ur` shows the same divergence at a larger scale:
`512` on WASM vs. the correct `55` on C)
```

**This is the direct, unambiguous proof requested**: `id6` (the
`load slot0` instruction that is part of `id8`'s formula, i.e. part
of computing `temp = a + b`) is not encoded once at `id8`'s own
logical position — it is called, and its bytecode emitted, ONLY at
the moment `store slot1, id8` is being processed, which the trace
shows happens AFTER `local.set #0` (the first store) was ALREADY
emitted. There is no ambiguity left: the SSA value is re-emitted
after its own dependency was mutated.

## Three-Column Table (IR vs. Emitted WASM Order vs. Match)

| # | IR (IR-order, per Lowering) | WASM (actual emission order, per trace) | Match? |
|---|---|---|---|
| 1 | `id6 = load slot0` (a) | *(not emitted at this position — see row 5)* | — |
| 2 | `id7 = load slot1` (b) | *(not emitted at this position — see row 5)* | — |
| 3 | `id8 = add(id6, id7)` ("temp") | *(not emitted at this position — see row 5)* | — |
| 4 | `id9 = load slot1` (b, for "a=b") | `encodeExpr(id9)` → `local.set #0` | ✅ matches IR order |
| 5 | `store slot0, id9` ("a = b") | *(emitted as part of row 4's `local.set #0`)* | ✅ |
| 6 | `store slot1, id8` ("b = temp") | `encodeExpr(id8)` called HERE → recursively `encodeExpr(id6)`, `encodeExpr(id7)` called HERE, THEN `local.set #1` | ❌ **first divergence** — `id6`/`id7`/`id8` (rows 1-3) are emitted at row 6's position, not their own IR-order position, and specifically AFTER row 4-5's `local.set #0` already mutated `local#0` |

**First position where execution diverges from IR's own logical
order**: row 6 — `encodeExpr(id8)` (and its recursive
`encodeExpr(id6)`/`encodeExpr(id7)`) fire at the `store slot1`
statement's position, not at `id8`'s own definition position (which,
per the IR, logically precedes row 4's `store slot0`). This is now
the exact, evidence-backed location for any fix.

## Conclusion (per the explicit standard requested)

**"الخلل في WASM Code Generator بسبب انتهاك دلالات SSA" — this
conclusion is now supported by direct execution evidence (the trace
above), not merely a strong hypothesis.** The static code-reading
analysis in the section below is preserved as supporting context, but
the trace is the primary evidence this conclusion now rests on.

---

## Static Code Analysis (original investigation, preserved as supporting context)

## Question Asked

هل الخلل في: Lowering؟ SSA؟ WASM Code Generator؟ WASM Runtime؟

## Answer

**WASM Code Generator** (`src/backend/wasm/emit-wasm.ts`), specifically
`encodeExpr()`'s handling of `store` instruction values inside
`encodeStatements()`.

**Not** Lowering. **Not** SSA/IR construction. **Not** the WASM
Runtime.

## Evidence

### Lowering/IR: verified correct

Full IR dumped for the minimal 2-iteration reproduction and hand-
traced instruction by instruction. The trace produces `1`, matching
the C Backend's correct output. The IR assigns the `temp = a + b`
value (`id8`) BEFORE either `store` in the loop body — correctly
reflecting UR's own sequential-evaluation semantics.

### WASM Code Generator: confirmed to violate the IR's own ordering

`encodeExpr()` does not compute an SSA value once, at its definition
point, and cache the result. It recomputes ("re-emits") a value's
entire formula LAZILY, every time that value's id is referenced —
including inside a LATER `store` statement's own encoding. When an id
is defined BEFORE an intervening `store` to one of its dependencies,
but referenced AFTER that store, its lazily re-emitted `load`
sub-expressions read the ALREADY-MUTATED WASM local instead of the
value that existed at the SSA value's true definition point.

### This precisely explains every row of the narrowing table

The one working two-outer-variable case (`a = b; b = a + 1`, no
loop-local `let`) does NOT trigger the bug specifically because its
own `load` happens to be defined naturally AFTER the intervening
store in IR order — so lazy re-emission accidentally reads the
correct value anyway. This is not a coincidence-proof case; it's a
structural confirmation that the bug is precisely about ORDER-OF-
DEFINITION versus ORDER-OF-ENCODING mismatches, not something more
general.

## Relationship to Prior Fixes

Confirmed (not merely hypothesized, as in the previous report) to be
the SAME underlying mechanism as the already-fixed
`triple-evaluation-of-array-index-expression` defect — both are
consequences of `encodeExpr()`'s lazy, non-memoized re-evaluation
strategy. That fix only materialized array-index-specific
expressions; this defect lives in the general `store` instruction
path, which that fix never touched.

## Fix Direction (documented, NOT implemented in this round)

Materialize every `store`'s value once, immediately at encoding time,
into a scratch WASM local — before any subsequent same-block
instruction is encoded — generalizing the exact pattern already
proven correct for array indices. Implementation is intentionally
deferred pending review of this RCA, per explicit instruction that
Team A investigates only.

## Recommendation

This RCA is complete and the mechanism is fully understood — enough
to implement a fix with confidence, matching the same fix pattern
already proven for the related array-index case. Recommend proceeding
to implementation as a dedicated, reviewed fix (not bundled into
Stage 3 or any other unrelated work), with:
- A permanent regression test using the exact minimal reproduction.
- Re-running the full WASM Golden Test suite and the Conformance
  Suite after the fix.
- Re-verification that `examples/fibonacci.ur` then produces the
  correct WASM result, at which point its docs/EXAMPLES.md entry can
  be updated to include WASM support.
