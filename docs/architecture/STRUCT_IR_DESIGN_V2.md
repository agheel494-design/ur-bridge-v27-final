# STRUCT_IR_DESIGN.md — V2: Answering the 7 Review Questions

Real corrections and answers below, grounded in direct source
inspection, not narrated confidently from memory. Where the honest
answer is "this doesn't exist in this project yet," that is stated
plainly rather than answered hypothetically as if it were real.

---

## Correction Made While Answering Q2, Before Writing Anything Else

Only two Backends actually exist in this codebase: src/backend/c/emit-c.ts
(C) and src/backend/wasm/emit-wasm.ts (WASM) - confirmed via direct
file search. No LLVM or JS backend exists anywhere in this project.
V1 of this document did not make this distinction explicit; corrected
here. Q2's answer below covers C and WASM as real, current systems,
and JS/LLVM as hypothetical futures explicitly labeled as such - not
answered as if they were part of today's architecture.

A related, real, live finding: emit-c.ts's own header comment (line
18) still says "No structs/arrays/FFI yet" - but array_load/
array_store are fully implemented later in the same file (confirmed
by reading the code, not the comment). This is a stale comment, not
current behavior - arrays genuinely work in the real C Backend today.
This is used below as live, working evidence for the design approach
(section 1), not just a theoretical analogy.

---

## 1. Representation Choice - Alternatives Compared

| Option | How it works | Pros | Cons |
|---|---|---|---|
| Aggregate Value (struct as one first-class SSA value, like a tuple) | The whole struct is one IRValueRef, instructions produce/consume it whole | Conceptually clean; matches how scalars already work | Every instruction that touches ANY value would need to understand "this value might be N sub-values" - exactly the pervasive special-casing prohibited. IRValueRef assumes fixed-width today - an aggregate SSA value breaks that everywhere, not just struct-specific code. |
| Pointer Value (struct is always a raw, untyped pointer SSA value) | A struct is just an i64-like pointer; field access is manual pointer arithmetic | Simple type system, no new IRType needed | Backend loses all information about what the pointer points to - cannot generate a real, typed C struct or do layout-aware codegen. Worse for WASM specifically, where linear memory layout must be explicit and checkable (the existing array bounds-checking pattern depends on the IR knowing real shape info). |
| Packed Value (all fields flattened into consecutive scalar SSA values) | A struct becomes N separate scalars from the IR's point of view, matching today's existing structVarFields behavior | Zero new IR concepts | This is what already exists today and already causes the bug being fixed - it's why parameters/returns were never wired. Doesn't fix the actual problem. |
| Slot + Layout (chosen) | A struct is a named local slot (real, existing IR concept) with an attached structLayout describing its fields | Reuses a real, already-working, already-tested mechanism (IRLocalSlot.length for arrays is the exact same idea); Backend gets full, real shape information; requires zero new IRValueRef/SSA changes, since a struct is referenced by slot id, matching how arrays are already referenced today (array_load/array_store take a slot number, not a value ref) | Struct values can't yet exist as pure SSA temporaries independent of a named slot - an intermediate struct expression not bound to a let needs a compiler-synthesized slot. A real, disclosed cost, not hidden - see section 7. |

Chosen: Slot + Layout, specifically because it is the only option
that reuses a mechanism already proven working in both real Backends
(arrays) rather than introducing a new value-passing convention
nothing in the codebase has ever needed before.

## 2. Backend-by-Backend Handling

### C (src/backend/c/emit-c.ts) - real, exists today

| Operation | Handling |
|---|---|
| Storage | Real, stack-allocated C struct Name variable - mirrors how an array slot already becomes a real C array today. |
| Read | field_load -> ordinary C field access - no different in kind from today's array_load -> arr[idx]. |
| Write | field_store -> ordinary C field assignment - mirrors array_store. |
| Function passing | Real C pointer parameter (struct Point *p) - same ABI technique C itself uses for large aggregates. |
| Return | Hidden pointer output parameter - a standard, well-known C-level technique, not UR-specific invention. |

### WASM (src/backend/wasm/emit-wasm.ts) - real, exists today, narrower support than C confirmed live

Confirmed by reading the file directly: WASM's own array support is
already gated behind an allowArrayAccess condition and can throw a
real WasmUnsupportedError for slots not in knownArraySlotIds - i.e.,
even arrays are not unconditionally supported in WASM today, a real,
pre-existing asymmetry between the two Backends, not something this
design introduces.

| Operation | Handling |
|---|---|
| Storage | A real region of WASM linear memory, sized per structLayout - same idea as how array elements already get real memory offsets. |
| Read/Write | Real load/store at base + fieldOffset - mirrors how array element access already works. |
| Function passing | A real i32 linear-memory address passed as an ordinary WASM parameter (WASM has no native pointer type distinct from i32 - passing "a pointer" is exactly passing an i32 address, which WASM already does for every array today). |
| Return | Caller-allocated linear-memory address passed in as an ordinary extra parameter - same technique as C, expressed in WASM terms. |

Real, disclosed limitation carried over from today's own WASM array
support: given the existing gated, narrower WASM support already
confirmed above, struct support in WASM should be expected to land
with the same kind of narrower, explicitly-gated scope initially -
not a promise of full parity with C on day one.

### JS - hypothetical, no such Backend exists in this project

If a JS Backend were ever built (none exists today), a struct would
most naturally become a plain JS object or a class instance - JS has
no manual memory layout, so the pointer/offset discussion above
wouldn't apply the same way. Included only because it was asked about
explicitly, not because it reflects planned, funded work.

### LLVM - hypothetical, no such Backend exists in this project

Same disclosure: no LLVM backend exists. If one existed, LLVM has a
first-class native aggregate type and this design's own structLayout
concept would map onto it almost directly - LLVM is notably the one
target where "Aggregate Value" (the alternative rejected above) is
actually LLVM's own native model. A hypothetical future LLVM backend
would likely translate structLayout into a real LLVM aggregate type
rather than literally reusing "slot + offset," but the structLayout
data transfers either way.

## 3. ABI Decision: Why Pointer-Always, Not Pass-by-Value or Small-Struct Optimization

Technical justification:

1. No size-dependent branching anywhere - honoring the explicit
   prohibition on any special case is best done with one uniform
   rule with zero conditions, not "pointer above N bytes, value
   below." A size-based split would require Lowering AND both
   Backends to agree on the same threshold and produce two different
   real code paths - exactly the special-casing prohibited.
2. Real, existing precedent in this exact codebase: arrays - already
   a "more than one scalar" IR value - are never passed by value
   today (confirmed live: array_load/array_store always operate
   through a slot reference, never a bare SSA copy of the whole
   array). Making structs pointer-always keeps every aggregate-shaped
   value in the IR behaving identically.
3. Small-Struct Optimization is a real, legitimate technique in
   mature compilers (honestly acknowledged, not dismissed) - but it
   is a performance optimization layered on top of a working, correct
   pointer-based baseline, not a prerequisite for correctness. Given
   this project's own Level 2 IR is explicitly an early, scoped phase,
   building the optimization before the baseline works is solving a
   problem that doesn't exist yet.

## 4. Performance Impact

- Memory: every struct value requires real, allocated storage even
  for very small structs - real overhead versus a hypothetical
  register-passed small struct, honestly acknowledged, not hidden.
- Copying: struct assignment/copy (let q = p) already exists today
  and already does a real, full field-by-field copy (confirmed by
  reading the current struct-copy code) - this design does not
  change that cost; it is a pre-existing, already-accepted cost of
  UR's own value-copy struct semantics, not newly introduced here.
- Speed: pointer-indirection for every field access is real,
  measurable overhead for small, frequently-accessed structs - again,
  a real cost of correctness-first design, not optimized away here.
- Garbage Collection: not applicable - confirmed via direct search,
  this project has no garbage collector; struct slots are
  stack-allocated (C) or statically-offset linear memory (WASM), with
  the same manual lifetime every other local slot already has today -
  no new GC interaction introduced or required.

## 5. Future Extensibility

| Feature | Does this design allow it? | How |
|---|---|---|
| Nested struct | Yes | structLayout.fields[i].type can itself carry a nested structLayout reference - the data shape already supports recursion; field_load/field_store would need a follow-up pass, a real, scoped extension, not a redesign. |
| Array of struct | Deferred by explicit statement in V1, not silently assumed | IRLocalSlot already combines length (array) - extending it to combine length AND structLayout on the same slot is the natural next step, but needs its own focused design pass for element-stride addressing. |
| Struct inside struct | Yes | Same mechanism as nested struct. |
| Generic struct | Not directly | UR 1.0 itself has no generics at the language level (confirmed: no real generic struct declaration syntax exists in the Parser today) - this design doesn't need to solve a problem the language doesn't have yet. If generics are added later, structLayout would need a parameterized variant - a real, separate, larger design task. |
| Methods inside struct | No | UR has no OOP/method-dispatch model at all (confirmed: an existing test explicitly confirms 'this' is correctly rejected - "UR has no OOP model"). Out of scope entirely, for the language as it exists today. |

## 6. UR 1.0 Compatibility Proof

- No existing program breaks: this design's only changes are
  additive - a new optional structLayout field on IRLocalSlot (every
  existing slot simply omits it, exactly like length is already
  optional and omitted by every non-array slot today), and two new
  instruction kinds (field_load/field_store) that no existing
  Lowering code path emits or consumes. No existing instruction kind,
  no existing field on any existing type, is removed or renamed.
- Other types' IR is unchanged: IRType's existing four scalar
  variants are untouched; this design adds no new IRType variant at
  all (a struct is identified by its slot's own structLayout, not a
  new type tag).
- Current compiler behavior for non-struct programs is unchanged:
  every existing, passing test in this project's own suite (33/33
  language tests, 11/11 comprehensive reference program, 181/181
  typesystem tests, all Bridge tests) exercises zero
  struct-as-parameter/return code paths today (those exact scenarios
  are what currently fails with CG1001/CG1002) - so implementing this
  design changes behavior ONLY for programs that currently fail to
  compile past IR for exactly this reason. This claim will still need
  to be re-confirmed by the full regression suite once implemented -
  stated as the logical argument for why it should hold, not asserted
  as already independently verified.

## 7. Staged Implementation Plan (Per Explicit Direction - No Phase-Skipping)

1. IR (src/shared/ir.ts): add structLayout to IRLocalSlot, add
   field_load/field_store instruction kinds. Pure type/data
   additions, no logic.
2. Lowering (src/compiler/codegen/lower-to-ir.ts): replace
   structVarFields bookkeeping with real structLayout-bearing slots;
   wire struct-typed parameters and struct returns; update
   toIRType's own struct case (currently falls through to "void") to
   correctly recognize a struct-typed value as slot-backed.
3. TypeChecker: no changes expected - the prior round's own fix
   already covers this; re-confirm via regression, not re-designed.
4. Backends: C first (simpler, no linear-memory offset arithmetic
   needed) - real struct codegen, pointer params, hidden-return-param
   convention. WASM second, following the existing, narrower gating
   already used for arrays, not promised at full parity with C on
   day one.
5. Runtime: investigate whether any Runtime-level code assumes a
   value is always scalar - not yet investigated, flagged as a real,
   open item, not assumed clear.
6. Regression Tests: full re-run after each of the above steps
   individually, not only once at the end - per the explicit
   no-phase-skipping instruction, each phase's own real test evidence
   is captured before the next phase begins.

No phase begins before the previous phase's own real, tested evidence
is captured - per direction.
