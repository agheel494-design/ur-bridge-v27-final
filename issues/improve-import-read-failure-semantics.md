# Improve Import Read Failure Semantics

**Status**: OPEN — not linked to Decision 2D.

## Summary

When a `UR→UR` import path exists on disk but is not a readable file
(e.g. `ur_packages/<name>/index.ur` is a directory rather than a
file), the current, real production behavior is an uncaught `EISDIR`
crash — not a clean `error: ...` diagnostic.

## Real evidence

- Confirmed via direct `git diff` against the Decision 2D Candidate's
  own pre-refactor commit: this is byte-for-byte identical to the
  original code's own behavior. `readFileSync(candidatePath,
  "utf-8")` never had a `try/catch` around it, before or after the
  Decision 2D Candidate refactor.
- Protected by a real, permanent test
  (`tests/cli/decision-2d-boundary-protection.test.ts`, "REQUIRED 3")
  documenting this as current, historical behavior — not asserting it
  is desirable.

## Explicit scope note

This is **not** a regression, and is **not** part of Decision 2D. Per
direct instruction, this issue exists precisely to keep the two
separate: Decision 2D's own accepted Candidate boundary
(`resolveImportLocation → validatePackageLocation → consumeModule`)
is frozen and must not be touched to address this; any future fix
belongs here, as its own, independent piece of work.
