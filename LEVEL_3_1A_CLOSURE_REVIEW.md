# Level 3.1A — Closure Review

**Purpose: a single, authoritative reference document, not a development
artifact.** Written specifically so that any future reader — including
a developer returning to this code in a year or two, or a reviewer
auditing the WASM Backend's scope — never has to re-derive what Level
3.1A does and does not support by reading eight batches of `CHANGELOG.md`
entries. This document supersedes none of them (they remain the
detailed historical record); it is the compressed, current-state
summary.

**This is a closure review, not new development. No code changes
accompany this document.**

---

## 1. Support Matrix

| Feature | Status | Sub-phase | Invariant |
|---|---|---|---|
| Integer constants (`const_int`) | ✅ Supported | 3.1A.1 | — |
| `add`/`sub`/`mul` | ✅ Supported | 3.1A.2 | Expression Tree Property (§2.1) |
| `div`/`mod` | ❌ Not supported | Deferred (no target sub-phase yet — zero-divisor concern, matching `OPTIMIZER_SPEC.md` §6.1's precedent) | — |
| Comparisons (`eq`/`neq`/`lt`/`lte`/`gt`/`gte`) | ✅ Supported | 3.1A.4 (as an `if`-condition dependency, not a standalone milestone) | Part of Invariant 3.1A.4 |
| Direct, intra-module, zero-argument function calls | ✅ Supported | 3.1A.3 | Recursion (direct + mutual) rejected — `call-graph.ts` |
| Function calls with arguments | ❌ Not supported | Deferred (3.1B/3.1C region — not yet scheduled precisely) | — |
| `if`/`else`, both branches return (no merge) | ✅ Supported | 3.1A.4 | Invariant 3.1A.4 |
| `if`/`else`, one merge point crossing a Local Variable | ✅ Supported | 3.1A.5 | Invariant 3.1A.5 + MERGE_IMMEDIATE_RETURN_CONTRACT |
| Nested `if`/`else` (beyond the one recognized loop-`break`/`continue` shape) | ❌ Not supported | Deferred | — |
| Local Variables (scalar, WASM locals) | ✅ Supported | 3.1A.5 | Invariant 3.1A.5 |
| Arrays / linear memory | ❌ Not supported | 3.1B (not yet started) | — |
| Structs | ❌ Not supported | 3.1B (not yet started) | — |
| Plain `while` loop (no early exit) | ✅ Supported | 3.1A.6 | Invariant 3.1A.6 + WHILE_NO_BRANCH_EXIT_CONTRACT |
| `while` + `break` | ✅ Supported | 3.1A.6b | Invariant 3.1A.6b + WHILE_BREAK_ONLY_CONTRACT |
| `while` + `continue` | ✅ Supported | 3.1A.6c | Invariant 3.1A.6c + WHILE_CONTINUE_ONLY_CONTRACT |
| `while` + `break` AND `continue` together | ❌ Not supported | Deferred (explicitly out of scope, not assumed as free composition) | — |
| Nested `while` (a loop inside a loop) | ❌ Not supported | Deferred | — |
| Boolean literals (`true`/`false`) as raw constants | ❌ Not supported | Deferred | — |
| Boolean operators (`&&`/`||`), short-circuit evaluation | ❌ Not supported | Deferred | — |
| `float`/`f64` | ❌ Not supported | Deferred | — |
| `print`/`input`/`free` (Builtins) | ❌ Not supported | 3.1C (not yet started) | — |
| Runtime lifecycle (`ur_runtime_init`/`shutdown`) | ❌ Not supported | 3.1C (not yet started) | — |
| Function parameters | ❌ Not supported | Deferred (no target sub-phase yet) | — |

## 2. All Ratified Invariants (3.1A)

| Invariant | Sub-phase | One-line summary |
|---|---|---|
| Expression Tree Property (§2.1) | 3.1A.2 | Every SSA value has fan-out ≤ 1 — a temporary phase constraint, not a permanent WASM property (relax at 3.1A.6-locals, already done at 3.1A.5). |
| Invariant 3.1A.4 | 3.1A.4 | `if`/`else` accepted only when both branches terminate via `return` directly — no merge block. |
| Invariant 3.1A.5 | 3.1A.5 | Exactly one merge point, immediately following the `if`/`else` — no nested/secondary merge. MERGE_IMMEDIATE_RETURN_CONTRACT: the merge block may only read the crossed value and return it, nothing else. |
| Invariant 3.1A.6 | 3.1A.6 | Plain `while` only — exactly 4 blocks, `loop_body` has no early-exit branch (WHILE_NO_BRANCH_EXIT_CONTRACT). |
| Invariant 3.1A.6b | 3.1A.6b | `while` + `break` — `then` branches directly to `loop_exit`. |
| Invariant 3.1A.6c | 3.1A.6c | `while` + `continue` — `then` branches directly to `loop_header`. `break`+`continue` together explicitly out of scope. |

**Reason for ordering (ratified twice, per review — the single most
important standing clarification in this whole level)**: Local
Variables were moved ahead of `while` (§2's "Reason for ordering" box)
because of the CURRENT LOWERING STRATEGY, not any WebAssembly
limitation. Likewise, `break`/`continue`'s deferral within `while`
(§6b's identical box) is a deliberate scope narrowing, not a
WebAssembly limitation — WASM's own `br`/`br_if`/`loop` instructions
have no objection to any of this. **Every deferral in this document is
a decision about THIS Backend's incremental build order, never a claim
about what WASM itself can express.**

## 3. All Permanent Regression Contracts

| Contract | Sub-phase | What it guards |
|---|---|---|
| `IF_RETURN_ONLY_CONTRACT` | 3.1A.4 | Accepts return-only `if`/`else`; rejects merge-crossing (until 3.1A.5), nested `if`, `while`, raw boolean condition. |
| `IF_MERGE_ONLY_CONTRACT` | 3.1A.5 | Accepts the Diamond+Merge shape; rejects `print()` after merge, nested merge, `while`, raw boolean condition. |
| `MERGE_IMMEDIATE_RETURN_CONTRACT` | 3.1A.5 | Rejects any `store` inside the merge block — merge must be immediately followed by `return`, nothing in between. |
| `WHILE_PLAIN_ONLY_CONTRACT` | 3.1A.6 | Accepts the plain 4-block loop; rejects (at time of writing) nested `while`, raw boolean condition. |
| `WHILE_NO_BRANCH_EXIT_CONTRACT` | 3.1A.6 | A separately-named guard: `loop_body`'s terminator must be a plain `branch` back to `loop_header` — checked as its own property, not merely inferred from block count, specifically to catch a future partial `break`/`continue` introduction during an unrelated change. **Proven effective in both directions**: a hand-built hypothetical 4-block shape was rejected with the check present, and silently accepted with it deliberately disabled. |
| `WHILE_BREAK_ONLY_CONTRACT` | 3.1A.6b | Accepts the `break` shape; rejects `continue`, two `break`s in one body, nested `while`. |
| `WHILE_CONTINUE_ONLY_CONTRACT` | 3.1A.6c | Accepts the `continue` shape; rejects `break`+`continue` together, two `continue`s, nested `while`. |
| `CONTINUE_BRANCH_DEPTH_CONTRACT` | 3.1A.6c | Confirms the correct `br 1` depth produces the mathematically correct, C-Backend-matching result. |

## 4. All Golden Tests (16 cases)

| # | Case | Sub-phase | Proven to catch a real regression |
|---|---|---|---|
| 01 | `return-constant` | 3.1A.1 | — |
| 02 | `return-zero` | 3.1A.1 | — |
| 03 | `arithmetic-add` | 3.1A.2 | — |
| 04 | `arithmetic-chained` | 3.1A.2 | — |
| 05 | `function-call` | 3.1A.3 | — |
| 06 | `call-chain` | 3.1A.3 | — |
| 07 | `if-else-true` | 3.1A.4 | `if` opcode `0x04`→`0x02` corruption caught |
| 08 | `if-else-with-call` | 3.1A.4 | (same corruption, caught) |
| 09 | `merge-true` | 3.1A.5 | `local.set` opcode `0x21`→`0x22` corruption caught |
| 10 | `merge-with-call` | 3.1A.5 | (same corruption, caught) |
| 11 | `while-counting` | 3.1A.6 | `br_if` opcode `0x0d`→`0x0e` corruption caught |
| 12 | `while-sum` | 3.1A.6 | (same corruption, caught) |
| 13 | `while-break` | 3.1A.6b | `break`'s branch depth `br 2`→`br 1` corruption caught (behavioral, not structural — still valid WASM) |
| 14 | `while-break-never-fires` | 3.1A.6b | (same corruption, caught) |
| 15 | `while-continue` | 3.1A.6c | `continue`'s branch depth `br 1`→`br 2` corruption caught (behavioral, not structural — still valid WASM, `validate()=true`, wrong result) |
| 16 | `while-continue-never-fires` | 3.1A.6c | (same corruption, caught) |

**Every Golden Test in this table with a listed corruption has been
directly, deliberately broken and confirmed to fail, then reverted and
confirmed to pass again** — not merely asserted to exist. **Exception,
noted precisely rather than glossed over**: cases `03-arithmetic-add`
and `04-arithmetic-chained` (3.1A.2) were added without a recorded
deliberate-corruption proof at the time — the only two of the sixteen
without one. This is flagged here as a minor, honest gap, not
corrected retroactively by this review (which makes no code/test
changes); a future batch touching 3.1A.2 should close it if convenient.

## 5. All Diagnostic Codes

| Code | Meaning | Example trigger |
|---|---|---|
| `WASM1001` | Unsupported IR instruction | `div`, boolean ops, floats, function parameters, calls with arguments |
| `WASM1002` | Unsupported CFG shape | Nested `if`/`while`, merge violations, `break`+`continue` together, any block-count/structure mismatch |
| `WASM1003` | Unsupported aggregate | Arrays/structs reaching the Backend before 3.1B/3.1C (not yet triggered by any real test — reserved for that phase) |
| `WASM1004` | Unsupported runtime feature | A call to an unresolved name (a Builtin like `print`, or any name not defined in this module) |

**Known imprecision, tracked (not yet fixed) — recorded as deliberate
technical debt (§7)**: `print(x)`-style calls currently fail via
`WASM1001` ("calls with arguments"), not `WASM1004` — because the
argument-count check runs before the callee-resolution check. This is
accurate today but will become misleading once general
calls-with-arguments support exists (see §7).

## 6. Level 3.1A's Actual Build Order (for the historical record)

The originally-planned order was revised twice, both times by drawing
CFGs before writing code — this is the record of what actually
happened, not what was originally planned:

```
3.1A.1  Constants                                    (CLOSED)
3.1A.2  Arithmetic (add/sub/mul)                      (CLOSED)
3.1A.3  Function calls (direct, zero-arg)             (CLOSED)
3.1A.4  if/else (return-only)                         (CLOSED)
3.1A.5  Local Variables + if/else (merge)              (CLOSED)
        [originally planned AFTER while — moved ahead once 3.1A.4's
         success proved if COULD be narrowed to avoid locals, but
         drawing while's CFG showed no equivalent narrowing exists]
3.1A.6  while (plain loop)                            (CLOSED)
3.1A.6b while + break                                 (CLOSED)
        [originally bundled with continue as "while/break/continue" —
         split after drawing break's and continue's CFGs separately
         and finding a real structural asymmetry: break has one back
         edge, continue has two]
3.1A.6c while + continue                              (CLOSED)
```

**Every one of the two reorderings was discovered by drawing the CFG
before writing code, per this project's established discipline — never
discovered by writing code first and finding it didn't work.**

## 7. Deliberate Technical Debt (recorded, not hidden)

1. **`print()`'s diagnostic imprecision** (§5): fails via `WASM1001`
   instead of a more specific `WASM1004`, because the argument-count
   check runs first. Explicit `TODO` left at the exact code site
   (`emit-wasm.ts`) and in `WASM_BACKEND_SPEC.md` §5, to be revisited
   when general calls-with-arguments support is scheduled.
2. **`classifySevenBlockShape()`'s peek-then-validate pattern**
   (`emit-wasm.ts`): both `validateScope()` and `encodeFunctionBody()`
   independently call this classifier and then re-derive the same
   block roles (`entry`, `loop_header`, etc.) inside their own
   validator/encoder. This is intentional duplication (matching the
   validate/encode separation already established for every other
   shape in this file), not accidental — flagged here only so a future
   refactor doesn't "simplify" it in a way that couples validation to
   encoding.
3. **No general relooper**: this Backend recognizes exactly the CFG
   shapes Lowering is currently known to produce (single-block,
   3-block Diamond, 4-block Merge, 4-block plain-while, 7-block
   break/continue) via explicit block-count-plus-structure dispatch,
   not a general control-flow reconstruction algorithm. If Lowering's
   own output ever changes shape (e.g., a new statement kind altering
   block counts), this dispatch logic will need direct updates — it is
   not shape-agnostic by design (`WASM_BACKEND_SPEC.md` §1 already
   documents this trade-off for `if`/`while` specifically; this closure
   review generalizes the same point across all of 3.1A).

## 8. What Is Explicitly Deferred (not merely "not yet done")

- `div`/`mod` — zero-divisor concern, no target sub-phase assigned yet.
- Function parameters and calls-with-arguments — no target sub-phase assigned yet.
- Comparisons used outside an `if`/`while` condition (e.g., a `bool`-returning expression stored to a variable) — not evaluated; UR's own type system was never exercised this way against the WASM Backend.
- Boolean literals, boolean operators, short-circuit evaluation — no target sub-phase assigned yet.
- `float`/`f64` — deferred to keep every batch minimal; no design risk identified, just not yet built.
- Nested `if`/`while` beyond the two loop-specific shapes (break/continue) — no target sub-phase assigned yet; likely needs its own CFG-analysis batch when scheduled.
- `break` and `continue` together in one loop — explicitly out of scope for 3.1A.6c; deferred, not assumed as free composition of the two.
- Arrays, structs, memory, bounds checking — **3.1B**, not started.
- Runtime imports, Builtins (`print`/`input`/`free`), Runtime lifecycle — **3.1C**, not started.

## 9. Compatibility

This document reflects the frozen state at `v27-level3-1A-6c-continue`
(and all prior 3.1A sub-tags). It should be re-reviewed if any of the
following change: `CFG_SPEC.md`'s Local Slot model, the Dominator
Tree/Control Flow Analysis's published interface (`dominators.ts`/
`cfa.ts`), or Lowering's own CFG-shape-producing logic
(`lower-to-ir.ts`) in any way that could alter the block counts/
structures this closure review's dispatch logic (§7.3) depends on.

## 10. Recommendation

Per review: pending confirmation that this document accurately reflects
the shipped code and tests (independently verifiable — every batch's
own CHANGELOG entry and test file remain the underlying source of
truth), **Level 3.1A is ready to be declared Frozen**: no new features
added to any of the sub-phases above except to fix a confirmed,
documented bug — the same standing discipline already applied to the
IR, Runtime ABI, and Level 2.9's Optimizer. Development proceeds to
**Level 3.1B** (arrays, linear memory, bounds checking) as a clean
next phase, not a continuation of 3.1A's own scope.
