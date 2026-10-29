# ARRAY_PARAMETER_SEMANTICS_BASELINE.md

**Status: RATIFIED BASELINE — Semantic Model DECIDED (Q1-Q5 closed via
a real, ratified language design decision: Reference Semantics).**
Pure language semantics — no C, no LLVM, no Backend, no
implementation, no proposed IR fields. This document remains the
single starting point for any future design or implementation
discussion on array parameters. No design or code may proceed without
pointing to a specific line/test/document cited here, or explicitly
stating the point remains undecided.

## 1. What is `a`, semantically, when a function receives it?

**Confirmed**: the current language rejects copying an `Array` in the
one context actually tested (`let b: int[] = a`) — so, in that
specific context, `Array` does not behave as a copyable value.

**Confirmed**: `FUNCTIONS_ABI_SPEC.md §2.2` explicitly excludes
"returning aggregates (structs/arrays)" from its own original scope —
`Array` was never covered by the general "Parameters are passed by
value" rule at the time it was ratified.

**Confirmed**: `Struct` later adopted a real, explicit, separate
ratified decision (`LANGUAGE_SYNTAX_1_1_SPEC.md §2.5`: BY VALUE) — no
equivalent section exists for `Array` in any official document.

**Confirmed**: `string` (another heap-allocated type) is passed as a
raw `const char*` pointer, never copied via `strdup` — real precedent
that UR's own C Backend already avoids full-content copies for
heap-allocated types, though `string` has no documented write
operation, so this precedent cannot by itself resolve mutation
visibility (Q3).

**RATIFIED DECISION (not inferred from the evidence above — a real
language design choice made by the project owner, since the evidence
rules out one model, Full Value Copy, but does not by itself
distinguish among Reference/Borrow/Handle):**

> Array values in UR have reference semantics. Passing an array to a
> function passes a reference to the same array object, not a copy of
> its contents.

**Rationale for choosing this over the alternatives** (Borrow,
Handle): Borrow semantics would require a lifetime/borrow-checking
system that does not exist in UR today, with project-wide design
consequences. Handle semantics would require a runtime object-
management system (GC, reference counting, or an explicit handle
table) that also does not exist today. Reference semantics is the
only option consistent with UR's current architecture without
introducing a new subsystem.

**Consistency check**: this decision does not contradict any
confirmed evidence above — rejecting full-content copy is consistent
with reference semantics (a reference is never copied by value
either).

**Explicitly not a claim about the past**: this is a real decision
made now, not a discovery that the language "already had" this
semantic. A future addition of Borrow/Ownership semantics would be a
real language evolution, not a correction of this decision.

## 2. Who owns the storage?

**Direct consequence of the ratified Q1 decision (Reference
semantics)**: the caller owns the storage. A reference does not
transfer or share ownership — it points to a single, real object
whose lifetime and ownership remain with whoever created it (the
caller, in every case considered so far — no function has been
identified in this document that creates and returns a new array
object, which would raise a separate, real question about who owns a
newly-created array's storage — that question remains open and is
not addressed by this consequence).

## 3. Can the callee modify the caller's array?

**Direct consequence of the ratified Q1 decision (Reference
semantics)**: yes. `a[i] = ...` inside the callee modifies the same
array object the caller owns — this is the explicit, stated
consequence of the ratified decision itself:

```
let x = [1, 2, 3]
f(x)  // where f(a: int[]) { a[0] = 100 }
// x is now [100, 2, 3]
```

This is a direct entailment of "reference to the same object," not a
new, separate inference.

## 4. What is the semantic definition of `a.length` inside the callee?

**Confirmed**: the declared type (`int[]`) carries no length number
in the language's own grammar.

**Direct consequence of the ratified Q1 decision (Reference
semantics)**: `a.length` is a property of the referenced entity (the
real array object the reference points to), not of the declared type
`int[]` itself. Two different calls to the same function with two
different arrays of different real lengths correctly see two
different `a.length` values, because `a` refers to a different real
object each time — the type annotation itself never carried a length
to begin with.

## 5. Can UR support `int[]` without length information?

**Direct consequence of the ratified Q1 decision (Reference
semantics)**: yes. Since `a.length` belongs to the referenced entity
(Q4), not the declared type, the type annotation `int[]` never needs
to carry a length — this is consistent by construction, not a
separate new claim.

**Additional, explicitly ratified consequences (stated directly by
the project owner as part of the same decision, not separately
inferred)**:
- There is no implicit array copy anywhere in the language.
- Any future copying must be an explicit operation (e.g. a `clone()`
  or equivalent, if added later) — never implicit.
- If Borrow or Ownership semantics are added to UR in the future,
  that is a real language evolution, not a correction of this
  decision.

## 6. Information flow diagram

```
Parser
  |  Confirmed: distinguishes the declared type (int[]) with no length
  v
Semantic
  |  Now has a real, ratified answer to build from: Reference semantics
  |  (Q1) - HOW this is represented at this stage remains unimplemented
  v
IR
  |  Now has a real, ratified answer to build from: a[i]=... mutates
  |  the caller's own object, length belongs to the referenced entity
  |  (Q2-Q5) - HOW this is represented at this stage remains
  |  unimplemented
  v
Backend
     (entirely out of this document's own scope)
```

## Standing rule (per direct instruction, to prevent recurrence of
prior deviations in Priority 2/Priority 3)

No design or code may be proposed unless it can point to the specific
line, test, or document it is based on — or explicitly states the
point remains undecided.

---

# Part 2: Semantic → IR Representation

**Scope**: purely abstract semantic representation — no C, no
Backend, no pointer, no stack/heap, no ABI. This section answers only
how the ratified Reference Semantics decision (Part 1, Q1) is
represented in the abstract, at the Semantic/IR level.

## 1. What entity does `a` represent when its type is `int[]`?

**Direct consequence of the ratified Q1 decision**: `a` represents a
**reference to an Array entity** — not the type itself, but a
reference to a real, standalone Array object, distinct from any other
variable that might reference it later (per Q1/Q2: no shared
ownership, a single reference to a single-identity object).

## 2. What information does this entity carry within the IR?

Confirmed directly: `ArrayType = { kind: "Array", element }`
(`src/compiler/typesystem/types.ts:123`) — the abstract type itself
carries only the element type, no identity, no length.

| Information | Belongs to |
|---|---|
| **Identity** (which specific entity `a` refers to) | **Object Metadata** |
| **Length** (per ratified Q4) | **Object Metadata** — never part of the declared type |
| **Element type** (`element`) | **Type Metadata** — confirmed directly, part of the type's own definition |

This document does not determine when or how this information becomes
available — that belongs to the representation layer, not to
semantics.

## 3. What operations are permitted on this entity?

| Operation | Status | Evidence |
|---|---|---|
| Passed as an argument | ✅ Permitted | Q1 — reference passed to another function, no copy |
| Reading `a[i]` | ✅ Permitted | Already real and tested for local variables today |
| Writing `a[i]`, visible to the caller | ✅ Permitted | Ratified Q3 (`[100,2,3]`) |
| Reading `a.length` | ✅ Permitted | Ratified Q4 |
| Comparison | **Cannot be concluded at this time** | No evidence — no test, no document examines this for `Array` |
| Other operations? | **Cannot be concluded at this time** | Outside what the Baseline or any further evidence has resolved |

**The absence of an operation from this list does not mean it is
forbidden or permitted — it means the language has not yet decided
it.**

## 4. What does the IR NOT know at this level?

Within the requested scope (pure semantic abstraction, no Backend):
the IR distinguishes between **Atomic Values** and **Reference-backed
Objects** — a semantic distinction, not an implementation detail. The
IR at this level does not know HOW this reference is realized (no
pointer, no stack/heap, no ABI) — only that (a) a real distinction
exists between a parameter carrying a plain atomic value and one
carrying a reference to an independently-identified object, and (b)
that object carries two pieces of information belonging to it, not to
its type (identity, length). HOW this reference is actually
implemented is a question that begins only at the next layer, IR →
Backend Mapping.

## Invariants (Semantic Contract)

The following rules must never be broken by any future IR or Backend
representation choice — a lower layer may only *represent* these
semantics, never *change* them. Each point is a direct restatement of
an already-ratified fact above, not a new claim.

1. `Array` is a Reference-backed Object (Part 2, Q1/Q4) — never an
   Atomic Value, never a fully-copyable value type.
2. The element type (Type Metadata) is fixed for the entity's entire
   lifetime (Part 2, Q2) — it belongs to the type, never changes per
   reference.
3. Object identity does not change because the object is passed
   between functions (Q1/Q2) — passing a reference never creates a
   new, distinct entity.
4. Length (Object Metadata) belongs to the entity, never to the
   declared type (Q4/Q5) — `int[]` itself never carries a length.
5. Reading and writing elements (`a[i]`) act on the same referenced
   entity (Q3) — a write inside a callee is visible to the caller,
   because both refer to the same object, not separate copies.
6. `Array` is never copied implicitly (Q5) — any future copying of an
   `Array` must be an explicit operation. (Scoped to `Array`
   specifically — this is not a language-wide claim about every type
   that might be added in the future.)
7. **Length has exactly one semantic source of truth: the Array
   Object** (ADR-005, per the Implementation Contract's own explicit
   promise to add this Invariant upon real implementation). A
   parameter's own transported `Length` (the `(pointer, length)`
   Boundary Representation) and its internal IR representation
   (`IRParam`) must always trace back to this same, single source —
   never an independently-asserted constant. Implemented for the `C`
   Backend in `Commit a340ab4d304fdc01f8b3107e814d8b60ad19d5fe`,
   verified clean by the Post-ADR-005 Audit
   (`Commit 0226bb07c8e13e59120e4fd717df56769840a1df`). Scoped to `C`
   Backend only — the `WASM` Backend does not yet implement
   array-parameter support at all (a real, pre-existing, unrelated
   limitation, not addressed by this Invariant).

## Future Evolution Guidelines

The following describes policy for extending the language in the
future — not a constraint on current language behavior, and
therefore not listed among the Invariants above:

- Any future addition of Borrow or Ownership semantics is a real
  language evolution built on top of the Invariants above, not a
  permitted violation of them (Q1).
- Whether `Array` values support a comparison operation, and whether
  any other operation beyond those already listed in Part 2 §3 is
  permitted, remain genuinely open (Part 2 §3: Comparison, Other
  operations) — any future resolution of either is a real language
  decision, not something this document or Part 3 has settled or may
  silently assume.

---

# Part 3: IR → Backend Mapping — Opening Principle

**Status: layer opened, governed by the rule below. No mapping
decisions made yet in this document.**

## Mapping Principle

Every piece of information that appears in the IR must be directly
justified by an entry already present in Semantic → IR Representation
(Part 2) or in the Invariants above — never introduced merely because
it makes implementation easier.

```
Semantics  →  determines WHAT must be represented
IR         →  determines HOW that semantics is represented
Backend    →  determines HOW that representation is executed
```

No layer is permitted to introduce new semantics of its own.

**The real, checkable test for any future IR field proposal**:
- Does this field exist because it represents an Invariant or a piece
  of information already listed in Part 2? → Accepted.
- Was it added only because it makes the Backend's job easier? →
  Rejected, or moved to the implementation layer instead.

## Mapping Preservation Principle

Every mapping decision must be Semantics-Preserving. If a given IR
representation would cause any language Invariant (above) to be
violated, that representation is invalid, regardless of its
efficiency.

This principle complements the Mapping Principle above: the Mapping
Principle prevents Backend-specific information from entering the IR;
this principle prevents any representation choice from changing what
the language actually means.

## Decision 1: Representation Unit

**What does the IR represent for `Array`: an Atomic Value, a
Reference-backed Object, or another kind?**

The IR Representation Unit for `Array` is constrained to represent a
Reference-backed Object, because any Atomic representation would
violate Invariant 1 and therefore fail the Mapping Preservation
Principle.

This is not a redefinition of `Array`'s own semantics (already
settled in Part 1) — it is the confirmation that any Representation
Unit choice at this layer is constrained by that already-settled
semantics. There was never a real, independent choice between Atomic
and Reference here; only one of the two preserves the Invariants
already ratified.

This decision is stated at the purely conceptual level only: the IR
distinguishes, in principle, between representing something as a
single atomic unit versus representing something as a reference to a
separately-identified object. This document does not yet state what
form that distinction takes (no fields, no structures) — only that
`Array` belongs to the second category, never the first.

**Traceability**: derived from Invariant 1. Constrains Part 4: any
proposed IR structure for `Array` must itself be a Reference-backed
Object structure — an Atomic-Value-shaped structure is rejected
regardless of implementation convenience.

## Decision 2: Identity Mapping

**How does the IR hold an entity's identity without prescribing an
implementation mechanism (no pointers, no memory)?**

This is a genuinely new decision at this layer — not derivable purely
from Part 1/Part 2, which established *that* identity belongs to the
object (not the type), but not *how* the IR conceptually carries that
identity.

**Decision**: the IR must preserve object identity. Two references
originating from the same language object must continue to denote
the same language object throughout all IR transformations.

This decision does not require the IR to expose an identity-
comparison operation, nor to define how identity is represented
internally. It only requires that identity is never lost or replaced
during IR transformations.

**Rationale**: this is the minimal conceptual requirement that makes
Invariant 3 (identity does not change when passed between functions)
and Invariant 5 (reads/writes act on the same referenced entity)
expressible in the IR at all — without this preservation guarantee,
an IR transformation could silently replace one entity with a
different one that merely looks alike, breaking both Invariants
without violating any explicit rule.

**Three distinct levels, deliberately separated by this decision**:
1. **Identity Preservation** — this decision (Part 3, Decision 2).
2. **Identity Representation** (how identity is concretely carried) —
   a later decision.
3. **Identity Comparison** (whether/how the language exposes a way to
   compare identities) — a possible later decision, or something the
   language may never need.

**Explicitly out of scope for this decision**: how identity is
actually realized (no pointers, no addresses, no memory model), and
whether any comparison operation exists at all — both remain fully
open, addressed only by later, more implementation-facing decisions
if and when needed.

**Terminology note**: this section's own title, "Identity Mapping,"
is broader than what it actually decides. What is ratified here is
specifically **Identity Preservation** (level 1 of the three listed
above) — Identity Representation and Identity Comparison remain
genuinely open. Future references to "Identity Mapping" should be
understood as this narrower, Preservation-only scope, not the full
three-level concept.

**Traceability**: derived from the necessity of expressing Invariant
3 and Invariant 5 in the IR. Constrains Part 4: any proposed IR
structure must guarantee that two references to the same source
object remain denoting that same object across every IR
transformation — a structure that could silently substitute a
different, look-alike object is rejected.

## Decision 3: Metadata Mapping

**Opening question, split into two distinct sub-questions to prevent
conflating identity with description from the start** (per the same
discipline that separated Identity Preservation from Identity
Comparison in Decision 2):

1. **Identity Metadata**: information that, if it changed, would mean
   the entity is no longer the same entity.
2. **Descriptive Metadata**: information that can change while the
   entity remains the same entity.

**Classification, grounded directly in the Invariants already
ratified in Part 1/Part 2**:

| Information | Classification | Reasoning |
|---|---|---|
| Identity | Identity Metadata | The only thing whose preservation Invariant 3 (identity does not change when passed between functions) actually depends on. |
| Length | Descriptive Metadata | Length describes the entity, but is not the entity itself. Even if a future language extension allowed length to change, that would not make it a different entity. |
| Element Type | Descriptive Metadata | Element Type describes the entity's own nature, not its identity. |

**No other Metadata has been identified in this document that
qualifies as Identity Metadata** — Identity itself remains the only
member of that category.

Identity Metadata determines object identity. Descriptive Metadata
never determines identity, but may constrain the validity of
operations performed on that object.

**Traceability**: derived from Invariants 1, 3, and 4. Constrains
Part 4: any proposed IR structure must keep Identity Metadata and
Descriptive Metadata distinguishable — a structure that conflates the
two (e.g. treating a length change as an identity change) is
rejected.

## Decision 4: Operations Mapping

**Opening question**: do operations act on the reference itself, or
on the entity the reference denotes?

**Decision**: operations act on the entity the reference denotes, not
on the reference itself.

**Direct grounding in an already-ratified fact**: this is precisely
what Invariant 5 (reads and writes act on the same referenced entity)
already establishes — a write performed through one reference is
visible through any other reference denoting the same entity (Part 1,
Q3: `x` becomes `[100, 2, 3]`). This would be impossible if operations
acted on the reference itself rather than on the entity it denotes —
two distinct references would then be two independent things with no
way to observe each other's effects.

**Consequence for the specific operations named**: `read (a[i])`,
`write (a[i] = ...)`, and `read length (a.length)` all act on the
entity — never on the reference as a standalone thing. `pass (as an
argument)` transfers the reference itself (per Decision 1/Decision 2:
a reference-backed representation, preserving identity) — but the
entity the reference denotes remains the same single entity
throughout, consistent with Invariant 3.

**Traceability**: derived from Invariant 5 and Part 1 Q3. Constrains
Part 4: any proposed IR operation (read/write/length) must be defined
to act on the entity itself, never on a reference copy that could
diverge from other references to the same entity.

## Identity Boundary Classification

**Opening question**: at which boundaries must the entity's identity
remain preserved, and at which boundaries may it change or end?

Each boundary below is examined against what this document has
already ratified — a rule is stated only where existing evidence
resolves it; otherwise the boundary is marked explicitly undecided.

| Boundary | Identity | Grounding |
|---|---|---|
| Within the function itself | Preserved (trivially — no boundary is actually crossed within a single scope) | Not a real boundary crossing |
| Passed to another function | **Preserved** | Invariant 3, stated directly: "identity does not change when passed between functions" |
| Returned from a function | **Intentionally Unspecified in the Current Language Revision** | Explicitly left open already, Decision 2's own grounding text (Part 1, Q2): "no function has been identified... that creates and returns a new array object... that question remains open" |
| Assigning a new reference to it (e.g. `let b = a`) | **Not applicable today** | The one tested case of this (`let b: int[] = a`) is currently rejected by the language outright (Part 1, confirmed evidence) — the boundary does not currently exist to have a rule about |
| End of scope | **Intentionally Unspecified in the Current Language Revision** | No ratified fact in this document addresses this boundary |
| Creating a new entity from another `Array` (e.g. a future slice/derive operation) | **Intentionally Unspecified in the Current Language Revision** | No such operation exists in the language today; any answer would belong to Future Evolution Guidelines, not this document |

**Summary**: only one boundary (passed to another function) has a
fully ratified rule today (Invariant 3). Every other boundary
examined is either not a real boundary, not currently possible in the
language, or genuinely undecided — stated as such rather than
resolved by inference.

**Traceability**: derived from Invariant 3 and the explicitly
undecided points already flagged in Part 1 Q2. Constrains Part 4: any
proposed IR structure must guarantee identity preservation across a
function-call boundary specifically; it must NOT assume or bake in
any answer for the boundaries marked Intentionally Unspecified above
(return, end-of-scope, derived entities) — those remain open for a
future, separate decision.

---

## Part 3 Status: CLOSED

**Approved.** Part 3 has fully answered what it set out to answer:
what the IR represents (Decision 1), what must be preserved (Decision
2), what constitutes the entity's identity versus its description
(Decision 3), how operations are interpreted (Decision 4), and where
identity must remain preserved (Identity Boundary Classification).

**No further decision belongs in Part 3.** Any new question from this
point forward is of the form "how do we represent this within the
IR's own structure?" — a structural design question, not a semantic
one. Such questions open **Part 4: IR Structural Design**, not an
extension of this Part.

Reviewer summary: a clear separation exists between Semantics, IR,
and Backend; every decision here is derived from the higher layers;
no implementation leaps occur; the Invariants prevent semantics from
being broken; the Identity Boundary Classification states plainly
what is settled and what is not. Part 4 may proceed without
reopening this Part unless new evidence contradicts the Baseline.

---

## Final Architectural Review (per direct instruction, before v1.0 declaration)

A real review against 4 criteria found 3 genuine issues, all fixed in
this same revision:

1. **Traceability**: every Part 3 decision now states explicitly both
   what Invariant/fact it derives from, and what it constrains in
   Part 4 (added to Decisions 1-4 and the Boundary Classification).
2. **Terminology consistency**: Decision 2's own title ("Identity
   Mapping") was broader than its actual scope (Preservation only) —
   a clarifying note now scopes future references precisely.
3. **Scope closure**: Part 2's two open operations (Comparison, Other
   operations) were not formally registered in either designated
   section for open topics — now explicitly listed in Future
   Evolution Guidelines.

No Internal Consistency violation was found — every Part 3 decision
traces to Part 1/Part 2/Invariants, none rests on an undocumented
assumption.

## Architecture Baseline v1.0

This document defines the semantic and architectural constraints
governing all future IR structural design. Any future IR design must
conform to these constraints unless this baseline itself is revised
through the documented review process.

### Amendment Policy

This baseline is stable, not immutable.

**Legitimate grounds for revision**: new test evidence, a discovered
logical contradiction within this document, or a genuinely new
language requirement not previously considered.

**Illegitimate grounds for revision**: implementation convenience, or
Backend difficulty. A representation being hard to implement is never
by itself a reason to change what this document has ratified — per
the Mapping Preservation Principle, the correct response to a hard
representation is a better representation, not a semantics change.

**Any future amendment must state**:
1. What changed.
2. Why (citing the specific new evidence).
3. What downstream decisions (in this document or in Part 4/Backend)
   are affected by the change.

---

# Part 4: IR Structural Design

**Status: opened.**

## Foundational Question

**What is the smallest IR structure capable of preserving all
approved semantics and invariants, while introducing no
backend-specific information?**

This question governs every structural decision that follows — each
proposed structure must be justified against this question, not
against implementation convenience or precedent from another
language/backend.

**This question is deliberately not answered directly.** It is
decomposed into four ordered sub-questions, each answered only from
what the prior sub-question (or Part 2/Part 3) has already
established — no sub-question anticipates the one after it.

## Decision 1: Fundamental IR Entity Model

**Does the IR deal with Values only, Objects only, or two separate
kinds?**

**Direct restatement of an already-established fact** (Part 2 §4,
verbatim): "the IR distinguishes between **Atomic Values** and
**Reference-backed Objects**." This is not a new choice made now —
the two-category model already exists in this document's own
established vocabulary, confirmed again by Part 3 Decision 1 (`Array`
is constrained to the Reference-backed Object category specifically).

**Answer**: two separate kinds. An Atomic Value carries no identity
of its own — it is fully described by its own content. A
Reference-backed Object carries an identity distinct from its content
(Part 2 §2: Identity Metadata vs Descriptive Metadata) — two objects
could hold identical content while remaining two different objects
(Decision 3, Part 3).

**Traceability**: derived from Part 2 §4 and Invariant 1. Constrains
every later Part 4 decision: any structural proposal must fit within
one of these two categories — no third, hybrid category is introduced
by this decision, and none has been justified by any prior Invariant.

## Decision 2: Association Representation — What Is Associated With What

**Scoped precisely, per direct instruction, to the parties of the
relationship — not yet its form.**

Three candidate models: (1) Reference ↔ Object, (2) Variable ↔
Object directly, (3) Variable ↔ Reference ↔ Object.

**Direct textual evidence, already ratified**:

- Part 2 §1 (verbatim): `"a" represents a **reference to** an Array
  entity`. This wording rules out model 2 — a variable relating to an
  object *directly*, with no reference concept between them, would
  contradict the document's own established phrasing, which
  explicitly names a reference as the thing the variable represents.
- Identity Boundary Classification (verbatim): `"Assigning a **new
  reference** to it (e.g. `let b = a`)"`. This phrasing treats
  "variable" (`b`) and "reference" as genuinely distinct concepts — a
  variable is described as something a reference can be *assigned
  to*, not as identical to the reference itself.

**Answer**: model 3. The relationship is directional, not a symmetric
association between three equal parties:

> The Variable contains a Reference. The Reference designates an
> Object.

This is stated precisely to prevent conflating "the variable is the
reference" with "the variable contains a reference" — a distinction
that matters directly for the next two decisions (Metadata Residency,
Minimal Concept Set). This is the only model consistent with both
pieces of evidence above; model 2 is directly contradicted by Part 2
§1's own wording, and model 1 (omitting the variable as a real party)
does not account for the Boundary Classification's own treatment of
"variable" and "reference" as distinct, separately-nameable things.

**Traceability**: derived from Part 2 §1 and the Identity Boundary
Classification's own existing text. Constrains Part 4: any proposed
IR structure must represent three genuinely distinct parties (not
collapse the variable and its reference into a single concept) — how
each is represented is deferred to a later decision.

## Decision 3: Metadata Residency

**Where does Metadata (Identity Metadata and Descriptive Metadata,
per Part 3 Decision 3) attach within the now-established three-party
model (Variable contains a Reference; the Reference designates an
Object)?**

**Direct restatement of already-established fact**: every prior
mention of Metadata residency in this document says "belongs to the
**entity**" (Invariant 4) or "determines **object** identity" (Part 3
Decision 3) — never "belongs to the reference." This is consistent
with Decision 2's own precise wording: a Reference *designates* an
Object, it does not itself carry the object's own describing data.

**Answer**: both Identity Metadata and Descriptive Metadata reside
with the Object, never with the Reference and never with the
Variable. A Reference does not own object metadata — it designates an
Object, and the Metadata belongs to that Object, not to the act of
designation. (This document does not claim a Reference can never
carry any metadata of any kind in the future — only that it does not
own the Object's own describing data. Any future operational metadata
unrelated to object semantics, if ever needed, is not addressed or
excluded here.) Two different References designating the same Object
see the same Metadata, because the Metadata belongs to the one Object
both designate, not to either Reference individually.

**Traceability**: derived from Invariant 4, Part 3 Decision 3, and
Decision 2's own directional wording (designates, not carries). 
Constrains Part 4: any proposed IR structure must attach
Identity/Descriptive Metadata to the Object representation
specifically — a structure that stores Metadata on a Reference (e.g.
duplicating Length per-reference) is rejected, since two References
to the same Object must observe identical Metadata by construction,
not by synchronization.

## Decision 4: Minimal Concept Set — Proof of Minimality

**Question, precisely per direct instruction**: what is the smallest
set of concepts such that removing any single one breaks an
Invariant, and no concept is fully covered by another?

Every concept established in Decisions 1–3 is tested against three
real questions: (a) which Invariant depends on it, (b) what breaks if
it is removed, (c) is it fully covered by another concept already in
the set (if yes, it is not minimal and must be dropped).

| Concept | (a) Depends on | (b) Breaks if removed | (c) Covered by another concept? |
|---|---|---|---|
| Atomic Value | Invariant 1 (states `Array` is "never an Atomic Value" — a contrast that is meaningless without this concept existing) | Invariant 1 becomes unstatable | No — Reference-backed Object is its own distinct category, not a substitute for the contrast itself |
| Reference-backed Object | Invariant 1 | `Array` itself cannot be represented at all | No |
| Variable | Decision 2 (the parameter `a` itself; Invariant 3 speaks of identity surviving being "passed between functions," which presupposes variables/parameters as real things) | Cannot express a function parameter or `let` binding at all | No — Decision 2 already established Variable and Reference are distinct; Reference alone cannot stand in for "the named thing a caller/callee refers to" |
| Reference | Invariant 3, Invariant 5, Decision 2 | Cannot express identity preservation separately from the variable holding it (per Decision 2's own "assigning a new reference" distinction) | No — Decision 2 explicitly ruled out Variable↔Object direct binding, meaning Reference is a real, necessary intermediary |
| Object | Invariant 1, 3, 4, 5 (all of them) | Nothing remains for a Reference to designate | No |
| Identity Metadata | Invariant 3 (the only thing its preservation depends on, per Part 3 Decision 3's own text) | Cannot distinguish an object's identity from its description — Invariant 3 becomes unstatable | No — Descriptive Metadata is deliberately a different category (Decision 3, Part 3) |
| Descriptive Metadata | Invariant 4 (Length), Part 2 §2 (Element Type) | Cannot express Length or Element Type at all | No — Identity Metadata is deliberately scoped to identity only (a Length change does not change identity, per Part 3 Decision 3's own reasoning) |

**Result**: all seven concepts are minimal — each is depended upon by
a real Invariant, each breaks something specific if removed, and none
is fully covered by another. No concept beyond these seven has been
introduced or justified anywhere in this document.

**Traceability**: this decision does not derive from a single prior
Invariant — it is a proof performed *over* every concept Part 4 has
introduced so far (Decisions 1–3), confirming none is redundant.
Constrains Part 4's own remaining structural design: exactly these
seven concepts, no more and no fewer, must appear in whatever
structure is proposed next — introducing an eighth concept requires
the same three-question justification; omitting one of these seven
requires showing which Invariant no longer needs it.

---

## Part 4 (Conceptual Model) Status: CLOSED

Decisions 1–4 have established the complete conceptual model: two
entity categories (Decision 1), a directional three-party
relationship (Decision 2), metadata residency (Decision 3), and a
proven-minimal concept set (Decision 4). The next stage — actual
structural design (fields, shapes, real IR node definitions) — is a
new phase, not an extension of this conceptual model.

---

# Architecture Dependency Graph

**Built directly from the Traceability statements already present in
this document** — no new claims, a summary view of existing lines
only.

```
Language Semantics (Part 1)
        │
        ▼
Semantic → IR Representation (Part 2)
        │
        ▼
Invariants
        │
        ▼
Part 3 (IR → Backend Mapping Principles)
        │
        ▼
Part 4 (Conceptual Model)
        │
        ▼
Concrete IR Structures   ← not yet started
```

## Part 3 Decisions

**Decision 1 (Representation Unit)**
Depends on: Invariant 1.
Must not break: Invariant 1, Mapping Preservation Principle.

**Decision 2 (Identity Preservation)**
Depends on: Invariant 3, Invariant 5.
Must not break: Invariant 3, Invariant 5.

**Decision 3 (Metadata Mapping)**
Depends on: Invariant 1, Invariant 3, Invariant 4.
Must not break: Invariant 3, Invariant 4.

**Decision 4 (Operations Mapping)**
Depends on: Invariant 5, Part 1 Q3.
Must not break: Invariant 3, Invariant 5.

**Identity Boundary Classification**
Depends on: Invariant 3, Part 1 Q2.
Must not break: Invariant 3; must not silently resolve the boundaries
marked Intentionally Unspecified.

## Part 4 Decisions

**Decision 1 (Fundamental IR Entity Model)**
Depends on: Part 2 §4, Invariant 1.
Must not break: Invariant 1 (no third, hybrid entity category).

**Decision 2 (Association Representation)**
Depends on: Part 2 §1, Identity Boundary Classification's own text.
Must not break: the directional Variable-contains-Reference /
Reference-designates-Object structure — must not collapse into a
direct Variable↔Object binding.

**Decision 3 (Metadata Residency)**
Depends on: Invariant 4, Part 3 Decision 3, Part 4 Decision 2.
Must not break: Invariant 3, Invariant 4 (Metadata must remain
attached to the Object, not duplicated per-Reference).

**Decision 4 (Minimal Concept Set)**
Depends on: all seven concepts established in Part 4 Decisions 1–3
(Atomic Value, Reference-backed Object, Variable, Reference, Object,
Identity Metadata, Descriptive Metadata).
Must not break: any Invariant that depends on one of these seven
concepts (see Decision 4's own proof table for the exact mapping).

## How to use this graph

For any future field or structure proposed in Concrete IR Structural
Design: trace it upward through this graph to the specific Part 4
Decision that requires it, then to the specific Invariant that
Decision derives from, then to the specific Part 1/Part 2 finding
that Invariant restates. A field with no such traceable path is
rejected under the Mapping Principle (Part 3) — it exists only to
ease implementation, not because the language semantics require it.

---

# Part 5: Concrete IR Structural Design

## Opening Rule

Before any Structure or field is added to the IR, every new element
must answer five questions:

| Question | Required |
|---|---|
| Why does it exist? | A specific Decision from Part 4 |
| What does it represent? | Exactly one concept |
| What does it preserve? | One or more specific Invariants |
| What does it NOT represent? | To prevent overlapping responsibility |
| Can it be removed? | If yes, it is not part of the minimal set |

This rule adds no new design — it makes every structural decision
reviewable against the Dependency Graph already established.

**Agenda for Part 5** (kept strictly within the abstract IR, no
implementation leakage):
1. Structural Units — the basic structures within the IR.
2. Object Relationships — how these structures relate to each other.
3. Ownership within the IR — not implementation ownership; who
   contains what.
4. Lifecycle within the IR — when an entity is created, and when it
   ceases to exist, from the IR's own perspective only.
5. Validation Rules — the conditions that make the IR valid before it
   reaches any Backend.

## 1. Structural Units

**§1's own real question**: which of the seven proven-minimal
concepts (Part 4 Decision 4) becomes an independent Structural Unit
within the IR, and which remains a Semantic Concept realized only as
an attribute of another unit? This is a different question from
Decision 4's own minimality proof, which established *that* seven
concepts are necessary — not *which of them stand alone structurally*.

| Concept | Structural Unit? | Evidence from Parts 1–4 |
|---|---|---|
| Atomic Value | **Yes** | Part 4 Decision 1's own contrast category; a real, independently-existing kind of entity in the IR (a plain value with no identity of its own), not an attribute of anything else. |
| Reference-backed Object | **Yes** | Same reasoning — the category `Array` itself belongs to (Part 3 Decision 1). |
| Variable | **Undecided by current evidence** | Decision 2's own text describes it as "containing" a Reference, but this document has not established whether Variable is a new, Array-specific Structural Unit or simply the language's own pre-existing, generic name-binding mechanism (used by every type, not unique to `Array`). No evidence here resolves which. |
| Reference | **Yes** | The Identity Boundary Classification's own wording ("Assigning a **new reference** to it") treats a Reference as a real, independently nameable and assignable thing — not merely a property of the Variable that happens to hold it. |
| Object | **Yes** | The real entity carrying identity and both Metadata kinds (Decision 2, Decision 3) — the central unit this entire model exists to describe. |
| Identity Metadata | **No — Attribute of Object** | Decision 3's own wording: Identity Metadata "**determines** object identity" — a determining property OF the Object, not a separate entity with its own independent existence. |
| Descriptive Metadata | **No — Attribute of Object** | Decision 3's own wording: Length "**describes** the entity" — a describing property OF the Object, same reasoning as Identity Metadata. |

**Result**: two confirmed Structural Units (Atomic Value,
Reference-backed Object), one confirmed central Structural Unit
(Object), two confirmed Attributes of Object (Identity Metadata,
Descriptive Metadata) — and Variable/Reference required real
investigation before being finalized.

### Resolving Variable and Reference

**Direct evidence, from the language's own real, general binding
mechanism** (used for every variable in the language, not only
`Array`): `VarBinding = { kind: "ssa"; ref } | { kind: "slot";
slotId }` (`src/compiler/codegen/lower-to-ir-helpers.ts:45-47`) — a
two-case union, with no separate, independent third entity named
"Reference" anywhere in this real, general mechanism. `slotId` is
itself a plain property inside the `"slot"` case of this same
binding — not a standalone unit.

**This resolves both questions, precisely scoped**: the evidence
proves a narrower claim than "Variable and Reference are one unit."
It proves that, **in the current implementation**, `VarBinding` is
the single Structural Unit that **realizes** both the Variable
concept and the Reference concept together — not that the two
concepts have merged into one meaning. This is a real, current
Structural Realization decision, not a permanent constraint on the
Conceptual Model:

- **Variable**: is the language's own pre-existing, generic
  name-binding mechanism — not a new, Array-specific Structural Unit
  this document needs to introduce.
- **Reference**: has no independent Structural Unit of its own in the
  current implementation — it is realized as `VarBinding`'s own
  `"slot"` case specifically. "Assigning a new reference" (Identity
  Boundary Classification) describes assigning a new `slotId` value
  within this same, single binding mechanism.

**Final table**:

| Concept | Structural Unit? | Evidence |
|---|---|---|
| Atomic Value | ✅ Structural Unit | Part 4 Decision 1's contrast category |
| Reference-backed Object | ✅ Structural Unit | Same reasoning |
| Object | ✅ Structural Unit | The central entity carrying identity and Metadata |
| Variable + Reference | **Both realized by one Structural Unit**, `VarBinding` — not merged as concepts | `lower-to-ir-helpers.ts:45-47` |
| Identity Metadata | ❌ Attribute of Object | "determines object identity" |
| Descriptive Metadata | ❌ Attribute of Object | "describes the entity" |

**This does not contradict Part 4 Decision 2.** Decision 2's own
semantic claim ("the Variable contains a Reference; the Reference
designates an Object") remains true and unchanged — that is a
statement about meaning, not structure. What this section establishes
is narrower and different, and precisely scoped to avoid overreach:

- ✅ **Semantic** (Part 4, unchanged): the Variable contains a
  Reference; the Reference designates an Object.
- ✅ **Structural** (Part 5, this section): one real Structural Unit,
  `VarBinding`, realizes both concepts in the current IR
  implementation.
- ❌ **Not concluded**: that the Variable and Reference concepts
  themselves are "one thing." Only their current structural
  realization is one thing — a real, but revisable, implementation
  decision, not a permanent fusion of the two concepts. If a future,
  real reason to structurally separate them ever arises, this
  document is not contradicted by that separation; it only described
  the current realization, not a permanent constraint on it.

**Status**: §2 (Object Relationships) through §5 (Validation Rules)
remain open — not yet answered in this document.

## 2. Object Relationships

**Object Relationships are defined exclusively between structural
units. Semantic concepts influence these relationships only through
their structural realization defined in §1.**

The confirmed structural units from §1: Atomic Value,
Reference-backed Object, Object, `VarBinding`. (Identity Metadata and
Descriptive Metadata are Attributes of Object, not independent units
— they do not participate in relationships of their own; they are
carried by whichever relationship involves Object.)

**Relationships, derived directly from Part 4's own semantic
relationships (Decision 2) as structurally realized (§1)**:

1. **`VarBinding` (`"slot"` case) → designates → `Object`**. This is
   the structural realization of Part 4 Decision 2's semantic claim
   ("the Reference designates an Object") — `VarBinding` is what
   structurally carries out the designation, per §1's own resolution.
2. **`Object` → is-an-instance-of → `Reference-backed Object`**. This
   is a categorization relationship, not an association — `Object`
   does not relate to the `Reference-backed Object` category the way
   it relates to `VarBinding`; it belongs to that category (Part 4
   Decision 1).
3. **Atomic Values do not participate in Object Relationships,
   because they are not Objects.** This claim is scoped precisely to
   §2's own subject (Object Relationships specifically, not every
   possible relationship within the IR) — it does not foreclose a
   future, separate kind of relationship (e.g. a data-flow or
   expression-dependency relationship) that might one day involve
   Atomic Values; it only states that no Object Relationship involves
   them, since an Object Relationship is by definition a relationship
   whose real subject is an Object, and `Array` (this document's own
   scope) is never an instance of Atomic Value (§1).

**Status**: §3 (Ownership within the IR) through §5 (Validation
Rules) remain open — not yet answered in this document.

## 3. Ownership within the IR

**Which structural unit is responsible for owning each IR entity, and
which units are only permitted to observe or reference it?**

**Direct grounding in already-ratified text**: Part 1 Q2 states
explicitly: "A reference does not **transfer or share ownership** —
it points to a single, real object whose lifetime and ownership
remain with whoever created it (the caller)."

**Answer, scoped precisely to what the evidence actually proves**: at
any point in the current language model, an `Object` has at most one
owner. Passing a reference never transfers or shares that ownership.

**Not proven by this same evidence, and left explicitly open**: the
identity of the owner in every scenario — and specifically who
acquires ownership in a scenario this document has not resolved
anywhere else either (a function that creates and returns a new
`Array`, per Part 1 Q2's own existing disclosure and the Identity
Boundary Classification). In the scenarios this document has
resolved (an `Array` created via a local `let` and subsequently
passed as a parameter), the originating `VarBinding` is the owner and
every later `VarBinding` designating the same `Object` only
observes/references it — but this document does not claim the
originating `VarBinding` is the owner in every possible scenario,
only in the ones already resolved.

**Structural consequence, for the resolved scenarios only**: `Object`
is owned by exactly one `VarBinding` at a time; every other
`VarBinding → designates → Object` relationship (§2) is an
observation relationship, not an ownership one — consistent with
Part 1 Q2's own explicit "does not transfer or share" wording.

**Explicitly left open, per Part 1 Q2's own existing disclosure**:
which `VarBinding` owns an `Object` created and returned by a
function (no such case has been identified or resolved anywhere in
this document — Part 1 Q2, Identity Boundary Classification). This
document does not answer that case here either.

**Traceability**: derived from Part 1 Q2. Constrains Part 4/§1-§2:
any proposed IR structure must represent ownership as a real,
singular relationship (one `VarBinding` per `Object`), never a
shared or reference-counted one — since no evidence anywhere in this
document supports shared ownership, and Q2's own wording explicitly
rules it out.

**Status**: §4 (Lifecycle within the IR) and §5 (Validation Rules)
remain open — not yet answered in this document.

## 4. Lifecycle within the IR

**What lifecycle transitions are required by the current language
semantics, and which transitions remain intentionally unspecified?**

This is purely a classification of transitions already resolved or
left open elsewhere in this document — not a new decision.

| Transition | Status | Evidence |
|---|---|---|
| Creating a local `Array` (`let`) | ✅ Resolved | §3: this is the originating `VarBinding`, the owner |
| Passing it as a parameter | ✅ Resolved | Invariant 3 + Identity Boundary Classification: the `Object` persists, ownership does not transfer |
| End of the owning function's call | 🔓 **Intentionally Unspecified** | Direct, pre-existing evidence: Identity Boundary Classification already classifies "End of scope" as Intentionally Unspecified — not something requiring new derivation, already decided as open |
| Creating an `Array` and returning it | 🔓 **Intentionally Unspecified** | Identity Boundary Classification, and Part 1 Q2's own disclosure — the same open case referenced throughout §3 |
| Deriving a new entity from another `Array` (e.g. a future slice/derive operation) | 🔓 **Intentionally Unspecified** | Identity Boundary Classification: no such operation exists in the language today |

**Result**: exactly two lifecycle transitions are resolved by existing
evidence (creation via `let`, passing as a parameter); the remaining
three are consistently classified as Intentionally Unspecified
throughout this document, not newly discovered gaps.

**Traceability**: derived entirely from §3 and the Identity Boundary
Classification — no new fact introduced. Constrains Part 4/§1-§3: any
proposed IR structure must support the two resolved transitions
concretely, and must not silently assume an answer for the three
unspecified ones — those remain open for a future, separate decision.

**Status**: §5 (Validation Rules) remains open — not yet answered in
this document.

## 5. Validation Rules

**Which conditions must hold for an IR instance to be considered
semantically valid according to Parts 1–5, without introducing any
backend-specific constraints?**

Every rule below is a direct restatement of a decision already made
elsewhere in this document — organized into two categories, per the
requested structure.

### Structural Validation (from §1, §2)

| Rule | Traces to |
|---|---|
| Every `Object` must belong to a valid structural category — `Reference-backed Object`, never `Atomic Value` | §1, Invariant 1 |
| Every `Metadata` item must be an Attribute of `Object`, never an independent Structural Unit | §1 |
| Every relationship must be one of the kinds established in §2 (`VarBinding → designates → Object`, `Object → is-an-instance-of → Reference-backed Object`) — no other relationship kind is valid | §2 |
| `Atomic Value` must never appear as a party in an Object Relationship | §2 |

### Semantic Validation (from Part 1, Part 2, Invariants, §3, §4)

| Rule | Traces to |
|---|---|
| Identity must be preserved across a "passed to another function" boundary | Invariant 3, Identity Boundary Classification |
| Reads and writes must act on the `Object` itself, never on a reference copy that could diverge | Invariant 5, Part 4 Decision 4 |
| An `Object` must never have more than one owner in any scenario this document has resolved | §3 |
| A Length or Element Type change must never be treated as an identity change | Invariant 4, Part 4 Decision 3 |
| No lifecycle transition may be silently assumed for a case classified Intentionally Unspecified (§4) — an IR instance that resolves one of these cases without a documented, separate decision is invalid | §4 |

**Every rule above must be traceable; any proposed rule that cannot
be traced to a specific line in Parts 1–4 or §1–§4 is rejected under
the same Mapping Principle (Part 3) governing every other addition in
this document.**

**Status**: Part 5 (Concrete IR Structural Design) is now complete.

---

## Part 5 Status: CLOSED

§1 (Structural Units) through §5 (Validation Rules) have answered
what this Part set out to answer: which concepts become independent
structural units versus attributes (§1), how those units relate
(§2), who owns what (§3), what lifecycle transitions are
resolved versus intentionally left open (§4), and what conditions
make an IR instance valid (§5) — all derived from Parts 1–4, with
zero backend-specific constraint introduced anywhere in this Part.

This closes the full conceptual and structural design phase
(Parts 1–5) of the Architecture Baseline. Any future work belongs to
a genuinely new phase — concrete field/type definitions realized in
actual code — governed by, and traceable to, everything established
in this document.

---

# IR Implementation Contract

**One page. Converts the Architecture Baseline into a real
implementation contract — no new decisions, only answers derived
directly from what Parts 1–5 already established, plus real existing
codebase precedent where cited.**

## 1. Does each Structural Unit become an independent Type, or might some merge?

Most become independent types. One exception is already established,
not new: Variable and Reference are **realized together** by one
existing type, `VarBinding` (§1) — this is a restatement of §1's own
finding, not a new merge decision. Atomic Value, Reference-backed
Object, and Object remain independent.

## 2. Is Metadata mandatory or optional?

**Semantic Metadata required by the Architecture Baseline is
mandatory; additional implementation metadata may exist provided it
does not alter the architectural semantics.** Per Invariant 1,
`Array` is always a `Reference-backed Object`; per Part 4 Decision 3,
every such `Object` carries both Identity Metadata and Descriptive
Metadata (Length, Element Type) at all times — there is no ratified
scenario in which an `Object` exists without either. This mandate
covers exactly this Semantic Metadata; it does not extend to any
future implementation-specific metadata (e.g. optimization or debug
metadata) that carries no architectural meaning — such metadata, if
ever added, may be optional, as long as it never alters what §5's
Validation Rules already require.

## 3. Are relationships direct references, or via identifiers?

**The current implementation contract adopts identifier-based
relationships. Any future representation is acceptable if it
preserves all architectural Invariants** — consistent with the
Amendment Policy's own distinction between legitimate revision
(new evidence, a discovered contradiction, a genuinely new
requirement) and illegitimate revision (implementation convenience).
This adoption matches real, existing precedent already in the
codebase, not a new choice: `IRValueRef.structSlot?: number` and
`VarBinding`'s own `{ kind: "slot"; slotId: number }`
(`src/shared/ir.ts:59`, `lower-to-ir-helpers.ts:47`) both relate to
their target through a plain numeric identifier today, never a
direct object reference. Any `VarBinding → designates → Object`
relationship (§2) is expected to follow this same pattern for the
current implementation.

## 4. What makes a code change "break the architecture"?

A change breaks the architecture if it does any of the following —
each a direct restatement of an existing rule in this document, not a
new criterion:

- Violates any Invariant (Invariants section).
- Introduces IR information not traceable to a specific Part 4
  Decision or Invariant (Mapping Principle, Part 3).
- Violates a Structural or Semantic Validation Rule (§5).
- Silently resolves a case this document marks Intentionally
  Unspecified, without a documented, separate decision (§4, §5's own
  explicit rule).
- Revises this Baseline for a reason other than the ones the
  Amendment Policy permits (new test evidence, a discovered
  contradiction, a genuinely new language requirement) — never for
  implementation convenience or Backend difficulty.

## Executable Invariants Principle

This document remains a **Specification** — it does not become the
implementation's own runtime reference. Every Invariant that matters
for correctness must have a corresponding automated test (unit test
or validation check) in the actual codebase, not merely a code
comment restating it. The real chain of authority is:

```
Specification (this document)
        ↓
Implementation Contract (this section)
        ↓
Code
        ↓
Validation Tests (executable proof the Invariants still hold)
```

Not:

```
Specification → Code
```

A future code review that asks "why does this field exist" should be
answerable by pointing to this Contract, then this Baseline's own
Dependency Graph — and the Invariant it ultimately traces to should be
independently verifiable by running a real test, not by re-reading a
comment.

---

## Implementation Baseline v2 — Exit Criteria (defined before any v2 code is written)

**Scope**: Semantic → IR Integration only. Semantic becomes capable of
producing the `ArrayObjectModel` introduced in v1; the Backend
continues operating on the old model, untouched.

**v2 is complete when all of the following hold**:
- ✅ Semantic can produce an instance of the v1 `ArrayObjectModel` for
  a real array-parameter program.
- ✅ Zero modification to any Backend or Code Generation file
  (`emit-c.ts` or equivalent).
- ✅ The old model and the new model coexist — the old model remains
  the one actually driving compilation; the new model is produced
  alongside it, not yet load-bearing.
- ✅ Every v1 test still passes, **except** the Phase Invariant test
  (§ above) — which is expected to be intentionally deleted or
  replaced with a v2-appropriate test at this point, per that test's
  own documented purpose.

**v2 explicitly does NOT include** (any of these belongs to a later
version, not v2):
- ❌ Any modification to `ir-builder.ts`'s own Lowering logic.
- ❌ Any modification to `emit-c.ts` or any Backend.
- ❌ Making the new model load-bearing (i.e. actually driving real
  compilation output) — that is deferred to a later version.
- ❌ Fixing Priority 3 (Array Parameters end-to-end) — v2 is a
  structural integration step, not a feature completion.

A v2 pull request that touches any item in the second list is out of
scope for v2 and belongs to a separate, later Implementation Baseline
version.

### v2 Completion Status (precisely scoped, per direct instruction)

**Implementation Baseline v2 completed for the resolved semantic
subset (literal array construction). Array parameter integration
remains intentionally deferred pending architectural resolution.**

This is a deliberate correction of an earlier, imprecise statement
("v2 — all Exit Criteria satisfied"). The accurate status is:

- ✅ v2 satisfies its own Exit Criteria for the subset it actually
  implements (a local `let` binding with a real array literal).
- ❌ v2 does **not** satisfy them for `Array` semantics as a whole —
  specifically, array-typed function parameters were not integrated,
  because the Architecture Baseline has not yet resolved how to
  represent an `Object` whose real length is unknown at Semantic time
  (Part 1 Q4/Q5's own already-documented gap).

### Defer Log

Items intentionally deferred, not forgotten — each requires a real
architectural resolution before implementation, not a workaround:

| Item | Reason for Deferral | Architectural Decision/Question Required |
|---|---|---|
| **Array Parameters** — real question: how is `Object Definition` established for arrays passed as function arguments? | **RESOLVED for Length** (ADR-005, Invariant 7, `Commit a340ab4`) — the source/transport/bounds-checking question is closed for the `C` Backend. Remaining open, unrelated to Length: Indirect Calls (Scenario 4), Copy/Move (Scenario 6), zero-length arrays (Scenario 7/8), `WASM` Backend support (not yet implemented at all). | Length question closed. Other sub-questions each require their own separate resolution if/when prioritized. |

**Validation Scenarios for the item above** (test cases for the same
single question, not separate architectural questions). The purpose
of the following scenarios is to determine whether both
argument-passing forms establish Object Definition at the same
architectural point or at different points:
- **Scenario A**: `let a = [1,2,3]; sum(a)` — passed via an
  intermediate variable. Confirmed: lowers to IR successfully today.
- **Scenario B**: `sum([1,2,3])` — passed directly, no intermediate
  variable. Confirmed: fails at Lowering today (`CG1001` — no general
  `lowerExpr` case for `ArrayLiteral`).

**Readiness-point sub-question RESOLVED via ADR-004**: both scenarios
share the same readiness point (`ArrayLiteral` evaluation) — confirmed
via real AST-level evidence, not assumed. Scenario B's current
failure is a disclosed implementation gap, not a different
architectural readiness point.

**Implementation gap CLOSED** (`Commit 9c3e50f591d94058736559d674ea98e4de02ee71`):
a general `lowerExpr` case for `ArrayLiteral` now exists, extracted
into a single shared method (`lowerArrayLiteral`) alongside
`VariableDeclaration`'s own pre-existing handling. Both Scenario A and
Scenario B now lower to IR successfully, confirmed via 3 real tests.

**ADR-004 PR formally closed, scope precisely recorded**: it closed
the readiness-point question and the `ArrayLiteral` Lowering gap
only. It did **not** close Defer Log Item 1 as a whole, and does
**not** constitute "Array Parameters are now complete" — compiling to
`C` successfully does not mean the runtime path is correct; the real,
disclosed panic proves the opposite.

**Defer Log Item 1 is split into two clearly-separated sub-items, per
direct instruction, to prevent repeating the earlier error of mixing
a pre-existing implementation gap with a new architectural
question**:

1. **Array Parameter Length** — genuinely unresolved architecturally.
   No source of `Length` has been established for a function
   parameter whose declared type (`int[]`) carries no length. This is
   the item's own real, original question, still open.
2. **Bounds Checking for Array Parameters** — a separate, pre-existing
   implementation gap (Priority 3), confirmed via live execution
   testing during this same closure: real execution of an array
   passed to a function panics with "array index out of bounds"
   (the Backend's bounds check reads a slot's own real `length`,
   which a function parameter's own slot does not carry). Present for
   **both** Scenario A and Scenario B equally — not introduced by the
   `ArrayLiteral` Lowering closure above, and explicitly **not** to be
   folded into that PR's own scope.

**Priority 3 remains explicitly out of scope**, per this Baseline's
own Entry Criteria — neither sub-item above is to be implemented as
part of resuming Priority 3.

**Next architectural question, to be investigated before any new
code** (per direct instruction — no premature assumption of a
solution, e.g. reusing `slot.length` as-is or adding an arbitrary
field to `IRParam`):

> What is the correct source of `length` for an Array Parameter
> entity within the IR, when the function's own signature carries no
> fixed length?

Resolving this requires: (1) a real survey of the actual architectural
alternatives available, (2) a new ADR recording the choice and its
justification, (3) an Implementation Contract update if needed, (4)
only then implementation — the same Question → Evidence → Decision →
Constraint → Traceability sequence used throughout this document.

**Precision note on `Invariant 3`'s real role here**: `Invariant 3`
removes one possible objection — that crossing a function boundary
itself creates a new `Object` — since it already establishes that
identity survives being passed between functions. It does **not** by
itself prove that direct literal arguments follow the same readiness
point established in Decision 2. That case remains unimplemented (see
the new Defer Log row above) and therefore intentionally unresolved,
not settled by `Invariant 3` alone.
| Returning a newly created `Array` | Ownership is unresolved | Who becomes the owner after the return? |
| Ownership of returned objects | Depends on the item above | Closes automatically once the item above is resolved |

No Implementation Baseline version may silently resolve any item on
this list without a documented, separate architectural decision —
consistent with §4/§5's own existing rule against silently resolving
an Intentionally Unspecified case.

---

## Resolving Defer Log Item 1 (Array Parameters) — Step 1

**Question**: is it permitted for Descriptive Metadata to be
incomplete at Object creation time within the IR, or must it always
be complete?

**Answer, grounded directly in already-ratified text** (Implementation
Contract §2): "every such `Object` carries both Identity Metadata and
Descriptive Metadata... at all times — there is no ratified scenario
in which an `Object` exists without either." No incomplete
`Descriptive Metadata` is permitted for anything considered an
`Object` under this model.

**What this rules out, precisely — and nothing more**: representing a
function parameter itself as an `Object` before complete Descriptive
Metadata is available. It does **not** by itself select where the
`Object` comes into existence instead — that remains a genuinely open
architectural decision, with real alternatives already identified
(creation at the call site; creation after argument binding at
function entry; treating the pre-binding parameter as a Descriptor or
pending-binding construct rather than an `Object` at all; an
intermediate layer between Signature and `Object`). Selecting among
these is not settled by the evidence above.

**Next question, posed neutrally, per direct instruction**:

> What is the earliest point in the compilation/runtime pipeline at
> which an Array `Object` is permitted to exist?

**Correction — this question mixes two distinct levels and is split
accordingly, per direct instruction**: whether the `Object` under
discussion is an IR-level entity or a runtime entity has not itself
been settled, and conflating them risks comparing solutions from two
different architectural levels. Split into two, ordered questions:

**IR-level question (in scope for Part 5, addressed first)**:

> What is the earliest point in the compilation pipeline at which the
> IR may represent an Array `Object`?

**Status: open.** Same 4 real alternatives from Step 1 remain the
candidates, now evaluated strictly within this single level (IR
structural design) rather than across two levels at once. One related
point is already resolved (§4: creating a local `Array` via `let` is
a confirmed-permitted point of IR-level existence) — this establishes
only one real, permitted point, not the earliest one in general, and
says nothing about the parameter case specifically.

**Runtime question (explicitly deferred, not answered here)**:

> When does the runtime instantiate the corresponding Array `Object`?

Per the Mapping Principle (Part 3) and the Amendment Policy, Backend
and Runtime behavior remain free to choose their own implementation as
long as every Invariant is preserved — this question is deliberately
left open for a later, separate section, once the IR-level question
above is resolved.

## A More Foundational Question, Prior to the IR-level Question Above

**Observation, per direct instruction**: the 4 alternatives from Step
1 do not all belong to the same level — "creation at the call site"
and "creation after argument binding" may be Runtime/Lowering
decisions, while "Descriptor before Object" and "an intermediate
layer" are real IR-level conceptual alternatives. Evaluating all 4
together risks comparing solutions built on different, unstated
premises.

**The prior question**:

> Does the IR need to represent an Array `Object` at every
> compilation stage, or is it permitted to represent an earlier
> intermediate concept before an Array `Object` exists?

**Checked against existing evidence**: Part 4 Decision 4's own text
states that introducing an eighth concept beyond the seven already
proven minimal "requires" the same three-question justification (does
an Invariant depend on it; what breaks without it; is it covered by
another concept) — this is a **condition** for introducing an
intermediate concept, not a **prohibition** of one. No evidence
anywhere in this document mandates that the IR's first representation
of an array-typed entity must already be a complete `Object`, and no
evidence permits an intermediate representation either.

**Status: genuinely unresolved by the current Baseline text — but not
because this is an arbitrary choice for the project owner to make.**
What the check above actually shows is narrower: the current Baseline
contains no text requiring an `Object` from the first stage, and no
text explicitly permitting an intermediate Descriptor either. That
insufficiency, by itself, does not mean the choice is arbitrary — it
means a prior, more foundational gap exists: this document has never
formally defined what qualifies something as an `Object` in the first
place. See "Object Definition" below, which must be resolved before
either alternative can be evaluated as correct or incorrect.

## Object Definition

**Built strictly from citations already present in this document —
no new claim introduced.**

An entity qualifies as an `Object` under this Baseline if and only if
all of the following, already-established conditions hold:

1. It is an instance of `Reference-backed Object` (§2: `Object →
   is-an-instance-of → Reference-backed Object`; §5's own Validation
   Rule: "Every `Object` must belong to a valid structural category —
   `Reference-backed Object`, never `Atomic Value`").
2. It carries Identity Metadata that uniquely identifies it (§1: "The
   central entity carrying identity and Metadata"; §5's own Validation
   Rule requiring unique Object identity).
3. It carries Descriptive Metadata (§1, Part 4 Decision 3: Length and
   Element Type); per the Implementation Contract §2, both Identity
   and Descriptive Metadata are mandatory — "there is no ratified
   scenario in which an `Object` exists without either."
4. Any Metadata it carries belongs to it alone, not to any Reference
   designating it (Decision 3: "the Metadata belongs to the one
   Object both designate").

**Direct consequence for the open question above**: an entity missing
Descriptive Metadata (condition 3) does not satisfy this definition
— it is not an `Object` under this Baseline, by the Baseline's own
already-established conditions, not by a new rule invented here. This
resolves the earlier question as a direct consequence, not a separate
choice:

- If such an entity is introduced anywhere in the IR before its
  Descriptive Metadata is known, it cannot correctly be called an
  `Object` — calling it one would violate condition 3 directly.
- Whether the IR is **permitted** to represent such a
  not-yet-an-Object entity at all (a Descriptor, or any other
  pre-Object concept) is a separate, still-open question — this
  definition does not answer whether such an entity may exist; it
  only settles that, if it does, it must not be called or treated as
  an `Object`.

## IR Ontology Decision 1

**A real architectural decision, not derivable from existing
evidence — checked directly: no precedent anywhere in this document
or the real codebase resolves this (the closest candidate, a struct
slot's own declare-then-initialize pattern, only leaves field
*values* unfilled, never its Type Metadata, so it does not answer
this question either). This decision must be made consciously, before
any intermediate concept (Descriptor or otherwise) may be introduced
— introducing one now would silently answer this question in the
process, which is exactly what this section exists to prevent.**

**Question**: may the IR contain entities that do not satisfy the
formal Object Definition above?

**Options**:
- **No** — the first representation of anything array-related in the
  IR must already be a complete `Object`.
- **Yes** — the IR may contain transitional entities, provided they
  are never treated or referred to as an `Object`.
- **Deferred** — this question is left open until a real use case
  requires resolving it.

**RATIFIED DECISION: No.** The first representation of anything
array-related in the IR must already be a complete `Object`,
satisfying every condition of the Object Definition above. No
intermediate, pre-Object, or transitional entity is permitted.

**Justification (recorded, per direct instruction — the value of this
decision lies in the constraints it imposes, not the choice alone)**:

- **Consistency with the Object Definition already established**: an
  entity that does not satisfy that definition should not be named or
  treated as an `Object` in the IR at all.
- **Ontology simplicity**: the IR now contains exactly two kinds of
  entity — `Atomic Values` and `Reference-backed Objects` (§1,
  Decision 1) — with no third, transitional category requiring its
  own separate rules.
- **Consistency with existing Invariants**: no exception is needed of
  the form "this is an `Object` but its Metadata is incomplete," or
  "this is not an `Object` but behaves like one."
- **Prevents complexity spread**: introducing a Descriptor now would
  raise a cascade of further, currently unnecessary questions (who
  converts it into an `Object`? does it have identity? is it subject
  to Validation? does it appear in the general IR or only a specific
  phase?) — none of which are required while a simpler model remains
  viable.

**Resulting architectural constraint**:

> Every entity represented as an Array `Object` in the IR SHALL
> already satisfy the complete Object Definition.

**What this decision does NOT answer**: it does not say *where* the
`Object` is created — only that, whenever it first appears in the IR,
it must already be complete. The separate question of the earliest
point in the compilation pipeline at which this is possible remains
open, now properly constrained by this decision: no candidate answer
involving an intermediate, pre-Object entity remains viable.

## Revisiting the IR-level Question, Now Properly Constrained

> What is the earliest point in the compilation pipeline at which the
> IR may represent an Array `Object`?

Of the original 4 candidates (Step 1 above), 2 are now excluded by IR
Ontology Decision 1 (any candidate relying on a pre-Object
Descriptor or intermediate layer). The remaining, still-viable
candidates are Runtime/Lowering-level timing choices (e.g. creation at
the call site, creation after argument binding) — each of which must
still produce an already-complete `Object` at the moment of IR
representation, per the constraint above. Selecting among these
remains open.

## Decision 2 (IR Readiness)

**Question, exactly as requested**: at what compilation stage are all
Object Definition requirements simultaneously available?

**Direct evidence, from the real, already-existing v2 implementation**
(`array-object-model-builder.ts:57`): `Length` is read as
`stmt.initializer.elements.length` — it is known **only** at the
array-construction expression itself (`ArrayLiteral`), not before.
`Element Type` is knowable earlier (at Semantic/declaration time, from
the type annotation), but `Identity` (a unique identity for a real,
distinguishable entity) has no meaningful referent before a real
entity is actually constructed — which, for every case this Baseline
has resolved so far, occurs at the same point as `Length` becoming
known: the array-construction expression.

**Answer, scoped precisely to what the evidence actually supports**:
for the currently implemented semantic subset (literal array
construction), all Object Definition requirements become available at
the `ArrayLiteral` construction expression. No conclusion is drawn yet
for deferred scenarios (Array Parameters, Returning a newly created
`Array` — both remain open in the Defer Log). This evidence proves the
earliest point *in the one case actually implemented*, not the
earliest point *in general* across every possible case.

**Resulting, natural design choice — scoped to the same subset (per
the requested methodology — decision first, then the design choice it
determines, applied only where the evidence actually reaches)**: for
the resolved literal-construction case, a function parameter's own
declaration point (its signature) is never the array-construction
expression — the real entity was necessarily constructed earlier, at
whatever call actually supplied it. This favors candidate (1),
creation at the point of construction, over candidate (2), creation
after argument binding at function entry, **for this resolved
subset only** — because at function entry, no new construction
occurs; the entity already exists from an earlier point, and
"argument binding" is merely a new `VarBinding → designates → Object`
relationship (§2) to an already-complete `Object`, not a new point of
`Object` creation. Whether this same reasoning extends to the deferred
Array Parameters case itself is not concluded here — that remains
Defer Log Item 1's own separate resolution.

**More precise restatement**: the real trigger is not "the call site"
as a location, but "the array-construction expression" as an event —
these coincide in the one case resolved so far (a `let` with a
literal), but are conceptually distinct, and this distinction is
preserved for Defer Log Item 1's own eventual resolution.

---

## Reference Baseline Freeze (per direct instruction)

**This commit establishes the current reference baseline for
implementation. It remains the authoritative baseline until
superseded through the documented Amendment Policy.**
No further change to Parts 1–5, the Invariants, the Implementation
Contract, or v1/v2's own recorded scope may be made except through the
Amendment Policy already defined above (Section: "Amendment Policy" —
legitimate grounds: new test evidence, a discovered contradiction, a
genuinely new language requirement; illegitimate grounds:
implementation convenience, Backend difficulty).

**Recommended team distribution for wider implementation, per direct
instruction**:
- **IR team**: implements Implementation Baseline v2 and beyond,
  strictly within the documented scope — zero modification to the
  current Backend.
- **Backend team** (Lowering / Code Generation): continues on the
  current implementation unchanged; does not begin any rework until
  the new IR model is stable.
- **Test team**: begins immediately, writing Validation tests for
  each new architectural decision as it is made — not after the code
  is finished.
- **Documentation team**: continues updating this document in
  parallel with implementation, strictly under the Amendment Policy.

**Defer Log items remain out of implementation scope** until resolved
architecturally through the same Question → Evidence → Decision →
Constraint → Traceability sequence used throughout this document —
implementing around them (e.g. inventing a placeholder length) is not
permitted as a substitute for resolving them.

## Entry Criteria (required before implementation begins)

- ✅ Commit `87928511ec20807d589144422543f974d728f2c5` is the Current
  Reference Baseline.
- ✅ Any change to Parts 1–5, the Invariants, or the Object Definition
  happens only through the Amendment Policy.
- ✅ Defer Log items are not permitted to be implemented, or worked
  around with a temporary solution.
- ✅ Every Pull Request must state: which decision it implements,
  which Invariant it depends on, and which tests prove it.

## Architecture Decision Records (standing log, above the PR Gate)

Every architectural decision — past and future — is recorded as a
numbered entry in `ARCHITECTURE_DECISION_RECORDS.md`, answering: the
problem, the alternatives considered, why this solution was chosen,
its effect on this Baseline, and the commit that implemented it. The
3 major decisions already made in this document (Array Semantic
Model, IR Ontology Decision 1, IR Readiness for the resolved subset)
are recorded there as ADR-001 through ADR-003. The next new
architectural decision is ADR-004.

## PR Merge Gate (operational rule)

**No Pull Request is merged unless all four hold together**:
1. States the architectural decision it implements (citing its ADR
   number).
2. States the Invariant it depends on.
3. Contains tests proving the implementation.
4. Does not change the Baseline except through the Amendment Policy.

## Implementation Order

- **IR Team**: implements only what is within the documented scope.
  Does not widen scope unilaterally.
- **Test Team**: precedes or accompanies every new feature with
  Validation tests. Any new decision without a test becomes technical
  debt.
- **Backend Team**: continues on the current model. Does not begin
  transitioning to the new model until Semantic→IR integration is
  complete and stable.
- **Documentation Team**: documents the actual implementation. Does
  not introduce new architectural decisions on its own.

**The largest risk after this Baseline is no longer a design gap — it
is drift from the design during implementation.** This document is a
living reference every change is checked against, not a finished
artifact.
