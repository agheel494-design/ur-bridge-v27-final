# Test Plan — Level 3.1B.6 (Conditional Allocation)

**Status: PROPOSAL ONLY. No test code written. This plan describes
scenarios and expected outcomes for whoever implements 3.1B.6 to turn
into real tests during that phase's own work — not before.**

---

## Scope Recap (from `MILESTONE_3_1B_6.md`)

An array declared/allocated inside only one branch of `if`/`else`, or
repeatedly inside a `while` loop body — both currently rejected by
`ARRAY_CONTROL_FLOW_CONTRACT` (3.1B.4/RC2), by design, pending this
milestone's own review.

## Proposed Test Categories

### A. Basic Acceptance Scenarios

1. Array allocated in `then` only, used only within `then`, `else`
   never touches it. (The exact case originally found "working by
   accident" in 3.1B.4 — now the actual target of design.)
2. Array allocated and used in BOTH `then` and `else` — each branch
   gets its OWN independent allocation (not sharing one).
3. Array allocated inside a `while` loop body, used only within that
   same iteration (not persisted across iterations) — confirm each
   iteration's array is independent, or explicitly decide/document
   that this is NOT the same array across iterations.

### B. Boundary/Edge Cases

4. Array allocated in `then`, but the condition is always false at
   runtime (so `then` never executes) — confirm no allocation happens,
   bump pointer unchanged, no memory corruption from an unreachable
   allocation site.
5. Array allocated inside a loop that runs zero iterations — same
   check as #4, loop-specific.
6. Array allocated inside `then`, then a DIFFERENT array (different
   slot) allocated inside `else` — confirm no address collision
   between the two, regardless of which branch actually executes.
7. Nested conditional allocation: array allocated inside an `if`
   that's itself inside another `if`'s branch — likely still out of
   scope (nested control flow remains unsupported per
   `ARRAY_CONTROL_FLOW_CONTRACT`'s existing rejections) — test should
   confirm continued clean rejection, not new acceptance, unless
   3.1B.6's own design explicitly extends to this.

### C. Regression Checks (confirm NOTHING already working breaks)

8. Every existing 3.1B.4/3.1B.5 scenario (array allocated in `entry`,
   used in `if`/`while`) must continue to pass unchanged.
9. `ARRAY_SINGLE_ALLOCATION_CONTRACT`'s own scenarios (the RC2 critical
   fix) must continue to pass — conditional allocation must not
   reintroduce any re-allocation-per-iteration risk for the `entry`-
   allocated case.
10. Bounds checking must continue to function correctly for a
    conditionally-allocated array (an out-of-bounds access inside the
    branch that allocated it must still trap).

### D. Memory Model Interaction

11. Confirm the bump allocator's behavior when the SAME conditional
    branch (e.g., a loop body) might allocate on some iterations and
    not others (if the design permits data-dependent allocation) —
    or confirm this specific shape is explicitly rejected if the
    design does not support it.
12. Confirm two conditionally-allocated arrays, one in `then` and one
    in a DIFFERENT function entirely, do not interact (per-function
    slot scoping, already proven for 3.1B.4 — should hold identically
    here).

## Golden Tests Proposed (2 minimum, matching every prior batch's pattern)

- One case: array allocated and read within a single `if` branch only.
- One case: array allocated independently in both `then` and `else`.

## Explicitly Not Covered by This Plan

- Dynamic array length, resize, `free`, GC, nested/arrays-of-arrays —
  all remain out of scope per every prior batch's own documented
  deferrals, unaffected by 3.1B.6's own scope.
- Any performance benchmark beyond what 3.1B.4/3.1B.5's own batches
  already established as the measurement pattern (byte size, compile
  time independent of runtime bound, real execution timing).

## Note on This Plan's Own Limits

This is a proposal for scenario coverage, not a commitment to
implementation approach — 3.1B.6's own CFG-drawing and design-first
work (per `MILESTONE_3_1B_6.md` and this project's standing discipline)
may reveal that some of these scenarios require further scope
narrowing (matching the exact pattern seen in 3.1A.6→3.1A.6b→3.1A.6c
and 3.1B.4→3.1B.5), in which case this plan should be revisited
alongside that design work, not treated as fixed in advance.
