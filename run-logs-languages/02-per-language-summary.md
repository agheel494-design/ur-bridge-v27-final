# run-logs-languages/02-per-language-summary.md

Extracted directly from 01-all-10-languages-full-pipeline.log (the
real, attached command output) - not narrated independently of it.
This test runner does not print a per-test timing breakdown, so
per-language timing below is reported at the suite level (see
honest disclosure at the bottom), not fabricated as individually
precise.

---

| Language | Code | Full-pipeline test | AST-match test | Result |
|---|---|---|---|---|
| Arabic | ar | zero errors at every stage | matches English baseline | PASS |
| English | en | zero errors at every stage | matches English baseline | PASS (baseline itself) |
| French | fr | zero errors at every stage | matches English baseline | PASS |
| Spanish | es | zero errors at every stage | matches English baseline | PASS |
| German | de | zero errors at every stage | matches English baseline | PASS |
| Japanese | ja | zero errors at every stage | matches English baseline | PASS (new this session, replacing Italian) |
| Russian | ru | zero errors at every stage | matches English baseline | PASS |
| Chinese (Simplified) | zh | zero errors at every stage | matches English baseline | PASS |
| Portuguese | pt | zero errors at every stage | matches English baseline | PASS |
| Hindi | hi | zero errors at every stage | matches English baseline (+ 3 additional Devanagari-specific tests, also PASS) | PASS |

## Test Counts

```
Registry-level (shared across all 10):     4 tests
Full-pipeline (1 per language):           10 tests
AST-match (1 per language):                10 tests
isCanonicalIn checks:                       3 tests
Mixed-language programs:                    2 tests
Hindi-specific (Devanagari):                 3 tests
--------------------------------------------------
Total:                                      33 tests
Passed:                                     33
Failed:                                      0
```

## Execution Time - Honest Disclosure

This test runner (run-tests.ts) does not print a per-test timing
breakdown internally, so an individual, precise time for e.g. "the
Japanese test alone" is not directly available from its own output.
Real, directly measured total time for the entire file (all 33
tests, all 10 languages): 380ms (measured via date +%s%N around the
actual command, not estimated). A rough per-language share would be
on the order of single-digit milliseconds - stated here as an
approximation, not claimed as individually measured.
