# UR Control Flow & CFG Foundation — Level 2.6 Design Specification

**Status:** DRAFT — awaiting ratification. No implementation code exists
yet, per this project's established practice (mirroring
`UR_LANGUAGE_SPEC_1_0.md` and `RUNTIME_SPEC.md`'s ratification before any
implementation). No line of Level 2.6 code should be written until this
document — or a revised version of it — is approved.

**Scope:** exactly Phases 2.6.1–2.6.8 as specified — basic CFG,
`if`/`else`, `while`, `break`/`continue`, CFG Verifier, C Backend support,
Golden Tests, E2E. Explicitly excluded (per the approved plan): arrays,
structs, LLVM, WASM, Optimizer, phi nodes, async, threads.

---

## 1. The Critical Design Question This Document Must Resolve First

**"SSA IR + real control flow + no phi nodes" is a combination that
does not work by itself — a concrete resolution strategy is required
before any lowering code is written.**

### 1.1 The concrete problem, using the example program from the approved plan

```
function main() -> int
    var i = 0
    while i < 10
        if i == 5
            break
        end
        print(i)
        i = i + 1
    end
    return 0
end
```

`i` is reassigned inside the loop body (`i = i + 1`) and read again in the
loop condition (`i < 10`) on every iteration. In this project's current
SSA model, `lower-to-ir.ts` handles reassignment by **rebinding a name to
a new SSA id in the lowering pass's local environment** (see
`IR_SPEC.md` §1, "each assignment produces a fresh virtual register").
This works today ONLY because Phase 2.1–2.3/2.5 never has more than one
basic block — there is no *merge point* where two different SSA ids for
the same variable could both be "the current value," so the rebind-in-a-
flat-environment trick is sufficient.

The moment a loop header block is *re-entered* (once per iteration) and
must read `i`'s value regardless of whether this is the first iteration
(where `i`'s value came from the entry block) or a later one (where it
came from the loop body's own `i = i + 1`), pure SSA requires a **phi
node**: `i_loop = phi(i_0 from entry, i_3 from loop-body-latch)`. This
project's approved plan explicitly excludes phi nodes from Level 2.6.

**Without phi nodes and without some other mechanism, this program cannot
be correctly lowered at all** — not "lowered inefficiently," but
genuinely unrepresentable, since there is no way to write the loop
header's read of `i` in pure single-assignment form.

### 1.2 The resolution: local slots (alloca/load/store), deferring SSA-for-locals to a future Optimizer phase

This is a well-established compiler-construction pattern (the same one
Clang/LLVM's own C frontend uses): **local variables that can be
reassigned are NOT represented as SSA-renamed values at all.** Instead:

- Every `let`/`var` binding gets a **local slot** — a named storage
  location in the function, conceptually a stack variable.
- Reading a variable becomes a `load` instruction (slot → fresh SSA
  value).
- Assigning to a variable becomes a `store` instruction (SSA value →
  slot; no new "variable value" id is created — the slot is mutated).
- **Slots are not SSA values.** Only the return value of a `load` is an
  SSA value (used exactly like any other instruction's result today).

This means: `i = i + 1` becomes (conceptually) `store(slot_i, add(load(
slot_i), 1))` — two real IR instructions, not a rebind. The loop
header's `i < 10` becomes `lt(load(slot_i), 10)` — reading whatever is
currently in the slot, correctly reflecting either the initial value or
the updated value from the previous iteration, **without needing a phi
node**, because the slot itself (not an SSA id) is the thing that
"has one current value at a time."

**This is not a violation of "IR stays SSA"** — the *values* flowing
through arithmetic/calls/etc. remain single-assignment exactly as today;
only the *storage* for mutable local variables gains an explicit
load/store indirection. A future Optimizer phase can later run a
`mem2reg`-style pass that promotes provably-single-definition slots back
into pure SSA with real phi nodes at merge points — but that pass does
not need to exist for Level 2.6 to be correct.

### 1.3 Proposed IR additions (additive only — no existing type removed or renamed)

```typescript
// Proposed additions to src/shared/ir.ts

/** A named local storage slot within a function — NOT an SSA value. */
export type IRLocalSlot = {
  readonly id: number;      // unique within the function, separate id space from SSA value ids
  readonly name: string;    // original UR variable name, for debug symbols
  readonly type: IRType;
};

// New instruction kinds (added to the existing IRInstruction union):
  | { kind: "load";  id: number; type: IRType; slot: number; location: SourceLocation }
  | { kind: "store"; slot: number; value: IRValueRef; location: SourceLocation }
    // note: "store" defines NO SSA id — it has no result value, matching
    // how "void"-typed calls already work today.

// IRFunction gains one new field:
export type IRFunction = {
  // ...all existing fields unchanged...
  readonly locals: readonly IRLocalSlot[]; // NEW
};
```

**This is the second scoped extension to `IRModule`'s neighborhood since
the Level 2.4 freeze** (the first was `externs`/`ExternSymbol` for
Runtime calls). Per the freeze discipline, this requires the same
explicit sign-off `externs` received before implementation begins.

**What does NOT change:** `IRType`, `IRBinOp`, `IRUnOp`, `ExternSymbol`,
`ExternKind`, `ExternLifecycleRole`, the `call` instruction, and every
existing terminator are untouched. `branch`/`cond_branch` terminators
already exist in the type system (declared since Phase 2.1, never
produced until now) — Level 2.6 is the first phase that actually
produces them.

---

## 2. CFG Structure (Phase 2.6.1)

No new terminator kinds are needed — `branch` and `cond_branch` already
exist (`IR_SPEC.md` §5). Level 2.6's job is: (a) the Lowering pass
actually produces multi-block functions using them, (b) the CFG Verifier
checks the additional invariants below, (c) the C Backend emits real
`goto`s.

Every function's `blocks` array may now contain more than one
`IRBasicBlock`. `entryBlock` remains the single starting point. No phi
nodes exist in any block's instruction list (§1.2 explains why none are
needed).

---

## 3. `if` / `else` (Phase 2.6.2)

Lowering strategy for `if cond thenBlock else elseBlock end`:

```
[current block]
    cond_branch(load(cond), then_block, else_block)

[then_block]
    ...then statements, using load/store for any variable read/write...
    branch(merge_block)          // only if the block doesn't already end in return/break/continue

[else_block]                     // omitted entirely if there is no `else`
    ...else statements...
    branch(merge_block)

[merge_block]
    ...continues lowering statements AFTER the if/else...
```

If a branch's own statements end in `return`/`break`/`continue`, that
block's terminator is the return/branch-to-loop-exit itself — no
`branch(merge_block)` is appended (this matches "every block ends in
exactly one terminator," `IR_SPEC.md` §5; a block never gets two).

If there is no `else`, the `then_block`'s "false" edge in the original
`cond_branch` goes directly to `merge_block` (i.e. `elseTarget:
merge_block.id`) — no empty else block is fabricated.

---

## 4. `while` (Phase 2.6.3)

Lowering strategy for `while cond bodyBlock end`:

```
[current block]
    branch(loop_header)

[loop_header]
    cond_branch(load(cond), loop_body, loop_exit)

[loop_body]
    ...body statements...
    branch(loop_header)          // loop back — unless body ends in break/continue/return

[loop_exit]
    ...continues lowering statements AFTER the while...
```

The condition is **re-evaluated by re-entering `loop_header`**, which
reads the current slot values via `load` — this is exactly the mechanism
§1.2 introduces local slots for.

---

## 5. `break` / `continue` (Phase 2.6.4)

The Lowering pass (`IRBuilder` in `lower-to-ir.ts`) maintains a **loop
context stack** — pushed on entering a `while` lowering, popped on exit
— recording each active loop's `(loopHeaderBlockId, loopExitBlockId)`:

- `break` → `branch(current_loop.loopExitBlockId)`
- `continue` → `branch(current_loop.loopHeaderBlockId)`

`break`/`continue` outside any loop remain impossible to construct from
valid UR source (Semantic Analyzer's existing SE5001/SE5002 checks,
Level 1, unchanged — already verified in Level 1's closure) — Lowering's
precondition (zero Semantic diagnostics) means the loop-context stack is
never empty when a `break`/`continue` is actually lowered.

---

## 6. CFG Verifier Extensions (Phase 2.6.5)

Extending `checkModuleInvariants()` (`src/shared/ir.ts`) — building on
what already exists (branch target existence, reachability from entry,
already implemented at the Level 2.1 freeze and verified with hand-built
multi-block fixtures even before Level 2.6 existed):

- **Block reachable**: already implemented (§7 of `IR_SPEC.md`).
- **Terminator exists**: already guaranteed by the type system (every
  `IRBasicBlock.terminator` is non-optional).
- **Predecessor/successor consistency** (NEW): for every edge
  `A --branch/cond_branch--> B`, `B` must correctly be reachable via
  that edge (this is largely implied by the existing reachability check,
  but Level 2.6 adds an explicit predecessor-list cross-check: every
  block's computed predecessor set, derived by scanning all other
  blocks' terminators, must be internally consistent — catches a
  malformed CFG where, e.g., a block's terminator claims a target that
  exists but the "logical" predecessor relationship is nonsensical for
  the construct being lowered).
- **Local slot validity** (NEW, per §1.3): every `load`/`store`'s `slot`
  field must reference a real entry in `IRFunction.locals`. Every slot
  must be `store`d at least once before any `load` reads it along every
  path from entry (a lightweight "definite assignment" check — not full
  dataflow analysis, but a reachability-based approximation sufficient
  for this phase's scope: variables are always initialized at
  declaration in UR source, so this is a defense-in-depth check against
  a Lowering bug, not an expected user-facing diagnostic).

---

## 7. C Backend (Phase 2.6.6)

Per the approved plan: `if`/`while` compile to real C `goto`-based
control flow, not native C `if`/`while` keywords — because the IR's CFG
(arbitrary blocks + branches) is the thing being translated, not the
original UR syntax tree. Each `IRBasicBlock` becomes a C label; each
`branch`/`cond_branch` becomes a `goto`/`if (...) goto ... else goto ...`.

```c
// Sketch — function body shape once multi-block functions exist:
int64_t ur_t_main() {
  int64_t slot_i = 0;
block_1:  // loop_header
  bool v0 = slot_i < 10;
  if (v0) goto block_2; else goto block_4;
block_2:  // loop_body
  bool v1 = slot_i == 5;
  if (v1) goto block_4; else goto block_3;
block_3:
  ur_print_int(slot_i);
  slot_i = slot_i + 1;
  goto block_1;
block_4:  // loop_exit
  return 0;
}
```

This requires `emit-c.ts` changes: (a) emit one C local per `IRLocalSlot`
(declared once, at the top of the function, mirroring how parameters are
already handled), (b) emit a C label per block when `fn.blocks.length >
1` (the existing `emitFunction` already has this conditional — it has
simply never been exercised since no multi-block function existed until
now), (c) emit `goto`/`if-goto` for `branch`/`cond_branch` (the existing
`emitTerminator` already has stub cases for these — again, never
exercised).

**No change to the "no hardcoded Runtime names" or "no hardcoded
lifecycle discovery" guarantees** — this is a purely additive extension
to control-flow emission, orthogonal to the Builtins/Runtime mechanism
frozen at the Level 2.5 tag.

---

## 8. Golden Tests (Phase 2.6.7) and E2E (Phase 2.6.8)

Same methodology as Level 2.5: `tools/generate-golden.ts` regenerates
baselines after this reviewed design is implemented; new
`tests/codegen/golden/11-if-else/`, `12-while-loop/`,
`13-break-continue/` (at minimum) cases; real `gcc` + real execution +
`-fsanitize=address` + `-fsanitize=undefined` verification for each,
following the exact pattern established in
`tests/backend/c/e2e-compile-run.test.ts`.

The example program from the approved plan (§0 above) becomes the
flagship end-to-end proof — compiled, linked against Runtime Core, run
for real, with its `print(i)` output verified to be exactly `0\n1\n2\n3\n4\n`
(loop breaks at `i == 5`, so 5 is never printed).

---

## 9. What This Document Does NOT Decide (explicitly out of scope, matching the approved plan)

- Arrays, structs, tuples — no new `IRType` variants.
- Phi nodes / full SSA-for-locals — deferred to a future Optimizer phase
  that may promote slots back to SSA (§1.2's `mem2reg`-style future
  work); Level 2.6 ships with the load/store model as a permanent,
  correct (if not maximally optimizable) representation.
- LLVM/WASM backends, the Optimizer itself, async/threads — unchanged
  from the existing roadmap; this document does not touch them.
- `for` loops — not mentioned in the approved Phase list; UR 1.0's
  `for x in xs` construct remains deferred (it also requires iterator
  semantics not yet designed, independent of the CFG question this
  document resolves).

---

## 10. Summary of the One Real Decision This Document Asks For

Everything in Phases 2.6.1–2.6.8 as specified is a straightforward,
correctly-sequenced implementation plan. The **one genuine architectural
decision requiring explicit sign-off** before any code is written is
§1.3's proposed IR extension: adding `IRLocalSlot` and `load`/`store`
instructions to resolve the SSA-without-phi-nodes tension. Without this
(or an equivalent mechanism), Phase 2.6.2 (`if`/`else`) is already
representable trivially (branches without any variable surviving past
the merge don't need slots), but Phase 2.6.3 (`while`) and the flagship
example program in the approved plan **cannot be lowered correctly at
all** the moment a loop-carried variable exists — which the example
program itself requires (`i`).
