# PREREQUISITE_INVESTIGATION.md — IR Fixture Construction (COMPILER_BACKLOG.md item, now closed)

**No backend/emitter code was modified during this investigation.
Documentation and tests only, per explicit instruction.**

---

## 1. Minimal Required Structure of IRFunction

```
IRFunction = {
  qualifiedName: string,
  sourceName: string,
  params: IRParam[],        // MUST be empty for the CFG shapes this
                             // sub-phase supports - validateScope()
                             // rejects any function with params.length > 0.
  returnType: IRType,
  entryBlock: number,       // must match one block's own id
  location: SourceLocation,
  locals: IRLocalSlot[],    // empty for straight-line functions;
                             // required for any if/else whose result
                             // crosses the merge point
  blocks: IRBasicBlock[],
}
```

IRBasicBlock = { id, label, instructions: IRInstruction[], terminator: IRTerminator }.
The dispatch on shape happens purely on blocks.length:
1 block = straight-line, 3 = Diamond (if/else, no merge), 4 = Merge
or while (distinguished by entry's terminator kind), 7 = while with
break/continue. Any other count is rejected outright.

## 2. Correct IRLocalSlot Construction and Use

```
IRLocalSlot = { id: number, name: string, type: IRType, length?, isArray? }
```

A slot's id lives in a SEPARATE id space from SSA value ids - reuse
of a number is not a conflict. A slot is written via a store
instruction ({ kind: "store", slot: <id>, value: <IRValueRef> },
produces no SSA id) and read via a load instruction ({ kind: "load",
id: <new SSA id>, type, slot: <id> }, produces a fresh SSA id). This
is the ONLY mechanism for a value to legitimately cross a CFG merge
point in this sub-phase - a merge block reading a cross-block id
directly (not via a slot) is rejected.

## 3. Expression Tree Property Rules Encountered

- Every value must have fan-out <= 1 within a single block's own
  instruction list (reusing one value id as both operands of a binop
  throws WASM1001, citing Expression Tree Property, WASM_BACKEND_SPEC.md §2.1).
- Only integer constants (IRConstant.kind: "const_int") are
  supported as a direct constant at this sub-phase - const_bool
  directly as a value is rejected (booleans must be produced via a
  supported comparison binop instead, e.g. eq).
- The returned/used value in any block must be defined by a const,
  supported binop, call, or load - never left undefined or
  referencing an id from a different, non-slot-backed source.
- Disclosed limit: only the specific violations actually encountered
  during this investigation's own real attempts are listed above -
  this may not be the complete rule set; no claim of exhaustiveness
  is made.

## 4. CFG Acceptance Rules Before emitWasmModule()'s Own Entry Point

Dispatched by validateScope(), purely on fn.blocks.length:

| Block count | Shape | Validator |
|---|---|---|
| 1 | Straight-line | validateReturnBlock |
| 3 | Diamond (if/else, both branches return directly) | validateDiamondShape |
| 4 | Merge (if/else through a shared merge block) OR while | validateMergeShape / validateWhileShape (distinguished by entry's terminator: cond_branch = Merge, plain branch = while) |
| 7 | while + break/continue | classifySevenBlockShape then the matching validator |
| anything else | Rejected outright | - |

Merge (3.1A.5) exact contract (the one actually targeted and reached
in this investigation):
- Exactly 4 blocks: entry, then, else, merge - all four distinct.
- entry terminator: cond_branch, targeting two distinct blocks.
- then/else terminators: both branch, to the SAME single merge block
  (not return directly - that's Diamond's own shape instead).
- merge terminator: return, directly.
- MERGE_IMMEDIATE_RETURN_CONTRACT: the merge block may contain NO
  store/array_store at all - it may only load and return. Violating
  this is exactly what this investigation used to reach WASM1002.

## 5. Fixture Passing All WASM1001 Checks - Achieved

A hand-built IRModule was constructed (see
tests/backend/wasm/wasm1002-fixture.test.ts): an if/else where both
branches store a constant into a shared IRLocalSlot, both branch to a
merge block, and the merge block loads the slot and returns it
directly. Passed to emitWasmModule() - compiled successfully, valid
WASM bytes produced. Confirmed by direct runtime execution, not
inferred.

## 6. Fixture Targeting WASM1002 Directly - Achieved

Using the exact same, now-valid fixture as its base, one deliberate
change was made: an extra const + store was added inside the merge
block itself. Passed to emitWasmModule():

```
[WASM1002] f: This phase currently supports only: if -> merge ->
return. Your program contains additional statements after the merge
point. This feature will be available in a later phase. This is an
implementation limitation, not a language error. Contract:
MERGE_IMMEDIATE_RETURN_CONTRACT (slot 100)
```

UNSUPPORTED_CFG_SHAPE (WASM1002) was successfully triggered.
Confirmed by direct runtime execution (the highest evidence level per
AUDIT_METHODOLOGY.md's own Evidence Precedence), not inferred or
guessed.

## What Was Proven vs. Not Proven

Proven (runtime-verified, this session):
- A valid Merge (3.1A.5) fixture compiles successfully.
- WASM1002 fires correctly for a real, deliberate
  MERGE_IMMEDIATE_RETURN_CONTRACT violation.
- The backend's own error message for this case is specific, clear,
  and correctly attributes the violated contract by name.

Not proven / out of scope of this investigation:
- Whether WASM1002 also fires correctly for every OTHER way the
  Diamond/Merge/while/break-continue shape checks could be violated -
  only this one violation path was exercised. Other
  UNSUPPORTED_CFG_SHAPE throw sites were read but not each
  individually triggered by a live test.
- Whether every WASM1001 site is fully catalogued - only the
  violations actually encountered while constructing this fixture are
  documented in section 3.
- Independent verification of any result in this document - everything
  above is reported within this session, not confirmed by a separate
  reviewer or CI run.

## Result: Definition of Done - Status

- [x] Minimal valid structure of IRFunction documented
- [x] IRLocalSlot construction/usage documented
- [x] Expression Tree Property rules documented (with disclosed
      non-exhaustiveness)
- [x] CFG acceptance rules documented
- [x] Fixture passing all WASM1001 checks - built and verified
- [x] Fixture targeting WASM1002 directly - built and verified,
      WASM1002 successfully triggered

Prerequisite Investigation: reported complete within this session,
per the Definition of Done in COMPILER_BACKLOG.md. Pending
independent verification, per this project's own standing rule.
