# TAG: v27-wasm-3.1b-rc2

**This is a permanent reference point. Supersedes `v27-wasm-3.1b-rc1`
(which contained a critical, since-fixed memory-corruption bug — see
`TAG_v27-wasm-3.1b-rc1.md` and
`issues/CRITICAL-array-reallocated-every-loop-iteration.md`).**

- **Tag name:** `v27-wasm-3.1b-rc2`
- **Date:** 2026-07-10
- **Marks:** Level 3.1B (3.1B.1 through 3.1B.5) — **Release Candidate
  Ready** (per `GATE_REVIEW_3_1B_REVISION_2.md`'s corrected decision:
  the critical array-reallocation bug is fixed, tested, and verified,
  but formal freeze remains pending a genuine network-enabled
  verification run — NOT YET FORMALLY FROZEN).
- **Test count at tag time:** 2333/2333, 0 TypeScript errors.
- **Golden Test count at tag time:** 25/25.
- **Note added per subsequent review**: both figures above reflect the
  original verification environment, in which a disclosed alternative
  execution mechanism was used in place of the real `vitest` package
  (not a falsification of results, simply a different runner
  interpreting the same real test files). They have NOT been
  re-verified within the current, stricter independent verification
  round (`FINAL_DIRECTIVE_EVIDENCE_REPORT.md`) using real `vitest`.
  Do not treat these figures as freshly re-confirmed.
- **Companion documents:** `GATE_REVIEW_3_1B_REVISION_2.md`,
  `LEVEL_3_1B_5_FINAL_REPORT.md`.
- **Open issues at tag time (deliberately unresolved, not blocking,
  all re-confirmed reproducible fresh during this review):**
  - `issues/level-2.8-single-element-array-c-backend-bug.md`
  - `issues/cross-block-reference-never-reassigned-variable-bug.md`
  - `issues/triple-evaluation-of-array-index-expression.md`
- **Fixed issue at tag time:**
  `issues/CRITICAL-array-reallocated-every-loop-iteration.md`

## What changed from RC1 to RC2

Exactly one code fix: `allocatedArraySlots` changed from a per-CFG-
block-fresh `Set` to a per-function-shared `Set`, in
`encodeIfElseMergeFunctionBody()` and `encodeWhileFunctionBody()`
(`src/backend/wasm/emit-wasm.ts`). No Memory Layout, Address Formula,
or IR change. One new Golden Test case, one new permanent Contract
(`ARRAY_SINGLE_ALLOCATION_CONTRACT`), one new issue file documenting a
separate latent risk found during the same review (not fixed, out of
scope), one existing issue file updated to FIXED status.

## Standing rule from this point forward

Identical in effect to `v27-wasm-3.1b-rc1`'s own rule, applied now to
this Release-Candidate-Ready state rather than to an actual freeze: no
commit against any file covered by this tag's scope, for any reason
other than fixing a bug tracked by an existing or newly-opened Issue
file, until the external verification cycle completes and a formal
Gate Review declares `APPROVED FOR FREEZE`.

## Note on tooling

Same as `v27-wasm-3.1b-rc1`: no `.git` directory exists in this
environment; this document serves as the tag record in place of an
actual `git tag` command.
