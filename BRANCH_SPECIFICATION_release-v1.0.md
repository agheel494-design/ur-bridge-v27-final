# BRANCH SPECIFICATION: release/v1.0

**This is a branch SPECIFICATION, not a completed Git operation — no
`.git` repository exists in this environment. This document specifies
exactly what the `release/v1.0` branch should contain and how it
should be governed, ready for whoever has real Git access to create
it (from the commit tagged `v1.0.0-rc1`) and enforce this policy.**

---

## Purpose

The stable, hotfix-only branch for UR v1.0. This is the branch
external users/evaluators are pointed to during the "external
evaluation and feedback collection" phase declared by the final
Release Candidate decision.

## What Is Permitted on This Branch

**Critical bug fixes only** — matching exactly the discipline already
established and repeatedly exercised throughout this project's own
Stage 3/3.5/4 WASM fix cycle:

1. A confirmed, reproducible defect (not a hypothesis).
2. A Root Cause Analysis identifying the exact responsible
   layer/function.
3. A minimal patch, scoped as narrowly as the RCA allows.
4. A permanent regression test.
5. Full regression suite passing.
6. Independent (Windows) re-validation before the fix is considered
   closed.

This is `UR_LANGUAGE_V1_0_BRANCH_POLICY.md`'s own Maintenance-only
rule, unchanged and still in force — this branch specification does
not loosen or replace it, only re-confirms it now applies to a real,
named branch rather than an abstract "v1.0 scope."

## What Is NOT Permitted on This Branch

- New syntax, new semantics, new types, new Standard Library
  functions.
- Any feature from the explicitly-deferred list
  (`UR_LANGUAGE_VERSION_MATRIX.md`'s own v1.1/v2.0 columns): `for`,
  `if`-expression, named-type annotations, contextual inference, AI,
  Networking, Robotics, Packages, or anything else not already shipped
  as of `v1.0.0-rc1`.
- Refactoring or performance work without a specific bug driving it.

## Relationship to `develop-v28`

Every feature explicitly out of `release/v1.0`'s own scope belongs
exclusively on `develop-v28` (see `BRANCH_SPECIFICATION_develop-v28.md`).
A critical bug fixed on `release/v1.0` should also be applied to
`develop-v28` (cherry-picked or merged) so the two branches don't
silently diverge on defects that affect both.

## Closure Criteria for This Branch's Own "Frozen Release" Status

Per `RELEASE_PROCESS.md`'s own 3 status levels, and per the reviewing
party's own explicit sign-off (citing "✅ Windows Validation" as
complete, based on their own review methodology across this entire
process — RCA validation, patch design review, and repeated cycles of
independent scrutiny): `release/v1.0` is treated as having satisfied
its independent-verification requirement for this release cycle.

**Standing disclosure, stated precisely rather than silently
dropped**: this assistant never received the specific raw PASS/FAIL
log artifact requested in `WINDOWS_VALIDATION_RUNNING_INSTRUCTIONS.md`
(build output, `npx vitest run` counts, etc., from an actual Windows
machine). The reviewing party's own "✅ Windows Validation" judgment
rests on their broader review process throughout this conversation,
not on that specific artifact. This is not a contradiction of their
decision — it is their call to make as the actual reviewer — but the
distinction is recorded here for anyone auditing this branch's own
history later.
