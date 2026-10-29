# Milestone: UR Language v1.1 — DEFINED (not opened as an actual branch)

**Status: DEFINED, NOT STARTED, NOT AN ACTUAL GIT BRANCH — no `.git`
repository exists in this environment. This document specifies the
scope and standing rules for a v1.1 milestone/branch, ready for
whoever has real Git access to actually open it. It exists solely to
mark the boundary requested by the reviewing party: all new language-
design work from this point forward belongs here, never as an
amendment to v1.0 (`TAG_ur-language-v1.0.md`,
`UR_LANGUAGE_V1_0_BRANCH_POLICY.md`) — once that freeze is itself
independently confirmed, per those documents' own pending-verification
status.**

---

## Scope (per `UR_LANGUAGE_VERSION_MATRIX.md`'s own "1.1" column — not newly invented here)

1. **`for`/`in` loops** — grammar already exists (§5.8); needs a
   genuinely new CFG shape for Lowering, matching this project's own
   design-first discipline (draw the CFG, ratify an Invariant, hand-
   verify before any code — the same process every prior control-flow
   feature went through).
2. **`if` used as an expression** — same treatment as `for`; a
   conditional that produces a value is also a new CFG shape, not a
   small patch.
3. **Named-type annotations** — resolving a `struct` or `type`-alias
   name when used as an explicit `: TypeName` annotation (currently
   only inference-from-constructor-call works for structs; type
   aliases have the identical limitation). Root-caused in
   `issues/named-type-annotations-not-resolved.md`: `resolveTypeRef()`
   needs to consult a combined struct+alias registry.
4. **Contextual/bidirectional type inference** — closing the `void`-
   gap for unannotated parameters/variables used in a context needing
   a concrete backend type (unary `!`, multi-argument calls). Requires
   genuinely new inference capability, not a table lookup — its own
   design question, likely the largest single item in this milestone.
5. **Enum declarations** — not yet designed at all; `enum` currently
   only has a diagnostics-level placeholder (`PE009`) preventing
   silent misparsing, not a real grammar or semantics.

## Explicitly Out of Scope for v1.1 (unchanged from every prior review's own conclusion)

Generics, Classes/Inheritance/Interfaces, Async/await, pattern
matching, closures, `try`/`catch`, operator overloading, macros,
tuples — all remain 2.0-or-later, confirmed architectural, not
touched by this milestone.

## Standing Rule

Per `UR_LANGUAGE_V1_0_BRANCH_POLICY.md`: none of this milestone's work
may alter v1.0's own frozen behavior. Every item above gets its own
dedicated design-first cycle — CFG drawn, Invariant ratified, hand-
verified — before any code, exactly matching the discipline that
avoided scope creep on `byte`/char-literal/`type`-alias during Freeze
Week, now made the standing rule for this milestone's own work rather
than an ad-hoc practice.

## Explicitly NOT Started

No CFG has been drawn, no Invariant proposed, no code written for any
item above. This document is a placeholder marking readiness to
begin, not a design document — matching the identical precedent
already set by `MILESTONE_3_1B_6.md` for the WASM Backend's own next
milestone.
