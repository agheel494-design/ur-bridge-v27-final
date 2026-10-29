# Issue: Array Index Expression Is Evaluated Up To 3 Times in Emitted Bytecode — FIXED

**Status: FIXED. `encodeFunctionBody()` now allocates one shared i64
scratch WASM local (only when the function has array-typed slots),
recomputed at each array_load/array_store site via
`getIndexScratchLocalIndex()`. The index expression's bytecode is now
emitted exactly ONCE, immediately stored into this scratch local, and
every subsequent use (both bounds-check comparisons and the address
computation) reads the cheap `local.get` instead of re-emitting the
full expression. Confirmed fixed directly: `arr[f()]` now calls `f()`
exactly once (down from 3), confirmed via direct byte-level inspection
of the compiled module. A permanent regression test (asserting the
call-count directly via byte inspection, not just the observable
result) was added to `tests/backend/wasm/emit-wasm.test.ts`.**

**Notable side effect**: this fix also appears to have resolved the
separate "large array + while loop" finding documented in
`issues/cross-block-reference-never-reassigned-variable-bug.md` — see
that file for details.

## What Was Found (confirmed by direct byte-level inspection, not inferred)

For `return arr[f()]`, the emitted WASM code section contains the
`call f` byte sequence (`0x10 0x00`) **three times**, not once:

```
main instructions: [... "call", "array_load" ...]   <- looks like ONE call, in the IR
```

But the actual encoded bytecode:
```
02 05 00 42 01 0f 0b 95 01 ... 10 00 42 00 53 10 00 42 03 59 72 04 40 00 0b ... 10 00 a7 41 08 6c 6a 29 03 00 0f 0b
                                ^^^^^                    ^^^^^                     ^^^^^
                            call #1 (bounds:<0)     call #2 (bounds:>=length)   call #3 (address computation)
```

Confirmed via a precise section-level byte scan (not a crude whole-
module grep, which would risk false positives from unrelated bytes):
exactly 3 occurrences within the code section specifically.

## Root Cause

`encodeBoundsCheck(indexExpr, knownLength)` receives the index
expression's ALREADY-ENCODED byte sequence and inserts it TWICE
internally (once for the `< 0` comparison, once for the `>= length`
comparison) — by design, matching its own doc comment. Separately,
`emit-wasm.ts` computes `indexExpr` ONCE via `encodeExpr()`, then
passes that SAME byte array to BOTH `encodeBoundsCheck()` AND
`encodeArrayElementLoad()`/`encodeArrayElementStore()` for the actual
address computation — meaning the index expression's bytecode is
inserted a **third** time in the final output, not just the two times
`encodeBoundsCheck`'s own comment discusses.

## Why This Is Not Currently a Bug

Every function callable in this Backend today has a body of the exact
shape `return <const>` (3.1A.3's own scope) — genuinely pure and
deterministic, with zero side effects and zero dependency on mutable
state. Calling such a function two or three times always returns the
identical value each time, so triple-evaluation is behaviorally
invisible today — confirmed directly: `arr[f()]` computes the correct
result in every existing test.

## Why This Is a Real, Latent Risk

The moment ANY side-effecting operation exists (e.g., a future
`print()` used as part of a returned value's computation, a mutable
global, or any I/O), an index expression that CALLS such an operation
would silently execute it three times instead of once — a genuine
correctness hazard, not merely a performance one. This also means: an
expensive (but still pure) index expression is unnecessarily computed
3x, a real, currently-latent performance cost that will only grow once
function bodies become more expressive (3.1C and beyond).

**This was never explicitly flagged** — the existing doc comment on
`encodeBoundsCheck()` claims duplication is "safe... true for every
index expression this phase's Expression Tree Property already
permits," which is true only in the narrow, currently-accidental sense
that nothing side-effecting exists yet — not because the Expression
Tree Property itself (fan-out ≤ 1 in the IR) has anything to do with
how many times the corresponding WASM bytecode gets re-executed at
runtime. These are two different properties that the existing comment
conflates.

## Why This Was Not Fixed Here

Fixing this (e.g., computing the index once into a temporary WASM
local, then reading that local three times instead of re-emitting the
expression) would require adding a new local, changing
`encodeBoundsCheck`'s signature, and touching the encoding logic
shared by every array access shape — a real code change, forbidden
under the current freeze except for a proven regression (this is not
one) or a documented bug fix with its own review (which this issue now
enables for a future cycle, not this one).

## Possible Fix Direction (not decided, not started)

Materialize the index expression into a dedicated WASM local once (per
array access site), then reference that local for all three uses
(both bounds-check comparisons and the address computation) — turning
3 evaluations into exactly 1, matching how `arrayBaseExpr` is already
handled (computed once into a local, reused everywhere). This would
need its own CFG/design review before implementation, per this
project's standing discipline, and is out of scope for any change made
while the freeze holds.

## Who Should Decide

Whoever owns the next WASM Backend review cycle for expression
lowering/evaluation semantics — ideally before 3.1C introduces any
side-effecting builtin, since that is the point this latent risk
becomes an active, user-visible bug.
