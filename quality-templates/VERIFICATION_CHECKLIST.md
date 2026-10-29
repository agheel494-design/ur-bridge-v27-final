# Verification Checklist

**The standing, reusable checklist for any external verification
cycle — not specific to one release. Use this whenever independent
verification of a code state is required, per this project's own
established distinction between "internal report" and "independently
verified."**

---

## Environment

- [ ] Genuinely independent environment (not reusing any artifact,
      cache, or `node_modules` from a prior run).
- [ ] Real network access confirmed (able to reach the actual package
      registry — do not proceed with a substitute/stub and call it
      verification of the real dependency chain).
- [ ] Tool versions recorded exactly (`node --version`, `npm
      --version`, and the actually-installed dependency versions —
      not the ranges declared in `package.json`).

## Execution

- [ ] Fresh clone from the canonical source.
- [ ] Dependency installation via the project's own declared command,
      unmodified.
- [ ] Full build, exact command as declared by the project.
- [ ] Full test suite, exact command as declared by the project.
- [ ] Any specialized test category (e.g. Golden Tests) run separately
      and confirmed.
- [ ] Every command's raw stdout/stderr AND exit code captured — a
      summary sentence ("tests passed") is not sufficient evidence on
      its own.

## Comparison

- [ ] Every count (tests, Golden cases, Contracts, etc.) compared
      against the documented reference value explicitly — a match is
      stated, not assumed.
- [ ] Working tree confirmed unmodified after the full run.
- [ ] Any divergence, however small, filed via
      `REGRESSION_REPORT_TEMPLATE.md` — never silently dismissed as
      "probably fine."

## Reasoning Discipline (per this project's own corrected precedent)

- [ ] No verdict is based on an *assumed* cause for a failure — only a
      *proven* one. (This project once incorrectly concluded `APPROVED
      FOR FREEZE` by assuming an `npm install` failure was
      "environmental" without proof — do not repeat that reasoning
      error.)
- [ ] The verdict reflects exactly what was verified — not what seems
      likely, not what "should" be true given how much else passed.

## Output

- [ ] One document produced per verification cycle, containing: exact
      commands, exact raw outputs (or references to attached logs),
      exact comparison results, and exactly one verdict from the
      applicable checklist (`FREEZE_CHECKLIST.md`'s verdict line, or
      this checklist's own pass/fail if used standalone).
