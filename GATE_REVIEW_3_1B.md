# Gate Review — Level 3.1B (through 3.1B.5)

# Gate Review — Level 3.1B (through 3.1B.5)

**⚠️ SUPERSEDED — see `GATE_REVIEW_3_1B_REVISION_2.md`. This review's
"APPROVED" decision was based on an incomplete audit that missed a
CRITICAL memory-corruption bug (array re-allocation on every loop
iteration), found only by a subsequent from-scratch adversarial
review. This document is preserved for the historical record — do not
rely on its decision on its own.**

**Type: Internal Engineering Gate Review. No new code written during
this review — verification only, per explicit instruction.**

**Scope reviewed**: Level 3.1A (already frozen, per
`LEVEL_3_1A_CLOSURE_REVIEW.md`) plus every Level 3.1B sub-phase
completed to date: 3.1B.1 (Linear Memory Foundation), 3.1B.2 (Bounds
Checking), 3.1B.3 (Dynamic Index), 3.1B.4 (Arrays Inside Control Flow),
3.1B.5 (Dynamic Index Inside a Loop).

---

## 1. Open Issues Review

**2 issue files, 3 distinct tracked bugs, all correctly OPEN (none
silently closed, none fixed inline during later batches):**

| Issue | Discovered during | Status |
|---|---|---|
| Single-element array produces invalid C (Level 2.8) | 3.1B.1 | OPEN |
| Cross-block reference to a never-reassigned variable crashes the encoder | 3.1B.5 | OPEN |
| Large array + `while` loop fails past a size threshold | 3.1B.5 | OPEN |

All three are confirmed, by their own documentation, to be **outside
the scope of every sub-phase that shipped since their discovery** —
none block any completed batch's own deliverable, and none were
fixed inline in violation of the freeze/minimal-change discipline.

## 2. Contract Coverage

**16 active, named Contracts, every one verified to have real,
non-empty test coverage** (counted directly from the test file, not
estimated): from 1 test (`BUMP_MONOTONIC_CONTRACT`) to 23 tests
(`ARRAY_CONTROL_FLOW_CONTRACT`). One additional name
(`NO_BOUNDS_CHECK_YET_CONTRACT`) exists only as a historical reference
inside `BOUNDS_CHECK_REQUIRED_CONTRACT`'s own describe-block name — not
a duplicate or orphaned block.

## 3. Invariant Documentation

Every ratified Invariant (3.1A.4 through 3.1A.6c, 3.1B.1 through
3.1B.5) is documented in `WASM_BACKEND_SPEC.md`/
`WASM_MEMORY_MODEL_SPEC.md`, and every one maps directly to a real
validator function in `emit-wasm.ts` (`validateDiamondShape`,
`validateMergeShape`, `validateWhileShape`, `validateWhileBreakShape`,
`validateWhileContinueShape`) — cross-checked directly, not assumed.
3.1B.3 and 3.1B.5 are explicitly documented as needing NO new
Invariant (stated deliberately, so this isn't mistaken for an
oversight).

## 4. Golden Tests

**24 cases, 24/24 passing**, confirmed via a fresh run during this
review (not relying on a prior batch's claim). Every batch from
3.1A.4 onward (except 3.1A.2's two cases, a known, honestly-flagged
gap recorded in `LEVEL_3_1A_CLOSURE_REVIEW.md`) has at least one
Golden Test proven, by direct deliberate corruption and revert, to
catch a real regression — spanning opcodes, branch depths, address
calculations, and bounds-check removal.

## 5. Performance

Measured directly (not theoretically) at each relevant batch:
3.1B.4's independent review found emission scaling closer to linear
than quadratic (2.62x time for a 2.00x size increase); 3.1B.5 found
zero byte-size overhead from dynamic index support (285 bytes
identical to the constant-index equivalent) and confirmed compile
cost is independent of runtime loop-iteration bounds.

## 6. Documentation Consistency

`WASM_BACKEND_SPEC.md` and `WASM_MEMORY_MODEL_SPEC.md` were checked
against the actual shipped code for this review (validator function
names, Contract names, Invariant numbering) and found consistent.
`LEVEL_3_1A_CLOSURE_REVIEW.md` remains the authoritative closure
reference for 3.1A. Each 3.1B sub-phase's own CHANGELOG entries and
final reports (`LEVEL_3_1B_5_FINAL_REPORT.md`) are internally
consistent with the test file and specification documents.

## 7. Full Regression, Confirmed Fresh During This Review

```
TOTAL: 2327 tests across 65 files — 2327 passed, 0 failed
```

Run via `tools/generate-build-report.ts` during this review itself —
not copied from a prior claim.

## 8. Scope Discipline

Confirmed directly (not merely asserted) throughout 3.1B's batches:
Memory Layout, Address Formula, IR, and the Bump Allocator design have
never changed since their 3.1B.1 ratification. No GC, no `free`, no
runtime resize, no conditional/nested-array support exists anywhere in
the shipped code — every such gap is either cleanly rejected (verified
via direct testing across multiple independent-review cycles) or
explicitly deferred in writing.

---

## Decision

**✅ APPROVED**

Level 3.1B (through 3.1B.5) meets every criterion checked in this
review: Contracts complete, Invariants documented, Golden Tests
proven effective, performance measured and acceptable, documentation
consistent with code, full regression clean, no out-of-scope changes
found. The three open issues are correctly tracked, correctly out of
scope, and correctly left unresolved pending their own dedicated
review cycles.

**Recommendation**: proceed to freezing this baseline as a Release
Candidate before any further feature work (3.1B.6 or beyond) begins.
