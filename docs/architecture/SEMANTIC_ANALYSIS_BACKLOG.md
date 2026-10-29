# SEMANTIC_ANALYSIS_BACKLOG.md

**Status: a running backlog of confirmed findings from the Semantic
Analysis Audit (see SEMANTIC_ANALYSIS_AUDIT.md). Findings are logged
here as they are verified. Fixes are prioritized after the audit is
more complete, not in the order findings were discovered.**

---

## Severity Ranking — Corrected After Tracing BOTH Bugs Through the Full Pipeline

**This is the exact opposite of the original, unverified claim.**
Tracing both reproducers through `lowerToIR()` gives a decisive,
real comparison:

| Bug | Traced result at codegen |
|---|---|
| BUG-SA-001 (`return` outside a function) | `ok: true`, zero diagnostics anywhere in the ENTIRE pipeline — a structurally nonsensical program produces successful IR |
| BUG-SA-002 (missing/incomplete return) | `ok: false`, a real diagnostic (CG1001) fires — the build fails clearly, just at a later, unexpected stage |

**BUG-SA-001 is the more severe of the two** — it is the one that
never gets caught anywhere, all the way through IR generation.
BUG-SA-002 is a diagnostic-placement/UX issue (the error exists, just
late); BUG-SA-001 is a real gap with no safety net at any stage
checked so far.

**Severity assignment, corrected**:
- BUG-SA-001: **High** — no diagnostic at any traced stage
- BUG-SA-002: **Medium** — a real diagnostic fires, just later than ideal

## BUG-SA-002 (reclassified) — Diagnostic Placement Issue, not a full behavioral bug — **FIXED, CLOSED**

**Category: Diagnostic Placement Issue** (corrected from an earlier,
too-strong "behavioral bug" framing).

**Status: Fixed (pending independent verification).**

Evidence: regression tests reported passing (9/9 in this session's
own run). Confidence: High, based on the methodology followed
(reproduce → trace → fix → re-trace → regression tests) — but this
is a self-reported result from this session, not an independently
verified fact. It should not be treated as equivalent to a reviewer
having seen the actual code diff, commit, or re-run the tests
independently. No reason has emerged to reopen this — but closure
here means "meets this project's own closure criteria based on
reported evidence," not "independently confirmed."

**Real minimal fix**: a simple, AST-level `allPathsReturn()` check
added to `checker.ts`'s own `checkFunction()` — explicitly NOT a
port of `lowerToIR()`'s own `CG1001` logic, which is built on IR
basic-block/terminator state that does not exist at the
type-checking stage. This is a separate, simpler implementation of
the same rule, wired to the already-defined but previously dormant
`TY4001` (MISSING_RETURN).

**Real discovery made while implementing**: `IfStatement`'s own
`elseBranch` type is `IfStatement | BlockStatement` (an `else if`
chain nests `IfStatement` directly, not wrapped in a block) —
confirmed via `tsc`, not assumed; handled explicitly with a small
`branchAlwaysReturns()` helper.

**Final verification table**, per the same standard proven for
BUG-SA-001 — traced against the real `src/cli/index.ts` driver logic
(which only calls `lowerToIR()` after both semantic AND type-check
pass with zero errors):

| Stage | Before fix | After fix |
|---|---|---|
| Parser | PASS | PASS |
| Semantic | PASS | PASS |
| TypeChecker | PASS | **FAIL (TY4001)** |
| IR Lowering | FAIL (CG1001) | **Not Executed** |

Closure evidence (self-reported within this session, not
independently confirmed): traced against the production CLI
pipeline logic (`compileToIR`'s own early-return after type-check
errors prevents `lowerToIR()` from ever being called) — not merely a
unit test result, but still a result reported from this session's
own run, not independently re-verified.

**Regression checked, zero new failures**: all 4 previously-passing
extended-Functions-axis scenarios (2.8 full if/else, 2.9
while-then-return, 2.10 void function, 2.11 nested if/else/if) remain
correctly accepted. BUG-SA-001 re-confirmed unaffected.

**Permanent regression test**: `tests/compiler/typesystem/bug-sa-002.test.ts`
(7/7 passing) — covers both fix scenarios, 4 regression checks
against previously-proven-correct programs, and an explicit
BUG-SA-001-unaffected check.

## BUG-SA-002 (original finding, retained for the record): Semantic/Type Analysis accepts functions with missing or incomplete return paths — CORRECTED after tracing the full pipeline

**Status**: Verified

**Severity: Medium — corrected from an initial, unverified "more
severe than BUG-SA-001" claim.** Per explicit direction, this needed
tracing the full downstream pipeline (semantic → type → IR → codegen)
before any severity claim, not stopping at "semantic/type accept it."

**Real downstream trace performed**: the same reproducer was run all
the way through `lowerToIR()` (codegen). Result:

```
ok: false
diagnostics: [{
  source: "codegen", severity: "error", code: "CG1001",
  message: "function 'f' does not end with an explicit return
  statement on every path — this Level 2 phase requires an explicit
  return for non-void functions (no control-flow-aware reachability
  analysis yet)"
}]
```

**This changes the assessment materially**: the build does NOT
silently succeed and does NOT reach generated code with undefined
behavior. It fails clearly, with a real diagnostic (CG1001) — just at
the **codegen stage**, not semantic/type analysis where a user would
expect it. The actual problem is a **misplaced diagnostic layer**
(worse developer experience — the error surfaces later than it
should, and semantic/type analysis silently pass code that will
later fail), not a path to unsafe generated code.

**Corrected severity: Medium** (developer-experience / diagnostic-
placement issue), not higher than BUG-SA-001 as initially claimed.

**Evidence**: two minimal reproducers (unchanged from the original
finding):

```
function f(): int
  let x: int = 1
end
```

```
function f(x: bool): int
  if x
    return 1
  end
end
```

**Expected**: `SE5xxx` or `TY4001` (MISSING_RETURN) at semantic/type
stage, giving the user an early, correctly-placed error.

**Actual**: semantic and type analysis both silently pass; the error
only surfaces later, at codegen, under `CG1001` — a different code
than the dormant `TY4001` that was seemingly designed for this exact
case.

**Fix**: not started. Logged here, correctly prioritized as Medium
severity — a real diagnostic-placement/UX defect, not a safety
issue.

---

## BUG-SA-001: Semantic Analyzer accepts return outside a function

**Severity: High** — corrected/confirmed via full pipeline trace (see
severity ranking above): zero diagnostics at ANY traced stage
(lex/parse/semantic/codegen). `lowerToIR()` returns `ok: true` for
this program.

**Final verification table (per explicit direction) — traced against
the REAL CLI driver's own logic** (`src/cli/index.ts`'s
`compileToIR()`, confirmed directly: it contains an early `return
null` immediately after semantic errors are found, BEFORE
`lowerToIR()` is ever called — this is not a choice made by a
separate test script, it is the actual, real driver's own control
flow):

| Stage | Before fix | After fix |
|---|---|---|
| Parser | PASS | PASS |
| Semantic | PASS | **FAIL (SE5003)** |
| IR Lowering | PASS (`ok: true`) | **Not Executed** |

The "Not Executed" result was confirmed by replicating the real
driver's own exact sequence and early-return condition, not merely
choosing not to call `lowerToIR()` in an isolated test script.

**Status: BUG-SA-001 — Fixed (pending independent verification).**

Evidence: regression tests reported passing (5/5 in this session's
own run, plus the 2 dedicated break/continue test files). Confidence:
High, not 100% — this is a self-reported result from this session,
not independently confirmed by review of the actual code or an
independent test re-run.

Closure evidence (self-reported within this session, not
independently confirmed): traced against the production CLI pipeline
(compileToIR early-return prevents IR generation after SE5003).

**Real root cause found while fixing** (with the exact scope of the
verification disclosed, per direct feedback): a possible root cause
was identified and confirmed by the test evidence — a
`functionDepth` check alone was insufficient because `walkProgram()`
never visited `program.body` at all.

**Exhaustiveness check performed**: searched every `ReturnStatement`
reference and every `walkStatement()`/`walkBlock()` call site within
`src/compiler/semantic/index.ts` specifically. Confirmed: `walkBlock`
is called from every control-flow construct in this file (function
bodies, `if`'s then/else branches, `while`, the other loop
construct, `try`/`catch`/`finally`), and `walkStatement` has exactly
one `ReturnStatement` case, reached from every one of those call
sites plus the newly-added `program.body` walk. Within this file's
own scope, there is no parallel path that bypasses this check.

**Disclosed limit of this check**: this confirms exhaustiveness
*within `semantic/index.ts` itself* — it does not rule out a
completely separate visitor elsewhere in the codebase (e.g. a
standalone IDE/LSP-side validation pass) that might process
`ReturnStatement` independently of this file. That was not searched
for in this pass. The precise, defensible claim is: **a root cause
was identified and the test evidence confirms it explains the
observed behavior** — not an absolute claim that no other code path
anywhere in the project could theoretically also need this check.

**Positive side effect discovered while fixing**: this also fixed
`break`/`continue` outside a loop at script-mode level, which were
equally unchecked for the exact same root cause (program.body was
never visited at all) - not scope creep, a direct consequence of
fixing the actual root cause correctly.

**Re-verified via PIPELINE_TRACE_MAP.md's own before/after trace**:
now halts at Semantic with `SE5003`, never reaches codegen.
BUG-SA-002 confirmed unaffected (same CG1001 result, re-traced).

**Permanent regression test**: `tests/compiler/semantic/bug-sa-001.test.ts`
(8/8 passing) - covers the fix itself, the no-false-positive case,
mixed function+script programs, and a direct regression check
confirming BUG-SA-002 is unaffected. **Disclosed limit**: this
confirms the specific scenarios tested work correctly; it does not
prove the absence of every possible regression in every unexercised
Script Mode path — only the scenarios actually run are covered.

**Break/continue at script-mode level** — split into their own
dedicated, independently-named tests per direct feedback, not left
as a side-effect note dependent on BUG-SA-001's own fix happening to
have covered them: `tests/compiler/semantic/script_mode_break_outside_loop.test.ts`
and `tests/compiler/semantic/script_mode_continue_outside_loop.test.ts`.

**Evidence**: minimal reproducer, run through the real
lex()/parse()/analyze() pipeline:

```
return 5
```

**Expected**: SE5003 (RETURN_OUTSIDE_FN) - the code already exists
in diagnostics.ts's own CODES object.

**Actual**: no diagnostic emitted anywhere in the pipeline - the
parser accepts it, and semantic analysis emits nothing. The program
is silently treated as valid.

**Classification**: a real behavioral bug - not a missing feature,
not architectural debt, not a placeholder. SE5003 was defined with
exactly this case in mind and simply never wired up to a real check.

**Fix**: not started. Logged here per explicit direction - further
audit work may surface additional findings, and fixes should be
prioritized by severity/impact once the backlog is more complete,
not fixed immediately upon discovery.

---

## Dormant Diagnostics (tracked, not bugs)

- **SE1003 (UNDEFINED_TYPE)**: confirmed unused for the current
  language surface (superseded by the type checker's own TY1001).
  Not classified as a bug. Revisit only once future type-system
  features exist.

## Disclosed Improvement Opportunities (not bugs, not started)

- **Unreachable code after `return` produces no warning at all.**
  Confirmed via direct test (Coverage Map, Axis 3, scenario 3.5).
  Most languages flag this as a warning, not an error. Not logged as
  a bug - a missing quality-of-life diagnostic, lower priority than
  either verified bug above.
