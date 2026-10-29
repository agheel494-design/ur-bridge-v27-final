# TRANSITION_NOTE_v1_to_v2.md

**Why the v1 Phase Invariant is broken here, on purpose.**

v1's own Phase Invariant test asserted that zero file in `src/`
imports `array-object-model.ts`. This commit introduces the first
real consumer: a new Semantic-layer builder that produces a real
`ArrayObjectModel` instance from a real UR program. This is the
intended v1→v2 transition point stated explicitly in v1's own file
header — not a regression.

**What test replaces it.**

The old "zero consumers" test is removed. In its place, a new test
confirms the opposite of what v1 guaranteed: exactly one real consumer
exists (the new Semantic builder), and — critically — that Backend
and Lowering are **not** among the consumers. This is the real v2
guarantee: Semantic may depend on the model; `ir-builder.ts` and
`emit-c.ts` may not.

**What remains protected under v1.**

- `array-object-model.ts`'s own types and `validateArrayObjectModel`
  are unchanged.
- `ir-builder.ts` (Lowering) — zero modification.
- `emit-c.ts` (Backend) — zero modification.
- The old IR model remains the only one actually driving real
  compilation output; the new model is produced alongside it, not yet
  load-bearing.

**What is now v2's own responsibility.**

- A new, standalone Semantic-layer function that inspects a real,
  already-type-checked UR program and produces a real
  `ArrayObjectModel` instance for its array-typed entities.
- A real test proving this builder produces a model that passes
  `validateArrayObjectModel` for a real program — not a synthetic,
  hand-built model as in v1's own tests.
- Confirming, per the Exit Criteria, that this new capability exists
  in isolation, with the old model and old pipeline completely
  unaffected.
