# WASM_BUMP_ALLOCATOR_STUDY.md

Pure understanding, documented. No code changes, no patches, no TODOs
in this document - per explicit direction. Every claim below is
grounded in direct source inspection (file + line, or exact function
name), not inferred or assumed.

---

## 1. Full Array Lifecycle - Every Function It Passes Through

Tracing "let arr = [1, 2, 3]" ... "arr[0]" ... "return" through the
real code, in the exact order things happen:

### 1a. Compile time - building the index maps (once per function, in encodeFunctionBody)

1. encodeFunctionBody(fn, ...) splits fn.locals into scalarSlots
   (isArray !== true) and arraySlots (isArray === true).
2. localIndexBySlotId - scalar slots get WASM local indices 0..N-1
   (i64 type).
3. arrayIndexScratchCount - one shared i64 scratch local (allocated
   only if arraySlots.length > 0), used to materialize an array
   index's value exactly once (fixes a real, historical bug:
   issues/triple-evaluation-of-array-index-expression.md - without
   this, an index expression with a side effect could be evaluated
   up to 3 times: twice in the bounds check, once in the address
   formula).
4. materializedScratchCount - one dedicated scratch local per
   i64-typed leaf SSA instruction (const/load/binop) that needs
   materialization, per getMaterializedIds(fn) - fixes a SEPARATE
   real, historical bug: issues/wasm-loop-local-let-affecting-outer-state.md.
5. i64LocalCount = scalarSlots.length + arrayIndexScratchCount +
   materializedScratchCount - the total count of i64-typed WASM locals.
6. arrayBaseLocalIndexBySlotId - one i32 WASM local per array slot,
   indices starting right after all the i64 locals
   (i64LocalCount + i). This local holds that specific array's own
   base address in linear memory, for the entire function's lifetime.
7. bumpGlobalIndex = 0 - hardcoded; the sole WASM Global (when arrays
   exist anywhere in the module) is always global index 0.

### 1b. Compile time - dispatching to the right shape encoder

encodeFunctionBody then picks ONE of: encodeReturnBlockBody (1 block),
encodeIfElseFunctionBody (3 blocks, no array/struct support at all -
confirmed: this specific function's own signature takes no
arrayBaseLocalIndexBySlotId parameter), encodeWhileBreak/
ContinueFunctionBody (7 blocks), or encodeIfElseMergeFunctionBody/
encodeWhileFunctionBody (4 blocks) - each of the array-aware ones
receives arrayBaseLocalIndexBySlotId and bumpGlobalIndex.

### 1c. Materialization - getMaterializedIds(fn)

Computes, once, which SSA ids need their own dedicated scratch local
rather than being safely re-derivable from instructionsById at every
use site. This is real, load-bearing logic fixing a genuine
correctness bug, confirmed by its own direct bug-report reference.
Every block's own encodeStatements call re-checks
materializedIds.has(inst.id) for each leaf instruction and, if
present, emits it ONCE at that exact position in the instruction
stream, storing the result into its own scratch local - every later
reference then reads the scratch local instead of re-encoding the
original expression.

### 1d. Encoding - first array_store triggers real allocation

Inside encodeStatements (called once per block by whichever shape
encoder is active): for each array_store instruction, it checks
allocatedArraySlots.has(inst.slot) (a Set threaded through the SAME
shape-encoder call chain, block by block, within one function). If
this slot has NOT been allocated yet in this function's own
execution so far:
- encodeArrayAllocation(bumpGlobalIndex, baseLocalIndex, elementCount)
  is emitted: read the CURRENT bump Global value into this array's
  own dedicated local (baseLocalIndex) - this becomes its permanent
  base address for the rest of the function - then advance the bump
  Global by this array's own total size (ARRAY_HEADER_SIZE +
  elementCount * ELEMENT_SIZE, both named constants in
  array-memory.ts, never a bare literal).
- encodeArrayHeaderStore writes the array's own length into the
  first 8 bytes at its base address.
- allocatedArraySlots.add(inst.slot) - so a SECOND array_store to the
  same slot does NOT re-allocate, only writes the element.

Every array_store/array_load after that computes its own real
address via encodeElementAddress (the ONE formula:
base + ARRAY_HEADER_SIZE + index * ELEMENT_SIZE), using the index's
own materialized scratch local.

### 1e. Return

The returned value is encoded the same way any other expression is -
encodeExpr on the return terminator's own value id. Array-typed
returns are out of scope entirely today (confirmed: no code path
threads arrayBaseLocalIndexBySlotId into any return-value encoding
beyond a scalar array_load result).

### 1f. Free

Does not exist. Confirmed directly in array-memory.ts's own header
comment: "FORBIDDEN (this batch): bounds checking, resize, dynamic
growth, garbage collection, free - none of these exist here, not
even partially." The bump Global only ever increases, for the
lifetime of the WASM module instance. This matches
STRUCT_ABI_SPEC.md's own section 0 finding (no heap/free anywhere in
either real Backend) - the WASM array model is internally consistent
with that same "no free" foundation already established for the C
Backend's own struct work.

## 2. Pipeline Diagram

```
Lowering (lower-to-ir.ts)
  |  produces: IRLocalSlot{isArray, length} for arrays (Backend-agnostic)
  v
Canonical IR (src/shared/ir.ts)
  |  array_load/array_store instructions; IRModule/IRFunction/IRLocalSlot
  v
Validation (emit-wasm.ts: validateScope -> validateReturnBlock /
            validateDiamondShape / validateMergeShape / validateWhileShape
            / validateWhileBreakShape / validateWhileContinueShape)
  |  rejects any CFG shape or instruction combination outside the
  |  small, explicitly-enumerated supported set
  v
Materialization (getMaterializedIds, getIndexScratchLocalIndex)
  |  decides which SSA ids get a dedicated scratch WASM local vs.
  |  safe re-derivation - computed ONCE per function
  v
Memory Allocation (array-memory.ts: encodeArrayAllocation, called
  |  from encodeStatements, gated by allocatedArraySlots per-function)
  |  a real bump allocator: one WASM Global, monotonically
  |  increasing, never freed
  v
WASM Encoding (encodeFunctionBody -> shape-specific encoders ->
  |  encodeStatements/encodeExpr/encodeExprRaw -> raw WASM bytecode)
  v
Runtime (a real WASM runtime loads the module, the array's own real
     bytes live in that instance's linear memory for its lifetime)
```

Where Struct enters, per WASM_STRUCT_DESIGN.md's own already-
completed analysis: identically to Array at EVERY stage above -
Lowering already produces Backend-agnostic structLayout (confirmed,
no changes needed there); Validation needs the same kind of
knownStructSlotIds gate (already implemented and tested in a prior,
uncommitted attempt - confirmed working, real WasmUnsupportedError
fires correctly for field_load/field_store reaching the encoder
unimplemented); Materialization's own real open question is
addressed directly in section 4 below; Memory Allocation needs a
real, new structBaseLocalIndexBySlotId (see section 3); Encoding
needs real field_load/field_store bytecode emission (not attempted
yet, per the current, deliberate stop point).

## 3. Variable Map - What Each One Does, Who Writes It, Who Reads It

| Variable | What it holds | Written by | Read by |
|---|---|---|---|
| bumpGlobalIndex | Always 0 (hardcoded) - the WASM Global index of the sole bump pointer | encodeFunctionBody (as a literal 0) | encodeArrayAllocation (reads/advances the Global's own runtime value via global.get/global.set bytecode) |
| arrayBaseLocalIndexBySlotId | Map<slotId, wasmLocalIndex> - one i32 WASM local per array slot, holding that array's own permanent base address for the function's lifetime | encodeFunctionBody (computed once, i64LocalCount + i per array slot in declaration order) | encodeStatements, encodeExpr/encodeExprRaw (for array_load/array_store address computation) |
| slotId | The IR-level identity of a local variable (IRLocalSlot.id) - Backend-agnostic, assigned by Lowering | Lowering (lower-to-ir.ts's own nextSlotId++) | Every WASM Backend map above uses slotId as its own key - the WASM Backend never invents its own slot identity |
| localIndex (WASM-local sense) | The actual WASM-bytecode-level local variable index - WASM-specific, has no IR-level meaning | encodeFunctionBody (assigns sequential indices to scalar slots) | encodeStatements/encodeExpr for plain load/store |
| Scratch locals | Dedicated WASM locals holding an intermediate value computed exactly once, to avoid re-evaluating a real expression more than once | encodeStatements (writes via local.set at the exact materialization point) | encodeExpr's own materialization check (reads via local.get at every subsequent reference) |
| Memory offsets (ARRAY_HEADER_SIZE, ELEMENT_SIZE, per-element addresses) | Real byte offsets into WASM linear memory | array-memory.ts's own named constants (never a second, independent literal anywhere else - a ratified, tested contract confirmed as real tests in tests/backend/wasm/emit-wasm.test.ts) | encodeElementAddress, encodeArrayAllocation, encodeArrayHeaderStore |

## 4. Struct Entry Points - Exact Order, No Code

If we want to support Struct, per direct request - WHAT order to
touch functions in, not HOW yet:

1. First: array-memory.ts's own sibling concepts - a real, parallel
   understanding (not yet a file) of what a struct's own "address
   formula" would be. Per STRUCT_MEMORY_LAYOUT.md's own already-
   ratified rules, a struct has NO header (unlike arrays' own length
   header) - its own structLayout.size is already known entirely at
   compile time, so there is no runtime bookkeeping needed at the
   base address at all. This is a REAL, favorable difference from
   arrays worth confirming explicitly before touching any code: a
   struct's own bump-allocation is simpler than an array's (no
   header write needed, ever).
2. Second: encodeFunctionBody - this is where
   arrayBaseLocalIndexBySlotId is built today; a parallel
   structBaseLocalIndexBySlotId needs the same treatment (one i32
   WASM local per struct slot, indices continuing after wherever
   arrays' own indices end). This is the single point where ALL of a
   function's own local-index bookkeeping already happens - the
   correct, minimal place to add the struct-equivalent bookkeeping
   too, not scattered elsewhere.
3. Third: getMaterializedIds's own real, open question (flagged, not
   answered, in WASM_STRUCT_DESIGN.md section 2.2) - needs to be
   answered with a real, direct test BEFORE any encoding logic is
   written: does field_load's own PRODUCED value need the same
   materialization treatment array_load's own produced value already
   gets? This must be tested directly, not assumed either way.
4. Fourth: encodeStatements - the function that already handles
   array_store's own "allocate on first use" logic; a struct's own
   construction needs the equivalent - but per point 1 above, likely
   simpler (no separate "header write" step, since there is no
   header).
5. Fifth: array-memory.ts-equivalent new functions for the actual
   field_load/field_store address formula and bytecode emission -
   this is the LAST point where actual new encoding logic is
   written, only after points 1-4 above are each independently
   confirmed correct.

This ordering is DIFFERENT from the C Backend's own implementation
order (which went IR -> Lowering -> Backend directly, since C has no
separate "materialization"/"bump allocator" concept at all) - a
real, disclosed difference in process, not an oversight.

## 5. Risk Analysis - Per Point of Change

| Point of change | What could break | How to detect it | Regression-preventing test |
|---|---|---|---|
| structBaseLocalIndexBySlotId index computation (point 2) | Index collision with an existing array's own base-local index, or with a materialized scratch local's index, if the arithmetic is off by even one | Silently wrong memory reads/writes - the single most dangerous class of bug this system's own historical bug-fix comments repeatedly warn about | A real test with BOTH an array AND a struct in the same function, asserting each one's own reads/writes land at the EXPECTED, independently-computed addresses - not just "the program runs" |
| Materialization treatment of field_load (point 3) | If field_load's own produced value needs materialization but doesn't get it (or vice versa) | The exact class of bug issues/wasm-loop-local-let-affecting-outer-state.md already documents - a value correct in a simple case but stale/wrong once used across a later field_store to a DIFFERENT slot in the same block | A test specifically shaped like that historical bug report's own reproduction case, adapted for field_load |
| encodeStatements's own "allocate on first field_store" logic (point 4) | Re-allocating on a SECOND field_store to the same struct (wasting bump-pointer space) OR failing to allocate before the FIRST field_store (a real crash-level bug) | Memory usage growing unexpectedly across many struct mutations; or an immediate WASM trap on first use | A test constructing a struct then mutating multiple fields multiple times, asserting the bump Global's own final value matches exactly ONE struct's worth of growth, not N |
| New address-formula functions (point 5) | A field offset computed independently at a second call site, silently diverging from StructLayoutCalculator's own single, already-computed result | A struct read/write landing at the wrong byte offset - potentially only for specific field combinations (alignment/padding-dependent) | A direct port of array-memory.ts's own single-source-of-truth test pattern: assert every WASM struct field address computation traces back to the SAME StructLayoutCalculator-computed offset |
| Overall: interaction with the "no recursion" restriction, and CFG-shape restrictions | A struct-typed program that happens to need a CFG shape not yet supported gets a confusing error, or worse, silently mismatches an unrelated existing shape-detection heuristic | A test suite covering struct support ONLY within the already-validated shapes (straight-line first, per Phase 1 scope) - never assuming a shape works for structs just because it works for scalars/arrays |

## What This Document Does NOT Do

Per explicit direction: no code was written, no existing file was
modified, no patch or TODO was added anywhere. This is a pure
understanding document, to be used as the basis for approving (or
not) the start of actual Code Generation work in a future session.
