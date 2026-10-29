# Continue CFG Analysis

**Purpose of this document (per explicit review request): NOT an
implementation specification. A standalone analysis answering exactly
one question, for any future reader — including a developer returning
to this code in a year or two — to understand without having to
re-derive it themselves:**

> **Why does `continue` produce two (or more) records in
> `ControlFlowAnalysis.naturalLoops` for the same loop header, and why
> can `break`'s validation/encoding logic (3.1A.6b) not be reused
> directly for `continue`?**

This document precedes `3.1A.6c`'s own implementation batch, matching
this project's established discipline: CFG first, natural-loop shape
second, before any code.

---

## 1. The Two Programs Compared

**Program A (`break`, already implemented — 3.1A.6b):**

```
let i = 0
while i < 100
  if i == 3
    break
  end
  i = i + 1
end
return i
```

**Program B (`continue`, this document's subject):**

```
let i = 0
let total = 0
while i < 10
  i = i + 1
  if i == 5
    continue
  end
  total = total + i
end
return total
```

Both compile to a 7-block CFG with the same block *roles*: `entry`,
`loop_header`, `loop_body`, `then`, `else`, `merge`, `loop_exit`. At a
glance, they look structurally identical. **They are not.**

## 2. The CFG Difference (drawn directly, not assumed)

For `break` (Program A), the `then` block (taken when `i == 3`) branches
to **`loop_exit`** (block 3):

```
BB4 (then) — 0 instructions, terminator: branch -> BB3 (loop_exit)
BB5 (else) — 0 instructions, terminator: branch -> BB6 (merge)
BB6 (merge) — terminator: branch -> BB1 (loop_header)
```

For `continue` (Program B), the `then` block (taken when `i == 5`)
branches directly to **`loop_header`** (block 1) — **not** to
`loop_exit`:

```
BB4 (then) — 0 instructions, terminator: branch -> BB1 (loop_header)
BB5 (else) — 0 instructions, terminator: branch -> BB6 (merge)
BB6 (merge) — terminator: branch -> BB1 (loop_header)
```

**This one-block difference (`then`'s branch target: `loop_exit` for
`break`, `loop_header` for `continue`) is the entire structural
distinction.** Everything downstream — the CFA results, the WASM
lowering strategy — follows directly from this single fact.

## 3. Why This Produces TWO Back Edges Into The Same Header

A back edge, by `ControlFlowAnalysis`'s definition (`CFG_SPEC.md`,
`OPTIMIZER_SPEC.md` §3), is any CFG edge `A -> B` where `B` dominates
`A`. For `continue`'s CFG, **two distinct edges satisfy this**:

1. `merge (BB6) -> loop_header (BB1)` — the same back edge `break` also
   has (the loop's "normal" iteration path).
2. `then (BB4) -> loop_header (BB1)` — a **second, additional** back
   edge that only exists because `continue`'s `then` branches directly
   to the header, skipping `merge` entirely.

Confirmed directly (not assumed) by running the existing, frozen
`analyzeControlFlow()`:

```
break:    backEdges = [{from: 6, to: 1}]                    (ONE edge)
continue: backEdges = [{from: 4, to: 1}, {from: 6, to: 1}]   (TWO edges)
```

## 4. Why CFA Reports TWO Separate `naturalLoops` Entries, Not One

`ControlFlowAnalysis.naturalLoops` is computed **per back edge** — for
every back edge `A -> B` found, one `NaturalLoop` record is built via
backward traversal from `A` (`CFA_SPEC`/`OPTIMIZER_SPEC.md` §4). This
is a **deliberate, general design** — the Dominator Tree/CFA machinery
was built generically, with no assumption baked in that a source-level
loop maps to exactly one back edge — and it is correct in general
(irreducible loops, multi-entry back edges, and other shapes genuinely
do need one record per back edge).

For `continue`, this general algorithm produces exactly two records
for the SAME semantic loop:

```
naturalLoops[0] = { header: 1, backEdge: {from: 4, to: 1}, body: [1, 4, 2] }
naturalLoops[1] = { header: 1, backEdge: {from: 6, to: 1}, body: [1, 6, 5, 2] }
```

Note the two `body` sets are **different sizes** — `[1, 4, 2]` (the
`continue` shortcut path) excludes `merge`/`else` entirely, while
`[1, 6, 5, 2]` (the normal path) includes them. **Both are correct,
independently-valid natural loops by the formal definition** — CFA is
not wrong here; it is precisely and correctly describing two distinct
paths that both loop back to the same header. What CFA does **not**
do, by design, is collapse them back into "one loop with two ways to
reach the header" — that synthesis is left to whatever consumes CFA's
output (here, the WASM Backend), not CFA itself.

## 5. Why `break`'s Validation/Encoding Logic Cannot Be Reused Directly

`validateWhileBreakShape()` (3.1A.6b) is built around a single
structural assumption, true for `break` but false for `continue`:
**exactly one back edge exists, and `then`'s target is checked against
`loopExit.id` specifically** (`emit-wasm.ts`, the `thenTerminator.target
!== loopExit.id` check). This assumption is baked into:

- **The rejection check itself**: `validateWhileBreakShape` explicitly
  rejects `then.target === loopHeader.id` as "the structural signature
  of continue" — i.e., it already *detects* `continue`'s shape, but
  only to reject it, not to handle it.
- **The encoder's branch-depth arithmetic**: `encodeWhileBreakFunctionBody`
  emits a single `br 2` (break) from inside the nested `if`, computed
  assuming there is exactly one kind of early exit, targeting the
  outer `block`. `continue` needs a **different depth target** — from
  the same nesting position, `continue` must branch to the `loop`
  itself (depth 1, not depth 2), since `$continue`'s label is the loop
  construct, not the exit block.
- **The CFA consumption pattern**: 3.1A.6b's implementation, like
  3.1A.6's plain-loop implementation before it, was written expecting
  `ControlFlowAnalysis.naturalLoops` to contain exactly one relevant
  entry for the loop being lowered. `continue` breaks this expectation
  by construction (§4) — any `continue`-aware validator must either
  reconcile the two `naturalLoops` entries back into one semantic loop
  itself, or bypass `naturalLoops` for this shape and work from the
  raw CFG structure directly (an open design question for 3.1A.6c's
  own implementation, not resolved here).

**In short: `break` only ever needs to recognize "does `then` skip to
the exit?" — a single yes/no check. `continue` needs to additionally
recognize "does `then` skip to the header?", handle a genuinely
different branch-depth target for that case, and account for CFA
reporting the loop's shape as two natural-loop records instead of one.
None of this is a matter of copying `break`'s code and swapping a
target block id — the depth arithmetic and the CFA-consumption pattern
both need their own, separate reasoning.**

## 6. What This Document Does NOT Decide

- The exact validation function shape for 3.1A.6c (e.g., whether it
  reuses `validateWhileBreakShape`'s skeleton with an added branch, or
  is written fresh) — an implementation decision for that batch's own
  review, not resolved here.
- Whether `continue` and `break` co-occurring in the same loop body
  (both present, not just one) is in scope for 3.1A.6c or needs its
  own further-deferred sub-phase — not decided here; drawing that
  specific CFG (both a `continue` check and a separate `break` check
  in the same `loop_body`) is 3.1A.6c's own first step, per this same
  document's methodology, not this document's job to pre-empt.
- Whether CFA itself should gain a "collapse to one semantic loop"
  utility given this finding — an `OPTIMIZER_SPEC.md`-scoped decision,
  not a WASM Backend one; CFA remains correct and unchanged as-is
  (§4), and this document takes no position on whether such a utility
  is ever worth adding elsewhere.
