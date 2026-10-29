# TAG: v27-wasm-3.1b-rc1

# TAG: v27-wasm-3.1b-rc1

**⚠️ SUPERSEDED — see `TAG_v27-wasm-3.1b-rc2.md`. The code state this
tag marks contained a CRITICAL memory-corruption bug (array
re-allocation on every loop iteration), found and fixed only by a
subsequent from-scratch adversarial review. Do not build on this tag.
Preserved for the historical record only.**

**This is a permanent reference point. Do not delete, move, or reuse
this tag name for any future commit.**

- **Tag name:** `v27-wasm-3.1b-rc1`
- **Date:** 2026-07-10
- **Marks:** Level 3.1B (3.1B.1 through 3.1B.5), frozen per
  `GATE_REVIEW_3_1B.md` (decision: **APPROVED**).
- **Test count at tag time:** 2327/2327, 0 TypeScript errors.
- **Golden Test count at tag time:** 24/24.
- **Companion documents:** `RELEASE_NOTES_v27_3-1B_rc1.md`,
  `GATE_REVIEW_3_1B.md`, `LEVEL_3_1B_5_FINAL_REPORT.md`.
- **Open issues at tag time (deliberately unresolved, not blocking):**
  `issues/level-2.8-single-element-array-c-backend-bug.md`,
  `issues/cross-block-reference-never-reassigned-variable-bug.md`.

## What this tag protects

Every file touched by Level 3.1A (already separately frozen, see
`LEVEL_3_1A_CLOSURE_REVIEW.md`) and Level 3.1B.1 through 3.1B.5 —
principally `src/backend/wasm/emit-wasm.ts`,
`src/backend/wasm/array-memory.ts`,
`tests/backend/wasm/emit-wasm.test.ts`,
`tests/backend/wasm/golden/`, `WASM_BACKEND_SPEC.md`,
`WASM_MEMORY_MODEL_SPEC.md`.

## Standing rule from this point forward

No commit against any file covered by this tag's scope, for any
reason other than fixing a bug tracked by an existing or newly-opened
Issue file, until a future Gate Review explicitly lifts this freeze.
This includes: no refactoring, no performance optimization, no code
cleanup, no file reorganization — exactly the four prohibitions
listed in the freezing directive.

## Note on tooling

This environment has no `git` repository initialized for this
project (confirmed: no `.git` directory present), so this document
serves as the tag record in place of an actual `git tag` command.
Whoever imports this codebase into a real git repository should
create the literal tag `v27-wasm-3.1b-rc1` at the commit matching
this archive's exact contents, to make this reference point durable
and diffable going forward.
