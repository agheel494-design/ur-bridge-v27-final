# Release Checklist

**Use this only AFTER `FREEZE_CHECKLIST.md` is fully satisfied and
`APPROVED FOR FREEZE` has been formally recorded. Producing a release
before that point conflates verification with distribution — the
exact ordering this project's own history shows matters.**

---

## Pre-Release Confirmation

- [ ] `FREEZE_CHECKLIST.md` fully checked, evidence linked.
- [ ] Verdict is exactly `APPROVED FOR FREEZE` (not `Release Candidate
      Ready`, not any intermediate wording).
- [ ] Exact commit hash and tag match between the Freeze Checklist and
      what is being released.

## Release Artifact Preparation

- [ ] Release notes finalized, referencing the exact frozen commit/tag.
- [ ] Release notes list every feature shipped in this release,
      cross-referenced against the Invariant/Contract/Test coverage
      matrix (no feature claimed without matching test evidence).
- [ ] Known, open issues listed explicitly (not hidden) — with their
      scope/impact stated (per `BUG_REPORT_TEMPLATE.md`'s severity
      scale).
- [ ] Deferred/out-of-scope items listed explicitly, distinguishing
      "not yet built" from "deliberately rejected" (matching this
      project's own established distinction throughout its history).

## Tag and Versioning

- [ ] Formal tag created (not just a markdown record, if real version
      control is available) matching this project's naming convention.
- [ ] Tag is immutable from this point — no force-push, no retroactive
      edits to what the tag points at.

## Post-Release

- [ ] Announce the release through whatever channel this project uses.
- [ ] Open the next milestone (per `MILESTONE_<next-phase>.md`
      convention already established) — only now, never before this
      checklist completes.
- [ ] Confirm the freeze's standing rule remains active for the
      released scope: no further code changes except documented bug
      fixes, tracked through the same Issue process.

## If a Post-Release Defect Is Found

- [ ] File via `BUG_REPORT_TEMPLATE.md`.
- [ ] Do NOT patch the released tag in place — a fix becomes its own
      new, reviewed, re-verified release (matching this project's own
      RC1→RC2 precedent: a new tag, not a silent edit).
