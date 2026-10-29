# WASM_STRUCT_DESIGN.md — Phase 1: Design Only, No Code Written

Per explicit direction: no code changes in this document. This is
the required design-first analysis before any WASM Backend
implementation for Struct support begins.

---

## 0. Official v1.0 Status of WASM Backend - Answered With Direct Evidence, Not Inference

WASM Backend is NOT a requirement of the official, ratified UR
Language v1.0 specification. Confirmed via direct source inspection:
TAG_ur-language-v1.0.md states explicitly:

"This is a permanent reference point for the LANGUAGE specification
and its implementation - distinct from any WASM Backend RC/tag
(v27-wasm-3.1b-rc2, etc.), which tracks the Backend's own,
separately-frozen state."

UR_LANGUAGE_V1_0_FINAL_SPECIFICATION.md section 7 further classifies
"WASM support for existing gaps" as ongoing implementation work that
must match the specification, not as part of the specification's own
requirements.

This is the opposite finding from CG9001 (which WAS confirmed to be
an official, ratified requirement via LANGUAGE_SYNTAX_1_1_SPEC.md
section 2.5). WASM Backend has its own, separate versioning/freeze
track (v27-wasm-3.1b-rc2) distinct from ur-language-v1.0.

Practical consequence, stated directly, not decided unilaterally
here: whether Struct support in WASM Backend is required before UR
1.0 itself can be considered release-ready is a real, open scoping
question for the reviewer - this document proceeds with the design
work requested regardless, but does not assume the answer to "is
this a release blocker" on the reviewer's behalf.

## 1. Current WASM Backend Architecture - As It Actually Exists Today

### 1.1 Pipeline

emitWasmModule(module) -> for each function, validateScope(fn, ...)
-> (if it passes) bytecode generation. Unlike the C Backend (which
accepts any CFG shape and emits arbitrary C control flow), the WASM
Backend validates the function's own CFG shape FIRST, against a
small, explicitly-enumerated set of supported shapes - anything
outside those shapes is rejected with a real, typed
WasmUnsupportedError, not silently miscompiled.

### 1.2 Supported CFG shapes (confirmed by reading the validation code directly)

- Straight-line functions (no branching at all).
- A single if/else with an entry -> {then, else} -> merge shape -
  confirmed via validateReturnBlock's own explicit block-by-block
  handling.
- A while loop with a specific loop_header shape.
- Recursion (direct or mutual) is explicitly rejected - confirmed
  live: "(3.1A.3) - recursion (direct or mutual) is explicitly
  rejected, per review, rather than silently accepted." This is a
  real, significant difference from the C Backend, where every
  existing struct test (useIt(p), recursion elsewhere in this
  project) works freely.

### 1.3 Materialization

A real, historically-hard-won mechanism (per its own code comments
referencing PATCH_DESIGN_WASM_SSA.md and a real, previously-fixed
bug). getMaterializedIds(fn) identifies which SSA ids need a
dedicated WASM local ("scratch local") rather than being re-derived
from their own defining expression at each use site - necessary
because WASM is a stack machine, and naively re-deriving a value is
only correct if nothing could have changed the underlying WASM
locals it depends on since the value's true definition point (the
exact bug this mechanism was built to fix). encodeExpr checks
materialization first, falling back to encodeExprRaw only for
non-materialized ids.

### 1.4 SSA / Value Encoding

encodeExprRaw performs post-order stack-machine encoding - valid
specifically because validateScope() already guarantees every SSA id
is used at MOST ONCE (an "expression tree" property) - so no value
ever needs to be "saved" for reuse beyond what materialization
already handles; the WASM operand stack alone suffices for
everything else.

### 1.5 Arrays (the closest existing precedent for an aggregate)

- knownArraySlotIds - array-typed slots, identified via
  IRLocalSlot.isArray.
- A real, ratified, narrower rule than any array-supporting logic in
  the C Backend: every array MUST be allocated (its first
  array_store) in the entry block specifically - never conditionally
  inside then/else. This is enforced even though the underlying
  general mechanism "happens to produce a correct result" for some
  conditionally-allocated cases - deliberately rejected anyway,
  because that specific case has not yet had its own, separate
  design-first review (deferred to a documented future sub-phase).
- arrayBaseLocalIndexBySlotId - a real, separate mapping from array
  slot id to a dedicated WASM local holding the array's own base
  address in linear memory (WASM's real "pointer" concept, an i32
  address).

## 2. Required Integration Points for Struct Support

### 2.1 Lowering (lower-to-ir.ts)

No changes expected here - the same structLayout/field_load/
field_store IR already built for the C Backend is Backend-agnostic
by design (confirmed: neither instruction kind, nor
IRLocalSlot.structLayout, nor IRParam.structLayout, nor
IRValueRef.structSlot reference anything C-specific). This is the
SAME advantage that let the C Backend implementation proceed without
touching Lowering a second time.

### 2.2 Materialization

Real, open question, not yet answered: does a struct-typed slot ever
need to be "materialized" the way a scalar SSA id does? Since a
struct value is ALREADY always slot-backed (never a bare SSA
temporary), it may be that field_load's own produced SSA id (the
field's own scalar value, not the whole struct) is the only thing
that ever needs materialization - analogous to how array_load's own
produced value already goes through the same materialization path
arrays use today. This needs direct testing against the real
materialization code before being assumed true.

### 2.3 Validation (validateBlockInstructions, validateScope, etc.)

Real, required additions: a knownStructSlotIds set (mirroring
knownArraySlotIds exactly) must be threaded through the same
functions knownArraySlotIds already flows through. field_load/
field_store need their own validation branches (mirroring
array_load/array_store's own allow-gated checks) - verifying the
referenced slot is actually a known struct slot, and (per the array
precedent) very likely requiring the SAME "must be allocated/
constructed in entry, not conditionally" rule, at least initially,
until a conditional-construction case gets its own, separate design
review.

### 2.4 Code Generation

Real, required additions:
- A struct-typed local slot needs its own dedicated region of linear
  memory (mirroring arrayBaseLocalIndexBySlotId - a
  structBaseLocalIndexBySlotId, holding the struct's own base
  address as a WASM i32 local).
- field_load/field_store compile to real i32.load/i32.store (or the
  correct width per field type) at base + field.offset.
- Struct-by-value parameter passing and returns (CG9001's own C-side
  fix) need a genuinely NEW WASM-side decision: WASM function
  parameters/returns are always plain scalar types - there is no
  native WASM "struct parameter." The real technique is: the CALLER
  copies the struct into a region of linear memory and passes its
  address (an i32) as an ordinary scalar parameter. This means WASM's
  own struct parameter-passing mechanism will NOT be a byte-identical
  translation of the C Backend's approach - it requires its own,
  address-based technique, disclosed here directly rather than
  assumed to be a trivial mirror of the C fix.

## 3. Risk Analysis

| Risk | What could break | How tests would catch it |
|---|---|---|
| Struct slot address collides with an array's own base-address local, or with a materialized scratch local | Wrong memory read/write, silently wrong numeric results | A real test asserting the SPECIFIC field offsets read back match STRUCT_MEMORY_LAYOUT.md's own single, shared layout computation - not just "the program produces a result" |
| Struct construction conditionally inside if/else (mirroring the array precedent's own known-unresolved case) | A WasmUnsupportedError should fire; if it doesn't, this is the same class of "happens to work but wasn't reviewed" risk | A real test constructing a struct conditionally inside then only, asserting WasmUnsupportedError |
| Struct-typed parameter/return combined with the existing "no recursion" restriction | A struct-returning recursive function could expose an interaction neither Backend has been checked against | Explicitly out of scope for Phase 1 - flagged rather than silently assumed to work |
| Default/uninitialized struct field behavior differs between C and WASM's own zero-initialized linear memory | A program relying on default field values could behave differently across Backends | A test with all fields always explicitly set side-steps this; a separate, explicit default-value test is recommended but not required to close the ratified feature |

## 4. Staged Implementation Plan - No Phase-Skipping

Phase 1 - Local struct only, straight-line functions only (no
if/else, no loops, no recursion, no parameters, no returns):
construction + field_load + field_store, allocated in entry
(mirroring the array precedent's own ratified constraint exactly).
Success criterion: a real test constructing a struct, mutating a
field, reading it back, matching STRUCT_MEMORY_LAYOUT.md's own
computed offsets exactly - compiled to real WASM bytecode and
executed via a real WASM runtime, with the correct numeric result.

Phase 2 - Local struct inside if/else (matching the array
precedent's own supported shape, entry-allocated only): same
assertions as Phase 1, inside a conditional. Struct construction
inside only one branch remains explicitly rejected, not silently
attempted.

Phase 3 - Struct-typed function parameters (by value, via the
address-copy technique described in section 2.4): requires solving
the by-value passing decision first - a real, separate design step
before implementation.

Phase 4 - Struct-typed return values: same address-based technique,
receiver-allocated destination.

Phase 5 - Cross-module (imported struct) usage: reuses the
already-built-and-tested externalStructLayouts mechanism unchanged -
no new cross-module design needed.

Each phase gets its own real, live test run and regression pass
before the next phase begins - per explicit direction, no
phase-skipping, no combining phases to save time.
