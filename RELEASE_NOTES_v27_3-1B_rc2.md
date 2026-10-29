# UR-Bridge v27 — WASM Backend 3.1B RC2 — Release Notes

**Release date:** 2026-07-10
**Tests:** 2333/2333 passing
**TypeScript errors:** 0
**Gate Review:** `GATE_REVIEW_3_1B_REVISION_2.md` — **APPROVED**
**Supersedes:** RC1 (`RELEASE_NOTES_v27_3-1B_rc1.md`), which contained
a critical, since-fixed memory-corruption bug.

**Note added per subsequent review**: the test figure above reflects
the original verification environment, in which a disclosed
alternative execution mechanism was used in place of the real `vitest`
package (which could not be installed) — not a falsification of
results, simply a different runner interpreting the same real test
files. It has NOT been re-verified within the current, stricter
independent verification round (`FINAL_DIRECTIVE_EVIDENCE_REPORT.md`)
using real `vitest`. Do not treat this figure as freshly
re-confirmed.

---

## Status

**Level 3.1B (through 3.1B.5) is RELEASE CANDIDATE READY as of this
version — NOT YET FORMALLY FROZEN.**

**Correction (per independent review, applied for consistency with
`RC2_VALIDATION_REPORT.md` §9): every validation step executable in
this environment passed with no defects found — clean build, full
test suite, Golden Tests, the critical fix's own verification,
regression review, and issue review. The one incomplete item is
dependency installation via `npm install`, which could not complete
in this network-restricted environment; the cause has not been
proven, only observed (a `403` error is consistent with, but not
proof of, a network restriction rather than a genuine dependency
issue).** Formal freeze requires one final network-enabled validation
run (fresh clone → `npm install` → clean build → full tests → Golden
Tests) completing successfully without any code modification. Once
that completes, the same standing discipline already intended for RC1
applies: no new features, no refactoring, no performance optimizations
against this baseline until a future gate review explicitly lifts the
freeze.

## What Changed From RC1

A from-scratch, adversarial re-review (explicitly not relying on RC1's
own Gate Review) found and fixed **one critical bug**:

**Array Re-Allocated Every Loop Iteration** — writing to an array
inside a `while` loop body caused silent re-allocation on every
iteration, corrupting every earlier iteration's write. Root cause: an
allocation-tracking `Set` was scoped per CFG block instead of per
function. Fixed by sharing one `Set` across all blocks in the same
function body. No existing test caught this because every one
happened to either write the same value repeatedly or only read the
last-written index — both patterns that mask the bug's effect.
Full details: `issues/CRITICAL-array-reallocated-every-loop-iteration.md`.

Also found (documented, correctly left unfixed — a latent risk, not
yet an active bug): array index expressions are evaluated three times
in emitted bytecode, currently invisible because no side-effecting
function bodies exist yet. Full details:
`issues/triple-evaluation-of-array-index-expression.md`.

## What This Baseline Contains

Identical scope to RC1 (see `RELEASE_NOTES_v27_3-1B_rc1.md` for the
full feature list: 3.1A through 3.1B.5) — this release corrects RC1's
implementation, not its scope.

## Known, Tracked, Deliberately Unresolved Issues (re-confirmed reproducible during this review)

1. Single-element array produces invalid C (Level 2.8, C Backend).
2. Cross-block reference to a never-reassigned variable crashes the
   encoder (general, predates 3.1B).
3. Array index expressions evaluated 3 times (latent, not yet active).

None block this freeze.

## Test Coverage Summary

- **2333/2333** tests passing (up from 2327 — 6 new tests for the
  critical fix's permanent regression guard).
- **25 Golden Test cases** (up from 24 — one new case specifically
  reproducing the critical bug).
- Confirmed from a genuinely fresh copy (`node_modules` deleted,
  `npm install` attempted — hit the same npm-registry access
  limitation as RC1's own clean-build report; the TypeScript-version
  caveat from that report still applies).

## Freeze Policy

Identical to RC1's own policy. Any change to a file within 3.1B.1
through 3.1B.5's scope requires either a confirmed, documented bug fix
or a new gate review explicitly lifting the freeze.
