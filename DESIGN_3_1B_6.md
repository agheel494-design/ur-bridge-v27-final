# Design Document — Level 3.1B.6: Conditional Allocation

**Status: THEORETICAL DESIGN ONLY. No code written. No CFG hand-built-
module verification performed (that step belongs to 3.1B.6's own
implementation phase, per this project's standing discipline — this
document prepares the groundwork, it does not substitute for that
step).**

---

## 1. Goal

Support an array declared/allocated inside only ONE branch of an
`if`/`else` (e.g., `if (...) { let arr = [...] ...}`), and/or an array
allocated repeatedly inside a `while` loop body — both currently
rejected by `ARRAY_CONTROL_FLOW_CONTRACT` (3.1B.4/RC2), which requires
every array to be allocated in `entry`.

## 2. Why This Is Its Own Milestone, Not Bundled Elsewhere

Found during 3.1B.4's own independent review: the general encoding
mechanism happens to produce a CORRECT result for the simplest
conditional-allocation case, purely by accident of how permissive the
existing code is — but this was deliberately rejected anyway, because
it never went through this project's own design-first discipline
(CFG drawn, Invariant ratified, hand-built-module verification,
Contracts, Golden Tests). This milestone exists to do that work
properly, not to simply re-enable what already "worked by accident."

## 3. Scope Boundaries

### In Scope (proposed)

- An array allocated inside exactly one branch of a single-level
  `if`/`else` (the Merge shape, Invariant 3.1A.5), used only within
  that branch or after the merge IF both branches independently
  allocate their own array to the same slot before the merge point
  reads it.
- An array allocated inside a `while` loop body (the plain-`while`
  shape, Invariant 3.1A.6), with each iteration's allocation treated
  as either (a) a fresh, independent array per iteration, or (b) an
  explicitly-rejected shape if the design cannot cleanly support
  per-iteration allocation without reintroducing a variant of RC2's
  own critical bug — this exact choice is 3.1B.6's own first design
  question (see §6).

### Out of Scope (explicitly deferred, not silently expanded into)

- Nested control flow (`if` inside `while`, etc.) combined with
  conditional allocation — already out of scope for every prior batch;
  no reason to assume it's included here without its own review.
- Dynamic array length, resize, `free`, GC — unaffected, still
  entirely out of scope project-wide.
- Arrays of arrays / nested arrays — unaffected, still out of scope.
- Any change to the Memory Layout, Address Formula, or bump allocator
  design — Conditional Allocation is about WHEN allocation happens
  (which CFG block), not HOW (the formula/layout stay exactly as
  ratified in `WASM_MEMORY_MODEL_SPEC.md`).

## 4. Risks

1. **Re-introducing a variant of the RC2 critical bug**: if a
   conditionally-allocated array's `allocatedArraySlots` tracking is
   scoped incorrectly again (e.g., per-iteration instead of
   per-function, or per-branch instead of per-function), the exact
   same class of silent memory corruption could recur in a new shape.
   **Mitigation**: 3.1B.6's own implementation must directly test the
   "read an early value after later writes" pattern that exposed the
   original bug, for every new shape this milestone introduces — not
   just confirm the observable output looks right.
2. **Ambiguous semantics for loop-body allocation**: does each loop
   iteration get a NEW array (independent memory), or does the array
   persist and get "re-initialized" each iteration? This is a genuine
   language-semantics question, not just an implementation detail —
   likely needs a decision from whoever owns UR's own language
   semantics, not just the WASM Backend.
3. **Bump pointer exhaustion**: repeated allocation inside a loop
   (if permitted at all) advances the bump pointer every iteration,
   with no `free` — a loop with many iterations could exhaust the
   single WASM memory page faster than any existing 3.1B test
   currently does. Needs an explicit boundary test (documented, not
   necessarily fixed within 3.1B.6 itself — could be flagged as a
   further, separate limitation).

## 5. Proposed Invariants (for ratification during 3.1B.6's own review — not ratified here)

> **Invariant 3.1B.6 (proposed)**: an array's allocation site (its
> first `array_store`) may occur in any CFG block, not only `entry` —
> but the `allocatedArraySlots` tracking set must remain scoped to the
> entire function body (matching the RC2 fix's own pattern), regardless
> of which block actually triggers the allocation.

## 6. Open Design Question (first item for 3.1B.6's own CFG-drawing step)

Does a `while`-loop-allocated array represent ONE allocation (reused
across iterations, like `entry`-allocated arrays are today) or MANY
(one fresh allocation per iteration, matching how a `let` inside a
loop body might be expected to behave in other languages)? This
question should be resolved by drawing the CFG and testing both
interpretations directly, per this project's standing discipline —
not decided in this planning document.

## 7. Proposed Contracts (names only, for 3.1B.6's own implementation)

- `CONDITIONAL_ALLOCATION_CONTRACT` — accepts the ratified shape(s),
  rejects whatever remains explicitly out of scope.
- Extension or renaming of `ARRAY_SINGLE_ALLOCATION_CONTRACT` if the
  "one allocation, function-scoped" invariant needs to be restated for
  the new shapes this milestone introduces.

## 8. Proposed Test Coverage

See `TEST_PLAN_3_1B_6.md` for the detailed scenario list.

## 9. What This Document Does NOT Decide

- The exact implementation approach (which functions in `emit-wasm.ts`
  need extension, mirroring how 3.1B.4 extended `validateMergeShape`/
  `validateWhileShape`).
- The answer to §6's open design question.
- Whether `CONDITIONAL_ALLOCATION_CONTRACT` is a new Contract or an
  extension of an existing one.

All of the above are 3.1B.6's own implementation-phase decisions, to
be made only after this milestone formally begins — which, per every
standing instruction across this project's history, does not happen
until Level 3.1B's freeze is formally approved.
