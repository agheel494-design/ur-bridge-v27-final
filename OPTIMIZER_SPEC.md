# UR Optimizer Infrastructure — Design Specification (Level 2.9)

**Status:** RATIFIED FOR IMPLEMENTATION — approved after three
independent review rounds (round 1: GO WITH FIXES, four changes applied
— Dominator Tree as a pure analysis artifact §3, a fixed pipeline order
§2.1, a mandatory Pass Contract §2.2, and Pass Independence §2.3; round
2: GO, with one execution rule added below; round 3: an IR Copy
Presence Audit was requested before implementing Copy Propagation —
finding zero propagatable copy patterns across six real-program
categories, leading to Copy Propagation's formal REMOVAL from this
phase's scope — see §6.3).

**Execution rule (mandatory, per review — not an architectural change,
a development-process rule):** at most **one new item from §2.1's fixed
pipeline** may be implemented per development batch. After each item
(Pass Framework, then Dominator Tree, then Control Flow Analysis, then
the Dataflow Framework, then each pass individually, then the
Optimization Validator), the following must all be completed — in this
order — before starting the next item: Unit Tests → Golden Tests → E2E
Tests → full Regression → independent review. **Dead Code Elimination
specifically was not begun until the Analysis Framework (Dominator Tree
+ Control Flow Analysis + Dataflow Framework) was fully implemented and
had passed independent review** — building the shared infrastructure
first was expected to make every later pass simpler and more stable,
and did.

---

## 1. Pipeline Placement

```
UR Source → ... → Lowering → IRModule → [Optimizer] → IRModule → Backend → C
```

The Optimizer sits strictly between Lowering and the Backend, consuming
and producing an ordinary `IRModule` (the same frozen type from
`src/shared/ir.ts` — Level 2.6/2.8's tags). **No `IRType` or
`IRInstruction` change is anticipated by this phase** — every pass listed
above operates by rewriting existing instructions/terminators/blocks,
never by introducing new IR vocabulary.

**Per-function, not per-module or cross-module.** Every pass in this
phase's scope operates on one `IRFunction` at a time, independently. No
pass may inspect or modify a different function while processing another
— this is precisely what keeps Inlining (which is inherently
cross-function) out of scope without needing to say so twice.

---

## 2. Pass Framework

```typescript
// Proposed shape — src/optimizer/pass.ts (new file, new directory)
export interface OptimizationPass {
  readonly name: string;
  run(fn: IRFunction): IRFunction;  // returns a new (or the same, if unchanged) IRFunction
}
```

- Passes are **pure functions from `IRFunction` to `IRFunction`** — no
  shared mutable state between passes, no pass reaching into another
  pass's internals. This mirrors the existing Lowering/Backend
  separation (`lower-to-ir.ts` and `emit-c.ts` never share instances).
- A `runPipeline(fn: IRFunction, passes: OptimizationPass[]):
  IRFunction` driver applies each pass in order, **running
  `checkModuleInvariants`-equivalent structural validation after every
  single pass** (see §6) — not just once at the end — so a broken pass
  is caught immediately at its own boundary, not attributed to a later,
  innocent pass.
- Passes are **independently toggleable** (an array the driver iterates
  over) — this is what makes "freeze the framework, then add passes one
  at a time" (per the approved order) a natural fit for the
  architecture, not a workaround.

### 2.1 Fixed Pipeline Order (ratified — not left open)

```
IRModule (from Lowering)
    ↓
IR Verifier (checkModuleInvariants — unmodified, existing)
    ↓
Dominator Analysis (§3 — analysis artifact, no IR mutation)
    ↓
Loop Detection (§4, Control Flow Analysis — uses the dominator tree)
    ↓
Constant Folding (§6.1 — local, no dataflow)
    ↓
Dead Code Elimination (§6.2 — backward dataflow, Liveness)
    ↓
Optimization Validator (§7 — pass-specific sanity checks)
    ↓
IR Verifier (checkModuleInvariants — run again, post-optimization)
    ↓
Backend
```

**Copy Propagation, originally item 7 in this pipeline, was REMOVED**
after an IR Copy Presence Audit found zero occurrences of any
propagatable copy pattern across six categories of real programs — see
§6.3 for the full finding and the explicit reconsideration trigger.
This is a positive finding (Lowering's own SSA construction already
eliminates this redundancy class), not a gap.

This order is fixed for this phase — not a suggestion to be reordered
per-invocation. Dominator Analysis and Loop Detection run once, up
front, and their results (§2.3) are available to every later pass in
this pipeline, but none of the three optimization passes currently
require them (§3/§4 note this explicitly) — they run first only because
Control Flow Analysis is next in the approved build order, not because
a later pass in *this* pipeline depends on it yet.

### 2.2 Pass Contract (mandatory for every pass, present and future)

Every `OptimizationPass` — the three in this phase and any added later —
must satisfy:

| | |
|---|---|
| **Input** | A structurally valid `IRFunction` (passes `checkModuleInvariants`). |
| **Output** | A structurally valid `IRFunction` (passes `checkModuleInvariants`). |
| **Allowed** | Removing instructions; replacing an instruction with an equivalent one; adding/removing/retargeting blocks and terminators (CFG edits), as long as the result remains structurally valid. |
| **Forbidden** | Changing a function's ABI (`FUNCTIONS_ABI_SPEC.md` §5.1: qualified name, parameter order/count, return type). Changing a function's signature as observed by any caller. Changing which Runtime extern a `call` targets, or adding/removing a Runtime call the source program didn't imply. Modifying the Builtins Registry or its resolution order. Changing observable program behavior (stdout, exit code, panics) for any valid input. |

A pass that needs to violate any "Forbidden" entry does not belong in
this pass-contract-governed pipeline at all — it would need to be a
different kind of tool entirely (e.g. a language-level rewrite), not an
`OptimizationPass`.

### 2.3 Pass Independence

**No pass may access another pass's internal/private state.** All
information one pass produces that a later pass might need must flow
through one of exactly two channels:

1. **The `IRFunction` itself** — the only thing passes actually pass to
   each other in the pipeline (§2.1's driver signature).
2. **A documented, independent analysis-result interface** — e.g.
   `DominatorTree`, `LoopInfo` (§3/§4), or a `Map<number, Fact>` from the
   Dataflow Framework (§5) — each with its own published type, computed
   by calling the analysis's own entry point (`computeDominatorTree(fn)`,
   `runDataflow(fn, analysis)`), never by reaching into a previous pass's
   closures, private fields, or intermediate variables.

This is stated now, while there are still only a small number of passes,
specifically so it is already the norm — not a retrofit — by the time a
future phase adds a tenth or twentieth pass and the temptation to "just
peek at what the last pass computed" becomes real.

---

### 2.4 Analysis Cache (recorded now, not built now)

**Watch-point, per review:** once multiple analyses exist (Dominator
Tree, `LoopInfo`, Dataflow facts), no pass should force every other pass
to recompute them from scratch. The eventual shape:

```
OptimizationContext { fn: IRFunction, analysisCache: Map<string, unknown> }
```

A pass asks the context for an analysis by name; if cached and not
invalidated, the cached result is returned; otherwise it is computed
once and cached. Any pass that mutates the IR must invalidate every
cached analysis that could be affected (dominator tree, loop info,
liveness, reaching copies) — conservatively invalidating all of them is
an acceptable, simple starting behavior; per-analysis fine-grained
invalidation is not required now.

**Explicitly NOT built in this phase:** incremental dominator updates,
lazy CFG update, or a full analysis-dependency graph — all reasonable
future refinements, but premature before more analyses and passes
exist. This subsection exists so the *eventual*
context/cache shape is anticipated by the interfaces built now (§3's
`DominatorTree`, §5's dataflow fact maps) — not so that shape is built
today.

**Analysis Invalidation (recorded now, per review — mandatory the
moment the first CFG-mutating pass exists, not before):** currently, no
pass in this phase's fixed pipeline (§2.1) modifies the CFG shape
(Constant Folding rewrites individual instructions; Dead Code
Elimination, as scoped in §6, does not add/remove
blocks or retarget terminators either). **The moment any future pass
*does* modify the CFG** (e.g. a later phase's block-merging or
unreachable-block-removal pass), that pass MUST invalidate every cached
CFG-derived analysis before any later pass consults it again:

```
CFG modified
    ↓
invalidate DominatorTree
    ↓
invalidate LoopInfo (§4)
    ↓
invalidate any Dataflow Framework (§5) results
```

Using a stale `DominatorTree` or `LoopInfo` after the CFG it was
computed from has changed is a correctness bug, not a performance
concern — this rule is not optional once it applies. It does not apply
yet, since no pass in this phase's scope changes the CFG.

---

---

## 3. Dominator Tree

**The Dominator Tree is an analysis artifact only — it is NOT part of
the IR, and it is never persisted onto `IRFunction`, `IRBasicBlock`, or
any other frozen IR type. Building or querying the Dominator Tree must
never mutate the IR it was computed from.** This is stated explicitly,
per review, to foreclose any future temptation to let "just compute the
dominator tree while we're at it" quietly turn into an IR-mutating step
disguised as analysis — analysis and transformation remain strictly
separate operations in this design, for every pass, not only this one.

**Purpose in THIS phase:** infrastructure for the "Control Flow
Analysis" step (§4) — specifically, identifying natural loops (a back
edge `A -> B` where `B` dominates `A`) and computing loop nesting depth.
**Not** needed by, and not used by, Constant Folding or Dead Code
Elimination themselves (both are ordinary
dataflow/local passes that don't require dominance information) — it is
being built now, ahead of strictly needing it, because Control Flow
Analysis is explicitly next in the approved order and because computing
it correctly once, as shared infrastructure, avoids every future
loop-aware pass (LICM, GVN, etc. — deferred, but foreseeable)
re-deriving it independently later.

**This is a deliberate, narrow exception to the "no Dominator Tree" rule
established for Level 2.6's CFG work** — that rule was about the
*Lowering* pass not needing one to avoid phi-node placement (`CFG_SPEC.md`
§1). The Optimizer is a different module with a different job; building
a dominator tree here does not reopen or contradict that earlier
decision, and still introduces **zero phi nodes** anywhere.

**Algorithm:** the standard iterative dominator algorithm (Cooper,
Harvey, Kennedy, "A Simple, Fast Dominance Algorithm") computing
immediate dominators via reverse-postorder iteration to a fixed point —
a well-understood, textbook approach with no exotic dependencies. (An
earlier, unrelated UR-Bridge project iteration reportedly used this same
algorithm previously — noted here only as prior general engineering
familiarity, not as existing code in this codebase; nothing from that
prior iteration exists in the current `v27` tree.)

**Location:** `src/optimizer/dominators.ts` (new file). Operates on an
`IRFunction`'s blocks/terminators only — no new IR type required (the
dominator tree is a separate, optimizer-internal data structure, not
part of `IRFunction` itself).

---

## 4. Control Flow Analysis

Built on the Dominator Tree (§3): identifies natural loops (back edges,
loop headers, loop bodies) and computes basic loop nesting depth per
block. **Output is consumed by nothing else in this phase's own passes**
(Constant Folding/DCE don't need it) — it exists as
validated, tested infrastructure for future loop-aware passes (matching
the approved order's explicit exclusion of LICM/unrolling *for now*, not
forever).

**Location:** `src/optimizer/cfa.ts` (new file).

---

## 5. Dataflow Framework

A generic, reusable worklist-based dataflow engine — and, per explicit
review instruction, **strictly generic**: no analysis-specific concept
(Liveness, Reaching Definitions, Reaching Copies, Available Expressions)
may appear inside this framework itself. Those are all future *users*
of this engine, built as separate, independent modules once the engine
exists and is reviewed on its own.

```typescript
// Proposed shape — src/optimizer/dataflow.ts (new file)
export interface DataflowAnalysis<Fact> {
  readonly direction: "forward" | "backward";
  readonly boundaryFact: Fact;      // the fact at the entry (forward) or exit (backward) boundary
  equal(a: Fact, b: Fact): boolean; // fixed-point comparison
  meet(facts: Fact[]): Fact;        // combines facts from multiple predecessors/successors
  transfer(block: IRBasicBlock, factIn: Fact): Fact; // per-block; the analysis itself decides how (or whether) to look inside `block.instructions`
}
export interface DataflowResult<Fact> {
  readonly in: ReadonlyMap<number, Fact>;
  readonly out: ReadonlyMap<number, Fact>;
}
export function runDataflow<Fact>(fn: IRFunction, analysis: DataflowAnalysis<Fact>): DataflowResult<Fact>;
```

**Mandatory determinism (per review):** the worklist's node-processing
order must be fixed and reproducible — e.g., ascending block id order —
never insertion-order-dependent or otherwise incidental. The same
function and the same analysis must always converge to bit-identical
`in`/`out` maps across repeated runs, so that tests are 100% reproducible.
This is enforced by the implementation's own iteration strategy, not
left to chance.

**`analyzeControlFlow` (§4) does not own or manage `DominatorTree`
(§3)** — and, by the same principle, this framework does not own or
manage `DominatorTree`/`ControlFlowAnalysis` either. Every analysis in
this phase takes whatever inputs it needs as plain function parameters;
none of them hold a reference to, or are responsible for invalidating,
another analysis.

One concrete analysis is needed for this phase's one dataflow-based
pass (built in a LATER batch, as a separate module, once this framework
itself is reviewed):

- **Liveness Analysis** (backward) — which SSA values/slots are "live"
  (may be used later) at each program point. Feeds Dead Code Elimination.

**Reaching Copies** (forward) — originally planned to feed Copy
Propagation — is **not built**, since Copy Propagation itself was
removed from this phase's scope (§6.3, IR Copy Presence Audit finding).
If Copy Propagation is ever reconsidered (per §6.3's explicit trigger
conditions), Reaching Copies would be built at that time, as its own
separate module, exactly like Liveness was for DCE.

**Constant Folding does NOT use this framework** — it is a purely local,
single-instruction-at-a-time transformation (see §6.1) with no
cross-block analysis needed.

**Location:** `src/optimizer/dataflow.ts`, `src/optimizer/liveness.ts`,
`src/optimizer/reaching-copies.ts`.

---

## 6. The Passes (in approved order)

### 6.1 Constant Folding

Local, no dataflow: any `binop`/`unop` instruction whose operand(s) are
themselves `const` instructions with statically-known values is replaced
by a single `const` instruction with the computed result. **Purely
local**: never modifies the CFG, never deletes a block, never evaluates
or simplifies control flow — the transformation is confined entirely to
replacing one instruction's definition with an equivalent `const`.

**Scope for the FIRST implementation batch (per explicit review
narrowing) — deliberately minimal:**

- ✅ `const_int`/`const_float` operands only.
- ✅ `add`, `sub`, `mul` (both int and float).
- ✅ `neg` (unary minus) on `const_int`/`const_float`.
- ❌ `div`/`mod` — **not folded in this batch**, specifically because of
  the zero-divisor case: it remains as-is, preserving the existing
  runtime panic behavior (`RUNTIME_SPEC.md` §7.3) rather than the
  Optimizer silently deciding what happens for that case. May be added
  in a later, separately-reviewed batch once the zero-divisor handling
  is explicitly designed for the folded case too.
- ❌ Boolean simplification (`and`/`or`/`not` on `const_bool`) — deferred.
- ❌ String folding — deferred (not currently a meaningful operation
  target anyway, since no string `binop`s exist).
- ❌ Comparison folding (`eq`/`neq`/`lt`/`lte`/`gt`/`gte` on constants)
  — deferred.
- ❌ Branch folding / `if (true)`-style control-flow simplification —
  explicitly a **different, later pass** (Control Flow Simplification),
  never mixed into Constant Folding even once boolean/comparison
  folding are eventually added — folding a comparison's *value* and
  simplifying a *branch* based on a folded condition are related but
  distinct transformations with different CFG implications.

### 6.2 Dead Code Elimination (DCE)

Uses Liveness Analysis (§5, backward). An instruction whose defined SSA
id is never live (never used by anything reachable) AND has no
observable side effect is removed. **Side-effecting instructions are
never removed**, regardless of liveness: `call` (may have Runtime/user
side effects — e.g. `print`), `store`/`array_store` (mutates a slot that
might still be read later via a path the local liveness fact doesn't
directly see as "this exact def"), and any terminator. Only pure,
locally-owned SSA-defining instructions with a genuinely dead result
(`const`, `binop`, `unop`, `load`, `array_load` whose id is never used)
are eligible.

### 6.3 Copy Propagation — REMOVED from Level 2.9's scope (IR Copy Presence Audit)

**Original plan (superseded):** this section originally proposed a
Reaching-Copies-based Copy Propagation pass, scoped to plain SSA rebind
chains (`v2 = v1`, no operation). Before implementation began, review
required an **IR Copy Presence Audit** — a direct empirical check, across
six categories of real UR programs, of whether any instruction pattern
matching this "copy" definition actually occurs in this compiler's IR
output at all.

**Finding: zero occurrences, in every category tested** — sequential
assignments, assignments inside `if`, assignments inside `while`,
post-struct-construction/copy, post-array-construction, and
post-function-call. Every category's instructions were exclusively
`param`/`const`/`binop`/`call`/`load`/`store`/`array_load`/`array_store`
— never any pattern representing a pure SSA-to-SSA copy.

**This is not merely rare — it is architecturally impossible given the
current `IRInstruction` union.** There is no instruction kind whose
shape is "define a new SSA id equal to an existing SSA value with no
operation" (i.e. no `copy`/`mov` kind exists). Every source-level
"copy" resolves, during Lowering, into one of:

1. **Zero instructions at all** — for a non-slot-based (never branch/
   loop-crossing) variable, Lowering's environment-based SSA
   construction (`varEnv`, `assignVar`) directly rebinds the variable
   name to the existing SSA value reference — no new instruction is
   ever emitted for the rebind itself.
2. **A `load`** — for a slot-based variable, reading its current value
   is a memory read from a slot, not a register-to-register copy (and
   is explicitly excluded from this pass's "copy" definition regardless).
3. **A `store`** — writing a value into a slot; defines no SSA id at
   all, so it cannot be "propagated" as a value copy in the first place.

**Decision (per review): Copy Propagation is removed from Level 2.9's
fixed pipeline (§2.1).** This is recorded as a **positive finding, not
a regression or a gap**: Lowering's environment-based SSA construction
already performs the equivalent of "early copy propagation" as an
inherent side effect of how it resolves variable references, for every
program category tested — a pass targeting this exact redundancy class
would be correct but permanently vacuous (never fires on any program
this compiler currently produces).

**Explicit reconsideration trigger (not a promise, a documented
condition):** if either of the following ever becomes true in a future
phase, Copy Propagation should be re-evaluated from scratch, as a new,
separately-reviewed design decision:

- Lowering's variable-resolution strategy changes (e.g., a future
  refactor stops using direct environment rebinding for some class of
  variables, reintroducing real copy instructions).
- Phi nodes are ever introduced (a phi node IS fundamentally a
  multi-input copy — trivial phi elimination is exactly Copy
  Propagation's classic use case in phi-based SSA compilers).

Until either condition holds, this pass remains removed, not merely
"not yet implemented."

---

## 7. Verification: kept separate from `checkModuleInvariants` (per the standing Level 2.6 architectural note)

Per `FREEZE_LOG.md`'s Level 2.6 tag: *"Do not extend
`checkModuleInvariants()` itself into a dataflow analyzer, dominator-
tree builder, or optimization validator... create separate, independent
modules."* This phase follows that instruction precisely:

- **`checkModuleInvariants()` itself is not modified.** It continues to
  perform exactly its existing 16 structural checks (`CFG_VERIFIER_AUDIT.md`),
  run unmodified after every optimizer pass (§2) as a structural
  regression guard (catches, e.g., a pass accidentally leaving a
  reference to a removed id).
- **A new, separate `OptimizationValidator`** (`src/optimizer/validate.ts`)
  performs pass-specific sanity checks that are NOT general IR structural
  rules — e.g., confirming DCE never removed a `store`/`call`/terminator,
  confirming Constant Folding's output instruction really is a `const`
  with the mathematically correct value. This module is explicitly
  scoped to the Optimizer's own passes and never called from Lowering,
  Semantic, or the Backend.
- **Full semantic-equivalence proof is explicitly out of scope** (and
  undecidable in general) — correctness for each pass rests on: (a) the
  structural checks above, (b) the `OptimizationValidator`'s targeted
  sanity checks, and (c) direct empirical verification — E2E tests that
  compile and run the SAME program with and without each pass enabled,
  asserting **identical observable output** (stdout, exit code). This
  is the same methodology already used throughout Level 2.4–2.8 (real
  `gcc` compile + real execution + AddressSanitizer), extended here to
  specifically compare pre-optimization vs. post-optimization behavior.

### 7.1 Analysis/Transformation Ordering Discipline (recorded now, per review)

**No pass may mutate the IR *while* a dataflow analysis (or the
Dominator Tree, or Control Flow Analysis) is being computed over it.**
The only correct sequence is:

```
Analysis (Dominator Tree / CFA / Dataflow)
    ↓
Analysis RESULT (an independent, immutable value — §7.2)
    ↓
Optimization Pass consults the result
    ↓
Optimization Pass mutates the IR (producing a NEW IRFunction)
```

Never the reverse (mutating the IR mid-analysis) — doing so produces
exactly the class of hard-to-trace bugs (an analysis silently seeing a
half-updated CFG) this ordering discipline exists to rule out by
construction, not merely by convention.

### 7.2 Analysis Results Are Immutable

Every analysis result produced in this phase — `DominatorTree`,
`ControlFlowAnalysis`, `DataflowResult<Fact>` — is treated as immutable
once returned. **A pass never mutates a previously-computed analysis
result in place.** If a pass needs an updated view after it has changed
the IR, it must request a **fresh** analysis over the new `IRFunction`
— never patch the old result. (No pass in this phase's fixed pipeline
currently needs to re-request an analysis mid-pass — this is recorded
as a standing rule for when a future pass does.)

### 7.3 Future Analysis Cache Key (recorded now, not built now)

When the Analysis Cache (§2.4) is eventually built, its cache key must
be **(IR version, analysis kind)** — never the function's name/id alone.
A function's identity (its qualified name) does not change when its CFG
is rewritten by a pass, but its dominance/loop/dataflow facts do — keying
solely by name would silently serve a stale analysis result for the
*same* function after it has been transformed. "IR version" can be as
simple as a monotonically-incrementing counter bumped by
`runPipeline()` (§2) every time any pass actually changes the function
— this is a future design detail, not resolved here, only the
non-negotiable requirement that name-alone keying is wrong.

---

## 8. Golden Tests, E2E, Regression

- Golden Tests: for each pass, a hand-crafted UR program plus its
  **expected optimized IR** (not just expected C) — making a pass
  regression immediately visible at the IR level, before it could ever
  reach the Backend.
- E2E: every existing Level 2.4–2.8 E2E program re-run **with the full
  optimizer pipeline enabled**, asserting identical exit codes/stdout to
  the un-optimized baseline (already recorded by those same tests
  today) — this is the single most direct guarantee that optimization
  never changes observable behavior.
- Regression: the full existing suite (1958 tests as of the Level 2.8
  tag) must continue passing with the optimizer pipeline wired in but
  **initially a no-op pipeline (zero passes registered)** — proving the
  framework itself introduces no behavior change before any real pass
  is added, then re-run again after each pass is added one at a time.

---

## 9. What This Document Does NOT Decide

- Whether/when the Optimizer runs by default vs. opt-in (a CLI/build
  flag question, not a design question this document needs to resolve).
- Any pass beyond the three listed (Inlining, LICM, GVN, Loop
  Unrolling, Vectorization) — explicitly deferred, per the approved
  order.
- Whether future loop-aware passes will reuse the Dominator
  Tree/Control Flow Analysis built here as-is, or need extensions —
  left to whenever those passes are actually designed.

---

## 10. Compatibility

This specification assumes, and is written against, the frozen state at:

- `v27-level2-8-aggregates` (IR/Backend for Arrays/Structs — the
  Optimizer must not require any change to `IRLocalSlot.length`,
  `array_load`/`array_store`, or the Flattened Field Slots design).
- `v27-level2-7-functions-abi` (per-function scope in §1 respects the
  existing calling-convention boundary — the Optimizer never touches
  cross-function behavior).
- `v27-level2-6-control-flow` (the CFG/BasicBlock/Branch/Loop models
  this phase's Dominator Tree and Control Flow Analysis are built on
  top of, never modified).

If any of these are ever revised, this document should be re-reviewed.

---

## 11. Performance Measurement (Future Infrastructure — NOT part of Level 2.9)

**Explicitly out of scope for Level 2.9 itself, per review decision.**
The Optimizer's job in this phase is: build the pass framework, the
analysis framework, and the passes, then freeze. Performance
measurement is a *different*, cross-cutting concern (it would measure
Lowering, the Optimizer, and the Backend alike, not the Optimizer
alone) — mixing it into this phase would drift Level 2.9's scope from
"build the Optimizer" to "build measurement tooling," which review
explicitly rejected.

**Sequencing (ratified):** this section exists only to record what a
future, independent Performance Dashboard phase should measure, so that
phase can begin immediately after Level 2.9 freezes, without needing to
rediscover this list. It is documentation only — no code, no schema, no
tooling exists yet, and none should be built while Level 2.9 is still
open.

At minimum, the future Performance Dashboard should record, per pass
and in aggregate:

- Time taken by each individual pass (Constant Folding, DCE) and by the
  Dominator Tree / Control Flow Analysis / Dataflow Framework steps.
- IR instruction count immediately BEFORE each pass runs.
- IR instruction count immediately AFTER each pass runs.
- Instructions removed specifically by Dead Code Elimination.
- Instructions folded specifically by Constant Folding.
- ~~Instructions rewritten specifically by Copy Propagation~~ — N/A;
  Copy Propagation was removed from Level 2.9's scope (§6.3). Re-add
  this metric only if Copy Propagation is ever reconsidered per §6.3's
  explicit trigger conditions.
- Total optimization time (sum of all passes, one function/module).
- Full end-to-end compilation time (Lexer through Backend, optimizer
  included).
- Emitted executable file size.
- Peak memory consumption during compilation.
- **Comparison against the immediately preceding recorded version** —
  the Dashboard's primary value is detecting regressions (a change that
  quietly makes compiled code bigger, slower, or the compiler itself
  slower), not just recording absolute numbers in isolation.

**When this phase begins** (immediately after Level 2.9's freeze, before
LLVM Backend work starts, per the approved roadmap), it should get its
own short design document, its own review round, and its own freeze —
following the exact same discipline as every phase in this project so
far. This section is not that document; it is a placeholder ensuring
the eventual document doesn't have to start from a blank page.
