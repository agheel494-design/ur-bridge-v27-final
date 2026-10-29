# WASM_FUNCTION_PARAMETERS_DESIGN.md

Design only, no code - per explicit direction. This covers GENERAL
function parameter support in the WASM Backend, for all types, as
the required prerequisite before any struct-specific parameter/
return work.

---

## 1. Current Architecture - As It Actually Exists

### 1.1 The real root cause, confirmed directly (not "code is missing" - the MODULE-level Type Section itself is architecturally single-signature)

encodeTypeSection()'s own body:

"Exactly one function type shared by ALL functions: () -> i64."

Every function in the module - regardless of its own real UR
signature - is emitted with WASM type index 0, and that ONE type is
() -> i64 (zero parameters, one i64 result). encodeFunctionSection()
confirms this directly: every function references type index 0.

This is not an encoding-logic gap that happens to reject parameters -
the module's own Type Section has never had more than one entry. Any
call site validation rejecting fn.params.length > 0 is a downstream
CONSEQUENCE of this upstream fact, not the actual constraint.

### 1.2 Real, existing precedent for this exact kind of change

The call instruction validation already contains a real, pre-existing
TODO comment (not written by this session) that anticipated this
exact expansion:

"before general call-arguments support is added in a future
sub-phase... a call to an actual UR function with arguments should
succeed, but a call to print specifically must still fail... this
should fail via a message naming print/Builtins specifically... not
this generic 'arguments not supported' message."

This confirms the ORIGINAL design intent already anticipated
parameter support as a real, planned future phase - this document is
executing that pre-existing plan, not inventing a new direction.

### 1.3 Call encoding today

encodeExprRaw's own call case emits a bare "call <funcIndex>" opcode
with zero operand-pushing beforehand - correct only because every
call today has zero arguments. Extending this to real arguments means
pushing each argument's own encoded value onto the WASM operand
stack, in order, before the call opcode - standard WASM calling
convention, not a UR-specific invention.

## 2. Root Cause Summary

The WASM Backend's own Type Section was built around a single, fixed
signature shared by every function - because no function needed
anything else yet (every function so far took the module's own real
UR parameters and silently ignored them via the pre-existing
fn.params.length > 0 rejection, meaning NO function with any real UR
parameter has ever reached this Backend successfully). This is why
struct parameters alone could never be "just" struct-specific work:
the Type Section itself needs to become per-function, for ANY
parameter type, before struct parameters can exist at all.

## 3. Proposed Design

### 3.1 Type Section: per-function signatures, not one shared type

Replace the single, hardcoded () -> i64 type with one WASM function
type PER DISTINCT SIGNATURE actually used in the module - mirroring
how array-memory.ts's own struct-layout deduplication-by-name pattern
already works. Concretely: for each UR function, its own real
parameter types (after toIRType()'s own existing scalar mapping)
become that function's own WASM param list; its own real return type
becomes the result list.

Deduplication is a real, worthwhile optimization but is NOT required
for correctness - a simpler, always-correct first implementation
gives every function its own type entry, one-to-one, and
deduplication can be a later, separate, non-blocking optimization
pass.

### 3.2 Function Section: reference the correct type index

Instead of every function pointing at type 0, each function's own
entry points at ITS OWN function's real type index.

### 3.3 Parameter passing (primitive types) at the call site

Per WASM's own real, native calling convention: the caller pushes
each argument's own encoded value onto the operand stack, in
left-to-right order, immediately before the call opcode - the callee
receives them as its own WASM function parameters (local indices
0..paramCount-1, ahead of any of the callee's own additional locals).

Real, necessary local-index renumbering: today's scalar-slot indices
(localIndexBySlotId, starting at 0) currently assume NO parameters
exist. Once a function has N real WASM parameters, its OWN
non-parameter locals must start at index N, not 0 - a real,
mechanical shift needed at every point encodeFunctionBody currently
computes local indices (mirroring how struct/array base-locals
already come after i64LocalCount today).

### 3.4 Validation changes

fn.params.length > 0 rejection is removed entirely for functions
whose every parameter type is primitive-supported (i64/f64/bool) -
struct-typed parameters remain explicitly rejected at this design's
own scope boundary (per the sequencing already decided: primitives
first, struct only after primitives are proven).

The call instruction validation's own inst.args.length > 0 rejection
is removed for calls whose target function is a real, known UR
function - but calls to Builtins/Runtime functions (print, etc.)
remain rejected via their own, correctly-scoped message, per the
pre-existing TODO's own guidance.

## 4. Impact on Every Pipeline Stage

- Lowering: no changes expected - lower-to-ir.ts already produces
  correct, Backend-agnostic param instructions and call instructions
  with real arguments (confirmed: the C Backend already consumes
  these correctly today) - this is purely a WASM Backend
  encoding-side change.
- Canonical IR: no changes - IRParam/IRFunction/call's own args field
  are already fully general or already used by both Backends today.
- Validation (WASM-specific): real changes per section 3.4 above.
- Materialization: real, open question requiring direct testing -
  does a parameter's own incoming value ever need materialization?
  Since a WASM parameter IS already a WASM local, it may need NO
  additional materialization treatment at all - but this must be
  confirmed directly against the real code, not assumed.
- Memory Allocation: no changes for primitive parameters (they never
  touch linear memory) - struct parameters are explicitly this
  document's own out-of-scope item.
- Code Generation: real changes per sections 3.1-3.3 above.
- Runtime: no changes - a real WASM runtime already handles
  multi-parameter functions natively.

## 5. Risks

| Risk | What could break | Detection | Test |
|---|---|---|---|
| Local index renumbering collides with existing scalar/array/struct local-index computation, which currently assumes index 0 is free | Wrong value read/written - the same dangerous class of bug already seen in the struct work's own binop-threading incident | A function with parameters AND local variables AND (once struct parameters land) a struct, asserting each reads/writes the correct, independently-computed local index | A real test with a multi-parameter function that also declares its own local scalar, array, and (later) struct |
| Per-function Type Section entries computed incorrectly | A call referencing the wrong type index - WASM's own validator SHOULD reject this at instantiation time | A malformed-module WASM instantiation failure - visible immediately, not a silent wrong-answer bug | A real test asserting WebAssembly.instantiate() succeeds for a variety of parameter/return-type combinations |
| The pre-existing print/Builtins rejection message becomes stale once real function calls succeed | A confusing error for a legitimate call that looks similar to an unsupported Builtin call | Directly testable: call print and confirm the error message still correctly names it as an unsupported Builtin | A real test asserting the improved, specific error message for print |
| Materialization mistakenly applied (or not applied) to a parameter's own value | Same historical bug class already fixed twice in this codebase | A parameter used inside a loop body across multiple iterations, where a stale/incorrect re-derivation would produce a wrong result on iteration 2+ | A real test: a function with a parameter, used inside a while loop, asserting the correct result across multiple iterations |

## 6. Staged Implementation Plan

1. Type Section becomes per-function - one entry per function, no
   deduplication yet.
2. Function Section references the correct type index per function.
3. Local index renumbering - parameters occupy indices 0..N-1; every
   existing local-index computation shifts to start after them.
4. Call-site argument encoding - push each argument's own value
   before call.
5. Validation relaxation - remove the two rejections for
   primitive-only cases, preserving the Builtins-specific rejection.
6. Real, live test: a two-parameter primitive function, called with
   real arguments, executed via real WebAssembly, asserting the
   correct result - BEFORE moving to any struct-specific work.
7. Only after step 6 passes with zero regression: begin the
   struct-parameter-specific design (a SEPARATE, follow-up document,
   not written here).

No step begins before the previous one's own real, live test evidence
is captured - per this project's own standing discipline.
