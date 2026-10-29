# UR-Bridge Release Process

**Describes the actual process this project has followed, not a
theoretical one. Grounded in the real Stage-based sequence used
throughout this project's own recent history.**

---

## Status Levels (in order)

1. **Freeze Candidate** — implementation, documentation, and review
   methodology are mature; independent (cross-party) verification is
   pending or incomplete. This is NOT "Stable" or "Production Ready" —
   see `TAG_ur-language-v1.0.md`'s own canonical status statement for
   why that distinction is treated as load-bearing, not pedantic.
2. **Verified Release Candidate** — an independent party (different
   from whoever wrote the code) has re-run the build and full test
   suite from a clean checkout and confirmed matching results.
3. **Frozen Release** — all Verified Release Candidate conditions met
   AND cross-platform validation (currently: Linux + Windows) shows
   matching results, with any discrepancy investigated to a Root Cause
   Analysis and resolved (or explicitly accepted as a documented,
   non-blocking platform difference).

## The Stage Sequence (for any release-track work item)

Matches this project's own recently-established discipline (see
`CHANGELOG.md`'s Stage 1-4.5 entries for a full worked example):

1. **Evidence gathering** — reproduce the issue/confirm the feature
   request directly; no work begins on a hypothesis alone.
2. **Root Cause Analysis** (for bugs) — identify the exact responsible
   layer/function with direct evidence (execution traces, not just
   static code reading, when a static-only analysis leaves room for
   doubt — see `STAGE3_WASM_RCA_VALIDATION_FINAL.md` for the
   escalation from "strong hypothesis" to "execution-trace-proven").
3. **Patch/Feature Design** — scope, root cause, strategy (framed as
   ONE CANDIDATE approach, not a mandate — the implementer may find a
   cleaner solution), risks, and required regression tests — all
   BEFORE any code is written.
4. **Implementation** — the actual diff, scoped as narrowly as the
   design allows.
5. **Linux Validation** — full regression suite, Golden Tests,
   Conformance Suite, and any feature-specific tests, all passing.
6. **Independent (Windows) Validation** — a different party re-runs
   the same checks from a clean checkout. Any discrepancy is treated
   as a finding to investigate, never assumed to be a Linux-side bug
   or a Windows-side environment quirk without evidence either way.
7. **Closure** — only after step 6 passes (or any discrepancy is
   resolved through its own RCA cycle) is the work item considered
   done.

## Documentation Requirements Per Release

- `CHANGELOG.md` — every change gets an entry, written at the moment
  of the change (see `PROCESS_RULE_SPRINT_ORDER.md`), never
  retroactively batched.
- `KNOWN_LIMITATIONS.md` — kept current; any newly-discovered
  limitation is added the same cycle it's found, classified precisely
  (e.g., "Missing Semantic Specification" vs. "Regression Against
  Documented Diagnostic Contract" — see `SIMULATED_AUDIT_REPORT.md`
  for why this distinction matters and isn't just terminology).
- `UR_LANGUAGE_VERSION_MATRIX.md` — the authoritative record of what's
  in v1.0 vs. deferred to v1.1/v2.0; updated whenever a feature's
  version assignment is decided or changes.

## What Does NOT Block a Freeze Candidate → Verified Release Candidate Transition

Per established precedent: a single confirmed, well-scoped,
actively-tracked bug does not block release-candidate status — it's
classified as an **Open Critical Investigation**, worked in parallel
with other release-track items, not a hard project-wide blocker. It
DOES block the Frozen Release status until resolved or explicitly,
consciously accepted with documented rationale.

## Release Identity (decided 2026-10-20, UR-PM-G1-DECISION-001)

The package-identity question that this section previously recorded as
open has been decided (Project Manager under Project Owner delegation,
option B). The release identity is:

- **Product version**: `1.0.0`. The file `VERSION` is the **single
  source of truth** for it.
- **Repository/package identity**: `ur-bridge-v27` / `27.0.0` in
  `package.json` - this repository's own development lineage. It is
  kept, it is a separate field, and it is never used as the product
  version.
- Every other statement of the product version must equal `VERSION`:
  the CLI (`ur version`) and the Windows installer definition
  (`installer/windows/ur-bridge.iss`, `MyAppVersion`). This is enforced
  by `tests/cli/version-consistency.test.ts`.
- The release archive carries the product identity (`1.0.0`). The
  release tool rejects an archive version that differs from `VERSION`
  and records the product version and the repository/package version
  as separate fields. Work-copy or qualification labels (for example
  `1.0.0-wc6`) are never a distribution identity.

*Change note (2026-10-20):* this section replaces "Open Question, Not
Silently Resolved", which said the release process would need a
decision on the package identity before any Frozen Release is tagged.
That decision is the one recorded above. `V1_0_FINAL_FROZEN_BASELINE.md`
is unchanged and remains the historical record of the earlier "v1.0.0"
declaration.
