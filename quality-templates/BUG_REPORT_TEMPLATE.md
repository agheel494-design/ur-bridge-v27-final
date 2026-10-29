# Bug Report Template

**Copy this template for every new bug report. Fill every section —
leave "N/A" explicitly rather than deleting a section.**

---

## Title

One line, specific enough to search for later.

## Status

`OPEN` | `INVESTIGATING` | `FIXED` | `WONTFIX` (with reason) | `DUPLICATE OF <link>`

## Severity

`CRITICAL` (memory corruption, silent wrong output, crash) |
`MAJOR` (feature broken, no workaround) |
`MINOR` (edge case, workaround exists) |
`LATENT` (not currently observable, but a real design risk)

## Discovered During

Which phase/batch/review found this (e.g. "3.1B.5 implementation,"
"post-freeze adversarial review").

## Reproduction (exact, minimal, copy-pasteable)

```
<the exact UR source program or command sequence that triggers it>
```

## Expected Behavior

## Actual Behavior

(Include exact error messages, exit codes, or byte-level evidence
where relevant — not paraphrased.)

## Root Cause

(Only fill this once actually traced — do not guess. "Not yet
identified" is an acceptable value.)

## Why This Was Not Caught Earlier

(Required — every prior bug in this project's history included this
section, since it's often as valuable as the fix itself.)

## Scope / Blast Radius

Which files, functions, or CFG shapes are affected. Confirm explicitly
whether this affects only the newest batch or something already
frozen/shipped.

## Is This In Scope to Fix Now?

Per this project's standing discipline: only if it's a documented bug
with its own Issue AND the current phase's freeze policy explicitly
permits bug fixes. State the applicable policy explicitly.

## Fix Direction (if known, not yet applied)

## Fix Applied (if actually fixed — include exact diff description, not just "fixed")

## Verification Performed

- [ ] Reproduction confirmed fixed directly (not inferred)
- [ ] Regression test added (permanent, in the test suite — not a throwaway script)
- [ ] Golden Test added/updated if applicable
- [ ] Deliberately re-introduced the bug to confirm the new test catches it
- [ ] Full regression suite re-run, count recorded
- [ ] Fresh clean-build copy re-verified (if feasible in the reporting environment)
