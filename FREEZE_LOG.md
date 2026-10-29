# UR Compiler — Freeze Log

## Tag: `v27-level2-runtime-core`

**Date recorded:** Level 2.4 closure, post-Runtime-Audit (clean).

**Test state at freeze:** 1690/1690 passing, 0 TypeScript errors,
0 regressions.

---

## Frozen Components

As of this tag, the following components are **frozen**. Any future
change to them must be either:

1. A **documented bug fix** (a confirmed defect, with reproduction
   evidence, fixed with the minimum necessary change), or
2. A **documented architectural change** explicitly approved for a
   named future phase (e.g. "Level 3 — Control Flow" adding branches/phi
   to the IR) — never an undocumented feature addition.

| Component | Location | Frozen since |
|---|---|---|
| SSA IR | `src/shared/ir.ts` | this tag |
| AST → IR Lowering | `src/compiler/codegen/lower-to-ir.ts` | this tag (scope: variables/arithmetic/calls/return only — see `IR_SPEC.md`) |
| C Backend | `src/backend/c/emit-c.ts`, `tools/backend/c-compile.ts` | this tag |
| Runtime Core | `runtime/ur_runtime.h`, `runtime/ur_runtime.c`, `src/shared/runtime-table.ts` | this tag |
| Extern ABI | `ExternSymbol`, `ExternKind`, `ExternLifecycleRole` (`src/shared/ir.ts`) | this tag |

**Already-frozen from Level 1** (unchanged by this tag, listed for
completeness): Lexer, Parser, AST, Semantic Analyzer, Type Checker,
Localization layer.

---

## What Level 2.5 May Add Without Being a "Feature Addition" to Frozen Code

Level 2.5 (Standard Library Integration) wires `print`/`اطبع`/`input`
into the **already-frozen** Extern ABI and Lowering pass. This is
explicitly anticipated by the frozen design itself:

- `RUNTIME_CORE_EXTERNS` already declares all Level 2.5 Runtime functions
  (`ur_print_*`, `ur_input_string`, `ur_free`) — Level 2.5 does not add
  new Runtime functions, it adds the Lowering-side logic that *calls*
  functions already declared and frozen at this tag.
- `IRModule.externs` and the `call` instruction mechanism are already
  general enough to represent these calls — Level 2.5 does not change
  the IR shape.
- The only genuinely new code Level 2.5 introduces is: recognizing
  `print`/`اطبع`/`input` as builtin identifiers inside
  `lower-to-ir.ts` (an addition to that file's *recognized identifier
  set*, not a change to its frozen *IR-construction contract or scope
  rules* — every other construct remains exactly as rejected/accepted
  as documented in `IR_SPEC.md` §8).

If Level 2.5 discovers a need to actually change the frozen IR shape,
the Extern ABI, or the C Backend's emission contract, that must be
raised explicitly as a new architectural decision — not silently done
inside a "Standard Library" commit.

---

## Tag: `v27-level2-5-stdlib`

**Date recorded:** Level 2.5 closure, following an independent
engineering review (verdict: **GO**, unconditional).

**Test state at freeze:** 1729/1729 passing, 0 TypeScript errors,
0 regressions.

### Independent review scores

| Dimension | Score |
|---|---|
| Architecture | 9.5 / 10 |
| Maintainability | 9 / 10 |
| Layer separation clarity | 10 / 10 |
| Design stability | 9 / 10 |

### Additional Frozen Components (as of this tag)

| Component | Location |
|---|---|
| Builtins Registry | `src/compiler/semantic/builtins-registry.ts` |
| Shared BuiltinId | `src/shared/builtins.ts` |
| Runtime Registry (`resolveBuiltinExtern`) | `src/shared/runtime-table.ts` |
| Builtin dispatch in Lowering | `src/compiler/codegen/lower-to-ir.ts` (the `print`/`input`/`free` dispatch block) |

`IRModule`/`ExternSymbol` (already frozen at the previous tag) were
**confirmed unchanged** by the independent review — the Builtins
Registry mechanism was built entirely outside the IR, exactly as
required.

### Standing watch-item (not a defect — a maintenance note for future phases)

The independent review flagged that `src/shared/runtime-table.ts` should
**not** be allowed to grow indefinitely in responsibility. It is
currently the single sanctioned home for: (a) `RUNTIME_CORE_EXTERNS`,
(b) the `BuiltinId → concrete extern` resolver. If future phases add a
large number of new builtins, FFI declarations, or system-call
externs to this same file, it risks becoming a congestion point. No
action is required now — this is recorded here so that when Level 2.6+
adds meaningfully more builtins/FFI surface, splitting `runtime-table.ts`
into per-concern files (e.g. a separate FFI registry) should be
considered as a deliberate, reviewed refactor — not deferred
indefinitely by default.

### Rule for Level 2.6 and beyond

Per the independent review: **do not touch the IR or the Runtime ABI**
in Level 2.6 unless a strong, documented architectural reason requires
it — the same freeze discipline applied at the previous tag continues
to apply here.

---

## Tag: `v27-level2-6-control-flow`

**Date recorded:** Level 2.6 closure (Phases 2.6.1 through 2.6.5),
following an independent engineering review of each phase in sequence
(2.6.1/2.6.1.5, then 2.6.2, then 2.6.3/2.6.4, then a standalone review of
2.6.5). Final verdict: **GO**, unconditional — Level 2.6 closed in full.

**Test state at freeze:** 1807/1807 passing, 0 TypeScript errors,
0 regressions.

### Independent review scores (final, Level 2.6 closure)

| Dimension | Score |
|---|---|
| Architecture | 10 / 10 |
| Clarity of responsibility boundaries | 10 / 10 |
| Extensibility | 9.5 / 10 |
| Stability | 10 / 10 |

### Newly Frozen Components (as of this tag)

| Component | Location |
|---|---|
| CFG Model (multi-block `IRFunction`, `branch`/`cond_branch` terminators) | `src/shared/ir.ts` |
| BasicBlock Model | `src/shared/ir.ts` (`IRBasicBlock`) |
| Branch Model | `src/shared/ir.ts` (`IRTerminator`'s `branch`/`cond_branch` variants) |
| Loop Model (loop-context stack, `loop_header`/`loop_body`/`loop_exit` shape) | `src/compiler/codegen/lower-to-ir.ts` |
| Local Slot Model (`IRLocalSlot`, `load`/`store`) | `src/shared/ir.ts` |
| CFG Verifier Interface (`checkModuleInvariants`'s 16-check catalog) | `src/shared/ir.ts` — see `CFG_VERIFIER_AUDIT.md` for the full independent audit |

All previously-frozen components (Level 1's Frontend/Semantic/TypeSystem;
Level 2.4's SSA IR core/Runtime Core/Extern ABI; Level 2.5's Builtins
Registry) remain frozen, unchanged by Level 2.6.

### Standing architectural note for the Optimizer phase (per review, binding guidance)

**Do not extend `checkModuleInvariants()` itself into a dataflow
analyzer, dominator-tree builder, or optimization validator.** When the
Optimizer phase begins, create **separate, independent modules** for
each new concern:

- CFG Verifier (existing, frozen at this tag) — structural checks only.
- Dataflow Validator (future, separate module) — for any real dataflow
  analysis the Optimizer needs.
- Dominator Analysis (future, separate module) — for any pass requiring
  a dominator tree (e.g. real phi-node placement, if ever undertaken).
- Optimization Validation (future, separate module) — for verifying an
  optimization pass preserved program semantics.

This keeps the CFG Verifier itself simple, fast, and single-purpose —
exactly the property the independent review scored 10/10 for at this
tag — rather than letting it grow into a large, multi-responsibility
module as the compiler gains more analysis needs.

### What Level 2.6 achieved

UR now has a real, working control-flow foundation: `if`/`else`,
`while`, `break`/`continue`, all lowered onto a genuine multi-block CFG
(not a special-cased AST-to-C shortcut), verified by a 16-check
structural Verifier with clearly documented boundaries, without
introducing phi nodes, dominator trees, or any redesign of the frozen
SSA IR core. This is the foundation the Optimizer, LLVM Backend, and
WASM Backend phases will build on without requiring a redesign of the
compiler's core.

---

## Tag: `v27-level2-7-functions-abi`

**Date recorded:** Level 2.7 closure (Functions & Calls ABI documented
and frozen), following an independent engineering review of
`FUNCTIONS_ABI_SPEC.md` (one revision round: four requested changes
applied, then GO).

**Test state at freeze:** 1835/1835 passing, 0 TypeScript errors,
0 regressions.

**Key finding that shaped this phase:** a 12-scenario empirical audit
(real `gcc` + execution + AddressSanitizer) found **zero real defects**
in the existing function-call model. This phase's actual work was
documentation and permanent-test conversion, not new capability — see
`CHANGELOG.md`'s `[level2-7-functions-abi]` entry for full detail.

### Newly Frozen: the Functions & Calls ABI

Per `FUNCTIONS_ABI_SPEC.md` §5.1 ("ABI Stability"), exactly three
changes constitute a breaking change to this ABI:

1. The qualified-name scheme (`ur_<module>_<name>`).
2. Parameter order for an existing function signature.
3. The `IRType` a given UR return-type annotation maps to.

**Explicitly NOT frozen** (free to change without being an ABI break):
SSA value ids, Local Slot ids, Basic Block ids/numbering, and any
internal CFG shape a given construct lowers to. This mirrors the
Level 2.6 tag's own distinction between frozen models and internal
numbering.

**Recursion depth is explicitly NOT part of this ABI** — delegated
entirely to the host C call stack, with no UR-level guarantee at any
depth.

### Compatibility dependency

`FUNCTIONS_ABI_SPEC.md` itself declares (§8) that it depends on three
other frozen tags remaining unchanged: `v27-level2-6-control-flow`,
`v27-level2-4-runtime-core`, and `v27-level2-5-stdlib`. If any of those
three is ever revised, `FUNCTIONS_ABI_SPEC.md` must be re-reviewed even
if its own file is not directly edited.

### What Level 2.7 achieved

UR's function-call model — recursion (direct, mutual, forward-
referenced), nested/composed calls (arguments, loop conditions, branch
bodies), and multi-parameter functions — is now formally documented as
an ABI contract (not just working code) and backed by permanent
Golden/E2E/AddressSanitizer/UndefinedBehaviorSanitizer regression tests,
rather than resting on the one-off empirical audit that discovered it
already worked.

### Next (per approved roadmap)

Level 2.8 — Aggregates (Arrays, Structs). The Optimizer phase (2.9)
remains deferred until Aggregates close, since arrays/structs/memory
aliasing will meaningfully affect Optimizer design.

---

## Tag: `v27-level2-8-aggregates`

**Date recorded:** Level 2.8 closure (Arrays + Structs — Grammar,
Parser, AST, Semantic, Type Checker, IR, Backend, Golden, E2E, ASan,
UBSan), following an independent engineering review across five rounds
(Grammar+Parser+AST closure, Semantic closure, Type Checker closure,
Arrays-in-IR closure, Structs-in-IR/Backend/E2E/Golden closure). Final
verdict: **GO**, with one recorded architectural watch-point (below) —
no fixes required.

**Test state at freeze:** 1958/1958 passing, 0 TypeScript errors,
0 regressions.

### Independent review scores (final, Level 2.8 closure)

| Dimension | Score |
|---|---|
| Architecture | 10 / 10 |
| IR preservation (zero new types/instructions for structs) | 10 / 10 |
| Backend (no memcpy/malloc/pointers/aliasing for structs) | 10 / 10 |
| Specification compliance | 10 / 10 |
| Extensibility | 9.5 / 10 |

### Newly Frozen: Language Syntax 1.1 (Arrays & Structs)

Per `LANGUAGE_SYNTAX_1_1_SPEC.md` (ratified across two review rounds),
the following are now part of UR's frozen surface syntax and semantics:
array literals (`[1, 2, 3]`), bracket-suffix array types (`int[]`),
fixed-size-only arrays with runtime bounds checking via `ur_panic`,
`struct Name ... end` declarations (flat, primitive-scalar fields only),
`p.x` field access, value-copy struct assignment/parameter-passing,
structural (field-by-field, declaration-order, short-circuiting)
struct comparison, positional struct construction (`Point(1, 2)`, strict
arity, declaration-order binding, no named arguments), and forward
reference for both functions and structs.

### ⚠️ RATIFIED ARCHITECTURAL WATCH-POINT (per explicit review request)

**The "Flattened Field Slots" design — every struct field becomes its
own ordinary `IRLocalSlot`, with zero new `IRType`/`IRInstruction`
additions — is the official design for Level 2.8's scope ONLY:
primitive-scalar-field, non-nested structs.**

This design does **not** scale as-is to nested structs:

```
struct Line
    a: Point   // Point itself has fields x, y
    b: Point
end
```

Flattening a `Line` would require flattening `Point` *within* it
(`a_x`, `a_y`, `b_x`, `b_y`), which can be made to work for one level of
nesting but does not generalize cleanly to arbitrarily deep nesting
without either an explicit recursive-flattening pass or a real
aggregate-value IR concept. **This is recorded here as an explicit
re-evaluation trigger, not a current defect**: when a future phase
introduces nested structs, the Flattened Field Slots design must be
formally re-reviewed — it may still be extensible with a recursive
flattening scheme, or it may warrant introducing a real `IRType` for
aggregates at that point. Either way, that decision is deferred to when
nested structs are actually designed, not decided now.

### Explicitly NOT introduced in Level 2.8 (per review — avoid premature complexity)

Heap-allocated structs, struct references/pointers, copy-on-write, or
any dedicated `IRType` for aggregates. All would have added complexity
with no benefit at Level 2.8's actual scope (flat, primitive-field
structs and fixed-size primitive arrays) — deferred, not rejected
permanently.

### What Level 2.8 achieved

UR now has a complete core data model: scalars (Level 1), control flow
(Level 2.6), functions (Level 2.7), and now fixed-size arrays and flat
structs — the last major language-surface addition before the Optimizer
phase. The critical value-copy property (`let q = p; q.x = 10;` never
changes `p.x`) is verified both structurally (IR-level slot-id
inequality) and empirically (real compiled execution), and the frozen
Functions ABI's by-value default (`FUNCTIONS_ABI_SPEC.md` §2.1) now
demonstrably extends to structs without any ABI amendment.

### Next (per approved roadmap)

Level 2.9 — Optimizer Infrastructure. Per the standing architectural
note recorded at the Level 2.6 tag: `checkModuleInvariants()` itself
must not be extended into a dataflow analyzer, dominator-tree builder,
or optimization validator — any such capability must be built as a
separate, independent module.

---

## Tag: `v27-level2-9-optimizer`

**Date recorded:** Level 2.9 closure (Optimizer Infrastructure — Pass
Framework, Dominator Tree, Control Flow Analysis, Dataflow Framework,
Constant Folding, Dead Code Elimination, Optimization Validator, and a
consolidated Review & Stabilization sprint: real Benchmark Suite with
persistent history, Stress tests up to 50,004 raw IR instructions,
Fuzz tests against 30 randomly generated programs), following
independent engineering review across every individual pipeline item
plus a final consolidated review. Final verdict: **GO**, with Level
2.9 explicitly designated a **Stable** phase.

**Test state at freeze:** 2118/2118 passing, 0 TypeScript errors,
0 regressions.

### Formally REMOVED from scope during this phase (recorded, not silently dropped)

**Copy Propagation** — an IR Copy Presence Audit
(`IR_COPY_PRESENCE_AUDIT.md`) found zero propagatable copy patterns
across six real-program categories, confirmed architecturally
guaranteed by the current `IRInstruction` union (no instruction kind
represents a pure SSA-to-SSA copy). Recorded as a positive finding —
Lowering's own SSA construction already performs the equivalent of
early copy elimination — not a gap. Explicit reconsideration trigger:
re-evaluate if Lowering's variable-resolution strategy changes, or if
phi nodes are ever introduced.

### Newly Frozen: Optimizer Infrastructure

| Component | Location |
|---|---|
| Pass Framework (`OptimizationPass`, `runPipeline`, `validateFunction`) | `src/optimizer/pass.ts` |
| Dominator Tree (analysis-only, no IR mutation) | `src/optimizer/dominators.ts` |
| Control Flow Analysis (back edges, natural loops — no loop nest forest) | `src/optimizer/cfa.ts` |
| Dataflow Framework (strictly generic, no analysis-specific logic) | `src/optimizer/dataflow.ts` |
| Liveness Analysis (a concrete user of the Dataflow Framework) | `src/optimizer/liveness.ts` |
| Constant Folding (int/float add/sub/mul, unary minus only) | `src/optimizer/constant-folding.ts` |
| Dead Code Elimination (call/store/array_store never removed) | `src/optimizer/dead-code-elimination.ts` |
| Optimization Validator (separate from `checkModuleInvariants`) | `src/optimizer/validate.ts` |

All previously-frozen components (Level 1 Frontend/Semantic/TypeSystem;
Level 2.4 Runtime Core/Extern ABI; Level 2.5 Builtins Registry; Level
2.6 CFG/BasicBlock/Branch/Loop; Level 2.7 Functions ABI; Level 2.8
Arrays/Structs) remain frozen, unchanged by Level 2.9.

### Standing Stability Directive (binding, per review)

Per explicit review decision, Level 2.9 is now a **Stable** phase:

- **No micro-optimizations** to any existing pass.
- **No new passes** added inside Level 2.9's scope.
- **No modification** to Constant Folding, Dead Code Elimination, the
  Dataflow Framework, the Dominator Tree, Control Flow Analysis, or the
  Optimization Validator **except to fix a confirmed, documented bug**
  — mirroring the exact discipline already applied to the frozen IR and
  Runtime ABI.
- The project proceeds to the next roadmap phase; Level 2.9 is not
  revisited unless a real defect is found.

### What Level 2.9 achieved

UR now has a working, tested Optimizer built entirely on frozen
infrastructure (Level 2.6's CFG, Level 2.8's IR) without requiring any
IR redesign — the strongest possible evidence that the architecture
frozen at those earlier tags was sound. Every component was verified
not only individually but together: a consolidated review sprint
directly inspected IR at every pipeline stage, confirmed the fixed
pass order (Constant Folding before DCE) is load-bearing (folding
changes instruction *kind*, DCE does the actual size reduction), and
stress/fuzz-tested the whole assembly under real time bounds and
randomized inputs, finding zero divergent behavior.

### Next (per approved roadmap)

The next development phase proceeds per the project's roadmap. No new language features (Generics, Classes, GC, Async, Reflection, or otherwise) begin until explicitly scheduled — Level 2.9's closure does not itself authorize scope expansion elsewhere.
