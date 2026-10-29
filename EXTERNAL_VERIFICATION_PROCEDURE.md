# External Verification — Checklist and Execution Log Template

**Status: PROCEDURE + LOG TEMPLATE, not an executed run.** This
document does not itself constitute the external verification — per
every prior turn's explicit agreement, that requires a real,
network-connected development environment, which this sandboxed
environment does not have (`npm install` returns `403 Forbidden` from
the public registry, already documented in
`RC2_VALIDATION_REPORT.md` and `CLEAN_BUILD_VERIFICATION_rc1.md`).
This document is the exact, ready-to-execute checklist and raw-log
template for whoever performs that run.

**No implementation code was touched to produce this document.**

---

## Pre-Conditions

- A machine with genuine internet access (able to reach
  `registry.npmjs.org`).
- `git`, `node` (any version satisfying this project's engines, if
  specified), `npm` installed.
- No reuse of any artifact from this sandboxed environment's prior
  runs — a truly independent execution.

## Step-by-Step Procedure (record raw output for every command, not summaries)

```bash
# 1. Fresh Git Clone
git clone <repository-url> ur-bridge-v27-verification
cd ur-bridge-v27-verification
git log -1 --format="%H %ci"          # record exact commit hash + timestamp
git status                             # confirm clean working tree

# 2. Dependency Installation
node --version
npm --version
npm install 2>&1 | tee npm-install.log
echo "EXIT CODE: $?" >> npm-install.log

# 3. Clean Build
npx tsc --noEmit -p tsconfig.json 2>&1 | tee tsc-build.log
echo "EXIT CODE: $?" >> tsc-build.log

# 4. Full Test Suite (use the project's own declared test command)
npm test 2>&1 | tee full-test-suite.log
echo "EXIT CODE: $?" >> full-test-suite.log

# 5. Golden Tests specifically
npx vitest run tests/backend/wasm/golden/golden.test.ts 2>&1 | tee golden-tests.log
echo "EXIT CODE: $?" >> golden-tests.log

# 6. Confirm zero working-tree changes after all of the above
git status                             # MUST show a clean tree — no modified/untracked files
git diff --stat                        # MUST be empty
```

## Required Log Retention

Every `.log` file above, in full, unedited, alongside:
- Exact `node --version` / `npm --version` output.
- Exact commit hash cloned.
- Exact machine/OS description (for reproducibility).
- Timestamps for start/end of each step.

## Expected Reference Values (from the internal, sandboxed runs — to be compared, not assumed)

**Note added per subsequent review**: the values below reflect a
verification run in which a disclosed alternative execution mechanism
was used in place of the real `vitest` package (which could not be
installed in this environment) — not a falsification of results,
simply a different runner interpreting the same real test files. They
have NOT been re-verified within the current, stricter independent
verification round (`FINAL_DIRECTIVE_EVIDENCE_REPORT.md`) using real
`vitest`. Do not treat these figures as freshly re-confirmed —
compare against them, but verify independently, not by assumption.

| Check | Internally-observed value (sandboxed, unverified externally) |
|---|---|
| TypeScript build | 0 errors |
| Full test suite | 2333 tests, 0 failed |
| Golden Tests | 25 tests, 0 failed |
| Working tree after all steps | Clean (no modifications) |

**These are the values to compare against — not values to assume will
reproduce.** Any discrepancy (different counts, any failure, any
unexpected diff) must be filed using
`quality-templates/REGRESSION_REPORT_TEMPLATE.md` or
`quality-templates/BUG_REPORT_TEMPLATE.md` as appropriate, per this
assignment's explicit instruction: document, do not fix.

## Verdict Recording

After all six steps, record exactly one of:

- **All steps succeeded, logs match reference values, zero working-tree
  changes**: proceed to `quality-templates/FREEZE_CHECKLIST.md`.
- **Any step failed or diverged**: file an Issue per
  `quality-templates/BUG_REPORT_TEMPLATE.md` /
  `REGRESSION_REPORT_TEMPLATE.md`, and do NOT proceed to freeze
  consideration until it is resolved and this entire procedure is
  re-run from step 1.

**Under no circumstances does completing this document alone justify
declaring `Approved for Freeze`, `Frozen`, or `Production Ready`** —
per this assignment's explicit, standing rule. The only status this
document can support on its own is `Release Candidate Ready`
(unchanged) until the ACTUAL external run's logs are attached to it.
