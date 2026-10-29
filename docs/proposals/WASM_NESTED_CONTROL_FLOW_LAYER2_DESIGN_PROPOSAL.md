# WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md

**Status: DESIGN PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.**

## 1. Goal

**Activate real WASM bytecode generation for the nested structures
Layer 1 already accepts.** Not: CFG improvements, new Validators, or
support for new patterns beyond what Layer 1 (already committed,
isolated) recognizes.

## 2. Inputs (exactly what Layer 1 already accepts — nothing more)

Confirmed directly from `isNestedIfStructureValid`'s own real,
committed logic:
- Nested `if` at any depth (`if` inside `if` inside `if`, ...).
- `if` without `else`.
- `if` with `else`.
- Multiple, chained merge points (an inner `if`'s own merge branching
  onward into an outer merge) — the exact case that motivated this
  whole Milestone.

**Not an input to this phase** (Layer 1 itself already rejects these,
so Layer 2 will never see them): `if` inside `while`, `while` inside
`if`, any real loop nesting.

## 3. Outputs — the real transformation, per pattern

```
IR (nested cond_branch/branch/return chain)
     │
     ▼
Builder (existing, real entry point: emitReturnBlockShape / the
         Diamond+Merge encoder)
     │
     ▼
WASM structured blocks (OPCODE_IF / OPCODE_ELSE / OPCODE_END)
     │
     ▼
Real, valid .wasm bytecode
```

**Real, concrete mechanism** (grounded in the actual existing code,
not assumed): WASM's own binary format already expresses `if`/`else`
as a real, structurally nestable construct
(`OPCODE_IF ... OPCODE_ELSE ... OPCODE_END`) — confirmed directly,
`emit-wasm.ts`'s own existing Diamond encoder already emits exactly
this shape for the single-level case. The real, scoped change: make
the existing per-arm encoder (`encodeReturnBlockBody`, and the
Diamond+Merge equivalent) **recursive** — when a `then`/`else` arm's
own block itself ends in `cond_branch` (a nested `if`) rather than a
direct `return`/`store`, recurse into the SAME real encoding function
to emit a nested `OPCODE_IF...OPCODE_END` inside that arm, instead of
treating only `return`/`store` as the only valid arm content.

This is a real, scoped extension of an existing function's own
recursion structure — not a new encoding scheme, not a rewrite of the
binary format logic, not a new IR concept.

## 3.5. The four required questions, answered precisely (per direct request — must be answered before any code)

**Q1: What new Capability becomes possible after Layer 2 is done?**
A UR program using nested `if` (any depth, with or without `else`,
including a shared-variable merge after nested branches — the exact
`arr[0]`/`arr[1]` motivating case) can be compiled to a real,
runnable `.wasm` file. Today, such a program is rejected outright by
`validateScope` before reaching the emitter at all.

**Q2: What changes in the Builder?**
In the project's current real structure, the WASM Backend has no
independent Builder layer — IR is walked directly into bytecode by
the emitter, unlike the LLVM Backend's own separate Builder/Module-
object stage. Because of this, Layer 2's own real change is confined
to the Emitter (Q3) — there is no separate Builder file to modify
today. (This describes the current project structure, not a
permanent architectural principle — a future WASM Builder layer could
be introduced without contradicting this document.) The one real,
related change outside the emitter itself: once Layer 2's real
emitter work (Q3) is confirmed live and passing, `classifyTopLevelShape`/
`validateScope`'s own dispatch (`wasm-cfg-validation.ts`) will accept
`isNestedIfStructureValid` as a fifth valid shape (alongside straight-
line/diamond/merge/while), dispatching to the extended emitter
instead of rejecting.

**Q3: What changes in the Emitter?**
The real, concrete change: `encodeReturnBlockBody(block, fn, ...)`
(`emit-wasm.ts`, line 161) currently assumes `block` ends in `return`
or a simple `store` sequence. It becomes recursive: if `block`'s own
terminator is `cond_branch` (a nested `if`) rather than `return`, it
emits `OPCODE_IF ... OPCODE_ELSE ... OPCODE_END` and calls
`encodeReturnBlockBody` again on the `then`/`else` target blocks
(exactly the same function, deeper) instead of treating only direct
`return`/`store` as valid content — a real, scoped recursion added to
an existing function's own logic, not a new encoding scheme.

**Q4: What new tests will prove Layer 2 actually works?**
Real, `.wasm`-level tests (not merely "Layer 1 classifier says valid"):
1. Golden bytecode test for the exact `arr[0]`/`arr[1]` motivating
   case — the resulting `.wasm` structurally decoded and confirmed to
   contain nested `if` opcodes at the right depth.
2. A doubly-nested `if` with no merge (every path returns) — same
   real decode-and-confirm approach.
3. Regression: all 227 existing WASM tests remain green, unmodified
   in their own expected behavior.
4. Confirmation that `isNestedIfStructureValid` is now actually
   wired into `validateScope`'s own real accept path (closing the
   "isolated, unwired" status from the prior commit) — a real test
   asserting a previously-rejected nested program now compiles.

## 4. Explicitly NOT implemented in this phase

- Loops inside nested `if` (or `if` inside loops) — real, separate,
  harder problem (a loop body's own real structure differs).
- Any Recursive/general CFG beyond the exact patterns Layer 1 already
  accepts.
- `phi`, SSA rewriting, `mem2reg`-style transforms, Dominance Analysis
  — none of these are relevant to this phase at all (WASM's own
  structured `if`/`else` needs none of them — this is a real
  architectural advantage over LLVM's own flat basic-block model,
  worth noting but not itself a design decision this phase makes).

## Acceptance Criteria (checklist, per direct request)

- [ ] Nested `if` compiles to correct, valid WASM bytecode.
- [ ] The resulting bytecode decodes and matches the expected CFG
      structure (a real, structural decode check — not merely "no
      exception thrown").
- [ ] All existing WASM tests continue to pass — zero regression.
- [ ] Layer 1 (`isNestedIfStructureValid`) becomes actually used
      during real compilation — no longer isolated/unwired.
- [ ] No support is added in this phase for loops, recursion, or
      exception handling.

## 5. Acceptance criteria (detailed backing for the checklist above)

1. Every pattern Layer 1 currently accepts (§2) produces real, valid
   WASM bytecode via the real encoder — confirmed via a real decode/
   structural check of the resulting `.wasm` bytes (not merely "no
   exception thrown").
2. All existing tests from the prior phase remain green — zero
   regression on the 227 tests confirmed in the prior commit.
3. **No new Validator is added** in this phase — Layer 1's own
   existing acceptance logic is reused as-is; this phase is encoder
   work only.
4. **The IR does not change** — no new `IRInstruction`/terminator
   kind, no change to `lower-to-ir.ts`'s own output shape.
5. Layer 1's classifier (`classifyStructuredRegion`/
   `isNestedIfStructureValid`) becomes wired into `validateScope`'s
   own real accept path — closing the "isolated, unwired" status
   disclosed in the prior commit — only once criteria 1–4 above are
   confirmed live.

## 6. Explicit ask

Approval to implement the recursive extension to the existing
per-arm WASM encoder (§3), tested against every pattern in §2,
confirming all 5 acceptance criteria before wiring Layer 1 into the
real accept path.
