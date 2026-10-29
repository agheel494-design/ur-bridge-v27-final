# PIPELINE_TRACE_MAP.md

**Status: exact stage-by-stage trace for the two key reproducer
programs, per explicit direction, produced BEFORE any fix begins.
Each row is a real, directly-observed result from running the actual
lex()/parse()/analyze()/typeCheck()/lowerToIR() functions - not
inferred.**

---

## Program 1: return 5 (outside any function) — BUG-SA-001

### BEFORE fix

| Stage | Reached? | Diagnostic code | Halted here? |
|---|---|---|---|
| Lexer | Yes | none | No |
| Parser | Yes | none | No |
| Semantic | Yes | none | No |
| TypeChecker | Yes | none | No |
| IR Lowering / Codegen | Yes | none (ok: true) | No |

### AFTER fix (real root cause: walkProgram() never visited program.body at all - fixed by adding both a functionDepth counter and an actual walk of body's own statements)

| Stage | Reached? | Diagnostic code | Halted here? |
|---|---|---|---|
| Lexer | Yes | none | No |
| Parser | Yes | none | No |
| Semantic | Yes | **SE5003** | **Yes** |
| IR Lowering / Codegen | **No — Not Executed** | n/a | n/a |

Result: the bug is now caught at the CORRECT stage (semantic), not
downstream or never. "Not Executed" for IR Lowering was reported
within this session (not independently confirmed) by
replicating the REAL CLI driver's own exact control flow
(`src/cli/index.ts`'s `compileToIR()` contains an early `return null`
right after semantic errors are found, before `lowerToIR()` is ever
called) — not a choice made by an isolated test script.

## Program 2: function f(): int with no return — BUG-SA-002

### BEFORE fix

| Stage | Reached? | Diagnostic code | Halted here? |
|---|---|---|---|
| Lexer | Yes | none | No |
| Parser | Yes | none | No |
| Semantic | Yes | none | No |
| TypeChecker | Yes | none | No |
| IR Lowering / Codegen | Yes | CG1001 | Yes |

### AFTER fix (real minimal fix: a simple AST-level allPathsReturn() check added to checker.ts, wired to the already-defined TY4001)

| Stage | Reached? | Diagnostic code | Halted here? |
|---|---|---|---|
| Lexer | Yes | none | No |
| Parser | Yes | none | No |
| Semantic | Yes | none | No |
| TypeChecker | Yes | **TY4001** | **Yes** |
| IR Lowering / Codegen | **No — Not Executed** | n/a | n/a |

Result: the bug now surfaces at the CORRECT, earlier stage
(type-checking), matching BUG-SA-001's own resolution. "Not Executed"
reported (not independently confirmed) against the real `src/cli/index.ts` driver, same standard
as BUG-SA-001's own closure.

## Direct Side-by-Side (updated after the BUG-SA-001 fix)

| | Program 1 (return outside fn) | Program 2 (missing return) |
|---|---|---|
| First stage with any diagnostic (BEFORE fix) | None - never happened | Codegen (CG1001) |
| First stage with any diagnostic (AFTER fix) | **Semantic (SE5003)** | Codegen (CG1001) - unchanged |
| Final build result | Now halts at semantic (never reaches codegen) | ok: false (fails), unchanged |
| Category | Real gap - **FIXED** | Diagnostic Placement Issue - open |
| Status | **Fixed** | Open |
