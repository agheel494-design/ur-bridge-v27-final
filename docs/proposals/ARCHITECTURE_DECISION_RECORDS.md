# ARCHITECTURE_DECISION_RECORDS.md

**Purpose**: a standing, numbered log above the PR Merge Gate. Every
future architectural decision gets a new, sequential ADR entry
answering the five fields below — so that a year or two from now, the
project can recover *why* a decision was made, not only *what* it
was.

**Format for every entry**:
- **Problem**
- **Alternatives considered**
- **Why this solution was chosen**
- **Effect on the Baseline**
- **Commit that implemented it**

---

## ADR-001: Array Semantic Model

- **Problem**: `int[]`'s semantic model (what entity `a` represents
  when a function receives it) was undecided by the evidence
  available at the time.
- **Alternatives considered**: Full Value Copy, Borrow, Handle,
  Reference.
- **Why this solution was chosen**: Full Value Copy contradicted
  existing evidence and efficiency goals; Borrow requires a
  lifetime/borrow-checking system that does not exist in UR today;
  Handle requires a runtime object-management system that also does
  not exist today; Reference is the only option consistent with UR's
  current architecture without introducing a new subsystem.
- **Effect on the Baseline**: established as Part 1, Q1 — the
  foundation every later Invariant, Decision, and Structural Unit in
  this document derives from.
- **Commit that implemented it**: recorded in
  `ARRAY_PARAMETER_SEMANTICS_BASELINE.md`'s own Part 1 (documentation
  only; no code commit corresponds to this record, since it is a pure
  language-semantics decision).

## ADR-002: IR Ontology Decision 1 — May the IR Contain Pre-Object Entities?

- **Problem**: whether the IR is permitted to represent a
  transitional, not-yet-an-Object entity before the formal Object
  Definition's conditions are satisfied.
- **Alternatives considered**: No (first representation must already
  be a complete `Object`); Yes (transitional entities permitted,
  never treated as `Object`); Deferred (left open until a real use
  case requires it).
- **Why this solution was chosen (No)**: consistency with the
  already-established Object Definition; ontology simplicity (exactly
  two entity kinds, no third transitional category); consistency with
  existing Invariants (no "incomplete Object" exception needed);
  prevents complexity spread (a Descriptor would raise unnecessary
  cascading questions about conversion, identity, Validation scope,
  and IR-visibility).
- **Effect on the Baseline**: produced the binding constraint "Every
  entity represented as an Array `Object` in the IR SHALL already
  satisfy the complete Object Definition" — ruling out 2 of the 4
  original candidates for where/when an `Object` may first exist.
- **Commit that implemented it**: recorded in
  `ARRAY_PARAMETER_SEMANTICS_BASELINE.md` (documentation only).

## ADR-003: IR Readiness Point for the Resolved Semantic Subset

- **Problem**: at what compilation stage are all Object Definition
  requirements (Identity, Length, Element Type) simultaneously
  available?
- **Alternatives considered**: creation at the point of construction;
  creation after argument binding at function entry (both are
  Runtime/Lowering-level timing choices remaining after ADR-002 ruled
  out intermediate-entity candidates).
- **Why this solution was chosen**: direct evidence from the real,
  already-existing v2 implementation
  (`array-object-model-builder.ts`) shows Length is known only at the
  `ArrayLiteral` construction expression, never before; at function
  entry no new construction occurs, so creation-at-construction is the
  only candidate consistent with the evidence, for the resolved
  subset (literal array construction) this record covers.
- **Effect on the Baseline**: scoped explicitly to the implemented
  subset only — does not resolve the deferred Array Parameters
  question (Defer Log), which remains open pending its own,
  separate resolution.
- **Commit that implemented it**: `4891c53a9f12ba16045705847bf9bfca66420b35`
  (Decision 2 answered), narrowed in scope by
  `2a11f198a6adf2cab3442de86955e76740ef713e`.

---

**Next entry is ADR-004.** Any future architectural decision — including
the eventual resolution of Defer Log Item 1 (Array Parameters) —
receives the next sequential number and must fill in all five fields
before merging, per the PR Merge Gate.

## ADR-004: Object Definition Readiness for Array Arguments (Scenario A vs Scenario B)

- **Problem**: how is `Object Definition` established for arrays
  passed as function arguments? Compares two scenarios: **A**: `let
  a = [1,2,3]; sum(a)`. **B**: `sum([1,2,3])` (no intermediate
  variable).

- **Investigation, real evidence gathered for both scenarios
  independently — no outcome pre-selected**:

  - **AST level (confirmed directly, live)**: parsing `sum([1,2,3])`
    succeeds today; the call's first argument is a real `ArrayLiteral`
    AST node, structurally identical (`kind: "ArrayLiteral"`, same
    `elements` shape) to the one found in `let a = [1,2,3]`'s own
    initializer. There is no AST-level distinction between the two
    positions an `ArrayLiteral` can occupy.
  - **Identity/Length/Element Type availability**: since the
    `ArrayLiteral` node itself is identical in both scenarios, and
    these three properties are intrinsic to that node (not to its
    surrounding syntactic position), all three become available at
    the same event — `ArrayLiteral` evaluation — in both scenarios.
  - **Lowering level (confirmed directly, live)**: Scenario A lowers
    to IR successfully today. Scenario B fails today with `CG1001`:
    `"expression kind 'ArrayLiteral' is not supported in this Level 2
    phase"` — because `ir-builder.ts`'s `lowerExpr` has no general
    case for `ArrayLiteral`; the only existing handling is a special
    case inside `VariableDeclaration` specifically
    (`ir-builder.ts:689`), never reached when the same node appears
    as a call argument instead.

- **Why this solution was chosen**: the readiness point is the
  **same** in both scenarios (`ArrayLiteral` evaluation) — confirmed
  by AST-level evidence, not assumed. Scenario B's current failure is
  a real, disclosed **implementation gap** (a missing general
  `lowerExpr` case for `ArrayLiteral`), not evidence of a different
  architectural readiness point. The two facts are kept explicitly
  separate, per direct instruction: the architecture does not
  distinguish A and B; today's code does, only because the general
  case was never written.

- **Effect on the Baseline**: Defer Log Item 1 (Array Parameters) is
  updated — the real work of resolving it includes writing a general
  `lowerExpr` case for `ArrayLiteral` (closing Scenario B's gap),
  using the same single Object-creation logic already proven for
  Scenario A (§1's own `lowerStructConstruction`-style single-source-
  of-truth pattern is the established precedent to follow, not a new
  invention). This ADR does not itself write that code — it records
  the readiness-point question as resolved (identical in A and B) so
  that implementation may proceed without re-litigating this specific
  question.

- **Commit that implemented it**: this record only (documentation);
  no code commit yet — implementation is the next, separate step per
  the Entry Criteria and PR Merge Gate.

## ADR-005: Array Parameter Length Representation (OPEN — comparison phase, not yet decided)

- **Problem, exactly as posed**: should Array Parameter
  representation in UR-Bridge be based on an `Array Object` entity
  carrying `(ObjectId, Length, ElementType)`, with `length` passed
  across the boundary when needed — instead of the current static
  `Sentinel` (`IRParam.arrayLength = 1`)?

- **What has been proven so far (real, executable evidence — not
  theory)**: three isolated experiments, none touching
  `ir-builder.ts` or `emit-c.ts`:
  1. `experiments/proof_of_representation.ts` — the real v1
     `ArrayObjectModel` + `validateArrayObjectModel` can represent
     `(ObjectId, Length, ElementType)` and preserve them across a
     simulated multi-hop chain without violating Invariants 1/3/4.
  2. `experiments/real_c_abi_experiment.c` — a hand-written
     `(pointer, length)` C signature, compiled with real `gcc`,
     correctly bounds-checks and preserves length across 3 real C
     function call boundaries (`f -> g -> h`).
  3. `experiments/real_lowering_experiment.ts` — the real, untouched
     frontend (`lex`/`parse`/`typeCheck`) and the real, untouched v2
     `buildArrayObjectModelFromProgram` extract a real `length` (`3`)
     from real UR source, which then drives a real `(pointer,
     length)` C emission, compiled and executed for real.

  **This proves the design is executable end-to-end in isolation. It
  does NOT prove it is the best architectural choice** — that
  requires the comparison below.

- **Alternatives to compare, corrected structure per direct
  instruction** — `(C)` is not an independent alternative competing
  with `(A)`; it is a dependent IR-level representation question that
  only makes sense once `(A)`'s own answer (where does `Length`
  actually come from) is established:

  | Option | Its real nature | Evidence status |
  |---|---|---|
  | **(A) `Reference → Object → (pointer, length)`** | Semantic/representational model — the real source of truth for `Length` | Supported by all 3 end-to-end experiments |
  | **(B) `Hidden Length Parameter`** | Boundary-crossing mechanism only — *how* a known `Length` is carried across a call, not *where* it comes from | Has a real, existing `FFI` precedent |
  | **(C) `IRParam` carries `length`** | Internal IR representation of the value once transported — depends entirely on `(A)`/`(B)` already answering where the value originates | Exists today (`Sentinel` only) — the value's real source remains unresolved |
  | **(A) + (B) + (C) together** | Model + transport + internal representation, as one coherent design | Strong candidate, but not yet proven as a coherent whole — the pieces have only been tested in isolation |

- **Refined ADR-005 question, per direct instruction**:

  > Should `Array Object` be the source of truth for `Length`, with
  > `(pointer, length)` as the Boundary representation, and `IRParam`
  > merely the internal representation of the transported value?

  ```
  ArrayObject
      │  Source of Truth
      ▼
   Length
      │
      ▼
  IR Representation
      │
      ▼
  (pointer, length)
      │
      ▼
  C / ABI Boundary
  ```

- **Status: still OPEN — not decided.** The three experiments proved
  the design is executable end-to-end in one specific case. Before
  any decision, further real evidence is required, testing whether
  Invariants hold across:
  1. A single function.
  2. A multi-hop chain (`f → g → h`).
  3. Passing the same array multiple times.
  4. Indirect calls, if supported.
  5. Mutation, if arrays are mutable.
  6. Copy/Move, where applicable.
  7. Bounds Check correctness throughout.
  8. Property-based tests once the above cases hold individually.

  Only if the evidence remains consistent across this list does
  closing ADR-005 become a decision grounded in real experimentation,
  not design preference.

- **Effect on the Baseline**: none yet — this record only opens the
  comparison; no Invariant, Contract, or Defer Log entry is modified
  until a real decision is recorded here.

- **Commit that implemented it**: the three experiment commits cited
  above provide the evidence; no decision commit exists yet.

### Scenario 4 (Indirect Call) — UNSUPPORTED, real capability gap, not an architectural failure

**Real investigation, testing current capability only — not whether
the architecture *should* support it**:

1. `apply(sum, a)` (passing a function name as a value) — real
   `TypeChecker` diagnostic: `"cannot pass fn(Array<Int>) -> Int as
   Int"`. This proves `TypeChecker` **internally** infers a real
   function type for `sum` (for diagnostic purposes) — a genuine,
   existing capability.
2. Real syntax search: `fn: fn(int[]) -> int`, `fn: (int[]) -> int`,
   `fn: Fn<int[], int>` — all three real, plausible function-type
   parameter syntaxes tested directly against the real parser. **All
   three fail at Parser level.** No syntax exists today for a user to
   declare a parameter whose type is a function.

**Classification, per the exact criteria specified**: **UNSUPPORTED**
— not a failure of the `A+B+C` design being evaluated, not a
metadata-loss discovery, not a strict-traceability violation. Recorded
as a real capability gap: `UR` has no first-class function values or
indirect-call syntax today. `apply(fn, a)`-style Array Parameter
propagation through an indirect call **cannot be tested** until this
separate capability exists — this is explicitly **not** grounds to
add it to the language now; per direct instruction, Indirect Call is
not being pulled into scope merely because this evidence-gathering
exercise would benefit from it.

**Effect on ADR-005**: none — Scenario 4 is skipped as inapplicable,
not counted as evidence for or against `A+B+C`. Proceeding to
Scenario 5 (Mutation).

### Scenario 5 (Mutation) — SUPPORTED + PRESERVED, strong evidence for A+B+C

**Real capability confirmed first**: `a[i] = value` is fully
supported — `Parser`+`TypeChecker`+`IR`+`gcc`+real execution all
`PASS` for a real UR program (confirmed live).

**Real experiment, strict traceability maintained** (`experiments/
adr005_evidence_scenario_5_mutation.ts`): a real `ArrayObjectModel`
was extracted (`objectId=1, length=3, elementType=i64`), then, in
isolated experimental C:
- Read before mutation: `a[1]=20` (`objectId=1, length=3`).
- Mutation: `a[1] = 99`.
- Read after mutation: `a[1]=99`, with an explicit check confirming
  `objectId` and `length` are unchanged (`YES`).
- Passed through `f -> g -> h`: identical `objectId=1, length=3` at
  every hop; the mutated value (`99`) is correctly visible at the
  deepest hop.
- Bounds Check after mutation uses the same, unchanged `length=3` —
  correctly panics on a real out-of-bounds read.

**What this proves, precisely**: mutation changes the state/elements
of the entity, but does not redefine the `Array Object` itself, nor
change its structural description — confirming the exact separation
between identity/description and content this Scenario was designed
to test. This is strong, real evidence in favor of `A+B+C`.

**Effect on ADR-005**: still `OPEN` — proceeding to Scenario 6
(Copy/Move).

### Scenario 6 (Copy/Move) — both UNSUPPORTED, but for precisely different reasons

**Real capability investigated first, both cases live-tested**:

**Copy (`let b = a`)**: `Parser` and `TypeChecker` both `PASS`, but
`IR/Lowering` rejects it explicitly: `"'a' is an array — arrays
cannot be used as a plain value... in this Level 2 phase"`.
**Classification: UNSUPPORTED — deliberately rejected.** This is not
a missing capability but a real, existing, intentional language
decision — directly consistent with `Invariant 6` (`Array` is never
copied implicitly, Part 1) already ratified in this Baseline. No new
finding; this scenario confirms consistency with an already-known
rule, rather than producing new evidence.

**Move (`move a`)**: fails immediately — `"unresolved identifier
'move' during IR lowering"`. **Classification: UNSUPPORTED — no such
concept exists.** `UR` has no `move` keyword, no move-semantics
syntax of any form today. This is a genuine capability gap, distinct
in kind from Copy's deliberate rejection — Copy was actively decided
against; Move was never designed at all.

**Neither invented.** No behavior is assumed for either operation.

**Effect on ADR-005**: neither sub-case produces evidence for or
against `A+B+C` — both are inapplicable today, consistent with (Copy)
or orthogonal to (Move) the existing Baseline. Still `OPEN`.
Proceeding to Scenario 7 (Bounds Check evidence summary).

**Clarification, per direct instruction**: Scenario 6's `UNSUPPORTED`
results do not constitute evidence against `A+B+C` — they test the
language's own current capability, not the validity of the proposed
`Array Object` representation. `A+B+C` remains **not yet decided**
(🟡) on this specific point, not rejected, since no existing operation
can currently test the Copy/Move relationship to `A+B+C` at all. This
also surfaces a real observation: `UR` today has an
array-as-object/reference model closer to `Object → reference →
mutation` than a full `Copy`/`Move`/`Borrow`/`Ownership-Transfer`
model — plausibly a deliberate simplicity advantage at this stage,
not a gap requiring immediate closure.

### Scenario 7 (Bounds Check, comprehensive) — SUPPORTED + PRESERVED, strongest evidence yet for A+B+C

**Real capability checked first**: zero-length array (`let a = []`)
is `UNSUPPORTED` today (`TY6002` — element type cannot be determined
without an explicit type annotation, not yet supported) — recorded
as such, not invented.

**Real experiment** (`experiments/adr005_evidence_scenario_7_bounds.ts`),
covering every case requested, all live-confirmed:

| Case | Result |
|---|---|
| `index = 0` | `10` — correct |
| `index = length - 1` (last valid) | `30` — correct |
| `index = length` (one past end) | `PANIC` — correct |
| `index = length + 5` | `PANIC` — correct |
| Mutation (`a[1] = 99`) then read | `99` visible; `index = length` still `PANIC`s using the same, unchanged length |
| `f -> g -> h`, valid index | `30` — correct, matching the direct read |
| `f -> g -> h`, out-of-bounds index | `PANIC` at the deepest hop |
| Repeated passing (loop over all valid indices) | `10, 99, 30` — all correct, reflecting the earlier mutation |
| **A second Object, `objectId=99` (deliberately different), same `length=3`** | Works identically (`300` at index 2, `PANIC` at index 3) — **proves the length used is tied to the Object itself, never derived from or influenced by the `objectId`'s own numeric value** |

Total: 5 real panics, exactly matching the 5 real out-of-bounds cases
constructed.

**Effect on ADR-005**: strongest evidence yet for `A+B+C` — Bounds
Check correctness holds across every index boundary, survives
mutation, survives multi-hop chains, survives repeated passing, and
is confirmed independent of `objectId`'s own value. Still `OPEN`.
Proceeding to Scenario 8 (Property Tests) before any decision.

### Scenario 8 (Property Tests) — ALL PASSED, complete evidence record

**Real, generated, assertion-based tests** (`experiments/
adr005_evidence_scenario_8_property_tests.ts`) — not single fixed
cases, not print-and-eyeball: `16/16` programmatic assertions passed.

**`length = 0` explicitly excluded** — confirmed `UNSUPPORTED` in
Scenario 7 (`TY6002`), a real, documented language limitation, not a
false failure introduced into this test.

Tested across generated lengths `{1, 2, 3, 4, 5}`, each with real
`ArrayObjectModel` extraction from real UR source via the real,
untouched frontend, then real `gcc`-compiled, real-executed C with
1/2/3 real call-boundary hops:

| Property | Result |
|---|---|
| 1. Length Preservation | ✅ extracted length matches the real source across all 5 generated lengths |
| 2. Identity Preservation | ✅ `objectId` is a real, defined value; unchanged across `hop1/hop2/hop3` at every length |
| 3. ElementType Preservation | ✅ consistent throughout (implicit in the real `ArrayObjectModel` extraction holding for every length) |
| 4. Bounds Soundness (`0 ≤ i < n` allowed, `i ≥ n` rejected) | ✅ `i=0`, `i=length-1` correct; `i=length`, `i=length+3` correctly `PANIC`, for every generated length |
| 5. Mutation Invariance | ✅ `a[0]` change visible; `objectId`/`length` unchanged; Bounds Check after mutation still correct |
| 6. Repeated Passing | ✅ same array passed through `hop1/hop2/hop3` agree; passing again produces the identical result — no consumption |
| 7. Boundary Composition | ✅ property holds identically at 1, 2, and 3 real hops, including an out-of-bounds `PANIC` correctly surfacing at the deepest hop |
| 8. Object Independence | ✅ two distinct objects (deliberately different, unrelated `objectId=999999`), same length — mutating one does not affect the other |

**Summary**: `16/16` assertions passed, `0` failures. Every property
requested holds across every generated case, all evidence gathered
without touching `ir-builder.ts` or `emit-c.ts`.

**Full evidence record now complete**:

| Scenario | Result |
|---|---|
| S1 (single function) | ✅ |
| S2 (`f→g→h`) | ✅ |
| S3 (repeated passing) | ✅ |
| S4 (Indirect Call) | 🚫 UNSUPPORTED — not evidence against `A+B+C` |
| S5 (Mutation) | ✅ strong — identity/content separation proven |
| S6 (Copy/Move) | 🟡 both UNSUPPORTED — not evidence against `A+B+C` |
| S7 (Bounds Check, comprehensive) | ✅ strongest single-case evidence |
| S8 (Property Tests) | ✅ `16/16`, generalized across generated lengths |

**ADR-005 status: still `OPEN`.** Per direct instruction, the next
step is writing the full record — `Evidence → Invariants →
Alternatives → Decision → Consequences → Implementation Contract` —
before any real implementation begins.

## ADR-005: FINAL DECISION

**Decision**: adopt `A+B+C` as one coherent architectural unit:

- **A — Array Object as source of truth**: at the semantic level, an
  `Array Object` carries `ObjectId + Length + ElementType`.
- **B — Boundary Representation**: when crossing a call boundary, the
  operational representation is `(pointer, length)`, with room for
  additional metadata to be carried when needed — never treated as an
  independent source of truth.
- **C — `IRParam` as internal representation only**: `IRParam`
  remains an internal representation of the transported value, never
  an independent source of `Length`. The current `arrayLength = 1`
  Sentinel is no longer the source of truth.

**Why this decision is now justified**: not a single prototype, but
the full, real evidence chain — real `Parser → TypeChecker → real
ArrayObjectModel → experimental C → real gcc → real execution`;
`ObjectId + Length + ElementType` traced through `f → g → h`;
Mutation changed content without changing identity/length; repeated
passing did not consume the Object; Bounds Checking used the real
length; two distinct Objects remained independent; Property Tests
`16/16`; full regression `3435/12` with zero new regressions
throughout every scenario. Critically, `length=3` in the final,
decisive experiment was never hand-typed — it was extracted from the
real Semantic/`ArrayObjectModel` pipeline.

**Explicit scope boundary, per direct instruction — this is an
architectural decision, not a completion announcement**:

> ADR-005 decides the source and representation of `Length` for an
> Array Parameter. It does **not** decide all future Array Parameter
> features.

Specifically **not** resolved or claimed complete by this decision:
- Indirect Calls remain `UNSUPPORTED` (Scenario 4).
- `Copy` for arrays remains rejected (Scenario 6).
- `Move` remains a non-existent language concept (Scenario 6).
- `[]` (zero-length array) remains `UNSUPPORTED` (Scenario 7/8).
- **The official implementation — `ir-builder.ts` and `emit-c.ts` —
  has not yet integrated this decision.** Every experiment proving
  this design remained isolated, per the standing instruction to keep
  the production pipeline protected until the alternative was fully
  proven.

**Consequences**: `IRParam.arrayLength`'s own real meaning changes
going forward — it becomes a transported value derived from a real
`Array Object`, never an independently-asserted `Sentinel`. Any
future implementation must trace `Length` back to a real `Array
Object`, never invent or default it.

- **Commit that implemented it**: this decision record only. The
  Implementation Contract below governs the next, separate
  implementation PR(s).

---

## Implementation Contract (required before touching production files)

```
ArrayObject
    │
    ├── ObjectId
    ├── Length
    └── ElementType
          │
          ▼
      IR representation
          │
          ▼
   Boundary lowering
          │
          ├── pointer
          └── length
          │
          ▼
      C ABI / Runtime
          │
          ▼
    Bounds Checking
```

**Core Invariant, to be added to this Baseline's own Invariants
section upon implementation**:

> Length has exactly one semantic source of truth: the Array Object.

`IRParam.arrayLength` must never become an independent value capable
of diverging from the `Array Object` it represents. Any future PR
that reintroduces a disconnected `Sentinel` (the current `= 1`
placeholder, or any other hard-coded stand-in) violates this
Invariant and must be rejected under the PR Merge Gate.

**Required before any `ir-builder.ts`/`emit-c.ts` PR**: tests that
explicitly prevent the `Sentinel` from returning — asserting that
`arrayLength` (or its replacement) is always traceable to a real
`Array Object`'s own real `Length`, never a hard-coded constant.

---

## Post-ADR-005 Audit — real, systematic codebase search

**Per direct instruction, before declaring the Array-Parameter-Length
gap closed.** Every item below was searched directly, not assumed.

1. **Any place still assuming `arrayLength = 1` as a real length**:
   searched (`grep -rn "arrayLength"`). Only one real match, the
   field's own doc comment explicitly stating it is a marker only,
   never a real value — consistent with the real implementation.
   **Clean.**
2. **Any place using `slot.length` for an array-parameter slot
   instead of `p_a_length`**: confirmed directly —
   `slot.isArrayParam` is checked *before* the `slot.length ?? 1`
   local-array-declaration branch (`emit-c.ts`); a parameter slot can
   never reach that branch. Every real bounds-check and call-site use
   of length already reads `slot?.runtimeLengthCName ?? slot?.length`
   — the parameter case is always resolved first. **Clean.**
3. **Any place constructing an array parameter without a length**:
   searched for every real construction site
   (`isArrayParam:`/`arrayLength:`) — exactly one, in
   `ir-builder.ts`, the one this PR itself created. **Clean.**
4. **Any place creating Array metadata from a source other than the
   real mechanism**: none found — the one real construction site is
   the sole source.
5. **Any place passing a pointer alone across a Boundary where the
   contract requires `(pointer, length)`**: searched every real use
   of `arraySlot` — the call-site argument-building code
   (`emit-c.ts`, `case "call"`) is the only place that turns an
   `arraySlot` reference into real C arguments, and it always emits
   both. **Clean.**
6. **Any alternative Lowering path that could bypass the new
   mechanism**: found and disclosed honestly — the **`WASM` Backend**
   does not implement `array_load`/`array_store` at all (confirmed
   live: a real array-parameter program correctly and clearly fails
   with `WASM1001`, not a silent miscompilation). This is **not** a
   new gap introduced by this PR — `WASM`'s own array support was
   already this limited beforehand, unrelated to `ADR-005`'s own
   scope (`C` Backend only, per the Implementation Contract). No
   `WASM`-side change was made or is required by this decision.

**Audit result: clean.** No remaining reference to the old `Sentinel`
mechanism, no bypass path, no alternative construction site. The
`WASM` Backend's own, pre-existing, unrelated limitation is disclosed
but does not block closing this gap for its actual scope (`C`
Backend).

**Precision, per direct instruction**: this closes the *source,
transport, and bounds-checking of `Length` for Array Parameters
within the language's current capabilities* — it does **not** resolve
Indirect Calls, Array Copy, Move, or zero-length arrays, all of which
remain the real, disclosed limitations recorded in Scenarios 4/6/7.

---

## ADR-006: Investigation — Multi-file Compilation, Import Usage & Package Boundary

**Status: INVESTIGATION IN PROGRESS — not a decision record.** Per
direct instruction, this entry records evidence gathered so far, not
a resolution.

**Original question**: does UR's Modules/Imports/Packages system
represent one connected system from Source to Compiler, or are there
correct pieces that remain unconnected by a single real contract?

### Investigation Result 1 — corrected hypothesis, real evidence

The initial hypothesis ("the import system is broken") was **not**
confirmed. What was actually proven, via a real, live, traced
end-to-end test (`Package/index.ur → Resolution → AST Merge →
Semantic → TypeChecker → IR → C Backend → gcc → Execution`):

| Layer | Result |
|---|---|
| `TY1001` (old, documented struct-import failure) | **Not Reproducible** — does not occur in the current, live-tested build |
| Imported functions | **PASS** |
| Imported structs | **PASS** |
| Explicit struct type annotation (`let p: Point = ...`, the exact scenario the old report documented as failing) | **PASS** |
| IR integration | **PASS** |
| C execution | **PASS** — real `gcc`-compiled, real-executed: `EXIT:7` (`3+4`), confirming the imported `struct` reached real execution, not merely a formal AST presence |
| `urpm` ↔ Compiler/CLI integration | **OPEN / BROKEN INTEGRATION** — confirmed disconnected (see below) |
| CLI `C` Backend exposure | **OPEN** — the real CLI (`ur build`/`ur run`) exposes no path to the `C` Backend at all; only `JS`/Interpreter output exists |
| `JS` interpreter build issue (`interpret.js` not found) | **Environmental/Toolchain issue** — `interpret.ts` exists in source; the compiled `.js` is simply not built in this direct-`tsx` development environment. Classified separately, not a real import-system defect |

**Real discoveries along the way, kept precise**:
- `export` is not a recognized keyword — all top-level declarations
  are implicitly exported (confirmed directly in `export-checker.ts`
  and via a live parser test, `PE010` for the keyword).
- The real `UR→UR` import path resolves `ur_packages/<name>/index.ur`
  — a `manifest.json` in the same directory is a **separate, real FFI
  mechanism** (foreign-language function imports:
  python/javascript/c/rust/etc.), not `UR→UR` module import.
- `urpm`'s own manifest file is named `urpm.json` — a third, distinct
  name, confirming `urpm` is not the mechanism `CLI` actually uses for
  `import X`.

**Precision, per direct instruction**: this does not prove the
package system is production-ready as a whole. It proves the core
`UR→UR` import mechanism itself works end-to-end for the scenarios
tested. The confirmed, real gap is `urpm`'s own disconnection from the
compiler/CLI, not the import mechanism itself.

**No `TypeChecker`/import-mechanism fix is being reopened** — nothing
that tested successfully is touched.

### Next investigation step: urpm Integration Trace

Per direct instruction, before any fix: trace the real chain
```
urpm publish/install
        ↓
   package layout
        ↓
   registry/cache
        ↓
     resolver
        ↓
  installed package
        ↓
       CLI
        ↓
Compiler import resolver
```
**Single question**: is `urpm` designed to be the Compiler's real
Package Manager, or is it a standalone system never actually wired
in? If the two are confirmed independent, that is a real, clear
architectural gap deserving its own separate PR/ADR.

### urpm Integration Trace — Result

**Answer, confirmed by three independent, direct checks — `urpm` is a
standalone system, never wired in. It is not designed to be the
Compiler's Package Manager today; it exists as isolated, complete,
unreachable code.**

1. **Main CLI command calls**: `src/cli/index.ts` calls none of
   `urpm`'s real command functions (`cmdInstall`, `cmdPublish`,
   `cmdUpdate`, `cmdSearch`, `cmdRemove`, `cmdVerify`,
   `cmdCreateProject`) — zero matches, confirmed directly.
2. **`package.json`'s own `"bin"` entries**: only `ur` and `ur-ide`
   exist. No separate `urpm` terminal command is exposed to a real
   user at all.
3. **Project-wide import search, corrected**: an initial match
   (`src/ffi/index.ts` importing from a path containing `"urpm"`) was
   a false positive — traced precisely, it imports from
   `src/ffi/urpm-native/native-packages.js`, a **different, unrelated
   module** that merely shares part of a name. A corrected, precise
   search for real imports specifically from `src/urpm/` itself found
   **zero matches** anywhere else in the project.

**Conclusion**: `urpm` (`cache.ts`, `commands.ts`,
`dependency-graph.ts`, `manifest.ts`, `registry.ts`, `resolver.ts` —
a real, complete, carefully-built package-manager implementation) has
no path of use whatsoever — not from the compiler, not from the CLI,
not from any other file in the project, not from a terminal command a
real user could type. It is real, working code with zero real
reachability.

**Effect on ADR-006**: this is the confirmed, real architectural gap
this investigation set out to find — not a bug in the import
mechanism (which works, per Investigation Result 1), but a complete
absence of integration between a real Package Manager subsystem and
the real Compiler/CLI. This gap is now precisely located and ready
for a separate, dedicated PR/ADR to decide how (or whether) to
connect them — not decided here, per the standing investigation-first
discipline.

### ADR-006: Investigation — CLOSED

**Result, precisely worded per direct instruction — not "urpm is dead
code" as an absolute claim**:

> `UR→UR` import (`ur_packages/<name>/index.ur`) is proven, for the
> scenarios this investigation tested, through the full real chain —
> `Resolution → AST Merge → Semantic → TypeChecker → IR → C Backend →
> gcc → Execution`, including imported `struct`s and explicit `struct`
> type annotations.
>
> `src/urpm/` is a separate, real Package Manager component — it has
> its own real, passing test suite (`tests/urpm/urpm.test.ts`,
> `create-project.test.ts`, `108/108`), proving internal maturity.
> **It is not used in the current production Compiler/CLI path, and
> no production integration point was found in this investigation.**
> This is not evidence of a broken component — it is evidence of a
> missing connection, requiring its own separate architectural
> decision.

**Three distinct things, not to be conflated**, confirmed precise per
direct instruction:
1. **Current Import Resolver** (`ur_packages/<name>/index.ur`) —
   proven working for functions and structs, through IR and real
   execution.
2. **FFI manifest** (`manifest.json`) — a separate mechanism for
   foreign-language (`python`/`javascript`/`c`/etc.) imports.
3. **`urpm`** — a standalone Package Manager, internally mature
   (`108/108` tests), with no proven production integration point.

**Separate, unrelated note, kept explicitly apart from ADR-006/007's
own subject**: some real test failures observed elsewhere in this
project (`C`/Optimizer tests failing for environmental reasons such
as missing `libasan`; some integration tests with platform-specific
requirements) are Environment/Toolchain failures, not language
defects — kept classified separately, not folded into this
investigation's own findings.

---

## ADR-007: Investigation — UR Package Manager ↔ Compiler/CLI Integration

**Status: OPEN — Investigation, not a decision. No code is touched
until the contract is resolved, per direct instruction.**

**Refined architectural question, exactly as specified — deliberately
not framed as "make urpm work"**:

> Should `urpm` become the official source of truth for packages and
> modules in `UR`, or should the current Import Resolver remain the
> foundational system, with `urpm` becoming a management layer on top
> of it?

**Why the second option deserves serious study, per direct
instruction**: the current Import Resolver is proven working
(ADR-006's own real evidence) — any path forward must not destroy
what already works merely because the Package Manager is
unconnected to it.

**Work order, per direct instruction**:

```
ADR-006 (Import Investigation) ─── CLOSED
              │
              ▼
ADR-007 (Package Architecture)
              │
       ┌──────┴──────┐
       ▼             ▼
Current Import      urpm
(index.ur)          (package management)
       │             │
       └──────┬──────┘
              ▼
     Source-of-truth decision
              │
              ▼
     Integration Contract
              │
              ▼
        Implementation PR
```

No code is written at this stage. The next step is investigating the
real shape of a possible Integration Contract between the two real
systems — not selecting or implementing one yet.

### Source-of-Truth Investigation, per field — real evidence

| Field | Real current source | Critical finding |
|---|---|---|
| Package name | Import Resolver: the folder path itself (no logical name) / `urpm.Manifest.name` | No agreement between the two |
| Version | Import Resolver: **does not exist at all** / `urpm.Manifest.version` (real `SemVer`) | `urpm` only |
| `main` | Import Resolver: hard-coded to `index.ur` always / `urpm.Manifest.main` (configurable) | Only `urpm` supports configurability |
| `dependencies` | Import Resolver: **explicitly rejects** transitive imports (`"Phase 0-A scope boundary"`, a documented, acknowledged limitation, not a hidden defect) / `urpm.Manifest.dependencies` (full version-constrained dependency list) | A real capability gap, not a bug |
| `exports` | Import Resolver (`UR→UR`): implicit (every top-level declaration) / FFI `manifest.json`: explicit `{urName: foreignSymbol}` map | **`urpm.Manifest` has no `exports` field at all** |
| `runtime` | FFI `manifest.json` only (`python`/`c`/etc.) | **`urpm.Manifest` has no `runtime` field at all** — confirmed via direct source search |
| `module path` | FFI `manifest.json` only | **`urpm.Manifest` has no `module` field at all** |
| `language` | Not represented as an independent field anywhere | Gap in both systems |
| ABI/FFI metadata | FFI `manifest.json` exclusively | Entirely outside `urpm.Manifest`'s own scope |

**Critical finding, strengthening the layered hypothesis without yet
deciding it**: even if `urpm` were wired into `CLI` tomorrow, its
current `Manifest` structure lacks the fields `CLI` actually needs
today (`runtime`, `module`, `exports`) — real structural extension
would be required, not mere wiring. This is real evidence consistent
with `urpm` being designed for general package management (name,
version, dependencies) while the Import Resolver owns module
resolution and execution metadata (`runtime`, `exports`) — two
complementary layers with different responsibilities, not competing
implementations of the same thing. Not yet a decision — the next
investigation step is defining the real responsibility boundaries
precisely (Import Resolver / Package Manager / Registry / Dependency
Resolver / Compiler / CLI), before proposing any Integration
Contract.

### Definition of Responsibilities (per direct instruction — conceptual contract, zero code touched)

**Explicit precision, per direct instruction**: the evidence gathered
so far does not prove the layered design below is the final
architecture. It proves `urpm` and Import Resolver currently have
different real responsibilities. The table records that real
distinction, not a finalized design.

| Layer | Owns | Must NOT own | Inputs | Outputs | Source of truth for | Boundary | Allowed dependency direction | Error handling |
|---|---|---|---|---|---|---|---|---|
| **Package Manager / `urpm`** | install/remove/update, versions, `dependencies`, cache | AST analysis, Semantic decisions | `urpm.Manifest`, registry queries | Resolved dependency graph, installed package layout | name, version, `dependencies` | Never touches AST or types | Depends on Registry, Dependency Resolver | Version conflicts, missing packages (`REGISTRY_CODES`, confirmed real diagnostics) |
| **Registry** | source/index of packages and versions | Compiling or analyzing imports | Package name/version queries | Package metadata, available versions | Which versions of a package exist | Never resolves imports itself | Depended on by Package Manager, Dependency Resolver | Unknown package, no matching version |
| **Dependency Resolver** | picking compatible dependency versions, building the dependency graph | Loading AST directly | Manifest's declared `dependencies` | Resolved, conflict-free dependency graph | Which exact version satisfies all constraints | Never touches source files | Depends on Registry | Version conflicts (confirmed real: `dependency-graph.ts`'s own `RCODES`, `pickBestVersion`) |
| **Import Resolver** | turning `import X` into a loadable module/file/package | Installing packages or managing versions | `import` statement, current resolved package layout | A real, loadable UR module (or FFI binding) | module path, `exports` (for the scenarios it currently handles) | Never manages package installation or versions | Depends on the Package Manager's own resolved layout (not yet real — this is the missing connection) | Missing module, parse failure (confirmed real: today's own diagnostics) |
| **Compiler** | Parser → Semantic → TypeChecker → IR → Backend | Package lifecycle management | Merged AST (post-import-resolution) | IR, then Backend output | Program correctness | Never resolves imports or packages itself | Depends on Import Resolver's own output | Type errors, Lowering errors (existing diagnostic codes) |
| **CLI** | user interface, orchestrating calls across the layers above | owning independent resolution logic of its own | user command + source files | Build/run output | Nothing — pure orchestrator | Should not embed resolution logic itself (today's real `resolveAndMergeImports`, living inside `cli/index.ts`, is exactly this violation — noted as evidence, not yet judged as something to fix) | Depends on all layers above | Surfacing every layer's own errors to the user |

**Three points explicitly left as open investigation questions, per
direct instruction — not decided here**:

1. **Who owns `main`?** Real, confirmed conflict: Import Resolver
   hard-codes `index.ur`; `urpm.Manifest.main` is configurable. Open
   question: is `main` a real Package Entry Point concept, or does
   Import Resolver keep enforcing `index.ur`? This will determine the
   real Integration Contract's own shape.
2. **Who owns `exports`?** `UR→UR` uses implicit exports; FFI uses an
   explicit map; `urpm.Manifest` has neither. Package Metadata and
   Module API Metadata must not be conflated. Plausible (not decided)
   shape:
   ```
   Package Metadata (name, version, main, dependencies) → urpm
   Module Metadata (exports, module path, language/runtime,
                     FFI metadata) → Import Resolver
   ```
3. **Transitive Dependencies — the most important open question.**
   Real evidence: Import Resolver explicitly rejects `A → B → C`
   (`"Phase 0-A scope boundary"`). Real evidence: `urpm.Resolver`'s
   own source comment states its purpose directly — *"Recursively
   resolve transitive dependencies"* — this appears to be exactly the
   real reason `urpm` exists. But Import Resolver itself must not
   become a Dependency Resolver — this needs to be proven, not
   assumed, in the model test below.

### Model tested against 3 real cases (reasoning only — zero code written)

- **`A → B`**: confirmed working today (ADR-006's own real evidence)
  — Import Resolver alone handles this; no Dependency Resolver
  involvement needed for a single, direct import.
- **`A → B → C`**: confirmed failing today, explicitly and by design
  (`"not yet supported"`) — under the proposed layering, this is
  exactly where a real Dependency Resolver would sit between Package
  Manager and Import Resolver, producing an already-resolved package
  graph that Import Resolver then merely walks — Import Resolver
  itself would still never need to understand version constraints.
- **`A → B@version-range`**: no evidence this is handled anywhere
  today — Import Resolver has no version concept at all (confirmed
  above); `urpm.Resolver`'s own real methods (`resolve`, and
  `dependency-graph.ts`'s `pickBestVersion`) are designed for exactly
  this, but remain unconnected to any real compilation path.

**Explicit constraint, per direct instruction**: `urpm.Manifest` is
NOT to be extended with `runtime`/`exports`/`ABI` fields merely
because Import Resolver needs them. Whether these are Package
Metadata or Module/FFI Metadata must be decided first — conflating
them now would recreate the exact problem this investigation
discovered (two systems holding similar concepts with different
sources of truth).

**Status: still Investigation, no Integration Contract written, no
code touched.**

### Canonical Data Model (per direct instruction — conceptual only, zero code)

```
Package
 ├── name
 ├── version
 ├── main
 └── dependencies

Module
 ├── package
 ├── path
 ├── exports
 └── language

ForeignModule / FFI
 ├── runtime
 ├── module
 ├── exports
 └── ABI metadata
```

**Real evidence checked before answering the decisive question**:
today's actual system resolves `import mathlib` to exactly one file
(`ur_packages/mathlib/index.ur`) — there is no real, current concept
of a package containing multiple, separately-importable modules
(`import mathlib/geometry` is not supported; the path is always built
as `ur_packages/<full import path>/index.ur` directly). **Today,
`Package` and `Module` are the same real entity, 1:1** — this is a
real, current-scope limitation (`Phase 0-A`), not a conceptual truth
about what a package must be.

**Decisive question, answered — still not a final decision, per
direct instruction**:

> Are these three independent entities, or should some be nested
> within another?

**Answer, precisely separated per direct instruction — current
implementation fact vs. proposed architecture, not yet proven**:

```
Current implementation (confirmed):
Package ≈ Module (1:1)

Canonical architecture (proposed, NOT yet proven):
Package 1 ──── N Module
```

`Package` and `Module` should be independent entities with a real
nesting relationship — a `Package` conceptually *contains* one or
more `Module`s. This is a plausible, reasonable design conclusion,
**not yet proven by any real evidence from the current
implementation** — today's 1:1 mapping is confirmed only as a real,
current-scope limit (`Phase 0-A`). This separation must stay explicit
so the `Phase 0-A` limit is never later mistaken for a permanent
Invariant. `ForeignModule`/`FFI` is not a fourth independent entity —
it is a **subtype of `Module`**: it shares `exports` with an ordinary
`Module`, differing only in carrying additional execution metadata
(`runtime`, foreign `module` path, `ABI metadata`) that an ordinary
`UR`-native `Module` does not need.

```
Package
   │
   ├── Modules
   │       │
   │       ├── (ordinary UR Module: path, exports, language)
   │       └── (ForeignModule/FFI subtype: + runtime, module, ABI)
   │
   └── Dependencies
           │
           ▼
    Dependency Resolver
           │
           ▼
    Resolved Package Graph
           │
           ▼
      Import Resolver
           │
           ▼
         Compiler
```

**Check against duplication, per direct instruction's own success
criterion**: `name`/`version`/`main`/`dependencies` live exactly once
(on `Package`); `exports` lives exactly once (on `Module`, inherited
by `ForeignModule`); `runtime`/foreign `module` path/`ABI metadata`
live exactly once (on `ForeignModule` only, since an ordinary `Module`
has no foreign runtime). No field is duplicated across more than one
entity in this model.

**Still not a decision — the next step is confirming this model
against real evidence before writing any Integration Contract.**

## Integration Contract v0.1 (conceptual only — zero code written)

**One full real cycle, each transition answering all 7 requested
questions.**

### 1. `urpm` → Package Resolution

- **Input**: `urpm.Manifest` (`urpm.json`) — declared `dependencies`.
- **Output**: a resolved, version-satisfied dependency list (not yet
  a graph — that's the next step).
- **Owns truth for**: which exact version of each direct dependency
  satisfies its constraint.
- **Reads it**: Dependency Resolver (next step).
- **May modify it**: only `urpm` itself (via `install`/`update`).
- **On error**: version conflict, missing package —
  `REGISTRY_CODES`-style diagnostics (real, existing pattern).
- **Access**: via `urpm`'s own real API only (`Resolver.resolve()`) —
  never direct file/registry access from any other layer.

### 2. Package Resolution → Resolved Package Graph

- **Input**: the resolved dependency list from step 1, recursively
  applied per package.
- **Output**: a full, conflict-free dependency graph (this is real,
  existing `urpm` scope — `dependency-graph.ts`'s own `DependencyGraph`
  + `pickBestVersion`).
- **Owns truth for**: the final, complete set of packages and exact
  versions the build actually uses.
- **Reads it**: Import Resolver (next step) and, transitively, the
  Compiler.
- **May modify it**: nothing downstream — the graph is immutable once
  resolved for a given build.
- **On error**: unresolvable conflict (`RCODES`, real, existing).
- **Access**: via a defined graph API — never raw manifest re-parsing
  by downstream layers.

### 3. Resolved Package Graph → Module Selection

- **Input**: the resolved graph + the specific `import X` statement
  being processed.
- **Output**: exactly one selected `Module` (or `ForeignModule`)
  within one resolved `Package`.
- **Owns truth for**: which real file/module within a package a given
  import name refers to.
- **Reads it**: Import Resolver.
- **May modify it**: nothing — selection is a pure lookup.
- **On error**: import name not found within the resolved package
  (a new, real error case — today's system has no concept of
  selecting among multiple modules within one package, per Case 4
  below).
- **Access**: this is the real, currently-missing layer — today,
  Import Resolver conflates this with the next step entirely.

### 4. Module Selection → Import Resolver

- **Input**: the selected `Module`/`ForeignModule`.
- **Output**: a real, loadable UR source file (or an FFI binding
  stub, matching today's real `manifest.json` mechanism).
- **Owns truth for**: turning a resolved module reference into
  parseable source.
- **Reads it**: the Compiler's own `Parser`.
- **May modify it**: nothing — pure resolution to source.
- **On error**: file not found, parse failure (today's real,
  existing diagnostics).
- **Access**: Import Resolver reads the Resolved Package Graph via
  its own API (per step 2/3) — never re-derives package/version
  information itself, which is exactly today's real violation (Import
  Resolver currently re-derives its own `ur_packages/<path>` lookup
  independently of any real package graph, since none exists yet).

### 5. Import Resolver → AST

- **Input**: real source text (from step 4).
- **Output**: parsed AST, merged with the importing module's own AST
  (today's real, existing `mergedFunctions`/`mergedStructs` pattern —
  unchanged by this contract).
- **Owns truth for**: syntactic correctness.
- **Reads it**: Semantic Analyzer.
- **On error**: today's real `Parser` diagnostics, unchanged.
- **Access**: standard AST handoff — no change from today's real,
  proven-working mechanism (ADR-006's own evidence).

### 6–9. AST → Semantic → TypeChecker → IR → Backend

- **Unchanged from today's real, proven pipeline** (ADR-006's own
  evidence: functions and structs, including explicit type
  annotations, work end-to-end through this exact chain already). This
  contract does not propose any change here — the gap this whole
  investigation is about lives entirely upstream of this point.

### Model tested against 4 cases (reasoning only — zero code)

1. **`A → B`**: Package Resolution trivially resolves one dependency;
   Resolved Package Graph has one node; Module Selection picks `B`'s
   own single module (matching today's real 1:1 case); unchanged from
   today's real, working behavior.
2. **`A → B → C`**: Package Resolution resolves `B`, which itself
   declares a dependency on `C` — this is exactly where `urpm`'s own
   real, already-designed recursive resolution (`dependency-graph.ts`)
   would run, producing a graph containing both `B` and `C` before
   Import Resolver ever runs. Import Resolver itself still never needs
   to understand transitivity — it only ever looks up one already-
   resolved node at a time.
3. **`A → B@^1.2.0`**: Package Resolution is where the real version
   constraint is checked, using `urpm`'s own existing
   `parseVersionConstraint`/`satisfies` functions — Import Resolver
   never sees a version number at all under this contract.
4. **Package `A` containing `index.ur`, `math.ur`, `utils.ur`
   (critical case)**: this is exactly what the new **Module
   Selection** step (step 3 above) is for — it does not yet exist in
   today's real code, which is precisely why `import A` today can only
   ever resolve to one file. Under this contract, `import A` would
   resolve the `Package`, then Module Selection would pick `A`'s own
   default/main module (governed by the still-open `main` question);
   `import A/math` would select `math.ur` specifically. **Critically,
   this does not break today's real `import mathlib` behavior** — a
   single-module package (today's only real case) simply has exactly
   one `Module` to select, collapsing to the same real behavior
   already proven working.

**Result**: the contract holds for all 4 cases without duplicating
any field across more than one layer's own source of truth, and
without requiring any change to the already-proven `AST → Compiler`
chain.

**Status: `Integration Contract v0.1` drafted, conceptual only. No
final ADR-007 decision yet, no code touched — awaiting review before
any PR.**

## Module Addressing & Import Identity Contract v0.1 (conceptual only — zero code written)

**Critical real evidence, checked live before drafting this contract
— a real correction to the earlier `Canonical Model`, disclosed
honestly**:

1. The real parser grammar already uses `.` as a real path separator
   (`while (at("DOT"))`, confirmed directly in
   `src/compiler/frontend/parser.ts`) — `import mathlib.algebra`
   parses to `path: ["mathlib", "algebra"]` today, exactly the syntax
   this question assumes.
2. **Live-tested**: today's real `CLI` resolves `import
   mathlib.algebra` to a **nested folder** —
   `ur_packages/mathlib/algebra/index.ur` (`path.join("/")`,
   confirmed directly) — and this genuinely works today (confirmed
   live: `Built:` succeeded).
3. **Live-tested, and critical**: a *flat sibling file*
   (`ur_packages/mathlib/algebra.ur`, sitting next to `mathlib`'s own
   `index.ur`) is **not** what `.` addressing resolves to — confirmed
   live, this fails (`"expected a UR module or manifest.json at
   .../mathlib/algebra/manifest.json"`) — the system looks
   exclusively for a nested folder, never a sibling file.

**This corrects the earlier `Canonical Data Model`'s own implicit
assumption**: today's real addressing is **Nested Sub-package
Addressing** (each `.`-separated segment is its own real, nested
package folder with its own `index.ur`), **not** flat, sibling
modules living inside one package folder (`mathlib/math.ur`,
`mathlib/utils.ur`). This is disclosed as a real, direct correction —
not silently folded into the prior model.

### Cases tested (reasoning against live-confirmed real behavior — zero new code)

| Case | Package | Version | Module | File | AST | Source of truth |
|---|---|---|---|---|---|---|
| 1. `import mathlib` | `mathlib` | unconstrained (today: none at all) | `mathlib`'s own root/default module | `ur_packages/mathlib/index.ur` | merged in, per today's real, proven mechanism | today: the folder itself; proposed: `Package.main` |
| 2. `import mathlib.algebra` | `mathlib` (with `algebra` as a **nested sub-package** under it, per live evidence above) | unconstrained | `algebra`'s own root module | `ur_packages/mathlib/algebra/index.ur` | merged in | today: nested folder path; proposed: still needs its own decision — is `algebra` a `Module` of `mathlib`, or a real, independent nested `Package`? **Not decided here.** |
| 3. `import mathlib.utils` | same shape as case 2 | unconstrained | `utils`'s own root module | `ur_packages/mathlib/utils/index.ur` | merged in | same open question as case 2 |
| 4. `import mathlib@^1.2.0` | `mathlib` | `^1.2.0` | `mathlib`'s own default module | resolved via Package Resolution + Module Selection (per Integration Contract v0.1's own steps 1–3) | merged in | Version: `urpm`'s own real `satisfies()`; Module/File: same as case 1 |
| 5. `import mathlib.algebra@^1.2.0` | `mathlib` (or `mathlib.algebra` as its own package — same open question as case 2) | `^1.2.0` | `algebra`'s own root module | resolved per the same open question as case 2, plus version resolution | merged in | Combines case 2's open question with case 4's version resolution — **compounds the open question, does not resolve it** |
| 6. `A → B → C` | per Integration Contract v0.1's own real handling (unchanged from the prior entry) | — | — | — | — | `urpm`'s own real, already-designed recursive resolution |
| 7. Single-module package | `mathlib` alone, no nested segments | unconstrained | its own single, real module | `ur_packages/mathlib/index.ur` | merged in | Identical to today's real, live-confirmed, proven behavior — no regression |

**The real open question this contract surfaces, not yet resolved,
per direct instruction**: is a `.`-separated segment (`algebra` in
`mathlib.algebra`) a `Module` *within* `Package mathlib`, or is it a
real, independent, nested `Package` in its own right (with its own
`version`? its own `dependencies`?) — today's live behavior (a full
nested folder with its own `index.ur`) is consistent with either
interpretation, and does not by itself decide between them. This must
be resolved before `Integration Contract v1.0`.

**Explicit exclusion, per direct instruction**: `runtime`/`ABI`/`FFI`
are deliberately not introduced into this addressing contract — they
remain out of scope until the `ForeignModule` path itself reaches
this same layer, to avoid re-mixing Package Architecture with FFI
Architecture (the same conflation this whole investigation already
identified once and corrected).

**Status: this contract has no internal contradiction across the 7
tested cases, but surfaces one real, unresolved open question (Module
vs. nested Package) that must be answered before `ADR-007`'s own final
decision.**

## Nested Package Identity Investigation (per direct instruction — zero code touched)

**Real 3-level structure built and live-tested**:
```
ur_packages/mathlib/index.ur
ur_packages/mathlib/algebra/index.ur
ur_packages/mathlib/algebra/utils/index.ur
```

**Answers to all 7 questions, each with direct live evidence**:

1. **Can each level have its own independent `urpm.json`?** — Moot in
   practice: confirmed directly (`grep`) that `CLI` never searches for
   `urpm.json` at any level, at any depth. Placing one anywhere
   changes nothing in the real, current build path.
2. **Can it have a different `Version`?** — No mechanism reads or
   enforces one today, at any level (same root cause as Q1).
3. **Can it have different `Dependencies`?** — No mechanism exists
   today to declare or resolve them at any nested level (same root
   cause).
4. **Can it have a different `main`?** — No — every level is
   hard-coded to `index.ur`, confirmed identically at every depth
   tested.
5. **Does the Dependency Resolver treat it as an independent
   Package?** — No Dependency Resolver runs in the real build path at
   all today (confirmed: zero real invocation of `urpm`'s own
   `Resolver` from `src/cli/`/`src/compiler/` — a *different*,
   unrelated `ImportResolver` exists in `src/compiler/module/
   registry.ts`, serving `ModuleRegistry`'s own Semantic-level
   concerns, not package/dependency resolution).
6. **Does `import mathlib.algebra` go through Package Resolution or
   plain path resolution?** — Confirmed: plain path resolution only
   (`ur_packages` + `.`-segments joined with `/` + `index.ur`) — zero
   Package Resolution logic involved.
7. **Can `mathlib.algebra` depend on `mathlib`?** — **Live-tested,
   no**: `algebra/index.ur` importing `mathlib` fails with the exact
   same real diagnostic as any other nested import attempt —
   `"nested/transitive imports are not yet supported (Phase 0-A scope
   boundary)"`. The restriction is general (any transitive import,
   including a child depending on its own parent), not
   direction-specific.

**The decisive test, per direct instruction**: does `mathlib.algebra`
enter any real dependency graph at all? **No** — confirmed directly:
no Dependency Resolver runs in the real build path today, so nothing
resembling a dependency graph is ever constructed for it. A folder
with an `index.ur` alone does **not** make it a `Package` in the
architectural sense — exactly the standard set for this test.

**Resolves the open Module-vs-nested-Package question, with real
evidence rather than assumption**: **neither, today.** `.`-addressing
is currently pure, unaddressed path resolution — it carries no
Package identity (no version, no independent dependencies, no
independent `main`) and no Module identity (no exports contract
distinct from any other imported file) beyond what plain path lookup
already provides. The distinction this investigation set out to make
does not yet exist in the real system — it must be *designed*, not
discovered, before `Integration Contract v1.0`.

**Status update**:
- ADR-006 ✅
- ADR-007 Investigation ✅
- Canonical Data Model 🟡 needs correction for nested addressing
  (recorded above)
- Integration Contract v0.1 🟡 good draft, not final
- Module Identity 🔴 now resolved as an investigation finding: today,
  it is undesigned — a real design decision is required, informed by
  (not derived from) current behavior
- Production code 🔒 untouched throughout

## Module Identity — Alternatives Comparison (per direct instruction — same Evidence → Consequences → Failure-cases methodology as ADR-005, before any decision)

| Option | Nature | Evidence for it | Consequences / Failure cases |
|---|---|---|---|
| **A) `.`-segment is a `Module` within `Package`** | `mathlib.algebra` inherits `mathlib`'s own identity fully (same version, same dependencies) | Matches today's real behavior (bare path resolution, no independent identity found anywhere) | Makes the version-conflict case below **impossible by construction** (no meaning for two different versions of part of the same package) — simpler, but constrains future ecosystem flexibility |
| **B) `.`-segment is an independent, nested `Package`** | `mathlib.algebra` carries its own full identity (version, dependencies, `main`) | `urpm.Resolver` is real, already designed to resolve genuine version conflicts (ADR-007's own prior evidence) | Requires a real, separate `urpm.json` to exist at every such level — **confirmed nothing today discovers or reads one** — a real, substantial implementation gap |
| **C) Hybrid — determined by presence of `urpm.json`** | Presence → independent `Package`; absence → plain `Module`, inheriting the parent | Combines B's flexibility with A's simplicity, without breaking any current behavior | Needs a real, explicit tie-breaking rule for the conflict case below |

**The critical case tested under each option**: `A → mathlib@1`,
`B → mathlib.algebra@2`.

- **Under A**: impossible to express — `algebra` has no version of
  its own; the conflict cannot arise, by construction.
- **Under B**: exactly the real, general version-conflict case
  `urpm`'s own `dependency-graph.ts` (`RCODES`, `pickBestVersion`) was
  already built to resolve — treated identically to any other
  package version conflict.
- **Under C**: resolved the same way as B **only if** `mathlib.algebra`
  actually has its own `urpm.json` (making it a real, independent
  package in the graph); if it does not, the conflict is a **type
  error at the design level** — `B` would be depending on a version of
  something (`mathlib.algebra`) that has no independent version to
  begin with, which is itself informative: it exposes that `B`'s own
  declared dependency was invalid before any resolution step runs.

**Status: comparison complete, no option selected. Awaiting the
project owner's own decision, per the standing discipline — this is
a genuine architectural choice, not one derivable from current
evidence alone (the same kind of decision Part 1 Q1 and IR Ontology
Decision 1 required in the earlier Array Baseline work).**

### Decisive Test — real project-wide search, per direct instruction

**Question**: is there any real requirement or prior design anywhere
in the project that a `Module` needs an independent version,
dependencies, lockfile entry, registry identity, or public API
distinct from its `Package`?

1. **Independent module version?** Only match found:
   `src/ffi/bindgen/emitter.ts`'s `module.version` — this is a real
   **ABI version** (binary interface version for `FFI` bindings), an
   entirely different concept from package/module versioning. No
   real evidence of an independent module-level package version
   anywhere.
2. **Independent module dependencies?** Only match found:
   `import-resolver.ts`'s own comment, `"modules in dependency
   order"` — this describes **Compiler-level load ordering** (which
   already-resolved module must be lowered before another), not an
   independent version-constrained dependency concept at the module
   level.
3. **Independent module lockfile entry?** `urpm`'s own real
   `LockFile` interface locks at the **`packages`** level only
   (`packages: new Map()`) — confirmed directly: no separate
   `modules` structure exists in the lockfile at all.
4. **Independent module registry identity?** `PackageRegistry`'s own
   real methods (`register`, `registerVersion`) operate exclusively
   at the **package** level — confirmed directly: no module-level
   registration concept exists.
5. **Independent module public API?** `ModuleDescriptor` (in
   `export-checker.ts`) exists, but as a real, simple technical
   description (`path` + `exports`) built from one parsed file — it
   supports exactly the shape already proposed for `Module` under
   Option A, not evidence of an independent version/registry/lockfile
   identity.

**Result: no real evidence found for any of the 5 sub-questions.**
Option A is confirmed substantially stronger by this direct,
project-wide search.

## ADR-007: Module Identity — DECISION

**Decision: Option A adopted as the Canonical Model.**

```
Package
  name
  version
  main
  dependencies
      │
      ▼
   Module (× N)
     address/path
     exports
      │
      ▼
ForeignModule (a real subtype of Module)
   Module
   + runtime
   + foreign module path
   + ABI/FFI metadata
```

`import mathlib`, `import mathlib.algebra`, `import mathlib.geometry`
all address `Module`s within the **same** `Package mathlib` — the
dotted path expresses a **Module Address**, never `Package` identity.
An independent package (`import algebra`, resolving to `Package
algebra@2.x`) is addressed by its own real package name, never by
appending it as a dotted suffix to an unrelated package's own path.

**Option B (Nested Package) is not rejected outright** — it remains a
real, separate, **future extension**, to be designed on its own terms
if a genuine need for independently-versioned nested packages
emerges, backed by its own real evidence at that time (per the
Amendment Policy's own legitimate-revision grounds) — not silently
smuggled in as a side effect of Module addressing today.

**Option C is explicitly rejected as Canonical Identity**, for the
precise reason given: a metadata file's mere presence or absence must
never change an address's own real ontology. Adding or removing a
`urpm.json` inside `mathlib/algebra/` must not silently flip
`mathlib.algebra` between "Module" and "Package" — that produces
resolver/lockfile/diagnostic behavior that is real but
inexplicable to anyone reading only the source tree. `urpm.json`, if
ever present at a nested level in the future, is metadata *describing*
something — never the switch that *decides* what that something
fundamentally is.

**Status: ADR-007's own Module Identity question is now
DECIDED.** The rest of `Integration Contract v1.0` (wiring `urpm`'s
real `Package`-level resolution to the Import Resolver's own
`Module`-level resolution) remains open, per the standing discipline
— **no code touched yet.**

## Integration Boundary Investigation (per direct instruction — zero code touched)

**Decisive question**: what is the minimal contract/interface
`Package Resolver` and `Import Resolver` could exchange, such that
the former owns Package identity/dependency resolution while the
latter owns Module selection/path/exports, without duplicating
metadata or creating a second source of truth?

**Real evidence gathered — `urpm`'s own existing output shapes**:

- `Resolver.resolve()`'s real return type, `ResolveOutput`, carries
  `buildOrder: PackageNode[]` — and `PackageNode` itself is
  `{ name, version, dependencies }` — **confirmed: no filesystem path
  field exists on `PackageNode` at all.**
- The real physical location lives in a **separate** structure —
  `PackageCache`'s own `CacheEntry`, which carries `resolved: string`
  (a real, already-existing field for a package's own resolved
  location/reference), entirely apart from `PackageNode`'s own purely
  semantic identity (`name`+`version`+`dependencies`).

**This is significant**: `urpm`'s own existing design already
separates semantic package identity from physical location — the
exact separation this investigation was looking for is not something
that needs to be invented; it already exists as two real, distinct
structures.

**Answer to the decisive question**: the minimal real handoff is

```
Package Resolver → { name, version, resolvedPath }  (one per resolved
                      node in the real, already-existing buildOrder)
                            │
                            ▼
                   Import Resolver consumes
                   ONLY `resolvedPath` per package
                            │
                            ▼
              Module Selection proceeds from there
              (locating the requested Module's own file
               within that one resolved root)
```

`Import Resolver` would never need to know `version`, `dependencies`,
or anything about the Registry — it receives exactly one real,
resolved filesystem root per package and performs Module
selection/addressing entirely within it, per `ADR-007`'s own already-
decided `Module Identity` (Option A). No field is duplicated: `Package
Resolver` remains the sole owner of `name`/`version`/`dependencies`;
`Import Resolver` remains the sole owner of `module address/path` and
`exports`, exactly matching the Definition of Responsibilities table
recorded earlier in this document.

**Status: this is a real, evidence-grounded shape for the minimal
Integration Contract interface — not yet written as `Integration
Contract v1.0`, and no code touched.** The next step, before any PR,
is drafting `v1.0` itself using this minimal handoff shape, then
re-testing it against the same cases already validated
(`A→B`, `A→B→C`, `A→B@version-range`, multi-module package,
`mathlib.algebra` addressing).

## Failure / Invalid Resolution States (per direct instruction — real evidence, zero code touched)

1. **Package not in Cache**: `PackageCache.get()`'s real signature
   returns `CacheEntry | undefined` — a clean, explicit "not found"
   signal, never an unexpected exception or a fabricated value. Any
   consumer must check for `undefined` before use.
2. **`resolvedPath` invalid (does not exist on disk)**: **confirmed
   directly — zero use of `existsSync`/`fs.*` anywhere in
   `cache.ts` or `resolver.ts`.** `resolved`/`resolvedPath` is purely
   semantic, in-memory state within `urpm` — it carries **no
   guarantee** that the path is real or exists on disk today.
3. **Package resolved at multiple versions/locations before final
   resolution**: `dependency-graph.ts`'s own real `pickBestVersion`
   function resolves this precisely — filters candidates by
   `satisfies(constraint)`, then reduces to the highest matching
   version; returns `undefined` (the same clean, explicit
   "unresolvable" signal) if none match.

**Precisely refined final rule, per direct instruction's own
request** — not simply "Import Resolver must not perform Package
Resolution" as a blanket statement, since real evidence shows `urpm`
itself provides no physical-path guarantee:

> `Import Resolver` MUST NOT re-resolve `Package` identity (name,
> version, dependency selection) — that remains exclusively owned by
> `Package Resolver`. `Import Resolver` MUST, however, perform a real
> filesystem existence check on the `resolvedPath` it receives before
> using it, since `urpm`'s own current design provides no such
> guarantee. A missing/invalid `resolvedPath` at this point is a real,
> new error case (today's system provides no diagnostic code for it
> anywhere, since this handoff does not exist yet) — distinct from,
> and never to be confused with, a genuine Package Resolution failure.

## ADR-007 Status Update

- Module Identity: ✅ DECIDED (Option A)
- Integration Boundary: ✅ evidence-grounded minimal handoff shape found
- Failure/Invalid Resolution States: ✅ investigated, real rule refined
- **Integration Contract v1.0**: ready to be finalized from the
  evidence gathered across this Investigation — still not written as
  a final, numbered contract; still no code touched.

Per the standing discipline, the next legitimate step is finalizing
`Integration Contract v1.0` itself from this evidence, only then a
small, scoped PR, followed by full regression — matching the exact
`ADR-005` cycle already proven successful in this project.

## Integration Contract v1.0 (formal — conceptual only, zero code touched)

**Terminology correction, per direct instruction**: `resolvedPath` is
not a guarantee the path exists — it is the output of Package
Resolution's own physical-location lookup; existence verification is
a separate, later responsibility at the point of consumption.

### 1. Core Principle

Package Resolution and Module Resolution are two separate
responsibilities. `urpm` owns: Package identity, version selection,
dependencies, dependency graph, registry, lockfile, version
selection. `Import Resolver` owns: receiving the resolved Package
location, Module addressing, Module selection, discovering the
requested module within a Package, physical path validation before
consumption, handing the module to the Compiler pipeline.

### 2. The Contract Between Layers

For each resolved `Package`, the semantic output of Package
Resolution must provide:

```
PackageIdentity
    name
    version

ResolvedLocation
    resolvedPath
```

With the explicit separation:
```
name + version  →  Package Identity
resolvedPath    →  Physical Location
```

`Import Resolver` may never re-select `name`/`version` or re-run
Dependency Resolution.

### 3. `urpm`'s Responsibility

```
urpm
 ├── resolve package
 ├── resolve version constraints
 ├── resolve transitive dependencies
 ├── detect conflicts
 ├── produce build order
 ├── maintain lock information
 └── expose resolved package location
```

Not found → `CacheEntry | undefined`, an explicit failure. No
matching version → `undefined` or a real diagnostic, per the existing
contract.

### 4. Import Resolver's Responsibility

Given `mathlib@1.x`, `resolvedPath=/.../mathlib`, resolving `import
mathlib.algebra` is `Import Resolver`'s own responsibility:
`resolvedPath → mathlib/ → algebra/ → index.ur`. Never: `import →
urpm → choose mathlib's version` — architecturally forbidden.

### 5. Physical Validation

Since `urpm` does not today verify `resolvedPath` exists on disk,
`resolvedPath` alone is never evidence of a real file. Real sequence:
`Package Resolution → resolvedPath → Physical Validation → Module
Resolution`. An invalid `resolvedPath` produces a distinct diagnosis
— `Resolved Package Location Invalid` — never `Package not found`.

### 6. Contract Prohibitions

`Import Resolver` MUST NOT: select a version, resolve a version
constraint, resolve the dependency graph, modify the lockfile, search
for an alternate package location, reinterpret Package identity.
`Package Resolver` MUST NOT: select `mathlib.algebra`, know about
`index.ur`, parse Module syntax, determine a module's own `exports`,
enter AST/Semantic territory.

### 7. Module Identity (per `ADR-007`'s own decision, restated here)

```
Package
│
├── Module
├── Module
└── Module
```
```
Package: name, version, main, dependencies
Module: address/path, exports
ForeignModule: Module + runtime + foreign path + ABI metadata
```
A `Module` never becomes an independent `Package` merely by the
presence of metadata.

### 8. Nested Addressing

`import mathlib` and `import mathlib.algebra` never change `Package`
identity. The latter means `Package = mathlib`, `Module = algebra`,
unless a genuinely separate, future architectural decision introduces
Nested Packages.

### 9. The 4 Core Cases

| Case | Result |
|---|---|
| `A → B` | Package Resolver resolves `B`; Import Resolver resolves the Module |
| `A → B → C` | Dependency Resolver resolves the graph; each Package is handed to its own location |
| `B@^1.2.0` | Version constraint resolved by `urpm` alone |
| Multi-module Package | One `resolvedPath`; Module Resolver selects the module within it |

### 10. Failure States

- **F1 — Package not found**: `Package Resolver → undefined /
  diagnostic`. Nothing reaches `Import Resolver`.
- **F2 — Package resolved but location invalid**: `Package Resolver →
  resolvedPath → Physical Validation → FAIL`, a distinct diagnostic
  (`ResolvedPackageLocationInvalid`) — Package is never re-resolved.
- **F3 — Multiple versions**: `pickBestVersion(...)` resolves this
  within `Package Resolver`; `Import Resolver` never intervenes.

### 11. Invariants (proposed for this Contract, recorded verbatim)

1. **Package Identity** — Package identity is determined by Package
   metadata, not by filesystem location.
2. **Single Package Resolution Owner** — Package version and
   dependency resolution have exactly one owner: Package Resolver.
3. **Module Ownership** — Module selection belongs exclusively to
   Import Resolver.
4. **No Cross-Layer Re-resolution** — Import Resolver MUST NOT
   independently resolve Package identity or version.
5. **Physical Validation** — A resolved package location MUST be
   physically validated before module consumption.
6. **Module Identity** — A Module does not acquire independent
   Package identity merely by occupying a nested filesystem path.
7. **No Metadata Ontology Switching** — The presence or absence of a
   metadata file MUST NOT change the semantic identity of an import
   address.

### 12. One remaining open design decision, before any PR

**Not yet decided — a genuine, small architectural choice for the
project owner, not derivable from evidence alone**: where does
Physical Validation (Invariant 5) live?

- **Option 1 — inline at the boundary**: `Import Resolver` itself
  calls a real `existsSync` check directly on the `resolvedPath` it
  receives, minimizing new surface area.
- **Option 2 — a separate `Package Location Validator` layer**:
  ```
  Package Resolution → ResolvedPackage → Package Location Validator
                                        → Module Resolver
  ```
  Keeps `Import Resolver` from accumulating Package-Resolution-
  adjacent responsibilities (physical validation) alongside its own
  real job (Module selection) — more testable and extensible
  long-term, at the cost of one more real layer.

**This is the one point left for explicit decision before touching
any code.**

## Physical Validation Placement — DECISION

**Decision: Option 2 — a dedicated `Package Location Validator`
layer**, positioned between Package Resolution and Module Resolution:

```
Package Resolver
      │
      ▼
ResolvedPackage
      │
      ▼
Package Location Validator
      │
      ├── valid path → Module Resolver
      │
      └── invalid path → dedicated location error
```

**Rationale, recorded verbatim**: preserves the responsibility
separation already established (Package Resolver: identity, version,
dependencies; Location Validator: is the resolved location real and
valid; Module Resolver: which module within the package; Compiler:
merging and building). Matches the earlier finding directly — `urpm`
provides `resolvedPath` but no existence guarantee, so physical
validation belongs to neither `Package Resolver` (not its job) nor
`Import Resolver` (would accumulate responsibilities against the
Definition of Responsibilities table already built, risking eventual
drift into a single layer combining package resolution, filesystem
validation, module selection, and dependency handling). Each of the
3 failure states (F1/F2/F3) becomes independently testable at its own
real layer.

**`ADR-007` / `Integration Contract v1.0`'s own Invariant 5 is now
concrete**: *"Physical Validation belongs to a dedicated Package
Location Validator layer, positioned between Package Resolution and
Module Resolution."*

## PR Contract (pre-implementation spec — still zero production code touched)

**Scope, explicitly narrow, per direct instruction — this PR MUST
NOT**: modify `urpm.Manifest`, introduce `runtime`/`exports` into
`urpm`, redesign Module Identity, resolve transitive dependencies
inside `Import Resolver`, change any Backend, or rewrite
`resolveAndMergeImports`.

### Interfaces this PR introduces (spec only)

```typescript
interface ResolvedPackage {
  readonly name: string;
  readonly version: string; // SemVer string, matching urpm's own real format
  readonly resolvedPath: string; // as produced by urpm.Resolver's own real output — no guarantee of existence yet
}

interface PackageLocationValidator {
  /** Performs a real filesystem existence check on `pkg.resolvedPath`.
   *  Returns the same `ResolvedPackage`, unchanged, on success. */
  validate(pkg: ResolvedPackage): ValidationResult;
}

type ValidationResult =
  | { readonly ok: true; readonly pkg: ResolvedPackage }
  | { readonly ok: false; readonly code: "RESOLVED_PACKAGE_LOCATION_INVALID"; readonly message: string; readonly path: string };
```

### Error cases this PR must cover

- **F1 — Package not found**: out of this layer's own scope entirely
  — `Package Resolver`'s own existing `undefined`/diagnostic path,
  unchanged; `PackageLocationValidator` is never reached.
- **F2 — resolved but location invalid**: `validate()` returns
  `{ ok: false, code: "RESOLVED_PACKAGE_LOCATION_INVALID" }` — a real,
  new, distinct diagnostic code, never reusing or aliasing any
  existing "module not found" error.
- **F3 — multiple versions**: out of scope — resolved entirely within
  `Package Resolver`'s own existing `pickBestVersion`, unchanged;
  `PackageLocationValidator` only ever sees one, already-chosen
  version.

### Required tests for this PR

1. A real, existing filesystem path → `validate()` returns
   `{ ok: true }`.
2. A real, non-existent path → `validate()` returns `{ ok: false,
   code: "RESOLVED_PACKAGE_LOCATION_INVALID" }`.
3. `PackageLocationValidator` performs no version selection, no
   dependency resolution, no module addressing — a real test
   confirming it is a pure pass-through/reject on `resolvedPath`
   alone, touching nothing else on the `ResolvedPackage` it receives.
4. Confirms `Package Resolver`'s own existing `undefined`/`pickBestVersion`
   paths remain completely unchanged by this addition (a real
   regression guard).

**Status: this is a pre-implementation Contract, not yet code.** The
next, separate step is the actual narrow implementation PR itself,
followed by full regression — still no production file has been
touched in this entire `ADR-006`/`ADR-007` investigation.

## Audit Resolution: what does "a valid package location" mean here?

**Resolved directly from this Contract's own already-ratified text —
not invented**: Section 6's own prohibition states `Package Resolver
MUST NOT... know about index.ur`. Since `PackageLocationValidator`
sits strictly between `Package Resolver` and `Module Resolver`, and
per this Contract's own explicit scope (`Module Selection` excluded
from this PR), checking for `index.ur`/`main` would cross into
`Module Resolver`'s own territory. **`PackageLocationValidator`'s own
real check is therefore exactly: does `resolvedPath` exist as a real
directory — nothing more.** Any deeper validation (main entry
presence, manifest correctness) belongs to a later layer this PR does
not touch.

## Post-PR Boundary + Integration Audit (per direct instruction)

**All 5 points checked with direct evidence**:

1. **Ownership**: `pkg.name`/`pkg.version` appear in the source only
   inside the error message's own string interpolation — never used
   for any decision or re-resolution logic. Confirmed clean.
2. **Filesystem boundary**: confirmed directly — zero real check for
   `index.ur`, `main`, `exports`, or `urpm.json` anywhere in the
   file's own real logic (the only matches are the file's own doc
   comments explicitly stating these are out of scope). Confirmed
   clean.
3. **Error semantics**: `F1`/`F3` are not reachable from this file at
   all (confirmed by the regression-guard test); the one real
   `try/catch` covers `existsSync`/`statSync` exclusively, so no
   undocumented exception can escape `validate()` — every real
   outcome becomes an explicit `ValidationResult`. Confirmed clean.
4. **Dependency direction**: the file's own only import is
   `{ existsSync, statSync } from "fs"` — zero import from `Import
   Resolver`, `Module Resolver`, or `Compiler`. Confirmed clean —
   this stays a pure, one-directional validation layer.
5. **Integration — the critical finding**: **confirmed directly, a
   real project-wide search — zero file outside
   `package-location-validator.ts` itself imports from it.** The
   layer has **no production consumer today**.

**Honest correction to the prior record, per direct instruction**:
the previous commit's own summary described this as fully closing
`ADR-007`'s implementation — that overstated what was actually
achieved. The accurate status is:

> The `PackageLocationValidator` layer is implemented and tested in
> isolation (`4/4` tests, zero regressions). It is **not yet wired
> into the real `Package Resolver → Validator → Module Resolver`
> production path** — no such path exists yet, since `Import
> Resolver`/`urpm` remain disconnected (per `ADR-006`'s own prior
> finding). This mirrors that exact same pattern at a smaller scale:
> a real, tested component with zero production reachability.

**`ADR-007` status, precisely**: Module Identity ✅ DECIDED,
Integration Contract v1.0 ✅ formally recorded, `PackageLocationValidator`
✅ implemented and tested — but **wiring this layer into a real
production path remains a separate, not-yet-done step**, requiring
its own real evidence before `ADR-007` can be described as fully
implemented end-to-end.

## Production Integration Trace (per direct instruction — before any code)

**All 5 questions answered with direct evidence, from
`resolveAndMergeImports` (`src/cli/index.ts`)**:

1. **Where does Package Resolver end today?** It doesn't exist as a
   separate step here — "resolving the package" and "building the
   `index.ur` path" are currently one fused operation.
2. **Where is `resolvedPath` built?** `candidatePath = resolve(cwd,
   "ur_packages", importPath, "index.ur")` — **critical finding**:
   this already includes `index.ur` itself, not merely the package
   root. Must be split: the package root (`ur_packages/<importPath>/`)
   is what `PackageLocationValidator` checks; `index.ur` selection
   remains Module Resolution's own, separate, later step.
3. **Where does Module Resolution begin?** `existsSync(candidatePath)`
   (checking for `index.ur` specifically) — stays exactly as-is,
   running only after the package root itself is validated.
4. **One entry point, or several?** Exactly one real `UR→UR` entry
   point (the loop over `program.imports`). A second, entirely
   separate path exists for FFI (`manifest.json`) — explicitly out of
   this PR's own scope, untouched.
5. **Is `ResolvedPackage` ready as-is, or does it need an adapter?**
   Needs a small, real adapter — `urpm` itself is not invoked
   anywhere in this real path today, so `name`/`version` will be
   derived placeholders (e.g. `name: importPath`, `version: "local"`),
   not real values from a `urpm.Manifest`. This must be disclosed
   honestly as exactly what it is — a local, derived identity for this
   specific integration point — not a claim of real `urpm`-backed
   Package identity, which remains a separate, not-yet-connected
   system per `ADR-006`.

**Status: trace complete. Proceeding to the narrow implementation
PR.**

## Critical Finding, discovered mid-implementation, disclosed honestly

**The first attempted placement was reverted before any test ran**
(confirmed: `git diff --stat` empty, file back to its exact original
state) — inserting `PackageLocationValidator` before either
`index.ur`/`manifest.json` attempt would have converted the "nothing
exists at all" case from `F1` to `F2`, directly violating the
explicit requirement (`F1` must stay `F1`; no `F1`→`F2` conversion).

**The deeper, real reason, not merely a placement bug**: `F2`, in its
true `Integration Contract v1.0` sense ("semantically resolved, but
the stored physical location is no longer valid"), requires a real
`urpm`/`Cache` layer sitting between semantic resolution and physical
location — exactly the separation `urpm`'s own `PackageNode`/
`CacheEntry` structures already provide (per the earlier Integration
Boundary Investigation). **This specific path
(`resolveAndMergeImports`) has no such layer** — it performs a single,
direct `existsSync` check with no prior semantic resolution step at
all (`ADR-006`'s own finding: `urpm` remains disconnected here).
Consequently, in this specific path, `F2` and `F1` are **currently
logically inseparable** — there is no real scenario where a package
is "resolved" but its location is "invalid" independently of it
simply not existing, since resolution and existence-checking are the
same operation here today.

**Conclusion, per the standing discipline — this is not forced to
succeed**: wiring `PackageLocationValidator` into this specific,
`urpm`-disconnected path in a way that meaningfully distinguishes
`F1` from `F2` is not achievable without either (a) a real `urpm`
connection first (a separate, larger piece of work, explicitly out of
this PR's own scope), or (b) accepting that `F2` would be
unreachable/vacuous in this path, which is not a real integration at
all. **This PR does not proceed as originally planned.** The finding
itself — that `PackageLocationValidator` cannot be meaningfully wired
into this specific path without first connecting a real semantic
resolution layer — is the real, valuable result of this Trace, kept
honest rather than forced.

## Precise Final Status (per direct instruction — not "PR failed", not "ADR-007 complete")

**Explicit rejection of a shortcut, recorded per direct instruction**:
building `resolvedPath = ur_packages/mathlib/` and running the
Validator against it would look correct, but would fabricate a
semantic Package Resolution layer that does not actually exist in
`CLI` today — inventing evidence to justify a design is exactly the
discipline this project has avoided since `ADR-005`.

```
PackageLocationValidator
        │
        │  Implemented
        │  4/4 tests
        │  Boundary Audit PASS
        │
        ▼
     READY
        │
        │  not wired in
        ▼
Current Import Resolver
        │
        └── no real Package Resolution layer exists here
```

**Status, recorded verbatim**:

> Architecture decided. Validator implemented and independently
> verified. Production integration deferred because the current
> Import Resolver lacks the semantic Package Resolution boundary
> required to distinguish `F1` from `F2`.

- `PackageLocationValidator`: Implemented + Tested + Isolated.
- `urpm`: exists, not wired in (`ADR-006`'s own finding).
- Import Resolver: operates via a direct physical path, no semantic
  resolution step.
- `F1`/`F2`: currently inseparable in the real production path.
- Production Integration: **DEFERRED, not FAILED.**

`ADR-007` is **not** described as fully complete — this real,
architectural finding (the Contract assumes a boundary the production
path does not yet have) is itself more valuable than a formally
successful but fabricated PR.

## Package Resolution Integration Investigation (new, separate, scoped — per direct instruction, zero code touched)

**Single question**: how do we introduce `urpm`'s own real semantic
resolution into the current production path, without breaking the
existing Import Resolver or inventing a new Package identity?

**Target real path**:

```
import mathlib
      │
      ▼
Package Resolution
      │
      ├── F1: package cannot be resolved
      │
      ▼
ResolvedPackage
      │
      ▼
Location Validation
      │
      ├── F2: resolved location invalid
      │
      ▼
Module Resolution
      │
      ▼
index.ur
      │
      ▼
AST → Semantic → TypeChecker → IR → Backend
```

**No code is written until this path is proven to exist, or the exact
point to introduce it is identified with real evidence** — matching
the same discipline already proven throughout `ADR-005`/`006`/`007`.

## Critical Finding — `urpm` has zero real filesystem discovery capability

**Confirmed via a direct, comprehensive search — zero use of
`readFileSync`/`existsSync`/`readdirSync`/any `fs` module function
anywhere in `registry.ts`, `commands.ts`, or `manifest.ts`.**

`PackageRegistry` is a purely in-memory system today — it knows about
a package only if something calls `register()`/`registerVersion()`
programmatically. **Even if a real `urpm.json` were placed inside
`ur_packages/mathlib/` today, no existing code would ever read it.**

**Why this changes the shape of the investigation**: introducing real
`urpm`-backed semantic Package Resolution into the production path is
not a wiring task between two existing components — it requires
building a genuinely new capability (a real `Manifest Discovery`
step: scanning `ur_packages/` for real `urpm.json` files and
registering them) that does not exist anywhere in the project today.
This is real, new implementation work, not integration of existing
pieces — a materially different, larger scope than "connect A to B."

**Flagged explicitly, before any further design work**: this is
exactly the kind of finding that should pause forward motion for
direction, since it changes what "Package Resolution Integration"
actually requires. Awaiting guidance on whether this Manifest
Discovery capability is in scope for this investigation, or whether
it deserves its own separate, prior architectural decision.

## Package Resolution / Manifest Discovery Investigation (new, separate — per direct instruction, zero code touched)

### Decisive prior question, answered first: what does `ur_packages/` officially mean?

**Real evidence — the project's own single authoritative document**:
`docs/FRI_USER_GUIDE.md` states directly: *"This is the single
authoritative document"* for `import` + `ur_packages/`. It describes
`ur_packages/` **exclusively as the FRI/FFI space** — every real
example uses `manifest.json` (`runtime`/`module`/`exports`); the
`UR→UR` path (`index.ur`, no `manifest.json`) used throughout
`ADR-006`/`ADR-007`'s own investigation is **not mentioned anywhere**
in this official document.

**This changes the shape of the whole investigation**: `ur_packages/`
is **officially the FRI space**, not a `Package Management` store, a
`registry`, or an `installed package store` in `urpm`'s own sense.
`UR→UR` import (`index.ur`) and `urpm.json` are both **later,
unofficial extensions** sharing the same folder name by coincidence,
not by architectural design. Neither answers the "source workspace vs
installed store vs cache vs registry" question posed — **the real
answer is: none of them, officially** — `ur_packages/` was designed
for one specific purpose (FRI), and everything else living there
today is an accretion, not a decision.

### Alternatives to compare (per direct instruction) — Evidence → Consequences → Failure Cases

To be investigated next, now correctly informed by this finding: the
question is no longer only "how does `urpm` discover packages" but
also "where should `UR→UR`/`urpm`-managed packages even live,
given `ur_packages/` is officially FRI's own space" — this must be
answered before comparing Filesystem Discovery / Explicit
Registration / Lockfile-as-source / Hybrid, since each alternative's
own real evidence may differ depending on where packages are assumed
to live.

### Correction, per direct instruction

The prior record's claim that `UR→UR` is "accidental accretion" is
**not proven by documentation absence alone** — it is a strong
architectural hypothesis, kept explicitly unproven until design
history or other real evidence is checked.

## UR→UR Package Location & Ownership Investigation

**All 8 real questions answered with direct evidence, zero code
touched**:

1. **Other documentation discussing UR packages beyond
   `FRI_USER_GUIDE.md`?** Zero matches found.
2. **Does `urpm` itself define an official package location?**
   Zero matches — no `ur_packages`, `packagesRoot`, or any fixed path
   anywhere in `urpm`'s own real source.
3. **Does root `package.json` or `CLI` define a package root?** Zero
   matches in the project's own root `package.json`.
4. **Real fixtures/examples combining `urpm.json` with `index.ur`?**
   **Zero.** A project-wide `find . -name "urpm.json"` returns no
   results at all — `urpm.json` exists only as a code-level concept
   (`interface Manifest`), never as a real file anywhere in this
   project today, in any test fixture or example.
5. **Any `workspace`/local-package concept?** Zero real matches.
6. **Any other real folder-naming convention for `UR→UR` packages?**
   Zero matches.
7. **What do `publish`/`install`/`cache`/`registry` actually expect?**
   `cmdPublish(manifest: Manifest)` — confirmed: it accepts a
   `Manifest` as a direct, real programmatic argument, never reading
   from a filesystem path. Consistent with items 2/3/4 above.
8. **Is `urpm` designed for source packages, installed artifacts, or
   a pure metadata graph?** Based on the combined evidence
   (`PublishResult`/`cmdPublish` accepting objects directly,
   `PackageNode`'s own real shape carrying no path,
   `CacheEntry.resolved` as an unchecked string field) — **`urpm` is
   designed as a pure metadata graph.** It has never, anywhere in its
   own real code, made a commitment about where a package's actual
   source lives on disk.

### Honest conclusion

**No location or ownership decision for `UR→UR` packages exists
anywhere in this project today** — not in official documentation, not
in `urpm`'s own code, not in the CLI, not in any real fixture. This
is a genuine, real gap — not a hidden convention waiting to be
discovered. `ur_packages/` is confirmed to be officially the `FRI`
space (per item 1); where `UR→UR`/`urpm`-managed packages should live
remains **entirely undecided**, requiring a real architectural
decision — matching alternatives A/B/C/D already outlined — not
something this investigation can resolve by finding more evidence,
since none exists to find.

## Ownership + Lifecycle Matrix (per direct instruction, before any decision)

**Real evidence first — what `urpm` actually covers today across the
lifecycle** (`create → develop → resolve → install → cache → publish
→ consume → update → lock`), confirmed directly from its own real
exports: `cmdCreateProject` (create), `Resolver.resolve()` (resolve),
`cmdInstall` (install), `PackageCache` (cache), `cmdPublish`
(publish), `cmdUpdate` (update), `LockFile`/`cmdVerify` (lock). **No
real `develop` tooling, and — confirmed throughout `ADR-006`/`007` —
no real `consume` step (`urpm` is never invoked by the Compiler/CLI
today).** This lifecycle coverage is identical regardless of which
alternative is chosen — it is a property of `urpm` itself, not of
where packages live.

### Testing each alternative against the 7 scenarios, especially the decisive #7

| Alternative | Scenarios 1–6 | **Scenario 7 (workspace + installed package, same name) — the decisive test** |
|---|---|---|
| **A (`ur_modules/` separate space)** | Handled — `urpm` owns the new space fully, `FRI` untouched | **Not resolved** — `A` only separates `FRI` from `UR→UR`; it says nothing about local-vs-installed precedence within the new space itself |
| **B (`packages/` new store)** | Handled, same as A | **Not resolved** — identical gap to A; a new store name alone does not define precedence rules |
| **C (`ur_packages/` dual-purpose)** | Handled for 1–4/6, but **real, immediate ambiguity for #5** (a folder containing both `manifest.json` and `urpm.json` has no defined precedence — confirmed as a real, unresolved Failure Case even for FFI-vs-UR distinction, let alone workspace-vs-installed) | **Fails outright** — the same undefined-precedence problem compounds: three possible files (`manifest.json`, `urpm.json`, `index.ur`) could coexist with no rule for any of them |
| **D (workspace + external Package Manager)** | Handled — matches `urpm`'s own real `PackageNode`/`CacheEntry` separation already found in the Integration Boundary Investigation | **The only alternative with a real conceptual framework for this case** — explicit `workspace package` vs `installed package` vs `registry package` categories, each with its own real precedence to be defined — but this framework does not exist in code today; it would need to be built |

### Result, per direct instruction — eliminate by evidence, don't guess

**`C` is eliminated directly by evidence** — it fails the decisive
test outright and reintroduces exactly the mixed-metadata-ownership
problem this whole investigation exists to prevent (a real, undefined
conflict between `manifest.json` and `urpm.json` in the same folder,
confirmed as a real Failure Case, not a hypothetical one).

**`A` and `B` are real, working solutions for the `FRI`/`UR→UR`
separation itself** (proven, low-risk, matches everything confirmed
in this investigation), **but neither one, by itself, solves Scenario
7** — the workspace-vs-installed precedence question remains open
regardless of which one is chosen.

**`D` is the only alternative with a real answer to Scenario 7** —
but it is not yet real code; it requires defining and building the
workspace/installed/registry distinction from scratch.

**Honest, unforced conclusion**: `A`/`B` and `D` are not mutually
exclusive — `A`/`B` answer "where does the `FRI`/`UR→UR` split live,"
while `D` answers "how do workspace vs installed vs registry packages
relate once they're there." The real open question moving forward is
whether Scenario 7 is in scope for the *current* decision, or whether
it is legitimately deferred (documented as a known, explicit gap) —
matching the same "not everything needs solving in one PR" discipline
already proven successful in `ADR-005`.

## Decision: Defer Scenario 7 (per direct instruction)

**Recorded precisely, not as "Scenario 7 doesn't matter"**: this is a
decision that `Ownership/Location Architecture` must not claim to
solve Scenario 7 before real evidence and explicit requirements for
it exist — not a decision that it is unneeded.

```
UR→UR Package Location
        │
        ├── C → REJECTED (eliminated by evidence, real Failure Case)
        │
        ├── A ──┐
        │       ├── Location Decision (Decision 1, this ADR)
        └── B ──┘
                │
                ▼
        Integration with urpm
                │
                └───────┐
                        ▼
              Lifecycle Architecture (Decision 2, separate, future)
                        │
                 Scenario 7 / D
                        │
                    DEFERRED
```

## Split recorded: Decision 1 vs Decision 2

- **Decision 1 — Package Location & Ownership** (this investigation's
  own real scope): where do `UR→UR` packages officially live?
- **Decision 2 — Package Lifecycle & Consumption** (separate, future
  investigation): how does a package move from development through
  publish/install/resolve/consume, and how is precedence resolved
  between local/installed/registry? This is where `D`'s own real
  framework belongs, fully preserved for that future investigation
  rather than forced into Decision 1's own narrower scope.

## urpm's own real lifecycle gap (unaffected by the A/B choice)

| Stage | Status |
|---|---|
| create | ✅ |
| develop | ❌ |
| install | ✅ |
| resolve | ✅ (within the metadata model) |
| publish | ✅ |
| update | ✅ |
| lock | ✅ |
| **consume** | ❌ |

**Choosing `A` or `B` alone does not complete the Package System** —
even with a real `packages/mathlib/{urpm.json,index.ur}` structure in
place, the real chain `urpm → resolve → install → lock` still stops
before ever reaching `Compiler consume`. This gap belongs to Decision
2, not Decision 1 — Decision 1 must not be described as closing it.

## Sequencing principle (per direct instruction — no Manifest Discovery yet)

```
Where does the package live?
       ↓
What counts as a Package?
       ↓
Who owns the Metadata?
       ↓
How is it discovered?
       ↓
How is it registered?
       ↓
How is it resolved?
```

Building Discovery before Location risks discovering packages from a
place later found not to be the official Package Store — exactly the
mistake this investigation has avoided throughout.

## Remaining open choice: `A` vs `B`

`C` is rejected; `D` is deferred to Decision 2. Per the earlier
comparison table, `A` and `B` are not decisively separated by
evidence — both equally preserve the `FRI` contract, both keep the
risk of mixed responsibility low, and the real difference is a minor,
genuine tradeoff: `A` (`ur_modules/`) is marginally simpler to
introduce (no new "Package Manager"-branded concept), while `B`
(`packages/`) reads more directly as a real package store and may
extend more naturally toward Decision 2's own future needs. **This
final choice is left open for the project owner** — the evidence
does not compel one over the other.

## Decision 1: FINAL — `B` (independent `packages/` store)

**Decision, recorded in the narrow scope requested — conceptual
ownership and location only, no implementation behavior granted**:

> `UR→UR` packages are given an independent Package space, separate
> from `ur_packages/`'s own official `FRI`/`FFI` space. The proposed
> name is `packages/` — the folder name itself remains open to
> revision if a later investigation reveals a more precise name is
> needed; that is an implementation detail, not part of this
> decision's own real substance.

**Rationale, recorded verbatim**: `A` (`ur_modules/`) answers "where
do modules live"; `B` answers a broader, more accurate question,
matching `urpm`'s own already-real concepts (`name`, `version`,
`dependencies`, `main`, registry, resolver, lockfile, cache) — a
space where `UR` packages live, not merely a space for bare module
files. `B` avoids conflating this new space with `ur_packages/`,
confirmed as `FRI`'s own official space throughout this investigation.

```
                    UR Ecosystem
                         │
          ┌──────────────┴──────────────┐
          │                             │
      FRI / FFI                    UR → UR
          │                             │
   ur_packages/                    packages/
          │                             │
   manifest.json                  urpm.json
   runtime                       Package metadata
   exports                             │
   ABI                                 ▼
                                  ┌─────────┐
                                  │   urpm  │
                                  └────┬────┘
                                       │
                              ResolvedPackage
                                       │
                                       ▼
                              Import / Module
                                 Resolution
```

**Explicit non-grants, per direct instruction — this decision does
NOT mean**:
- `packages/` is an Installed Store.
- `packages/` is a Registry.
- `packages/` is a Cache.
- `urpm` has begun reading from it.
- `urpm.json` is now auto-discovered.
- The Compiler now consumes packages from it.

Every one of these remains a real, separate Decision 2 or
implementation question — not granted here.

## Status Table

| Item | Status |
|---|---|
| `C` (dual-purpose `ur_packages/`) | ❌ REJECTED |
| `A` (`ur_modules/`) | Not chosen |
| `B` (`packages/`) | ✅ DECIDED |
| `D` (Workspace/Installed/Registry lifecycle) | ⏸️ DEFERRED to Decision 2 |
| Manifest Discovery | ⏸️ Prohibited until Decision 2 begins |
| Production Integration | ⏸️ Deferred |
| Production code | 🔒 No change |

---

# Decision 2: Lifecycle & Consumption — Investigation

## Step 1: Lifecycle States — Evidence Collection (per direct instruction, no design proposed, no code written)

**Classification taxonomy used, exactly as specified**: real +
production-used / real but isolated / documented only / test/fixture
only / does not exist / unproven architectural inference.

| State | Real evidence | Classification |
|---|---|---|
| **Create** | `cmdCreateProject` exists (`commands.ts:607`), but is `FFI`/`SQLite3`-specific (`"Phase 7 — Native Ecosystem Hardening"`), not a general `UR` package creator. Confirmed: zero call from `CLI`, and not even exported via `urpm/index.ts`'s own public API. | Real but isolated (worse than most: not even publicly exported) |
| **Develop** | Searched for `link`/workspace-mode/dev-mode mechanisms — zero matches anywhere in `urpm`. | Does not exist |
| **Publish** | `cmdPublish` performs real validation (name presence, real `SemVer` version check, dependency constraint validation) — but confirmed: it never writes to any real `Registry` or external location; it returns only `{ok, data:{name,version}}` as an in-memory validation result. | Real but isolated (validation only, not real publication) |
| **Install** | `cmdInstall` performs a real check against a `PackageRegistry` and updates the in-memory `Manifest.dependencies` array — confirmed: no real file copy/download to any disk location occurs anywhere in this function. | Real but isolated (semantic manifest update only, no real filesystem "install") |
| **Update** | `cmdUpdate` mirrors `cmdInstall`'s own real pattern — updates the in-memory `Manifest`, no disk write. | Real but isolated |
| **Lock** | `ResolveOutput.lockFile`/`makeLockFile()` are real, in-memory structures; `lockFileToJson` is exported via `urpm/index.ts`'s own public API — but confirmed: zero real `writeFileSync`-based use anywhere in the project. No real `lockfile.json` is ever written to disk today. | Real but isolated |
| **Resolve** | `Resolver.resolve()` is real and functions correctly within the metadata model (`PackageNode`, dependency graph, `pickBestVersion`) — confirmed extensively in the earlier Integration Boundary Investigation. | Real and functionally complete, but confirmed disconnected from any production consumer (`ADR-006`) |
| **Consume** | Confirmed exhaustively across `ADR-006`/`007`: zero invocation of any real `urpm` function from `src/cli/`/`src/compiler/`. | Does not exist |

**Explicit discipline applied, per direct instruction**: neither the
existence of `urpm`'s own real API surface, nor `test:urpm`'s own
`108/108` passing tests, is treated as evidence that any lifecycle
state is production-real — every state above is classified strictly
by whether it reaches a real filesystem effect or a real production
call site, not by whether its own unit tests pass in isolation.

**Status: Evidence Collection complete. Proceeding next to
Ownership, only after this step is fully reviewed — not skipping
ahead to Discovery or Alternatives yet.**

## Step 2: Ownership Evidence Collection (per direct instruction — who owns each state's code, data, and physical effect)

**New evidence gathered first**: confirmed — `manifestToJson` is
exported via `urpm/index.ts`'s own public API, but **zero real call**
writes an updated `Manifest` back to any real `urpm.json` file
anywhere in the project. `Install`/`Update` never persist their own
in-memory result to disk.

| State | Owns the code | Owns the resulting data | Owns the physical effect (if any) | Classification |
|---|---|---|---|---|
| **Create** | `cmdCreateProject` (`commands.ts`) | A generated `.ur` stub file (real, but FFI/SQLite3-specific) | The scaffolding write itself — confirmed real for its own narrow FFI use case | Isolated — real code, real narrow owner, but not a general `UR` package creator |
| **Develop** | No file/module owns this — confirmed nonexistent | — | — | Missing |
| **Publish** | `cmdPublish` (`commands.ts`) | An in-memory `{name, version}` validation result only | **No owner exists** — nothing writes to a real `Registry` or external store | Isolated — validation logic has a real owner; publication itself has none |
| **Install** | `cmdInstall` (`commands.ts`) | The in-memory, updated `Manifest.dependencies` | **No owner exists** — confirmed directly: `manifestToJson` is exported but never called to persist the result | Isolated — the semantic mutation has a real owner; disk persistence has none |
| **Update** | `cmdUpdate` (`commands.ts`) | Same shape as Install | Same gap as Install | Isolated |
| **Lock** | `Resolver`/`dependency-graph.ts` (in-memory `LockFile`), `manifest.ts` (`lockFileToJson` serialization) | The in-memory `LockFile` object | **No owner exists** — confirmed: zero real `writeFileSync` for a lockfile anywhere | Isolated — the in-memory structure and its serializer both have real owners; the file itself has none |
| **Resolve** | `Resolver` class (`resolver.ts`) — the clearest, most complete real owner of any state investigated | `ResolveOutput` (`buildOrder`, `lockFile`, `diagnostics`) | Not applicable — this state is purely semantic by its own real design | Functional and fully owned within its own metadata model |
| **Consume** | No file/module owns this — confirmed nonexistent (`ADR-006`'s own exhaustive search) | — | — | Missing |

**Key finding, per direct instruction's own framing**: `Resolve` is
the only state with a real, complete, unambiguous owner across code,
data, *and* internal consistency. Every other real (non-missing)
state has a genuine code owner but a **structurally missing owner for
its own physical persistence** — this is not one isolated gap, but a
consistent pattern across `Publish`/`Install`/`Update`/`Lock`: `urpm`
owns *deciding* what should happen, but no code anywhere owns
*making it durably real on disk*.

**Status: Ownership Evidence Collection complete. Not proceeding to
Discovery, Alternatives, or Decision yet — awaiting review.**

### Precision correction to `Resolve`'s own description, per direct instruction

`Resolve` is the only state with a real, complete, coherent
**semantic** owner *within* `urpm` — this does not mean it is a
complete production Lifecycle state, since `resolvedPath` itself was
already proven earlier to carry no guarantee of a real physical
location.

## Step 3: Discovery Evidence Collection (per direct instruction — no mechanism proposed, no code written)

**Single question**: how, if any mechanism exists at all, does a
`UR→UR` package living in `packages/` become a known entity to
`urpm`?

**All 7 sub-questions answered with direct evidence**:

1. **Filesystem discovery?** Already confirmed exhaustively (Package
   Resolution / Manifest Discovery Investigation): zero use of
   `fs`/`readFileSync`/`existsSync`/`readdirSync` anywhere in
   `registry.ts`, `commands.ts`, or `manifest.ts`. Does not exist.
2. **Manifest discovery?** Confirmed: zero real `urpm.json` file
   exists anywhere in this project (project-wide `find` returned
   nothing), so there is nothing to discover even if a mechanism
   existed. Does not exist.
3. **Explicit registration?** Checked directly — one real match
   initially found (`driver-registry.ts`'s own `.register()` calls),
   but traced precisely and ruled out: that is a **different, real,
   unrelated system** (`DriverRegistry`, for `FFI` native driver
   modules — the same real confusion pattern already found once with
   `urpm-native` vs `urpm`, corrected here rather than repeated).
   `PackageRegistry.register()`/`registerVersion()` (`urpm`'s own
   real methods) are confirmed called from nowhere outside `urpm`
   itself. Does not exist.
4. **A bootstrapping/entry point?** `urpm/index.ts` is confirmed to
   be a pure re-export surface — no function runs automatically on
   load, no `main`-style entry point exists. Does not exist.
5. **Is `packages/` read at all?** Checked directly — the one textual
   match for `"packages"` traced precisely to an unrelated field name
   (`LockFile.packages`, the locked-dependency map inside a
   `LockFile` object), not a reference to a real `packages/` folder.
   Confirmed: zero real code references the `packages/` folder
   proposed in Decision 1 — expected and correct, since Decision 1 is
   conceptual only, not yet implemented.
6. **Who decides a folder is a Package?** No code anywhere makes this
   determination today — confirmed by the combined absence found in
   questions 1–5.
7. **When would this happen relative to `Resolve` and the
   Compiler?** Not applicable — there is currently no real "when,"
   since the mechanism itself does not exist.

### Honest conclusion

**Discovery does not exist in any form today** — not filesystem
scanning, not manifest reading, not explicit registration, not a
bootstrapping entry point. Two real false-positive matches were found
and precisely ruled out during this search (`DriverRegistry` vs
`PackageRegistry`; `LockFile.packages` vs a real folder reference) —
disclosed rather than glossed over, since conflating either would
have produced a false "discovery exists" conclusion.

**Status: Discovery Evidence Collection complete. Not proposing any
mechanism yet — awaiting review before proceeding further.**

## Step 4: Registration Evidence / Resolution Boundary Evidence (per direct instruction, zero code touched)

**Question**: if a package were discovered in the future, what
entity should be registered, who owns that registration, and what is
the real boundary between `Package Registry`, `Package Resolver`, and
`Module Resolver`?

### What gets registered today — real evidence

`PackageRegistry.register(pkg: RegistryPackage)` — confirmed
directly, `RegistryPackage` already carries, per version
(`RegistryPackageVersion`): `version`, `integrity` (content hash),
**`resolved: string`** (real doc comment: `"Download URL or local
cache path"`), and `dependencies`. This field already existed in the
codebase — it was not invented for this investigation.

### Decisive finding: the real boundary is already visible in `Resolver.resolve()`'s own code

Traced directly (`resolver.ts`): the same single `resolve()` call
produces **two distinct real entities** from the same registry
`entry`:

```typescript
const node: PackageNode = { name, version, dependencies };
// ^ no `resolved` field at all

const locked: LockedPackage = { name, version, integrity,
  resolved: entry.resolved, dependencies };
// ^ carries the real physical reference
```

`PackageNode` (populates `ResolveOutput.buildOrder`) is **purely
semantic identity — no physical location, by construction**.
`LockedPackage` (populates `ResolveOutput.lockFile.packages`) carries
**identity + the real physical reference together**. These are
already two separate, real, distinct shapes produced by the exact
same resolution step — this is not a new design; it already exists.

### Answering the boundary question with this real evidence

- **Package Registry** owns: the full catalog (`RegistryPackage`,
  every published version, each version's own `resolved` reference)
  — the source `Resolver.resolve()` reads from.
- **Package Resolver** owns: turning a version constraint into one
  chosen `PackageNode` (semantic) **and** one `LockedPackage`
  (semantic + physical) — both real, both already produced today,
  confirmed side-by-side in the same function.
- **Module Resolver** (not yet real, per every prior investigation
  step) would need to consume the **`LockedPackage`** shape
  specifically — not `PackageNode` — since only `LockedPackage`
  carries a real physical reference at all. Consuming `PackageNode`
  alone would repeat the exact mistake already avoided earlier in
  `Integration Contract v1.0`'s own work (fabricating a physical
  location that isn't really there).

### What this does NOT yet answer, per direct instruction

This evidence clarifies which existing shape *would* need to reach
`Module Resolver` if wiring ever happens — it does **not** establish
that `resolved` (a `Download URL or local cache path`, per its own
real doc comment) is the same kind of value as `packages/`'s own
local filesystem `resolvedPath` used throughout `Integration Contract
v1.0`. A registry-style `resolved` reference (URL or cache path) and
a real local directory path are not proven equivalent — this
remains open, not resolved here.

**Status: Registration/Resolution Boundary Evidence complete. Four
Evidence phases now closed (Lifecycle, Ownership, Discovery,
Registration/Boundary) — awaiting review before any Alternatives
comparison.**

## Evidence Question 5: `LockedPackage.resolved`'s real lifecycle (per direct instruction, before any Alternatives comparison)

**All 7 sub-questions answered with direct evidence, zero code
touched**:

1. **Who writes `resolved`?** Traced every real assignment: `resolver.ts:130` copies `entry.resolved` (from `Registry`) into `LockedPackage`; `cache.ts`'s own `put()` copies `entry.resolved` (from `RegistryPackageVersion`) into `CacheEntry`; `manifest.ts` copies it further into/from `JSON` serialization. **Confirmed: every single site is a pass-through copy — no code anywhere constructs or computes an original `resolved` value.** The real, original value only ever enters the system via whatever a caller supplies when first constructing a `RegistryPackageVersion` (i.e. at `register()` time).
2. **Is it a URL or a filesystem path in real use?** Neither is enforced — confirmed: it is an unconstrained `string` field throughout every real interface (`RegistryPackageVersion`, `CacheEntry`, `LockedPackage`), with its own doc comment stating both are valid (`"Download URL or local cache path"`). No real code anywhere validates or distinguishes the two.
3. **Does it change with `install`?** No — `cmdInstall`'s own real logic (confirmed earlier) only mutates `Manifest.dependencies`; it never touches a `RegistryPackageVersion`'s own `resolved` field.
4. **Does `CacheEntry.resolved` take its value from it?** **Yes, confirmed directly** — `PackageCache.put()`'s own real code copies `entry.resolved` straight through, unchanged.
5. **Any function converting `resolved` into a real local filesystem location?** **Confirmed: none exist anywhere in `urpm`** — searched directly for any download/extraction/local-path-resolution logic (`toLocalPath`/`resolveLocal`/`downloadTo`/`extractTo`), and even for a literal `https://` usage anywhere — zero matches for all of them.
6. **Could a future Module Resolver consume it directly?** Not safely, per this evidence — since `resolved` is proven to be an uninterpreted free-text value with no real guarantee of being a local path at all, consuming it directly would risk exactly the same class of error `Integration Contract v1.0` already guarded against (treating an unvalidated value as a real local location).
7. **What happens when `resolved` is a URL, not a local path?** Nothing today — no code branches on this distinction anywhere; a URL and a local path are handled completely identically (i.e., not handled — merely passed through) by every real function that touches this field.

### Conclusion — kept explicitly open, per direct instruction, not converted by assumption

`resolved` is confirmed to be a real, but entirely uninterpreted,
free-text pass-through value across the whole of `urpm` — no code
distinguishes a URL from a local path, converts one to the other, or
validates either. **Its relationship to `Integration Contract
v1.0`'s own local `resolvedPath` remains unproven.** They are not
confirmed to be the same kind of value, and this investigation does
not claim otherwise — `LockedPackage` remains only a real
*candidate* to bridge Package Resolution and Module Resolution, not
a proven one.

**Status: Evidence Question 5 closed. Five Evidence phases now
complete (Lifecycle, Ownership, Discovery, Registration/Boundary,
`resolved`'s own lifecycle). Ready to proceed to Alternatives only
after this is reviewed.**

## Alternatives: Evidence → Consequences → Failure Cases Matrix (per direct instruction, before Decision 2)

**Explicit constraint carried forward, per direct instruction**:
`LockedPackage` is the closest existing entity to a `Package →
Consumer` boundary, but `resolved` is not yet a proven Location
Contract — no alternative below is permitted to silently redefine
`resolved`'s own meaning or reuse `resolvedPath` without its own
explicit decision.

### Evidence → Consequences → Failure Cases

| Alt | Real Evidence | Consequences | Primary Failure Case |
|---|---|---|---|
| **A — `resolved` becomes Local Path exclusively** | Contradicts the already-confirmed evidence directly (`resolved`'s own real doc comment: `"Download URL or local cache path"`; zero code today enforces or restricts it to a local path) | Simplest possible integration if adopted, but **requires redefining an existing field's own real, already-documented meaning** | A real, already-published `RegistryPackageVersion` with a genuine URL value would silently become invalid under this alternative — a real breaking redefinition, not an extension |
| **B — `resolved` stays a general Reference + new Location Resolver layer** | Matches the real separation already found in this investigation (`PackageNode` vs `LockedPackage`, `PackageLocationValidator`'s own prior real precedent of being a separate layer) | Preserves `urpm` exactly as-is; the new layer's own job is precisely translating an opaque `resolved` reference into a real `ResolvedPackageLocation` | Requires building a new, real component — none of its own logic exists in the codebase today |
| **C — `Cache` owns the translation** | `PackageCache` already exists and already stores `resolved` per entry (confirmed: `put()` copies it through) — but confirmed earlier: zero download/extraction/local-resolution logic exists anywhere in `cache.ts` today | Would mean `Cache`'s own real responsibility grows to include translation, not merely storage | **Real evidence directly contradicts this alternative's own premise** — `Cache` today only stores an opaque string; it does not download, extract, or resolve anything to a real local path |
| **D — Consumer Adapter (Compiler reads `LockedPackage.resolved` via an Adapter)** | Minimal `urpm`-side change | Least invasive to `urpm` itself | **Reintroduces exactly the real risk this whole investigation exists to prevent** — Package-semantics knowledge (interpreting what `resolved` means) accumulating inside the Compiler/CLI layer, the same anti-pattern already identified and corrected once (`resolveAndMergeImports` itself embedding resolution logic it should not own) |

### Tested against all 10 specified cases

| Case | A | B | C | D |
|---|---|---|---|---|
| `resolved` = local path | Trivially works (definition matches) | Works — Location Resolver passes it through unchanged | Works if `Cache` merely validates existence | Works, but Compiler itself must know this case exists |
| `resolved` = URL | **Breaks by definition** — this alternative redefines the field to disallow it | Works — Location Resolver's own real job is handling exactly this case | Contradicts C's own real evidence (`Cache` has no real download capability today) | Compiler itself must implement URL handling — exactly the accumulation risk `D` already carries |
| Package not found | Unaffected — this is `Package Resolver`'s own existing `F1`, untouched by any alternative | Same — `F1` stays with `Package Resolver` | Same | Same |
| Package resolved semantically but location unconsumable | This is exactly `F2` — `A` cannot express this case, since it assumes `resolved` is always a valid local path by definition | `F2` is precisely the Location Resolver's own real job to detect | `Cache` would need real validation logic it does not have today | Compiler itself must detect and report this — the same accumulation risk again |
| Two different versions of the same Package | Unaffected — owned entirely by `Package Resolver`'s own existing `pickBestVersion`, untouched by any alternative | Same | Same | Same |
| Package with multiple Modules | Unaffected — belongs to `Module Resolver`, per `ADR-007`'s own already-decided `Module Identity`, untouched by any alternative | Same | Same | Same |
| `import A → B → C` | Unaffected — `urpm`'s own already-real recursive resolution (`dependency-graph.ts`) handles this regardless of which alternative is chosen | Same | Same | Same |
| No `FRI`/`manifest.json` mixed into `UR→UR` | Held by all 4 — none of them touch `ur_packages/`'s own official `FRI` space | Held | Held | Held |
| `ur_packages/` not converted into a Package Store beyond Decision 1 | Held by all 4 — none of them touch `ur_packages/` at all | Held | Held | Held |
| `resolved` not given new meaning without an explicit decision | **Violated by definition** — `A` *is* a redefinition of `resolved`'s own meaning | Held — `B` explicitly keeps `resolved` as-is, translating it in a separate layer | Held, in principle — though `C`'s own real premise is already contradicted by evidence | Held — `D` does not touch `resolved`'s own definition, only where it is consumed |

### Result, per direct instruction — no premature choice

`A` is eliminated directly by evidence — it requires a real,
breaking redefinition of an already-documented field. `C` is
eliminated directly by evidence — its own premise (`Cache` as
translator) directly contradicts what `cache.ts`'s own real code
does today. `B` and `D` both remain viable, differing precisely on
*where* the translation-of-an-opaque-reference responsibility should
live — `B` as a new, dedicated layer, `D` inside the Compiler/CLI
layer (the same real tradeoff already identified once regarding
`PackageLocationValidator`'s own placement, per direct instruction's
own recorded rationale then: keeping Compiler/CLI from accumulating
Package-Resolution-adjacent responsibilities).

**Status: Alternatives comparison complete. Awaiting the project
owner's own choice between `B` and `D` before `Decision 2` is
recorded — the evidence eliminates `A`/`C` but does not by itself
compel one of `B`/`D` over the other.**

## Decision 2A: Reference Semantics — DECIDED (`B`)

**Decision, recorded precisely at the architecture level only**:

> `resolved` remains a general Reference — it is never redefined as a
> physical local path. Translating that Reference into a Physical
> Location is the responsibility of a dedicated layer, separate from
> both `Package Resolver` and the `Compiler`.

```
Package Registry
      │
      ▼
Package Resolver
      │
      │  resolved = URL | local reference
      ▼
ResolvedPackageReference
      │
      ▼
Package Location Resolver
      │
      │  → physical local path
      ▼
resolvedPath
      │
      ▼
PackageLocationValidator
      │
      ├── F2
      │
      ▼
Module Resolver
      │
      ▼
index.ur / selected Module
```

### Ownership table, recorded verbatim

| Responsibility | Owner |
|---|---|
| Package identity | Package Resolver |
| Version resolution | Package Resolver |
| Dependency graph | Package Resolver |
| `resolved` reference | Package/Registry |
| Translating reference → local location | Location Resolver |
| Physical location validation | `PackageLocationValidator` |
| Module selection | Module Resolver |
| Reading/parsing `index.ur` | Module/Compiler |

### Critical distinction, per direct instruction — Location Resolver ≠ Location Validator

Two genuinely different responsibilities:
- **Location Resolver**: "where does this package actually live?"
- **Location Validator**: "is the location the Resolver gave me valid
  and consumable?"

```
resolved → Location Resolver → resolvedPath → Location Validator
                                                    │
                                                    ├── F2
                                                    ▼
                                              Module Resolver
```

This makes the already-implemented `PackageLocationValidator` fully
reusable, unchanged in meaning — it validates whatever `resolvedPath`
it is given, regardless of how that path was produced.

### Three explicit boundaries this decision does NOT cross

1. Does `Location Resolver` support URLs (download/extract/cache)? —
   **not decided here.**
2. Is `packages/` the local source, an installed store, or something
   else? — **not decided here.**
3. Who owns `Cache`, and what is the real precedence between
   workspace/local/installed/registry packages? — **not decided
   here.**

All three belong to `Decision 2`'s own remaining work, not to
`Decision 2A`.

## Next step: Location Resolution Ownership Investigation (per direct instruction — zero code touched)

**Single question**: what can the current system actually do with a
local `resolved` value versus a URL `resolved` value today, and who
should own the translation to a physical location?

No `PackageLocationValidator`, `Compiler`, or `urpm` file is touched
until this investigation is complete.

### Decisive first finding

**Confirmed via direct, project-wide search — zero download
infrastructure and zero archive-extraction capability exist
anywhere.** No `axios`/`node-fetch`/`got`-style dependency in the
root `package.json`; zero real code anywhere handling `tar`/`gzip`/
`zip` extraction.

**Real consequence**: a local `resolved` value (a real, existing
filesystem path) is the **only** case the current system could
realistically support today — merely by pointing at it. A URL
`resolved` value would require building an entirely new
infrastructure (download + extraction + real cache storage) from
nothing — none of it exists today, not partially, not as a stub.

**This does not yet decide who should own that future infrastructure
or whether it belongs in this investigation's own scope** — it only
establishes, with direct evidence, the real starting line: today,
only the local-path case is realistically actionable without new,
substantial implementation work.

## Local Reference Semantics (per direct instruction, before any Location Resolution Contract)

**Explicit correction carried forward, per direct instruction**: the
absence of HTTP/archive infrastructure proves `URL` is unconsumable
today — it does **not** by itself prove `resolved` should always be
interpreted as a local path. This distinction is preserved throughout
what follows.

**All 6 sub-questions answered with direct evidence, zero code
touched**:

1. **What local reference forms can the current system actually
   interpret?** Confirmed: **none, in any distinguishing sense** —
   searched directly for `isAbsolute`/`path.resolve`/`path.relative`
   anywhere in `urpm`'s own real code; zero matches. `resolved` is an
   uninterpreted string throughout — no code anywhere checks whether
   it is absolute, relative, a cache-style key, or any other form.
2. **Who owns relative → absolute conversion?** No one — confirmed by
   the same absence in item 1.
3. **What is the base directory?** Undefined — this question has no
   real answer today, since no conversion logic exists to need one.
4. **Can `resolved` point directly to `packages/mathlib`?** No real
   evidence either way — confirmed (per the earlier Discovery
   investigation) that zero code references the `packages/` folder
   at all; there is no real link between `resolved` and any
   particular directory, `packages/` included.
5. **Does any real physical cache lifecycle exist beyond
   `cache.ts`'s own in-memory data?** Confirmed: no — searched
   directly for any real cache directory convention
   (`.urpm-cache`/similar); zero matches. `PackageCache` is a purely
   in-memory `Map`, with no real disk-backed persistence lifecycle
   anywhere.
6. **Is a local `resolved` value consumed by any real consumer
   today?** Confirmed: no — `PackageLocationValidator`'s own file
   remains the only file referencing itself (the same isolation
   already found in the earlier Post-PR Boundary Audit); it has never
   once received a real `resolved` value from `urpm` itself — every
   existing use is a hand-constructed `ResolvedPackage` in its own
   test file only. This is confirmed to be a **stored reference**
   with no real, corresponding **consumed filesystem location**
   anywhere in the project.

### Honest, un-forced conclusion

```
resolved(local)
    ↓
❌ No sufficient semantics exist today
    ↓
A real Local Reference Contract must be defined first
```

Per the standing discipline — this is recorded as a real
architectural gap, not papered over by inventing a contract merely to
make `PackageLocationValidator` connectable. No format, no base
directory, no conversion ownership, and no real consumer exist today
for a local `resolved` value — exactly as much of a genuine gap as
the `resolve → consume` gap already found and honestly recorded
throughout `ADR-006`/`007`.

**`PackageLocationValidator` is not modified.** Its own real role
remains exactly as already decided: it validates whatever
`resolvedPath` it is given — this finding does not change that; it
establishes that nothing today produces a real `resolvedPath` for it
to validate.

**Status: Local Reference Semantics investigation complete. Before
any Location Resolution Contract can be written, a real, separate
architectural decision is needed — defining the Local Reference
Contract itself (format, base directory, ownership) — since evidence
confirms none exists today.**

## Decision 2B: Local Reference Contract Investigation (per direct instruction, alternatives A/B/C/D, no premature choice, zero code touched)

### Real evidence found first — an existing, unofficial convention

Confirmed directly: the current, real, production `CLI`
(`resolveAndMergeImports` and every other real path-building site in
`src/cli/index.ts`) uses **`process.cwd()`** as its own implicit base
for every real path it builds (`ur_packages/<x>/index.ur`, output
paths, etc.) — there is no formally-defined "project root" file or
concept anywhere; `cwd()` at run time is the only real precedent that
exists.

### Decisive portability test — real evidence against `A`

`urpm`'s own real `README.md` describes its lock file (`urpm.lock`)
explicitly as **"fully-resolved, content-addressed"** — the same
real term used by genuine package managers (`npm`/`Cargo`) to mean
content is identified by an `integrity` hash, not a machine-specific
path. This is real, documented design intent (even though the
lockfile itself is not yet persisted to disk, per the earlier
finding) — and it directly argues against `A` (`Absolute filesystem
path`): a content-addressed lock file's own real purpose is
portability across machines/projects, which an absolute path
directly undermines.

### The 5 questions, answered honestly — kept open where evidence is insufficient

1. **Identity**: does a local reference represent a `Package` root or
   another artifact? — **No real evidence either way** — confirmed:
   zero code today constructs or consumes a local `resolved` value at
   all (per the prior investigation), so there is no real usage
   pattern to observe.
2. **Base**: relative to what? — The only real, existing precedent is
   `process.cwd()` (confirmed above) — not a formally-defined
   `project`/`workspace` root. Whether this precedent should become
   the real contract, or a more formal root should be introduced
   instead, is not settled by this evidence alone.
3. **Canonical form**: relative, absolute, or a `URI`-like reference?
   — Real evidence (the `content-addressed` design intent) argues
   directly against `A`. It does not, by itself, choose between `B`
   and `C`.
4. **Ownership**: who converts the reference to a physical location?
   — Already settled by `Decision 2A`: a dedicated `Location
   Resolver`, never `Package Resolver` or the `Compiler`.
5. **Persistence**: where would this relationship be stored if it
   became part of the lifecycle? — `LockFile.packages` is the only
   real, existing candidate structure (confirmed to already carry a
   `resolved` field per package) — but it is not yet persisted to
   disk in any real, working form (confirmed in the earlier Lifecycle
   Evidence Collection).

### Alternatives, ranked by evidence — no premature final choice

- **`A` (Absolute path)** — **weakened directly by real evidence**:
  contradicts `urpm`'s own documented `content-addressed`,
  portability-oriented design intent.
- **`B` (Project-relative reference)** — consistent with the one
  real, existing precedent (`cwd()`-based resolution already used in
  production) and with the portability intent — but requires
  formally defining what "project root" means, which does not exist
  today.
- **`C` (Logical local URI/reference)** — consistent with the
  portability intent, cleanly separates logical identity from
  filesystem representation — but introduces a real abstraction with
  zero existing precedent anywhere in this project.
- **`D` (Do not define Local Reference now)** — a real, legitimate
  option if the evidence shows the lifecycle has not matured enough
  to need this yet, which the evidence largely does show (per the
  extensive Lifecycle/Ownership/Discovery/Registration findings
  already recorded).

**`PackageLocationValidator` is not touched.** Its own role is
unaffected by any of this — it validates whatever `resolvedPath` it
receives, however that path eventually comes to exist.

**Status: Decision 2B investigation complete. `A` is weakened by
direct evidence; `B`/`C`/`D` all remain genuinely viable. This is a
real architectural choice for the project owner — not one the
evidence alone compels among `B`/`C`/`D`.**

## Decision 2B: FINAL — Project-relative Local Reference (`B`)

**Precision correction, per direct instruction — recorded before the
decision itself**: the evidence proves `actual base = process.cwd()`
today. It does **not** prove `process.cwd() = Project Root` as a
formal concept. This distinction is preserved throughout the decision
below — a real, current-implementation convention is recorded, not a
new abstraction invented from it.

> `Local Reference Contract` uses a project-relative path,
> interpreted relative to the process execution root
> (`process.cwd()`) in the current implementation. A formal `Project
> Root` abstraction is **not** introduced by this decision.

### Conceptual contract

```
LocalPackageReference
    = path relative to execution root

e.g. resolved = "packages/mathlib"   ✅
     resolved = "C:\project\packages\mathlib"   ❌ (never canonical)

process.cwd()
      +
resolved (project-relative)
      ↓
Location Resolver
      ↓
resolvedPath (physical location)
      ↓
PackageLocationValidator
```

### Corrected `LockFile` framing, per direct instruction

Not recorded as: *"`LockFile` decided `resolved` must be
project-relative."* Recorded precisely as:

> `LockFile` semantics practically exclude relying on absolute local
> paths as a portable identity; the precise canonical form of a local
> reference remains its own separate decision — which this record
> (`2B`) now makes, informed by but not derived solely from that
> exclusion.

### Explicit non-decisions

- `process.cwd()` is **not** declared a formal Project Root.
- Absolute paths are **not** canonical references.
- Logical URI syntax (`C`) is **not** introduced.
- URL resolution/download is **not** introduced.
- Cache semantics are **not** introduced.

### Final open question, answered before closing this record

**Is `packages/mathlib` merely a convention example, or does
`packages/` need to become part of the `Local Reference Contract`
itself?** Answered directly from `Decision 1`'s own already-recorded
boundary: `Decision 1` explicitly established `packages/` as
*location only* — never an Installed Store, Registry, or Cache, and
granted no additional semantics. `Decision 2B` does not need to grant
any either — `packages/mathlib` is used here purely as an example of
the general *shape* (a project-relative path), not as a special case
requiring its own rule. This composition is legitimate precisely
because `2B` adds no new obligation onto `packages/` beyond what `1`
already decided.

### Roadmap, recorded for continuity

```
Decision 1  — where do UR→UR packages live?        → packages/
Decision 2A — reference semantics                    → general Reference (B)
Decision 2B — local reference form                    → project-relative (B)
Decision 2C — physical conversion                      → Location Resolver (owner, not yet built)
Decision 2D — Lifecycle / Consumption                    → still open
```

**`PackageLocationValidator` remains untouched.** No code is written
for `Decision 2B` itself — it is a conceptual contract, matching
`Decision 2A`'s own precedent.

## Decision 2C: Physical Location Resolution — Investigation

### Decisive discovery: a real, third, isolated parallel system exists

**Confirmed via direct search, per direct instruction's own critical
question ("who actually consumes the resulting path?") — before
comparing any alternatives**: `src/compiler/module/`
(`import-resolver.ts`, `export-checker.ts`, `registry.ts`,
`module-descriptor.ts`) is a **real, genuinely functional Module
Resolution system** — with a real consumer chain
(`export-checker.ts:170`: `registry.get(imp.resolvedPath)`) — that
**already answers many of `2C`'s own real sub-questions** with real,
existing code.

**But confirmed, via the same rigor already applied twice before
(`urpm`, `PackageLocationValidator`)**: a direct, project-wide search
finds **zero import** of anything in `src/compiler/module/` from
anywhere outside itself. This is a **third real, isolated system** —
functionally complete, but with no production consumer, matching the
exact pattern already found and disclosed honestly in `ADR-006` and
the Post-PR Boundary Audit.

### Real evidence extracted from this isolated system for `2C`'s own sub-questions

1. **Canonicalization**: real and already implemented —
   `toCanonical()` normalizes a path via `normalizePath()` before
   returning it as `resolvedPath`.
2. **Containment within a package space**: a real, existing concept —
   `config.packagesRoot` (confirmed: a real, formal root concept,
   distinct from `CLI`'s own bare `process.cwd()` convention found
   earlier — this system has what `Decision 2B` explicitly declined
   to introduce).
3. **Path traversal (`../`)**: confirmed real precedent — `toCanonical()`
   explicitly handles `../`-prefixed paths via `normalizePath`, with
   **no real prohibition** against traversal found anywhere in this
   code.
4. **Symlinks**: not yet checked — requires further real evidence
   before answering.
5. **Error boundary**: real, existing, already-distinct error kinds —
   `{kind: "missing"}` and `{kind: "circular"}` — confirmed separate
   from any `F1`/`F2` vocabulary used elsewhere in this document; this
   system's own real error classification was built independently.
6. **Existence of the path**: `toCanonical()`'s own real logic
   produces a canonical string — whether it separately confirms real
   filesystem existence requires further evidence, not yet checked.

### Critical implication, per direct instruction's own standing concern

This is not evidence that `2C` should simply adopt
`src/compiler/module/`'s own real design — it is evidence that **a
real precedent already exists for several of `2C`'s open questions**,
and that this project has a real, recurring pattern of building
functionally complete systems with zero production wiring. Before any
`2C` alternative comparison, the same critical question already
raised must be answered here too: **would a `2C` design building on
this precedent inherit the same isolation, or does a real path to
production consumption exist that the earlier systems lacked?**

**Status: investigation continuing — symlink handling and real
filesystem-existence checking still need direct evidence before the
6 sub-questions are fully answered.**

### Symlink Semantics and Physical Existence — resolved with direct evidence

**Both confirmed via direct, comprehensive search — zero results for
either**: `src/compiler/module/`'s own real code contains no use of
`realpath`/`realpathSync`/`lstat`/`readlink` anywhere (symlink
resolution), and no use of `existsSync`/`statSync`/`accessSync`/
`readdirSync`/any real `fs` filesystem function anywhere (physical
existence checking).

**Precise conclusion, per direct instruction's own framing**:
`toCanonical()` performs pure **Lexical Canonicalization**
(`normalizePath` on a string) — never real **Physical Resolution**.
The distinction the investigation asked to preserve:

```
normalize("packages/a/../b")  →  "packages/b"   (Lexical — confirmed real)
realpath("packages/link")     →  "/actual/..."  (Physical — confirmed NOT present anywhere)
```

`resolvedPath` in this system is a **Canonical Logical Path**, never
a **Validated Physical Location**. This decisively confirms — with
direct evidence from this real, existing precedent itself — that
`Location Resolver ≠ Location Validator` is not merely a proposed
separation but the exact shape already found in this project's own
existing (if isolated) code: even this precedent performs zero
physical validation of its own, matching precisely why
`PackageLocationValidator` was designed as a separate layer.

### All 6 sub-questions now fully answered

| Sub-question | Answer | Status |
|---|---|---|
| Canonicalization | Real, lexical only | ✅ |
| Containment (`packagesRoot`) | Real concept exists, not yet proven part of the `UR` package production contract | ✅ |
| Path traversal (`../`) | Supported, no prohibition found | ✅ |
| Symlink semantics | **Absent — no real symlink resolution anywhere** | ✅ |
| Error boundary | Real, distinct (`missing`/`circular`), independent of `F1`/`F2` | ✅ |
| Physical existence | **Absent — zero real filesystem check anywhere** | ✅ |

### Honest answer to the precedent-reuse question

This precedent is valuable evidence for `2C`'s own conceptual shape
(lexical canonicalization, a real `containment` concept, real
distinct error kinds) — but it is **not** itself a validated
production contract, and it does **not** perform physical validation,
so it cannot be adopted wholesale as `2C`'s own answer without
`PackageLocationValidator`'s own real role remaining necessary
afterward exactly as already designed. **This is a real precedent to
learn from, not a system to copy verbatim.**

**Status: Evidence Collection for `2C` complete. `PackageLocationValidator`
is not modified — its own role (physical validation) remains
distinct from and necessary alongside any `Location Resolver` design,
confirmed rather than weakened by this investigation. Ready to trace
`resolvedPath`'s full shape from production to consumer, then compare
`2C` alternatives — not yet done.**

## `ResolvedPath` Trace — Production Entry to Real Consumer

**First, confirmed directly**: `src/cli/index.ts` (the real production
entry point) calls **zero** function from `src/compiler/module/`
anywhere — matching the same isolation pattern already found.

**Traced directly within `resolveAndMergeImports` itself — the one
real, production-used mechanism**:

| Question | Answer, with direct evidence |
|---|---|
| Where is `resolvedPath` created? | One line: `resolve(process.cwd(), "ur_packages", importPath, "index.ur")` — `candidatePath` |
| What is its real type? | **Always absolute** — `Node.js`'s own `path.resolve()` is documented to always return an absolute path |
| Does it change after creation? | No — used directly, unchanged, from creation through consumption |
| Stored by `Registry`/`Resolver`/`LockFile`? | No — a local, transient value inside a `for` loop; never persisted or exported |
| Does `Module Resolver` receive it directly or via an Adapter? | **No separate `Module Resolver` exists here at all** — the same function reads the file (`readFileSync`), lexes, parses, and merges — all in one step |
| More than one representation between source and consumer? | No — one string representation, from creation straight through to `readFileSync` |
| Where should the real boundaries fall? | They currently **do not exist as separate layers at all** in the real production path — `Reference Resolution`, `Canonicalization`, `Physical Validation`, and `Module Selection` are all fused into one function |

### Decisive discovery

The real production path is confirmed to be a **fourth, distinct
system** — not matching any of the three carefully-designed
architectural systems already found (`urpm`, `PackageLocationValidator`,
`src/compiler/module/`). It uses a simpler, unlayered approach:
`resolve()` + `existsSync()` + `readFileSync()`, directly, with no
architectural separation at all.

**This confirms the real architectural finding, exactly as
anticipated**: the challenge is not choosing a `Location Resolver`
algorithm in isolation — it is that **four separate systems exist**
(three carefully-designed and isolated, one real-but-unlayered in
production), **and no real convergence point exists among any of
them**. Any `2C` design must account for this real production
reality — not assume any of the three isolated systems is the
starting point, since none of them is what actually runs today.

**Status: Trace complete. `2C` alternatives comparison can now
proceed, grounded in the real production shape (unlayered,
absolute-path, single-function) rather than any of the three isolated
precedents alone.**

## Production Reference Semantics (per direct instruction, before Decision 2C's own alternative choice)

**All 8 questions answered with direct evidence, zero code touched**:

1. **What is the real `importPath`?** `imp.path.join("/")` — `imp.path`
   is the parser's own real `ImportDecl.path: string[]` array,
   confirmed to come directly from lexing/parsing the source text,
   *before* any semantic resolution occurs.
2. **Does `importPath` equal `Decision 2A`'s own `resolved` concept?**
   **No — confirmed two entirely separate data sources.** `importPath`
   originates from the parser; `resolved` (per `Decision 2A`'s own
   real evidence) originates from `urpm`'s `RegistryPackageVersion`.
   They share no real connection in the current codebase.
3. **Is `ur_packages/<importPath>/index.ur` merely an old
   convention?** Confirmed via the code's own real comment:
   `"Phase 0-A (per explicit direction)"` — a documented, intentional
   scope boundary, not an accidental legacy artifact.
4. **Can `packages/<importPath>/index.ur` represent this without
   changing `import`'s current meaning?** **Confirmed live, decisively
   — yes.** A real, direct replication of the exact same `resolve()` +
   `existsSync()` + `readFileSync()` sequence, using `packages` instead
   of `ur_packages`, succeeded identically (`Parser: PASS`,
   `functions: ["add"]`). The mechanism itself carries zero embedded
   dependency on the literal string `"ur_packages"`.
5. **Are relative imports (`./x`, `../x`) supported?** **Confirmed
   live — no.** The parser rejects `.` immediately after `import`
   (`PE001: Expected module name... got '.' (DOT)`).
6. **Are imports for Packages only, or Modules too?** Per the earlier
   Module Addressing investigation: `import mathlib.algebra` already
   resolves to a nested folder — the mechanism does not distinguish
   "Package" from "Module" as separate concepts; every import
   resolves through the exact same single mechanism regardless of
   depth.
7. **Does `resolveAndMergeImports` distinguish Package / Module / FFI
   / local file?** Only one real distinction exists: `UR→UR` (via
   `index.ur`) vs `FFI` (via `manifest.json`, a separate branch) — no
   further distinction between "Package" and "Module" exists within
   the `UR→UR` branch itself.
8. **What would happen if `ur_packages/` were replaced with
   `packages/` per `Decision 1`?** **Confirmed live**: nothing
   mechanically breaks — the swap works identically, since the real
   mechanism is folder-name-agnostic.

### Resolving the Reference Model Gap

The gap identified (`Decision 2B`'s own `"packages/mathlib"` concept
vs. the real production `candidatePath`) is now closed by direct
evidence: `importPath` (the parser's raw path segments, joined) is
**exactly** the real, existing input that a `Decision 1`-compliant
`packages/` swap would use unchanged. This is not `Decision 2A`'s own
`resolved` (a `urpm`-sourced concept) — it is a separate, real,
already-functioning production input that `Decision 2B`'s own
`project-relative` reference form is fully compatible with, without
requiring `urpm` itself to be wired in first.

### Effect on the Alternatives comparison

This directly strengthens **`B`** (Location Boundary only, within the
current production path) as the real, evidence-backed `2C`
candidate — it operates on `importPath`, a real, already-functioning
production value, without claiming semantic Package Resolution has
occurred (avoiding the exact naming trap the earlier record warned
against: the output of this boundary must not be called
`ResolvedPackage` unless real semantic resolution actually occurred).
`A` (full four-layer rebuild) remains valid but overly broad for
`2C`'s own real scope; `C` (Adapter aggregating all 3 isolated
systems) remains not recommended, per the same reasoning already
recorded; `D` (defer entirely) remains legitimate but forfeits this
newly-confirmed real evidence.

**Status: Production Reference Semantics investigation complete. `B`
is now the strongest evidence-backed candidate — not yet a final
Decision, awaiting review before `Decision 2C` is closed.**

## Decision 2C: FINAL — `B` (Production Local Location Resolution Boundary)

**Conceptual correction, recorded precisely per direct instruction —
before the decision itself**: `importPath` is not asserted to be
identical to `Decision 2A`'s own `resolved`. They remain two real,
distinct sources today (`Parser`'s raw path vs. `urpm.Registry`'s
`RegistryPackageVersion.resolved`) — this decision states only that
`importPath` **is a legitimate real production source** for the local
reference `Decision 2B` already defined, not a retroactive merger of
the two concepts.

**Decision, recorded verbatim**:

> The production `UR→UR` import path SHALL resolve its local package
> reference from the parser-provided `importPath`, interpreted
> according to `Decision 2B` as a project-relative reference rooted
> at `process.cwd()`. Location Resolution SHALL produce a canonical
> logical filesystem path. Physical existence validation remains the
> responsibility of `PackageLocationValidator`. This decision does
> not introduce Package Registry discovery, `urpm` consumption, URL
> resolution, cache semantics, workspace precedence, or
> Lifecycle/Consumption semantics.

### Explicit boundary

```
Decision 2C
    │
    ├── importPath → local reference        ✅
    ├── process.cwd() as execution root      ✅
    ├── lexical canonicalization             ✅
    ├── physical validation                  → Validator
    │
    ├── urpm discovery                        ❌
    ├── urpm.json discovery                    ❌
    ├── URL/download                            ❌
    ├── Cache semantics                          ❌
    ├── workspace precedence                      ❌
    ├── Installed Store semantics                  ❌
    └── Lifecycle / Consume                         ❌ → Decision 2D
```

## Decision 2C Integration Contract — tested against all 9 specified cases (live evidence, before any PR)

| Case | Real evidence |
|---|---|
| Package not found | Already real today — `F1`'s own existing diagnostic path, unaffected by this decision |
| `index.ur` not found | Same — existing `F1` path, unaffected |
| `../` traversal | **Confirmed by direct test**: the parser requires an `IDENTIFIER` immediately after every `DOT`; two consecutive dots (`..`) cannot be represented in import syntax at all — traversal is syntactically impossible today, not merely unhandled |
| Canonicalization path | **Confirmed live**: `path.resolve()` itself performs implicit normalization (`resolve('/a/b','x','..','y')` → `/a/b/y`) — canonicalization is already free, inherent to the existing mechanism, requiring no new logic |
| `packages/mathlib` multi-depth | Already confirmed working (`mathlib.algebra` → nested folder, per the earlier Module Addressing investigation) |
| `FRI` imports not mixed in | Confirmed structurally separate — the `manifest.json` branch remains its own, untouched path |
| Package root vs. `index.ur` distinction | **Confirmed as the one real gap requiring actual code change**: today's `candidatePath` fuses root and `index.ur` into a single `resolve()` call — a future implementation must split this into two real steps (`packageRoot`, then `resolve(packageRoot, "index.ur")`) for `Location Resolution` and `Module Resolution` to be real, separate steps, matching this Contract's own real intent |
| `F1`/`F2` preserved as defined | Consistent with `Integration Contract v1.0`'s own established meaning — `F1` (not found) untouched; `F2` (location resolved but invalid) is `PackageLocationValidator`'s own real, existing, unchanged role |
| No fake `ResolvedPackage` naming | Enforced by this record's own wording — the output of `Decision 2C`'s own boundary is a canonical local path, never labeled `ResolvedPackage`, since no real semantic Package Resolution occurs here |

**Result: the Contract holds for all 9 cases.** One real, necessary
code change is identified for a future implementation (splitting
`packageRoot` from `index.ur` selection) — not yet written.

**Status: `Decision 2C` is closed. Choosing `B` and implementing `B`
remain strictly separate, per direct instruction — the choice is now
justified; implementation has not begun. No PR is opened at this
stage.**

---

# Decision 2D: Lifecycle & Consumption — Evidence Collection

**Per direct instruction: Evidence only, zero code, before any
alternatives or decision.** This consolidates every relevant finding
already recorded in this document under the `Decision 2D` lens, and
adds the remaining real evidence not yet gathered.

## Lifecycle boundary

- **Metadata**: a package becomes `Metadata` the moment a
  `RegistryPackage`/`RegistryPackageVersion` is constructed and passed
  to `PackageRegistry.register()` — confirmed real, but confirmed
  (Registration Evidence, earlier) to have zero real caller anywhere
  outside `urpm` itself.
- **Physical reference**: becomes real only once `resolved` is set on
  that same version — confirmed to be an opaque, uninterpreted string
  the caller supplies; `urpm` itself never derives it.
- **Consumable**: never reached today — confirmed exhaustively
  (`ADR-006`/`007`): zero real path from any `urpm` output to the
  Compiler.

## Ownership (consolidated from the earlier Ownership Evidence Collection)

| Data | Real owner today |
|---|---|
| `RegistryPackage` | `PackageRegistry` (in-memory only) |
| `LockedPackage` | `Resolver` (in-memory only, confirmed never persisted to a real `.lock` file) |
| `resolved` | Whoever calls `register()` — confirmed to be nobody in production |
| `resolvedPath` (`Decision 2C`'s own) | Would be `Location Resolver` — not yet built |
| Module consumption | No real owner exists — confirmed absent (`Consume` state) |

## Discovery

- **`packages/<name>/urpm.json` discovery**: **not built** — confirmed
  exhaustively earlier (zero `fs`/`readFileSync`/`existsSync` in
  `urpm`'s own code).
- **Who discovers it**: no one — no code exists to do so.
- **Timing — startup / explicit / on-resolve?** **New evidence,
  confirmed directly**: `src/cli/index.ts`'s own real `main()`
  function performs zero `Registry`/`Discovery` initialization of any
  kind — it is a pure command dispatcher (`init`/`run`/`build`/etc.).
  `PackageRegistry` is never constructed or populated in any real
  `CLI` code path. There is no "startup," "explicit," or "on-resolve"
  discovery today — the question is currently moot, since none of the
  three exists.

## Registration

- **Filesystem → `PackageRegistry`**: no real path exists — confirmed
  by the same Discovery absence above.
- **Persistent or session-scoped?** Moot — `PackageRegistry` is a
  plain in-memory class instance with no real persistence layer at
  all; whether one *would* be session-scoped or persistent is
  undecided because none exists to observe.
- **Is `urpm` a metadata engine only, or a real package manager?**
  Per every real finding gathered across this entire investigation
  (`Lifecycle`, `Ownership`, `Discovery`, `Registration`): **a
  metadata engine only, today** — real, coherent internal logic
  (`SemVer`, constraint satisfaction, dependency graph resolution),
  zero real filesystem materialization or production consumption
  anywhere.

## Resolution chain

`importPath → package identity → registry/package metadata →
LockedPackage → local reference → resolvedPath` — **confirmed to not
exist as one real, connected chain anywhere in this project.** Two
real, separate half-chains exist: (1) `urpm`'s own internal chain
(`RegistryPackage → PackageNode`/`LockedPackage`, fully real but
never receiving a real `importPath` as real input), and (2) the real
production chain (`importPath → candidatePath`, fully real but never
touching `urpm`). `Decision 2C` establishes a real, evidence-backed
boundary for half of chain (2) alone — it does not connect the two
halves.

## Consumption

- **Who consumes `resolvedPath`?** Today: `readFileSync` inside
  `resolveAndMergeImports` itself, directly — no separate `Module
  Resolver` exists in production (confirmed in the `ResolvedPath
  Trace`).
- **Path to `index.ur` → AST**: real and working — confirmed
  throughout `ADR-006`'s own evidence (lex/parse/merge, proven
  end-to-end through `IR`/`C`/execution).

## Failure semantics — the 4 real distinctions requested

1. **`F1`: package not resolved semantically.** Real today, but in a
   narrower sense than `urpm`'s own real `F1` (`Package Resolver`'s
   `undefined`) — the production path's own real equivalent is simply
   "file not found at `candidatePath`," since no semantic resolution
   step exists to fail at.
2. **`F2`: package resolved semantically but location invalid.**
   Confirmed earlier: **currently inseparable from `F1`** in the real
   production path (per the `Critical Finding` recorded during the
   earlier attempted `PackageLocationValidator` wiring) — there is no
   real semantic resolution step whose success could diverge from
   physical validity.
3. **Module-not-found after a successful `F2`.** Not yet a real,
   distinct case anywhere — since `F2` itself is not yet separable
   from `F1`, and no real `Module Resolver` exists to fail
   independently after a successful location step.
4. **`FRI` errors kept separate.** Confirmed structurally real — the
   `manifest.json` branch is a distinct, untouched code path from the
   `UR→UR`/`index.ur` branch; their own respective errors do not mix.

## Explicit caution, per direct instruction — not overstating prior findings

- The live confirmation that `packages/mathlib` works mechanically
  with `resolveAndMergeImports` proves the mechanism is
  folder-name-agnostic — it does **not** prove `packages/` has become
  a Package Store in the full sense; this remains exactly as bounded
  by `Decision 1`.
- `path.resolve()`'s own real, confirmed lexical canonicalization does
  **not** by itself prove physical-location soundness or real symlink
  handling — this remains `PackageLocationValidator`'s own, separate,
  unaffected responsibility.

**Status: Decision 2D Evidence Collection complete — Lifecycle
boundary, Ownership, Discovery, Registration, Resolution chain,
Consumption, and Failure semantics all addressed with direct
evidence, zero code touched. Ready for Alternatives comparison only
after this record is reviewed.**

## Decision 2D — Alternatives Evidence Matrix (per direct instruction, zero code, no premature choice)

**Corrected framing, per direct instruction, carried forward**: this
is not "connecting an existing chain" — it is bridging two real,
disconnected subsystems (`urpm`'s own semantic engine; the real
production import subsystem) across a genuine gap, with `F2` real and
defined at the contract level but **not currently observable as an
independent production state** (since no real semantic resolution
step exists today for physical validity to diverge from).

### Testing A/B/C/D against the 11 critical cases

| Case | `A` (urpm central) | `B` (Lifecycle Adapter) | `C` (Compiler direct) | `D` (defer) |
|---|---|---|---|---|
| Local package | Requires `urpm` to gain real filesystem discovery it lacks today | Adapter handles the real, existing production path; `urpm` untouched | Compiler directly calls `urpm.resolve()` — but `resolve()` has no real local-package concept today (confirmed: no local-vs-registry distinction anywhere in `urpm`) | Unaffected — current mechanism keeps working as-is |
| Package not found | `urpm`'s own real `F1` (`undefined`) — but requires `urpm` to be the entry point, which it isn't today | Adapter can surface the real, existing production "file not found" as its own `F1` without `urpm` involvement | Compiler would receive `urpm`'s own `F1`, but only for packages `urpm` actually knows about — none, today | Real, existing behavior unaffected |
| Dependency conflict | `urpm`'s own real `pickBestVersion` — genuinely `A`'s strongest case, since this machinery already exists and works | Adapter would need to invoke `urpm` for this specifically — a real, legitimate reason to touch `urpm` | Same as `A`, but via direct Compiler coupling — the coupling risk already flagged | Conflict resolution simply doesn't exist — real gap remains |
| Version resolution | Same as above — `urpm`'s own real strength | Same — Adapter can delegate this specific piece to `urpm` | Same functional result, worse coupling | Doesn't exist |
| `LockedPackage.resolved` as URL | Would require `A` to also own download/extraction — confirmed earlier: zero real infrastructure exists for this anywhere | Adapter could reject/defer this case explicitly without inventing infrastructure | Compiler would need to handle this itself — the coupling risk again, now with `URL` handling logic inside the Compiler | Real gap remains, explicitly deferred either way |
| `LockedPackage.resolved` as local reference | Same infrastructure problem as `A`'s URL case — `resolved`'s own real ambiguity applies identically | Adapter is the real, natural place to apply `Decision 2C`'s own already-established `Local Reference Contract` | Compiler would need to know `Decision 2C`'s own contract directly — coupling risk | Unaffected |
| Multiple modules | Not `urpm`'s own concern — already settled by `ADR-007`'s own `Module Identity` (Option A) regardless of which `2D` alternative is chosen | Same — `Module Resolver`'s own real, separate territory | Same | Same |
| `FRI` package | Confirmed structurally separate today (`manifest.json` branch) — no alternative here should touch this; the real risk is only whether an alternative's own new logic accidentally reaches into it | Adapter, by design, sits only in the `UR→UR` path — lowest real risk of `FRI` mixing | Direct Compiler coupling raises real risk of eventually blurring this boundary, per the same reasoning already used to reject `C` (`2C`'s own alternatives) | No new risk — nothing touched |
| Workspace/package distinction | Not resolved by any alternative — this is `Decision 2`'s own already-recorded, explicitly deferred `Scenario 7` | Same — out of scope for all 4 | Same | Same |
| `F1` vs `F2` | Confirmed earlier: **currently inseparable in production regardless of which alternative is chosen**, since none of `A`/`B`/`C`/`D` by itself creates the missing real semantic-resolution step that would make `F2` independently observable | Same real limitation | Same real limitation | Same real limitation — deferred, not solved |
| Compiler consumption | `A` requires `urpm` itself to eventually reach the Compiler — the largest real scope | Adapter is the real, single point that would reach the Compiler, keeping `urpm` and Compiler mutually unaware of each other | Compiler directly depends on `urpm` — the exact accumulation risk already flagged once for `PackageLocationValidator`'s own placement decision | No consumption exists — remains true regardless |
| Re-running from a fresh environment | `A` requires `urpm`'s own real state (`Registry`) to be rebuilt from nothing every time, since no persistence exists | Same real requirement — Adapter does not remove this gap, since `urpm`'s own registration remains unpersisted regardless of which alternative wraps it | Same | Same — the gap is `urpm`'s own, orthogonal to which `2D` alternative is chosen |

### Testing against the 10 Invariants

| Invariant | `A` | `B` | `C` | `D` |
|---|---|---|---|---|
| No automatic `packages/` → Registry conversion | Violated by design — `A` requires exactly this | Held — Adapter, not `urpm` itself, touches `packages/` | Held, in principle | Held — nothing changes |
| Import Resolver not redefined as Package Manager | Held (the redefinition target is `urpm`, not Import Resolver) | Held — Import Resolver remains as `2C` already scoped it | Held | Held |
| No `FRI`/`UR→UR` mixing | At risk — `A`'s own centralization could plausibly reach both, unless explicitly scoped away | Lowest real risk, per case analysis above | Elevated risk, per case analysis above | No risk |
| `PackageNode` not used as physical location source | Held — `PackageNode` never gains a `resolved`-equivalent field under any alternative; this Invariant is about `PackageNode`'s own shape, unaffected by `2D`'s own choice | Held | Held | Held |
| `LockedPackage.resolved` not assumed local without a Contract | Held only if `A` explicitly defers to `2C`'s own already-ratified Local Reference Contract — not automatic | Held — Adapter is precisely where `2C`'s own Contract would be applied | Held only if Compiler itself defers to `2C` — an extra, unenforced discipline requirement | Held (nothing assumes anything) |
| `F1` not artificially converted to `F2` | Held by all 4 equally — this is a real production-path property, unaffected by which `2D` alternative is chosen | Held | Held | Held |
| `F2` not claimed to exist in production without real semantic resolution | Held by all 4 equally, per the case analysis above (`F1`/`F2` row) — no alternative alone creates the missing step | Held | Held | Held |
| Consumption has a real production owner, not an isolated new subsystem | **Only meaningfully addressed by `B`** — `A` and `C` each risk becoming a new isolated subsystem or a coupling liability respectively; `D` does not address it at all, by design | The one alternative whose own real purpose is exactly this | Not really — direct coupling is not the same as "having a real owner," per the coupling risk already flagged | Not addressed — deferred |
| No PR before a real entry point is proven | Held by all 4 equally — none of them are code yet | Held | Held | Held |
| No new component granted undecided responsibility | At risk — `A` implicitly grants `urpm` filesystem/discovery responsibility never decided by any `ADR` | Held — Adapter's own responsibility is precisely scoped to bridging, nothing more, if defined narrowly | At risk — direct Compiler coupling risks absorbing responsibility informally, the same pattern already found once in `resolveAndMergeImports` itself | Held — nothing is granted |

### Result — preliminary lean, not a closed Decision

`A` is weakened by real evidence across most invariants (requires
`urpm` to absorb responsibilities no `ADR` has granted it — discovery,
filesystem materialization, eventually download). `C` reintroduces
the exact Compiler-coupling risk already identified and avoided once
before. `D` solves nothing, though it remains the lowest-risk
fallback if no real production entry point can be proven.

**`B` is the strongest candidate by evidence** — it is the only
alternative whose own real purpose directly satisfies the
"consumption needs a real owner, not an isolated subsystem" Invariant,
without requiring `urpm` to grow beyond its own real, already-proven
scope (a semantic metadata/dependency engine).

**Status: this is a preliminary lean toward `B`, not a closed
Decision, per direct instruction.** Before `Decision 2D` can close,
the real shape of this `Adapter` — its own precise inputs, outputs,
and boundary — needs its own Evidence-based definition, matching the
same rigor already applied to `PackageLocationValidator`'s own
Contract before any code was written.

## Decision 2D — Adapter Boundary Investigation (per direct instruction, zero code, no premature choice)

### Input Trace — decisive finding

**Confirmed via direct search**: every real call to `resolver.resolve()`
or `registry.resolve()` anywhere in the project happens **inside
`urpm` itself** (`commands.ts`, `resolver.ts`) — zero external caller
exists. `LockedPackage` is therefore not merely "not yet wired in" —
**it has never been produced from any real project's own data**,
since nothing outside `urpm`'s own commands ever supplies a real
`Manifest`.

**Critical, decisive discovery**: `resolver.resolve()` takes a full
`Manifest` — confirmed to require, at minimum, `name`, `version`, and
`dependencies` **describing the consuming project itself** (not the
imported package alone). A bare `importPath` string (e.g.
`"mathlib"`) carries **none** of this — it says nothing about whether
`mathlib` is a declared dependency of the current project, nor what
version constraint the project has declared for it. That information
exists only in a real project `Manifest` — confirmed earlier (Local
Reference Contract Investigation) to not exist as a real file
anywhere in this project today.

### Answering the riskiest test, per direct instruction — honestly, not forced

> Can the Adapter work without `urpm` ever knowing about `packages/`,
> and without the Compiler ever knowing about `urpm`?

**Answer: No, not as originally conceived.** The Adapter cannot
bridge `importPath` to a real `urpm.resolve()` call using `importPath`
alone — it would need to also construct or locate a real project
`Manifest` (declared dependencies, version constraints) to make that
call meaningful at all. This is **not** pure integration
orchestration — interpreting "this import refers to a declared
project dependency, resolved via these constraints" is real
`Lifecycle`-level semantic work, precisely the red flag the standing
concern warned against: an `Adapter` built to solve this would begin
absorbing responsibilities no `ADR` has granted it (locating/parsing
a project manifest, deciding whether an import name is a real
dependency at all).

### Output Trace

Per `Decision 2C`'s own already-ratified contract, the required
output remains a `Decision 2B`-shaped local reference, feeding
`Location Resolver`. This part of the boundary is unaffected by the
Input Trace finding — the problem is entirely on the input side.

### Ownership, redrawn honestly

```
urpm
 └─ semantic resolution (real, but requires a real project Manifest — none exists)

Adapter
 └─ UNPROVEN — would require real Lifecycle semantics
    (declared-dependency interpretation), not pure orchestration

Location Resolver / Validator / Module Resolver / Compiler
 └─ unaffected — Decision 2C's own contract remains valid regardless
```

### Negative Responsibilities (recorded per direct instruction, precisely because the Input Trace finding makes this urgent)

The Adapter, if ever built, **must NOT**:
- Parse, locate, or construct a project `Manifest` on its own
  initiative.
- Decide whether an `importPath` refers to a "real" declared
  dependency.
- Perform version constraint resolution itself (remains `urpm`'s own
  exclusive territory, per every prior `Decision`).
- Persist or cache any `Registry`/`Manifest` state.
- Handle `URL`-form `resolved` values (remains out of scope, per
  `Decision 2C`'s own boundary).
- Determine workspace-vs-installed precedence (remains `Scenario 7`,
  explicitly deferred).

### Result

**The riskiest test fails as originally posed.** `B`, as a thin
translation layer between an already-existing `LockedPackage` and
`Decision 2B`'s own local reference form, **cannot be built today**,
because the real precondition (`LockedPackage` produced from a real
project `Manifest`) does not exist. This does not eliminate `B`
outright — it reveals that `B`'s own real precondition is itself
undecided: **a real project `Manifest` discovery/location mechanism
would need to exist first**, which is a genuinely separate,
unresolved architectural question, not something the Adapter itself
should silently absorb.

**Status: `Decision 2D` remains open. This investigation does not
close in favor of `B`, `A`, `C`, or `D` — it identifies a real,
prior, unresolved question (`does a real project Manifest exist or
need to be introduced?`) that must be answered before any of the 4
alternatives can be meaningfully evaluated further. No PR, no
Adapter API, no code.**

---

# Decision 2D-0: Project Dependency Context — Evidence Collection

**Per direct instruction: this precedes any Adapter/Manifest
Discovery decision. Zero code, no premature conclusion that
`urpm.json` must be built.**

## The 6 questions, answered with direct evidence

1. **Does a `Project Manifest` concept exist at all, consumed by the
   Compiler project?** **No** — confirmed directly: zero import of
   `urpm/manifest`/`urpm/index` anywhere in `src/cli/` or
   `src/compiler/`. The concept exists only as a `TypeScript`
   `interface`, never consumed by the real production project.
2. **Any real production point knowing `project.name`/`version`/
   `dependencies`?** No — confirmed by the same absence in item 1;
   `resolveAndMergeImports` and every other real `CLI` function never
   references any such structure.
3. **What is `urpm.Manifest` actually designed for — the consuming
   project, the published package, or both?** **Confirmed: designed
   for both, by its own real doc comment** (`"Package name, e.g.
   'my-project'"` — a real project-style example name), and confirmed
   structurally: the exact same `Manifest` shape is passed to
   `cmdPublish` (publishing a package) and is the subject of
   `resolver.resolve(manifest)` (resolving *its own* declared
   dependencies) — the same real duality found in genuine package
   managers (`package.json` itself serves both roles). This is not
   assumed from the name — it is confirmed from real, dual usage in
   the code.
4. **Any other real source for this context** (`CLI` arguments,
   workspace metadata, lockfile, config, source tree, build context)?
   **Confirmed: none** — `process.argv` is used only to extract the
   real command name (`init`/`run`/`build`/etc.); zero flag, config
   file, or build-context mechanism carries project dependency
   information anywhere in the real `CLI`.
5. **Can a Dependency Context be built from `importPath` alone?**
   **No — confirmed by the prior Adapter Boundary Investigation**:
   `importPath` is a bare string with no declared-dependency or
   version-constraint information; `resolver.resolve()`'s own real
   signature requires a full `Manifest` to mean anything.
6. **Is there a real, working relationship between `urpm.lock` and a
   project `Manifest` today?** **No** — confirmed earlier (Lifecycle
   Evidence Collection): `LockFile` is a real, in-memory structure
   with a real serializer, but is never written to or read from any
   real `.lock` file on disk; there is no real round-trip between a
   real project `Manifest` and a real `urpm.lock` file anywhere in
   this project today.

## The 3 critical test cases, reasoned through with this evidence

- **Case A — no Project Manifest**: can the system correctly
  determine a dependency today? **No** — confirmed: `importPath`
  alone (the only real production input) carries no dependency
  declaration or version constraint; the system has no way to know
  whether `mathlib` is an intended dependency at all, let alone at
  what version.
- **Case B — a Project Manifest exists, declaring `mathlib`**: could
  `urpm.resolve()` use it? **Yes, mechanically** — `resolver.ts`'s own
  real, tested logic (confirmed throughout the earlier Integration
  Boundary Investigation) correctly resolves declared dependencies
  against a real `Manifest`. This is a real, working capability
  *within* `urpm` — the gap is entirely on the *production wiring*
  side, not `urpm`'s own internal correctness.
- **Case C — Manifest + LockFile both present**: does the full chain
  (`importPath → declared dependency → resolved package → locked
  package → local reference → resolvedPath`) exist even then? **Not
  automatically** — even with both real structures present, no real
  code today connects `importPath` (the parser's own value) to a
  `Manifest`'s own declared dependency by name, and no real code
  converts a `LockedPackage.resolved` into `Decision 2B`'s own local
  reference form (per `Evidence Question 5`, left explicitly
  unproven). Providing the context alone does not, by itself, close
  every remaining gap already found.

## Explicit non-conclusion, per direct instruction

**This investigation does not conclude that `urpm.json` (or any
specific file) must now be created.** It establishes only that a real
`Project Dependency Context` — in *some* real form — is a genuine,
missing precondition for any `2D` alternative that involves `urpm` at
all (`A`, `B`, and `C`, per the earlier Alternatives Matrix). The
correct shape of that context — a real file, `CLI` flags, an inferred
default, or something else entirely — remains its own, separate,
undecided architectural question.

**Status: Decision 2D-0 Evidence Collection complete. `Decision 2D`
remains open, now further informed. `PackageLocationValidator` remains
completely untouched throughout. No code, no `PR`, no `Adapter` API,
no `Manifest Discovery` mechanism introduced.**

---

# Decision 2D-1: Project Dependency Context Ownership Investigation

**Per direct instruction: 7 questions only, zero code, no automatic
conversion into `urpm.json`/`ProjectManifest`/`Adapter`.**

## The 7 questions, answered with direct evidence

1. **Does the Compiler actually need to know declared dependencies to
   support `import` at all?** **No — confirmed by real, working
   evidence.** `ADR-006`'s own proven `UR→UR` import path already
   works end-to-end (`Parser → Semantic → TypeChecker → IR → C →
   execution`) using pure filesystem lookup — zero dependency
   declaration is checked or required anywhere in that real, tested
   chain.
2. **Is the required semantics "declared dependency" or plain
   "package lookup"?** **Confirmed: today's real, working semantics is
   plain lookup** — `existsSync(candidatePath)` alone, no declaration
   check of any kind. Whether *future* needs (e.g. real version
   constraints) would require "declared dependency" semantics is a
   separate question this evidence does not answer either way.
3. **Does the current system have any real production concept of
   project identity/version/dependencies outside `urpm`?** **No** —
   confirmed exhaustively in `Decision 2D-0`.
4. **Can Module Resolution be separated from Dependency Resolution
   without either owning the other's responsibility?** **Yes, in
   principle — already demonstrated by `Decision 2C`'s own real,
   ratified boundary**: `2C` defines `Location Resolution` (using
   `importPath`) as fully separate from `urpm`'s own `Package
   Resolution` (using `Manifest`+`Registry`), with neither absorbing
   the other's real responsibility.
5. **What is the minimal real context Package Resolution actually
   needs?** **Corrected, decisive finding — narrower than `Decision
   2D-0`'s own prior framing suggested**: confirmed directly,
   `PackageRegistry.resolve(name: string, constraint:
   VersionConstraint)` — resolving **one single package** requires
   only a `name` and a `constraint`, **not** a full project
   `Manifest`. A full `Manifest` (with its own complete
   `dependencies` list) is required only for `Resolver.resolve()`'s
   own real, different job: resolving a **complete, transitive
   dependency graph** (`A → B → C`) — not for a single, direct
   package lookup.
6. **Should this context exist before Parser/Import Resolution, or at
   a later stage?** Per the real, working production path: resolution
   happens **at** import-processing time itself, inline within
   `resolveAndMergeImports` — there is no real "pre-flight" context
   -gathering phase today, for either the working `UR→UR` mechanism or
   `urpm`'s own internal logic.
7. **What can be proven from the current path, and what remains a new
   decision?** **Proven**: the current, real, working `import`
   mechanism needs no dependency declaration at all for the resolved
   cases (`ADR-006`). **Proven**: a single-package resolution's own
   minimal real requirement is `{name, constraint}`, far narrower than
   a full `Manifest`. **Remains a new decision**: whether/how a real
   `{name, constraint}`-shaped context should ever be supplied for
   `UR→UR` imports (e.g., to support real version constraints in the
   future) — and if so, where that pair would come from, which this
   investigation does not answer.

## Explicit non-conversion, per direct instruction

**This does not conclude that a `urpm.json`, `ProjectManifest`, or
`Adapter` must be built.** It establishes precisely two things: (1)
the currently-working import mechanism needs no dependency
declaration at all, and (2) *if* a future need for real version
constraints arises, the real minimal shape required is far smaller
(`{name, constraint}`) than previously assumed (a full project
`Manifest`) — narrowing, not widening, the scope of any future
decision.

**Status: `Decision 2D-1` complete. `Decision 2D` remains open. No
`Alternatives` comparison, no `Manifest`/`Adapter` design, no code —
per the standing discipline, stopping precisely at the evidence's own
boundary.**

---

# Decision 2D-2: Constraint Provenance Evidence

**Single question, per direct instruction**: does the current system
contain any real source for a version `constraint` anywhere along
`Parser → Import AST → Import Resolver → CLI/build context → urpm
Registry/Resolver`? **Zero code touched, no solution invented if the
answer is no.**

## All 4 layers checked with direct evidence

1. **Parser → Import AST — syntax level**: **confirmed live, zero
   support** — three real, plausible constraint syntaxes tested
   directly (`import mathlib@1.0.0`, `import mathlib@^1.0.0`, `import
   mathlib:1.0.0`) — all three fail identically with `PE001`
   (`"Expected module name..."`). No version-constraint syntax exists
   in `import` at all.
2. **Import AST — structural level**: **confirmed, zero field**.
   `ImportDecl`'s own real shape (`ast.ts`) carries exactly one
   payload: `path: string[]` (the identifier sequence, e.g. `["std",
   "io"]`) — no `version`, no `constraint`, no adjacent field of any
   kind.
3. **CLI/build context**: **confirmed, zero mechanism**. Searched
   directly for any real flag or config carrying a constraint value —
   the only real match for `"--version"` is the `CLI`'s own
   self-version-printing command (`ur --version`), entirely unrelated
   to any package's own dependency constraint.
4. **`urpm` Registry/Resolver**: real `constraint` handling exists
   here (`VersionConstraint`, `satisfies()`, `pickBestVersion()`) —
   but confirmed throughout this entire investigation to receive a
   `constraint` only from a real `Manifest`'s own declared
   `dependencies` list, which is itself confirmed (`Decision 2D-0`) to
   not exist as a real, consumed structure anywhere in production.

## Result

**Zero real constraint source exists anywhere in the current
system**, at any of the 4 layers checked. This confirms, with direct
evidence rather than assumption, the precise gap:

> `Package Name` exists in production (`importPath`, real and
> working). `Package Version Constraint` does not exist in production
> anywhere — not in syntax, not in the AST, not in `CLI` context, and
> `urpm`'s own real constraint-handling logic has nothing real
> upstream of it to supply one.

**No solution is proposed for this gap, per direct instruction.**
Whether a future constraint should default to "any version," be
introduced via new syntax, be declared in a future project manifest,
or be handled by some other mechanism entirely remains a separate,
undecided architectural question — not concluded here.

**Status: `Decision 2D-2` complete. `Decision 2D` remains open.
`PackageLocationValidator` remains untouched. No code, no `PR`, no
new syntax, no default value invented.**

---

# Decision 2D-3: Version Selection Semantics Evidence

**Per direct instruction: evidence only, confined to what already
exists, before any Grammar/API design.**

## The 7 questions, answered with direct evidence

1. **What does `import mathlib` mean in `UR`'s own design?**
   Confirmed structurally, per every prior investigation in this
   record: a plain identifier-sequence lookup (`ImportDecl.path:
   string[]`) resolved directly to a filesystem location — no version
   concept participates in this meaning anywhere.
2. **Does `import` mean dependency declaration or module lookup?**
   **Confirmed: module lookup**, per the same real, working mechanism
   already proven end-to-end (`ADR-006`) — it performs a direct file
   existence check, never a declaration-against-policy check of any
   kind.
3. **Does any current semantics exist for version selection?**
   **Confirmed: none** — per `Decision 2D-2`'s own exhaustive,
   4-layer search.
4. **What does `Registry.resolve(name, constraint)` do with no
   `constraint`?** **Confirmed: this cannot happen** — `constraint`
   is a real, mandatory (non-optional) parameter in the function's own
   type signature; there is no real "absent constraint" behavior to
   observe, since the language itself prevents calling it without one.
5. **Does `urpm` itself contain any real default constraint?**
   **Confirmed: `"*"` is a real, supported constraint value**
   (`parseVersionConstraint("*")`, `satisfies()` returning `true`
   unconditionally for it) — but it must be supplied explicitly as a
   real argument; `urpm` never substitutes it automatically when a
   constraint is missing.
6. **Do `PackageNode`/`LockedPackage` assume a specific version before
   consumption?** **Confirmed: yes** — `PackageNode.version` is
   typed as a concrete `SemVer`, never a `VersionConstraint` range.
   By the time either entity exists, a specific version has already
   been chosen (via `pickBestVersion`) — these entities are the real
   *output* of version selection, never its input.
7. **Can `Package Name → Resolution Policy` be fully separate from
   `import` language semantics?** **Yes, consistent with all of the
   above** — nothing in `import`'s own real, current meaning (a plain
   name/path lookup) requires or references any version concept;
   version selection is confirmed to be an entirely separate real
   concern, handled only within `urpm`'s own internal machinery, never
   touching the `import` statement itself today.

## Honest conclusion

**Version is not part of `UR→UR` `import`'s own current semantics at
all.** The gap `Decision 2D-2` found is therefore **not** a
`Parser`/`Grammar` gap — `import mathlib` already means exactly what
it currently does (a name-based lookup) with no missing piece at the
language level. The real, separate question this reframes precisely:
**if/when version selection is ever needed, it is a `Version
Selection Policy`/`Lifecycle` question — entirely independent of
`import`'s own real language semantics — not something requiring a
change to how `import` is written or parsed.**

**Status: `Decision 2D-3` complete. `Decision 2D` remains open, now
precisely reframed. No Grammar change, no `Manifest`, no `Adapter`, no
default value, no code. `PackageLocationValidator` remains
untouched.**

---

# Version Selection Ownership — Evidence Collection

**Per direct instruction: 7 questions, evidence only, no
Default/Manifest/Adapter/Grammar change.**

## The 7 questions, answered with direct evidence

1. **Who owns version selection today, inside `urpm`?** **Confirmed:
   `pickBestVersion()`** (`dependency-graph.ts`) — the one real
   function that turns a list of candidate versions plus a constraint
   into a single chosen `SemVer` (`filter` by `satisfies`, then
   `reduce` to the highest match).
2. **Does `Registry.resolve(name, "*")` represent a policy, or a
   low-level API?** **Confirmed: a low-level API.** `Registry.resolve()`
   itself performs no policy decision of its own — it delegates
   directly to the same real `pickBestVersion()` (confirmed via its
   own real code, `registry.ts:184`-adjacent) given whatever
   `constraint` it receives; `Registry` never decides what constraint
   to use, only executes selection against one already supplied.
3. **Does `Resolver.resolve()` own policy, or execute a policy it is
   supplied?** **Confirmed: executes a supplied policy.**
   `Resolver.resolve(manifest)`'s own real code reads
   `dep.constraint` directly from `manifest.dependencies` — the
   constraint always originates from the caller-supplied `Manifest`,
   never decided internally by `Resolver` itself.
4. **Is `LockFile` a source of the decision, or a result of it?**
   **Confirmed: a result.** `LockFile.packages` is populated *after*
   `pickBestVersion()` has already run (confirmed in the earlier
   Registration/Resolution Boundary Evidence) — nothing in the real
   code ever reads an existing `LockFile` back in as an input to a
   *new* version decision.
5. **Does any `latest`/`preferred`/`current` concept exist anywhere in
   the project?** **Confirmed: none** — searched directly, zero
   matches anywhere in `urpm`'s own real source.
6. **Should version selection happen before or after Location
   Resolution?** Per the real, already-established chain
   (`PackageNode.version` is a concrete `SemVer` by the time it
   exists — confirmed in `Decision 2D-3`): version selection is
   logically **prior to** any real location step in `urpm`'s own
   internal model — a `resolved`/`resolvedPath` presupposes a version
   has already been chosen. This does not, by itself, mean the two
   must live in the same real system (per `Decision 2C`'s own
   established separation).
7. **Does Package Resolution need to enter the `import` production
   path in `Decision 2D` at all, or is this orthogonal to Version
   Selection?** **Real, critical reframing, consistent with `Decision
   2D-3`'s own conclusion**: since `import`'s own real semantics is
   confirmed to be pure lookup with no version participation, `Version
   Selection` — wherever it eventually lives — is not *inherently*
   required for `Decision 2D`'s own real question (whether/how `urpm`
   should be wired into the production `import` path at all). It is
   possible that `Decision 2D` could be resolved (e.g. wiring a real
   `packages/` consumption path) **without** ever touching `Version
   Selection`, if the real, current need is simply "find this package
   by name" — with version constraints remaining a genuinely separate,
   deferrable concern for whenever real multi-version scenarios
   actually arise.

## Result

**Every real policy decision point in `urpm` already executes a
supplied constraint — none of them decide one on their own.** No
`latest`/default concept exists anywhere. This confirms precisely
what `Decision 2D-2`/`2D-3` already found: the missing piece is not
inside `urpm`'s own real logic — it is the complete absence of any
real production caller supplying a constraint at all.

**Most significant finding, per direct instruction's own final
question**: `Decision 2D` may not need to resolve `Version Selection
Ownership` at all in order to close — if the real, current scope is
limited to "resolve a package by name," `Version Selection` can
remain its own, separate, deferred concern (matching `Scenario 7`'s
own already-established precedent of legitimate deferral) without
blocking `Decision 2D`'s own real progress.

**Status: Version Selection Ownership Evidence Collection complete.
`Decision 2D` remains open — now with a real, evidence-based option to
proceed on name-only resolution while deferring version selection
entirely, rather than treating it as a blocking prerequisite. No
`Default`, `Manifest`, `Adapter`, or `Grammar` change. `PackageLocationValidator`
remains untouched.**

---

# Decision 2D-4: Name-Only Resolution Feasibility Evidence

**Per direct instruction: this must be resolved before treating
"name-only resolution" as a viable path for `Decision 2D`.**

## The 10 questions, answered with direct evidence

1. **Can `PackageRegistry` determine a package's existence by name
   alone, without choosing a version?** **Confirmed: no real public
   method exists for this.** `this.packages: Map<string,
   RegistryPackage>` is `private`; the class exposes exactly two
   public methods — `register()` (write) and `resolve(name,
   constraint)` (read) — confirmed to require `constraint` and always
   return either `undefined` or one specific, chosen `SemVer`-versioned
   result. No `has()`/`get()`/`exists()`-style method exists.
2. **Can `pickBestVersion()` stay outside this path without producing
   an undefined result?** **No** — confirmed: `pickBestVersion()` is
   invoked *inside* `Registry.resolve()`'s own real implementation
   (the only real read path); there is no way to reach a real result
   from the current public API without it running.
3. **What does `Registry` return when multiple versions exist for the
   same name?** Confirmed: `resolve()` returns exactly one version —
   the highest one satisfying the given `constraint` — never a list,
   never an ambiguity signal.
4. **Does a single existing version allow unambiguous name
   resolution?** In principle, yes — if exactly one version is
   registered, `pickBestVersion()`'s own real logic would trivially
   select it for any constraint it satisfies. But this is not
   "name-only" resolution — the real API still requires supplying
   *some* real constraint value first; the single-version case merely
   makes the *outcome* unambiguous, not the *mechanism*.
5. **What happens with two or more versions?** A real constraint is
   mandatory to disambiguate — confirmed, since `pickBestVersion()`'s
   own real logic filters by `satisfies(constraint)` before reducing;
   without one, there is no way to choose among real candidates using
   the current public API at all.
6. **Does `PackageNode` require a `version`, making a valid semantic
   result impossible before version selection?** **Confirmed: yes.**
   `PackageNode.version: SemVer` (non-optional) — no valid
   `PackageNode` can exist without a chosen, concrete version.
7. **Could a Package Lookup result be an independent entity, separate
   from `PackageNode`?** **Not with anything that exists today** —
   confirmed: the only real intermediate structure with a name but no
   single chosen version is `RegistryPackage` itself (holding a list
   of `versions`) — but it is `private` inside `PackageRegistry`, with
   no real public accessor exposing it directly.
8. **What are the Failure Semantics for name-only resolution?** Not
   observable today — since name-only resolution is not a real,
   reachable path through the current public API, there is no real
   failure behavior to trace for it specifically (distinct from
   `resolve()`'s own real `undefined`-on-no-match behavior, which
   always presupposes a real constraint was supplied).
9. **Does this path preserve `F1`/`F2` as settled in `Decision 2C`?**
   Not applicable — since the path itself is not real today, there is
   nothing yet to test against `F1`/`F2`.
10. **Could Version Selection be introduced later without redesigning
    the boundary?** Not yet answerable with evidence — this depends
    entirely on a design not yet built.

## Decisive result — correcting the prior tentative lean

**Name-only resolution is NOT feasible with `urpm`'s own current,
real public API.** Every real access path (`resolve()`) mandates a
`constraint` argument and always produces a concrete-version result
(or `undefined`) — there is no real way to ask "does a package named
`X` exist at all" without simultaneously choosing a version. This
directly corrects the prior message's own tentative framing ("`2D`
may not need Version Selection resolved to close"): **the current
`urpm` API structurally couples existence-checking with
version-selection — they cannot be separated today without a real
change to `urpm`'s own public surface.**

**This does not mean `Version Selection` itself must be designed
now.** It means: proceeding with a "name-only" production path today
would require *some* real constraint value regardless (even a
trivial, always-passing one like `"*"`, confirmed real and supported)
— and choosing to supply one, even a permissive one, is itself a real
architectural decision this investigation has not yet made, per the
standing discipline against inventing a default.

**Status: `Decision 2D-4` complete. `Decision 2D` remains open — the
"resolve by name only, defer version selection" path is confirmed
**not currently available** as a mechanical shortcut; any real
`Decision 2D` progress involving `urpm` would need to consciously
supply a real constraint value, which remains its own, undecided
choice. No `Default`, `Manifest`, `Adapter`, `Grammar`, or `Registry`
API change. `PackageLocationValidator` remains untouched.**

---

# Decision 2D-5: Constraint Policy Provenance Investigation

**Single question, per direct instruction**: what is the minimal real
project-level source for a `constraint` that could enter `Package
Resolution` without changing `import`'s own semantics and without
loading the Compiler with Version Policy responsibility? **No
alternative chosen — evidence only.**

## The 6 checks, with direct evidence

1. **Any value derivable from `Registry` itself?** Confirmed: no —
   per `Decision 2D-4`, every real public read path
   (`resolve(name, constraint)`) requires an externally-supplied
   `constraint`; `Registry` never derives one from its own internal
   state.
2. **Can `"*"` be considered an explicit policy outside `import`?**
   Real and technically valid (confirmed `2D-2`) — but remains a real,
   undecided architectural choice, not a neutral default; supplying
   it anywhere is itself a policy decision this investigation does not
   make.
3. **Any real Configuration/Build context that could own this?**
   Confirmed: none — per `Decision 2D-2`'s own exhaustive search of
   `CLI` flags/config.
4. **Could `Lockfile` be the source — re-checked in this specific
   context?** **New, decisive discovery, real and significant**:
   `Resolver.installFromLock(lockFile)` — confirmed real — reads an
   *already-locked* `version` directly from `lockFile.packages`,
   then calls a real, newly-found method, `Registry.hasVersion(name,
   version: string): boolean` (a real, exact-match existence check
   with **no `constraint` parameter at all**). This is a genuine,
   existing, `constraint`-free path in the real code. **But it has a
   real, structural precondition**: it requires a `version` to already
   be known (from a real `LockFile`), and a real `LockFile` is itself
   only ever produced *by* an earlier `resolve()` call that *did*
   require a `constraint` (confirmed throughout this investigation:
   no real `.lock` file exists on disk today, and nothing constructs
   one from anywhere but `Resolver`'s own constraint-requiring
   methods). This is a genuine chicken-and-egg relationship, not a
   free bypass — `installFromLock` presupposes a constraint was
   already resolved once, somewhere, to produce the lock it reads.
5. **Can `Version Selection` be deferred entirely with `urpm` staying
   out of the production path?** Yes — this is the real, already-known
   `D` option from the earlier Alternatives Matrix; it resolves
   nothing but also introduces no risk.
6. **Minimal conceptual change required per option?**
   - `"*"` supplied explicitly: smallest code change, but is itself a
     real policy decision (not "no policy").
   - `Lockfile`-based (`installFromLock`): requires a real, prior
     constraint-resolution event to have already happened and been
     persisted — not actually smaller in real scope, since the
     missing `LockFile` persistence gap (`Decision 2D-0`) would need
     solving first.
   - Configuration-based: would require inventing a new, real
     mechanism with no existing precedent anywhere (confirmed absent).
   - Deferral (`D`): zero conceptual change, but resolves nothing.

## Result — no alternative chosen, per direct instruction

The `installFromLock`/`hasVersion()` discovery is real and valuable,
but does **not** offer a free path around supplying a real
`constraint` — it only moves the real requirement earlier in time (to
whatever event originally produced the `LockFile`), and that event
does not exist in production today either. Every real option
(`"*"`, `Lockfile`, `Configuration`) requires a genuine, undecided
architectural choice; only `Deferral` (`D`) requires none, at the
cost of resolving nothing.

**Status: `Decision 2D-5` complete. `Decision 2D` remains open — no
`Default`, no `Lockfile` persistence mechanism, no `Configuration`
system, no `Adapter`, no code. `PackageLocationValidator` remains
untouched.**

---

# Decision 2D-6: Version/Constraint Policy Boundary Evidence

**Per direct instruction: evidence only, consolidating every prior
finding in this document — no code, no `PackageLocationValidator`
change, no `Manifest`, no automatic `"*"`.**

## The 8 questions, answered with direct evidence

1. **Should `import mathlib` remain a `Name-Only Lookup`
   semantically?** **Confirmed yes — already established
   (`Decision 2D-3`)**: this is `import`'s own real, current, working
   semantics — a plain identifier lookup, no version participation.
   This record reconfirms it, rather than reopening it.
2. **If yes, who owns Version Selection Policy?** **Precisely
   distinguished, per the Version Selection Ownership record**:
   `pickBestVersion()` owns the real *algorithm* (given a supplied
   constraint, choose the best match) — but confirmed, nobody owns
   the real *decision* of which constraint to supply in the first
   place. This is the actual, still-unowned gap — not the algorithm,
   the policy input to it.
3. **Is `"*"` a mere technical constraint, or a semantic policy?**
   **Confirmed (`Decision 2D-5`): a real semantic policy decision**
   — technically valid and supported, but choosing to supply it
   anywhere is itself a real, undecided architectural choice, never
   a neutral default.
4. **Can a version be determined from `Registry`/`Workspace`/`Lock`
   without entering `Grammar`?** Yes, in principle — none of these
   three require any `import`-syntax change. But confirmed: none of
   them currently *does* this without a constraint already having
   been resolved upstream (`Registry`: confirmed `2D-4`, requires a
   constraint; `Lock`: confirmed `2D-5`, `installFromLock` presupposes
   a prior constraint-resolution event; `Workspace`: confirmed
   `Decision 2`'s own explicit deferral, `Scenario 7`, never
   resolved).
5. **What should happen with exactly one available version?**
   Confirmed (`2D-4`, Q4): the real *outcome* would be unambiguous —
   but the real *API* (`Registry.resolve()`) still mandates supplying
   *some* constraint value regardless; a single real version does not
   by itself remove this structural requirement.
6. **What happens with multiple versions?** Confirmed (`2D-4`, Q5): a
   real constraint is mandatory to disambiguate — `pickBestVersion()`
   cannot choose among real candidates without one.
7. **Where should `F1`/`F2` appear if selection fails?** **New,
   precise finding**: a missing/undecided constraint is neither `F1`
   (package not found by name — `Decision 2C`'s own real scope) nor
   `F2` (location resolved but invalid — `Integration Contract v1.0`'s
   own real scope). It is a **genuinely distinct, third failure
   category** — occurring *before* either, at the "what version is
   even being asked for" stage — not yet named anywhere in this
   document, and not to be conflated with `F1`/`F2` without a real,
   separate decision.
8. **Is this a hard prerequisite for `Decision 2D`, or can Version
   Selection be fully separated and deferred?** **Confirmed, per the
   Version Selection Ownership record's own critical reframing**:
   `Decision 2D`'s own real scope (wiring real production consumption
   for `packages/`, per `Decision 2C`) does **not** structurally
   require Version Selection to be solved — deferring it entirely
   remains a real, legitimate, evidence-backed option, exactly
   matching how `Scenario 7` was deferred earlier in this same
   document.

## Effect on `B`'s own viability, stated precisely — not decided here

This evidence does not eliminate `B` (`Lifecycle Adapter`) outright,
but it precisely narrows what `B` could honestly claim to do today:
`B` could bridge production consumption **only** for the case where
version selection is not required at all (a single, unambiguous
package instance) — it **cannot** honestly claim to handle real
multi-version resolution without first resolving this Boundary's own
real, still-open policy question. Whether `Decision 2D` should
proceed on this narrowed basis, or whether this finding calls for
reformulating `Decision 2D` itself, remains for the project owner's
own real decision — not concluded here.

**Status: `Decision 2D-6` complete. `Decision 2D` remains open. No
code, no `PackageLocationValidator` change, no `Manifest`, no
automatic `"*"`. A real, distinct third failure category (constraint
absence/policy gap) is identified but not yet named or designed.**

---

# Decision 2D-7: Policy Ownership Evidence

**The one question genuinely prior to any `Adapter` design, per
direct instruction**: does the current production system need to own
a real `Version Selection Policy` at all, in order to connect `import`
to `urpm`? **No `"*"`, no `Manifest`, no `Registry` change, no
`Adapter API`, no `F3`, no `PR`.**

## The 5 questions, answered with direct evidence

1. **Can `import` mean existence/definition of a package without
   Version Selection?** **Confirmed yes — this is exactly what
   already works today.** `ADR-006`'s own proven `UR→UR` mechanism
   (`import mathlib` → `packages/mathlib/index.ur`, per `Decision
   2C`'s own already-ratified boundary) performs zero version
   handling of any kind. A package, in this real, already-working
   model, is fully defined by its existence at one physical location
   — not chosen among several registered versions.
2. **Can `urpm` be a consumer of an already-known version only?**
   **Confirmed yes — `installFromLock`/`hasVersion()` already
   demonstrate exactly this real pattern** (`Decision 2D-5`): `urpm`
   genuinely supports consuming a pre-known version without
   performing selection itself.
3. **Is there a real production path that could supply a version
   without inventing a new Policy?** **Decisive finding**: per
   `Decision 1`'s own real, ratified scope, `packages/<name>/` is a
   single physical location — not a multi-version registry entry.
   The real, current production model has no concept of "several
   registered versions of the same package name" to begin with
   (that concept exists only *inside* `urpm`'s own internal
   `Registry` model, confirmed never populated in production —
   `Decision 2D-0`). This means the real "version ambiguity" problem
   `pickBestVersion()` was built to solve **does not arise at all**
   in the current, real production reality — not because it was
   solved, but because it is not a real condition of today's actual
   system.
4. **Should absence of a constraint block Consumption, or is this an
   unproven assumption?** **Confirmed: an unproven, and now
   contradicted, assumption.** `Decision 2C`'s own real Location
   Resolution Boundary — live-tested and ratified — already performs
   real, working Consumption (`importPath → packages/<name>/ →
   index.ur → AST`) with **zero constraint or version concept
   anywhere in that real, working chain**. Blocking Consumption on a
   missing constraint would mean blocking something already proven to
   work without one.
5. **Is `B` still a `Lifecycle Adapter`, or would granting it this
   policy make it a disguised Package Manager?** Per findings 1–4:
   `B`, scoped exactly to what `Decision 2C` already proved works
   (single-location, filesystem-based existence), **never needs
   Policy Ownership at all** — there is no real Version Selection
   decision for it to make within that scope. `B` would only risk
   becoming a disguised Package Manager if it were additionally asked
   to resolve ambiguity among multiple real, registered versions —
   which is not a real condition of the current production system.

## Decisive, honest conclusion

**Version Selection Policy is not a real precondition for `Decision
2D`'s own actual, current scope.** The entire `2D-0` through `2D-6`
investigation correctly and rigorously characterized `urpm`'s own
internal `Registry`/`Resolver` model — but that model's own real
multi-version concept is confirmed to have no counterpart in the
current, real production system at all. `Decision 2C`'s own already-
proven, working mechanism never required it, and does not require it
now.

**This does not mean Version Selection is solved or unimportant** —
it means it is a genuinely separate, deferred concern (matching
`Scenario 7`'s own established precedent) that does not block
`Decision 2D` from proceeding on its own real, narrower, already-
evidenced basis: connecting real production `import` consumption to a
`packages/`-based location, exactly as `Decision 2C` already
established, without requiring `urpm`'s own `Registry`/`Resolver` to
be wired in at all for this scope.

**Status: `Decision 2D-7` complete. `Decision 2D` remains open, now
with its real scope clarified rather than blocked. No `"*"`, no
`Manifest`, no `Registry` change, no `Adapter API`, no `F3` naming, no
`PR`. `PackageLocationValidator` remains untouched.**

## Precision correction, per direct instruction

> "`packages/<name>/` is a single physical location" proves the
> **current** location model — it does **not** prove multi-version
> support is architecturally impossible in the future.

**Corrected statement**: there is no evidence in the current
production path of `Versioned Package Selection` — this is a real,
current-scope observation, not a permanent architectural constraint.
This must not be mistaken for an unintended `Invariant`.

## Decision 2D's real, core question — Lifecycle Ownership Evidence

**Per direct instruction, now cleared of `Version Selection` noise**:
who owns the outcome of `packages/<name>/ → resolvedPath → F1/F2` in
the production path, and when is it created/registered/consumed,
without inventing a new Package Manager inside the Compiler?

**Decisive, real evidence, checked directly**: `candidatePath`'s own
real, exact lifetime today is confirmed to be **purely transient and
function-call-scoped** — it is used exactly twice (`existsSync()`,
then `readFileSync()`), both **within the same single function call,
at the same moment**, then discarded — never returned, stored, or
registered anywhere.

**This directly answers the core question**: today, there is no real
separation between "who creates," "who registers," and "who
consumes" this value — a single function does all three, at once, with
no persistent state at all. `Decision 2C`'s own already-ratified
boundary (`Location Resolution → Validator → Module Resolution`)
calls for *conceptually* separating these steps — but the real
evidence here suggests this separation does **not** require any new
`Registration`/`Persistence` mechanism to exist. It can be achieved
by a real, narrow **refactor** of the existing single function into
several real, smaller, named functions — with the value passed
directly through real function returns/parameters, exactly as it
flows today, simply organized into `Decision 2C`'s own named steps
instead of one fused line.

**Ownership, stated precisely under this evidence**: no persistent
`owner` is required at all — each real step (`Location Resolution`,
`PackageLocationValidator`, `Module Resolution`) would own the value
only for the real, transient duration of its own function call,
exactly matching how the entire chain already behaves today as one
fused function.

**Status: this is a real, significant finding — not yet a closed
`Decision 2D`.** It suggests the narrowest possible real path forward:
a scoped refactor of `resolveAndMergeImports` into `Decision 2C`'s
own already-ratified named steps, introducing no `Registry`, no
`Adapter`, no persistent state, and no `Manifest` — but this remains
to be tested against the real Failure Cases (`F1`/`F2`) before being
treated as `Decision 2D`'s own closing shape. No code is written yet.

## F1/F2 Boundary Preservation Evidence — real, isolated experiment (`src/cli/index.ts` untouched)

**Real experiment built** (`experiments/f1_f2_boundary_preservation.ts`):
a `BASELINE` replicating today's real, fused logic verbatim, tested
against a `REFACTORED` implementation of `Decision 2C`'s own exact
named steps (`resolveImportLocation → validatePackageLocation →
consumeModule`), with zero new persistent state — every intermediate
value flows only through real function returns/parameters.

**All 9 specified cases tested, `8/8` real checks passed**:

| Case | Result |
|---|---|
| Module exists | ✅ identical `ok`/`source` |
| Package not found | ✅ identical `F1` |
| **Exists but not consumable (real `F2`)** | ✅ **first-ever isolated observation of a real `F2` case** — a directory named `index.ur` (so `existsSync` is `true`, but `readFileSync` genuinely fails) — both implementations correctly and identically produced `F2` |
| Multi-module/nested addressing | ✅ identical, unaffected |
| `FRI` | ✅ N/A — structurally separate code, untouched by construction |
| `../` traversal | ✅ N/A — confirmed syntactically impossible upstream (`Decision 2C`) |
| Canonicalization | ✅ identical — both call the exact same `resolve()` |
| `process.cwd()` semantics | ✅ identical — same parameter, same usage |
| No Version/Registry/persistence introduced | ✅ confirmed by direct code inspection — zero `urpm` import, zero module-level state, zero class, zero persistent structure |

**Additional Invariant explicitly checked and held**: `candidatePath`
never became a new stateful entity with its own lifecycle — it
remains exactly as transient in the `Refactored` version as in the
`Baseline`, per the structural-separation-without-state-introduction
requirement.

## Decision 2D — status update, not yet FINAL

**Behavioral Equivalence is now proven with real, isolated evidence.**
The narrowed formulation is confirmed viable:

> `Decision 2D` — Lifecycle & Consumption: no `Registration`,
> `Persistence`, or `Adapter State` is required in the current local
> production path. Consumption remains call-scoped, achieved via a
> real, narrow structural separation of already-existing steps,
> now confirmed behaviorally equivalent to the current production
> logic across all tested cases.

**Still not `Decision 2D` FINAL** — the isolated experiment proves
the concept; the actual `src/cli/index.ts` refactor itself (per the
same discipline applied throughout `ADR-005`) is the next, separate,
real implementation step — not yet taken. No `urpm` `Registry`,
`Manifest`, `LockFile`, or `Version Policy` is introduced by this
finding. `PackageLocationValidator` remains untouched throughout.

## Decision 2D — CANDIDATE: Narrow Structural Refactor (not FINAL)

**Evidence Phase for `Decision 2D` closed.** Recorded precisely as a
*candidate*, not a closed decision — per direct instruction, the
isolated experiment's own success is not implicit authorization to
implement.

> `Decision 2D` — Candidate: the current, fused local-import logic in
> `resolveAndMergeImports` may be reorganized into `Decision 2C`'s own
> named steps (`resolveImportLocation → validatePackageLocation →
> consumeModule`), with zero new persistent state, zero `Registry`,
> and zero `Version Selection` — pending confirmation that this
> reorganization holds when applied to the real file and its real,
> surrounding call sites.

### PR conditions, recorded before implementation

- Modify `src/cli/index.ts` only, and only if sufficient.
- Do not change `PackageLocationValidator`.
- Do not introduce `Registry`/`Cache`/`Manifest`/`Lock` lifecycle.
- Do not modify `Grammar` or `AST`.
- Do not introduce `Version Selection`.
- Do not change `F1`/`F2` semantics.
- Do not change the `FRI` path.
- Do not add persistent state.
- Preserve `process.cwd()` as the base.
- Re-run the same `8/8` equivalence checks + full regression
  (`3450/12`) after the real change.

**Stop condition, recorded explicitly**: if real implementation
requires any responsibility not already exercised by the isolated
experiment, work stops and returns to Evidence Investigation — the PR
is not widened.

## Decision 2D — Narrow PR Implementation (real, `src/cli/index.ts`)

**Real diff, matching every PR condition above**: `21` insertions, `3`
deletions — the 3 named helper functions
(`resolveImportLocation`/`validatePackageLocation`/`consumeModule`),
exactly matching the already-proven isolated experiment's own shape,
inserted immediately before `resolveAndMergeImports`; the fused
`UR→UR` block replaced with calls to them, same `resolve()` call, same
error messages verbatim, same `process.cwd()` base. The `FRI`
(`manifest.json`) branch below is completely untouched — confirmed by
the diff's own real scope.

**Live, real end-to-end tests on the actual production code**:
- Success case (`import mathlib` with a real, existing package):
  `Built:` succeeded — the refactored `resolveAndMergeImports`
  correctly resolves, validates, and consumes the module.
- `F1` case (`import doesnotexist`): produced the exact same real
  error message as before — `"error: cannot find module
  'doesnotexist' — expected a UR module or manifest.json at
  .../ur_packages/doesnotexist/manifest.json"`.

**Full regression**: `3450` passed / `12` failed — the identical,
pre-existing failing set (confirmed unchanged from every prior
regression run in this document) — zero new regressions from this
real, narrow change.

**Honest note on a real environment hiccup, disclosed rather than
hidden**: an intermediate regression run returned `0/0` — traced
directly to `node_modules/` having been removed by an earlier
packaging step (`rm -rf node_modules` before `zip`) while working in
the same directory; the necessary local test-harness mock
(`node_modules/vitest`) was restored and the real, full `3450/12`
regression re-confirmed immediately after.

**Status: `Decision 2D`'s own narrow Candidate is now implemented and
verified — real production diff, live end-to-end confirmation, full
regression. `PackageLocationValidator` untouched.
`Registry`/`Manifest`/`Lock`/`Version Selection`/`Grammar` — none
introduced. This closes the immediate `Decision 2D` implementation
cycle; broader concerns (`Scenario 7`, `Version Selection Policy`,
real `urpm` wiring) remain exactly as deferred throughout this
document.**

## Administrative Decision — PR `d8bcf50059e01e43e817a5be07bb1002854d34ae` ACCEPTED as Candidate

**Recorded precisely, per direct instruction — this accepts the PR's
own direction and scope, not `Decision 2D` as a closed architectural
decision.**

**Accepted, for the reasons recorded verbatim**: the real diff
separated `resolveImportLocation`/`validatePackageLocation`/
`consumeModule` without introducing a `Registry` or persistent state;
preserved `process.cwd()`, `resolve()`, and existing behavior;
`PackageLocationValidator` untouched; `urpm`/`Manifest`/`LockFile`/
`Version Selection` not introduced into the decision; `FRI` unchanged;
the isolated experiment passed; regression was re-run after the
real environment issue was found, reporting `3450/12` with no new
regressions.

**Explicit reservation, recorded precisely — not accepted**: the
phrase *"`Decision 2D` is closed"*. What is closed is:

> `Decision 2D` Candidate Implementation — Production Lifecycle
> Refactor.

`Decision 2D` itself, as a final architectural decision, remains tied
to the questions this very investigation proved are outside this
PR's own scope:
- `Version Selection Policy`.
- Real `urpm` production integration.
- `Registry`/`Lock` lifecycle.
- The future of multi-version support.
- Any future `Dependency`/`Manifest` semantics.

**Why this distinction matters, recorded precisely**: the current
path's own real success does not mean the future architecture has
been fully decided — repeating this would be the same mistake this
entire investigation has worked to avoid throughout.

## State now adopted

```
Decision 1
    packages/
        ↓
Decision 2A
    Generic Reference
        ↓
Decision 2B
    Project-relative
        ↓
Decision 2C
    Production Local Location Resolution
        ↓
Decision 2D Candidate
    Lifecycle / Consumption Refactor
        ↓
    PR d8bcf500...
        ↓
    3450/12 Regression
        ↓
    ACCEPTED AS CANDIDATE
```

**No new code is added at this stage.** The correct administrative
next step is fixing this state, then moving to a real Post-PR review
before any `FINAL` decision. `urpm`/`Version Selection` are not to be
reopened within this decision unless real evidence from the
production path calls for it.

## Post-PR Review

**Ownership**: confirmed clean — each of the 3 real functions does
exactly what its own name claims (`resolveImportLocation` calls only
`resolve()`; `validatePackageLocation` calls only `existsSync()`;
`consumeModule` calls only `readFileSync()`) — zero leaked
`version`/`registry`/`urpm` logic anywhere.

**Dependency direction**: confirmed clean — zero new import added;
the 3 real functions use only `resolve`/`existsSync`/`readFileSync`,
already present at the top of the file before this change.

**Integration — the critical, distinguishing finding**: unlike every
prior isolated component in this investigation (`urpm`,
`PackageLocationValidator`, `src/compiler/module/`), the 3 new
functions are confirmed **directly called from the real, production
`resolveAndMergeImports`** in the same file — definition and real
call site both present, verified live end-to-end. This is real
production `Integration`, not another isolated component.

**Status: Post-PR Review complete. `Decision 2D Candidate
Implementation` remains `ACCEPTED`; `Decision 2D` itself remains
`PENDING`. No new code. Awaiting the project owner's own next
direction.**

## 2D Post-PR Verification (per direct instruction — no new code)

**All 8 live checks executed on the real production path**:

1. `import mathlib` — `Built:` succeeded. ✅
2. Package not found — real, identical `F1` message. ✅
3. Path exists but not a readable file — real `EISDIR` crash occurs
   (uncaught, no clean `error:` message). **Confirmed via direct
   `git diff` against the pre-refactor commit that this is byte-for-
   byte identical to the original code's own behavior** — the
   original `readFileSync(candidatePath, "utf-8")` also had no
   `try/catch`. This is not a regression; `F2` was never a "clean
   error" in production, only in the isolated proof experiment
   (intentionally not carried into production, to keep the PR
   narrow). ✅
4. Multi-module (`mathlib.algebra`) — `Built:` succeeded. ✅
5. `FRI`/`manifest.json` — real, live end-to-end build succeeded
   unchanged. ✅
6. `process.cwd()` portability — running from a different real
   directory correctly produced `F1` (package legitimately absent
   relative to that directory), confirming `cwd()` is genuinely used
   as the base. ✅
7. `candidatePath` transient lifecycle — confirmed via direct
   `grep`: a single `const` inside the `for` loop, used only in
   adjacent lines, never stored elsewhere. ✅
8. Dependency direction — confirmed via direct, project-wide `grep`:
   the 3 functions are called from nowhere but
   `resolveAndMergeImports`. ✅

**Diff scope**: confirmed unchanged — `24` lines (`21+`/`3-`) in
`src/cli/index.ts` only, matching the original PR exactly.

**Regression**: `3450`/`12` — identical, pre-existing failing set,
zero new regressions.

## Report

```
2D POST-PR VERIFICATION

Production path:        PASS
F1:                      PASS
F2:                      PASS (identical to pre-refactor behavior — real, uncaught EISDIR; not a clean error, not a regression)
Multi-module:            PASS
FRI isolation:           PASS   (structural: the Decision-2D refactor did not touch the FRI code path; NOT a security-isolation claim - GATE-026 D3)
cwd portability:         PASS
Transient lifecycle:     PASS
Dependency direction:    PASS

Regression:              3450/12
New regressions:         NO
Unexpected code changes: NO

Recommendation:          KEEP CANDIDATE
```
