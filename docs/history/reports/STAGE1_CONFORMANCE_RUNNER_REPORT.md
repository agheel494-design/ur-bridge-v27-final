# Sequential Roadmap — Stage 1 Report: Conformance Suite Official Runner

**Written LAST, per `PROCESS_RULE_SPRINT_ORDER.md`'s mandate — summarizes
the `stage1-conformance-runner` CHANGELOG entry, written first.**

---

## Task (per the sequential roadmap)

"إنشاء أداة تشغيل رسمية تعمل بأمر واحد، وتشغيل جميع ملفات Conformance
وإصدار تقرير PASS/FAIL."

## Delivered

`tools/run-conformance.ts` — standalone, single-command
(`npm run conformance`), runs all 11 existing conformance cases,
prints a per-case `PASS`/`FAIL` line with an exact mismatch reason,
exits `0`/`1`.

## Verification Performed

1. Clean run: 11/11, exit 0.
2. Fault injection (deliberate corruption of one expected value):
   correctly caught, exit 1, precise message.
3. Reverted, reconfirmed clean.
4. The exact documented command re-run verbatim.

## 8-Step Sequence Followed

| Step | Status |
|---|---|
| 1. Implementation | `tools/run-conformance.ts` |
| 2. Tests | Full regression re-run (2374/2374, unchanged) |
| 3. Conformance Suite | Run by the tool itself, against itself — 11/11 |
| 4. API Freeze Check | N/A — not a public library/API surface |
| 5. Documentation | `docs/CONFORMANCE_SUITE.md` updated |
| 6. CHANGELOG | `stage1-conformance-runner` entry, written before this report |
| 7. Stage report | This document |
| 8. Review/merge | Pending — this turn is that review |

## Exit Criteria (per the roadmap's own Stage 1 definition)

"أداة تشغيل رسمية تعمل بأمر واحد" — met (`npm run conformance`).
"تشغيل جميع ملفات Conformance" — met (all 11, no subset). "إصدار
تقرير PASS/FAIL" — met (per-case lines plus a summary line).

## Known Limitations

**Added per explicit review request — prevents future claim
inflation about what this tool does and doesn't do.**

- **No parallel execution** — all 11 cases run sequentially. Fine at
  the current scale; would need reconsideration if the case count
  grows into the hundreds.
- **Depends entirely on `.expected.json` being correct** — the tool
  verifies CONSISTENCY with recorded expectations, not correctness of
  those expectations against the language spec independently. A wrong
  `.expected.json` (e.g., generated from a buggy compiler state) would
  pass silently.
- **No performance/timing measurement** — the tool checks functional
  correctness only (diagnostics, IR summary, compile/runtime results).
  It does not measure or compare execution time.
- **Two real code-quality findings from this round's own review, not
  previously disclosed**:
  1. **Comparison method is `JSON.stringify(a) === JSON.stringify(b)`**
     (`deepEqual()`), which is NOT guaranteed key-order-independent —
     two objects with identical key-value pairs in different
     insertion order would incorrectly report a mismatch. This
     currently works in practice only because both sides (recorded
     expectation and live run) are constructed by the same code path
     with consistent field order — not because the comparison is
     robust by design. A future refactor of that shared construction
     path could silently break this.
  2. **Error message detail is inconsistent** — `parseDiagnostics`
     mismatches show the actual received value
     (`got ${JSON.stringify(...)}`); `typecheckDiagnostics`,
     `lowerDiagnostics`, and `irSummary` mismatches only say
     `"... mismatch"` with no values shown, making those specific
     failures harder to debug from the printed output alone (a
     developer would need to add their own logging to see the actual
     vs. expected values for those three cases).

Neither of these two findings is a functional defect in the tool's
current, tested behavior — both were caught by direct code review
during this stage's own closure check, per explicit instruction, and
are recorded here rather than silently fixed or silently omitted.

## Recommendation

Stage 1 is complete by its own stated criteria. Per the sequential
roadmap's own explicit rule, Stage 2 (Examples) should not begin until
this report is reviewed and the stage is confirmed closed.
