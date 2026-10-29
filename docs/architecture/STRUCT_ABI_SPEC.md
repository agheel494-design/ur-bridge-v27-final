# STRUCT_ABI_SPEC.md

Grounded in direct inspection of this project's own, real, current
memory model - not invented in the abstract.

---

## 0. Real, Existing Foundation This ABI Builds On

Confirmed via direct source search before writing anything below:
**this project has NO dynamic (heap) allocation anywhere in either
real Backend today.** The only occurrence of `free` in `emit-c.ts`
is as a user-callable *builtin* (`free()`, something a UR program
calls explicitly, e.g. for FFI-returned strings) - it is not
compiler-generated cleanup for any UR-level value. Every local slot
today (scalars, arrays) is stack-allocated, with a lifetime tied
exactly to its enclosing function's own activation - freed
automatically when the function returns, the same way a C local
variable is.

**This ABI keeps that same model for structs, with zero exceptions**
- no heap, no reference counting, no garbage collector, because none
of those exist anywhere else in this compiler either. Introducing
one just for structs would be a new, project-wide memory model
decision far larger than this Blocker, and is explicitly out of
scope here.

## 1. Pointer Shape Inside IR

A struct-typed value is represented, at the IR level, as a **slot
reference** (`slot: number`, exactly like today's array slots) -
never a bare `IRValueRef`/SSA id. There is no new `IRType` variant
"pointer" - the existing `field_load`/`field_store` instructions
(from `STRUCT_IR_DESIGN_V2.md` §1) already carry a `slot: number`
directly, matching `array_load`/`array_store`'s own existing shape.

At the Backend level (where a "pointer" becomes a literal, physical
concept):
- **C**: a struct parameter is a real `struct Name *` C pointer to a
  stack-resident struct (either the caller's own local, or - for a
  struct constructed as a call argument - a compiler-synthesized
  temporary local in the caller's own stack frame). A struct return
  destination is the same: a real `struct Name *` pointing at
  caller-owned stack space.
- **WASM**: a struct parameter/return is a real `i32` linear-memory
  address - WASM's own natural "pointer," identical in kind to how
  array addresses already work today.

## 2. Memory Ownership

**The caller always owns the storage.** There is no callee-owned,
callee-allocated struct storage anywhere in this ABI:

- **Local struct** (`let p = Point(1, 2)`): storage is the enclosing
  function's own stack slot - owned by that function, freed
  automatically when it returns (unchanged from today's existing,
  working behavior for scalars/arrays).
- **Struct parameter**: the CALLER allocates (or already owns, if
  passing an existing local) the storage and passes its address; the
  CALLEE never allocates or frees it. The callee's own use of the
  parameter is exactly the same as using a local struct slot -
  `field_load`/`field_store` against that same memory - there is no
  difference in the callee's own generated code between "a struct I
  declared myself" and "a struct passed to me," which is precisely
  what keeps this ABI free of Backend special-casing.
- **Struct return**: per `STRUCT_IR_DESIGN_V2.md` §3's hidden-pointer
  convention, the CALLER allocates the destination storage (a stack
  slot in its own frame) and passes its address as the hidden extra
  parameter; the CALLEE writes into it and never allocates anything
  itself.

## 3. Who Creates a Struct

The function whose source code contains the construction expression
(`Point(1, 2)`) - always in a slot that already exists in that
function's own stack frame (either a named local the user declared,
or - for a struct used as an immediate call argument or nested
sub-expression not bound to a `let` - a compiler-synthesized,
unnamed local slot in the same frame, following the same "synthesize
a slot for values without a name" approach IR Lowering already uses
elsewhere for intermediate values).

## 4. Who Frees It

**Nobody, explicitly - the same as every other local today.** A
struct's storage is reclaimed automatically when its owning stack
frame is torn down, exactly like an `int` or `bool` local today. No
`struct_free`/destructor call is generated, because there is no heap
allocation to release. This is the single clearest overall
consequence of §0's foundation.

## 5. Copy Semantics

**Unchanged from today's real, already-working, already-tested
behavior**: `let q = p` (where `p` is a struct-typed variable)
already performs a real, full, field-by-field copy into `q`'s own,
independent storage - confirmed by reading the existing
`VariableDeclaration` struct-copy code directly. This ABI does not
introduce a new copy mechanism; it is the existing one, now
expressed through `field_load`+`field_store` pairs (one pair per
field) instead of today's ad-hoc load+store-into-a-tracked-Map
bookkeeping.

**Passing a struct as an argument is also always a copy at the
language-semantics level**, per `LANGUAGE_SYNTAX_1_1_SPEC.md`'s own
existing §2.3 value-copy semantics (unchanged, not reopened by this
ABI) - the CALLER is responsible for ensuring the callee receives a
value with copy semantics, even though the underlying IR passes a
pointer for efficiency. Concretely: if the caller passes an existing
local struct directly, the callee receives a pointer to that SAME
memory (no redundant copy needed, since UR's own struct field-
mutation-through-a-parameter is not otherwise observable by the
caller in a way that would violate value semantics - **this is a
real, disclosed nuance requiring the callee to never be able to
externally-visibly mutate the caller's own copy in a way the language
semantics forbid; enforcing this is a TypeChecker/Semantic-level
question, not an ABI one**, flagged here for that team's own
attention, not silently assumed resolved).

## 6. Move Semantics

**None - not needed, and deliberately not introduced.** Since there
is no heap allocation, there is nothing to "move" in the
resource-transfer sense C++/Rust use the term for. UR's own struct
values are always either (a) a named local's own storage, freed
automatically at scope exit, or (b) copied into another named
local's own storage. No ABI-level ownership transfer exists or is
needed.

## 7. What Happens on Return

Per `STRUCT_IR_DESIGN_V2.md` §3's hidden-pointer convention: the
callee's own `return <struct-expr>` lowers to a sequence of
`field_store`s writing each field's value into the hidden destination
pointer, followed by a plain `return_void` (no new `IRTerminator`
variant). The CALLER'S own destination storage (a real, its-own-stack
local) is what receives the values - the callee never allocates
anything to "return."

## 8. What Happens for a Nested Struct

A struct field whose own type is another struct is NOT a pointer
field, in this ABI's own model - it is **inline, embedded storage**:
the outer struct's own stack slot physically contains the full inner
struct's own bytes, contiguously, at the field's own computed offset
(see `STRUCT_MEMORY_LAYOUT.md` for exact offset computation). This
mirrors real C struct-in-struct embedding directly (not a C pointer
member) - keeping with §0's "no heap, ever" foundation: a
pointer-to-heap inner struct would require the very allocation model
this ABI explicitly avoids. Accessing a nested field
(`outer.inner.x`) is two chained, ordinary `field_load`s against
progressively-offset views of the same single, contiguous slot - not
two independent allocations.

**Explicitly out of scope for this document** (per the design
document's own §5 disclosure): arrays of structs, generic structs,
and any GC/heap-based model — none of those are needed to make the
required test-plan scenarios (see `STRUCT_TEST_PLAN.md`) pass, and
none are silently assumed solved here.

## 9. Explicit, Binding Ownership Statement (per direct request — no future developer should need to infer this from behavior)

**The following are stated as explicit, binding facts about UR 1.0
struct semantics, not left to be inferred from the ABI's own
mechanics:**

- **Struct does NOT own heap memory.** There is no heap-allocated
  struct anywhere in UR 1.0 — every struct value lives in stack
  storage, full stop.
- **There is NO automatic copy beyond what §5 already specifies**
  (assignment/parameter-passing value semantics) — no implicit
  deep-copy machinery exists or is planned beyond the existing,
  already-working field-by-field copy.
- **There is NO Move semantics.** UR 1.0 has no concept of "moving"
  a struct out of one binding into another; every struct-to-struct
  transfer is either a full copy (§5) or a shared pointer to the
  same, still-owning stack frame (parameter passing, §2) — never an
  ownership transfer.
- **There is NO destructor.** No struct-specific cleanup code is ever
  generated; a struct's storage simply ceases to exist when its
  owning stack frame is torn down, identically to a plain `int`
  local.
- **There is NO lifetime analysis.** No borrow-checking, no
  escape-analysis, no compiler-enforced lifetime rules of any kind
  are part of this design — a struct's stack storage lasts exactly as
  long as its own declaring function's own activation, and nothing in
  this ABI attempts to reason about or restrict that further.

Any future work proposing heap allocation, move semantics,
destructors, or lifetime analysis for UR structs is a NEW, separate
architectural decision — not an extension of this ABI, which
explicitly does not anticipate or accommodate any of them.
