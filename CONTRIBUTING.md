# Contributing to UR-Bridge

**This document describes the actual practices this project has
followed throughout its own history — not aspirational policy. Every
rule below traces to a real, established pattern used repeatedly in
this project's own `CHANGELOG.md`.**

---

## The Mandatory Process Order

Every change, without exception:

```
1. Implementation Diff
        ↓
2. Regression Tests
        ↓
3. API Freeze Check (only if the change touches a public Standard
   Library / URPM-facing surface — see STDLIB_API_FREEZE_CHECK.md)
        ↓
4. Documentation Update
        ↓
5. CHANGELOG Update  (written the moment the change is made — never
   deferred until "we'll remember later")
        ↓
6. Sprint/Session Report (summarizes 1-5 — introduces no new claim)
```

Full rationale: `PROCESS_RULE_SPRINT_ORDER.md` — adopted after a real
incident where a genuine fix (`PE010`) went undocumented for an entire
work cycle, discovered only when a reviewer asked why a test count had
changed.

## Verification Requirements

- **Before claiming a fix works**: run it directly, don't trust a
  prior report or your own memory of having tested it. This project's
  own history includes multiple instances of a prior "report" being
  wrong on direct re-verification (a line-number citation, an example
  that didn't actually compile, an unverified claim about which
  examples work on WASM) — each caught by re-running the actual code,
  not by re-reading the report.
- **Regression-detection must be proven, not assumed**: for any new
  test/tool meant to catch future regressions, deliberately corrupt
  the expected value once, confirm the test/tool actually fails, then
  revert. A test suite that has never been shown to fail is not proven
  to catch anything.
- **No speculative fixes**: a code change requires a reproducible
  failure and, for anything beyond a trivial fix, a Root Cause
  Analysis identifying the exact responsible layer/function before any
  patch is written (see `STAGE3_WASM_RCA_VALIDATION_FINAL.md` and
  `PATCH_DESIGN_WASM_SSA.md` for a full worked example of this
  discipline).

## Scope Discipline

- **No feature added without an explicit decision it's in-scope for
  the current version.** See `UR_LANGUAGE_VERSION_MATRIX.md` for the
  authoritative v1.0/v1.1/v2.0 assignment of every known feature.
- **No example, documentation, or test written for an unsupported
  feature.** If a capability doesn't exist, say so in
  `KNOWN_LIMITATIONS.md` — never write an example that doesn't
  actually compile/run to make a feature look more complete than it
  is.
- **Minimal patches preferred over broad refactors**, unless a design
  document (matching the `PATCH_DESIGN_*.md` pattern) explicitly
  justifies a wider-scoped change and its risks are documented.

## Documentation Discipline

- **Docs must match code, not aspiration.** Every claim in a `.md`
  file describing current behavior should be independently verifiable
  by running the actual code — not copied from a prior document
  without re-checking.
- **When a doc is found stale or contradictory**, correct it in place
  and note what changed and why (matching the pattern used throughout
  `KNOWN_LIMITATIONS.md`'s own edit history) — don't silently delete
  the old claim without a trace.
- **Known open questions get documented as open, not silently
  resolved one way** - until they are decided by the release process.
  Example: this project's package identity (`ur-bridge-v27` / `27.0.0`
  in `package.json`, versus "UR Language v1.0") was recorded here as an
  open naming question; it was decided on 2026-10-20
  (UR-PM-G1-DECISION-001, see `RELEASE_PROCESS.md` "Release Identity"):
  the product version is `1.0.0` with `VERSION` as its single source of
  truth; `ur-bridge-v27` / `27.0.0` is the separate repository/package
  identity. *Change note (2026-10-20):* the earlier wording called this
  "a real, unresolved naming question"; it is no longer unresolved.

## Independent Verification

This project uses a two-party model: a Linux development team and an
independent Windows validator (see `WINDOWS_VALIDATION_RUNNING_INSTRUCTIONS.md`
for the current handoff format). No change is considered fully closed
until the independent party's own re-verification — not the same
party that wrote the code — confirms it. See
`SIMULATED_AUDIT_REPORT.md` for why this matters: even a careful
same-party review missed a real regression that an adversarial,
fresh-eyes pass caught.

## Git Branching Policy (Priority 0, per explicit management directive)

**A real git repository now exists for this project** (previously
absent entirely — no `.git` existed anywhere in this project's
history; see `V1_0_RELEASE_DEFERRED_DECISION.md` for the full
context). This makes the dual-track strategy below technically
enforceable, not just documented policy.

- **`main`** — stable releases only. No direct commits.
- **`develop`** — integration branch. Track A stabilization work
  (installer, CLI, IDE, `run`/`build` correctness, field-test fixes)
  merges here.
- **`feature/*`** — one branch per Track B item (design/research for
  the advanced IDE, Python import layer, package system, debugger,
  registry — see `V1_0_RELEASE_DEFERRED_DECISION.md`'s own Priority
  2-4 list). **Not merged into `develop` or `main` until Track A
  closes.**
- **`hotfix/*`** — urgent fixes branched from `main`, for an
  already-released version.

Every change goes through review before merging — no exceptions.

**Honest, disclosed limitation**: enforcing "no direct commits to
`main`" and "review required before merge" as things that are
actually IMPOSSIBLE to bypass (not just a rule people follow) requires
GitHub's own server-side branch protection settings on a real, hosted
repository — this local repository alone cannot enforce that
technically. Creating the actual private GitHub repository and
enabling branch protection there is a real, outstanding step for
someone with GitHub network/account access (this development
environment has neither — confirmed directly, `api.github.com` is not
reachable from here). Until then, this section is the followed
policy, enforced by discipline and code review, not yet by a
technical gate.
