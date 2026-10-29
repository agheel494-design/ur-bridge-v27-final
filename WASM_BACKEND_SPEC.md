# UR WASM Backend — Design Specification (Level 3.1)

**Status:** DRAFT — awaiting ratification, per this project's established
practice. No implementation code exists yet. Written specifically
because WASM Backend is the **verifiable** alternative to the currently
**blocked** LLVM Backend (`LLVM_ENVIRONMENT_REQUIREMENTS.md`) — every
claim this document's eventual implementation makes must be checkable
by real validation and real execution, using tooling **already present
in this environment with zero installation** (§7).

**Scope for this document:** covers all three approved sub-phases
(3.1A: integers/locals/arithmetic/branches/functions/return; 3.1B:
arrays/memory/bounds-checking; 3.1C: Runtime integration/imports/
exports) at the design level, but — matching every prior phase's
"one item per batch" discipline — implementation proceeds strictly in
that order, one sub-phase at a time, each independently reviewed before
the next begins.

---

## 0. Backend Feature Matrix (ratified — prevents any future dispute about sub-phase scope)

**Corrected per direct verification (not aspirational planning): the
`✅`/`❌` marks below reflect ACTUAL, CONFIRMED Backend behavior,
checked directly against the shipped code, not a forward-looking plan
for when each feature might eventually land. An earlier version of
this note recorded that float `const`/`binop` and `unop` (`neg`/`not`)
were never implemented in any 3.1A or 3.1B batch, correcting a prior
table that had marked them `✅` too early. Per GATE-022A/B (real,
direct re-verification against the current, shipped code, including
a later Independent Review correction): `const` (float), `binop`
(float, `add`/`sub`/`mul` only), and `unop` `neg` on `i64` are now
confirmed, Gate-authorized, and working (V2-M5, V2-M3) — `unop` `neg`
on `f64` remains excluded, and `unop` `not` on `bool` is NOT usable
end-to-end (its own opcode handling may cite V2-M3, but real bool
constants are not supported at all — see the table's own two,
separate rows below). Struct field construction and plain-variable
field access
are likewise confirmed working (Phase 1/2) — struct-in-array
extraction/mutation and chained field access remain separate,
already-classified limitations, unaffected by this correction.**

| IR feature | 3.1A | 3.1B (RC2, actual) | 3.1C (planned, not yet built) |
|---|---|---|---|
| `const` (int) | ✅ | ✅ | ✅ |
| `const` (float) | ❌ | ✅ *(V2-M5, Gate authorized)* | ✅ |
| `binop` (int arithmetic/comparison) | ✅ | ✅ | ✅ |
| `binop` (float, `add`/`sub`/`mul` only) | ❌ | ✅ *(V2-M5, Gate authorized, narrow scope — `div`/`mod` not included)* | ✅ |
| `unop` — `neg` on `i64` | ❌ | ✅ *(V2-M3, Gate authorized, narrow scope)* | ✅ |
| `unop` — `not` on `bool`, end-to-end (a real UR program using `!x` on a bool value) | ❌ | ❌ *(NOT USABLE / NOT PROVEN — GATE-022B correction, per Independent Review. The `not` opcode's own handling code may exist, citing V2-M3 — but this does not by itself prove a real, executable language path from source to result; that path is blocked by the separate bool-constant gap below, and has not been independently demonstrated end-to-end.)* | ✅ *(pending bool-constant support)* |
| `bool` constants (`true`/`false`), any use, with or without `not` | ❌ | ❌ *(NOT SUPPORTED — confirmed directly: a bare `let x = true`, with zero `unop` involved, is rejected)* | *(planned)* |
| `unop` — `neg` on `f64` | ❌ | ❌ *(deliberately excluded from V2-M3's own scope — falls through to the generic `WASM1001` rejection)* | *(planned)* |
| Local variables (`IRLocalSlot`, scalar) | ✅ | ✅ | ✅ |
| `if`/`else` | ✅ | ✅ | ✅ |
| `while`/`break`/`continue` | ✅ | ✅ | ✅ |
| `function` declaration/`call` (intra-module) | ✅ | ✅ | ✅ |
| `return`/`return_void` | ✅ | ✅ | ✅ |
| Arrays (`array_load`/`array_store`) | ❌ | ✅ | ✅ |
| Linear memory / bounds checking | ❌ | ✅ | ✅ |
| Structs (flattened field slots) | ❌ | ✅ *(Phase 1/2, Gate authorized — construction and plain-variable field access; struct-in-array extraction/mutation and chained field access remain separate, already-classified limitations)* | ✅ |
| Runtime imports (`print`/`input`/`free`) | ❌ | ❌ | ✅ |
| Runtime lifecycle (`ur_runtime_init`/`shutdown`) | ❌ | ❌ | ✅ |
| Strings | ❌ | ❌ | ❌ (no phase currently scopes this — UR's own string support is limited to Runtime-mediated builtins; revisit only if/when the language itself extends string support) |
| Exceptions / non-local control transfer | ❌ | ❌ | ❌ (UR has none at the language level; out of scope for every sub-phase, not merely deferred) |

**3.1A's hard boundary (per explicit review — not to be exceeded without
a new, separately-reviewed scope decision):** integers, constants,
arithmetic, local variables, functions, return, `if`, `while`, `call`.
**Nothing else.** Arrays, structs, memory, Runtime imports, strings,
and exceptions are deferred to their documented later phase, never
"snuck in early" because an implementation detail made it convenient.

---

## 1. The Central Design Challenge: Structured Control Flow

**WASM has no arbitrary `goto`.** Unlike the C Backend (`emit-c.ts`),
which freely emits `goto block_N;` for any `branch`/`cond_branch`
terminator (`CFG_SPEC.md`, `OPTIMIZER_SPEC.md`'s frozen CFG model),
WASM's control-flow instructions (`block`, `loop`, `if`/`else`, `br`,
`br_if`) are **structured**: a `br` can only target an *enclosing*
`block`/`loop`, identified by nesting depth — there is no equivalent of
jumping to an arbitrary label.

This is a real, well-known problem in compiler construction (informally
"the relooping problem" — converting an arbitrary CFG into structured
control flow, as Emscripten's Relooper algorithm does for arbitrary C
code compiled to WASM/asm.js). **This project does not need the general
algorithm**, because UR's IR never contains an arbitrary CFG — every
CFG shape it produces comes from exactly two frozen, well-understood
Lowering patterns (`CFG_SPEC.md` §3–4, unchanged since Level 2.6):

1. **`if`/`else` diamonds**: `cond_branch` to two blocks that either both
   terminate (no merge needed) or both flow to one common merge block.
2. **`while` natural loops**: a `loop_header`/`loop_body`/`loop_exit`
   shape with exactly one back edge, identifiable via the existing,
   frozen Control Flow Analysis (`src/optimizer/cfa.ts`,
   `analyzeControlFlow()` — **reused directly, not reimplemented**).

**Approach: pattern-match these two shapes directly, using the
already-frozen Dominator Tree and Control Flow Analysis from Level 2.9**
(`computeDominatorTree()`, `analyzeControlFlow()`) rather than
implementing a general relooper:

- A `cond_branch` whose two targets both dominate-converge at a single
  block (found via the Dominator Tree) becomes a WASM `if`/`else`
  (`§4`).
- A natural loop (found via `ControlFlowAnalysis.naturalLoops`) becomes
  a WASM `loop` with a `br` back to its start on the loop condition
  (`§5`).
- **Any CFG shape that does not match one of these two patterns is
  explicitly rejected** with a clear `WASM Backend: unsupported
  control-flow shape` diagnostic — never silently miscompiled. Given
  Lowering (Level 2.1–2.8, frozen) only ever produces these two shapes,
  this should never trigger for any program this compiler's own
  Frontend/Semantic/Lowering can produce — but the Backend must not
  *assume* that silently; it must check and fail loudly if it's ever
  wrong.

This reuses Level 2.9's Optimizer infrastructure for a **second**
purpose beyond optimization — directly vindicating the Dominator
Tree/CFA's own design note (`OPTIMIZER_SPEC.md` §3: *"avoids every
future loop-aware pass... re-deriving it independently later"*) sooner
than expected.

**Interface-only dependency (mandatory, per review):** the WASM Backend
depends on `DominatorTree` and `ControlFlowAnalysis`'s **published
types and function signatures only** — `computeDominatorTree(fn):
DominatorTree`, `dominates(a, b): boolean`, `analyzeControlFlow(fn, dt):
ControlFlowAnalysis`, `naturalLoops`, `backEdges` — never their
internal algorithm (Cooper-Harvey-Kennedy iteration, the natural-loop
worklist traversal, or any private helper in `dominators.ts`/`cfa.ts`).
This is the same Pass Independence principle already frozen in
`OPTIMIZER_SPEC.md` §2.3, applied here to a *second* consumer of these
analyses (the Backend, not another Optimizer pass) — the Backend must
never be positioned in a way that constrains a future change to the
dominance algorithm's internals, as long as the published interface's
contract (what `dominates()` and `naturalLoops` mean) stays the same.

---

## 1.1 Explicitly Out of Scope for Phase 3.1A (per review — a fixed list, not a starting point for gradual expansion)

**Not supported, and not silently accepted as a degenerate case** — any
UR program whose Lowering output produces one of these must be
rejected by the WASM Backend with the exact diagnostic shown in §1's
final paragraph, never miscompiled or silently approximated:

- `switch`/pattern-matching constructs (UR has none at the language
  level as of this document; if ever added, WASM lowering for it is a
  new, separately-reviewed design decision, not an extension of §1's
  two patterns).
- Irreducible CFGs (a CFG with no single dominating entry into a loop —
  cannot occur from this compiler's own Lowering, per `CFG_SPEC.md`,
  but checked for explicitly rather than assumed impossible at runtime).
- Multi-entry loops (a loop reachable via more than one distinct entry
  block — likewise never produced by Lowering, but checked for).
- Exception edges / non-local control transfer (UR has no exceptions or
  equivalent as of this document).
- Computed `goto` or any indirect branch target (UR's IR only ever
  contains `branch`/`cond_branch` to statically-known block ids — this
  can never arise, but is listed for completeness).

Encountering any of these is expected to indicate either a Lowering bug
(producing a CFG shape the frontend was never supposed to) or a future
language feature that hasn't had its own WASM-lowering design decision
made yet — never a case for the Backend to guess at.

## 1.2 Diagnostic Codes (ratified — replaces generic error messages)

Every rejection this Backend can produce uses one of these codes,
matching the pattern already established by `TCODES`
(`type-diagnostics.ts`) and `CODEGEN_CODES` (Lowering's own diagnostic
catalog) — never an ad hoc string:

| Code | Meaning | Example trigger |
|---|---|---|
| `WASM1001` | Unsupported IR instruction | An `IRInstruction` kind not yet implemented for the current sub-phase (e.g. `array_load` encountered during 3.1A) |
| `WASM1002` | Unsupported CFG shape | A CFG that doesn't match §1's two recognized patterns (irreducible, multi-entry loop, or any §1.1 case) |
| `WASM1003` | Unsupported aggregate | A struct or array type reaches the Backend before its documented phase (3.1B for arrays, 3.1C for structs) |
| `WASM1004` | Unsupported runtime feature | A `call` to a Builtin (`print`/`input`/`free`) or any Runtime-lifecycle-dependent construct reaches the Backend before 3.1C |

Each diagnostic carries the offending `IRFunction`'s `sourceName`, the
specific instruction/block id involved, and the exact reason (which
`IRInstruction.kind` or CFG property was unsupported) — mirroring the
existing `IRInvariantViolation`/`TypeDiagnostic` shape's precedent of
being specific enough to debug without re-deriving the cause by hand.

**No diagnostic in this catalog is ever silently downgraded to a
warning** — every one of them means the Backend refuses to emit
anything for that function, exactly matching the C Backend's own
`CODEGEN_CODES.UNSUPPORTED_CONSTRUCT` precedent (Level 2.1) of failing
loudly rather than guessing.

---

## 2. Phase 3.1A Scope (implemented first, independently reviewed before 3.1B)

**Implementation order within 3.1A (revised twice — first per
`IR_LOCAL_PRESENCE_AUDIT.md`, then corrected again after implementing
3.1A.4 revealed `while` cannot be narrowed the same way `if`/`else`
was — see the "Reason for ordering" box below):**

```
3.1A.1  Module/Type/Function/Export/Code sections, return <const>  (CLOSED)
3.1A.2  Integer arithmetic (binop/unop on constants — still straight-line)  (CLOSED)
3.1A.3  Function calls (direct, intra-module — still straight-line)  (CLOSED)
3.1A.4  if/else, Invariant 3.1A.4 (both branches return, no merge)  (CLOSED —
        confirmed NOT to require Local Variables, unlike while below)
3.1A.5  Local Variables (moved back ahead of while — see box below)
3.1A.6  while (plain loop only — no break/continue, per further scope
        narrowing discovered while drawing while's own CFG; see §6)
3.1A.6b break/continue (deferred follow-up — introduces a nested-if-
        inside-loop shape, meaningfully more complex than plain while)
```

`IR_LOCAL_PRESENCE_AUDIT.md` originally found that no straight-line UR
program produces a slot-backed local, only `if`/`while` can — leading
to an initial reordering placing both `if` and `while` before Local
Variables. **3.1A.4's implementation confirmed this holds for `if`,
narrowed to the "both branches return, no merge" shape (Invariant
3.1A.4) — this shape genuinely needs zero locals.** But drawing `while`'s
CFG the same way (before writing any code, per the same discipline)
found that **every genuine repetition** (the loop body executing more
than once, requiring an actual back-edge) needs a variable that changes
across iterations — and Lowering's `promoteToSlot()` always slot-backs
such a variable. The one shape that avoids this (`while <const-cond>
{ break }`) was checked directly and found to produce **zero natural
loops** (`ControlFlowAnalysis.naturalLoops.length === 0`) — it degrades
to an `if`-like shape with no actual back edge, meaning it would not
exercise WASM's `loop`/`br` instructions at all. Unlike `if`, there is
no narrower-but-still-meaningful slice of `while` available.

> ### ⚠️ Reason for ordering (ratified, per explicit review — record this precisely)
>
> **Local Variables precede `while` because of the CURRENT LOWERING
> STRATEGY, not because of any WebAssembly limitation.** WASM's `loop`
> instruction has no objection whatsoever to loop-body-mutated state —
> nothing about WASM itself requires locals to exist "first." The
> dependency is entirely a property of how `lower-to-ir.ts` currently
> represents mutable state (the Local Slot model, `CFG_SPEC.md` §1),
> which happens to make Local Variables and loop-crossing mutation the
> same underlying mechanism. If Lowering's strategy ever changes (e.g.
> a future SSA-with-phi-nodes redesign), this ordering constraint could
> change with it — it is a fact about this codebase's current
> implementation, not a permanent architectural truth about WASM or
> about UR. Recorded here explicitly so no future reader mistakenly
> concludes "WebAssembly requires locals before loops."

### 2.1 The Expression Tree Property (ratified — replaces the informal "no value reuse" phrasing)

**3.1A.2 supports Expression Trees only — never a DAG (directed
acyclic graph with fan-out).** This is stated as a precise, checkable
mathematical property, per explicit review request, rather than the
informal "values aren't reused" phrasing that a future reader could
reinterpret differently:

> **Property**: for every instruction-defined SSA value `v` in the
> function, `v` appears as an operand (directly or via the terminator's
> return value) **at most once** across the entire function body.
> Equivalently: the def-use graph, restricted to this function, is a
> tree (every node has in-degree ≤ 1 from the "used by" relation,
> i.e. **fan-out ≤ 1** per defined value) — never a DAG, where a single
> definition would feed two or more separate uses.

**Why this matters beyond phrasing**: WASM is a stack machine — a
value pushed and popped is gone; reusing it requires either a `local`
(holding it for a second push) or `local.tee` (duplicating it onto the
stack while also storing it). Since Local Variables are deferred to
3.1A.6 (§2's revised order, per the audit), **no mechanism to hold a
value for reuse exists yet in this emitter** — the Expression Tree
property is not an arbitrary restriction chosen for convenience; it is
exactly the class of program this emitter can correctly lower without
that mechanism. A DAG-shaped def-use graph is the precise boundary
where a WASM local becomes structurally necessary, not merely
convenient — which is why 3.1A.2 stops exactly there.

**Checked directly, not inferred**: the emitter computes a use-count
per SSA id (including the terminator's own use of the returned value)
and rejects the function if any count exceeds 1, with a diagnostic
naming the specific id and its use count.

**⚠️ TEMPORARY PHASE CONSTRAINT — NOT a permanent WASM Backend
property (ratified, per explicit review):** the Expression Tree
Property applies **only** while Local Variables remain unimplemented
(i.e., throughout 3.1A.2 through 3.1A.5). It is a direct, temporary
consequence of not yet having a WASM local to hold a reused value —
**not** a permanent design principle of this Backend, and **not**
something a future contributor should treat as load-bearing beyond this
window. At **3.1A.6 (Local Variables)**, this constraint must be
**relaxed, not merely kept alongside new local-variable support**: once
a WASM local exists to hold a value for reuse, a DAG-shaped def-use
graph becomes lowerable (assign the shared value to a local, `local.get`
it at each use site instead of re-deriving it), and the fan-out ≤ 1
restriction should be lifted for exactly the cases a local now covers.
§2.2 records a Migration Test for this transition — a test that is
currently expected to assert rejection, and is expected to **flip to
acceptance** once 3.1A.6 lands, serving as an explicit checklist item
so this relaxation is never forgotten.

### 2.2 Migration Test (recorded now, per review — a forward-looking checklist item)

`tests/backend/wasm/emit-wasm.test.ts` contains a test explicitly
labeled as a **Migration Test**, asserting today that `let a = 2 + 3;
return a + a` is rejected (fan-out 2) — and containing an explicit
comment stating that once 3.1A.6 (Local Variables) is implemented, this
exact test's assertion must be inverted (rejection → acceptance, using
a WASM local internally). This is not merely documentation of intent;
it is a live, currently-passing test whose own comment makes its future
obsolescence impossible to overlook — whoever implements 3.1A.6 will
either update this test correctly or leave a stale comment contradicting
a test that still asserts the old behavior, both of which are far more
visible than a forgotten prose note in this document alone.

**In scope (grouped by kind — the ordering above governs build sequence):**
- `i64` arithmetic (`add`/`sub`/`mul`/`div`/`mod`), comparisons
  (`eq`/`neq`/`lt`/`lte`/`gt`/`gte`), `neg`/`not`.
- Local variables (`IRLocalSlot` → WASM locals — direct mapping, no
  memory needed for scalars, matching the C Backend's own `slot_name`
  → plain variable simplicity).
- `if`/`else` (§1's first pattern).
- `while`/`break`/`continue` (§1's second pattern).
- Function calls (direct, intra-module — `call` instruction, by WASM
  function index).
- `return`/`return_void`.

**Explicitly NOT in scope for 3.1A** (deferred to 3.1B/3.1C):
- `f64` (floats) — deferred only to keep 3.1A's first review minimal;
  trivial to add once integers are proven (WASM has a parallel `f64.*`
  instruction set mirroring `i32`/`i64.*` almost exactly).
- Arrays (`array_load`/`array_store`) — needs WASM linear memory (§6).
- Structs — needs the same flattened-field-slots treatment already
  proven for the C Backend (Level 2.8), extended to WASM locals; no new
  design risk, but deferred to keep 3.1A minimal.
- `print`/`input`/`free` (Builtins) — needs WASM imports (§8, deferred
  to 3.1C).
- Runtime lifecycle (`ur_runtime_init`/`shutdown`) — needs imports too
  (§8).

### 2.3 Call Graph Cycle Detection: WASM-scoped, not `shared/` (decided, per explicit review question)

3.1A.3's recursion rejection (`src/backend/wasm/call-graph.ts`) is kept
WASM-scoped, not extracted to `shared/`. Reasoning: this rejection is a
**temporary 3.1A.3 bootstrapping limitation**, not a permanent WASM
property or a general backend concern — WASM's own instruction set has
no objection to recursive calls; only this specific sub-phase hasn't
yet decided how to handle the stack-depth/growth questions recursion
raises for WASM. The C Backend (frozen since Level 2.1) has never
needed this check and never will (`FUNCTIONS_ABI_SPEC.md`: recursion
depth is explicitly delegated to the host C stack). A future LLVM
backend would very likely make the same choice. Extracting a `shared/`
module now would imply every backend needs this check, which is false.
Per this project's standing YAGNI discipline (the Dataflow Framework
itself was only generalized once DCE needed it, not speculatively
beforehand): if a genuine cross-backend need for call-graph analysis
ever arises, that becomes its own, separately-reviewed extraction
decision at that time.

## 3. Phase 3.1B Scope (after 3.1A is reviewed and frozen)

- WASM linear memory (`memory` section) for arrays.
- `array_load`/`array_store` → `i32.load`/`i32.store` (or `i64.*` for
  `i64`-element arrays) at a computed linear-memory offset.
- Bounds checking: **reuses the exact same design as the C Backend**
  (`LANGUAGE_SYNTAX_1_1_SPEC.md` §1.5) — an explicit comparison against
  the array's known length, branching to a trap (`unreachable`
  instruction — WASM's built-in, always-available panic primitive) on
  out-of-bounds access, rather than calling into `ur_panic` (deferred
  to 3.1C, since it requires the Runtime import).

## 4. `if`/`else` Lowering (Phase 3.1A.4 — ratified scope, per review)

**Comparison operators (`==`/`!=`/`<`/`<=`/`>`/`>=`) are a DEPENDENCY of
this item, not a separate milestone.** They exist solely to produce the
boolean condition `if` consumes — there is no standalone "comparisons"
sub-phase. Each maps directly to WASM's own `i64.eq`/`i64.ne`/`i64.lt_s`/
`i64.le_s`/`i64.gt_s`/`i64.ge_s` (each producing an `i32`, exactly what
WASM's `if` instruction expects as its condition — confirmed by direct
hand-built-module testing before implementation began, not assumed).

### Invariant 3.1A.4 (ratified, per review — mandatory, checked directly)

> **Every accepted `if`/`else` must terminate BOTH branches via
> `return`.** `then -> return`, `else -> return`. **No merge block is
> ever allowed.** Any program whose `if`/`else` does not fit this exact
> shape — most notably the case where a variable is assigned
> differently in each branch and used *after* the merge (requiring a
> Local Slot, `load`/`store`) — MUST be rejected with a WASM1002
> diagnostic. Never silently accepted, never approximated.

This is not an implementation convenience; it is the precise boundary
discovered by direct CFG inspection before any code was written: an
`if`/`else` where both branches return produces exactly 3 blocks
(entry, then, else) with **no merge block at all** — Lowering's own
"unreachable merge correctly omitted" rule (`CFG_SPEC.md`) means the
merge block Lowering would otherwise create is never even generated.
Any *other* shape (a live merge) necessarily introduces `load`/`store`
— out of scope until 3.1A.6 (`IR_LOCAL_PRESENCE_AUDIT.md`).

```wat
;; UR: if cond then return A else return B end  (ONLY this exact shape)
(if (result i64) (<lower cond, a comparison>)
  (then (return (<lower A>)))
  (else (return (<lower B>))))
(i64.const 0)   ;; unreachable fallback — required only so the
(return)        ;; function's own final expression still type-checks;
                ;; both real branches already returned before this point.
```

### Explicitly OUT of scope for 3.1A.4 (a fixed list, per review — not a starting point for gradual expansion)

- Merge blocks / any value crossing the merge point (Local Slots — 3.1A.6).
- Nested `if` (an `if` inside another `if`'s branch).
- Short-circuit evaluation.
- Logical operators (`&&`/`||`).
- `select` (WASM's ternary-like instruction) — not needed since this
  scope never produces a value-merging pattern that would use it.
- Loops of any kind (3.1A.5).

## 5. Local Variables (Phase 3.1A.5 — moved ahead of `while`, per the "Reason for ordering" box in §2)

Each `IRLocalSlot` (scalar, non-array) maps directly to one WASM local
(`local.get`/`local.set`), declared in the function body's local
vector. This is a simpler mapping than the C Backend's own `slot_name`
convention — WASM locals are already index-addressed, requiring no
name-mangling concern at all.

**Ratified scope (per review): exactly the "Diamond + Merge" CFG shape
3.1A.4 rejected — now legitimate, because a real WASM local exists to
hold the value crossing the merge point.** Confirmed viable by direct
hand-built-module testing before implementation began: WASM's `if`/`else`
falls through naturally to whatever follows once an arm completes (when
neither arm returns early) — **no `block`/`br`/`br_if` is needed at all**
for this specific shape:

```wat
(local $x i64)
(local.set $x (i64.const 0))
(if (<condition>)
  (then (local.set $x (i64.const 10)))
  (else (local.set $x (i64.const 20))))
(local.get $x)   ;; the merge point — nothing more than "whatever comes after the if/else"
(return)
```

### Invariant 3.1A.5 (ratified, per review — mandatory, checked directly)

> **Exactly one merge point is allowed per function, and it must
> immediately follow the structured `if`/`else` — no nested merge, no
> secondary merge.** Concretely: exactly 4 blocks (entry, then, else,
> merge); `then`/`else` each terminate via `branch` to the SAME single
> merge block (never a `return`, never a branch to a third/different
> block); the merge block terminates via `return`. Any other shape —
> more than one merge point, a merge nested inside another merge, a
> `while`, `print`/any Builtin call anywhere in the function (a Builtin
> is an unresolved call from this Backend's perspective, rejected via
> the existing WASM1004 check, not a new one) — MUST be rejected with a
> WASM1002/WASM1004 diagnostic. Never silently accepted, never
> approximated.
>
> **MERGE_IMMEDIATE_RETURN_CONTRACT (ratified, per review, added after
> a real gap was found and closed): the merge block may only READ the
> crossed value and return it — it must contain NO `store` at all.** A
> program like `if(...) x=10 else x=20 end; x=30; return x` was found
> to compute a mathematically correct answer (WASM produces `30`,
> matching real UR semantics) while still being emitted by an earlier
> draft of this sub-phase's implementation — but this is deliberately
> OUT OF SCOPE: "merge point immediately followed by return" means
> exactly that, not "eventually followed by return after further
> statements." Any `store` found in the merge block MUST be rejected
> with WASM1002, even though the resulting computation would have been
> correct.

**TODO (per review, revisit when general call-arguments support is
added in a future sub-phase):** the current WASM1001 "calls with
arguments are not supported yet" diagnostic conflates two distinct
situations — "this call has arguments, not supported YET" vs. "this
specific callee (e.g. `print`, a Builtin) is fundamentally out of
scope regardless of arguments." Once calls-with-arguments are
supported generally, a call to an ordinary UR function with arguments
should succeed, but a call to `print` must still fail — and at that
point it should fail via a message naming `print`/Builtins
specifically (ideally WASM1004), not this generic message, which would
then be actively misleading.

## 6. `while` Lowering (Phase 3.1A.6 — plain loop only; `break`/`continue` deferred to 3.1A.6b)

**Confirmed CFG shape (drawn before any code, matching every prior
sub-phase's discipline)**: exactly 4 blocks — `entry` (initializes any
locals, branches to `loop_header`), `loop_header` (loads the loop
variable, computes the condition, `cond_branch` to `loop_body`/
`loop_exit`), `loop_body` (the loop's statements, ending in `branch`
back to `loop_header` — the back edge, detected by the existing,
reused `ControlFlowAnalysis.naturalLoops`), `loop_exit` (reads the
final value, `return`s).

```wat
;; UR: while cond body end
(block $exit                 ;; break -> br $exit (depth 1 from inside loop_body)
  (loop $continue             ;; continue -> br $continue (depth 0; re-checks cond)
    (br_if $exit (i32.eqz <lower cond>))
    <lower body>
    (br $continue)))
```

This directly mirrors `CFG_SPEC.md` §4's `entry → loop_header →
loop_body → loop_header (back edge) → loop_exit` shape — `$continue`
plays the loop_header role, `$exit` plays the loop_exit role. `break`
compiles to `br $exit` (branch depth 1, the enclosing `block`);
`continue` compiles to `br $continue` (branch depth 0, the `loop`
itself) — exactly matching Level 2.6's own `OPTIMIZER_SPEC`-adjacent
design (`break` targets the loop's exit, `continue` targets its
header, never the body) with zero new design decisions needed.

**Confirmed by direct hand-built-module testing before implementation
began**: a plain counting loop (`while i < 5 { i = i + 1 }`, expecting
`5`), and a loop with an explicit `break` (`while i < 100 { if i == 3
{ break }; i = i + 1 }`, expecting `3`) — both executed correctly.

**A real bug was found and fixed during this design-phase verification
— in the throwaway Python verification helper, NOT in this project's
actual TypeScript `encodeSLEB128` (`src/backend/wasm/leb128.ts`,
already separately tested and correct)**: an early version of the
verification script's ad-hoc LEB128 encoder was UNSIGNED, which
coincides with signed LEB128 for small values but diverges for values
≥ 64 (whose 7th bit, the sign bit in signed LEB128, becomes set) — a
loop bound of `100` was misinterpreted by WASM's runtime as a large
negative number, causing the loop to exit on its very first check.
Switching the verification script to a correct signed encoder
(matching what `encodeSLEB128` already correctly does) resolved it
immediately, confirming the WASM structure design itself was correct
throughout — recorded here as a caution for any future ad-hoc
verification tooling, not as a defect in the shipped implementation.

### Invariant 3.1A.6 (ratified — mandatory, checked directly)

**Scope narrowed further, per this project's established discipline
(matching every prior sub-phase's pattern of narrowing when complexity
emerges): 3.1A.6 covers the PLAIN `while` loop only — no `break`, no
`continue`.** Drawing the CFG for `while` with a `break` found a
7-block shape (`entry, loop_header, loop_body, then, else, merge,
loop_exit` — an `if` nested inside the loop body, itself needing
Invariant 3.1A.4/3.1A.5's own machinery composed with the loop), a
meaningfully larger and more complex shape than the plain 4-block loop.
`break`/`continue` are deferred to a follow-up item (3.1A.6b), not
bundled into this one.

> Exactly 4 blocks: `entry`, `loop_header`, `loop_body`, `loop_exit`.
> `entry` terminates via `branch` to `loop_header`. `loop_header`
> terminates via `cond_branch` to `loop_body`/`loop_exit`, with the
> condition a genuine comparison (matching Invariant 3.1A.4/3.1A.5's
> identical requirement). `loop_body` contains ONLY straight-line
> instructions (`const`/`binop`/`call`/`load`/`store` — no nested `if`)
> and terminates via a plain `branch` back to `loop_header` —
> confirmed to be the natural loop's back edge via the existing,
> reused `ControlFlowAnalysis.naturalLoops` (never re-implemented).
> `loop_exit` terminates via `return`. Any other shape (a `break`/
> `continue` introducing a nested `if` inside `loop_body`, nested
> loops, `while` inside `if`, multiple back edges) MUST be rejected
> with WASM1002, never approximated.

> **WHILE_NO_BRANCH_EXIT_CONTRACT (ratified, per review — a permanent,
> separately-named guard, not merely documentation): `loop_body` must
> contain NO early-exit branch of any kind — no `break`, no
> `continue`, no other path out of the loop body besides falling
> through to the back-edge `branch`.** This is enforced as its own
> checked property (`loopBody.terminator.kind !== "branch"` triggers
> rejection), not merely implied by the 4-block count, so that a
> future partial/accidental introduction of `break` support during an
> unrelated change cannot silently slip through by preserving the
> block count while changing `loop_body`'s internal shape.
>
> **Reason for this restriction (ratified, per review — record this
> precisely, mirroring §2's identical "Reason for ordering" box):
> `break`/`continue` are deferred because of the CFG SHAPE they
> introduce (a nested `if` inside `loop_body`, composing Invariant
> 3.1A.4's own machinery with the loop) requiring its own
> separately-reviewed sub-phase (3.1A.6b) — this is a DELIBERATE SCOPE
> NARROWING of THIS batch, not a WebAssembly limitation.** WASM's own
> `br`/`br_if` instructions have no objection whatsoever to branching
> out of a loop body early; nothing about WASM itself prevents
> `break`/`continue` from being expressed. If a future reader sees this
> rejection, they should understand it as "this sub-phase hasn't
> implemented it yet," never as "WASM cannot express this."

## 6b. `break` Lowering (Phase 3.1A.6b — `continue` further deferred, per a second CFG-driven scope narrowing)

**A structural discovery, made by drawing `break`'s and `continue`'s
CFGs separately (per review's explicit instruction) before any code:
`break` and `continue` are NOT structurally symmetric, despite both
looking like simple one-word statements in UR source.**

| | Blocks | Back edges into `loop_header` |
|---|---|---|
| `break` | 7 (`entry, loop_header, loop_body, then, else, merge, loop_exit`) | **1** (from `merge` only) |
| `continue` | 7 (same block roles) | **2** (`then` branches DIRECTLY to `loop_header` — an extra back edge — AND `merge` still branches back too) |

`break`'s `then` branch targets `loop_exit` (not looping back at all);
`continue`'s `then` branch targets `loop_header` DIRECTLY, creating a
second, distinct back edge the existing `ControlFlowAnalysis` reports
as **two separate natural-loop entries for the same header** — a
genuinely more complex shape than `break`'s single back edge.

**Scope narrowed further** (matching this project's established
pattern, now applied a third time within `while` alone): **3.1A.6b
implements `break` only.** `continue` (multiple back edges into the
same header) is deferred to **3.1A.6c**, a separately-reviewed item.

**Confirmed WASM design, per direct hand-built-module testing before
implementation began**: `while i < 100 { if i == 3 { break }; i = i +
1 }` — a plain WASM `if` with ONLY a `then` arm (`br 2`, skipping the
`if` itself at depth 0, the `loop` at depth 1, reaching the enclosing
`block` at depth 2) and no `else` at all (the false path falls through
naturally, exactly matching how UR's own `if ... end` with no `else`
lowers to an empty `else` block in the IR) — validated and executed
correctly (`main() = 3`, matching the exact point `break` fires).

### Invariant 3.1A.6b (ratified — mandatory, checked directly)

> `loop_body` may contain, as its FINAL two elements before the
> back-edge branch, exactly one `if`-shaped sub-structure whose `then`
> branches DIRECTLY to `loop_exit` (a `break`) and whose `else` branches
> to a `merge` block that itself branches back to `loop_header`
> unconditionally, containing no additional statements beyond what
> `loop_body` would otherwise have contained straight-line. **`continue`
> (a `then` branching directly to `loop_header`, creating a second back
> edge) is explicitly rejected** — WASM1002, not approximated — and
> deferred to 3.1A.6c. Nested `if` beyond this one recognized shape,
> nested loops, and multiple `break`s are also rejected.

## 6c. `continue` Lowering (Phase 3.1A.6c)

**Informed directly by `CONTINUE_CFG_ANALYSIS.md`** (written before this
section, per review): `continue`'s `then` branches directly to
`loop_header` (not `loop_exit`, `break`'s target) — the single
structural fact that changes both the CFG shape recognized and the
WASM branch depth required.

**Confirmed WASM design, per direct hand-built-module testing before
implementation began** (mirroring exactly the same rigor already
applied to `break`, 3.1A.6b): `while i < 10 { i = i + 1; if i == 5 {
continue }; total = total + i }` (expected: sum of 1..10 excluding 5,
i.e. `50`):

- **`br 1`** (not `br 2`) from inside the nested `if`'s `then` branch —
  targeting the enclosing `loop` (depth 1: `if`=0, `loop`=1), NOT the
  outer `block` (depth 2, `break`'s target) — executed correctly,
  producing `50`, confirmed to **match the C Backend's real compiled
  execution of the identical program exactly** (`50 = 50`).
- **`br 2`** (the wrong depth, `break`'s own target) was deliberately
  tested too: **still produces a syntactically VALID WASM module**
  (`WebAssembly.validate()` returns `true`) but computes `10` instead
  of `50` — a silent logic error (the loop exits early at `i == 5`
  instead of skipping just that iteration), exactly mirroring the
  identical `br 2`-vs-`br 1` finding already proven for `break`. This
  confirms the Golden Test for this shape must specifically catch a
  *behavioral*, not merely structural, regression — matching
  `break`'s own Golden Test precedent (§ CHANGELOG, `level3-1A-6b-break`
  batch).

### Invariant 3.1A.6c (ratified — mandatory, checked directly)

> `loop_body` may contain exactly one `if`-shaped sub-structure whose
> `then` branches DIRECTLY to `loop_header` (a `continue`) and whose
> `else` branches to a `merge` block that itself branches back to
> `loop_header` unconditionally — the exact mirror image of Invariant
> 3.1A.6b's `break` shape, with `then`'s target being the sole
> distinguishing fact (checked explicitly, per `CONTINUE_CFG_ANALYSIS.md`
> §2). `break` (a `then` branching to `loop_exit`) remains supported
> independently (3.1A.6b, unchanged); a loop containing BOTH a `break`
> and a `continue` check is explicitly OUT of scope for this batch —
> deferred to a further sub-phase if needed, not assumed as free
> composition. Nested loops, multiple `continue` checks in one body,
> and any other shape MUST be rejected with WASM1002.

## 7. Verification Methodology (proven viable, per direct testing)

**Node.js's built-in `WebAssembly` global** (present in this
environment's Node v22.22.2, zero installation) provides the exact two
capabilities this project's "real verification" standard requires:

- **`WebAssembly.validate(bytes)`** — real structural/type validation,
  the WASM equivalent of `opt -verify` for LLVM or `gcc`'s own parse
  step for the C Backend.
- **`WebAssembly.instantiate(bytes)`** — real execution, returning
  real exported function results — the WASM equivalent of running a
  compiled executable and checking its exit code/stdout.

**Both were directly tested before this document was written**, not
assumed: a minimal module (`main() -> 42`) and a more complex one
(a real `loop`/locals/`br_if` pattern computing `sum(0..4) = 10`, the
*exact* shape §5 describes) were hand-encoded, validated, and executed
successfully.

**A real, hard-won lesson from that direct testing, recorded here
because it will otherwise cause real bugs**: **every WASM section and
function-body size must be computed programmatically from the actual
emitted byte sequence — never pre-calculated by hand and hardcoded.**
The first hand-encoding attempt during this document's preparation
failed validation (`section extends past end of module`) specifically
because a size was hand-computed and wrong; the fix was computing it
from `bytes.length` after the fact, via LEB128 encoding. The
implementation must follow the same discipline: build the byte
sequence first, measure it, *then* prepend its LEB128-encoded length —
symmetrical to how `emit-c.ts` never manually tracks C source string
lengths either, just in a domain where getting it wrong doesn't merely
look ugly, it produces a real, `WebAssembly.validate()`-rejected module.

**Golden Tests, per this project's established pattern**: comparable to
`tests/codegen/golden/`, but for WASM bytes — likely stored as a
readable disassembly-equivalent (a manually-maintained `.wat`-like text
description generated by the Backend for debugging, since no
`wasm2wat` tool exists in this environment either — see §10) rather than
raw binary golden files, which would be unreviewable by a human.

**E2E, per this project's established pattern**: compile a UR program
to WASM bytes, `WebAssembly.validate()` them, `WebAssembly.instantiate()`
them, call the exported `main`, and compare the result against the
exact same program's C-Backend-compiled-and-executed result — this
comparison is not merely one E2E technique among several; it is
formalized as this Backend's actual success criterion in §8.

## 8. Backend Correctness (the actual success criterion — per explicit review priority)

**`WebAssembly.validate()` returning `true` and `WebAssembly.instantiate()`
completing without throwing are necessary but explicitly NOT
sufficient.** A WASM module can be perfectly valid and perfectly
executable while still computing the wrong answer — validity is a
syntax/type-safety property, not a correctness property. The actual
success criterion for this Backend is **behavioral equivalence with
the already-frozen, already-trusted C Backend**, for every program
tested:

```
UR source
    ↓
IR (Lowering — shared, identical for both backends)
    ↓                                    ↓
C Backend                          WASM Backend
    ↓                                    ↓
gcc compile + real execution       WebAssembly.validate()
    ↓                              + WebAssembly.instantiate()
Result A (exit code, stdout)       Result B (exit code, stdout)
    ↓                                    ↓
    └──────────── Result A == Result B ──────────────┘
```

**This comparison — not `validate()`/`instantiate()` succeeding in
isolation — is what every Golden Test, E2E test, stress test, and fuzz
test for this Backend must assert**, mirroring exactly how Level 2.9's
Optimizer proved correctness by comparing pre-/post-optimization
behavior (`OPTIMIZER_SPEC.md` §7) rather than trusting structural
validity alone. Concretely:

- Every 3.1A E2E test compiles the SAME `IRFunction` through both
  backends and asserts identical exit codes (Phase 3.1A has no I/O, so
  exit code is the only observable in scope; stdout comparison becomes
  relevant starting at 3.1C once `print` exists for WASM).
  Given both backends receive the byte-for-byte-identical `IRFunction` — the
  same guarantee that already lets Level 2.9's Optimizer run ahead of
  either Backend unmodified — any divergence is attributable to a bug
  in exactly one Backend's *emission* logic, not to any upstream
  difference in what program was actually compiled.
- The Fuzz Test methodology already proven for the Optimizer
  (`tests/optimizer/fuzz.test.ts`, deterministic seeded generation) is
  directly reusable here: the same randomly-generated valid UR programs
  can be run through *both* backends instead of just baseline-vs-
  optimized, checking `resultA === resultB` instead of `baseline ===
  optimized`.
- A Backend Validation Suite (Level 3.3, per the restructured roadmap)
  formalizes this at the whole-suite scale — every existing E2E program
  from every prior phase (Level 2.4–2.9) re-run through the WASM
  Backend once it exists, compared against that same program's
  already-recorded C Backend result.

## 9. Runtime Integration (Phase 3.1C — not decided in detail here)

`print`/`input`/`free` and the Runtime lifecycle functions
(`ur_runtime_init`/`shutdown`) cannot be native WASM instructions (WASM
has no I/O or heap-allocation instructions) — they must be **WASM
imports**, supplied by whatever JS host instantiates the module (in
this environment, that host is the same Node.js test/E2E harness that
already calls `WebAssembly.instantiate()`). This means, for Phase 3.1C:

- Every Runtime Core function needs a **JS-side implementation**
  (e.g. `ur_print_int` → a JS function writing to `process.stdout`),
  supplied via `WebAssembly.instantiate(bytes, { env: { ur_print_int:
  ..., ... } })`.
- This is a **parallel, second Runtime implementation** (JS, not C) —
  not a reuse of `runtime/ur_runtime.c`. The two must be kept
  behaviorally identical (same `RUNTIME_SPEC.md` contract), verified by
  the same E2E-comparison methodology as §7's Backend Validation Suite.
- This entire question is explicitly deferred to Phase 3.1C's own
  review — recorded here only so 3.1A's design doesn't accidentally
  paint this into a corner.

## 10. What This Document Does NOT Decide

- The exact byte-level WASM binary emitter's internal code structure
  (mirrors `emit-c.ts`'s role, but is not designed here).
- How `if`/`else` merge-point values interact with WASM's own
  multi-value result capability vs. reusing the Local Slot model as-is
  (§4's open question).
- The Golden Test format for WASM bytes in detail (§7 sketches the
  direction; not finalized).
- Phase 3.1B's exact memory layout (array base addresses, alignment)
  and Phase 3.1C's exact JS-side Runtime implementation — both deferred
  to their own phase's review, per the one-item-at-a-time discipline
  already established for the Optimizer.
- Whether/how UR's own Level 2.9 Optimizer (Constant Folding, DCE) runs
  before WASM emission — presumably yes, unchanged, since it operates
  on the same frozen `IRFunction` regardless of which Backend consumes
  the result afterward; not re-decided here since Level 2.9's own
  freeze already establishes this independence.

## 11. Compatibility

This specification assumes, and is written against, the frozen state
at: `v27-level2-9-optimizer` (Dominator Tree/CFA reused directly, per
§1), `v27-level2-8-aggregates` (arrays/structs — Phase 3.1B/a future
phase), `v27-level2-6-control-flow` (the CFG/Loop model §1 depends on
being exactly what it already is), and `v27-level2-4-runtime-core`
(`RUNTIME_SPEC.md`'s contract, which §8's JS-side reimplementation must
match behaviorally). If any of these are ever revised, this document
should be re-reviewed. This document does **not** depend on, and is
entirely independent of, `LLVM_ENVIRONMENT_REQUIREMENTS.md`'s blocked
status — the two Backends share only the frozen IR upstream of both.
