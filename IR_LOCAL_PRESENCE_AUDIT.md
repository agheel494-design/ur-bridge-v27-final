# IR Local Presence Audit

**Question this report answers (exact wording, per review):** *"هل
يستطيع Lowering الحالي إنتاج Local حقيقي بدون if أو while أو CFG متعدد
الكتل؟"* — Can current Lowering produce a genuine local (a scalar
variable backed by `load`/`store`, not a plain SSA rebind) without
`if`, `while`, or a multi-block CFG?

**Answer: No.**

---

## 1. Why this question was asked

`WASM_BACKEND_SPEC.md`'s originally-approved sub-phase order placed
**3.1A.2 (Local Variables)** before **3.1A.5 (`if`)** and **3.1A.6
(`while`)**. While closing out 3.1A.1 (the WASM Binary Emitter), a
direct test (`let x = 5; return x`) revealed that this specific program
produces **zero** `load`/`store` instructions — Lowering resolves it via
plain SSA environment rebinding, identical in IR shape to `return 5`
directly. This raised the exact question above: is this one example a
coincidence, or does *no* straight-line UR program ever produce a real
local? If the latter, implementing "3.1A.2: Local Variables" in
isolation, before `if`/`while` exist, would have no real program to
exercise it against — a vacuous sub-phase.

## 2. Methodology

Two independent checks, required to agree before drawing a conclusion:

1. **Static code inspection**: find every call site of
   `promoteToSlot()` (`src/compiler/codegen/lower-to-ir.ts`) — the sole
   mechanism that ever turns a plain SSA-bound variable into a
   slot-backed one (`load`/`store`).
2. **Empirical testing**: compile 7 real UR programs through the actual
   Lexer → Parser → Lowering pipeline (not hand-constructed IR) and
   tally instruction kinds — 5 straight-line variations (simple
   declaration, reassignment without any branch, multiple sequential
   reassignments, reassignment around a function call, chained
   arithmetic reassignment) plus 2 positive controls (reassignment
   inside `if`, reassignment inside `while`, both known to trigger
   promotion) to confirm the test methodology itself is sound — if the
   controls hadn't shown `load`/`store`, something would be wrong with
   the test, not the finding.

## 3. Results

**Static inspection**: `promoteToSlot()` has exactly two call sites in
the entire Lowering codebase — one inside `IfStatement` lowering, one
inside `WhileStatement` lowering. No third call site exists anywhere.

**Empirical testing:**

| # | Program | Blocks | `load`/`store` present? |
|---|---|---|---|
| 1 | `let a = b; return a` | 1 | No |
| 2 | `let x = 1; x = 2; return x` (no branch) | 1 | No |
| 3 | Multiple sequential reassignments | 1 | No |
| 4 | Reassignment around a function call | 2 | No |
| 5 | Chained arithmetic reassignment | 1 | No |
| 6 (control) | Reassignment **inside** `if` | 4 | **Yes** |
| 7 (control) | Reassignment **inside** `while` | 4 | **Yes** |

Every straight-line variation tested (1–5) — including ones involving
multiple reassignments, a function call, and chained arithmetic, not
merely the single original trivial case — produced zero `load`/`store`
instructions. Both positive controls (6–7) correctly did, confirming
the methodology is sound and the negative results are meaningful, not
an artifact of a broken test.

## 4. Why this is architecturally guaranteed, not merely empirically rare

Given `promoteToSlot()` has only two call sites, and both are reachable
exclusively from within `if`/`while` lowering, **no sequence of
straight-line UR statements — regardless of how many reassignments,
function calls, or arithmetic operations it contains — can ever produce
a slot-backed local.** This is a direct consequence of the Lowering
pass's own control flow, not a probabilistic outcome that more testing
might eventually contradict.

## 5. Decision

**Confirmed: `if`/`while` must be implemented before "Local Variables"
can be a meaningful, testable sub-phase**, exactly as review's
conditional logic specified. Per `WASM_BACKEND_SPEC.md`'s sub-phase
list, the order is revised:

**Before (original, now superseded):**
```
3.1A.2 Local Variables
3.1A.3 Integer Arithmetic
3.1A.4 Function Calls
3.1A.5 if/else
3.1A.6 while
```

**After (per this audit's finding):**
```
3.1A.2 Integer Arithmetic       (binop/unop on constants — still straight-line, no dependency on this finding)
3.1A.3 Function Calls           (still straight-line/direct call, no dependency on this finding)
3.1A.4 if/else                  (moved earlier — introduces genuine load/store for the first time)
3.1A.5 while/break/continue     (moved earlier — same reason)
3.1A.6 Local Variables          (moved LAST — now has real programs to exercise it: any variable reassigned inside the if/while support just added)
```

**Note on 3.1A.6's revised meaning**: once `if`/`while` lowering is
implemented (which necessarily requires handling `load`/`store` for the
Local Slot model — `CFG_SPEC.md` §1 — since that IS how UR's IR
represents mutable state across branches/loops), "Local Variables" as a
separate sub-phase becomes primarily a **verification and completeness
pass** (confirming standalone local-variable-heavy programs work, edge
cases like uninitialized-until-first-branch locals, etc.) rather than
introducing `load`/`store` handling for the first time — that handling
is now naturally part of 3.1A.4/3.1A.5's own scope, since it cannot be
avoided while implementing structured control flow correctly.

## 6. What This Report Does NOT Decide

- The exact internal design of `if`/`else`/`while` WASM lowering itself
  — unchanged from `WASM_BACKEND_SPEC.md` §4/§5, already written and
  ratified.
- Whether Arithmetic (3.1A.2, per the revised order) or Function Calls
  (3.1A.3) have any similar hidden ordering dependency — not audited
  here; both remain believed straightforward (no `promoteToSlot()`
  involvement either way), but this report only answers the one
  question asked, not a general audit of every sub-phase's ordering.

## 7. Addendum (per review, after 3.1A.4 was implemented): a follow-up correction to §5's ordering conclusion

**§5's original conclusion — that implementing `if`/`while` together
would naturally introduce `load`/`store` support, making a separate
"Local Variables" sub-phase mostly a completeness pass — held for `if`,
but NOT for `while`.**

Implementing 3.1A.4 confirmed that `if`/`else` CAN be narrowed to a
locals-free shape (Invariant 3.1A.4: both branches return, no merge) —
this shape genuinely needs zero locals, and was shipped successfully
without them. Drawing `while`'s CFG the same way (before writing any
code) found no equivalent narrowing is possible: **every UR `while`
loop that actually repeats its body needs a variable that changes
across iterations**, and Lowering's `promoteToSlot()` always slot-backs
it. The one shape that avoids this (`while <const> { break }`) was
checked directly and found to produce **zero natural loops**
(`ControlFlowAnalysis.naturalLoops.length === 0`) — it never actually
loops, so it would not exercise WASM's `loop`/`br` instructions at all.

**Corrected ordering**: Local Variables (3.1A.5) now precedes `while`
(3.1A.6) — the reverse of this report's original §5 conclusion for
`while` specifically (its conclusion for `if` remains correct and
already shipped).

**Precise distinction (ratified, per explicit review — record this
precisely, since it is easy to state imprecisely)**: this ordering
constraint is a property of **Lowering's current strategy** (the Local
Slot model, `CFG_SPEC.md` §1) — **not a WebAssembly limitation.**
WASM's own `loop` instruction has no objection whatsoever to a
loop-body-mutated value; nothing in the WASM instruction set requires
locals to exist "before" loops. If Lowering's strategy ever changes,
this specific ordering constraint could change with it. See
`WASM_BACKEND_SPEC.md` §2's "Reason for ordering" box for the
canonical statement of this distinction.
