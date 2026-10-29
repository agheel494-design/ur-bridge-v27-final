# Regression Report Template

**Use this specifically when external verification (a fresh clone,
`npm install`, build, test run) produces a result that diverges from
the documented reference values — even if the cause is unclear.**

---

## Title

## Reference Value (from internal/documented reports)

E.g. "2333/2333 tests passing" or "TypeScript build: 0 errors."

## Observed Value (from this specific verification run)

E.g. "2331/2333 — 2 failures" or "TypeScript build: 3 errors."

## Environment

- OS / platform:
- `node --version`:
- `npm --version`:
- Exact commit hash / tag verified:
- Network conditions (any proxy, mirror, or restriction in use):

## Exact Commands Run (copy-paste, not paraphrased)

```
<every command, in order>
```

## Raw Logs (attach in full — do not summarize)

- `npm-install.log`
- `tsc-build.log`
- `full-test-suite.log`
- `golden-tests.log`
- (any other captured output)

## Working Tree State After the Run

```
git status
git diff --stat
```

(Should be clean. If not, paste the exact diff — this alone may
indicate the divergence's cause.)

## Is This Reproducible?

- [ ] Reproduced on a second, independent run
- [ ] Reproduced on a different machine
- [ ] Only observed once (record this explicitly — do not treat a
      single occurrence as confirmed until reproduced)

## Impact Assessment

`CRITICAL` (blocks freeze entirely) |
`MAJOR` (blocks freeze until resolved) |
`MINOR` (does not block freeze, tracked separately) |
`ENVIRONMENTAL` (verification-environment-specific, not a code defect
— requires evidence, not assumption, per this project's own standing
correction on this exact point)

## Does This Block Freeze?

State explicitly: `YES` / `NO` / `UNDER INVESTIGATION`. Per this
project's standing rule: do not conclude `NO` (environmental, not
blocking) without direct evidence ruling out a code-level cause — an
unproven assumption of "it's probably just the network" is exactly the
reasoning error this project corrected once already (see
`CHANGELOG.md`, entry `verdict-correction-release-candidate-ready`).

## Next Step

- [ ] File as a new `BUG_REPORT_TEMPLATE.md` if a code-level cause is confirmed
- [ ] Re-run verification from a clean state to rule out a one-off environment glitch
- [ ] Escalate to whoever owns the affected sub-phase for investigation
