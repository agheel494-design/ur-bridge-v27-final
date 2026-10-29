# Issue: WASM Backend — Loop-Local `let` Used to Update Two Outer Variables Produces Wrong Result

**Status: FIXED (Stage 4). Root Cause confirmed in Stage 3
(`STAGE3_WASM_RCA_VALIDATION_FINAL.md`), design produced in Stage 3.5
(`PATCH_DESIGN_WASM_SSA.md`), fix implemented per that design's own
candidate strategy: `encodeStatements()`/`encodeExpr()` in
`src/backend/wasm/emit-wasm.ts` now materialize every `const`/`load`/
`binop` (i64) value into a dedicated scratch local at its own position
in a block, before any later same-block instruction is encoded (see
`getMaterializedIds()`). Confirmed directly: the minimal reproducer
below now returns `1` (matching C, was `2`); `examples/fibonacci.ur`
now returns `55` on WASM (matching C, was `512`).**

## Reproduction (minimal, verified directly)

**Permanent copy now in the repository**: `issues/wasm-ssa-minimal-reproducer.ur`
(added during Stage 4.5 packaging — this exact source was previously
only a `/tmp` scratch file throughout Stages 3-4; it is now a real,
durable part of this repository).

```
function main(): int
  let a = 0
  let b = 1
  let i = 0
  while i < 2
    let temp = a + b
    a = b
    b = temp
    i = i + 1
  end
  return a
end
```

- **C Backend result: `1`** (correct — after 2 iterations: iter 1:
  temp=1, a=1, b=1; iter 2: temp=2, a=1, b=2; returns a=1).
- **WASM Backend result: `2`** (wrong).

The full `examples/fibonacci.ur` (10 iterations) shows the same class
of divergence more dramatically: C gives the correct `55`
(the 10th Fibonacci number), WASM gives `512`.

## Narrowing (confirmed via direct, isolated tests)

| Pattern | C | WASM | Match? |
|---|---|---|---|
| 2 outer vars updated via a shared loop-local `let` (the bug pattern above) | 1 | 2 | ❌ |
| 1 outer var updated via a loop-local `let` (`let temp = a+1; a = temp`) | 3 | 3 | ✅ |
| 2 outer vars updated directly, no loop-local `let` (`a = b; b = a+1`) | 2 | 2 | ✅ |
| Direct single-var update, no loop-local `let` at all | 3 | 3 | ✅ |

**This precisely isolates the trigger**: the bug requires BOTH (a) a
loop-local `let` declaration inside the `while` body, AND (b) that
loop-local value being used to update a SECOND, different outer
variable in the same iteration (not just one). Neither condition
alone reproduces it.

## Root Cause Analysis (definitive — completed per explicit team-A-style investigation request)

### Layer Responsible: **WASM Code Generator** (`src/backend/wasm/emit-wasm.ts`)

**Not Lowering. Not SSA/IR construction. Not the WASM Runtime.**
Confirmed by direct, independent verification of each layer:

### Step 1 — Lowering/IR verified CORRECT by hand-tracing

The full IR for the minimal reproduction was dumped and manually
traced instruction-by-instruction:

```
Block 2 (loop_body):
  id6  = load slot0        // a
  id7  = load slot1        // b
  id8  = add(id6, id7)     // temp = a + b   (computed from PRE-store values)
  id9  = load slot1        // b (for "a = b")
  store slot0, id9         // a = b
  store slot1, id8         // b = temp
```

Hand-tracing this (a=0,b=1 → iter1: temp=1,a=1,b=1 → iter2: temp=2,a=1,b=2 →
return a=1) produces **`1`, matching the C Backend's correct output.**
**The IR itself is correct.** Lowering assigns `id8` (the value of
`temp`) BEFORE either `store` in this block — correctly reflecting
that `let temp = a + b` is evaluated once, using the values `a` and
`b` had at the START of the iteration, before any reassignment.

### Step 2 — WASM Code Generator confirmed to violate this ordering

`encodeStatements()` (`emit-wasm.ts`, current line ~1416) encodes a
`store` instruction as:
```typescript
parts.push(encodeExpr(inst.value.id, ...));  // <-- recomputes the WHOLE formula, lazily, HERE
parts.push(OPCODE_LOCAL_SET); ...
```

And `encodeExpr()` for a `load` instruction (current line ~1381)
simply emits:
```typescript
return concatBytes(OPCODE_LOCAL_GET, encodeULEB128(localIndex));
```

**The mechanism**: `encodeExpr(id8)` is not called once, at `id8`'s
own definition point, with its result cached/materialized into a
WASM local. It is called LAZILY, at the point where `store slot1,
id8` is being encoded — which, in bytecode emission order, comes
AFTER `store slot0, id9` was ALREADY encoded. Since `id8 =
add(id6, id7)` recursively re-emits `id6`'s formula (`load slot0` →
`local.get <a's wasm local>`), and that `local.get` is now PLACED
in the bytecode AFTER the earlier `local.set` that overwrote `a`'s
WASM local — **the re-emitted `local.get` reads `a`'s NEW
(post-first-store) value at runtime, not the value `a` held when
`id8` was logically computed in the IR.**

This is a direct violation of SSA value semantics: once an SSA value
(`id8`) is computed, its value must be immutable and safe to use at
any later point — `encodeExpr()`'s lazy, non-memoized recomputation
strategy breaks this guarantee whenever an id references a `load`
whose underlying slot is mutated by an intervening `store` within the
same block, before that id's own (later) point of use.

### Step 3 — Confirms why the narrowing table showed exactly this pattern

- **1 outer var via loop-local `let`**: only one `store` in the
  block; no "intervening store corrupts a later id's dependency"
  scenario possible. Works.
- **2 outer vars, no loop-local `let`** (`a = b; b = a + 1`):
  verified via a second IR dump — here, the `load slot0` used for
  `a + 1` is naturally defined AFTER the first `store slot0`
  (Lowering processes source statements in order, and `a + 1` is
  lowered as part of the SECOND source statement) — so this `load`'s
  lazy re-emission always reads the CORRECT, already-updated value,
  regardless of when it's actually emitted. No bug possible for this
  specific shape.
- **2 outer vars via a shared loop-local `let`** (the bug pattern):
  `id8` is defined BEFORE the first `store` in program order, but
  referenced AFTER it (in the second `store`) — the one shape where
  `encodeExpr()`'s lazy strategy diverges from the IR's own correct
  ordering. Fails.

### Relationship to Prior Fixes — Resolved (was previously an open hypothesis)

This is **structurally the same class of defect** as
`triple-evaluation-of-array-index-expression.md` (FIXED) — both stem
from `encodeExpr()`'s lazy, non-memoized re-evaluation strategy. That
fix specifically materialized ARRAY INDEX expressions into a scratch
local before reuse. **This bug is the same root mechanism, manifesting
for ordinary SCALAR `store` values referenced across multiple
statements in the same block** — a case the array-index fix did not
cover, since it only touched array-index-specific call sites
(`array_load`/`array_store`), not the general `store` instruction
path in `encodeStatements()`. This is NOT the same mechanism as the
two array-reallocation/cross-block-reference bugs (which involved
allocation and cross-BLOCK id resolution respectively) — this is a
same-BLOCK, cross-STATEMENT ordering violation.

### Fix Direction — IMPLEMENTED (Stage 4, see status header above)

Every `store` instruction's value should be materialized (computed
once, via `encodeExpr`, immediately, with the result written to a
scratch WASM local) BEFORE any subsequent instruction in the same
block is encoded — mirroring exactly the pattern already used for
array indices in the `triple-evaluation` fix, generalized to the
`store` instruction's own `value` operand. This would need its own
scratch-local allocation (or reuse of the existing index-scratch
mechanism, extended) and careful handling of the case where multiple
`store`s in one block each need their SOURCE value preserved across
intervening stores.

## Impact

- `examples/fibonacci.ur` is shipped as C-Backend-only as a direct
  result of this finding (see `docs/EXAMPLES.md`).
- Any other UR program following this exact pattern (loop-local
  intermediate variable used to update 2+ outer variables per
  iteration — a common idiom for swaps, running sums with multiple
  accumulators, etc.) would silently produce wrong results on the
  WASM Backend today.
- The WASM Backend's own Golden Tests and Conformance Suite cases did
  NOT catch this — none of the existing 25 WASM Golden Tests or 11
  Conformance Suite cases happen to use this specific pattern (a
  loop-local variable feeding TWO separate outer-variable updates in
  the same iteration). This is itself worth noting as a coverage gap,
  not just a code defect.

## Not Fixed Here

Per this project's own standing discipline: found, reproduced,
narrowed, and reported — not fixed without explicit review and
go-ahead, matching how every prior WASM Backend defect in this
project's history was handled.
