# Issue: Cross-Block Reference to a Never-Reassigned Variable Crashes the Encoder (Pre-existing, General — NOT a 3.1B.5-introduced bug)

**Status: FIXED. `encodeExpr()` now falls back to searching `entry`'s
own instructions when an id is not found in the current block's own
`instructionsById` map — matching exactly how Lowering's environment-
rebinding resolves a never-reassigned variable to a `const` defined in
`entry`, regardless of which block reads it. Confirmed fixed directly
for both the While shape (the original reproduction) and the Merge
shape. Permanent regression tests added in
`tests/backend/wasm/emit-wasm.test.ts`.**

## Reproduction (confirmed with SCALARS ONLY — no arrays involved)

```
function main(): int
  let k = 5
  let count = 0
  let total = 0
  while count < 3
    total = total + k
    count = count + 1
  end
  return total
end
```

`k` is declared once, in `entry`, and never reassigned anywhere.
`emitWasmModule()` throws:

```
WasmUnsupportedError: [WASM1001] main: internal error: no definition found for id %0
```

## Root Cause

Since `k` is never reassigned, Lowering does not emit a `load`
instruction for it inside `loop_body` — instead, `loop_body`'s `binop`
directly references the ORIGINAL `const` instruction's id, which was
defined in `entry` (a different block). This mirrors the same
"environment rebinding" mechanism `IR_COPY_PRESENCE_AUDIT.md` already
documented for straight-line code (a plain variable reference resolves
to nothing — a direct reference to wherever it was last defined) — but
that mechanism was only ever verified for single-block/Diamond shapes,
where "wherever it was defined" is always the same block being encoded.
Once control flow with multiple blocks entered the picture (`while`,
`if`/`else` with a merge), this cross-block case was never actually
exercised: `encodeStatements()`/`encodeExpr()` build their
`instructionsById` map from only the CURRENT block's own instructions,
so a reference to an id defined in a DIFFERENT block fails to resolve.

## Why This Was Never Caught Before

Every existing `while`/`while`+`break`/`while`+`continue`/Merge test
in this project's entire history happens to only reference variables
that are either (a) reassigned within the same block they're read in
(making them local `load`s), or (b) used only within `entry` itself.
The specific combination — a variable set once in `entry`, never
reassigned anywhere, and referenced inside a DIFFERENT block (loop
body, merge, etc.) — was never constructed by any prior test, including
this batch's own extensive 3.1B.4/3.1B.5 test suites, all of which
(by the nature of what they were testing) always reassign their loop
variables.

## Why This Is Out of 3.1B.5's Scope

- It is not specific to arrays — the reproduction above uses only
  scalars, predating any of Level 3.1B's own work.
- Fixing it requires changing how `encodeStatements()`/`encodeExpr()`
  resolve instruction ids — either by threading a cross-block lookup
  (e.g., a lookup that falls back to `entry`'s instructions, or a
  proper dominance-based reaching-definition mechanism) through EVERY
  existing shape (Diamond, Merge, While, While+break, While+continue)
  — a change with a far larger blast radius than this phase's own
  "one check removed" minimal fix.
- Per the Level 3.1B.5 directive's own non-negotiable rule: "يمنع
  تعديل أي جزء من Level 3.1A أو 3.1B.1–3.1B.4 إلا لإصلاح Bug موثق" —
  while this qualifies as a documented bug, its fix would ripple
  through all of those frozen shapes, and deserves its own dedicated,
  independently-reviewed batch, not a patch bundled into 3.1B.5's
  narrow, already-scoped work.

## Confirmed NOT to Affect 3.1B.5's Actual Deliverable

Every realistic "dynamic index inside a loop" case — where the index
is the loop's OWN mutated counter (the entire point of this phase) —
necessarily reassigns that variable within the loop body (e.g. `i = i
+ 1`), which means it always produces a local `load`, never a
cross-block `const` reference. **3.1B.5's own test suite was
constructed with this in mind and does not trigger this bug.** This
issue was found only by constructing an artificial edge case (a
never-reassigned variable used as an index) during this phase's own
performance-measurement work — not by any of 3.1B.5's actual required
scenarios.

## Possible Fix Directions (not decided, not started — for whoever picks this up)

- Give `encodeStatements()`/`encodeExpr()` a fallback lookup into
  `entry`'s own `instructionsById` map when a referenced id isn't
  found in the current block — a narrow patch, but only correct if
  "defined in entry, never reassigned" is truly the only cross-block
  case that can arise (needs verification against Merge/Diamond too,
  and against deeper nesting once that's ever supported).
- A more general reaching-definition/dominance-based resolution — a
  larger, more principled fix, but a bigger change.

## Additional Finding (discovered during 3.1B.5's performance measurement, also out of scope originally — UPDATE: appears resolved as a side effect of a later fix): Large Array + `while` Loop Combination

**UPDATE**: this finding's reproduction was re-tested after the
triple-evaluation-of-array-index-expression fix (see
`issues/triple-evaluation-of-array-index-expression.md`) was applied,
and **no longer fails** — tested directly up to 2000 array elements
(well beyond the original ~80-90 element threshold), all succeeding
correctly. This strongly suggests the root cause was a body-size-
dependent encoding issue that the triple-evaluation fix's byte-size
reduction (removing redundant index-expression bytecode at every array
access) pushed far outside any range reachable by normal programs —
not merely a coincidental threshold shift, given the 20x-larger test
size still succeeds cleanly. **Not formally closed as FIXED** (the
true original root cause was never identified, only inferred from this
correlation), but no longer blocks anything and is not independently
reproducible as of this update.

**Original finding, preserved for the historical record**:

**Confirmed via direct, precise testing, NOT guessed**: a 100-element
array combined with a `while` loop fails with `RuntimeError: memory
access out of bounds` when an access reaches index `80` — but **this
occurs with a CONSTANT index too** (not just a dynamic one), and
**does not occur at all without the loop** (a 100-element array with a
constant index, single-block, no loop, works correctly). This
conclusively rules out any relationship to 3.1B.5's own dynamic-index
work — it is a pre-existing (Array + `while`) combination issue,
predating this phase, most likely rooted in 3.1B.4's own extension of
`validateWhileShape`/`encodeWhileFunctionBody` for arrays.

**Precisely bounded, not vaguely described**:
- Array size 100, `while` loop, access at index 80: fails.
- Array size 100, `while` loop, access at index 79: works.
- Array size 82 fully filled (index up to 81) inside a `while` loop: works.
- Array size 90 fully filled (index up to 89) inside a `while` loop: fails.
- The WASM module's own section-length prefixes were manually parsed
  and confirmed byte-correct for both the working and failing cases —
  ruling out a structural/encoding-length bug. The failure is a
  genuine runtime logic issue (a miscomputed address or similar),
  not a malformed module.

**Confirmed NOT to affect any of 3.1B.4's or 3.1B.5's actual test
suites** — every existing test in both phases uses small arrays
(2-4 elements), far below this threshold.

## Who Should Decide

Whoever owns the next WASM Backend review cycle for arrays combined
with control flow — both findings in this document are cross-cutting
encoding concerns, not scoped to any single sub-phase, and neither
affects any of 3.1B.4's or 3.1B.5's own actual, already-shipped test
suites (both use only small arrays, well below the second finding's
threshold, and only ever reference genuinely-reassigned loop
variables, avoiding the first finding's trigger entirely).

