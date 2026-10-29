# DIAGNOSTIC_CODE_INVENTORY.md

**Audit Scope Declaration (per AUDIT_METHODOLOGY.md, applied
retroactively after a real search-scope error was found in the
Compiler Inventory's own C Backend section): usage searches in this
document now cover `src/`, `tools/`, `scripts/`, and `tests/`. Any
earlier claim in this document's own prior versions that did not
state its scope should be read as `src/`-only unless otherwise noted
— several such claims have since been re-run with the corrected,
full scope below.**

**Additional finding while re-running the corrected, full-scope
search**: `tests/compiler/typesystem/typesystem.test.ts` already
contains real, pre-existing tests for `RETURN_TYPE_MISMATCH` and
`CALL_ARG_TYPE_MISMATCH` — this file was not found or accounted for
in the earlier Type System Audit, which is now known to have been
incomplete in a different way (missing an existing test file, not a
usage-search scope error this time). TY2001/TY5001/TY1002's own
zero-usage finding is re-confirmed under the corrected, full scope —
unchanged from the earlier, narrower search's own result, but now
backed by a genuinely complete search, not a lucky coincidence.

**Status: complete inventory across every diagnostic system found in
the project (8 systems, 70 codes total) - not just Semantic/Type,
which was the only part previously audited. Built via direct source
inspection (constant-name usage search, corrected after an initial
methodology error caught mid-analysis - see note below), and direct
grep of tests/ for coverage. Self-reported within this session, per
this project's own established epistemic standard - not
independently verified.**

---

## Self-Corrected Methodology Note

An initial automated pass searched for each code's own STRING VALUE
(e.g. "SE1001") inside the usage file, which incorrectly marked many
known-working codes (confirmed working in this project's own prior
sessions, e.g. SE1001, TY2002) as "dormant." The real usage site
references the CONSTANT NAME (e.g. CODES.UNDEFINED_SYMBOL), not the
string value, which only appears in the definition file itself.
Corrected before reporting any result below.

## Summary Counts

| System | Total Codes | Used | Dormant | Tested | Untested |
|---|---|---|---|---|---|
| LexError | 5 | 5 | 0 | 4 | 1 |
| ParseError | 11 | 11 | 0 | 7 | 4 |
| SemanticDiagnostic | 17 | 16 | 1 | 16 | 1 |
| TypeDiagnostic | 13 | 10 | 3 | 10 | 3 |
| CODEGEN_CODES | 3 | 3 | 0 | 2 | 1 |
| MCODES (module) | 6 | 2 | 4 | 2 | 4 |
| RCODES (urpm dependency-graph) | 5 | 4 | 1 | **4 (as of this update)** | 1 |
| REGISTRY_CODES (urpm registry) | 4 | 2 | 2 | **2 (as of this update)** | 2 |

## URPM Test Coverage — Completed (per the recommended next priority)

Real tests written and run: `tests/urpm/dependency-graph.test.ts`
(5/5 passing) and `tests/urpm/registry.test.ts` (3/3 passing).

**Result: no new bugs found.** All 4 previously-untested RCODES
(RP1001-RP1004) fired correctly on real reproducers (circular
dependency, missing dependency, version conflict, invalid
constraint), and a healthy dependency graph resolved cleanly with
zero diagnostics. RG1003 (DUPLICATE_PACKAGE) confirmed working.

**This is itself a valuable, reportable result** — a completely
untested subsystem is now covered and confirmed correct, per the
explicit reasoning that writing tests first (before assuming bugs
exist) can surface real problems without touching any code, and did
not this time.

**Real finding while writing the registry tests**: `resolve()`
returns `undefined` silently when no version satisfies a constraint
— it does not emit a diagnostic on this specific tested path.
Corrected wording, per direct feedback: current tested behavior does
not emit `RG1002`; this existing evidence increases confidence that
`RG1002` is potentially dormant, but is not yet a proof that it is
unreachable under all execution paths — `RG1002` could theoretically
be wired to a different code path not yet found or tested.

Zero code changes made to `dependency-graph.ts` or `registry.ts`
themselves — test-only, per the explicit direction to write tests
first, before any fix.
| Total | 64* | 53 | 11 | 41 | 23 |

\* WASM_CODES (4 codes) and BACKEND_CODES (2 codes) were located but
not yet included in this pass's own usage/coverage check - disclosed
gap, see "Not Yet Audited" below.

## Priority 1: Verified Bugs (0 currently open)

Both known verified bugs (BUG-SA-001, BUG-SA-002) are already Fixed
(pending independent verification). No new verified bugs identified
in this inventory pass - dormant codes below are NOT automatically
bugs; each needs its own reproduce-and-trace investigation before
being classified as one (the same lesson learned from SE1003 turning
out to be safely superseded, not a bug).

## Priority 2: Potentially Dormant Diagnostics (11 known - requires manual confirmation, not asserted as confirmed dead)

| Code | Constant | System | Confirmation Status |
|---|---|---|---|
| SE1003 | UNDEFINED_TYPE | Semantic | Confirmed dead code (safely superseded by TY1001) - the one code in this list actually investigated so far, not merely searched |
| TY1002 | TYPE_ARG_COUNT_MISMATCH | Type | Whole-project search found zero usage. Live behavior test not possible - UR has no generics/parameterized-type syntax yet, so no program can currently exercise this. Distinct category: forward-looking code for an unbuilt feature, not confirmed-vs-dead in the usual sense |
| TY2001 | TYPE_MISMATCH | Type | Whole-project search found zero usage. Live test (`let x: bool = 5`) fires TY2002 instead, not TY2001 - increases confidence it is potentially dormant, does not prove unreachable under all paths |
| TY5001 | PARAM_TYPE_MISMATCH | Type | Whole-project search found zero usage. Live test (undefined parameter type) fires TY1001 instead - increases confidence, does not fully prove; a more targeted reproducer was not yet tried |
| MD1002 | MISSING_EXPORT | Module | Not yet investigated |
| MD1003 | UNRESOLVED_IMPORT | Module | Not yet investigated |
| MD1004 | CIRCULAR_IMPORT | Module | Not yet investigated |
| MD1006 | AMBIGUOUS_IMPORT | Module | Not yet investigated |
| RP1005 | INVALID_VERSION | urpm dependency-graph | Not yet investigated |
| RG1001 | PACKAGE_NOT_FOUND | urpm registry | Not yet investigated |
| RG1002 | VERSION_NOT_FOUND | urpm registry | One real code path tested (resolve() with no matching version) - returns undefined with no diagnostic on that path. Increases confidence, does not prove unreachability under all paths - still Potentially Dormant |

## Type System Audit (current language surface) — Completed, pending independent verification

**Self-correction made before reporting**: an initial assumption
that TY3002/TY6002 needed testing was wrong - direct source
inspection showed they are already wired to real trigger conditions.
Live-tested to confirm, not just re-read:

| Code | Real trigger | Result |
|---|---|---|
| TY6002 (EMPTY_ARRAY_LITERAL) | `let x = []` | Fires correctly: `TY6002` |
| TY3002 (UNARY_TYPE_ERROR) | `let y = -x` where x is bool | Fires correctly: `TY3002` |

Both were already correctly listed as "Used, Tested" in this
inventory's own summary table - no change needed there, only the
narrative around them was corrected.

**Real, direct test evidence for the three actual candidates**:

| Code | Real test program | Result | Conclusion |
|---|---|---|---|
| TY2001 (TYPE_MISMATCH) | `let x: bool = 5` | Fires `TY2002` (ASSIGN_TYPE_MISMATCH) instead | Direct evidence TY2001 is not wired to this real overlap case - increases confidence it is potentially dormant, does not prove unreachable under all paths |
| TY5001 (PARAM_TYPE_MISMATCH) | A function parameter declared with an undefined type name | Fires `TY1001` (UNKNOWN_TYPE) instead, twice | Same standard: increases confidence, does not fully prove — a different, more targeted reproducer (e.g. a real type mismatch against a validly-declared parameter type, not an undefined one) was not yet tried and might behave differently |
| TY1002 (TYPE_ARG_COUNT_MISMATCH) | Not tested — no real program could be constructed | UR has no generics/parameterized-type syntax yet (confirmed by this project's own prior finding: "no Generics means no way to express..."), so there is currently no language construct that could exercise a "type argument count" mismatch at all | Cannot be classified as dormant vs. not yet — it appears to be forward-looking code for a feature that doesn't exist yet in the language surface, a different category from the other two |

**Type System Coverage Scope updated**: according to the reported
execution results in this session, all 13 diagnostics now have
documented behavioral status (10 confirmed working via prior/this
session's tests, 3 confirmed-not-triggered-by-the-tried-reproducer).
This raises Coverage Scope from the initially reported 63% — but
remains a self-reported result, not independently verified.

## Priority 3: Coverage Gaps (used codes with zero test coverage)

| Code | Constant | System | Risk |
|---|---|---|---|
| LE004 | (exponent digit error) | Lexer | Low |
| PE005, PE006, PE007 | - | Parser | Medium |
| SE2004 | DUPLICATE_MODULE | Semantic | Medium |
| CG9001 | INTERNAL_ERROR | Codegen | Low |

**Resolved since the initial inventory**: URPM's RCODES/REGISTRY_CODES
were the highest-risk finding in this inventory's own first version
(a whole untested subsystem) — now covered, see "URPM Test Coverage"
above. No longer listed here as a gap.

## Not Yet Audited (disclosed, not silently skipped)

- WASM_CODES (backend/wasm/wasm-diagnostics.ts, 4 codes) - located
  but usage/coverage not yet checked in this pass.
- BACKEND_CODES (shared/diagnostics.ts, 2 codes) - located but not
  yet checked.
- Any diagnostic-like system not following the "XCODES = {...} as
  const" pattern searched for here - not claimed to be exhaustive
  across the whole codebase, only across every file matching the
  search pattern used.

## Recommended Next Priority Based on Current Evidence (a judgment call, not a fact derived from the inventory itself)

The inventory itself only establishes facts: which codes exist, which
are used, which are tested. Choosing what to do next is a separate,
judgment-based decision layered on top of those facts - stated
explicitly as such:

1. **URPM test coverage** — recommended first, on the objective
   reasoning that an entire, completely untested subsystem carries
   more undiscovered-bug risk than any single potentially-dormant
   code, and writing tests may surface real bugs without changing
   any code first (the same low-risk, high-information-value
   principle already applied throughout BUG-SA-001/002's own
   methodology).
2. TY2001 / TY5001 manual confirmation — recommended second, after
   URPM coverage exists, per the same reasoning already applied to
   SE1003 (confirm before classifying, don't delete on inference
   alone).
3. The remaining potentially-dormant codes, lower priority until 1-2
   are resolved.
