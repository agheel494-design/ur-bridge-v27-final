# Level 2.9 Optimizer — Consolidated Review Sprint

**Purpose:** per explicit review instruction, this document reviews
**all** Level 2.9 components together — as an interacting whole, not as
independently-approved pieces — before any recommendation to freeze
Level 2.9. It is a synthesis of direct evidence (IR inspected at every
pipeline stage, Benchmark Suite output, Stress test results, Fuzz test
results), not a restatement of prior batch reports.

---

## 1. All Passes Reviewed Together, on a Shared Representative Program

A single program exercising every component at once — a `while` loop,
an `if`/`else` inside it, a foldable constant assigned to a dead
variable, and a foldable constant inside a live branch:

```
function main(): int
    let i = 0
    let total = 0
    let dead = 2 + 3
    while i < 5
        if i == 3
            total = total + (10 - 4)
        else
            total = total + i
        end
        i = i + 1
    end
    return total
end
```

**Direct, measured IR state at every stage:**

| Stage | Instructions | Blocks | Violations |
|---|---|---|---|
| After Lowering | 28 | 7 | 0 (`checkModuleInvariants`) |
| After Dominator Tree + CFA (analysis only) | 28 (unchanged — confirms no mutation) | 7 | N/A (1 natural loop correctly detected) |
| After Constant Folding | 28 | 7 | 0 (`validateFunction`) |
| After Dead Code Elimination | 23 | 7 | 0 (`validateFunction`) |
| Optimization Validator (Lowering → final) | — | — | **valid: true, 0 violations** |

**Key finding, stated explicitly because it could otherwise look like a
false negative:** Constant Folding alone did **not** reduce the
instruction count (28 → 28). This is **correct, expected behavior, not
a bug** — folding replaces a `binop`/`unop`'s *kind* with `const` at the
*same id*; it never removes an instruction by itself. The actual size
reduction (28 → 23) happens at the Dead Code Elimination stage, once
folded-but-now-dead constants (like `dead`'s `2+3→5`) become eligible
for removal. This dependency — **Constant Folding enables more DCE, DCE
does the actual shrinking** — is exactly why the fixed pipeline order
(§2.1: Constant Folding *before* DCE) matters, and this run directly
confirms the order is doing its job, not merely asserted to.

## 2. Interaction Correctness Across Components

- **Dominator Tree / Control Flow Analysis never mutate the IR** —
  confirmed directly in the table above (instruction count identical
  before and after computing both), consistent with every prior
  per-component test.
- **The Optimization Validator, run on the FULL composed pipeline
  output** (not each pass individually — per explicit review priority),
  reports zero violations for this shared program, and — per the fuzz
  results below — for 30 further, independently generated ones.
- **No pass observed reaching into another pass's internal state** —
  Pass Independence (§2.3) holds by construction (each pass's `run()`
  only receives the `IRFunction` the driver hands it).

## 3. Real Benchmark Suite Results (`tools/benchmark-suite.ts`)

**Now with persistent history**: per explicit review request, every
run appends a timestamped, version-tagged entry to
`BENCHMARK_HISTORY.json` (git-tracked, append-only) — enabling future
versions to be compared against every prior recorded run, not just an
ephemeral console printout. The first entry, tagged
`v27-level2-9-optimizer`, was recorded as part of this sprint.

Per-stage timing across four representative program shapes (single
run, this machine — a baseline for future comparison, not a
performance claim):

```
scenario                                 lexParse    semType   lowering  constFold      dce   backend     total  instr(before->after)
tiny (arithmetic only)                   1.688ms   1.416ms   1.280ms   0.198ms   0.461ms   0.530ms   5.727ms  3 -> 1
small (while loop, 1 function)           0.812ms   0.408ms   0.373ms   0.125ms   0.406ms   0.223ms   2.365ms  16 -> 16
medium (struct + array + nested loops)   0.879ms   0.800ms   0.640ms   0.043ms   0.322ms   0.480ms   3.190ms  45 -> 45
large (20 functions, call chain + dead)  1.465ms   0.936ms   2.357ms   0.287ms   0.393ms   0.296ms   5.879ms  141 -> 81
```

**Observations:**
- Optimization time (`constFold` + `dce` columns) is a small fraction
  of total compilation time in every scenario — consistent with the
  "local + linear-ish" complexity expected from these two passes.
- The "small" and "medium" scenarios show **zero** instructions
  removed (16→16, 45→45) — correctly, since every variable in those
  specific programs is genuinely live (feeds the final `return`). This
  is the DCE equivalent of a true negative, not a missed optimization.
- The "large" scenario (20 functions, each with one dead statement)
  shows the expected removal (141→81, exactly the deliberately-dead
  instructions), confirming DCE works correctly across a whole module,
  not just a single function.

## 4. Stress Test Results (`tests/optimizer/stress.test.ts`)

All 5 tests pass, under real (not simulated) time bounds:

| Test | Shape | Bound | Result |
|---|---|---|---|
| Deeply nested loops | 10 levels, >20 blocks | 5s | Pass — 10 natural loops correctly detected |
| Wide CFG | 200 diamonds, >400 blocks | 10s | Pass — 0 back edges (correctly no loops in this shape) |
| Large single block | 2000 statements, 1 block | 10s | Pass — converges to <10 instructions |
| **Even larger single block (per explicit review request)** | **10,000 statements → 50,004 raw IR instructions, 1 block** | **30s** | **Pass — converges to 1 instruction in 199ms** |
| Wide call graph | 100 functions, cross-calling | 10s | Pass — every function independently validated |
| Rough scaling check | 3 vs. 12 nested loops | — | Pass — no evidence of catastrophic non-linear blowup |

**No breaking point found yet at 50,004 raw instructions** (199ms to
fully converge) — per review's explicit request to push further than
the original 2000-statement case. This is recorded as a genuine,
positive data point, not a claim that no breaking point exists at any
scale — only that it was not reached within what was tested here.

**No hang, no crash, no timeout** across any of these — the
worklist-based Dataflow Framework (§5) converges correctly at scale for
every shape tested (deep nesting, wide flat CFGs, one giant block, and
a wide call graph).

## 5. Fuzz Test Results (`tests/optimizer/fuzz.test.ts`)

30 randomly generated, valid UR programs (deterministic seed
`20260709`, reproducible), each compiled and run **twice** — once
unoptimized, once through the full pipeline — via real `gcc` and real
execution.

**Result: 30/30 identical behavior, 0 compiler warnings.**

**One real bug was found and fixed during fuzz-test *development*
(before any assertion ran)**: the random program generator itself
initially allowed arithmetic operators to be applied to array- and
struct-typed variables, which the TypeChecker correctly rejected
(`TY3001`) — a bug in the *generator*, not the compiler, caught by the
generator's own output being tested against the real, unmodified
TypeChecker. Fixed by tracking int-typed variables separately from
array/struct-typed ones.

## 6. Consolidated Test Count

| Category | Count |
|---|---|
| Full project suite (all phases, Level 1 through this sprint) | 2118 |
| Optimizer-specific (`tests/optimizer/*`), counted directly per file below | **160** |

**Per-file breakdown (directly counted, not estimated — an earlier
draft of this table under-counted by 13 tests, having omitted two
entire E2E files; corrected here):**

| File | Tests |
|---|---|
| `pass.test.ts` | 19 |
| `dominators.test.ts` | 9 |
| `cfa.test.ts` | 7 |
| `dataflow.test.ts` | 10 |
| `constant-folding.test.ts` | 21 |
| `constant-folding-e2e.test.ts` | 7 |
| `dead-code-elimination.test.ts` | 23 |
| `dce-e2e.test.ts` | 6 |
| `validate.test.ts` | 14 |
| `full-pipeline-integration.test.ts` | 4 |
| `stress.test.ts` | 6 (added a 10,000-statement case per review request) |
| `fuzz.test.ts` | 30 |
| `golden/golden.test.ts` | 4 |
| **Total** | **160** |

(These counts were produced by directly running the suite during this
sprint, not carried over from an earlier, unverified report.)

## 7. What This Sprint Did NOT Find

- No IR structural violation in any tested program (shared, benchmark,
  stress, or fuzz-generated).
- No Optimization Validator violation in any tested program.
- No case where optimized and unoptimized behavior diverged.
- No hang or crash under stress at up to ~800 blocks or 100 functions.

This is not a claim that no such case could ever exist beyond what was
tested — it is a direct, honest statement of the coverage this specific
sprint achieved.

## 8. Recommendation

Based on the consolidated evidence above (not on any single prior
batch's isolated report): Level 2.9's components interact correctly
with each other, in the pipeline order the specification requires, with
no discovered structural or behavioral defect across ordinary,
adversarial-scale (stress), and randomized (fuzz) testing.

**This document recommends Level 2.9 is ready for formal freeze
review** — the final decision remains, as with every prior phase, an
independent one.
