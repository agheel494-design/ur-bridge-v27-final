# UR Language Conformance Test Suite

**Status: the single official reference for UR language behavior,
per explicit instruction. Any future compiler change is measured
against this suite — a change that alters any case's recorded
`.expected.json` is a regression unless that change was itself the
intended, reviewed purpose of the work.**

---

## Structure

```
conformance/
  001_variables.ur
  001_variables.expected.json
  002_functions.ur
  002_functions.expected.json
  ...
```

Each `.ur` file is a real, minimal UR program. Each matching
`.expected.json` records — captured directly from an actual pipeline
run, never hand-written — every stage's real output:

- `parseDiagnostics` — errors from the Parser.
- `typecheckDiagnostics` — errors/warnings from the Type Checker.
- `lowerOk` / `lowerDiagnostics` — whether Lowering succeeded, and its
  diagnostics if not.
- `irSummary` — a structural summary (function count, instruction-kind
  counts) — not exact IR text, which would be too brittle across
  compiler-internal refactors that don't change behavior.
- `cCompiles` / `cRuntimeExitCode` — whether the C Backend's output
  compiles, and its actual runtime exit code.
- `wasmAccepted` / `wasmRuntimeResult` (or `wasmRejectionMessage`) —
  whether the WASM Backend accepts the program, and its result.

## Current Cases (11)

| # | Case | Confirms |
|---|---|---|
| 001 | `variables` | Basic `let` + arithmetic |
| 002 | `functions` | Function calls with explicit-typed arguments |
| 003 | `if` | `if`/`else` statement |
| 004 | `while` | Loop with accumulator |
| 005 | `arrays` | Array literal + indexing |
| 006 | `structs` | Struct construction + member access |
| 007 | `byte` | The `byte` Tier 1 type (this cycle's own fix) |
| 008 | `char_literal` | Char literal syntax (this cycle's own fix) |
| 009 | `type_alias` | `type` alias declaration (this cycle's own fix) |
| 010 | `for_deferred_to_1_1` | `for` is correctly rejected at Lowering (v1.1-deferred, not a bug) |
| 011 | `enum_diagnostic` | `enum` produces the exact `PE009` diagnostic, not silent acceptance |

## Running the Suite

**Official, single-command runner (per explicit Stage 1 instruction):**

```bash
npm run conformance
# equivalent to: npx tsx tools/run-conformance.ts
```

This standalone tool (does not depend on Vitest) runs every case,
prints a clear `✓ PASS`/`✗ FAIL` line per case with a precise mismatch
reason on failure, and exits with code `0` if all cases pass or `1`
if any fail — safe to use directly in a CI/Quality-Gate check.

**Alternative (via the existing test suite):**

```bash
npx tsx run-tests.ts tests/conformance-suite.test.ts
```

Both runners check the identical cases against the identical
`.expected.json` files — the standalone tool exists specifically for
one-command CI integration; the Vitest-based one integrates with this
project's own broader test-reporting conventions.

## Exit Codes

`npm run conformance` exits `0` if every case passes, `1` if any case
fails. No other exit code is used. This is the ONLY signal a CI system
needs to check — the printed `PASS`/`FAIL` lines are for human
readability, not machine parsing.

## CI Integration

**A real, working workflow now exists**: `.github/workflows/ci.yml` —
runs on every push/PR. **Restructured in Item 5** from 5 parallel jobs
into a single, SEQUENTIAL job per OS (Build → Full Test Suite → Golden
Tests → Conformance Suite → Examples, in that exact order), matrixed
across `ubuntu-latest` and `windows-latest` (macOS prepared, commented
out, for later per explicit instruction). Each OS's own steps
genuinely fail-fast — GitHub Actions' own default behavior stops all
later steps in a job the moment one step fails, unlike the prior
5-parallel-jobs design where a failure in one job did not stop the
others already running. The two OS matrix entries run independently
(`fail-fast: false` at the matrix level) so a Windows-specific failure
doesn't hide or cancel the Linux result, and vice versa.

Any job failure blocks the PR's own status checks; making these
REQUIRED for merge is a one-time repository branch-protection setting
(GitHub Settings → Branches → Require status checks to pass) — outside
this workflow file's own scope, must be enabled once by whoever
administers the repository.

Every command in that workflow was directly verified to succeed
locally before being committed (via this project's own disclosed
Vitest-compatible substitute, per `RC2_VALIDATION_REPORT.md` — a real
`npx vitest run` has not yet been performed in a network-connected
environment, exactly the gap the Windows validation cycle exists to
close).

## Regression-Detection Proof (per this project's own standing discipline)

Before this suite was accepted, its regression-catching ability was
directly verified: `003_if.expected.json`'s recorded runtime exit code
was deliberately corrupted, confirmed to make the suite fail with a
precise message (`Expected 999, got 1`), then reverted and reconfirmed
passing (11/11). The suite does not just pass by construction — it
was proven capable of catching a real discrepancy.

## Adding a New Case

1. Write the `.ur` source file.
2. Run it through the actual pipeline (see
   `tools/generate-golden.ts` for the established pattern this
   suite's own generation followed) to capture REAL output — never
   hand-write an `.expected.json`.
3. Add the case's row to the table above.
4. Confirm `npm run conformance` passes with the new case included
   (or `npx tsx run-tests.ts tests/conformance-suite.test.ts` — both
   read the same `conformance/` directory automatically, no manual
   registration needed for either).

## What This Suite Is NOT

Not a replacement for the WASM Backend's own Golden Tests
(`tests/backend/wasm/golden/`) or the codegen Golden Tests
(`tests/codegen/golden/`) — those test backend-specific bytecode/C-
output details this suite deliberately abstracts away (via
`irSummary` rather than exact IR, and compile/runtime results rather
than exact C text). This suite's own scope is LANGUAGE-level
conformance: does the language behave as documented, for a person
reading `UR_LANGUAGE_SPEC_1_0.md` and nothing else.
