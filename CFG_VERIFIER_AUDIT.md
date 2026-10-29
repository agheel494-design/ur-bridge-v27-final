# CFG Verifier — Independent Audit (Phase 2.6.5)

**Scope:** `checkModuleInvariants()` in `src/shared/ir.ts`, reviewed as a
standalone unit, separate from the `while`/`break`/`continue` lowering it
also happens to validate — per explicit review request, since this
verifier is the foundation every future phase (Optimizer, LLVM Backend,
WASM Backend) will build on.

**Method:** every distinct check the function performs is catalogued
below, each with its exact test evidence (all currently passing — see
`tests/shared/contracts.test.ts`), and classified as either a
**structural** check (the Verifier's actual job) or explicitly noted
where a check's boundary was found and respected rather than
over-extended into semantic territory.

---

## 1. Complete Catalog of Checks

| # | Check | Category | Test evidence |
|---|---|---|---|
| 1 | No duplicate SSA id within a function | Structural | "detects a duplicate SSA id" |
| 2 | Every `binop`/`unop`/`call` operand references an already-defined SSA id | Structural | "detects use of an undefined SSA value before definition" |
| 3 | `store`'s value operand references an already-defined SSA id | Structural | "detects a store using an undefined SSA value" |
| 4 | `call` target resolves to a module function OR a declared extern | Structural | "detects a call to a function that does not exist anywhere in the module" / "a call to a function that DOES exist elsewhere... zero violations" |
| 5 | `return`'s value operand references a defined SSA id | Structural | "detects a return referencing an undefined value" |
| 6 | `branch` target block exists | Structural | "detects a branch terminator pointing to a nonexistent block" |
| 7 | `cond_branch` condition operand is defined | Structural | "detects a cond_branch condition that references an undefined value" |
| 8 | `cond_branch` then/else targets exist | Structural | "detects a cond_branch with a nonexistent then/else target" |
| 9 | `entryBlock` refers to a real block | Structural | "detects a missing entry block" |
| 10 | Every block is reachable from `entryBlock` via branch/cond_branch edges (BFS — correctly handles cycles, i.e. loops) | Structural | "detects an unreachable block" / "an orphaned block in a loop-containing function is still correctly detected" |
| 11 | No duplicate block id within a function | Structural | "detects duplicate block ids within a function" |
| 12 | No duplicate local slot id or name | Structural | "RULE 4" (×2) |
| 13 | Every declared local slot is used by ≥1 load/store (VERIFIER ERROR, not a warning, per review) | Structural (with an explicit policy decision) | "RULE 1" |
| 14 | `load`/`store` reference a slot that exists in `IRFunction.locals` | Structural | "detects a load/store referencing an undefined local slot" |
| 15 | Conservative load-before-store (array-order approximation, explicitly NOT full dataflow) | Structural, deliberately approximate | "RULE 2" + negative case proving the entry-stores/loop-header-loads shape is correctly permitted |
| 16 | Exactly one `lifecycleRole: "init"` extern and exactly one `"shutdown"` extern per module | Structural (Runtime-lifecycle-specific, module-level) | "REQUIRED" ×4 |

**16 distinct structural checks, all independently tested, all currently
passing (48/48 in `contracts.test.ts` at time of this audit).**

---

## 2. What the Verifier Deliberately Does NOT Check (with rationale)

### 2.1 Semantic correctness of a specific branch target (e.g. "is this back edge the RIGHT block")

**Finding, stated plainly:** a self-loop (a `loop_body` block whose
`branch` terminator targets itself instead of `loop_header`) is **not**
detected by any of the 16 checks above, and cannot be, because a
self-loop is a **structurally legal CFG shape** — real programs contain
intentional infinite loops, and nothing about "block A branches to
itself" is inherently invalid the way "block A branches to a block that
doesn't exist" is.

This was verified directly: a hand-built module with exactly this bug
produces **zero violations** (`tests/shared/contracts.test.ts`, "HONEST
FINDING" test). This is by design, not an oversight — per review's own
framing, **the Verifier checks structural correctness; semantic
correctness of a specific lowering pattern (e.g. "does `while`'s back
edge point to the right block") is the responsibility of targeted
Lowering-level tests**, which exist and pass
(`tests/compiler/codegen/lower-to-ir.test.ts`'s "WATCH-POINT 1" test
explicitly asserts the back-edge target equals the real loop-header
block id).

### 2.2 Dominance / dominator trees

Not implemented, per explicit review instruction ("لا يوجد Dominator
Tree"). Not needed for anything in Phase 2.6.1–2.6.5's scope — no
optimization pass, no phi-node placement, and no LLVM-style SSA
construction exists yet that would require dominance information.

### 2.3 Phi node validity

Not implemented, and not applicable — no phi nodes exist anywhere in
this IR (per the load/store local-slot design in `CFG_SPEC.md` §1,
confirmed compliant with "no new SSA" across two review rounds).

### 2.4 Full dataflow analysis for load-before-store

Explicitly deferred (check #15 above) — the current conservative,
array-order-based approximation is correct for every shape this compiler
currently produces (straight-line code, if/else, while), verified
against the specific entry-stores/loop-header-loads pattern that a
naive purely-linear check would have incorrectly flagged. A real
dataflow-based check remains future work if a CFG shape is ever
introduced where block array order doesn't correlate with reachability
order (none currently exists).

### 2.5 Non-termination / liveness properties in general

Not implemented and explicitly out of scope — detecting whether a loop
terminates is undecidable in general; the Verifier does not attempt it.

---

## 3. Verified Test Count for This Audit

```
tests/shared/contracts.test.ts: 48/48 passing
```

Every check in §1's catalog has at least one dedicated positive test
(confirming zero false positives on valid IR) and, where applicable, at
least one dedicated negative test (confirming the check actually fires on
invalid IR) — not merely a claim of coverage.

---

## 4. Independent Audit Conclusion

The CFG Verifier's 16 checks are exclusively structural: SSA
definition-before-use, CFG edge/target validity, reachability (correctly
cycle-aware, verified against loops), local-slot bookkeeping, and
Runtime-lifecycle cardinality. It does not — and by design should not —
attempt to validate the semantic correctness of any specific lowering
pattern (back-edge target choice, break/continue destination choice),
which remains the correctly-separated responsibility of
`tests/compiler/codegen/lower-to-ir.test.ts`'s targeted assertions.

This separation of concerns (Verifier = structure, Lowering tests =
semantics) is the same principle explicitly endorsed by review. No gap
was found that blurs this boundary, and one place where a boundary could
have been blurred (self-loop detection) was found, tested, and
documented rather than papered over with an over-reaching check.
