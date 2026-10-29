# Issue: Single-Element Array Declaration Produces Invalid C (Level 2.8, C Backend) — FIXED

**Status: FIXED, at the root cause. `IRLocalSlot` gained an explicit
`isArray?: boolean` field, set to `true` by Lowering for every array
slot it creates regardless of element count — resolving the
fundamental ambiguity between "ordinary scalar" and "genuine
one-element array" at `length === 1` that this issue's every consumer
(C Backend declaration emission, WASM Backend's scalar/array local
partitioning, and `shared/ir.ts`'s own invariant checker) previously
inferred solely from `length > 1`. Every affected site updated to
check `isArray` instead. Confirmed fixed directly: `let arr = [99];
return arr[0]` now compiles correctly via BOTH backends and returns
`99`; a regression check confirms ordinary multi-element arrays are
unaffected on both backends. Permanent regression test added to
`tests/backend/wasm/emit-wasm.test.ts`.**
specifically so it is not forgotten, not fixed here (fixing it would
touch frozen Level 2.8 code, requiring its own separate review).**

## Reproduction (verified fresh, directly, before writing this issue)

```
function main(): int
  let arr = [99]
  return arr[0]
end
```

## Root Cause

`Lowering` assigns `IRLocalSlot.length = 1` for this genuine
one-element array declaration — but `IRLocalSlot.length`'s own doc
comment states `undefined`/`1` both mean "this is an ordinary scalar
slot, not an array." A length-1 array is indistinguishable, at the
`IRLocalSlot` level, from an ordinary scalar.

The C Backend (`emit-c.ts`), reading that same `length` field, declares
the slot as a plain `int64_t` (matching the "ordinary scalar" reading)
— but Lowering *still* emits `array_load`/`array_store` instructions
against that slot (matching the "genuine one-element array" reading).
The two readings conflict, and the C Backend's declaration loses.

## Confirmed Evidence (real `gcc`, not inferred)

Generated C excerpt:
```c
int64_t slot_arr;
if (v1 >= 0 && v1 < 1) { slot_arr[v1] = v0; } else { ur_panic("array index out of bounds"); }
int64_t v3 = (v2 >= 0 && v2 < 1) ? slot_arr[v2] : (ur_panic("array index out of bounds"), 0);
```

Real `gcc` output:
```
error: subscripted value is neither array nor pointer nor vector
   14 |   if (v1 >= 0 && v1 < 1) { slot_arr[v1] = v0; } else { ... }
```

**This program fails to compile via the already-frozen C Backend.**
Not a WASM Backend defect, not a 3.1B defect — a genuine Level 2.8
Lowering/C-Backend inconsistency for exactly one specific case (array
length exactly 1), predating all of Level 3.

## Why This Was Not Fixed Initially (historical context — since resolved, see "Fix Applied" below)

1. It touches `IRLocalSlot`'s own semantics and/or `lower-to-ir.ts`'s
   slot-declaration logic and/or `emit-c.ts`'s declaration-emission
   logic — all frozen Level 2.8 code, none of it in 3.1B's scope at
   the time this issue was first opened.
2. Per review: fixing frozen code inside an active, unrelated batch
   risks conflating two separate reviews and breaking the freeze
   discipline that has protected this project's stability since
   Level 2.9.
3. This batch's own tests simply avoided the trigger (every array test
   in Level 3.1B.1 uses 2+ elements), so it did not block 3.1B's own
   work at the time — it was a real, but independently addressable, gap.

**This reasoning no longer applies**: a later, explicit engineering
directive authorized closing all open issues, including this one,
superseding the freeze discipline above for this specific fix. See
"Fix Applied" below.

## Additional Manifestation Found (fresh-eyes review, after the 3.1B RC1 freeze) — WASM Backend, Same Root Cause — ALSO FIXED

**Confirmed directly, not guessed**: the identical `IRLocalSlot.length`
ambiguity also affected the WASM Backend, not just the C Backend this
issue originally documented — and is now fixed by the same `isArray`
field, since the WASM Backend's own scalar/array partitioning
(`fn.locals.filter(l => l.isArray === true)`, in `emit-wasm.ts`) was
updated alongside the C Backend fix. Re-verified directly after the
fix: the exact reproduction below no longer rejects.

```
function main(): int
  let arr = [0, 1, 2]
  let idx = [1]
  return arr[arr[0]]
end
```

`idx` is a genuine one-element array, but `IRLocalSlot.length = 1`
meant the WASM Backend's `knownArraySlotIds` filter
(`(l.length ?? 1) > 1`) treated it as an ordinary scalar — while
Lowering still emits `array_store`/`array_load` against it. Result
BEFORE the fix: **`emitWasmModule()` cleanly rejected** (`WASM1001`:
`"array_store at slot 1 is not a declared array in this function"`) —
a proper `WasmUnsupportedError`, not a crash, not silently wrong
output BEFORE the fix. This
was the SAME root cause as the C Backend manifestation above, not a
separate bug — now fixed by the same `isArray` field, benefiting both
backends at once, as anticipated below.

**Note**: this specific reproduction also uses `idx` in a way that
happens not to actually need its own value (`idx` is declared but
never read) — re-tested with `idx` genuinely read elsewhere in the
same function, with the identical (now-fixed) result (no longer
rejects, for the same
reason). The unused-vs-used distinction does not change this finding.


## Fix Applied

Implemented the first, recommended direction from this issue's own
original analysis: gave `IRLocalSlot` an explicit `isArray: boolean`
field, separate from `length`, set by `lower-to-ir.ts` for every array
slot regardless of element count. Every consumer that previously
inferred array-ness from `length > 1` alone was updated to check
`isArray === true` instead: `emit-c.ts`'s declaration emission,
`emit-wasm.ts`'s scalar/array local partitioning (8 sites), and
`shared/ir.ts`'s own invariant checker (2 sites). This IS a change to
the frozen IR shape, exactly as this issue's own analysis anticipated
it would need to be — authorized by the same directive that closed
this issue.

## Who Should Decide

Whoever owns Level 2.8/the C Backend's next review cycle — not a
3.1B-scoped decision. This issue exists so the finding is not lost
before then, per explicit review instruction.
