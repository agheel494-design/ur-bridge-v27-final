# Milestone: Level 3.1B.6

**Status: OPENED, NOT STARTED.**

This milestone exists solely to mark the boundary requested by the
engineering directive: all new work from this point forward belongs
here, never as an amendment to the frozen `v27-wasm-3.1b-rc1` baseline
(3.1B.1 through 3.1B.5, plus Level 3.1A).

## Scope (per prior discussion, not yet designed)

Conditional Allocation — an array declared/allocated inside only one
branch of `if`/`else`, or repeatedly inside a `while` loop body.
Previously found, during 3.1B.4's independent review, to "work by
accident" for simple cases via the general encoding mechanism — but
deliberately rejected anyway pending this milestone's own design-first
review (CFG shapes for nested/multiple conditionally-allocated arrays,
Invariant, hand-built-module verification, Contracts, Golden Tests),
per this project's established discipline.

## Explicitly not started

No CFG has been drawn, no Invariant proposed, no code written for this
milestone. This document is a placeholder marking readiness to begin,
not a design document.

## Standing rules inherited from the freeze

Per `TAG_v27-wasm-3.1b-rc1.md` and `GATE_REVIEW_3_1B.md`: no file
within 3.1B.1-3.1B.5's scope may be touched for this milestone's work
except to fix a bug tracked by an existing Issue file. All 3.1B.6 work
extends the codebase; it does not modify the frozen baseline.

## Open issues remain open

`issues/level-2.8-single-element-array-c-backend-bug.md` and
`issues/cross-block-reference-never-reassigned-variable-bug.md` remain
`OPEN` and are NOT to be closed simply because this milestone begins —
they close only when their own root causes are fixed, reviewed, and
tested, independently of this milestone's own progress.
