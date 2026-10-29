# STRUCT_MEMORY_LAYOUT.md

Formal, Backend-agnostic layout rules for structLayout, so C and
WASM compute identical offsets/sizes for the same UR struct - a
required property, not asserted without justification: if the two
Backends disagreed on layout, a struct built by one could not be
correctly read by logic assuming the other's layout, which would be
a real correctness bug the moment both Backends exist for the same
program.

---

## 1. Real, Existing Primitive Sizes This Layout Is Built On

Confirmed directly from emit-c.ts's own cType() mapping (not
invented) and standard C ABI sizes for each:

| UR primitive | IRType | C type | Real size (bytes) | Real alignment (bytes) |
|---|---|---|---|---|
| int | i64 | int64_t | 8 | 8 |
| float | f64 | double | 8 | 8 |
| bool | bool | bool (stdbool.h) | 1 | 1 |
| string | string | const char* | 8 (pointer, 64-bit target) | 8 |

Byte/char (per toIRType()'s own existing comments, confirmed by
reading lower-to-ir.ts): both currently collapse onto i64/string
respectively at the IR level ("Byte has no dedicated IR type in this
phase... treated as a general integer" / "Char... treated as a
1-char string") - this layout follows that same, already-established
precedent rather than inventing new IR-level distinctions no other
part of this compiler makes yet.

## 2. Field Ordering

Declaration order, unconditionally - no reordering, ever. A struct's
structLayout.fields array is in exactly the order fields appear in
the UR source, not reordered for packing efficiency. This is a real,
deliberate simplicity choice: reordering fields for tighter packing
is a real optimization some compilers do, but it requires the
Backend to maintain a separate "declared order" vs. "physical order"
mapping everywhere a field is referenced by name - exactly the kind
of extra bookkeeping this design's own no-special-cases principle
argues against.

## 3. Alignment Rule

Each field is aligned to its own natural size, using the real sizes
in section 1 above - the same rule the C compiler itself already
applies to every int64_t/double/bool/pointer field in any ordinary C
struct, which this layout deliberately mirrors exactly so that the C
Backend's own real, compiler-generated struct layout matches this
document's own computed offsets with zero manual adjustment.
Concretely: an 8-byte field (int/float/string) starts at an offset
that is a multiple of 8; a 1-byte field (bool) has no alignment
constraint beyond starting anywhere.

The struct's own overall alignment is the maximum alignment among
its fields (standard rule) - for any struct containing at least one
int/float/string field, that is 8 bytes; for a struct containing only
bool fields, it is 1 byte.

## 4. Padding Rule

Standard, C-compatible padding: after each field, insert the minimum
number of padding bytes needed so the NEXT field starts at its own
required alignment (section 3). At the end of the struct, insert
trailing padding so the struct's own total size is a multiple of its
own overall alignment (section 3) - the same rule that lets an array
of this struct type have every element correctly aligned (relevant
for the explicitly-deferred array-of-struct case, prepared for even
though not implemented now).

Worked example - struct Point { x: int, y: bool, z: int }:

```
offset 0:  x (int, 8 bytes, 8-byte aligned)      -> occupies [0, 8)
offset 8:  y (bool, 1 byte, 1-byte aligned)       -> occupies [8, 9)
offset 9:  (7 bytes padding, to align z to 8)     -> [9, 16)
offset 16: z (int, 8 bytes, 8-byte aligned)       -> occupies [16, 24)
total size: 24 bytes (already a multiple of the struct's own 8-byte alignment - no trailing padding needed)
```

## 5. Struct Size Computation

size = offset of the last field + that field's own size, rounded UP
to the struct's own overall alignment (section 3). Computed once, at
structLayout construction time, stored as a real, explicit field on
structLayout itself (not recomputed ad hoc at each use site):

```ts
structLayout: {
  structName: string;
  fields: readonly { name: string; type: IRType; offset: number }[];
  size: number;
  alignment: number;
}
```

(This refines STRUCT_IR_DESIGN_V2.md's own earlier structLayout
shape, which did not yet include offset/size/alignment - corrected
here per this document's own explicit purpose.)

## 6. Per-Field Offset Computation (Reference Algorithm)

```
offset = 0
for each field in declaration order:
  align = natural alignment of field.type (section 1)
  offset = roundUpTo(offset, align)        // insert padding if needed
  field.offset = offset
  offset = offset + sizeOf(field.type)
structSize = roundUpTo(offset, structAlignment)   // trailing padding
```

Both Backends consume this SAME, already-computed structLayout (built
once by Lowering) - neither Backend computes its own, independent
offsets. This is the specific mechanism that guarantees the
"identical offsets across Backends" requirement stated in this
document's own opening paragraph: there is only ever one computation,
shared, not two independent implementations that could silently
drift apart.

## 7. Nested Struct Layout

Per STRUCT_ABI_SPEC.md section 8: a nested struct field is embedded
inline, not a pointer. Its own contribution to the outer struct's
layout is: alignment = the inner struct's own alignment (section 5);
size = the inner struct's own size. The offset algorithm in section 6
applies unchanged - a nested-struct field is just a field whose
"natural alignment/size" comes from its own, already-computed
structLayout rather than a primitive's fixed size.

## 8. What This Document Does NOT Cover

- Array-of-struct element stride (explicitly deferred, per
  STRUCT_IR_DESIGN.md section 3.6 - would build on this document's
  own size/alignment fields once designed, not contradict them).
- Any layout for a hypothetical generic struct (UR 1.0 has none,
  confirmed in STRUCT_IR_DESIGN_V2.md section 5).

## 9. Single Source of Truth: `StructLayoutCalculator` (Binding, Per Direct Request)

**It is not sufficient for C and WASM to independently compute the
same values — a single, shared component computes them exactly
once, and every consumer (TypeChecker, IR/Lowering, C Backend, WASM
Backend) calls into that ONE component. No Backend, and no other
compiler stage, is permitted to compute size/alignment/padding/offset
itself.**

```ts
// src/compiler/typesystem/struct-layout-calculator.ts (new file)
export interface StructLayoutCalculator {
  /** Computes and returns the full layout for a struct, given its
   *  fields in declaration order. Pure function - no side effects,
   *  no caching required (though a caller may cache its own result
   *  per struct name if useful). This is the ONLY place §1-§6's
   *  rules above are implemented. */
  computeLayout(fields: readonly { name: string; type: IRType | StructLayoutResult }[]): StructLayoutResult;
}

export interface StructLayoutResult {
  readonly fields: readonly { readonly name: string; readonly type: IRType | StructLayoutResult; readonly offset: number }[];
  readonly size: number;
  readonly alignment: number;
}
```

**Consumers, and what each is prohibited from doing independently**:

- **TypeChecker**: calls `computeLayout()` once per struct declaration
  (local or imported) to build its own `structTypes` entries. Must
  NOT independently decide field order, size, or offsets for any
  purpose (e.g. a future struct-equality or struct-size builtin).
- **IR/Lowering**: calls `computeLayout()` once per struct (mirroring
  today's real, existing `structFields` construction in
  `lowerToIR()`) to populate each struct-typed slot's own
  `structLayout`. Must NOT recompute or adjust offsets itself for any
  reason (e.g. "optimizing" field order) — declaration order is
  fixed, per §2, by the Calculator alone.
- **C Backend**: reads the already-computed `structLayout` attached to
  each slot to emit the C `struct` declaration and field accesses.
  Must NOT rely on the C compiler's own, potentially-different
  struct-layout rules for anything semantically significant — the
  Calculator's own computed offsets are authoritative; the emitted C
  `struct` is written so that C's own real layout matches them
  exactly (achievable because the Calculator's own rules, per §3-§4,
  were deliberately chosen to mirror standard C alignment/padding
  rules in the first place — not a coincidence, a design constraint).
- **WASM Backend**: reads the same, already-computed `structLayout` to
  compute real linear-memory addresses (`base + field.offset`). Must
  NOT derive its own, independent byte layout.

**This single-component requirement is itself testable and tested**:
a real test (added to the struct-ir test suite alongside the 10
scenario tests) constructs a `StructLayoutCalculator`, computes a
layout once, and asserts that both the C Backend's own generated
code and the WASM Backend's own generated code, for the exact same
struct, reference the exact same numeric offsets found in that one
computed result — not merely "both backends produce a plausible-
looking layout independently."


- Array-of-struct element stride (explicitly deferred, per
  STRUCT_IR_DESIGN.md section 3.6 - would build on this document's
  own size/alignment fields once designed, not contradict them).
- Any layout for a hypothetical generic struct (UR 1.0 has none,
  confirmed in STRUCT_IR_DESIGN_V2.md section 5).
