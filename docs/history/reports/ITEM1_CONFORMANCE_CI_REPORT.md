# Item 1 — Conformance Suite Tool → CI: Report

**Written LAST, summarizing the `item1-conformance-ci` CHANGELOG
entry, written first.**

---

## Task

"تحويلها من ملفات مرجعية إلى أداة تشغيل رسمية. دمجها مع CI. جعل أي
فشل يمنع الدمج."

## Status at Start of This Item

- Official single-command runner: **already existed**
  (`tools/run-conformance.ts`, `npm run conformance`) — from a prior
  stage.
- CI integration: **did NOT exist** — `docs/CONFORMANCE_SUITE.md`
  only showed an illustrative YAML snippet; no `.github/workflows/`
  directory existed anywhere in the repository.

## Delivered This Round

`.github/workflows/ci.yml` — 5 jobs (Build, Full Test Suite, Golden
Tests ×3, Conformance Suite, Examples), triggered on every push/PR.

## Verification

Every command in the workflow file was run locally and confirmed
passing before the file was finalized: tsc (0 errors), WASM Golden
(25/25), codegen Golden (84/84), optimizer Golden (4/4), Conformance
(11/11), Examples (8/8).

**One error caught during this work**: the workflow's first draft
referenced a directory (`tests/optimizer/golden`) instead of the
actual test file (`tests/optimizer/golden/golden.test.ts`) — found and
fixed before verification, not shipped incorrectly.

## What "Blocks Merge" Actually Requires (disclosed, not assumed complete)

This workflow file makes the 5 checks available as GitHub status
checks — it does NOT, by itself, make them REQUIRED for merge. That
requires a one-time repository setting (Branch Protection → Require
status checks) which must be enabled by whoever administers the
repository. This is explicitly noted in `docs/CONFORMANCE_SUITE.md`,
not silently assumed to already be configured.

## Recommendation

Item 1 complete by its own stated criteria. Recommend the repository
administrator enable the branch-protection setting noted above as a
follow-up action (outside this Item's own scope, since it's a
GitHub-settings action, not a code change). Proceed to Item 2
(examples/) upon review approval.
