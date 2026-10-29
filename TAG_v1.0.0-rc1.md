# TAG SPECIFICATION: v1.0.0-rc1

**This is a tag SPECIFICATION, not a completed Git operation — no
`.git` repository exists in this environment (confirmed directly: `git
log -1` → `fatal: not a git repository`). This document specifies
exactly what the tag `v1.0.0-rc1` should point to and record, ready
for whoever has real Git access to execute the actual `git tag`
command against the matching commit.**

---

## Canonical Status Statement (superseding this document's own
## "Freeze Candidate" framing with the reviewing party's final decision)

> **UR v1.0 development phase is declared complete (Release
> Candidate). The current version enters external evaluation and
> feedback collection. Future development moves to v28. v1.0 is not
> reopened for development except for critical bug fixes.**

This supersedes (does not contradict) the prior canonical statement
in `TAG_ur-language-v1.0.md` — that statement's own three-part
distinction (mature methodology / reproducibility confirmed /
independent verification pending) remains historically accurate for
what it described; this new statement reflects the reviewing party's
own subsequent, explicit closure decision after all items in the
sequential roadmap (Items 1-5, Release Hardening) were reviewed and
accepted.

## What This Tag Marks

Every file in this archive as of the `release-hardening-audit`
CHANGELOG entry (the most recent entry at the time of this tag
specification) — the complete state of:
- UR Language v1.0 specification and implementation.
- The WASM SSA fix (Stages 3-4) and its independent-verification
  handoff package.
- CI configuration (`.github/workflows/ci.yml`).
- 8 official examples, all tested.
- Documentation set (README.md, CONTRIBUTING.md, RELEASE_PROCESS.md,
  KNOWN_LIMITATIONS.md, and the full `docs/` set).
- Test count at specification time: 2387/2387 (via this project's own
  disclosed Vitest-compatible substitute — see the standing caveat
  below).

## Standing Caveat (unchanged, still applies)

Every test count and Golden/Conformance result referenced by this tag
was produced using a disclosed, non-real Vitest-compatible substitute
— this sandboxed environment cannot reach the npm registry. **A real
`npm install` + `npx vitest run` in a network-connected environment
remains the one verification this tag's own claims have not yet had
independently confirmed against, beyond what the Windows validation
cycle (Stages 3-4) already covered for the WASM-specific fix.**

## Naming Note (unresolved, per standing decision — not re-litigated by this tag)

This tag is named `v1.0.0-rc1`, following semver convention for the
product identity ("UR Language v1.0"). The repository's own
`package.json` remains `ur-bridge-v27`/`27.0.0` — this dual identity
is a standing, explicitly-flagged decision (see `RELEASE_PROCESS.md`'s
"Open Question" section), not resolved by this tag's own naming
choice.
