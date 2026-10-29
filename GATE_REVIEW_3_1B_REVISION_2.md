# Gate Review — Level 3.1B — REVISION 2 (Supersedes the Original `GATE_REVIEW_3_1B.md`)

**This document supersedes the original `GATE_REVIEW_3_1B.md`'s
"APPROVED" decision. That review was INCOMPLETE — it did not catch a
critical memory-corruption bug, found only by this from-scratch,
adversarial re-review. The original document is left in place for the
historical record, not deleted, but its decision is superseded by this
one.**

---

## What Changed Since the Original Review

A from-scratch, adversarial review — deliberately hunting for
Regression, Memory Corruption, Validation Gaps, Encoding Bugs, Hidden
State Leakage, Incorrect Diagnostics, and Performance Regressions, per
explicit instruction not to rely on any prior report — found **one
critical bug and one latent design risk**, both undiscovered by the
original review:

### 1. CRITICAL (found, fixed, tested): Array Re-Allocated Every Loop Iteration

`issues/CRITICAL-array-reallocated-every-loop-iteration.md`. Root
cause: `allocatedArraySlots` was a fresh `Set` per CFG block
(`encodeStatements()`'s own local variable), not shared across a whole
function. Writing to an array inside a `while` loop body caused the
array to be silently re-allocated every iteration, orphaning every
earlier iteration's write. **Never observed by any prior test**
because every existing test either wrote the same value repeatedly or
only read the last index written — both patterns that coincidentally
mask the bug's effect.

**Fixed**: `allocatedArraySlots` is now a parameter, shared via one
`Set` created once per function-level encoder
(`encodeIfElseMergeFunctionBody`/`encodeWhileFunctionBody`), passed to
every block's `encodeStatements()` call.

**Verified**: exact reproduction now returns correct values; direct
byte inspection confirms the allocation sequence appears exactly once,
not twice; deliberately re-introducing the bug caused 3 Golden Tests
and 4 behavioral tests to fail immediately, confirming real
regression-detection value; reverting confirmed all pass again; a
fresh clean-build copy (see below) confirms the fix from a copy with
zero carried-over state.

### 2. Latent risk (found, documented, not fixed — correctly out of scope): Triple Evaluation of Array Index Expressions

`issues/triple-evaluation-of-array-index-expression.md`. An array
index expression's bytecode is inserted three times (bounds check ×2,
address computation ×1) — currently invisible because every callable
function is pure/deterministic, but a real correctness and performance
risk once any side-effecting operation exists (3.1C+). Documentation
corrected to no longer conflate this with the (unrelated) Expression
Tree Property. Not fixed — no side-effecting operation exists today to
make this observable, and fixing it is a real code change appropriately
deferred to its own review cycle.

## Full Gate Review Criteria, Re-Verified After the Fix

**1. Open issues**: 4 total (1 newly found and FIXED this session, 1
newly found and correctly left OPEN/out-of-scope, 2 pre-existing).
Every OPEN issue re-confirmed reproducible, fresh, during this same
review — not assumed from the prior report.

**2. Contract coverage**: `ARRAY_SINGLE_ALLOCATION_CONTRACT` added (5
tests) as the permanent guard for the critical bug found this session.
All other Contracts unchanged, still passing.

**3. Golden Tests**: 25 cases (up from 24 — one new case,
`25-array-early-write-survives-loop`, added specifically for the
critical bug). All 25/25 passing. Three pre-existing cases (21, 22,
23) legitimately shrank in byte size (the fix removes redundant
allocation bytecode) — regenerated and re-verified.

**4. Full regression, fresh**: **2333/2333**, confirmed twice — once
in place, once from a genuinely fresh copy (`node_modules` deleted,
`npm install` attempted — the same registry-access limitation as
before was hit again and reported honestly; the TypeScript-version
caveat from the original clean-build report still applies).

**Note added per subsequent review**: this figure reflects the
verification environment used at the time this Gate Review was
written, in which a disclosed alternative execution mechanism was used
in place of the real `vitest` package (not a falsification of
results, simply a different runner interpreting the same real test
files). It has NOT been re-verified within the current, stricter
independent verification round (`FINAL_DIRECTIVE_EVIDENCE_REPORT.md`)
using real `vitest`. Do not treat this figure as freshly re-confirmed.

**5. Scope discipline**: the fix touched exactly the two functions
identified as the root cause (`encodeIfElseMergeFunctionBody`,
`encodeWhileFunctionBody`) and the shared `encodeStatements()`
signature — no Memory Layout, Address Formula, or IR change. This
fix is explicitly permitted under the freeze policy's "confirmed,
documented bug fix" exception.

## Decision

**✅ The critical fix itself is APPROVED (Revision 2)** — with the
explicit acknowledgment that the original Revision 1 review was
insufficient and should not be relied upon on its own merits.

**Correction (per independent review of `RC2_VALIDATION_REPORT.md`,
applied here for consistency): this document's original wording
("recommended for freeze") overstated what the available evidence
supports, for the same reason identified in that report — dependency
installation via `npm install` could not be completed in this
environment, and the cause (network restriction vs. a genuine
dependency issue) has not been proven, only observed.** This baseline
is **Release Candidate Ready**, not Frozen. Formal freeze requires one
final network-enabled validation run (fresh clone → `npm install` →
clean build → full tests → Golden Tests) completing successfully — see
`RC2_VALIDATION_REPORT.md` §9 for the full, corrected verdict.
