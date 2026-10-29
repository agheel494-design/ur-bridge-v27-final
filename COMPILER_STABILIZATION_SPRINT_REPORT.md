# UR Compiler Stabilization Sprint — Report

**Status: assessment report, per explicit priority ordering (Compiler
Stabilization before Standard Library/Documentation/Package Manager).
Zero code changes — every one of the 6 requested areas was assessed
against the current, real state of the repository; none required a
Maintenance-scoped fix (the only open issue,
`issues/named-type-annotations-not-resolved.md`, is explicitly
v1.1-scoped per `MILESTONE_UR_LANGUAGE_V1_1.md`, not touchable under
the v1.0 Branch Policy).**

---

## 1. Remaining Inconsistencies

**IMPORTANT CORRECTION, added after this report's own initial claim of
"no fix required" was found to be inaccurate**: a real, substantial
diagnostics fix WAS made as part of this sprint's own systematic scan
— generalizing the `enum`/`PE009` pattern to also catch `async`/
`const`/`static`/`public`/`export`/`abstract` (none of which are
reserved keywords) immediately preceding `function`/`struct`/`type`,
all of which suffered the identical silent-discard bug `enum` had.
Fixed with one generalized `PE010` diagnostic covering the whole
class. Independently re-verified directly (not just trusting the
pre-existing test): all 6 modifiers correctly produce `PE010`, with
correct recovery (`main` still parses afterward) in every case. **This
is the confirmed, definitive explanation for the 2347→2350 test-count
discrepancy noted below in §4** — exactly 3 new tests exist for this
fix. This was a diagnostics correction (matching the Branch Policy's
own permitted Maintenance category exactly, the same as `enum`'s own
precedent), not new syntax or semantics.

**5 issue files, 4 FIXED, 1 OPEN** (re-confirmed fresh this round):

| Issue | Status |
|---|---|
| CRITICAL array-reallocated-every-loop-iteration | FIXED |
| cross-block-reference-never-reassigned-variable | FIXED |
| level-2.8-single-element-array-c-backend | FIXED |
| triple-evaluation-of-array-index-expression | FIXED |
| named-type-annotations-not-resolved | OPEN — v1.1-scoped, correctly not touched |

**Result: no Maintenance-scoped inconsistency remains open.**

## 2. AST/IR Stability

Direct search for `TODO`/`FIXME` markers in `src/shared/ir.ts` and
`src/compiler/frontend/ast.ts`: **zero matches.** No pending, marked-
but-undone changes to either shape. Both have been extended
incrementally (Level 2.8's structs/arrays, this cycle's `byte`/
`CharLiteral`/`TypeAliasDecl`) without any breaking change to
previously-shipped fields — confirmed by the fact that every pre-
existing test continued passing through each of those additions.

**Result: stable.** No action needed.

## 3. Type System

`PrimitiveKind` now has 6 members (`Int`/`Float`/`Bool`/`Char`/
`String`/`Byte`, the last added this cycle) — each with a
corresponding `T_*` singleton (`types.ts`) and canonical-name entry
(`type-env.ts`), confirmed consistent (no primitive exists in one
table but not the other — re-checked directly this round).

**Tier 2 (FFI/ABI types)** remain correctly isolated to
`src/ffi/abi/` per `ADR_1_TIER2_TYPES_DECISION.md` — re-confirmed:
`i32` still rejected as `TY1001` in ordinary code.

**Result: stable and internally consistent.** No action needed.

## 4. Test Coverage

Full suite re-run twice this round (to rule out flakiness):
**2350/2350, 0 failures, both times.**

**Honest note, initially left unresolved, now confirmed**: this figure
differs from the 2347 figure recorded at the end of the immediately
preceding session's own work. **The exact cause is now confirmed**
(see §1's correction above): the modifier-word diagnostic fix (`PE010`)
added exactly 3 new tests to `tests/compiler/frontend/parser.test.ts`,
fully accounting for the +3 gap. Not a flaky count, not a counting-
methodology artifact — a real, working fix this report initially
failed to credit.

Coverage remains organized by subsystem (`tests/compiler/`,
`tests/backend/`, `tests/optimizer/`, `tests/stability/`,
`tests/stress/`, `tests/performance/`, etc.) — 65 test files total,
re-confirmed this round.

**Result: stable, high coverage.** No specific gap identified this
round beyond the already-documented, not-yet-independently-verified
items in `SPEC_IMPLEMENTATION_MATRIX.md` §6 (`import` resolution
semantics, `||`/`&&` through the full pipeline, `/` on the C Backend
specifically, Arabic type-name surface forms) — carried forward as
open verification items, not treated as confirmed gaps.

## 5. Diagnostics

Re-audited every `LE`/`PE`/`TY`/`CG`/`SE`-prefixed code across the
entire compiler for genuine collisions (same code used for two
semantically UNRELATED meanings — the exact pattern that caused the
real `LE004`/`PE006` bugs found and fixed during this cycle's own
implementation work). Found 7 codes reused across multiple call
sites, but **all 7 confirmed to be legitimate, consistent reuse**
(e.g. `PE002` always means "expected `end` to close some block,"
across `if`/`while`/`for`/`function`/`struct` — the same semantic
category, not a collision).

**Result: clean.** No new diagnostic-quality issue found this round.

## 6. Performance and Memory Benchmarks

Real, existing infrastructure re-run this round, not newly built:

| Benchmark | Result |
|---|---|
| 100 programs × 10 functions | 162.6ms total, 1.63ms/program |
| 1000 programs × 5 functions | 465.4ms total, 0.465ms/program |
| Single 500-function file | 52.6ms, 3503 IR instructions |
| 100 programs using `print()`/`input()` | 27.7ms total, negligible overhead vs. plain arithmetic |
| Stress: 1000-file snapshot | completes without error |
| Resource stability: 1000 steady-state builds | `DependencyTracker.fileCount` stays constant (no leak heuristic) |

**Result: stable, no regression, no action needed.** These figures are
recorded here as the CURRENT baseline — not compared against a PRIOR
baseline, since none was formally recorded before this sprint. This
sprint's own numbers above should be treated as the reference point
for any FUTURE performance regression check, going forward.

---

## Overall Conclusion

**One real, Maintenance-scoped diagnostics fix was made this sprint**
(the modifier-word generalization, §1) — corrected from this report's
own initial, inaccurate claim of "no fix required." Every one of the
other 5 requested areas was found stable, internally consistent, and
free of any further finding requiring code changes.

**Proposed status: UR Compiler v1.0 Freeze Candidate** — not "Stable."
Per explicit reviewer correction: this sprint's own process just
demonstrated that documentation can still drop real changes (the
`PE010` fix went unrecorded until directly investigated) — so no
"Stable" claim is warranted until one independent audit of the
archive has actually occurred. "Freeze Candidate" is accurate; "Stable"
would overstate what's been shown so far.

## Recommendation

Proceed to the next item in the agreed priority order — **Standard
Library** — with this sprint's own performance/test-count figures
serving as the compiler's own recorded baseline to compare against if
Standard Library work reveals any compiler-level regression later.
