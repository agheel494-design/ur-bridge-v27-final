# DR-RB3-03 — `call_external` result typing: link to the existing rulings R1-Q1 / R1-Q2

**Status:** APPROVED (PM; links existing rulings).
**Source:** `FRI_REMEDIATION_PM_DECISION.md`, lines 35–36: "R1-Q1: strict int contract for call_external; no generic
return type in R1"; "R1-Q2: float → int REJECTED (no coercion)".

## Cases covered (RB3-B1, failing on C4 only, passing on the reference)
| Test | Behaviour on C4 |
|---|---|
| `tests/e2e/call_external_js_test.test.ts` :: zero-argument `call_external("javascript","Math","random")` | panic: declared int, produced float |
| `tests/e2e/fri_manifest_test.test.ts` :: `call_external("python","math","sqrt",25)` = 5 | panic: produced float "5.0" |

Both are the ruled contract, not regressions.

## Consequences
- In realignment, the tests assert the typed panic, or use int-returning calls.
- **Documentation defect:** `docs/FRI_USER_GUIDE.md` §3 shows `call_external("python","math","sqrt",64)`, which now
  panics (float 8.0). It must be replaced with an int-returning example.
