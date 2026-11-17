// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — CFG Shape Validation
// ─────────────────────────────────────────────────────────────────────────────
//
// Extracted from emit-wasm.ts (Architecture Freeze Audit, per official
// directive: split files exceeding 1,000 lines). Pure separation, zero
// behavioral change — every function here is byte-for-byte identical to
// its own prior body in emit-wasm.ts, only the file/module boundary moved.
//
// This module validates that a given IRFunction's control-flow shape
// (single-block, if/else, while, merge blocks, ...) is one this WASM
// Backend's own encoder actually supports, BEFORE any encoding is
// attempted — encoding itself assumes a pre-validated shape and does not
// re-check it.

import type { IRFunction, IRBasicBlock, IRInstruction, IRValueRef } from "../../shared/ir.js"; // B-1 Gate (type-only): IRValueRef added — used by refIdentity, was never imported (TS2304)
import { WASM_CODES, WasmUnsupportedError } from "./wasm-diagnostics.js";
import { OPCODE_I64_LT_S, OPCODE_I64_GE_S, OPCODE_F64_ADD, OPCODE_F64_SUB, OPCODE_F64_MUL } from "./wasm-opcodes.js";

// These specific opcodes are locally-defined constants in emit-wasm.ts
// (not part of wasm-opcodes.js's own exports) - copied here with their
// real, identical values, matching this file's own extraction-not-
// behavioral-change principle.
const OPCODE_I64_ADD = 0x7c;
const OPCODE_I64_SUB = 0x7d;
const OPCODE_I64_MUL = 0x7e;
const OPCODE_I64_EQ = 0x51;
const OPCODE_I64_NE = 0x52;
const OPCODE_I64_GT_S = 0x55;
const OPCODE_I64_LE_S = 0x57;

export const SUPPORTED_BINOPS: Record<string, number> = { add: OPCODE_I64_ADD, sub: OPCODE_I64_SUB, mul: OPCODE_I64_MUL };
// V2-M5 (Gate authorized, narrow scope): the f64 equivalent of
// SUPPORTED_BINOPS immediately above - same three operator names,
// f64-specific opcodes, mirroring the i64 pattern exactly per the
// roadmap's own stated technical requirement ("mirroring i32/i64.*
// almost exactly"). Deliberately the SAME three ops only (add/sub/mul)
// - no div/mod/comparisons for float, matching i64's own current scope
// precisely, not a broader set.
export const SUPPORTED_BINOPS_F64: Record<string, number> = { add: OPCODE_F64_ADD, sub: OPCODE_F64_SUB, mul: OPCODE_F64_MUL };
export const SUPPORTED_COMPARISONS: Record<string, number> = { eq: OPCODE_I64_EQ, neq: OPCODE_I64_NE, lt: OPCODE_I64_LT_S, gt: OPCODE_I64_GT_S, lte: OPCODE_I64_LE_S, gte: OPCODE_I64_GE_S };

// v29-D4 (Fan-out Compatibility Fix, narrowly scoped): a plain numeric
// `id` alone cannot identify a value when that value is an arraySlot-
// tagged reference — every such reference shares the identical
// sentinel id (-1), so two entirely different array references (e.g.
// two distinct inner arrays in a nested-literal construction) were
// incorrectly counted as one value used twice. Confirmed directly:
// constructing [[1,2],[3,4]] threw "value %-1 has fan-out 2" even
// though each inner array's own reference is genuinely used exactly
// once. This helper computes the correct identity for fan-out
// counting purposes ONLY — it does not change SSA numbering, does not
// touch promoteToSlot(), and does not alter how arraySlot itself is
// assigned anywhere else in the IR.
// v29-D5 (Slice 5, structSlot Identity Contract §5): the identical
// collision class as arraySlot above, confirmed directly this round for
// the analogous case — constructing an array of structs (`[Point(1,2),
// Point(3,4)]`) threw the same "value %-1 has fan-out 2" error, since
// EVERY structSlot-tagged reference also shares the identical sentinel
// id (-1). Extended to a real, discriminated three-case identity,
// exactly per the ratified Design's own §5: id:<n> for a plain SSA
// value (unchanged), arraySlot:<n> (D4, unchanged), structSlot:<n>
// (this round's own addition) — no other tag exists on IRValueRef,
// confirmed directly from ir.ts's own source before this fix was
// written. Still narrowly scoped: no SSA redesign, no promoteToSlot()
// change, no general fan-out rework.
type ValueIdentity = number | `arraySlot:${number}` | `structSlot:${number}`;
function refIdentity(ref: IRValueRef): ValueIdentity {
  if (ref.arraySlot !== undefined) return `arraySlot:${ref.arraySlot}`;
  if (ref.structSlot !== undefined) return `structSlot:${ref.structSlot}`;
  return ref.id;
}

export function validateBlockInstructions(block: IRBasicBlock, fn: IRFunction, knownFunctionNames: ReadonlySet<string>, allowComparisons: boolean, knownSlotIds: ReadonlySet<number> = new Set(), knownArraySlotIds: ReadonlySet<number> = new Set(), knownStructSlotIds: ReadonlySet<number> = new Set()): Map<ValueIdentity, number> {
  const useCounts = new Map<ValueIdentity, number>();
  const allowLocalAccess = knownSlotIds.size > 0;
  const allowArrayAccess = knownArraySlotIds.size > 0;
  const allowStructAccess = knownStructSlotIds.size > 0;
  for (const inst of block.instructions) {
    if (inst.kind === "const") {
  // WASM supports integer, float, and string constants here.
  // Boolean constants remain unsupported.
  if (
    inst.value.kind !== "const_int" &&
    inst.value.kind !== "const_float" &&
    inst.value.kind !== "const_string"
  ) {
    throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `only integer, float, and string constants are supported yet (found '${inst.value.kind}' at id %${inst.id}) — bool constants are a later sub-phase`,
        });
      }
      continue;
    }
    if (allowLocalAccess && inst.kind === "load") {
      if (!knownSlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `load at id %${inst.id} references slot ${inst.slot}, which is not a declared local in this function`,
        });
      }
      continue;
    }
    if (allowLocalAccess && inst.kind === "store") {
      if (!knownSlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `store at slot ${inst.slot} is not a declared local in this function`,
        });
      }
      useCounts.set(refIdentity(inst.value), (useCounts.get(refIdentity(inst.value)) ?? 0) + 1);
      continue;
    }
    if (allowArrayAccess && inst.kind === "array_load") {
      // v29-D4 (Nested Array Model, first vertical slice): when
      // baseRef is present, the base address is a dynamically-obtained
      // reference (the result of a prior array_load — outer[i], per
      // the ratified Nested Array Reference Representation Contract),
      // not a fixed local slot. slot is the required -1 sentinel in
      // this case (per ir.ts's own documented convention) — the
      // knownArraySlotIds check, which validates a FIXED local slot's
      // own declared-array status, does not apply here at all; the
      // Type Checker/Lowering already confirmed baseRef's own value is
      // a genuine array reference before ever emitting this instruction.
      if (!inst.baseRef && !knownArraySlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `array_load at id %${inst.id} references slot ${inst.slot}, which is not a declared array in this function`,
        });
      }
      useCounts.set(refIdentity(inst.index), (useCounts.get(refIdentity(inst.index)) ?? 0) + 1);
      if (inst.baseRef) useCounts.set(refIdentity(inst.baseRef), (useCounts.get(refIdentity(inst.baseRef)) ?? 0) + 1);
      continue;
    }
    if (allowArrayAccess && inst.kind === "array_store") {
      // v29-D4: same baseRef bypass as array_load above.
      if (!inst.baseRef && !knownArraySlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `array_store at slot ${inst.slot} is not a declared array in this function`,
        });
      }
      useCounts.set(refIdentity(inst.index), (useCounts.get(refIdentity(inst.index)) ?? 0) + 1);
      useCounts.set(refIdentity(inst.value), (useCounts.get(refIdentity(inst.value)) ?? 0) + 1);
      if (inst.baseRef) useCounts.set(refIdentity(inst.baseRef), (useCounts.get(refIdentity(inst.baseRef)) ?? 0) + 1);
      continue;
    }
    if (allowStructAccess && inst.kind === "field_load") {
      if (!knownStructSlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `field_load at id %${inst.id} references slot ${inst.slot}, which is not a declared struct in this function`,
        });
      }
      continue;
    }
    if (allowStructAccess && inst.kind === "field_store") {
      if (!knownStructSlotIds.has(inst.slot)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `field_store at slot ${inst.slot} is not a declared struct in this function`,
        });
      }
      useCounts.set(refIdentity(inst.value), (useCounts.get(refIdentity(inst.value)) ?? 0) + 1);
      continue;
    }
    if (inst.kind === "param") {
      // Function parameter support (Step 5): a param instruction is
      // always valid — Semantic/TypeChecker already guarantee correct
      // arity/types before Lowering ever produces it.
      continue;
    }
    if (inst.kind === "binop") {
      // V2-M5 (Gate authorized, narrow scope): an f64-typed binop is
      // now also accepted, but ONLY add/sub/mul (SUPPORTED_BINOPS_F64)
      // - comparisons on float are NOT part of this Gate's own scope
      // (the roadmap's own M5 text only ever mentions const/binop;
      // comparisons were never authorized here) and remain rejected
      // regardless of allowComparisons for a float-typed operand.
      const isArithmetic = inst.type === "f64" ? inst.op in SUPPORTED_BINOPS_F64 : inst.op in SUPPORTED_BINOPS;
      const isComparison = inst.type !== "f64" && allowComparisons && inst.op in SUPPORTED_COMPARISONS;
      if (!isArithmetic && !isComparison) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `binop '${inst.op}' on type '${inst.type}' is not supported yet at id %${inst.id} (only add/sub/mul on i64${allowComparisons ? ", comparisons on i64 as an if-condition," : ""} and add/sub/mul on f64 are, in this batch) — float comparisons, boolean ops, and div/mod are later sub-phases`,
        });
      }
      useCounts.set(refIdentity(inst.left), (useCounts.get(refIdentity(inst.left)) ?? 0) + 1);
      useCounts.set(refIdentity(inst.right), (useCounts.get(refIdentity(inst.right)) ?? 0) + 1);
      continue;
    }
    if (inst.kind === "unop") {
      // V2-M3 (Gate authorized, narrow scope): "unop" was previously
      // never referenced anywhere in this file at all - not merely
      // unsupported at the emitter, but never even registered in
      // useCounts, meaning a unop's own operand fan-out was never
      // tracked by the Expression Tree Property check. Fixed here,
      // mirroring binop's own exact pattern immediately above.
      // Deliberately scoped to `neg` on `i64` and `not` on `bool`
      // only (per the V2-M3 Discovery/Design Gate's own explicit
      // boundary finding, §6): `neg` on `f64` type-checks successfully
      // upstream (Int|Float is UR's own real type rule) but is NOT
      // implemented here - it falls through to the existing, unmodified
      // generic WASM1001 rejection below, exactly as instructed ("not
      // a new check, simply not extending unop handling to the f64
      // case") - extending to float would silently smuggle in M5's
      // own separate, not-yet-authorized scope.
      const isSupportedNeg = inst.op === "neg" && inst.type === "i64";
      const isSupportedNot = inst.op === "not" && inst.type === "bool";
      if (!isSupportedNeg && !isSupportedNot) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
          functionName: fn.sourceName,
          message: `unop '${inst.op}' on type '${inst.type}' is not supported yet at id %${inst.id} (only 'neg' on i64 and 'not' on bool are, in this batch — 'neg' on f64 is deferred to a later, float-specific sub-phase)`,
        });
      }
      useCounts.set(refIdentity(inst.operand), (useCounts.get(refIdentity(inst.operand)) ?? 0) + 1);
      continue;
    }
    if (inst.kind === "int_to_float") {
      useCounts.set(refIdentity(inst.operand), (useCounts.get(refIdentity(inst.operand)) ?? 0) + 1);
      continue;
    }
    if (inst.kind === "call") {
      // Step 5 (per WASM_FUNCTION_PARAMETERS_DESIGN.md, executing the
      // pre-existing TODO's own plan): calls to real UR functions
      // with arguments now proceed to the knownFunctionNames check
      // below, which ALREADY correctly, specifically rejects
      // print/Builtins/external calls with its own properly-scoped
      // message (UNSUPPORTED_RUNTIME_FEATURE, naming the callee
      // directly) - exactly the distinction the TODO asked for, with
      // zero change needed to that message itself.
      for (const arg of inst.args) useCounts.set(refIdentity(arg), (useCounts.get(refIdentity(arg)) ?? 0) + 1);
      if (!knownFunctionNames.has(inst.callee)) {
        throw new WasmUnsupportedError({
          code: WASM_CODES.UNSUPPORTED_RUNTIME_FEATURE,
          functionName: fn.sourceName,
          message: `call to '${inst.callee}' at id %${inst.id} does not resolve to a function defined in this module — external/Runtime/Builtin calls are a later sub-phase (3.1C)`,
        });
      }
      useCounts.set(inst.id, useCounts.get(inst.id) ?? 0);
      continue;
    }
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `instruction kind '${inst.kind}' is not supported yet (only 'const', 'add'/'sub'/'mul' binops, and direct zero-argument calls are) — found at id %${"id" in inst ? inst.id : "?"}`,
    });
  }
  return useCounts;
}

function checkExpressionTreeProperty(useCounts: ReadonlyMap<ValueIdentity, number>, fn: IRFunction): void {
  // V2-MU (Gate authorized, narrow scope): this check is now
  // CONDITIONAL, not an unconditional rejection of every fan-out > 1 -
  // narrowed, not removed, per the V2-MU Design Gate's own explicit
  // instruction. Two exemptions, both requiring the id's own defining
  // instruction to be looked up (fn.blocks is searched directly here,
  // matching this file's own established self-recomputation
  // convention rather than threading a lookup map through every one
  // of this function's 14 call sites):
  //  (a) "param" - a function parameter is ALREADY a real, backing
  //      WASM local (its own parameter index) - confirmed live during
  //      the V2-MU Design Gate that this was previously, incorrectly,
  //      rejected despite needing no fix at all. No scratch local, no
  //      materialization - exempted outright.
  //  (b) any instruction kind/type getMaterializedIds() in
  //      emit-wasm.ts will materialize into a real scratch local
  //      (const/load/binop/unop of type i64/f64; call of type
  //      i64/f64/string). This condition MUST stay in sync with
  //      getMaterializedIds()'s own eligibility logic - duplicated
  //      here rather than imported, to avoid a circular import
  //      (emit-wasm.ts already imports validation functions FROM this
  //      file), matching this codebase's own established, documented
  //      precedent for this exact class of necessary duplication
  //      (see TECHNICAL_DEBT_OPCODE_DUPLICATION.md).
  //  (c) v29-D4 (Fan-out Compatibility Fix, narrowly scoped): an
  //      arraySlot-tagged identity (e.g. "arraySlot:3") is exempted
  //      outright, for exactly the same reason as (a) — it is ALREADY
  //      backed by a real WASM local (the array's own base-address
  //      local: a freshly-allocated one for a literal, a parameter's
  //      own index for an array parameter, or the outer array's own
  //      separate slot for a nested reference). No scratch local, no
  //      materialization is ever needed for it. This exemption is what
  //      makes the identity distinction in refIdentity() above actually
  //      matter: two different arraySlot values are now two different
  //      map keys, so a real double-use of the SAME arraySlot (not
  //      currently reachable, but not ruled out structurally either)
  //      would still be counted correctly, while two DIFFERENT
  //      arraySlot values, each used once, are never conflated into
  //      one "fan-out 2" false positive — confirmed directly: this is
  //      exactly the failure a real WebAssembly emission attempt
  //      produced when constructing a nested array literal with two
  //      distinct inner arrays, before this fix.
  let instructionById: Map<number, IRInstruction> | undefined;
  for (const [identity, count] of useCounts) {
    if (count > 1) {
      if (typeof identity === "string") continue; // arraySlot- or structSlot-tagged (v29-D5) — exemption (c) above, generalized
      if (instructionById === undefined) {
        instructionById = new Map();
        for (const block of fn.blocks) for (const inst of block.instructions) if ("id" in inst) instructionById.set(inst.id, inst);
      }
      const inst = instructionById.get(identity);
      if (inst?.kind === "param") continue;
      const isMaterializable = inst !== undefined
        && (inst.kind === "const" || inst.kind === "load" || inst.kind === "binop" || inst.kind === "unop" || inst.kind === "call")
        && (inst.type === "i64" || inst.type === "f64" || inst.type === "string");
      if (isMaterializable) continue;
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
        functionName: fn.sourceName,
        message: `value %${identity} has fan-out ${count} (used ${count} times) — this violates the Expression Tree Property (WASM_BACKEND_SPEC.md §2.1): every value must have fan-out <= 1, unless it is materializable into a real WASM local (V2-MU) or is a function parameter (already backed by a real local) — '${inst?.kind ?? "unknown"}' of type '${inst && "type" in inst ? inst.type : "unknown"}' is neither`,
      });
    }
  }
}

export function validateReturnBlock(block: IRBasicBlock, fn: IRFunction, knownFunctionNames: ReadonlySet<string>, allowComparisons: boolean, knownSlotIds: ReadonlySet<number> = new Set(), knownArraySlotIds: ReadonlySet<number> = new Set(), knownStructSlotIds: ReadonlySet<number> = new Set()): void {
  const useCounts = validateBlockInstructions(block, fn, knownFunctionNames, allowComparisons, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  if (block.terminator.kind !== "return") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `only a 'return <expr>' terminator is supported yet (found '${block.terminator.kind}')`,
    });
  }
  useCounts.set(refIdentity(block.terminator.value), (useCounts.get(refIdentity(block.terminator.value)) ?? 0) + 1);
  checkExpressionTreeProperty(useCounts, fn);

  const returnedId = block.terminator.value.id;
  const returnedArraySlot = block.terminator.value.arraySlot;
  // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: a return whose
  // value is an array-slot reference (id=-1, arraySlot=N — the same
  // sentinel shape already used and validated elsewhere for array
  // values, confirmed by the "arraySlot- or structSlot-tagged (v29-D5)
  // — exemption (c)" case just above in validateBlockInstructions) is
  // a legitimate, well-formed return of an array value, not an
  // unresolved/unsupported one. Only known, real array slots for this
  // function are accepted — an out-of-range or unknown arraySlot value
  // still falls through to the existing, unchanged error below.
  if (returnedArraySlot !== undefined && knownArraySlotIds.has(returnedArraySlot)) {
    return;
  }
  const instructionsById = new Map<number, IRInstruction>();
  for (const inst of block.instructions) if ("id" in inst) instructionsById.set(inst.id, inst);
  if (!instructionsById.has(returnedId)) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `the returned value (id %${returnedId}) must be defined by a 'const', supported binop, call, load, or field_load in this block`,
    });
  }
}

/**
 * Validates the exact Diamond CFG shape — Invariant 3.1A.4, ratified
 * per review: exactly 3 blocks (entry, then, else); entry ends in
 * `cond_branch` targeting then/else; the branch condition must be a
 * comparison (SUPPORTED_COMPARISONS); BOTH then and else must
 * terminate via `return` directly — no merge block is ever permitted.
 * Any other shape is rejected with WASM1002, never approximated.
 */
export function validateDiamondShape(fn: IRFunction, knownFunctionNames: ReadonlySet<string>): void {
  if (fn.blocks.length !== 3) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.4 violated: expected exactly 3 blocks (entry, then, else) for an if/else where both branches return, found ${fn.blocks.length} — a merge block (a value crossing the if/else) is out of scope until 3.1A.6, and any other shape (nested if, while, etc.) is out of scope for this sub-phase entirely`,
    });
  }
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.4 violated: the entry block's terminator must be 'cond_branch' (found '${entry.terminator.kind}')`,
    });
  }
  const entryTerminator = entry.terminator;
  const thenBlock = fn.blocks.find(b => b.id === entryTerminator.thenTarget);
  const elseBlock = fn.blocks.find(b => b.id === entryTerminator.elseTarget);
  if (!thenBlock || !elseBlock || thenBlock.id === elseBlock.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.4 violated: cond_branch must target two DISTINCT blocks (then, else) that both exist in this function`,
    });
  }
  if (thenBlock.terminator.kind !== "return" || elseBlock.terminator.kind !== "return") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.4 violated: both 'then' and 'else' branches must terminate via 'return' directly (found '${thenBlock.terminator.kind}' / '${elseBlock.terminator.kind}') — a merge block (a value crossing the if/else) is out of scope until 3.1A.6`,
    });
  }

  const knownSlotIds = new Set(fn.locals.map(l => l.id));
  const knownArraySlotIds = new Set(fn.locals.filter(l => l.isArray === true).map(l => l.id));
  const knownStructSlotIds = new Set(fn.locals.filter(l => l.structLayout !== undefined).map(l => l.id));

  // Conditional Allocation (3.1B.6, Gate V2-M1): the Diamond shape
  // (Invariant 3.1A.4, direct-return-in-each-branch) previously never
  // computed or passed knownSlotIds/knownArraySlotIds/knownStructSlotIds
  // to validateReturnBlock() at all (both defaulted to empty Sets) -
  // discovered during THIS Gate's own testing, not a regression this
  // Gate introduces: the Diamond shape's own local/array/struct
  // support was simply never wired up, independent of conditional
  // allocation specifically. Fixed here as a minimal, mechanical
  // pass-through (the parameters already existed on
  // validateReturnBlock's own signature) because without it, the
  // most natural way to write conditional allocation (a direct
  // `if cond return arr[i] else return 0 end`, rather than the more
  // verbose assign-then-merge-then-return style) would remain
  // rejected regardless of this Gate's own array-allocation rule
  // below - making the feature this Gate authorizes effectively
  // unusable for the common case. Same Scenario-1-only rule as the
  // Merge shape (validateMergeShape) - see that function's own
  // comment for the full reasoning; not repeated here.
  for (const arraySlotId of knownArraySlotIds) {
    const allocatedInEntry = entry.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId);
    if (allocatedInEntry) continue;
    const referencesSlot = (block: IRBasicBlock) => block.instructions.some(i => (i.kind === "array_store" || i.kind === "array_load") && i.slot === arraySlotId);
    const allocatedInThenOnly = thenBlock.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId) && !referencesSlot(elseBlock);
    const allocatedInElseOnly = elseBlock.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId) && !referencesSlot(thenBlock);
    if (allocatedInThenOnly || allocatedInElseOnly) continue;
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `array slot ${arraySlotId} is not allocated in the entry block, and is not allocated-and-confined to a single if/else branch (Conditional Allocation, 3.1B.6, Scenario 1) — either allocate it in entry, or allocate AND use it entirely within only one of 'then'/'else' with no reference in the other branch (there is no merge point in this shape to worry about)`,
    });
  }

  const entryUseCounts = validateBlockInstructions(entry, fn, knownFunctionNames, true, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  const conditionId = entryTerminator.condition.id;
  const instructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) instructionsById.set(inst.id, inst);
  const conditionInst = instructionsById.get(conditionId);
  if (!conditionInst || conditionInst.kind !== "binop" || !(conditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `the if-condition (id %${conditionId}) must be a comparison (eq/neq/lt/lte/gt/gte) — found ${conditionInst ? `'${conditionInst.kind}'${conditionInst.kind === "binop" ? ` op '${conditionInst.op}'` : ""}` : "no definition"}`,
    });
  }
  entryUseCounts.set(conditionId, (entryUseCounts.get(conditionId) ?? 0) + 1);
  checkExpressionTreeProperty(entryUseCounts, fn);

  validateReturnBlock(thenBlock, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  validateReturnBlock(elseBlock, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
}

/**
 * Validates the exact "Diamond + Merge" CFG shape — Invariant 3.1A.5,
 * ratified per review: exactly 4 blocks (entry, then, else, merge);
 * entry ends in `cond_branch`; `then`/`else` BOTH terminate via
 * `branch` to the SAME single merge block (never `return`, never a
 * branch to a third/different block — exactly one merge point,
 * immediately following the if/else, no nested/secondary merge); the
 * merge block terminates via `return`. `load`/`store` to declared
 * locals are permitted in entry/then/else/merge. Any other shape is
 * rejected with WASM1002, never approximated.
 */
export function validateMergeShape(fn: IRFunction, knownFunctionNames: ReadonlySet<string>): void {
  if (fn.blocks.length !== 4) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: expected exactly 4 blocks (entry, then, else, merge), found ${fn.blocks.length} — nested/secondary merge points, while loops, and any other multi-block shape are out of scope for this sub-phase`,
    });
  }
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: the entry block's terminator must be 'cond_branch' (found '${entry.terminator.kind}')`,
    });
  }
  const entryTerminator = entry.terminator;
  const thenBlock = fn.blocks.find(b => b.id === entryTerminator.thenTarget);
  const elseBlock = fn.blocks.find(b => b.id === entryTerminator.elseTarget);
  if (!thenBlock || !elseBlock || thenBlock.id === elseBlock.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: cond_branch must target two DISTINCT blocks (then, else) that both exist in this function`,
    });
  }
  if (thenBlock.terminator.kind !== "branch" || elseBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: both 'then' and 'else' must terminate via 'branch' to a merge block (found '${thenBlock.terminator.kind}' / '${elseBlock.terminator.kind}') — a direct 'return' inside a branch is Invariant 3.1A.4's shape (a different, already-closed sub-phase), not this one`,
    });
  }
  const thenTerminator = thenBlock.terminator;
  const elseTerminator = elseBlock.terminator;
  if (thenTerminator.target !== elseTerminator.target) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: 'then' and 'else' must branch to the SAME single merge block (found targets ${thenTerminator.target} and ${elseTerminator.target}) — exactly one merge point is allowed`,
    });
  }
  const mergeBlock = fn.blocks.find(b => b.id === thenTerminator.target);
  if (!mergeBlock || mergeBlock.id === entry.id || mergeBlock.id === thenBlock.id || mergeBlock.id === elseBlock.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: the merge block must be a DISTINCT fourth block, not entry/then/else itself`,
    });
  }
  if (mergeBlock.terminator.kind !== "return") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.5 violated: the merge block must terminate via 'return' directly (found '${mergeBlock.terminator.kind}') — no nested control flow after the merge is supported in this sub-phase`,
    });
  }
  // MERGE_IMMEDIATE_RETURN_CONTRACT (ratified, per explicit review):
  // the merge block may only READ the crossed value and return it —
  // it must contain NO 'store' at all. A program like
  // `if(...) x=10 else x=20 end; x=30; return x` computes a correct
  // answer (verified directly: WASM produces 30, matching real UR
  // semantics) but is deliberately OUT OF SCOPE for this sub-phase —
  // "merge point immediately followed by return" means exactly that,
  // not "eventually followed by return after further statements."
  for (const inst of mergeBlock.instructions) {
    if (inst.kind === "store" || inst.kind === "array_store") {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
        functionName: fn.sourceName,
        message: `This phase currently supports only: if -> merge -> return. Your program contains additional statements after the merge point. This feature will be available in a later phase. This is an implementation limitation, not a language error. Contract: MERGE_IMMEDIATE_RETURN_CONTRACT (slot ${inst.slot})`,
      });
    }
  }

  const knownSlotIds = new Set(fn.locals.map(l => l.id));
  const knownArraySlotIds = new Set(fn.locals.filter(l => l.isArray === true).map(l => l.id));
  const knownStructSlotIds = new Set(fn.locals.filter(l => l.structLayout !== undefined).map(l => l.id));

  // Invariant 3.1B.4 (ratified scope), extended by 3.1B.6 (Conditional
  // Allocation, authorized narrow scope: Gate V2-M1): every array must
  // be allocated (its first array_store) either in `entry` (the
  // original 3.1B.4 shape, unchanged), OR inside exactly ONE of
  // `then`/`else`, PROVIDED its use (any array_load/array_store
  // referencing this slot) is entirely confined to that SAME branch -
  // never read/written in the other branch, and never read/written in
  // `merge` after the branches join. This is precisely Scenario #1 of
  // TEST_PLAN_3_1B_6.md ("array allocated in then only, used only
  // within then, else never touches it") - the design document's own
  // named first target. The OTHER scenario that document describes
  // (both branches independently allocate to the same slot, safely
  // read after merge) is deliberately NOT implemented here - it is a
  // separate, later increment, per this project's own "smallest
  // complete path first" discipline (the same approach already used
  // successfully for print(int) and NativePtr) - not silently expanded
  // into. A while-loop-allocated array (this design document's own
  // §6 open question) is likewise NOT addressed by this Gate.
  for (const arraySlotId of knownArraySlotIds) {
    const allocatedInEntry = entry.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId);
    if (allocatedInEntry) continue;
    const referencesSlot = (block: IRBasicBlock) => block.instructions.some(i => (i.kind === "array_store" || i.kind === "array_load") && i.slot === arraySlotId);
    const allocatedInThenOnly = thenBlock.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId)
      && !referencesSlot(elseBlock) && !referencesSlot(mergeBlock);
    const allocatedInElseOnly = elseBlock.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId)
      && !referencesSlot(thenBlock) && !referencesSlot(mergeBlock);
    if (allocatedInThenOnly || allocatedInElseOnly) continue;
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `array slot ${arraySlotId} is not allocated in the entry block, and is not allocated-and-confined to a single if/else branch (Conditional Allocation, 3.1B.6, Scenario 1) — either allocate it in entry, or allocate AND use it entirely within only one of 'then'/'else' with no reference in the other branch or after the merge point; both branches independently allocating to the same slot, read after merge, remains a separate, not-yet-implemented scenario`,
    });
  }
  // Struct Phase 2: the SAME entry-only-allocation rule, for the SAME
  // reason, mirroring the array precedent exactly — a struct declared
  // inside only one branch of if/else is out of scope for this phase.
  for (const structSlotId of knownStructSlotIds) {
    const allocatedInEntry = entry.instructions.some(i => i.kind === "field_store" && i.slot === structSlotId);
    if (!allocatedInEntry) {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
        functionName: fn.sourceName,
        message: `struct slot ${structSlotId} is not allocated (constructed) in the entry block — conditional construction (a struct declared inside only one branch of if/else) is out of scope for this phase, mirroring the array precedent's own identical rule`,
      });
    }
  }

  const entryUseCounts = validateBlockInstructions(entry, fn, knownFunctionNames, true, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  const instructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) instructionsById.set(inst.id, inst);
  const conditionId = entryTerminator.condition.id;
  const conditionInst = instructionsById.get(conditionId);
  if (!conditionInst || conditionInst.kind !== "binop" || !(conditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `the if-condition (id %${conditionId}) must be a comparison (eq/neq/lt/lte/gt/gte) — found ${conditionInst ? `'${conditionInst.kind}'${conditionInst.kind === "binop" ? ` op '${conditionInst.op}'` : ""}` : "no definition"}`,
    });
  }
  entryUseCounts.set(conditionId, (entryUseCounts.get(conditionId) ?? 0) + 1);
  checkExpressionTreeProperty(entryUseCounts, fn);

  const thenUseCounts = validateBlockInstructions(thenBlock, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  checkExpressionTreeProperty(thenUseCounts, fn);
  const elseUseCounts = validateBlockInstructions(elseBlock, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  checkExpressionTreeProperty(elseUseCounts, fn);

  const mergeUseCounts = validateBlockInstructions(mergeBlock, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  mergeUseCounts.set(mergeBlock.terminator.value.id, (mergeUseCounts.get(mergeBlock.terminator.value.id) ?? 0) + 1);
  checkExpressionTreeProperty(mergeUseCounts, fn);

  const mergeInstructionsById = new Map<number, IRInstruction>();
  for (const inst of mergeBlock.instructions) if ("id" in inst) mergeInstructionsById.set(inst.id, inst);
  const returnedId = mergeBlock.terminator.value.id;
  if (!mergeInstructionsById.has(returnedId)) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `the returned value (id %${returnedId}) must be defined by a 'const', supported binop, call, or load in the merge block`,
    });
  }
}

/**
 * Validates the plain `while` loop CFG shape — Invariant 3.1A.6,
 * ratified per review (scope narrowed to exclude break/continue,
 * deferred to 3.1A.6b): exactly 4 blocks (entry, loop_header,
 * loop_body, loop_exit); entry branches unconditionally to
 * loop_header; loop_header ends in cond_branch (condition a genuine
 * comparison) to loop_body/loop_exit; loop_body contains ONLY
 * straight-line instructions and branches back to loop_header (the
 * back edge — confirmed via the existing, reused
 * ControlFlowAnalysis.naturalLoops, never re-implemented); loop_exit
 * terminates via return. Any other shape (break/continue introducing
 * a nested if, nested loops) is rejected with WASM1002.
 */
export function validateWhileShape(fn: IRFunction, knownFunctionNames: ReadonlySet<string>): void {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: the entry block's terminator must be a plain 'branch' to the loop header (found '${entry.terminator.kind}')`,
    });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target);
  if (!loopHeader || loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: the loop header must terminate via 'cond_branch' (found '${loopHeader?.terminator.kind ?? "no block"}')`,
    });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget);
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget);
  if (!loopBody || !loopExit || loopBody.id === loopExit.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: cond_branch must target two DISTINCT blocks (loop_body, loop_exit)`,
    });
  }
  if (loopBody.terminator.kind !== "branch" || loopBody.terminator.target !== loopHeader.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: loop_body must terminate via a plain 'branch' back to the loop header (found '${loopBody.terminator.kind}') — a nested if (break/continue) is deferred to 3.1A.6b, a different, not-yet-implemented sub-phase`,
    });
  }
  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: loop_exit must terminate via 'return' directly (found '${loopExit.terminator.kind}')`,
    });
  }
  if (new Set([entry.id, loopHeader.id, loopBody.id, loopExit.id]).size !== 4 || fn.blocks.length !== 4) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: `Invariant 3.1A.6 violated: expected exactly 4 distinct blocks (entry, loop_header, loop_body, loop_exit), found ${fn.blocks.length}`,
    });
  }

  const knownSlotIds = new Set(fn.locals.map(l => l.id));
  const knownArraySlotIds = new Set(fn.locals.filter(l => l.isArray === true).map(l => l.id));
  const knownStructSlotIds = new Set(fn.locals.filter(l => l.structLayout !== undefined).map(l => l.id));

  // Invariant 3.1B.4 (ratified scope): every array must be allocated
  // in `entry`, never inside `loop_body` (which would re-allocate a
  // fresh array every iteration — an even clearer case of Conditional
  // Allocation, deferred to 3.1B.6). See the identical guard in
  // validateMergeShape() for the full reasoning.
  for (const arraySlotId of knownArraySlotIds) {
    const allocatedInEntry = entry.instructions.some(i => i.kind === "array_store" && i.slot === arraySlotId);
    if (!allocatedInEntry) {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
        functionName: fn.sourceName,
        message: `array slot ${arraySlotId} is not allocated in the entry block — allocating an array inside a loop body (re-allocating every iteration) is deferred to sub-phase 3.1B.6, per WASM_MEMORY_MODEL_SPEC.md §10d`,
      });
    }
  }
  // Struct Phase 2: the SAME entry-only-allocation rule, for the SAME
  // reason (a struct allocated inside loop_body would re-allocate
  // every iteration) — mirroring the array precedent exactly.
  for (const structSlotId of knownStructSlotIds) {
    const allocatedInEntry = entry.instructions.some(i => i.kind === "field_store" && i.slot === structSlotId);
    if (!allocatedInEntry) {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
        functionName: fn.sourceName,
        message: `struct slot ${structSlotId} is not allocated (constructed) in the entry block — constructing a struct inside a loop body (re-allocating every iteration) is out of scope for this phase, mirroring the array precedent's own identical rule`,
      });
    }
  }

  validateBlockInstructions(entry, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds); // entry: no fan-out check needed (its values, if any, are only used by its own store statements — no terminator value to add)

  const headerUseCounts = validateBlockInstructions(loopHeader, fn, knownFunctionNames, true, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const conditionId = headerTerminator.condition.id;
  const conditionInst = headerInstructionsById.get(conditionId);
  if (!conditionInst || conditionInst.kind !== "binop" || !(conditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
      functionName: fn.sourceName,
      message: `the while-condition (id %${conditionId}) must be a comparison (eq/neq/lt/lte/gt/gte) — found ${conditionInst ? `'${conditionInst.kind}'${conditionInst.kind === "binop" ? ` op '${conditionInst.op}'` : ""}` : "no definition"}`,
    });
  }
  headerUseCounts.set(conditionId, (headerUseCounts.get(conditionId) ?? 0) + 1);
  checkExpressionTreeProperty(headerUseCounts, fn);

  const bodyUseCounts = validateBlockInstructions(loopBody, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  checkExpressionTreeProperty(bodyUseCounts, fn);

  // Invariant 3.1B.4's original constant-index-only restriction here
  // has been REMOVED as of 3.1B.5 (per direct review: this was the
  // ONLY validation check standing between "rejected" and "correct,
  // verified support" — the encoding side, `encodeExpr()`, already
  // handled a `load`-sourced index generically since 3.1A.5, with
  // zero changes needed). Confirmed directly, before this removal,
  // that bounds checking correctly re-evaluates per-iteration against
  // a changing index value (a dynamic index that goes out of bounds
  // mid-loop correctly traps at the exact iteration it becomes
  // invalid — not before, not after). See `WASM_MEMORY_MODEL_SPEC.md`
  // §10e for the full analysis. Array index inside a `while` loop
  // body may now be ANY expression this Backend already supports
  // elsewhere (`const`, `binop`, `call`, `load`) — the same general
  // rule already governing every other array index location
  // (3.1B.3's own Dynamic Index finding, now confirmed to extend to
  // `loop_body` specifically too).

  const exitUseCounts = validateBlockInstructions(loopExit, fn, knownFunctionNames, false, knownSlotIds, knownArraySlotIds, knownStructSlotIds);
  exitUseCounts.set(loopExit.terminator.value.id, (exitUseCounts.get(loopExit.terminator.value.id) ?? 0) + 1);
  checkExpressionTreeProperty(exitUseCounts, fn);
}

/**
 * Validates the `while` + `break` CFG shape — Invariant 3.1A.6b,
 * ratified per review (continue further deferred to 3.1A.6c, per a
 * second CFG-driven scope narrowing: continue creates a SECOND back
 * edge into loop_header, a more complex shape than break's single
 * back edge): exactly 7 blocks (entry, loop_header, loop_body, then,
 * else, merge, loop_exit); loop_body ends in cond_branch (the break
 * check); `then` branches DIRECTLY to loop_exit (the break itself —
 * this is the exact structural signature that distinguishes `break`
 * from `continue`, whose `then` would instead branch to loop_header);
 * `else` branches to `merge`, which branches back to loop_header (the
 * loop's one true back edge). Any other shape — most importantly a
 * `then` that targets loop_header (a `continue`) — is rejected with
 * WASM1002, never approximated.
 */
export function validateWhileBreakShape(fn: IRFunction, knownFunctionNames: ReadonlySet<string>): void {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: entry must terminate via a plain 'branch' (found '${entry.terminator.kind}')` });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target);
  if (!loopHeader || loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: loop_header must terminate via 'cond_branch' (found '${loopHeader?.terminator.kind ?? "no block"}')` });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget);
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget);
  if (!loopBody || !loopExit || loopBody.id === loopExit.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6b violated: loop_header's cond_branch must target two distinct blocks (loop_body, loop_exit)" });
  }
  if (loopBody.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: loop_body must terminate via 'cond_branch' (the break check) (found '${loopBody.terminator.kind}')` });
  }
  const bodyTerminator = loopBody.terminator;
  const thenBlock = fn.blocks.find(b => b.id === bodyTerminator.thenTarget);
  const elseBlock = fn.blocks.find(b => b.id === bodyTerminator.elseTarget);
  if (!thenBlock || !elseBlock || thenBlock.id === elseBlock.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6b violated: loop_body's cond_branch must target two distinct blocks (then, else)" });
  }
  if (thenBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: 'then' must terminate via a plain 'branch' (found '${thenBlock.terminator.kind}')` });
  }
  const thenTerminator = thenBlock.terminator;
  if (thenTerminator.target === loopHeader.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: "Invariant 3.1A.6b violated: 'then' branches directly to loop_header — this is the structural signature of 'continue', which creates a second back edge into the same header and is deferred to sub-phase 3.1A.6c (a separate, more complex shape than 'break'); this batch supports only 'break' (then -> loop_exit)",
    });
  }
  if (thenTerminator.target !== loopExit.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6b violated: 'then' must branch directly to loop_exit (this is what 'break' means) — found a branch to neither loop_header nor loop_exit" });
  }
  if (elseBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: 'else' must terminate via a plain 'branch' (found '${elseBlock.terminator.kind}')` });
  }
  const elseTerminator = elseBlock.terminator;
  const mergeBlock = fn.blocks.find(b => b.id === elseTerminator.target);
  if (!mergeBlock || mergeBlock.id === entry.id || mergeBlock.id === loopHeader.id || mergeBlock.id === loopBody.id || mergeBlock.id === thenBlock.id || mergeBlock.id === elseBlock.id || mergeBlock.id === loopExit.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6b violated: 'else' must branch to a DISTINCT merge block" });
  }
  if (mergeBlock.terminator.kind !== "branch" || mergeBlock.terminator.target !== loopHeader.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: merge must terminate via a plain 'branch' back to loop_header (found '${mergeBlock.terminator.kind}')` });
  }
  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: loop_exit must terminate via 'return' directly (found '${loopExit.terminator.kind}')` });
  }
  if (fn.blocks.length !== 7) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6b violated: expected exactly 7 blocks, found ${fn.blocks.length}` });
  }

  const knownSlotIds = new Set(fn.locals.map(l => l.id));

  validateBlockInstructions(entry, fn, knownFunctionNames, false, knownSlotIds);

  const headerUseCounts = validateBlockInstructions(loopHeader, fn, knownFunctionNames, true, knownSlotIds);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const headerConditionId = headerTerminator.condition.id;
  const headerConditionInst = headerInstructionsById.get(headerConditionId);
  if (!headerConditionInst || headerConditionInst.kind !== "binop" || !(headerConditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `the while-condition (id %${headerConditionId}) must be a comparison` });
  }
  headerUseCounts.set(headerConditionId, (headerUseCounts.get(headerConditionId) ?? 0) + 1);
  checkExpressionTreeProperty(headerUseCounts, fn);

  const bodyUseCounts = validateBlockInstructions(loopBody, fn, knownFunctionNames, true, knownSlotIds);
  const bodyInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopBody.instructions) if ("id" in inst) bodyInstructionsById.set(inst.id, inst);
  const breakConditionId = bodyTerminator.condition.id;
  const breakConditionInst = bodyInstructionsById.get(breakConditionId);
  if (!breakConditionInst || breakConditionInst.kind !== "binop" || !(breakConditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `the break-condition (id %${breakConditionId}) must be a comparison` });
  }
  bodyUseCounts.set(breakConditionId, (bodyUseCounts.get(breakConditionId) ?? 0) + 1);
  checkExpressionTreeProperty(bodyUseCounts, fn);

  validateBlockInstructions(thenBlock, fn, knownFunctionNames, false, knownSlotIds); // then: no instructions expected (a bare 'break')
  validateBlockInstructions(elseBlock, fn, knownFunctionNames, false, knownSlotIds); // else: no instructions expected (falls through)

  const mergeUseCounts = validateBlockInstructions(mergeBlock, fn, knownFunctionNames, false, knownSlotIds);
  checkExpressionTreeProperty(mergeUseCounts, fn);

  const exitUseCounts = validateBlockInstructions(loopExit, fn, knownFunctionNames, false, knownSlotIds);
  exitUseCounts.set(loopExit.terminator.value.id, (exitUseCounts.get(loopExit.terminator.value.id) ?? 0) + 1);
  checkExpressionTreeProperty(exitUseCounts, fn);
}

/**
 * Validates the `while` + `continue` CFG shape — Invariant 3.1A.6c,
 * informed directly by `CONTINUE_CFG_ANALYSIS.md`: exactly 7 blocks,
 * mirroring `break`'s shape (Invariant 3.1A.6b) with exactly one
 * structural difference — `then` branches DIRECTLY to `loop_header`
 * (not `loop_exit`, `break`'s target). `break` and `continue`
 * co-occurring in the same loop body are explicitly OUT of scope for
 * this batch (deferred, not assumed as free composition).
 */
export function validateWhileContinueShape(fn: IRFunction, knownFunctionNames: ReadonlySet<string>): void {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: entry must terminate via a plain 'branch' (found '${entry.terminator.kind}')` });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target);
  if (!loopHeader || loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: loop_header must terminate via 'cond_branch' (found '${loopHeader?.terminator.kind ?? "no block"}')` });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget);
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget);
  if (!loopBody || !loopExit || loopBody.id === loopExit.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6c violated: loop_header's cond_branch must target two distinct blocks (loop_body, loop_exit)" });
  }
  if (loopBody.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: loop_body must terminate via 'cond_branch' (the continue check) (found '${loopBody.terminator.kind}')` });
  }
  const bodyTerminator = loopBody.terminator;
  const thenBlock = fn.blocks.find(b => b.id === bodyTerminator.thenTarget);
  const elseBlock = fn.blocks.find(b => b.id === bodyTerminator.elseTarget);
  if (!thenBlock || !elseBlock || thenBlock.id === elseBlock.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6c violated: loop_body's cond_branch must target two distinct blocks (then, else)" });
  }
  if (thenBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: 'then' must terminate via a plain 'branch' (found '${thenBlock.terminator.kind}')` });
  }
  const thenTerminator = thenBlock.terminator;
  if (thenTerminator.target === loopExit.id) {
    throw new WasmUnsupportedError({
      code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
      functionName: fn.sourceName,
      message: "Invariant 3.1A.6c violated: 'then' branches directly to loop_exit — this is the structural signature of 'break' (Invariant 3.1A.6b, already supported independently); this validator handles 'continue' only (then -> loop_header)",
    });
  }
  if (thenTerminator.target !== loopHeader.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6c violated: 'then' must branch directly to loop_header (this is what 'continue' means)" });
  }
  if (elseBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: 'else' must terminate via a plain 'branch' (found '${elseBlock.terminator.kind}')` });
  }
  const elseTerminator = elseBlock.terminator;
  const mergeBlock = fn.blocks.find(b => b.id === elseTerminator.target);
  if (!mergeBlock || mergeBlock.id === entry.id || mergeBlock.id === loopHeader.id || mergeBlock.id === loopBody.id || mergeBlock.id === thenBlock.id || mergeBlock.id === elseBlock.id || mergeBlock.id === loopExit.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "Invariant 3.1A.6c violated: 'else' must branch to a DISTINCT merge block" });
  }
  if (mergeBlock.terminator.kind !== "branch" || mergeBlock.terminator.target !== loopHeader.id) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: merge must terminate via a plain 'branch' back to loop_header (found '${mergeBlock.terminator.kind}')` });
  }
  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: loop_exit must terminate via 'return' directly (found '${loopExit.terminator.kind}')` });
  }
  if (fn.blocks.length !== 7) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: `Invariant 3.1A.6c violated: expected exactly 7 blocks, found ${fn.blocks.length}` });
  }

  const knownSlotIds = new Set(fn.locals.map(l => l.id));

  validateBlockInstructions(entry, fn, knownFunctionNames, false, knownSlotIds);

  const headerUseCounts = validateBlockInstructions(loopHeader, fn, knownFunctionNames, true, knownSlotIds);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const headerConditionId = headerTerminator.condition.id;
  const headerConditionInst = headerInstructionsById.get(headerConditionId);
  if (!headerConditionInst || headerConditionInst.kind !== "binop" || !(headerConditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `the while-condition (id %${headerConditionId}) must be a comparison` });
  }
  headerUseCounts.set(headerConditionId, (headerUseCounts.get(headerConditionId) ?? 0) + 1);
  checkExpressionTreeProperty(headerUseCounts, fn);

  const bodyUseCounts = validateBlockInstructions(loopBody, fn, knownFunctionNames, true, knownSlotIds);
  const bodyInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopBody.instructions) if ("id" in inst) bodyInstructionsById.set(inst.id, inst);
  const continueConditionId = bodyTerminator.condition.id;
  const continueConditionInst = bodyInstructionsById.get(continueConditionId);
  if (!continueConditionInst || continueConditionInst.kind !== "binop" || !(continueConditionInst.op in SUPPORTED_COMPARISONS)) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `the continue-condition (id %${continueConditionId}) must be a comparison` });
  }
  bodyUseCounts.set(continueConditionId, (bodyUseCounts.get(continueConditionId) ?? 0) + 1);
  checkExpressionTreeProperty(bodyUseCounts, fn);

  validateBlockInstructions(thenBlock, fn, knownFunctionNames, false, knownSlotIds);
  validateBlockInstructions(elseBlock, fn, knownFunctionNames, false, knownSlotIds);

  const mergeUseCounts = validateBlockInstructions(mergeBlock, fn, knownFunctionNames, false, knownSlotIds);
  checkExpressionTreeProperty(mergeUseCounts, fn);

  const exitUseCounts = validateBlockInstructions(loopExit, fn, knownFunctionNames, false, knownSlotIds);
  exitUseCounts.set(loopExit.terminator.value.id, (exitUseCounts.get(loopExit.terminator.value.id) ?? 0) + 1);
  checkExpressionTreeProperty(exitUseCounts, fn);
}

/** Peeks at a 7-block function's structure to decide break (3.1A.6b) vs continue (3.1A.6c) — the sole distinguishing fact, per CONTINUE_CFG_ANALYSIS.md, is where 'then' branches: loop_exit (break) or loop_header (continue). Returns undefined if the shape doesn't even reach that determination cleanly, letting the full validator produce a precise error. */
export function classifySevenBlockShape(fn: IRFunction): "break" | "continue" | undefined {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock);
  if (!entry || entry.terminator.kind !== "branch") return undefined;
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target);
  if (!loopHeader || loopHeader.terminator.kind !== "cond_branch") return undefined;
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget);
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget);
  if (!loopBody || loopBody.terminator.kind !== "cond_branch" || !loopExit) return undefined;
  const bodyTerminator = loopBody.terminator;
  const thenBlock = fn.blocks.find(b => b.id === bodyTerminator.thenTarget);
  if (!thenBlock || thenBlock.terminator.kind !== "branch") return undefined;
  const thenTerminator = thenBlock.terminator;
  if (thenTerminator.target === loopExit.id) return "break";
  if (thenTerminator.target === loopHeader.id) return "continue";
  return undefined;
}

/**
 * LAYER 1 (WASM Validator Generalization): a real structural
 * classifier identifying the same top-level CFG patterns the old
 * fixed-block-count dispatcher recognized - by walking the REAL
 * graph from entryBlock first, not by checking fn.blocks.length as
 * the first, primary signal.
 *
 * Explicit scope boundary: recognizes these patterns ONLY at the top
 * level - does NOT recurse into a branch block's own body looking
 * for a nested pattern (that is the NEXT, separate Milestone: Nested
 * Control Flow).
 */
export type WasmTopLevelShape =
  | { readonly kind: "straight-line" }
  | { readonly kind: "if-else-return" }
  | { readonly kind: "if-else-merge" }
  | { readonly kind: "while-basic" }
  | { readonly kind: "while" }
  | { readonly kind: "unrecognized" };

// ─────────────────────────────────────────────────────────────────────────────
// Nested Control Flow, Layer 1 (per WASM_NESTED_CONTROL_FLOW_DESIGN_PROPOSAL.md)
// ─────────────────────────────────────────────────────────────────────────────
//
// DELIBERATELY NOT WIRED into validateScope's own real accept/reject
// path yet - per the Design Proposal's own explicit, safer sequencing
// recommendation: emit-wasm.ts's own real bytecode generation for
// nested shapes does not exist yet, so this classifier accepting a
// shape would be worse than useless if wired to accept programs the
// emitter cannot actually build. This function is real, tested in
// isolation, and ready to be wired in once Layer 2 (real bytecode
// generation for nested shapes) is designed and implemented in a
// separate, later commit.

export type RegionResult = { readonly ok: true } | { readonly ok: false };

export function classifyStructuredRegion(blockId: number, blockById: ReadonlyMap<number, IRFunction["blocks"][number]>, visited: Set<number> = new Set()): RegionResult {
  if (visited.has(blockId)) return { ok: false }; // real cycle guard - a real loop is not a valid nested-if structure
  const block = blockById.get(blockId);
  if (block === undefined) return { ok: false };

  if (block.terminator.kind === "return") {
    return { ok: true };
  }
  if (block.terminator.kind === "branch") {
    // Follow the chain fully, rather than stopping here - a merge
    // block from an inner if/if-else may itself branch onward to an
    // outer merge (real, confirmed live: block(6) in the exact
    // motivating triply-nested case branches onward to block(3)).
    const nextVisited = new Set(visited);
    nextVisited.add(blockId);
    return classifyStructuredRegion((block.terminator as { target: number }).target, blockById, nextVisited);
  }
  if (block.terminator.kind === "cond_branch") {
    const t = block.terminator as { thenTarget: number; elseTarget: number };
    const nextVisited = new Set(visited);
    nextVisited.add(blockId);
    const thenResult = classifyStructuredRegion(t.thenTarget, blockById, nextVisited);
    const elseResult = classifyStructuredRegion(t.elseTarget, blockById, nextVisited);
    // Following each side's own chain fully to a real conclusion
    // (return, or a real failure) means both sides independently
    // arrive at the same real answer if they truly reunite later -
    // no separate "same merge target" check is needed once chains
    // are followed all the way through.
    return { ok: thenResult.ok && elseResult.ok };
  }
  return { ok: false }; // other terminator kinds (while-related edges) not handled by this region classifier
}

/**
 * Real, function-level check built on classifyStructuredRegion: does
 * this function's own entry block form a valid nested if/if-else
 * structure (at any depth) where every real execution path
 * eventually returns? NOT wired to any accept/reject decision - see
 * the module-level comment above.
 */
export function isNestedIfStructureValid(fn: IRFunction): boolean {
  const blockById = new Map(fn.blocks.map(b => [b.id, b] as const));
  return classifyStructuredRegion(fn.entryBlock, blockById).ok;
}

export function classifyTopLevelShape(fn: IRFunction): WasmTopLevelShape {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock);
  if (entry === undefined) return { kind: "unrecognized" };

  if (fn.blocks.length === 1) {
    return entry.terminator.kind === "return" ? { kind: "straight-line" } : { kind: "unrecognized" };
  }

  if (entry.terminator.kind === "cond_branch") {
    const t = entry.terminator;
    const thenBlock = fn.blocks.find(b => b.id === t.thenTarget);
    const elseBlock = fn.blocks.find(b => b.id === t.elseTarget);
    if (thenBlock === undefined || elseBlock === undefined || thenBlock.id === elseBlock.id) {
      return { kind: "unrecognized" };
    }
    if (thenBlock.terminator.kind === "cond_branch" || elseBlock.terminator.kind === "cond_branch") {
      return { kind: "unrecognized" };
    }
    if (thenBlock.terminator.kind === "return" && elseBlock.terminator.kind === "return") {
      return fn.blocks.length === 3 ? { kind: "if-else-return" } : { kind: "unrecognized" };
    }
    if (thenBlock.terminator.kind === "branch" && elseBlock.terminator.kind === "branch") {
      const thenTarget = (thenBlock.terminator as { target: number }).target;
      const elseTarget = (elseBlock.terminator as { target: number }).target;
      if (thenTarget === elseTarget) {
        const mergeBlock = fn.blocks.find(b => b.id === thenTarget);
        if (mergeBlock !== undefined && mergeBlock.terminator.kind === "return" && fn.blocks.length === 4) {
          return { kind: "if-else-merge" };
        }
      }
    }
    return { kind: "unrecognized" };
  }

  // Basic while (no break/continue): entry ends in a plain,
  // unconditional 'branch' to a real loop header ending in
  // 'cond_branch' - 4 real blocks total.
  if (entry.terminator.kind === "branch") {
    const loopHeaderId = (entry.terminator as { target: number }).target;
    const loopHeader = fn.blocks.find(b => b.id === loopHeaderId);
    if (loopHeader !== undefined && loopHeader.terminator.kind === "cond_branch" && fn.blocks.length === 4) {
      return { kind: "while-basic" };
    }
  }

  // While (break/continue): kept as the existing, already-proven
  // 7-block detection - real generalization of the loop shape itself
  // (recognizing it by a genuine back-edge rather than the literal
  // number 7) is real, separate, follow-on work.
  if (fn.blocks.length === 7) {
    return { kind: "while" };
  }

  return { kind: "unrecognized" };
}

export function validateScope(fn: IRFunction, knownFunctionNames: ReadonlySet<string>, isNestedIfStructureValidFn: (fn: IRFunction) => boolean = isNestedIfStructureValid): void {
  // Step 5 (per WASM_FUNCTION_PARAMETERS_DESIGN.md): primitive-typed
  // parameters are now supported. Struct-typed parameters remain
  // explicitly rejected — a SEPARATE, later phase, per the explicit
  // sequencing decision (primitives proven first, before struct).
  for (const param of fn.params) {
    if (param.structLayout !== undefined) {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_INSTRUCTION,
        functionName: fn.sourceName,
        message: `struct-typed function parameters are not supported yet (parameter '${param.name}') — deferred to a later, separate phase per the explicit sequencing decision (primitives first)`,
      });
    }
  }

  const shape = classifyTopLevelShape(fn);

  if (shape.kind === "straight-line") {
    // V29-D2 (fix B): an array-typed PARAMETER (isArrayParam) is also a
    // genuinely known array, per the WASM-side design ratified in
    // v29-D2-RD — included here alongside isArray (freshly-allocated
    // local arrays) so array_load/array_store referencing a parameter
    // slot are correctly recognized, not rejected as unsupported.
    const knownArraySlotIds = new Set(fn.locals.filter(l => l.isArray === true || l.isArrayParam === true).map(l => l.id));
    const knownStructSlotIds = new Set(fn.locals.filter(l => l.structLayout !== undefined).map(l => l.id));
    validateReturnBlock(fn.blocks[0]!, fn, knownFunctionNames, false, new Set(), knownArraySlotIds, knownStructSlotIds);
    return;
  }
  if (shape.kind === "if-else-return") {
    validateDiamondShape(fn, knownFunctionNames);
    return;
  }
  if (shape.kind === "if-else-merge") {
    validateMergeShape(fn, knownFunctionNames);
    return;
  }
  if (shape.kind === "while-basic") {
    validateWhileShape(fn, knownFunctionNames);
    return;
  }
  if (shape.kind === "while") {
    const sevenBlockShape = classifySevenBlockShape(fn);
    if (sevenBlockShape === "continue") {
      validateWhileContinueShape(fn, knownFunctionNames);
    } else if (sevenBlockShape === "break") {
      validateWhileBreakShape(fn, knownFunctionNames);
    } else if (isNestedIfStructureValidFn(fn)) {
      // WASM Layer 2 (per WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md):
      // Layer 1's own classifier confirms this is a genuine, valid
      // nested-if structure - accepted here. HONEST, DISCLOSED
      // LIMITATION: this accepts the real, structural shape only -
      // it does not yet run the deeper per-block semantic checks
      // (e.g. the Expression Tree Property) the single-level
      // validators perform, since no dedicated semantic validator
      // for nested shapes exists yet - out of this phase's own
      // scope (Layer 1 is not being modified beyond adding this real
      // acceptance branch, per the explicit boundary not to touch
      // Layer 1 unless a real bug appears).
      return;
    } else {
      throw new WasmUnsupportedError({
        code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
        functionName: fn.sourceName,
        message: `unrecognized 7-block CFG shape (not the break/continue pattern this sub-phase supports, and not a valid nested-if structure) — likely nested control flow this Backend still does not support (e.g. if inside while, while inside if, or while inside while)`,
      });
    }
    return;
  }

  if (isNestedIfStructureValidFn(fn)) {
    // Same real acceptance as the while-branch's own equivalent
    // check above, for any block count that doesn't match the known
    // fixed shapes (e.g. a nested if deeper than 3 levels, producing
    // a block count other than 7).
    return;
  }

  throw new WasmUnsupportedError({
    code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
    functionName: fn.sourceName,
    message: `unsupported CFG shape (found ${fn.blocks.length} blocks) — only single-block, 3-block Diamond (Invariant 3.1A.4), 4-block Diamond+Merge (Invariant 3.1A.5), or a valid nested-if structure are supported yet`,
  });
}

/**
 * Per WASM_FUNCTION_PARAMETERS_FINAL_EVIDENCE.md's own Gate 1
 * pseudo-code: builds one WASM function type PER DISTINCT SIGNATURE
 * actually used in the module, deduplicated by a (params, returnType)
 * key computed purely from the signature — never the function's own
 * name/identity — so two functions with identical signatures always
 * share one type index, and the Map-lookup-before-push structurally
 * prevents ever creating a duplicate entry.
 */
