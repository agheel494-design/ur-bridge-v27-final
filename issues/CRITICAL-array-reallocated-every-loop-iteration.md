# CRITICAL Issue: Array Re-Allocated Every Loop Iteration — Silent Memory Corruption

**Status: FIXED. Discovered and fixed during a from-scratch adversarial
review of the frozen `v27-wasm-3.1b-rc1` baseline (this invalidated
`GATE_REVIEW_3_1B.md`'s prior "APPROVED" decision, which did not catch
this — see "Why This Was Never Caught" below). Fix applied, tested,
proven to catch the exact regression by deliberate re-introduction,
and verified via a fresh clean build. See `ARRAY_SINGLE_ALLOCATION_CONTRACT`
in `tests/backend/wasm/emit-wasm.test.ts` and Golden Test
`25-array-early-write-survives-loop` for the permanent regression
guards.**

## Reproduction (confirmed directly, real execution, not inferred)

```
function main(): int
  let arr = [0, 0, 0]
  let i = 0
  while i < 3
    arr[i] = i + 100
    i = i + 1
  end
  return arr[0]
end
```

Expected: `100` (written in the first iteration). **Actual: `0`**
(confirmed by direct execution). `arr[1]` (expected `101`) also
returns `0`.

## Root Cause (confirmed by direct byte-level inspection)

`encodeStatements()` declares `allocatedArraySlots` as a **fresh,
empty `Set` on every call** (`const allocatedArraySlots = new
Set<number>()`), and this function is called **once per CFG block**
(`entry`, `loop_body`, `loop_exit`, etc.), not once per function.

When an array is written inside a `while` loop's body via
`array_store`, `encodeStatements()` for `loop_body` sees this as "the
first store to this slot" (its own `allocatedArraySlots` is empty),
and emits the FULL bump-allocation sequence (read the bump Global,
advance it, write a new header) — **even though this array was
already correctly allocated in `entry`**.

Critically: `loop_body`'s compiled bytecode is generated **once**, but
**executed once per loop iteration at runtime**. Every iteration
therefore re-runs this erroneous allocation sequence: reads the
current (now-advanced) bump pointer, treats it as this array's NEW
base address (overwriting the WASM local that previously held the
CORRECT base address from `entry`), advances the bump pointer again,
and writes a fresh, empty header. The single element write that
follows lands in this new, empty allocation — while every earlier
iteration's write is now orphaned in an abandoned, never-read memory
region.

**Confirmed via direct byte inspection**: the compiled module contains
`global.set` (bump pointer advance) **twice** — once for `entry`'s own
allocation of the array literal, once more inside `loop_body`'s own
compiled bytecode — where correct behavior requires exactly one
allocation, in `entry`, for the array's entire lifetime.

## Why This Was Never Caught by Any Prior Test

Every existing test that writes to an array inside a `while` loop body
happens to fall into one of two categories that mask this bug's
observable effect:

1. **Writing the SAME value to the SAME index every iteration**
   (`arr[1] = 50` inside `while count < 3`) — even though a fresh,
   empty array is allocated each iteration, the same value gets
   written to it each time, so the final read still shows the
   "correct" value by coincidence.
2. **Reading only the LAST index written, in the LAST iteration**
   (`arr[i] = i; ...; return arr[2]`, where `i` reaches `2` on the
   final iteration) — the final iteration's fresh allocation receives
   exactly the value being tested, so the read appears correct while
   every EARLIER iteration's write to a DIFFERENT index was silently
   lost to an abandoned allocation.

**This bug specifically requires reading an EARLIER-written index
after LATER iterations have run** to become observable — a scenario no
existing 3.1B.4 or 3.1B.5 test constructed.

## Why This Is Not a New Feature, But a Genuine Regression in Already-Shipped Code

This affects every array write inside a `while` loop body shipped
since 3.1B.4 (constant index) and 3.1B.5 (dynamic index) — both
already "frozen" batches. This is exactly the kind of finding the
freeze process's own review step exists to catch before the freeze
becomes irreversible.

## Fix Applied (confirmed working)

`allocatedArraySlots` changed from a `Set` re-created fresh inside
`encodeStatements()` (once per call, i.e. once per CFG block) to a
parameter, with exactly ONE shared `Set` created per function-level
call in `encodeIfElseMergeFunctionBody()` and `encodeWhileFunctionBody()`,
passed to every `encodeStatements()` call for every block within that
function. Relies on JavaScript's guaranteed left-to-right argument
evaluation order (`entry`'s call is always the first argument
evaluated, populating the Set before any other block's call runs).

**Confirmed fixed directly**: the exact reproduction now returns `100`/
`101` as expected; direct byte inspection confirms `global.set` (the
bump pointer advance) now appears exactly once, not twice, in the
compiled bytecode for the reproduction case.

**Confirmed the fix's regression-detection value**: deliberately
re-introduced the bug (reverting the fix) and confirmed 3 Golden Tests
and 4 behavioral Contract tests immediately failed; reverted back and
confirmed all pass again.

## Fix Direction (as originally proposed, matches what was implemented)

`allocatedArraySlots` must be computed once, scoped to the WHOLE
FUNCTION (matching how `arrayBaseLocalIndexBySlotId` and
`bumpGlobalIndex` already are), not re-created per block. The actual
implementation used a shared `Set` passed as a parameter (see "Fix
Applied" above) rather than the "pre-populate with all slots except
entry's" variant originally sketched here — a simpler equivalent that
achieves the same result via JS's guaranteed argument evaluation order.
