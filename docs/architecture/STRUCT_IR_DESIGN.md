# STRUCT_IR_DESIGN.md — Phase 1: Formal Design (No Code Written Yet)

Per explicit direction: this document is written and must be
reviewed/approved BEFORE any implementation begins. No temporary
fixes, no struct-only special-casing in IR.

---

## 1. Why a Redesign, Not a Patch - Confirmed via Direct Source Inspection

src/shared/ir.ts's own header states this IR's scope explicitly:
"Deliberately NOT included in this phase: control flow... structs,
arrays, FFI calls, modules/imports." This is a real, declared Phase
1 boundary, not an accidental gap.

Direct evidence of the actual limitation: IRType is defined as
exactly "i64" | "f64" | "bool" | "string" | "void" - zero
aggregate/pointer type exists. toIRType() (in lower-to-ir.ts) returns
"void" for any StructType - confirmed by reading the function
directly. Struct field tracking today
(structVarFields: Map<string, Map<string, number>> in the IRBuilder
class) is external, ad-hoc bookkeeping in the Lowering pass itself -
not a real IR-level concept the Backend can see or reason about.
This is exactly why function parameters and return values were never
wired: there is no IR representation for "this value is a struct" to
wire TO.

## 2. Design Principle: Extend Existing Patterns, Don't Invent New Ones

The IR already has a working precedent for "a slot that holds more
than one scalar": arrays. IRLocalSlot already has an optional length
field, explicitly documented as enabling "a fixed-size array slot" -
the same file's own stated philosophy is that new concepts "slot in
alongside existing ones" without redesigning the core. Struct
support follows the exact same extension pattern: a slot that knows
its own internal field layout, not a wholly new value kind bolted on
as if(isStruct) special cases scattered through the Lowering pass
and Backend.

## 3. Representation Decision

A struct value is ALWAYS a slot reference (never a bare SSA scalar),
with its field layout attached to the slot itself - not tracked
externally by the Lowering pass.

### 3.1 IRLocalSlot gains a real, first-class field:

```ts
export type IRLocalSlot = {
  readonly id: number;
  readonly name: string;
  readonly type: IRType;       // existing
  readonly length?: number;     // existing (arrays)
  // NEW: present iff this slot holds a struct value. Field order
  // matches declaration order (source of truth for both Lowering
  // and Backend field offsets - no separate "layout" concept to
  // keep in sync).
  readonly structLayout?: {
    readonly structName: string;
    readonly fields: readonly { readonly name: string; readonly type: IRType }[];
  };
};
```

This makes struct layout a real, inspectable part of the IRModule
itself - the Backend can generate a real C struct { ... } declaration
directly from structLayout, with zero special knowledge borrowed
from the Lowering pass (today's structFields Map in lower-to-ir.ts
is Lowering-only and never reaches the Backend at all - confirmed by
checking the Backend's own inputs).

### 3.2 Two new, general instructions (not struct-specific in spirit)

```ts
| {
    readonly kind: "field_load";
    readonly id: number;
    readonly type: IRType;
    readonly slot: number;
    readonly fieldIndex: number;
    readonly location: SourceLocation;
  }
| {
    readonly kind: "field_store";
    readonly slot: number;
    readonly fieldIndex: number;
    readonly value: IRValueRef;
    readonly location: SourceLocation;
  }
```

These replace today's ad-hoc "N independent scalar slots, one per
field, joined only by a Map in the Lowering pass" with one real
aggregate slot with real, addressable field positions - this is also
what makes field MUTATION (currently not supported at all - today's
slots-per-field model has no field_store, confirmed via search)
possible for the first time, using the same instruction shape as
everything else.

### 3.3 Passing a struct as a function parameter

Decision: by reference (pointer), always - no special-casing by
struct size. This is a standard, well-established C ABI pattern (the
same one real C compilers use for "large" aggregates), and choosing
"always by reference" avoids a second code path (no size-dependent
branching anywhere in Lowering or Backend, honoring the "no special
cases" requirement directly).

IRParam (part of IRFunction) gains a slotId alternative to plain SSA
binding for aggregate-typed parameters - the caller allocates the
argument's own slot (or reuses an existing one) and passes its
address; the callee's own structLayout-bearing local slot IS that
same memory, not a copy. Field reads/writes inside the callee are
ordinary field_load/field_store against that slot, no different from
a locally-constructed struct.

### 3.4 Returning a struct from a function

Decision: hidden output parameter, always - the same, standard C ABI
technique ("return by hidden pointer"): a function whose returnType
denotes a struct receives one additional, compiler-generated
parameter that is a pointer to caller-owned storage; the callee's
own return lowers to field-by-field stores into that pointer, then a
plain return_void. This keeps the actual IRTerminator shape
completely unchanged (no new "return_struct" terminator needed) -
the existing return_void already covers it once the hidden parameter
exists.

### 3.5 Local storage (declaration + construction)

Unchanged in spirit from today's real, working local-variable case
(let p = Point(1, 2) - already correctly slot-based). The only
change: the slot gains a real structLayout (instead of N separate
slots secretly tracked in structVarFields), and field access goes
through field_load/field_store instead of "which slot id does this
field name currently map to" bookkeeping in the Lowering class.

### 3.6 Arrays of structs

Explicitly deferred, not designed here - per direction to design
struct representation now; array-of-struct interaction is a real,
separate design question (does length combine with structLayout on
the same slot? almost certainly yes, but the exact element-stride
addressing needs its own, focused pass) not rushed into this
document. Flagged honestly as an open sub-problem, not silently
assumed solved.

### 3.7 Cross-module (imported struct) usage

The structLayout for an imported struct is built once from the
exporting module's own program.structs (the same source
ModuleDescriptor.exports already tracks, per the Semantic/TypeChecker
fix from the prior round) and passed into lowerToIR() the same way
externalFunctionNames/externalStructTypes were threaded through
analyze()/typeCheck() - no new cross-module mechanism, reusing the
one already built and tested.

### 3.8 Backend (C codegen) consequences

- Each distinct structLayout in the module emits one real C
  "struct Name { field decls };" once, near the top of the generated
  file (deduplicated by structName, same de-duplication discipline
  ffiExterns already uses for extern declarations).
- A struct-typed local slot becomes a real, stack-allocated C
  variable of that struct type, not a set of independent scalars -
  field_load/field_store compile to ordinary C field access.
- A struct parameter becomes a real C pointer parameter; the
  callee's own field accesses become pointer-dereference field
  access.
- A struct return becomes a real, hidden pointer parameter; the C
  function's own declared return type becomes void.

## 4. What This Design Explicitly Does NOT Do

- Does not touch IRType's existing four scalar variants - no
  renaming, no removal, fully additive.
- Does not add an if(isStruct) branch scattered through arbitrary
  Lowering functions - the two new instructions
  (field_load/field_store) and the slot's own structLayout are the
  ONLY new surface; every other Lowering code path (arithmetic,
  control flow, function calls) is completely unaware structs exist,
  by construction - a struct is just "a slot with a layout," handled
  identically to how arrays are already "a slot with a length."
- Does not change IRTerminator - return-of-struct reuses
  return_void plus the hidden-parameter convention, not a new
  terminator kind.
- Does not attempt array-of-struct in this pass (section 3.6,
  explicitly deferred).

## 5. Real Risk, Disclosed Honestly

This is a genuinely large implementation task even with a sound
design: every Lowering code path that currently assumes "a slot's
type is always scalar" (locals, params, field_load/store new call
sites, the C Backend's own codegen for params/returns/locals) needs
real, careful updates, and the hidden-return-parameter convention
touches call-site lowering for every call whose target returns a
struct, not just struct-related code. This is realistically a
multi-session implementation, not something this design document by
itself completes. Per explicit direction, Phase 2 (implementation)
does not begin until this design is reviewed and approved.
