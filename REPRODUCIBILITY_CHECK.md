# Reproducibility Check — Two Independent Runs, Compared Directly

**Status: this is NOT an independent audit — it cannot be, since it
was performed by the same party (this assistant) that produced every
prior claim in this conversation. It is a reproducibility check: the
same suite, run twice, from scratch, with results compared directly
rather than assumed identical. Per the reviewing party's own explicit
priority #3. Priority #2 (a genuine independent audit of the
repository) remains outstanding and can only be satisfied by a party
with direct file access who did not produce the original claims.**

---

## What Was Re-Run

1. `tests/conformance-suite.test.ts` (11 cases)
2. The full regression suite (65 test files)
3. `tests/performance/*.test.ts` (4 benchmarks)

Each run twice, independently, with no code change between the two
rounds.

## Results, Compared Directly

| Check | Round 1 | Round 2 | Match? |
|---|---|---|---|
| Conformance Suite | 11/11 | 11/11 | ✅ Identical |
| Full regression suite | 2374/2374 | 2374/2374 | ✅ Identical |
| 100×10-func programs — avg IR instructions | 73 | 73 | ✅ Identical |
| 100×10-func programs — avg C size | 3011 bytes | 3011 bytes | ✅ Identical |
| 1000×5-func programs — avg IR instructions | 38 | 38 | ✅ Identical |
| 1000×5-func programs — avg C size | 1748 bytes | 1748 bytes | ✅ Identical |
| 500-function single file — IR instructions | 3503 | 3503 | ✅ Identical |
| Wall-clock timings (all benchmarks) | varied | varied | Expected — see note |

## Interpretation

**Structural/behavioral outputs are byte-for-byte reproducible**:
every instruction count, every C-output size, every pass/fail count
matched exactly across two independent, from-scratch runs. This is
the correct, expected result for a deterministic compiler and is
meaningful evidence against silent nondeterminism.

**Wall-clock timings varied between rounds** (e.g., 195.0ms vs.
210.8ms for the same 100-program benchmark) — this is expected
environmental noise (shared-infrastructure timing variance), not a
correctness signal, and is not treated as a discrepancy.

## What This Check Does NOT Establish

- It does not confirm any claim made earlier in this conversation
  actually matches the archived files, since both rounds were run by
  the same party against the same working copy — a systematic error
  in that copy would reproduce identically in both rounds and this
  check would not catch it.
- It is not a substitute for the reviewing party's own stated
  priority #2: a direct review of the code, tests, and files by
  someone who did not produce the original claims.

## What This Check DOES Establish

- No flakiness in the current test suite or conformance suite across
  two independent runs.
- No silent nondeterminism in the compiler's own structural output.
- The specific 2347→2350 discrepancy pattern from an earlier round
  (later explained by an undocumented fix) does NOT recur here — both
  rounds this time show the identical 2374 figure, with the
  intervening explanation (this check itself, no code touched) fully
  accounting for zero change.
