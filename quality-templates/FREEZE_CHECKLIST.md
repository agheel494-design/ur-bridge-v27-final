# Freeze Checklist

**Use this checklist to formally declare any phase/sub-phase Frozen.
Every box must be checked with a link to direct evidence — not a
restated claim. This checklist itself does not grant permission to
declare a freeze; it records that permission was earned.**

---

## Prerequisites

- [ ] All planned sub-phases for this level are individually closed
      (each with its own Invariant, Contract, Golden Test where
      applicable).
- [ ] A Gate Review document exists, reviewed by a party distinct from
      the implementer where feasible.

## External Verification (the step this project's own history shows is
## the one that cannot be replaced by internal self-review)

- [ ] Fresh Git Clone performed, in a genuinely independent environment.
- [ ] `npm install` (or equivalent) completed successfully — the real
      command, not a substitute/stub.
- [ ] Clean build completed, 0 errors.
- [ ] Full test suite run, count matches documented reference exactly.
- [ ] Golden Tests run, count matches documented reference exactly.
- [ ] Working tree confirmed clean after all of the above (no
      unintended modifications).
- [ ] Raw logs retained for every step above (not summaries).

## Documentation Verification

- [ ] Every Invariant has a matching Contract.
- [ ] Every Contract has non-empty test coverage (verified by count,
      not assumed).
- [ ] Every Golden Test case is accounted for and mapped to a batch.
- [ ] No unresolved "FROZEN"/"APPROVED"-type conflicts across active
      documents (superseded documents correctly flagged, not silently
      contradicting current status).
- [ ] Documentation audit (if one exists) has itself been independently
      verified — not merely produced and trusted at face value.

## Issue Review

- [ ] Every currently-OPEN issue re-confirmed reproducible in the
      verification environment.
- [ ] Every OPEN issue confirmed out of scope for this freeze (does
      not block).
- [ ] No issue found "fixed unintentionally" without investigation.

## Sign-Off

- [ ] Exact commit hash recorded.
- [ ] Exact tag name recorded (matching this project's naming
      convention, e.g. `v27-wasm-<level>-rc<N>`).
- [ ] Verdict recorded as exactly one of: `APPROVED FOR FREEZE` /
      `REJECTED FOR FREEZE` — no intermediate wording.
- [ ] If approved: standing rule stated explicitly — no further changes
      to this scope except documented bug fixes, until a future gate
      review explicitly lifts the freeze.

**A freeze declared without every box above checked, with direct
evidence linked, is not a freeze this project's own established
discipline would recognize as valid — this is not a formality, it is
the exact standard this project has applied to every prior freeze
(Level 3.1A, the IR, the Runtime ABI, Level 2.9's Optimizer).**
