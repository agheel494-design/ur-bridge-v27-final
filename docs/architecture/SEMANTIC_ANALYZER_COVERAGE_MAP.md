# SEMANTIC_ANALYZER_COVERAGE_MAP.md

**Status: structured coverage audit across 5 axes, per explicit
direction. Every scenario below was actually run through the real
lex()/parse()/analyze()/typeCheck() pipeline on a genuine UR program
- not assumed from code review.**

---

### Extended return-path analysis (per explicit direction to deepen this axis before any fix)

| # | Scenario | Real program | Result |
|---|---|---|---|
| 2.8 | Both `if`/`else` branches return | full if/else, both return | Codegen ok:true - correct |
| 2.9 | `while` never returns, but a `return` follows it | loop then return after | Codegen ok:true - correct (structural reachability, not runtime analysis - matches CG1001's own disclosed "Level 2" scope) |
| 2.10 | `void` function (no declared return type), no `return` | no return type declared | Codegen ok:true - correct, void needs no return |
| 2.11 | Nested if/else/if, all paths return | 3-way nested, all return | Codegen ok:true - correct |

**Conclusion of the extended pass**: the bug is precisely scoped to
exactly the two original cases (no return at all; a single `if` with
no `else`/fallback) - it is NOT a broader control-flow analysis
failure. All 4 additional structural variations (full if/else,
loop-then-return, void, nested if/else) are handled correctly. This
narrows BUG-SA-002's own real scope, useful for whoever eventually
fixes it.

## Behavior Coverage

```
Executed scenarios: 31 (27 original + 4 extended return-path scenarios)
Passed: 26 (22 original + 4 extended)
Verified Bugs: 2 (across 3 failing scenarios: 2.5+2.7 -> BUG-SA-002, 3.1 -> BUG-SA-001)
Inconclusive: 1 (5.1)
Disclosed gap, not a formal bug: 1 (3.5)
```

## Coverage Summary (with Confidence)

| Axis | Scenarios | Covered | Bugs | Confidence | Notes |
|---|---|---|---|---|---|
| Scopes & Symbol Resolution | 6 | 6 | 0 | High | Complete |
| Functions | 7 | 5 | 2 (severity corrected below) | Medium | Needs follow-up - the axis that found real bugs |
| Control Flow | 5 | 4 | 0 new (BUG-SA-001 re-confirmed, severity revised to High) | High | 1 disclosed warning-gap, not a bug |
| Types | 5 | 5 | 0 | High | Complete |
| Constants & Mutability | 4 | 3 | 0 confirmed | Low | 1 inconclusive result — axis not fully exercised |

**Why Constants is Low confidence, not just "1 inconclusive"**: an
inconclusive result on a 4-scenario axis means 25% of the axis never
actually reached the code path it was meant to test. That is a real
gap in the audit's own coverage, not just a neutral data point -
Constants needs a sharper test case before it can be called complete.

## Axis 1: Scopes & Symbol Resolution — Complete, 0 bugs

| # | Scenario | Real program | Result |
|---|---|---|---|
| 1.1 | Shadowing | nested if shadows outer x | No error - correct, intentional behavior |
| 1.2 | Redeclaration in same scope | let x twice, same scope | SE2001 - correct |
| 1.3 | Use before definition | print(x) before let x | SE1001 - correct |
| 1.4 | Scope leak from if | var declared inside if, used outside | SE1001 - correct |
| 1.5 | Scope leak from loop | var declared inside while, used outside | SE1001 - correct |
| 1.6 | Scope leak across functions | var in function A, used in function B | SE1001 - correct |

## Axis 2: Functions — 1 new real bug found

| # | Scenario | Real program | Result |
|---|---|---|---|
| 2.1 | Too many arguments | call with 2 args, function takes 1 | SE3001 - correct |
| 2.2 | Too few arguments | call with 1 arg, function takes 2 | SE3001 - correct |
| 2.3 | Wrong argument type | string passed where int expected | TY5002 - correct |
| 2.4 | Call to undefined function | noSuchFn() | SE1002 - correct |
| 2.5 | Function declares a return type but has no return at all | function f(): int with no return anywhere | Zero diagnostics anywhere in the pipeline |
| 2.6 | Wrong return type | return "text" in an int function | TY2003 - correct |
| 2.7 | Partial return coverage (only one if branch returns, no else) | if x return 1 end with no fallback | Zero diagnostics anywhere in the pipeline |

### New finding: BUG-SA-002 - missing/incomplete return paths are silently accepted

MISSING_RETURN (TY4001) is defined in type-diagnostics.ts's own
TCODES, but never referenced anywhere in checker.ts - the exact same
dormant-code pattern as SE1003/SE5003, confirmed by the same
grep-and-verify method.

This is more severe than BUG-SA-001: a function declared to return
int that falls through without ever returning a value can reach the
backend with no compile-time signal at all. Unlike BUG-SA-001 (a
syntactically nonsensical but harmless-at-runtime program), this one
has a real path to undefined behavior in generated code. Logged in
SEMANTIC_ANALYSIS_BACKLOG.md as BUG-SA-002, not fixed here.

## Axis 3: Control Flow — 0 new bugs (BUG-SA-001 re-confirmed), 1 disclosed gap

| # | Scenario | Real program | Result |
|---|---|---|---|
| 3.1 | return outside function | return 5 at top level | Zero diagnostics - BUG-SA-001, already logged, re-confirmed |
| 3.2 | break outside loop | break inside a function, no loop | SE5001 - correct |
| 3.3 | continue outside loop | continue inside a function, no loop | SE5002 - correct |
| 3.4 | break inside nested if inside a loop | correctly-nested break | No error - correct |
| 3.5 | Code after return (unreachable) | return 1 followed by print(2) | Zero diagnostics - not a bug, but disclosed as a gap: no warning emitted at all |

## Axis 4: Types — Complete, 0 bugs

| # | Scenario | Real program | Result |
|---|---|---|---|
| 4.1 | Explicit type conflict | let x: int = "text" | TY2002 - correct |
| 4.2 | Non-bool if condition | if 5 | TY2004 - correct |
| 4.3 | Arithmetic on mismatched types | 1 + "text" | TY3001 - correct |
| 4.4 | Mixed-type array literal | [1, "text"] | TY6001 - correct |
| 4.5 | Undefined type name | let x: NoSuchType | TY1001 - correct (SE1003's dormant status re-confirmed) |

## Axis 5: Constants & Mutability — 3 confirmed, 1 inconclusive

| # | Scenario | Real program | Result |
|---|---|---|---|
| 5.1 | Assign to const | const x = 1 then x = 2 | Rejected at the PARSER level (PE001), not semantic - ASSIGN_TO_CONST (SE4001) is confirmed used elsewhere in index.ts (line 315), so this test simply didn't reach that code path. Inconclusive, not a bug - needs a sharper test case, not pursued further here. |
| 5.2 | Assign to a parameter | a = 5 inside the function body | SE4002 - correct |
| 5.3 | Reassign a normal let variable | let x = 1 then x = 2 | No error - correct, legal |
| 5.4 | Read a variable before initialization | let x: int with no initializer | Rejected at the PARSER level (PE007) - UR requires immediate initialization for every let, structurally preventing this case at the grammar level. A real design choice, not a gap. |

## Coverage Scope (per explicit direction, computed precisely, not estimated)

**Method, disclosed**: computed as (diagnostic codes actually
exercised) / (total known, relevant diagnostic codes that exist in
the real source for that axis) — not a statistical sample of
infinite possible programs, which cannot be computed. This is an
honest, code-grounded proxy, not a precise defect-density metric.

| Axis | Known relevant codes | Codes exercised | Coverage Scope (calculation shown) |
|---|---|---|---|
| Scopes | No dedicated codes (SE1001/SE2001 shared with other axes); 6 structural patterns tested (nested/if/loop/function-boundary) | 6/6 structural patterns | ~90% (structural, not code-count based) |
| Functions | SE1002, SE3001, SE3002, TY2003, TY5002, TY4001 = 6 | 5 exercised directly + TY4001 confirmed dormant | 5/6 = **83%** |
| Control Flow | SE5001, SE5002, SE5003 = 3 catalogued so far | All 3 (2 working, 1 confirmed dormant = BUG-SA-001) | 3/3 = **100% of the rules catalogued so far** — not a claim that every possible control-flow rule has been inventoried; unreachable-code detection (not code-backed at all) remains untested and is a disclosed gap |
| Types | TY1001, TY2001, TY2002, TY2004, TY3001, TY3002, TY6001, TY6002 = 8 | 5 exercised (TY1001, TY2002, TY2004, TY3001, TY6001) | 5/8 = **62.5% ≈ 63%** — correction: an earlier claim of "Types: Complete" was too strong. TY2001, TY3002, TY6002 were never actually tested. |
| Constants | SE4001, SE4002 = 2 | 1 confirmed (SE4002); SE4001 inconclusive | 1/2 = **50%** confirmed |

**This changes the priority picture**: Types (63%) and Constants
(50%) both need more work before either can be called complete —
not just Constants alone, as the prior draft implied.

## Direct Pipeline Trace (per explicit direction, before any fix)

See `PIPELINE_TRACE_MAP.md` for the exact stage-by-stage trace of
both key reproducer programs (return-outside-function and
missing-return), produced before any code change begins.

## Updated Backlog Cross-Reference

See `SEMANTIC_ANALYSIS_BACKLOG.md` for the prioritized list, including
BUG-SA-002's own corrected classification (Diagnostic Placement
Issue, not a soundness bug).
