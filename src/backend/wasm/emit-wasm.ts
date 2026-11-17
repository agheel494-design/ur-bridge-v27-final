// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Binary Emitter
// Level 3.1A.1 through 3.1A.4 — WASM_BACKEND_SPEC.md §0, §2, §4
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit review's exact scope, batch by batch:
//
//   3.1A.1 ALLOWED:  Module / Type / Function / Export / Code sections,
//             a zero-parameter function whose entire body is
//             `const` instructions, terminated by `return <const>`.
//   3.1A.2 ADDS:     `add`/`sub`/`mul` binops on `const_int` operands,
//             with every SSA value used AT MOST ONCE (Expression Tree
//             Property, WASM_BACKEND_SPEC.md §2.1).
//   3.1A.3 ADDS:     direct, intra-module, zero-argument, NON-RECURSIVE
//             function calls (`call-graph.ts` rejects any cycle).
//   3.1A.4 ADDS:     `if`/`else`, per Invariant 3.1A.4 (ratified, per
//             review — WASM_BACKEND_SPEC.md §4): accepted ONLY when
//             BOTH branches terminate via `return` — no merge block,
//             ever. Comparison operators (`eq`/`neq`/`lt`/`lte`/`gt`/
//             `gte`) are a DEPENDENCY of this item (they exist solely
//             to produce the `if` condition), not a separate milestone.
//
//   FORBIDDEN (still, this batch): locals, boolean ops (`&&`/`||`),
//             div/mod, while, merge blocks, nested if, arrays, structs,
//             memory, Runtime imports — anything else. Rejected via
//             WASM1001/WASM1002, never miscompiled.
//
// Only `i64` is supported (matching the IR's own convention: UR's
// `int` type lowers to IRType "i64" throughout the existing C Backend
// — this emitter stays faithful to that, rather than narrowing to
// WASM's `i32` for convenience).

import type { IRFunction, IRModule, IRInstruction, IRBasicBlock, ExternSymbol } from "../../shared/ir.js";
import { encodeULEB128, encodeSLEB128, concatBytes, withLength, encodeVector } from "./leb128.js";
import { WASM_CODES, WasmUnsupportedError } from "./wasm-diagnostics.js";
import { detectRecursion } from "./call-graph.js";
import { encodeArrayElementLoad, encodeArrayElementStore, encodeArrayRefElementLoad, encodeArrayRefElementStore, encodeArrayAllocation, encodeArrayHeaderStore, encodeArrayLengthLoad, encodeMemorySection, encodeGlobalSection, encodeBoundsCheck } from "./array-memory.js";
import { encodeStructFieldLoad, encodeStructFieldStore, encodeStructAllocation } from "./struct-memory.js";
import { OPCODE_END, OPCODE_GLOBAL_GET, OPCODE_GLOBAL_SET, OPCODE_I32_ADD, OPCODE_I32_CONST, OPCODE_I32_MUL, OPCODE_I32_OR, OPCODE_I32_WRAP_I64, OPCODE_I32_STORE8, OPCODE_I64_CONST, OPCODE_I64_GE_S, OPCODE_I64_LOAD, OPCODE_I64_LT_S, OPCODE_I64_STORE, OPCODE_IF, OPCODE_LOCAL_SET, OPCODE_UNREACHABLE, OPCODE_F64_ADD, OPCODE_F64_SUB, OPCODE_F64_MUL, OPCODE_F64_CONVERT_I64_S } from "./wasm-opcodes.js";

// ── WASM binary format constants (module-private — no magic numbers scattered through the emitter body) ──

const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
const WASM_VERSION = new Uint8Array([0x01, 0x00, 0x00, 0x00]);

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_FUNCTION = 3;
const SECTION_MEMORY = 5;
const SECTION_GLOBAL = 6;
const SECTION_EXPORT = 7;
const SECTION_CODE = 10;
const IMPORTKIND_FUNC = 0x00;

const VALTYPE_I64 = 0x7e;
const FUNCTYPE = 0x60;
const EXPORTKIND_FUNC = 0x00;
const EXPORTKIND_MEMORY = 0x02;
const EXPORTKIND_GLOBAL = 0x03;

const OPCODE_I64_ADD = 0x7c;
const OPCODE_I64_SUB = 0x7d;
const OPCODE_I64_MUL = 0x7e;
// V2-M5 (Gate authorized, narrow scope): const_float and add/sub/mul
// binops for f64 only, mirroring the already-proven i64 pattern
// exactly. VALTYPE_F64/OPCODE_F64_CONST are used only in this file
// (function-type/local building, const encoding) - OPCODE_F64_ADD/
// SUB/MUL live in wasm-opcodes.ts since wasm-cfg-validation.ts also
// needs them (see that file's own import).
const VALTYPE_F64 = 0x7c;
const OPCODE_F64_CONST = 0x44;
const OPCODE_I64_EQ = 0x51;
const OPCODE_I64_NE = 0x52;
const OPCODE_I64_GT_S = 0x55;
const OPCODE_I64_LE_S = 0x57;
const OPCODE_ELSE = 0x05;
const OPCODE_CALL = 0x10;
const OPCODE_LOCAL_GET = 0x20;
const MEMARG_ALIGN1_OFFSET0 = new Uint8Array([0x00, 0x00]);
const OPCODE_BLOCK = 0x02;
const OPCODE_LOOP = 0x03;
const OPCODE_BR = 0x0c;
const OPCODE_BR_IF = 0x0d;
const OPCODE_I32_EQZ = 0x45;
const BLOCKTYPE_VOID = 0x40;
const OPCODE_RETURN = 0x0f;

// SUPPORTED_BINOPS/SUPPORTED_COMPARISONS moved to wasm-cfg-validation.ts
// (Architecture Freeze Audit) - imported below where still needed here.

/**
 * Validates that `fn` fits EXACTLY within the current sub-phase's scope
 * (3.1A.1 return-const, extended by 3.1A.2 to add/sub/mul arithmetic),
 * per WASM_BACKEND_SPEC.md §0. Throws WasmUnsupportedError (never
 * returns a partial/best-effort result) for anything outside it.
 *
 * 3.1A.2 scope, per explicit review narrowing:
 *   - add/sub/mul only (div/mod deferred — zero-divisor concern,
 *     matching OPTIMIZER_SPEC.md §6.1's identical precedent).
 *   - NO comparisons, NO boolean ops, NO type conversions, NO floats —
 *     none of these are introduced by this batch, full stop.
 *   - THE EXPRESSION TREE PROPERTY (WASM_BACKEND_SPEC.md §2.1, ratified
 *     — the precise, checkable formulation, not merely "no value
 *     reuse"): every SSA value defined in this function has fan-out
 *     <= 1 — it is used as an operand (or as the terminator's return
 *     value) AT MOST ONCE across the whole function. The def-use graph
 *     must be a tree, never a DAG. A DAG (e.g. `let a = 2+3; return a
 *     + a`, where the `2+3` result feeds two separate uses) would
 *     require a WASM local to hold the shared value for stack-machine
 *     evaluation — and Local Variables are explicitly deferred to
 *     3.1A.6 (IR_LOCAL_PRESENCE_AUDIT.md). Rejecting DAGs here, rather
 *     than introducing a WASM local as an implementation detail, keeps
 *     this batch exactly at the boundary where a local becomes
 *     structurally necessary, not merely convenient.
 */
/**
 * Validates one block's instructions (const/binop/call, and —
 * ONLY when `allowComparisons` is true, for the entry block of a
 * Diamond shape — comparisons too), returning the use-count map for
 * the caller to finalize with its own terminator-specific Expression
 * Tree Property check. Shared between the single-block path
 * (3.1A.1-3.1A.3) and the Diamond CFG path (3.1A.4) so both enforce
 * identical rules for ordinary instructions.
 */
// CFG shape validation (validateBlockInstructions, validateReturnBlock,
// validateDiamondShape, validateMergeShape, validateWhileShape,
// validateWhileBreakShape, validateWhileContinueShape, validateScope) was
// extracted to wasm-cfg-validation.ts (Architecture Freeze Audit) - pure
// separation, zero behavioral change.
import { validateBlockInstructions, validateReturnBlock, validateDiamondShape, validateMergeShape, validateWhileShape, validateWhileBreakShape, validateWhileContinueShape, validateScope, classifySevenBlockShape, classifyTopLevelShape, isNestedIfStructureValid, SUPPORTED_BINOPS, SUPPORTED_BINOPS_F64, SUPPORTED_COMPARISONS } from "./wasm-cfg-validation.js";
import { EmitContextStack } from "./loop-context.js";

function buildFunctionTypes(functions: readonly IRFunction[]): { typeEntries: Uint8Array[]; functionTypeIndex: Map<string, number> } {
  const typeKeyToIndex = new Map<string, number>();
  const typeEntries: Uint8Array[] = [];
  const functionTypeIndex = new Map<string, number>();

  for (const fn of functions) {
    // V29-D2 (Implementation Gate, WASM-only scope, fix A): an array-typed
    // parameter's real WASM value is an i32 base address (matching
    // array-memory.ts's own literal-array representation exactly), NOT
    // the i64 the IR's own generic param.type field says - confirmed
    // empirically in v29-D2-RD: pushing an i32 base address into an i64
    // parameter slot is a genuine WASM type mismatch, not a cosmetic
    // inconsistency. fn.params itself carries no isArrayParam flag - it
    // lives on the CORRESPONDING fn.locals entry, matched by name (the
    // two use different id/position numbering schemes entirely, per
    // v29-D2-RD's own direct empirical finding - never assume slot id
    // equals parameter position).
    const isArrayParam = (p: { name: string }) => fn.locals.some(l => l.name === p.name && l.isArrayParam === true);
    // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: a function that
    // RETURNS an array must declare an i32 result type in its own WASM
    // function signature (an array value is a base-offset pointer into
    // linear memory, exactly like an array PARAMETER already correctly
    // declares i32 just above) — not i64, which fn.returnType alone
    // (still "i64" for an array-typed return, no array-specific marker
    // at that level) would otherwise default to. Detected the same way
    // the return-block emission fix above detects it: any return
    // terminator in this function whose own value is an array-slot
    // reference.
    const returnsArray = fn.blocks.some(b => b.terminator.kind === "return" && b.terminator.value.arraySlot !== undefined);
    // The type-deduplication key must ALSO distinguish an array param
    // from a scalar i64 param (both report type "i64" on fn.params) -
    // otherwise two functions needing different actual WASM signatures
    // could incorrectly share one type index. Same requirement now
    // applies to an array RETURN vs. a scalar i64 return.
    const key = `${fn.params.map(p => isArrayParam(p) ? "arr" : p.type).join(",")}->${returnsArray ? "arr" : fn.returnType}`;
    let index = typeKeyToIndex.get(key);
    if (index === undefined) {
      index = typeEntries.length;
      const paramValTypes = fn.params.map(p => new Uint8Array([isArrayParam(p) || p.type === "string" ? VALTYPE_I32 : (p.type === "f64" ? VALTYPE_F64 : VALTYPE_I64)]));
      const resultValTypes = fn.returnType === "void" ? [] : [new Uint8Array([returnsArray || fn.returnType === "string" ? VALTYPE_I32 : (fn.returnType === "f64" ? VALTYPE_F64 : VALTYPE_I64)])];
      typeEntries.push(concatBytes(FUNCTYPE, encodeVector(paramValTypes), encodeVector(resultValTypes)));
      typeKeyToIndex.set(key, index);
    }
    functionTypeIndex.set(fn.qualifiedName, index);
  }
  return { typeEntries, functionTypeIndex };
}

function encodeTypeSection(typeEntries: readonly Uint8Array[]): Uint8Array {
  return concatBytes(SECTION_TYPE, withLength(encodeVector(typeEntries)));
}

// P1-3C (Implementation Gate, narrow scope): WASM Import Section support
// for Runtime Builtins (print/input/free), confined to src/backend/wasm/
// per the Gate's own boundary - IRModule.externs, BuiltinId, and
// runtime-table.ts are read-only here, unchanged, exactly as the
// P1-3C Discovery/Design Gate found they already are (backend-agnostic,
// no change needed). Scope narrowed further, deliberately, per the
// manager's own "smallest complete path first" instruction: only
// externs whose full signature is representable in this emitter's
// existing, unchanged all-i64 value-type model (int params, void or
// int return) are imported - this covers `print(int)` -> `ur_print_int`
// completely and correctly. `ur_print_string`/`ur_input_string`/`ur_free`
// (all "string"-typed) are NOT included in this set - calls to them
// still correctly fall through to the existing, unmodified WASM1004
// rejection below, since representing UR's `string` as a WASM value
// type at a function-import boundary is a real, separate design
// question (linear-memory pointer representation, ownership, encoding)
// not decided by the Discovery Gate and not implemented here - adding
// it without that design would be exactly the kind of untested
// workaround the Gate's Stop Conditions prohibit.
// V2-M2 (Design approved, narrow scope): "string" is now ALSO
// WASM-importable, alongside the existing i64/void support - a string
// crossing this boundary is represented as an i32 offset into this
// module's own linear memory (matching the array header convention
// exactly: an 8-byte length field, then N bytes of UTF-8 data,
// addressed by the offset of the length field itself) - NOT the
// NativePtr convention (an i64 host-process address), since a string
// here lives INSIDE this module's own WASM memory, addressed the same
// native (i32) way arrays already are.
function isWasmImportableExtern(extern: ExternSymbol): boolean {
  const paramsOk = extern.parameterTypes.every(t => t === "i64" || t === "string");
  const returnOk = extern.returnType === "i64" || extern.returnType === "void" || extern.returnType === "string";
  return paramsOk && returnOk;
}

/** Finds every extern (from module.externs) that is both WASM-importable
 *  (see isWasmImportableExtern) AND actually called by some function in
 *  this module - unused externs are never imported, so a module with no
 *  print/input/free calls emits zero imports and stays byte-for-byte
 *  compatible with every pre-3.1C `WebAssembly.instantiate(bytes)` call
 *  site that passes no import object at all (the entire existing 3.1A/
 *  3.1B test suite). */
function findUsedWasmImports(module: IRModule): ExternSymbol[] {
  const calledNames = new Set<string>();
  for (const fn of module.functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "call") calledNames.add(inst.callee);
      }
    }
  }
  return module.externs.filter(e => calledNames.has(e.name) && isWasmImportableExtern(e));
}

function buildImportTypesAndIndex(imports: readonly ExternSymbol[]): { importTypeEntries: Uint8Array[]; importFunctionIndex: Map<string, number> } {
  const importTypeEntries: Uint8Array[] = [];
  const importFunctionIndex = new Map<string, number>();
  imports.forEach((ext, i) => {
    // V2-M2: a "string" param/return uses VALTYPE_I32 (this module's
    // own native linear-memory address width), NOT VALTYPE_I64 - see
    // isWasmImportableExtern's own comment for why this differs from
    // the i64 convention used everywhere else in this emitter
    // (including NativePtr's own host-process-address case).
    const wasmValType = (t: "i64" | "string") => t === "string" ? VALTYPE_I32 : VALTYPE_I64;
    const paramValTypes = ext.parameterTypes.map(t => new Uint8Array([wasmValType(t as "i64" | "string")]));
    const resultValTypes = ext.returnType === "void" ? [] : [new Uint8Array([wasmValType(ext.returnType as "i64" | "string")])];
    importTypeEntries.push(concatBytes(FUNCTYPE, encodeVector(paramValTypes), encodeVector(resultValTypes)));
    importFunctionIndex.set(ext.name, i);
  });
  return { importTypeEntries, importFunctionIndex };
}

/** WASM import module namespace for Runtime Builtins - the JS host
 *  (whatever calls WebAssembly.instantiate) must supply a matching
 *  function under this same module name for every import this module
 *  declares. Fixed per this Gate's design; not user-configurable. */
const RUNTIME_IMPORT_MODULE = "ur_runtime";

function encodeImportSection(imports: readonly ExternSymbol[], importTypeIndexByName: ReadonlyMap<string, number>): Uint8Array {
  const moduleNameBytes = new TextEncoder().encode(RUNTIME_IMPORT_MODULE);
  const entries = imports.map(ext => {
    const fieldNameBytes = new TextEncoder().encode(ext.name);
    return concatBytes(
      encodeULEB128(moduleNameBytes.length), moduleNameBytes,
      encodeULEB128(fieldNameBytes.length), fieldNameBytes,
      new Uint8Array([IMPORTKIND_FUNC]),
      encodeULEB128(importTypeIndexByName.get(ext.name)!),
    );
  });
  return concatBytes(SECTION_IMPORT, withLength(encodeVector(entries)));
}

function encodeFunctionSection(functions: readonly IRFunction[], functionTypeIndex: ReadonlyMap<string, number>): Uint8Array {
  const indices = functions.map(fn => encodeULEB128(functionTypeIndex.get(fn.qualifiedName)!));
  return concatBytes(SECTION_FUNCTION, withLength(encodeVector(indices)));
}

function encodeExportSection(functions: readonly IRFunction[], exportMemory: boolean, importCount: number = 0, exportBumpGlobal: boolean = false): Uint8Array {
  const functionEntries = functions.map((fn, index) => {
    const nameBytes = new TextEncoder().encode(fn.sourceName);
    return concatBytes(encodeULEB128(nameBytes.length), nameBytes, EXPORTKIND_FUNC, encodeULEB128(index + importCount));
  });
  const memoryEntries = exportMemory ? [(() => {
    const nameBytes = new TextEncoder().encode("memory");
    return concatBytes(encodeULEB128(nameBytes.length), nameBytes, EXPORTKIND_MEMORY, encodeULEB128(0));
  })()] : [];
  // V2-M2 (Design approved, narrow scope): the bump-pointer Global
  // (already declared by encodeGlobalSection whenever memory is
  // needed - unchanged) is now ALSO exported, ONLY when a used import
  // actually involves "string" - a host `input()` shim needs to know
  // WHERE in linear memory it may safely write a new string's bytes
  // (the current bump-pointer value) and must advance it afterward,
  // exactly mirroring what encodeArrayAllocation's own WASM-side bump
  // advance already does for arrays - reusing the SAME Global as the
  // single source of allocation-state truth, rather than inventing a
  // second, separate protocol. Exported only when actually needed
  // (string usage present) - a module with only arrays/structs and no
  // strings continues to NOT export this Global, unchanged from
  // before this Gate.
  const globalEntries = exportBumpGlobal ? [(() => {
    const nameBytes = new TextEncoder().encode("ur_bump");
    return concatBytes(encodeULEB128(nameBytes.length), nameBytes, EXPORTKIND_GLOBAL, encodeULEB128(0));
  })()] : [];
  return concatBytes(SECTION_EXPORT, withLength(encodeVector([...functionEntries, ...memoryEntries, ...globalEntries])));
}

function encodeReturnBlockBody(block: IRBasicBlock, fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number> = new Map(), arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), bumpGlobalIndex = 0, structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  const terminator = block.terminator;
  if (terminator.kind === "branch") {
    const targetBlock = fn.blocks.find(b => b.id === terminator.target)!;
    const branchInstructionsById = new Map<number, IRInstruction>();
    for (const inst of block.instructions) if ("id" in inst) branchInstructionsById.set(inst.id, inst);
    return concatBytes(
      encodeStatements(block, branchInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, undefined, structBaseLocalIndexBySlotId),
      encodeReturnBlockBody(targetBlock, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
    );
  }
  if (terminator.kind === "cond_branch") {
    const thenBlock = fn.blocks.find(b => b.id === terminator.thenTarget)!;
    const elseBlock = fn.blocks.find(b => b.id === terminator.elseTarget)!;
    const conditionInstructionsById = new Map<number, IRInstruction>();
    for (const inst of block.instructions) if ("id" in inst) conditionInstructionsById.set(inst.id, inst);
    return concatBytes(
      encodeStatements(block, conditionInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, undefined, structBaseLocalIndexBySlotId),
      encodeExpr(terminator.condition.id, conditionInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
      OPCODE_IF, BLOCKTYPE_VOID,
      encodeReturnBlockBody(thenBlock, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
      OPCODE_ELSE,
      encodeReturnBlockBody(elseBlock, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
      OPCODE_END,
    );
  }
  if (terminator.kind !== "return") {
    // Unreachable given validateScope() already ran — defensive only.
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'return' or 'cond_branch' terminator" });
  }
  const instructionsById = new Map<number, IRInstruction>();
  for (const inst of block.instructions) if ("id" in inst) instructionsById.set(inst.id, inst);
  // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: a return whose
  // own value is an array-slot reference (arraySlot set, id=-1 — the
  // SAME sentinel shape already proven correct elsewhere, e.g. the
  // array_store value-operand case above) is not an ordinary SSA
  // value; encodeExpr(-1, ...) would throw. The correct value is a
  // direct read of the referenced array's own existing base-address
  // local — reusing the SAME arrayBaseLocalIndexBySlotId already
  // tracked for it, exactly matching the array parameter ABI's own
  // single-base-offset convention (no new ABI shape introduced).
  const returnValueExpr = terminator.value.arraySlot !== undefined
    ? (() => {
        const returnedArrayBaseLocalIndex = arrayBaseLocalIndexBySlotId.get(terminator.value.arraySlot!);
        if (returnedArrayBaseLocalIndex === undefined) {
          throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for returned array slot ${terminator.value.arraySlot}` });
        }
        return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(returnedArrayBaseLocalIndex));
      })()
    : encodeExpr(terminator.value.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
  return concatBytes(
    encodeStatements(block, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, undefined, structBaseLocalIndexBySlotId),
    returnValueExpr,
    OPCODE_RETURN,
  );
}

/**
 * Encodes the Diamond CFG shape (Invariant 3.1A.4): a WASM `if`/`else`
 * where BOTH arms end in `return` — matching WASM's own structured
 * `if`/`else` directly (no relooping needed, per WASM_BACKEND_SPEC.md
 * §1's reuse of the Dominator Tree/CFA to recognize exactly this
 * pattern upstream, at the IR level, before this encoder ever runs).
 * A trailing `i64.const 0; return` after the if/else exists ONLY so
 * the function's final expression still type-checks under WASM's
 * validation rules — both real branches already returned before that
 * point is ever reached at runtime (confirmed directly: see the
 * hand-built-module tests run before this encoder was written).
 */
function encodeIfElseFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number> = new Map(), arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), bumpGlobalIndex = 0, structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "cond_branch") {
    // Unreachable given validateScope() already ran — defensive only.
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator" });
  }
  const entryTerminator = entry.terminator;
  const thenBlock = fn.blocks.find(b => b.id === entryTerminator.thenTarget)!;
  const elseBlock = fn.blocks.find(b => b.id === entryTerminator.elseTarget)!;

  const entryInstructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) entryInstructionsById.set(inst.id, inst);

  // Gate V1-GAP-006A-WASM-CONDITIONAL-ARRAY-RETURN-IMPLEMENTATION: the
  // `if`/`else` construct's own declared WASM blocktype, and its own
  // trailing fallback, exist SOLELY so WASM's validator accepts "the
  // function's final expression" as type-checking (confirmed directly,
  // the ORIGINAL author's own comment on this exact function, kept
  // below) — they were always hardcoded to i64 only because, before
  // array returns existed, every function reaching this encoder
  // returned i64. The correct, general contract, established in
  // Design and verified there by a temporary, reverted experiment:
  //   function's own real return type -> this construct's own
  //   blocktype -> a fallback that never introduces a CONFLICTING
  //   type on the stack for a path already proven unreachable.
  // This must remain correct for EVERY existing scalar return type
  // (i64, f64), not only add the new array (i32) case — confirmed
  // directly, f64 conditional return was ALREADY broken before this
  // fix (a real, pre-existing bug: "expected f64, got i64"), for the
  // exact same underlying reason. Array-returning functions use
  // OPCODE_UNREACHABLE for their own fallback (a genuinely type-
  // agnostic instruction, correct for code already proven
  // unreachable) rather than a typed dummy constant, since a
  // synthetic "i32 array base address" value has no safe placeholder
  // meaning the way a synthetic scalar 0 does.
  const returnsArray = fn.blocks.some(b => b.terminator.kind === "return" && b.terminator.value.arraySlot !== undefined);
  const conditionalBlockType = returnsArray ? VALTYPE_I32 : (fn.returnType === "f64" ? VALTYPE_F64 : VALTYPE_I64);
  const conditionalFallback = returnsArray
    ? new Uint8Array([OPCODE_UNREACHABLE])
    : (fn.returnType === "f64"
        ? (() => {
            const buf = new ArrayBuffer(8);
            new DataView(buf).setFloat64(0, 0, true);
            return concatBytes(OPCODE_F64_CONST, new Uint8Array(buf));
          })()
        : concatBytes(new Uint8Array([OPCODE_I64_CONST]), encodeSLEB128(0n)));

  // Conditional Allocation (3.1B.6, Gate V2-M1) — a SECOND, deeper,
  // genuinely pre-existing gap discovered during this Gate's own
  // testing (confirmed via git-stash isolation against the ORIGINAL,
  // unmodified code: an entry-allocated array read from within this
  // Diamond shape's own branches returned 0/wrong values even before
  // any change in this Gate, once the parameter-threading fix above
  // stopped it from being hard-rejected instead). Root cause: this
  // function never encoded entry's OWN statements at all (only the
  // branch condition expression) - entry.instructions (a `store` or
  // `array_store` initializing state, e.g. `let arr = [10,20,30]`)
  // were silently never emitted. Fixed by adding the missing
  // encodeStatements(entry, ...) call, mirroring
  // encodeIfElseMergeFunctionBody's own already-correct pattern
  // exactly (doc comment there: "entry's own statements (if any
  // stores)") - including the SAME shared allocatedArraySlots/
  // allocatedStructSlots Sets across entry+then+else, per the
  // ratified CRITICAL-array-reallocated-every-loop-iteration.md fix
  // this project's own history already established as mandatory for
  // this exact class of correctness bug.
  //
  // NOTE (V1-GAP-006A scope boundary): a DIFFERENT, SEPARATE gap under
  // this SAME "Conditional Allocation" name (a resultArraySlot-based
  // call's own result, used as a conditional branch's own return
  // value) was found during Design and is explicitly OUT OF SCOPE for
  // this Gate, per direct instruction — it must continue to be
  // rejected here, not silently made to pass.
  const allocatedArraySlots = new Set<number>();
  const allocatedStructSlots = new Set<number>();
  const thenInstructionsById = new Map<number, IRInstruction>();
  for (const inst of thenBlock.instructions) if ("id" in inst) thenInstructionsById.set(inst.id, inst);
  const elseInstructionsById = new Map<number, IRInstruction>();
  for (const inst of elseBlock.instructions) if ("id" in inst) elseInstructionsById.set(inst.id, inst);

  return concatBytes(
    encodeStatements(entry, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    encodeExpr(entryTerminator.condition.id, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
    OPCODE_IF, conditionalBlockType,
    encodeReturnBlockBody(thenBlock, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
    OPCODE_ELSE,
    encodeReturnBlockBody(elseBlock, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
    OPCODE_END,
    // Unreachable fallback (both real arms already returned) — required only for WASM's own type-checking of the function's final expression.
    conditionalFallback,
    OPCODE_RETURN,
  );
}


/**
 * Encodes the "Diamond + Merge" CFG shape (Invariant 3.1A.5): `entry`'s
 * own statements (if any `store`s), the condition, a VOID-result
 * `if`/`else` (each arm's `store` statements only — WASM's own
 * fallthrough after the if/else IS the merge point, requiring no
 * `block`/`br`/`br_if` at all, confirmed by direct hand-built-module
 * testing before this encoder was written), then the merge block's own
 * statements followed by its `return`.
 */
function encodeIfElseMergeFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number>, arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), bumpGlobalIndex = 0, structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "cond_branch") {
    // Unreachable given validateScope() already ran — defensive only.
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator" });
  }
  const entryTerminator = entry.terminator;
  const thenBlock = fn.blocks.find(b => b.id === entryTerminator.thenTarget)!;
  const elseBlock = fn.blocks.find(b => b.id === entryTerminator.elseTarget)!;
  if (thenBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on 'then'" });
  }
  const thenTerminator = thenBlock.terminator;
  const mergeBlock = fn.blocks.find(b => b.id === thenTerminator.target)!;
  if (mergeBlock.terminator.kind !== "return") {
    // Unreachable given validateScope() already ran — defensive only.
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'return' terminator on the merge block" });
  }

  const entryInstructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) entryInstructionsById.set(inst.id, inst);
  const thenInstructionsById = new Map<number, IRInstruction>();
  for (const inst of thenBlock.instructions) if ("id" in inst) thenInstructionsById.set(inst.id, inst);
  const elseInstructionsById = new Map<number, IRInstruction>();
  for (const inst of elseBlock.instructions) if ("id" in inst) elseInstructionsById.set(inst.id, inst);
  const mergeInstructionsById = new Map<number, IRInstruction>();
  for (const inst of mergeBlock.instructions) if ("id" in inst) mergeInstructionsById.set(inst.id, inst);

  // CRITICAL FIX (per issues/CRITICAL-array-reallocated-every-loop-iteration.md):
  // ONE shared Set across entry/then/else/merge, so an array allocated
  // in entry is correctly recognized as already-allocated everywhere
  // else in this function — not re-allocated. Relies on JS's
  // guaranteed left-to-right argument evaluation order: entry's own
  // encodeStatements() call runs first and populates this Set before
  // then/else/merge's calls run.
  const allocatedArraySlots = new Set<number>();
  // Struct Phase 2 (per direct direction): the SAME shared-Set fix,
  // for the SAME reason, applied to structs — a struct allocated in
  // entry must not be re-allocated when then/else/merge's own
  // encodeStatements() calls run.
  const allocatedStructSlots = new Set<number>();

  return concatBytes(
    encodeStatements(entry, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    encodeExpr(entryTerminator.condition.id, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
    OPCODE_IF, BLOCKTYPE_VOID,
    encodeStatements(thenBlock, thenInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    OPCODE_ELSE,
    encodeStatements(elseBlock, elseInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    OPCODE_END,
    encodeStatements(mergeBlock, mergeInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    encodeExpr(mergeBlock.terminator.value.id, mergeInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
    OPCODE_RETURN,
  );
}

/**
 * Encodes the plain `while` loop CFG shape (Invariant 3.1A.6):
 * `entry`'s statements, then a `block $exit { loop $continue { br_if
 * $exit (i32.eqz <condition>); <body statements>; br $continue } }`,
 * then `loop_exit`'s statements and `return` — confirmed correct by
 * direct hand-built-module testing (a plain counting loop) before
 * this encoder was written.
 */
function encodeWhileFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number>, arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), bumpGlobalIndex = 0, structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on entry" });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target)!;
  if (loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator on loop_header" });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget)!;
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget)!;

  const entryInstructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) entryInstructionsById.set(inst.id, inst);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const bodyInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopBody.instructions) if ("id" in inst) bodyInstructionsById.set(inst.id, inst);
  const exitInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopExit.instructions) if ("id" in inst) exitInstructionsById.set(inst.id, inst);

  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'return' terminator on loop_exit" });
  }

  // CRITICAL FIX (per issues/CRITICAL-array-reallocated-every-loop-iteration.md):
  // ONE shared Set across entry/loop_body/loop_exit — see the identical
  // fix and reasoning in encodeIfElseMergeFunctionBody() above.
  const allocatedArraySlots = new Set<number>();
  // Struct Phase 2: the SAME shared-Set fix, for the SAME reason.
  const allocatedStructSlots = new Set<number>();

  const contextStack = new EmitContextStack();
  contextStack.push({ kind: "loop" });
  const exitDepth = contextStack.breakDepth(); // the loop's own exit-check IS mathematically break's own target (the outer block) - same real formula, zero if-nesting
  const continueDepth = contextStack.continueDepth(); // the loop's own natural continuation IS mathematically continue's own target (the loop itself)
  contextStack.pop();

  return concatBytes(
    encodeStatements(entry, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    OPCODE_BLOCK, BLOCKTYPE_VOID,
    OPCODE_LOOP, BLOCKTYPE_VOID,
    encodeExpr(headerTerminator.condition.id, headerInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
    OPCODE_I32_EQZ,
    OPCODE_BR_IF, encodeULEB128(exitDepth),
    encodeStatements(loopBody, bodyInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    OPCODE_BR, encodeULEB128(continueDepth),
    OPCODE_END, // end loop
    OPCODE_END, // end block
    encodeStatements(loopExit, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, allocatedArraySlots, structBaseLocalIndexBySlotId, allocatedStructSlots),
    encodeExpr(loopExit.terminator.value.id, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
    OPCODE_RETURN,
  );
}

/**
 * Encodes the `while` + `break` CFG shape (Invariant 3.1A.6b):
 * `entry`'s statements, then `block $exit { loop $continue { br_if
 * $exit (i32.eqz <loop condition>); <loop_body's own statements up to
 * the break check>; if (<break condition>) { br 2 } (no else — the
 * false path falls through naturally, matching how a bare 'if...end'
 * with no else lowers to an empty else block in the IR); <merge's
 * statements>; br $continue } }`, then `loop_exit`'s statements and
 * `return`. `br 2` (not `br 1`) is required specifically because,
 * from inside the nested `if`'s `then` branch, there are now THREE
 * enclosing constructs to count outward through: the `if` itself
 * (depth 0), the `loop` (depth 1), and the `block` (depth 2) —
 * confirmed correct by direct hand-built-module testing
 * (`main() = 3`, matching exactly where `break` fires) before this
 * encoder was written.
 */
function encodeWhileBreakFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number>): Uint8Array {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on entry" });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target)!;
  if (loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator on loop_header" });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget)!;
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget)!;
  if (loopBody.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator on loop_body" });
  }
  const bodyTerminator = loopBody.terminator;
  const elseBlock = fn.blocks.find(b => b.id === bodyTerminator.elseTarget)!;
  if (elseBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on else" });
  }
  const elseTerminator = elseBlock.terminator;
  const mergeBlock = fn.blocks.find(b => b.id === elseTerminator.target)!;
  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'return' terminator on loop_exit" });
  }

  const entryInstructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) entryInstructionsById.set(inst.id, inst);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const bodyInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopBody.instructions) if ("id" in inst) bodyInstructionsById.set(inst.id, inst);
  const mergeInstructionsById = new Map<number, IRInstruction>();
  for (const inst of mergeBlock.instructions) if ("id" in inst) mergeInstructionsById.set(inst.id, inst);
  const exitInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopExit.instructions) if ("id" in inst) exitInstructionsById.set(inst.id, inst);

  const contextStack = new EmitContextStack();
  contextStack.push({ kind: "loop" });
  const loopExitDepth = contextStack.breakDepth(); // the loop's own exit-check target
  const loopContinueDepth = contextStack.continueDepth(); // the loop's own natural continuation target
  contextStack.push({ kind: "if" });
  const breakDepth = contextStack.breakDepth(); // real break's own target - one if-context deep
  contextStack.pop(); // pop the if - real LIFO, matching its own OPCODE_END below
  contextStack.pop(); // pop the loop

  return concatBytes(
    encodeStatements(entry, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_BLOCK, BLOCKTYPE_VOID,
    OPCODE_LOOP, BLOCKTYPE_VOID,
    encodeExpr(headerTerminator.condition.id, headerInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_I32_EQZ,
    OPCODE_BR_IF, encodeULEB128(loopExitDepth),
    encodeStatements(loopBody, bodyInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    encodeExpr(bodyTerminator.condition.id, bodyInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_IF, BLOCKTYPE_VOID,
    OPCODE_BR, encodeULEB128(breakDepth),
    OPCODE_END, // end if (no else — the false path falls through to the merge statements below)
    encodeStatements(mergeBlock, mergeInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_BR, encodeULEB128(loopContinueDepth),
    OPCODE_END, // end loop
    OPCODE_END, // end block
    encodeStatements(loopExit, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    encodeExpr(loopExit.terminator.value.id, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_RETURN,
  );
}

/**
 * Encodes the `while` + `continue` CFG shape (Invariant 3.1A.6c),
 * mirroring `encodeWhileBreakFunctionBody` with exactly one
 * difference: `continue` branches to `$continue` (the `loop` itself,
 * depth 1 from inside the nested `if`: `if`=0, `loop`=1) via `br 1`,
 * NOT `br 2` (`break`'s target, the outer `block`). Confirmed correct
 * by direct hand-built-module testing before this encoder was written
 * — `br 1` produces `50` (matching the C Backend exactly) for `while
 * i<10 { i=i+1; if i==5 { continue }; total=total+i }`; the wrong
 * depth (`br 2`) was also directly tested and found to still produce
 * a syntactically VALID module, but with the silently wrong result
 * `10` (behaving like `break` instead) — exactly mirroring `break`'s
 * own `br 2`-vs-`br 1` finding, confirming the Golden Test for this
 * shape must specifically catch a behavioral, not merely structural,
 * regression.
 */
function encodeWhileContinueFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>, localIndexBySlotId: ReadonlyMap<number, number>): Uint8Array {
  const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
  if (entry.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on entry" });
  }
  const entryTerminator = entry.terminator;
  const loopHeader = fn.blocks.find(b => b.id === entryTerminator.target)!;
  if (loopHeader.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator on loop_header" });
  }
  const headerTerminator = loopHeader.terminator;
  const loopBody = fn.blocks.find(b => b.id === headerTerminator.thenTarget)!;
  const loopExit = fn.blocks.find(b => b.id === headerTerminator.elseTarget)!;
  if (loopBody.terminator.kind !== "cond_branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'cond_branch' terminator on loop_body" });
  }
  const bodyTerminator = loopBody.terminator;
  const elseBlock = fn.blocks.find(b => b.id === bodyTerminator.elseTarget)!;
  if (elseBlock.terminator.kind !== "branch") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'branch' terminator on else" });
  }
  const elseTerminator = elseBlock.terminator;
  const mergeBlock = fn.blocks.find(b => b.id === elseTerminator.target)!;
  if (loopExit.terminator.kind !== "return") {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: expected a validated 'return' terminator on loop_exit" });
  }

  const entryInstructionsById = new Map<number, IRInstruction>();
  for (const inst of entry.instructions) if ("id" in inst) entryInstructionsById.set(inst.id, inst);
  const headerInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopHeader.instructions) if ("id" in inst) headerInstructionsById.set(inst.id, inst);
  const bodyInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopBody.instructions) if ("id" in inst) bodyInstructionsById.set(inst.id, inst);
  const mergeInstructionsById = new Map<number, IRInstruction>();
  for (const inst of mergeBlock.instructions) if ("id" in inst) mergeInstructionsById.set(inst.id, inst);
  const exitInstructionsById = new Map<number, IRInstruction>();
  for (const inst of loopExit.instructions) if ("id" in inst) exitInstructionsById.set(inst.id, inst);

  const contextStack = new EmitContextStack();
  contextStack.push({ kind: "loop" });
  const loopExitDepth = contextStack.breakDepth();
  const loopContinueDepth = contextStack.continueDepth();
  contextStack.push({ kind: "if" });
  const continueDepth = contextStack.continueDepth(); // real continue's own target - one if-context deep, NOT break's target (the block)
  contextStack.pop();
  contextStack.pop();

  return concatBytes(
    encodeStatements(entry, entryInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_BLOCK, BLOCKTYPE_VOID,
    OPCODE_LOOP, BLOCKTYPE_VOID,
    encodeExpr(headerTerminator.condition.id, headerInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_I32_EQZ,
    OPCODE_BR_IF, encodeULEB128(loopExitDepth),
    encodeStatements(loopBody, bodyInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    encodeExpr(bodyTerminator.condition.id, bodyInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_IF, BLOCKTYPE_VOID,
    OPCODE_BR, encodeULEB128(continueDepth),
    OPCODE_END, // end if (no else — the false path falls through to the merge statements below)
    encodeStatements(mergeBlock, mergeInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_BR, encodeULEB128(loopContinueDepth),
    OPCODE_END, // end loop
    OPCODE_END, // end block
    encodeStatements(loopExit, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    encodeExpr(loopExit.terminator.value.id, exitInstructionsById, functionIndexByName, fn, localIndexBySlotId),
    OPCODE_RETURN,
  );
}

const VALTYPE_I32 = 0x7f;

function encodeFunctionBody(fn: IRFunction, functionIndexByName: ReadonlyMap<string, number>): Uint8Array {
  // Function parameter support (per WASM_FUNCTION_PARAMETERS_DESIGN.md
  // §3.3/Q3): a WASM function parameter IS a WASM local, occupying
  // indices 0..paramCount-1 by the format's own native convention —
  // every OTHER local category (scalar/array/struct) must shift to
  // start after them. Per Q3's own real, favorable structural
  // finding, this is the ONE, direct edit needed — array/struct base
  // indices are already computed relative to i64LocalCount, not as
  // independent absolute numbers, so they shift correctly without
  // any edit to their own formulas.
  const paramCount = fn.params.length;
  // V29-D2 (Implementation Gate, fix B): an isArrayParam slot must NOT
  // be counted among scalarSlots (it needs no new "declared local" -
  // its own value already occupies its own WASM parameter index, per
  // v29-D2-RD §2/§3's own direct finding) - excluded here explicitly,
  // not merely left to isArray's own existing exclusion (isArrayParam
  // and isArray are different flags; isArray !== true alone does NOT
  // exclude an isArrayParam slot).
  const scalarSlots = fn.locals.filter(l => l.isArray !== true && l.isArrayParam !== true && l.type !== "string");
  const arraySlots = fn.locals.filter(l => l.isArray === true);
  const localIndexBySlotId = new Map(scalarSlots.map((l, i) => [l.id, paramCount + i] as const));
  // FIX (per issues/triple-evaluation-of-array-index-expression.md): one
  // shared i64 scratch local, only allocated when arrays exist, used by
  // encodeExpr()/encodeStatements() (see getIndexScratchLocalIndex() below,
  // which recomputes this SAME index from fn.locals directly at the point
  // of use — no new parameter threading needed through every intermediate
  // encoder function) to materialize an array index's VALUE exactly once.
  // Kept at its own original position (immediately after scalars) so
  // getIndexScratchLocalIndex()'s own independent computation is
  // unaffected by the NEW materialized-SSA scratch block added below it.
  //
  // V29-D2: an array-typed PARAMETER also indexes via array_load/
  // array_store (arr[i]) and needs this same scratch local - included
  // here via isArrayParam, not just arraySlots.length (which only
  // counts freshly-allocated literal-array locals, per fix B's own
  // design: a parameter needs no NEW base-address local, but DOES
  // still need the shared index-materialization scratch).
  const hasAnyArrayAccess = arraySlots.length > 0 || fn.locals.some(l => l.isArrayParam === true);
  const arrayIndexScratchCount = hasAnyArrayAccess ? 1 : 0;
  // FIX (per issues/wasm-loop-local-let-affecting-outer-state.md,
  // PATCH_DESIGN_WASM_SSA.md, Stage 4): one dedicated scratch local per
  // i64-typed "leaf" SSA instruction (const/load/binop) that appears as
  // a top-level entry in any block's own instructions — materialized
  // exactly once, at its own position in the instruction stream, so a
  // later `store` referencing it (even after an intervening store to
  // one of its own dependencies) reads the materialized value, not a
  // lazily-re-derived one. Placed AFTER the array-index scratch (not
  // before it) so getIndexScratchLocalIndex()'s own, separately-computed
  // index is unaffected by this new block's size. Count recomputed via
  // getMaterializedIds() (matching this file's own established
  // self-recomputation convention) rather than duplicated inline.
  //
  // V2-MU: getMaterializedIds() now also returns string- and
  // f64-range materialized ids (see STRING_MATERIALIZED_BASE/
  // F64_MATERIALIZED_BASE) - .size alone would incorrectly count
  // those toward the i64 group's own declared size (they get their
  // own, separate i32/f64 groups below). Filtered to i64-range only,
  // matching resolveMaterializedLocalIndex()'s own identical filter
  // exactly - this MUST stay in sync with that function.
  const materializedScratchCount = [...getMaterializedIds(fn).values()].filter(v => v < STRING_MATERIALIZED_BASE).length;
  const i64LocalCount = paramCount + scalarSlots.length + arrayIndexScratchCount + materializedScratchCount;
  const arrayBaseLocalIndexBySlotId = new Map(arraySlots.map((l, i) => [l.id, i64LocalCount + i] as const));
  // V29-D2 (fix B/§3): an array-typed PARAMETER's own base address is
  // its own already-existing WASM parameter local - NOT a new entry
  // in the same freshly-bump-allocated pool `arraySlots` above feeds.
  // Its own WASM local index equals its own POSITION in fn.params
  // (matching WASM's native parameter-local convention) - found by
  // NAME, not by slot id (v29-D2-RD's own direct, empirical finding:
  // slot ids and parameter positions are different numbering schemes
  // entirely; fn.locals has no entry at all for scalar parameters,
  // so slot id 0 does not generally mean "parameter 0").
  for (const local of fn.locals) {
    if (local.isArrayParam !== true) continue;
    const paramIndex = fn.params.findIndex(p => p.name === local.name);
    if (paramIndex === -1) {
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: array-param local '${local.name}' (slot ${local.id}) has no matching entry in fn.params` });
    }
    arrayBaseLocalIndexBySlotId.set(local.id, paramIndex);
  }
  // Struct support, Phase 1 (per WASM_BUMP_ALLOCATOR_STUDY.md §4, point
  // 2): one i32 WASM local per struct slot, indices continuing right
  // after arrays' own indices - the exact same treatment
  // arrayBaseLocalIndexBySlotId already gets, mirrored precisely.
  const structSlots = fn.locals.filter(l => l.structLayout !== undefined);
  const structBaseLocalIndexBySlotId = new Map(structSlots.map((l, i) => [l.id, i64LocalCount + arraySlots.length + i] as const));
  // V2-M2 (Design approved, narrow scope): one i32 WASM local per
  // string-typed slot, indices continuing right after structs' own -
  // the exact same treatment arrayBaseLocalIndexBySlotId/
  // structBaseLocalIndexBySlotId already get, mirrored precisely (a
  // string is a linear-memory offset, same native width as an array
  // base or struct base). Merged directly into localIndexBySlotId
  // (not a new, separate map) since the existing "load"/"store" IR
  // instruction encoders already consult exactly that one map by
  // slot id, and are value-type-agnostic at the WASM bytecode level
  // (local.get/local.set reference an index; the declared valtype at
  // that index is what's declared below - correct because
  // localIndexBySlotId now points string slots at real, declared i32
  // locals) - no change needed to the load/store encoders themselves.
  const stringSlots = fn.locals.filter(l => l.type === "string" && l.isArray !== true);
  const stringLocalBase = i64LocalCount + arraySlots.length + structSlots.length;
  stringSlots.forEach((l, i) => localIndexBySlotId.set(l.id, stringLocalBase + i));
  // V2-M2: a multi-use string-typed call result (e.g. `let s = input();
  // print(s); free(s)`) needs its own materialized i32 scratch local,
  // positioned after strings' own group - see getMaterializedIds()'s
  // own comment for why this can't share the i64 materialization
  // group above.
  const stringMaterializedCount = [...getMaterializedIds(fn).values()].filter(v => v >= STRING_MATERIALIZED_BASE && v < F64_MATERIALIZED_BASE).length;
  // v29-D4 (Nested Array Model): ONE dedicated i32 scratch local,
  // allocated whenever the function contains at least one baseRef-
  // driven array_load/array_store. Required because a baseRef's own
  // expression, when re-emitted inline (the ONLY option before this
  // fix — array_load's own result was never eligible for the general
  // fan-out/materialization mechanism above, which counts IR-level
  // references, not how many times ONE consuming instruction's own
  // emission logic internally reuses a value), is itself side-
  // effecting (it writes the SHARED index-scratch local as part of
  // its own bounds check) — using it twice (once for the runtime
  // length read, once for the element address) corrupted a
  // SUBSEQUENT nested index's own value. Confirmed directly: a[0][1]
  // and a[1][0] returned the wrong inner element before this fix —
  // exactly the "multiple evaluation" class of bug this project's
  // own history already fixed once, for a different case (see
  // issues/triple-evaluation-of-array-index-expression.md). This
  // scratch is computed ONCE per baseRef access, then read via a
  // cheap local.get for every subsequent use — mirroring the exact
  // same pattern the existing index scratch already uses, just for
  // the base address instead of the index.
  const hasBaseRefAccess = fn.blocks.some(b => b.instructions.some(i => (i.kind === "array_load" || i.kind === "array_store") && i.baseRef !== undefined));
  const baseRefScratchCount = hasBaseRefAccess ? 1 : 0;
  // V2-MU: a multi-use f64 value (const/load/binop/unop/call) needs
  // its own materialized f64 scratch local, positioned after every
  // i32 group - see getMaterializedIds()'s own comment.
  const f64MaterializedCount = [...getMaterializedIds(fn).values()].filter(v => v >= F64_MATERIALIZED_BASE).length;

  const localGroups: Uint8Array[] = [];
  const declaredI64LocalCount = i64LocalCount - paramCount;
  if (declaredI64LocalCount > 0) localGroups.push(new Uint8Array([...encodeULEB128(declaredI64LocalCount), VALTYPE_I64]));
  if (arraySlots.length > 0) localGroups.push(new Uint8Array([...encodeULEB128(arraySlots.length), VALTYPE_I32]));
  if (structSlots.length > 0) localGroups.push(new Uint8Array([...encodeULEB128(structSlots.length), VALTYPE_I32]));
  if (stringSlots.length > 0) localGroups.push(new Uint8Array([...encodeULEB128(stringSlots.length), VALTYPE_I32]));
  if (stringMaterializedCount > 0) localGroups.push(new Uint8Array([...encodeULEB128(stringMaterializedCount), VALTYPE_I32]));
  if (baseRefScratchCount > 0) localGroups.push(new Uint8Array([...encodeULEB128(baseRefScratchCount), VALTYPE_I32]));
  if (f64MaterializedCount > 0) localGroups.push(new Uint8Array([...encodeULEB128(f64MaterializedCount), VALTYPE_F64]));
  const localsVec = encodeVector(localGroups);

  const bumpGlobalIndex = 0; // the sole WASM Global (Level 3.1B.1) is always index 0 when present.

  let bodyExpr: Uint8Array;
  if (fn.blocks.length === 1) {
    bodyExpr = encodeReturnBlockBody(fn.blocks[0]!, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId);
  } else if (fn.blocks.length === 3) {
    bodyExpr = encodeIfElseFunctionBody(fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId);
  } else if (fn.blocks.length === 7) {
    // break (3.1A.6b) vs. continue (3.1A.6c) vs. nested if (Layer 2,
    // per WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md): same
    // structural distinction as validateScope(). A 7-block function
    // that is NOT a real while-break/continue shape (classifySevenBlockShape
    // returns undefined) may still be a genuine, valid nested-if
    // structure (Layer 1's own isNestedIfStructureValid) - this is
    // additive only: every existing break/continue path is completely
    // unchanged.
    const shape = classifySevenBlockShape(fn);
    if (shape === "continue") {
      bodyExpr = encodeWhileContinueFunctionBody(fn, functionIndexByName, localIndexBySlotId);
    } else if (shape === "break") {
      bodyExpr = encodeWhileBreakFunctionBody(fn, functionIndexByName, localIndexBySlotId);
    } else if (isNestedIfStructureValid(fn)) {
      const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
      bodyExpr = concatBytes(
        encodeReturnBlockBody(entry, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
        // Unreachable fallback, matching encodeIfElseFunctionBody's
        // own established pattern - required only for WASM's type-
        // checking of the function's own final expression; every
        // real path already returned via a real, explicit OPCODE_RETURN.
        OPCODE_I64_CONST, encodeSLEB128(0n),
        OPCODE_RETURN,
      );
    } else {
      // Unreachable given validateScope() already ran - defensive only.
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: 7-block shape passed validateScope() but matched neither break/continue nor a valid nested-if structure" });
    }
  } else {
    // Merge (3.1A.5) vs. while (3.1A.6) vs. nested if (Layer 2): same
    // structural distinction as validateScope(). Real, safe fallback
    // order: try the two existing, established shapes first (exactly
    // as before, unchanged); only fall back to nested-if handling if
    // neither real shape matches - matching classifyTopLevelShape's
    // own real structural checks (not merely entry.terminator.kind
    // alone, which could misclassify a genuine nested-if entry that
    // happens to also start with cond_branch).
    const entry = fn.blocks.find(b => b.id === fn.entryBlock)!;
    const shape = classifyTopLevelShape(fn);
    if (shape.kind === "if-else-merge") {
      bodyExpr = encodeIfElseMergeFunctionBody(fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId);
    } else if (shape.kind === "while-basic") {
      bodyExpr = encodeWhileFunctionBody(fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId);
    } else if (isNestedIfStructureValid(fn)) {
      bodyExpr = concatBytes(
        encodeReturnBlockBody(entry, fn, functionIndexByName, localIndexBySlotId, arrayBaseLocalIndexBySlotId, bumpGlobalIndex, structBaseLocalIndexBySlotId),
        OPCODE_I64_CONST, encodeSLEB128(0n),
        OPCODE_RETURN,
      );
    } else {
      // Unreachable given validateScope() already ran - defensive only.
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_CFG_SHAPE, functionName: fn.sourceName, message: "internal error: CFG shape passed validateScope() but matched neither merge, while, nor a valid nested-if structure" });
    }
  }
  const body = concatBytes(localsVec, bodyExpr, OPCODE_END);
  return withLength(body);
}

/** Recomputes the shared index-materialization scratch local's WASM local index (see the FIX note in encodeFunctionBody()) directly from fn.locals — matching that same computation exactly, without needing to thread it as a new parameter through every intermediate encoder function. Returns -1 if fn has no array-typed slots (meaning no array access exists, so this scratch local was never allocated). */
function getIndexScratchLocalIndex(fn: IRFunction): number {
  // V29-D2: kept in sync with encodeFunctionBody()'s own scalarSlots/
  // hasAnyArrayAccess exclusions above (isArrayParam excluded from the
  // scalar count, included in the array-access check) - the pre-
  // existing lack of a `l.type !== "string"` filter here, unlike
  // scalarSlots's own, is untouched, unrelated pre-existing behavior,
  // not something this narrow change addresses.
  //
  // A second, previously-latent gap, now surfaced and fixed: this
  // formula never added fn.params.length (paramCount) - harmless
  // before, since every prior function had paramCount === 0 (no
  // support for real parameters existed), but a real, visible bug
  // once a function genuinely has parameters (confirmed directly:
  // WebAssembly.instantiate failed with "local.set[0] expected type
  // i32, found i64" - the scratch index was colliding with parameter
  // local 0 itself, since scalarCount alone (0, correctly excluding
  // the one isArrayParam local) was used as the index with no
  // paramCount offset added). Matches encodeFunctionBody()'s own
  // i64LocalCount, which already correctly includes paramCount.
  const scalarCount = fn.locals.filter(l => l.isArray !== true && l.isArrayParam !== true).length;
  const hasAnyArrayAccess = fn.locals.some(l => l.isArray === true || l.isArrayParam === true);
  return hasAnyArrayAccess ? fn.params.length + scalarCount : -1;
}

/** Recomputes the materialized-SSA-value scratch-local map (see the FIX note in encodeFunctionBody(), issues/wasm-loop-local-let-affecting-outer-state.md) directly from fn — matching that same computation exactly, without needing to thread it as a new parameter through every intermediate encoder function (same convention as getIndexScratchLocalIndex() above).
 *
 * BUGFIX (found during Stage 4's own direct verification, before this
 * fix was considered complete): only scans blocks that
 * encodeStatements() actually processes — identified as any block
 * containing at least one `store`/`array_store` instruction.
 * Condition-only blocks (e.g. a `while` loop's own condition-check
 * block, which has no `store` and is encoded by a separate,
 * dedicated function, never by encodeStatements) must be excluded:
 * materializing their instructions here would register a scratch
 * local that is never actually written by anyone, so any later
 * `encodeExpr` reference to it would read WASM's own default-zero
 * for an unwritten local instead of the real computed value —
 * confirmed directly: this exact bug caused the loop condition
 * `i < 2` to read 0 for both operands, making the loop exit
 * immediately, before this exclusion was added. */
function getMaterializedIds(fn: IRFunction): ReadonlyMap<number, number> {
  // V29-D2: kept in sync with encodeFunctionBody()'s own exclusions,
  // and with the same missing-paramCount fix applied to
  // getIndexScratchLocalIndex() above (this "next" value continues
  // directly from that function's own scratch-index position).
  const scalarCount = fn.locals.filter(l => l.isArray !== true && l.isArrayParam !== true && l.type !== "string").length;
  const arrayIndexScratchCount = fn.locals.some(l => l.isArray === true || l.isArrayParam === true) ? 1 : 0;
  const materializedIds = new Map<number, number>();
  let next = fn.params.length + scalarCount + arrayIndexScratchCount;
  const arraySlotCount = fn.locals.filter(l => l.isArray === true).length;
  const structSlotCount = fn.locals.filter(l => l.structLayout !== undefined).length;
  const stringSlotCount = fn.locals.filter(l => l.type === "string" && l.isArray !== true).length;
  let nextStringMaterialized = arraySlotCount + structSlotCount + stringSlotCount;
  // V2-MU (Gate authorized, narrow scope): a SEPARATE f64 scratch
  // group for materialized float values - parallel to, but never
  // shared with, the i64 group above (a materialized value's scratch
  // local must match its own WASM value type, mirroring the exact
  // reasoning that already motivated the string/i32 group in V2-M2).
  let nextF64Materialized = 0;
  for (const block of fn.blocks) {
    const hasStatements = block.instructions.some(inst => inst.kind === "store" || inst.kind === "array_store");
    for (const inst of block.instructions) {
      // V2-MU: the general multi-use trigger, independent of
      // hasStatements - fulfils WASM_BACKEND_SPEC.md §2.1's own
      // documented "TEMPORARY PHASE CONSTRAINT... must be relaxed"
      // note and the Migration Test already sitting in
      // emit-wasm.test.ts. A "param" instruction is deliberately
      // EXCLUDED here - it already has a real, backing WASM local
      // (its own parameter index) and needs no scratch local at all;
      // its own fan-out is instead exempted directly in
      // checkExpressionTreeProperty (wasm-cfg-validation.ts), not
      // handled by materialization.
      // B-1 Gate (type-only): store/array_store/field_store produce no
      // SSA value and have no `id` (IRInstruction, ir.ts). For them every
      // condition below was already false (each eligibility test requires
      // a value-producing kind, and the map only ever holds ids of such
      // kinds), so skipping them here is behaviour-identical.
      if (!instructionHasResultId(inst)) continue;
      const fanOut = countReferencesWithinBlock(inst.id, block);
      if (inst.kind === "const" && inst.value.kind === "const_string") {
  materializedIds.set(
    inst.id,
    STRING_MATERIALIZED_BASE + nextStringMaterialized,
  );
  nextStringMaterialized++;
  continue;
}
      const isMultiUseEligible = fanOut > 1
        && (inst.kind === "const" || inst.kind === "load" || inst.kind === "binop" || inst.kind === "unop" || inst.kind === "int_to_float" || inst.kind === "call" || inst.kind === "array_load")
        && (inst.type === "i64" || inst.type === "f64" || inst.type === "string" || inst.type === "array_ref");
      // V2-M2's own original rule (hasStatements-gated, i64-only
      // const/load/binop) is preserved exactly, as its own separate
      // condition - not merged into one combined boolean - so each
      // trigger's own correctness reasoning stays independently
      // auditable, per explicit instruction.
      const isStaleReadProtectionEligible = hasStatements
        && (inst.kind === "const" || inst.kind === "load" || inst.kind === "binop")
        && inst.type === "i64";
      if (materializedIds.has(inst.id)) continue; // already materialized by an earlier-checked rule for this same id
      if (isStaleReadProtectionEligible || (isMultiUseEligible && inst.type === "i64")) {
        materializedIds.set(inst.id, next);
        next++;
      } else if (isMultiUseEligible && inst.type === "f64") {
        materializedIds.set(inst.id, F64_MATERIALIZED_BASE + nextF64Materialized);
        nextF64Materialized++;
      } else if (isMultiUseEligible && inst.type === "string") {
        materializedIds.set(inst.id, STRING_MATERIALIZED_BASE + nextStringMaterialized);
        nextStringMaterialized++;
      } else if (isMultiUseEligible && inst.type === "array_ref") {
        // v29-D4: array_ref shares the SAME i32-typed materialized-
        // local group strings already use (confirmed directly: that
        // group is declared VALTYPE_I32, exactly matching array_ref's
        // own width) — not a new group. Required because a baseRef-
        // driven array_load's own result is now genuinely consumed
        // multiple times (the runtime length read AND the element
        // read both need it) — without this, each use re-emits the
        // ENTIRE outer load's own bytecode inline, including its own
        // side-effecting scratch-index write, corrupting a SUBSEQUENT
        // nested index's own value (confirmed directly: a[0][1] and
        // a[1][0] returned the WRONG inner element before this fix,
        // exactly the "multiple evaluation" class of bug this
        // project's own history already fixed once for a different
        // case — see issues/triple-evaluation-of-array-index-
        // expression.md for that earlier, analogous fix).
        materializedIds.set(inst.id, STRING_MATERIALIZED_BASE + nextStringMaterialized);
        nextStringMaterialized++;
      }
    }
  }
  return materializedIds;
}

/** Marker offset separating the i64-typed materialized-scratch index
 *  space (small, non-negative integers, positioned within the i64
 *  local group) from the i32-typed string-materialized-scratch index
 *  space (V2-M2) - large enough that no real function will ever have
 *  this many i64 locals, matching this file's own existing convention
 *  of a single flat Map with unambiguous, cheaply-distinguishable
 *  ranges rather than two separate Maps threaded through every call
 *  site. */
const STRING_MATERIALIZED_BASE = 1_000_000;

/** V2-MU: a third, non-overlapping numeric range for f64-typed
 *  materialized-scratch indices, mirroring STRING_MATERIALIZED_BASE's
 *  own convention exactly (a single flat Map, unambiguous ranges,
 *  translated back to a real absolute WASM local index only inside
 *  resolveMaterializedLocalIndex()). */
const F64_MATERIALIZED_BASE = 2_000_000;

/** Given a raw value from getMaterializedIds() for this function `fn`,
 *  returns the REAL, absolute WASM local index for that materialized
 *  value - whether it's an i64 scratch (already absolute, per the
 *  existing convention), a V2-M2 string scratch, or a V2-MU f64
 *  scratch (both relative to i64LocalCount, matching arrays/structs/
 *  strings' own established "i64LocalCount + offset" pattern exactly).
 *  Recomputes i64LocalCount directly from `fn` (matching this file's
 *  own established self-recomputation convention, e.g.
 *  getIndexScratchLocalIndex() below) - no new parameter threaded
 *  through every encodeExpr/encodeStatements call site. */
function resolveMaterializedLocalIndex(rawValue: number, fn: IRFunction): number {
  if (rawValue < STRING_MATERIALIZED_BASE) return rawValue;
  const paramCount = fn.params.length;
  // V29-D2: kept in sync with encodeFunctionBody()'s own exclusions.
  const scalarCount = fn.locals.filter(l => l.isArray !== true && l.isArrayParam !== true && l.type !== "string").length;
  const arrayIndexScratchCount = fn.locals.some(l => l.isArray === true || l.isArrayParam === true) ? 1 : 0;
  const allMaterialized = [...getMaterializedIds(fn).values()];
  const i64MaterializedCount = allMaterialized.filter(v => v < STRING_MATERIALIZED_BASE).length;
  const i64LocalCount = paramCount + scalarCount + arrayIndexScratchCount + i64MaterializedCount;
  const arraySlotCount = fn.locals.filter(l => l.isArray === true).length;
  const structSlotCount = fn.locals.filter(l => l.structLayout !== undefined).length;
  const stringSlotCount = fn.locals.filter(l => l.type === "string" && l.isArray !== true).length;
  const stringMaterializedCount = allMaterialized.filter(v => v >= STRING_MATERIALIZED_BASE && v < F64_MATERIALIZED_BASE).length;
  if (rawValue < F64_MATERIALIZED_BASE) {
    return i64LocalCount + (rawValue - STRING_MATERIALIZED_BASE);
  }
  // V2-MU: f64 scratch group positioned after every i32 group
  // (arrays, structs, strings, string-materialized), matching the
  // same sequential-group convention used throughout this file.
  return i64LocalCount + arraySlotCount + structSlotCount + stringSlotCount + stringMaterializedCount + (rawValue - F64_MATERIALIZED_BASE);
}

// v29-D4 (Nested Array Model): the i32 base-address scratch local's own
// position — kept in sync with encodeFunctionBody()'s own declaration
// order above (positioned immediately after the string-materialized
// group, immediately before the f64-materialized group) via the SAME
// independent-recomputation pattern getIndexScratchLocalIndex/
// resolveMaterializedLocalIndex already use, rather than threading a
// new parameter through every intermediate encoder function. Returns
// -1 if fn has no baseRef-driven array access at all (this scratch was
// never allocated).
function getBaseRefScratchLocalIndex(fn: IRFunction): number {
  const paramCount = fn.params.length;
  const scalarCount = fn.locals.filter(l => l.isArray !== true && l.isArrayParam !== true && l.type !== "string").length;
  const arrayIndexScratchCount = fn.locals.some(l => l.isArray === true || l.isArrayParam === true) ? 1 : 0;
  const allMaterialized = [...getMaterializedIds(fn).values()];
  const i64MaterializedCount = allMaterialized.filter(v => v < STRING_MATERIALIZED_BASE).length;
  const i64LocalCount = paramCount + scalarCount + arrayIndexScratchCount + i64MaterializedCount;
  const arraySlotCount = fn.locals.filter(l => l.isArray === true).length;
  const structSlotCount = fn.locals.filter(l => l.structLayout !== undefined).length;
  const stringSlotCount = fn.locals.filter(l => l.type === "string" && l.isArray !== true).length;
  const stringMaterializedCount = allMaterialized.filter(v => v >= STRING_MATERIALIZED_BASE && v < F64_MATERIALIZED_BASE).length;
  const hasBaseRefAccess = fn.blocks.some(b => b.instructions.some(i => (i.kind === "array_load" || i.kind === "array_store") && i.baseRef !== undefined));
  if (!hasBaseRefAccess) return -1;
  return i64LocalCount + arraySlotCount + structSlotCount + stringSlotCount + stringMaterializedCount;
}

function encodeCodeSection(functions: readonly IRFunction[], functionIndexByName: ReadonlyMap<string, number>): Uint8Array {
  const bodies = functions.map(fn => encodeFunctionBody(fn, functionIndexByName));
  return concatBytes(SECTION_CODE, withLength(encodeVector(bodies)));
}

/**
 * Emits a complete, valid WASM binary module for an entire IRModule,
 * strictly within the current sub-phase's scope (WASM_BACKEND_SPEC.md §0).
 * Throws WasmUnsupportedError for anything outside that scope — never
 * emits a partial or best-effort module. Supports multiple functions
 * with direct, non-recursive, zero-argument intra-module calls
 * (3.1A.3) — recursion (direct or mutual) is explicitly rejected, per
 * review, rather than silently accepted.
 */
export function emitWasmModule(module: IRModule): Uint8Array {
  // P1-3C: usedImports is computed BEFORE validation runs, so that
  // knownFunctionNames (below) can be widened to also accept calls to
  // these specific, already-vetted externs - the only change needed in
  // wasm-cfg-validation.ts's entire call chain is this Set's content at
  // its construction point; every validator function it's threaded
  // through is completely unmodified.
  const usedImports = findUsedWasmImports(module);
  const knownFunctionNames = new Set([...module.functions.map(f => f.qualifiedName), ...usedImports.map(e => e.name)]);
  for (const fn of module.functions) validateScope(fn, knownFunctionNames);
  detectRecursion(module.functions);

  const { importTypeEntries, importFunctionIndex } = buildImportTypesAndIndex(usedImports);
  const { typeEntries: localTypeEntries, functionTypeIndex: localFunctionTypeIndex } = buildFunctionTypes(module.functions);
  // Local function TYPE indices (from buildFunctionTypes, which numbers
  // them from 0 within its own local-only list) must be shifted by the
  // import type count too, since importTypeEntries are prepended before
  // localTypeEntries in the single, flat Type section below - otherwise
  // encodeFunctionSection would reference the wrong type entry for every
  // local function whenever imports are present.
  const functionTypeIndex = new Map([...localFunctionTypeIndex].map(([name, idx]) => [name, idx + importTypeEntries.length] as const));
  // WASM function index space: imports occupy indices [0, N) first, per
  // the WASM spec's own ordering rule; every local function's index is
  // shifted by the import count N (previously always 0 - unchanged for
  // any module with zero imports, keeping every existing 3.1A/3.1B
  // module's encoding byte-for-byte identical to before this Gate).
  const functionIndexByName = new Map<string, number>([
    ...importFunctionIndex,
    ...module.functions.map((f, i) => [f.qualifiedName, i + usedImports.length] as const),
  ]);
  const typeEntries = [...importTypeEntries, ...localTypeEntries];
  // V29-D2: a module with an array parameter (but, hypothetically, no
  // literal array anywhere) still needs the Memory section — its own
  // array_load/store instructions read/write linear memory regardless
  // of whether the bump-allocator Global is ever exercised. Included
  // here defensively; every realistic program reaching this path
  // already has a literal array somewhere too (a caller must have
  // constructed the array being passed), but this must not rely on
  // that as an unstated assumption.
  const hasArrays = module.functions.some(fn => fn.locals.some(l => l.isArray === true || l.isArrayParam === true));
  const hasStructs = module.functions.some(fn => fn.locals.some(l => l.structLayout !== undefined));
  // V2-M2: a string-typed local (or a string-returning/accepting used
  // import) lives in this module's own linear memory too - needs the
  // same Memory(5)/Global(6) sections arrays/structs already require.
  const hasStrings = module.functions.some(fn => fn.locals.some(l => l.type === "string" && l.isArray !== true))
    || usedImports.some(e => e.parameterTypes.includes("string") || e.returnType === "string");
  const needsMemory = hasArrays || hasStructs || hasStrings;

  const usesStringImport = usedImports.some(e => e.parameterTypes.includes("string") || e.returnType === "string");
  return concatBytes(
    WASM_MAGIC, WASM_VERSION,
    encodeTypeSection(typeEntries),
    // Import(2) - emitted only when at least one call actually resolves
    // to a WASM-importable extern; a module with none produces byte-
    // for-byte the same output as before this Gate (empty section is
    // not emitted at all, matching this file's existing convention for
    // Memory/Global below).
    ...(usedImports.length > 0 ? [encodeImportSection(usedImports, importFunctionIndex)] : []),
    encodeFunctionSection(module.functions, functionTypeIndex),
    // Canonical WASM section order: Memory(5) and Global(6) must appear
    // between Function(3) and Export(7) — Level 3.1B.1, emitted only
    // when at least one function actually declares an array.
    ...(needsMemory ? [encodeMemorySection(), encodeGlobalSection()] : []),
    encodeExportSection(module.functions, needsMemory, usedImports.length, usesStringImport),
    encodeCodeSection(module.functions, functionIndexByName),
  );
}

/** Single-function convenience wrapper, primarily for existing tests/tools that pass one IRFunction directly rather than a full IRModule. */
export function emitWasm(fn: IRFunction, exportName: string = fn.sourceName): Uint8Array {
  const named = exportName === fn.sourceName ? fn : { ...fn, sourceName: exportName };
  return emitWasmModule({ moduleName: "single", externs: [], functions: [named] });
}

/**
 * Emits one instruction's WASM bytecode in post-order (operands before
 * the operator), matching WASM's stack-machine model directly — valid
 * specifically because validateScope() already guarantees every id is
 * used at most once, so no value must be "saved" in a local for later
 * reuse; the stack alone is sufficient.
 */
// FIX (per issues/wasm-loop-local-let-affecting-outer-state.md,
// PATCH_DESIGN_WASM_SSA.md, Stage 4): encodeExpr is now a thin wrapper
// that checks getMaterializedIds(fn) FIRST — if `id` has already been
// materialized into its own dedicated scratch local (by
// encodeStatements' own one-time materialization pass, see below),
// this returns a cheap `local.get` instead of recursively re-deriving
// the value's whole formula from `instructionsById` (the confirmed
// root cause of the bug: re-deriving reads whatever the underlying
// WASM locals hold AT THE CURRENT bytecode position, which is only
// correct if no intervening `store` could have changed them since the
// value's true definition point). encodeExprRaw (below) is the
// original, unconditional computation — encodeStatements calls THAT
// directly, exactly once per materialized id, to perform the actual
// materialization itself (calling the new encodeExpr wrapper there
// instead would incorrectly short-circuit to reading the scratch
// local before it's ever been written).
function encodeExpr(id: number, instructionsById: ReadonlyMap<number, IRInstruction>, functionIndexByName: ReadonlyMap<string, number>, fn: IRFunction, localIndexBySlotId: ReadonlyMap<number, number> = new Map(), arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  const materializedIds = getMaterializedIds(fn);
  const scratchIndex = materializedIds.get(id);
  if (scratchIndex !== undefined) {
    return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(resolveMaterializedLocalIndex(scratchIndex, fn)));
  }
  return encodeExprRaw(id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
}

function encodeExprRaw(id: number, instructionsById: ReadonlyMap<number, IRInstruction>, functionIndexByName: ReadonlyMap<string, number>, fn: IRFunction, localIndexBySlotId: ReadonlyMap<number, number> = new Map(), arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map()): Uint8Array {
  let inst = instructionsById.get(id);
  if (!inst) {
    // FIX (per issues/cross-block-reference-never-reassigned-variable-bug.md):
    // a never-reassigned variable's reference resolves, via Lowering's own
    // environment-rebinding, to a `const` (or other) instruction defined in
    // `entry` — regardless of which block actually reads it. The current
    // block's own instructionsById map only contains ITS OWN instructions,
    // so this id legitimately isn't there; fall back to entry's instructions
    // before concluding it's truly undefined.
    const entry = fn.blocks.find(b => b.id === fn.entryBlock);
    if (entry) {
      for (const entryInst of entry.instructions) {
        if ("id" in entryInst && entryInst.id === id) { inst = entryInst; break; }
      }
    }
  }
  if (!inst) {
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: no definition found for id %${id}` });
  }
  if (inst.kind === "param") {
    // Function parameter support: a param instruction's own `index`
    // field IS the correct WASM local index directly - parameters
    // occupy indices 0..paramCount-1 in declaration order (Step 2),
    // matching lower-to-ir.ts's own param-index assignment exactly.
    return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(inst.index));
  }
  if (inst.kind === "const") {
    // V2-M5 (Gate authorized, narrow scope): const_float now also
    // encoded, alongside the existing const_int. f64.const takes the
    // raw 8-byte IEEE-754 double-precision representation
    // (little-endian, per the WASM binary format spec) - not a
    // variable-length integer encoding like i64.const's own SLEB128.
    if (inst.value.kind === "const_float") {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, inst.value.value, true);
      return concatBytes(OPCODE_F64_CONST, new Uint8Array(buf));
    }
    if (inst.value.kind !== "const_int") {
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: "internal error: expected a validated const_int or const_float" });
    }
    return concatBytes(OPCODE_I64_CONST, encodeSLEB128(inst.value.value));
  }
  if (inst.kind === "binop") {
    // V2-M5: choose the f64-specific opcode table for an f64-typed
    // binop, mirroring wasm-cfg-validation.ts's own type-aware check.
    const opcode = inst.type === "f64" ? SUPPORTED_BINOPS_F64[inst.op] : (SUPPORTED_BINOPS[inst.op] ?? SUPPORTED_COMPARISONS[inst.op]);
    if (opcode === undefined) {
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: "internal error: expected a validated supported binop or comparison" });
    }
    return concatBytes(
      encodeExpr(inst.left.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
      encodeExpr(inst.right.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
      opcode,
    );
  }
  if (inst.kind === "unop") {
    // V2-M3 (Gate authorized, narrow scope): validateScope() already
    // guarantees, by the time this runs, that inst.op/inst.type is one
    // of exactly the two supported combinations (see
    // wasm-cfg-validation.ts's own unop check) - `neg` on `i64`, or
    // `not` on `bool`. `neg` on `f64` never reaches this point at all
    // (rejected earlier, during validation) - no float-specific code
    // exists here, deliberately, per the V2-M3 Discovery Gate's own
    // scope boundary.
    const operandExpr = encodeExpr(inst.operand.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
    if (inst.op === "neg") {
      // WASM has no native i64.neg opcode - the standard idiom is
      // `0 - x`, reusing the already-proven OPCODE_I64_SUB binop
      // encoding (no new opcode invented).
      return concatBytes(OPCODE_I64_CONST, encodeSLEB128(0n), operandExpr, OPCODE_I64_SUB);
    }
    if (inst.op === "not") {
      // OPCODE_I32_EQZ ("is this value zero?") on a 0/1-encoded bool
      // correctly implements logical NOT - the exact same opcode
      // already used elsewhere in this file for comparison results.
      return concatBytes(operandExpr, OPCODE_I32_EQZ);
    }
    // Unreachable given validateScope() already ran — defensive only.
    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: "internal error: expected a validated 'neg' or 'not' unop" });
  }
  if (inst.kind === "int_to_float") {
    const operandExpr = encodeExpr(inst.operand.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
    return concatBytes(operandExpr, OPCODE_F64_CONVERT_I64_S);
  }
  if (inst.kind === "call") {
    const funcIndex = functionIndexByName.get(inst.callee);
    if (funcIndex === undefined) {
      // Unreachable given validateScope() already ran — defensive only.
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_RUNTIME_FEATURE, functionName: fn.sourceName, message: `internal error: expected a validated call target for '${inst.callee}'` });
    }
    // V29-D2 (Implementation Gate, WASM-only scope, fix C): an argument
    // tagged with `arraySlot` (id: -1 is a sentinel, never a real SSA
    // id — confirmed directly via v29-D2-RD's own isolated test, which
    // showed encodeExpr(-1, ...) throwing "no definition found for id
    // %-1" when this case was previously unhandled) refers to the
    // CALLER's own array base-address local, not an SSA value. Push
    // that local's own i32 value directly — the same base address the
    // caller already holds — rather than attempting to resolve id -1
    // as an instruction.
    const argExprs = inst.args.map(a => {
      if (a.arraySlot !== undefined) {
        const callerBaseLocalIndex = arrayBaseLocalIndexBySlotId.get(a.arraySlot);
        if (callerBaseLocalIndex === undefined) {
          throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: call argument references array slot ${a.arraySlot}, which has no known base-address local in the caller` });
        }
        return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(callerBaseLocalIndex));
      }
      return encodeExpr(a.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
    });
    return concatBytes(...argExprs, OPCODE_CALL, encodeULEB128(funcIndex));
  }
  if (inst.kind === "load") {
    const localIndex = localIndexBySlotId.get(inst.slot);
    if (localIndex === undefined) {
      // Unreachable given validateScope() already ran — defensive only.
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated local for slot ${inst.slot}` });
    }
    return concatBytes(OPCODE_LOCAL_GET, encodeULEB128(localIndex));
  }
  if (inst.kind === "array_load") {
    // v29-D4 (Nested Array Model, first vertical slice): when baseRef
    // is present, the base address is NOT read from a fixed array-base
    // local (arrayBaseLocalIndexBySlotId, keyed by inst.slot — slot is
    // the required -1 sentinel in this case) — it is obtained by
    // encoding baseRef's own value directly, exactly the same way any
    // other prior SSA result is read (a materialized WASM local read),
    // since baseRef IS the materialized result of a prior array_load
    // (outer[i], per the ratified Nested Array Reference Representation
    // Contract). This requires no new WASM contract: WASM's own
    // existing header design already gives the referenced (inner)
    // array a real, readable runtime length — confirmed directly in
    // the Contract's own §3 finding that WASM needs zero changes here.
    // v29-D4: when baseRef is present, the RAW base expression (which,
    // if re-emitted inline, would be the OUTER load's own full,
    // side-effecting bytecode — including a write to the SHARED index
    // scratch as part of its own bounds check) is materialized into
    // its OWN dedicated i32 scratch local ONCE, then read via a cheap
    // local.get for every subsequent use — mirroring exactly the same
    // pattern the index scratch below already uses. Confirmed
    // necessary directly: without this, a[0][1] and a[1][0] returned
    // the WRONG inner element, because each of the two internal uses
    // of the base expression (the length read, and the element
    // address) re-ran the outer load's own bytecode, each time
    // re-overwriting the shared index scratch with the OUTER index,
    // stomping on the inner index's own already-set value.
    const baseRefScratch = inst.baseRef ? getBaseRefScratchLocalIndex(fn) : -1;
    const setBaseScratch = inst.baseRef
      ? concatBytes(
          encodeExpr(inst.baseRef.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
          new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(baseRefScratch),
        )
      : new Uint8Array(0);
    const arrayBaseExpr = inst.baseRef
      ? concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseRefScratch))
      : (() => {
          const baseLocalIndex = arrayBaseLocalIndexBySlotId.get(inst.slot);
          if (baseLocalIndex === undefined) {
            // Unreachable given validateScope() already ran — defensive only.
            throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for slot ${inst.slot}` });
          }
          return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseLocalIndex));
        })();
    const rawIndexExpr = encodeExpr(inst.index.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId);
    const slotMeta = fn.locals.find(l => l.id === inst.slot);
    // V29-D2 (fix B/§4): an array-typed PARAMETER's own real length is
    // not known at compile time (slotMeta.length is unset for it) -
    // read it from the array's own header at runtime instead, via the
    // same base address just loaded above. A literal array keeps its
    // existing compile-time-constant path unchanged.
    // v29-D4: a baseRef-driven (nested/inner) access ALSO always reads
    // the runtime header — its own real length can never be a
    // compile-time constant, exactly like an isArrayParam slot.
    const knownLength: number | Uint8Array = (inst.baseRef || slotMeta?.isArrayParam === true || slotMeta?.isArrayResult === true)
      ? encodeArrayLengthLoad(arrayBaseExpr)
      : (slotMeta?.length ?? 1);
    // FIX (per issues/triple-evaluation-of-array-index-expression.md):
    // materialize the index into the scratch local ONCE, then reuse the
    // cheap `local.get` for both the bounds check and the address
    // computation — instead of re-emitting rawIndexExpr's full bytecode
    // 3 times (which previously meant a side-effecting index expression
    // would execute 3x, not once).
    const scratchIndex = getIndexScratchLocalIndex(fn);
    const materializedIndexExpr = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(scratchIndex));
    const setScratch = concatBytes(rawIndexExpr, new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(scratchIndex));
    const boundsCheck = encodeBoundsCheck(materializedIndexExpr, knownLength);
    // v29-D4: an array_ref-typed element (a nested-array reference) is
    // read with the i32 variant — its own real value is a 4-byte base
    // address, never the 8-byte scalar width the existing i64 element
    // read uses. Every other element type is unaffected.
    const elementLoad = inst.type === "array_ref"
      ? encodeArrayRefElementLoad(arrayBaseExpr, materializedIndexExpr)
      : encodeArrayElementLoad(arrayBaseExpr, materializedIndexExpr);
    return concatBytes(setBaseScratch, setScratch, boundsCheck, elementLoad);
  }
  if (inst.kind === "field_load") {
    // Struct support, Phase 1: simpler than array_load - no bounds
    // check (fieldIndex is compile-time-known, per struct-memory.ts's
    // own header comment), no index materialization needed (there is
    // no index expression at all, just a fixed offset).
    const baseLocalIndex = structBaseLocalIndexBySlotId.get(inst.slot);
    if (baseLocalIndex === undefined) {
      // Unreachable given validateScope() already ran — defensive only.
      throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated struct base local for slot ${inst.slot}` });
    }
    const structBaseExpr = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseLocalIndex));
    const slotMeta = fn.locals.find(l => l.id === inst.slot);
    const fieldOffset = slotMeta?.structLayout?.fields[inst.fieldIndex]?.offset ?? 0;
    // v29-D5 (Slice 4): pass the field's own real type so
    // encodeStructFieldLoad can choose the correct width (i32 for a
    // reference-typed field, i64 otherwise) — see struct-memory.ts's
    // own header comment for why this was needed.
    const fieldType = slotMeta?.structLayout?.fields[inst.fieldIndex]?.type;
    return encodeStructFieldLoad(structBaseExpr, fieldOffset, fieldType);
  }
  // Unreachable given validateScope() already ran — defensive only.
  throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: unexpected instruction kind '${inst.kind}' reached the encoder` });
}

/** Encodes every `store`/`array_store` in a block as a standalone statement — `const`/`binop`/`call`/`load`/`array_load` are never emitted as standalone statements; they are inlined lazily by whichever `store`/`array_store`/`return` expression references them. The FIRST `array_store` to a given array slot within this block also emits that array's bump-allocation sequence (Level 3.1B.1) and its header write, before any element writes. */
/** V2-M2 encoder-bug fix (authorized, narrow scope): true iff any
 *  instruction in `block` references `id` as an operand (a call
 *  argument, a stored value, an array/field store's value or index, or
 *  a binop operand), or the block's own terminator does. Used
 *  exclusively by encodeStatements' bare-call-statement branch to
 *  decide whether a "call" instruction's result is ALSO consumed
 *  elsewhere in the block - if so, it must NOT also be emitted as an
 *  independent bare statement, since its one real consumer (encodeExpr,
 *  when it reaches that later instruction) will already emit the
 *  OPCODE_CALL for it. This is the confirmed root cause of the
 *  double-invocation bug (V2_M2_DOUBLE_INVOCATION_ROOT_CAUSE.md):
 *  encodeStatements previously emitted an OPCODE_CALL for EVERY
 *  top-level "call" instruction unconditionally, even one whose result
 *  was ALSO about to be evaluated again as an argument to a later
 *  instruction in the same block - producing two real WASM CALLs for
 *  one logical IR call. This function's own reference enumeration
 *  mirrors the exact operand shapes already handled by this file's own
 *  encodeExpr/encodeStatements (call.args, store.value, array_store's
 *  own value/index, field_store.value, binop.left/right) - not a new,
 *  independently-invented enumeration. Scope: this fixes exactly the
 *  confirmed bug (a single-use call's result also present as its own
 *  top-level statement instruction) - it does NOT touch, weaken, or
 *  extend checkExpressionTreeProperty's own separate, still fully
 *  enforced fan-out <= 1 rule (a genuinely multi-use value, fan-out
 *  2+, is still rejected earlier, during validation, exactly as
 *  before - see FINDING_WASM_MULTIUSE_FANOUT_LIMITATION.md, correctly
 *  NOT addressed here). */
function isReferencedElsewhere(id: number, block: IRBasicBlock): boolean {
  for (const inst of block.instructions) {
    if (inst.kind === "call" && inst.args.some(a => a.id === id)) return true;
    if (inst.kind === "store" && inst.value.id === id) return true;
    if (inst.kind === "array_store" && (inst.value.id === id || inst.index.id === id)) return true;
    if (inst.kind === "field_store" && inst.value.id === id) return true;
    if (inst.kind === "binop" && (inst.left.id === id || inst.right.id === id)) return true;
    if (inst.kind === "array_load" && inst.index.id === id) return true;
  }
  // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: ROOT CAUSE,
  // traced precisely (per explicit instruction, before any fix): a
  // return terminator whose own value is an array-slot reference
  // (arraySlot set) carries id=-1 as an ACCOMPANYING, non-meaningful
  // sentinel field — it is NOT really referencing "the SSA value with
  // id -1" the way a normal return (`return someExpr`) does. When an
  // array-returning function's own body is JUST a call whose result is
  // returned directly (`return inner()`), that call ALSO carries
  // id=-1 (its own, separate, already-established sentinel meaning
  // "this call's real result flows via resultArraySlot, not a normal
  // SSA id" — confirmed, real IR inspection this round). The naive
  // `.id === id` comparison below therefore FALSELY matches two
  // UNRELATED uses of the same sentinel value, causing this function's
  // own call to be (wrongly) treated as "already handled elsewhere"
  // and never emitted at all — confirmed empirically: the resulting
  // WASM function returned its own local's default, uninitialized
  // value (0) instead of ever calling the inner function. Excluding
  // an arraySlot-sentinel return from this specific check (it can
  // never legitimately match a real SSA id here, by construction) is
  // the narrow, correct fix — no change to id assignment anywhere.
  if (block.terminator.kind === "return" && block.terminator.value.arraySlot === undefined && block.terminator.value.id === id) return true;
  if (block.terminator.kind === "cond_branch" && block.terminator.condition.id === id) return true;
  return false;
}

/** V2-MU (Gate authorized, narrow scope): counts how many times `id` is
 *  referenced as an operand anywhere in `block` - the same operand
 *  enumeration as isReferencedElsewhere() immediately above (now also
 *  covering "unop", added for V2-M3 after isReferencedElsewhere() was
 *  first written), but returning a real count instead of a boolean,
 *  since materialization eligibility needs to distinguish "used once"
 *  (fine as-is) from "used more than once" (needs a real local).
 *  Deliberately scoped to ONE block, not the whole function: Lowering
 *  already ensures any value crossing a block boundary does so via a
 *  real store+load pair (a promoted slot, per promoteToSlot() -
 *  IR_LOCAL_PRESENCE_AUDIT.md), never by reusing the same raw
 *  instruction id across blocks - confirmed by inspection of every
 *  CFG-shape validator in this codebase, all of which already compute
 *  useCounts per individual block call. This function does not change
 *  that; it only counts within the one block it's given. */
/** B-1 Gate (type-only): narrows an IRInstruction to the kinds that carry
 *  an SSA result `id` — every kind except store/array_store/field_store. */
function instructionHasResultId(inst: IRInstruction): inst is Exclude<IRInstruction, { kind: "store" | "array_store" | "field_store" }> {
  return inst.kind !== "store" && inst.kind !== "array_store" && inst.kind !== "field_store";
}

function countReferencesWithinBlock(id: number, block: IRBasicBlock): number {
  let count = 0;
  for (const inst of block.instructions) {
    if (inst.kind === "call") count += inst.args.filter(a => a.id === id).length;
    if (inst.kind === "store" && inst.value.id === id) count++;
    if (inst.kind === "array_store") {
      if (inst.value.id === id) count++;
      if (inst.index.id === id) count++;
    }
    if (inst.kind === "field_store" && inst.value.id === id) count++;
    if (inst.kind === "binop") {
      if (inst.left.id === id) count++;
      if (inst.right.id === id) count++;
    }
    if (inst.kind === "unop" && inst.operand.id === id) count++;
    if (inst.kind === "int_to_float" && inst.operand.id === id) count++;
    if (inst.kind === "array_load" && inst.index.id === id) count++;
  }
  if (block.terminator.kind === "return" && block.terminator.value.id === id) count++;
  if (block.terminator.kind === "cond_branch" && block.terminator.condition.id === id) count++;
  return count;
}

function encodeStatements(block: IRBasicBlock, instructionsById: ReadonlyMap<number, IRInstruction>, functionIndexByName: ReadonlyMap<string, number>, fn: IRFunction, localIndexBySlotId: ReadonlyMap<number, number>, arrayBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), bumpGlobalIndex = 0, allocatedArraySlots: Set<number> = new Set<number>(), structBaseLocalIndexBySlotId: ReadonlyMap<number, number> = new Map(), allocatedStructSlots: Set<number> = new Set<number>()): Uint8Array {
  const parts: Uint8Array[] = [];
  const materializedIds = getMaterializedIds(fn);
  for (const inst of block.instructions) {
    // FIX (per issues/wasm-loop-local-let-affecting-outer-state.md,
    // PATCH_DESIGN_WASM_SSA.md, Stage 4): materialize this leaf
    // instruction's value into its own dedicated scratch local, AT
    // THIS EXACT POSITION — before any later instruction in this same
    // block (including an intervening `store`) gets encoded. Calls
    // encodeExprRaw directly (the unconditional computation), not the
    // encodeExpr wrapper, since this IS the one-time materialization
    // itself — calling the wrapper here would incorrectly try to read
    // this same scratch local before it has ever been written.
    // V2-MU: materializedIds.has(inst.id) alone is now sufficient -
    // getMaterializedIds() itself already gates on eligible kind/type
    // (const/load/binop/unop, i64/f64; call, i64/f64/string) before
    // ever adding an id to the map, so re-checking inst.kind/inst.type
    // here would only duplicate logic already centralized there.
    // B-1 Gate (type-only): an instruction without a result id (store/
    // array_store/field_store) is never a key of materializedIds, so the
    // added guard does not change which instructions take this path.
     if (instructionHasResultId(inst) && materializedIds.has(inst.id)) {
  const scratchIndex = resolveMaterializedLocalIndex(
    materializedIds.get(inst.id)!,
    fn,
  );

  if (inst.kind === "const" && inst.value.kind === "const_string") {
    const bytes = new TextEncoder().encode(inst.value.value);
    const allocationSize = 8 + bytes.length;

    // Capture the current shared bump pointer as this string's base.
    parts.push(new Uint8Array([OPCODE_GLOBAL_GET]));
    parts.push(encodeULEB128(bumpGlobalIndex));
    parts.push(new Uint8Array([OPCODE_LOCAL_SET]));
    parts.push(encodeULEB128(scratchIndex));

    // Advance the shared bump pointer by header + UTF-8 payload.
    parts.push(new Uint8Array([OPCODE_GLOBAL_GET]));
    parts.push(encodeULEB128(bumpGlobalIndex));
    parts.push(new Uint8Array([OPCODE_I32_CONST]));
    parts.push(encodeSLEB128(BigInt(allocationSize)));
    parts.push(new Uint8Array([OPCODE_I32_ADD]));
    parts.push(new Uint8Array([OPCODE_GLOBAL_SET]));
    parts.push(encodeULEB128(bumpGlobalIndex));

    // String ABI header: i64 UTF-8 byte length at base.
    parts.push(new Uint8Array([OPCODE_LOCAL_GET]));
    parts.push(encodeULEB128(scratchIndex));
    parts.push(new Uint8Array([OPCODE_I64_CONST]));
    parts.push(encodeSLEB128(BigInt(bytes.length)));
    parts.push(new Uint8Array([OPCODE_I64_STORE, 0x03, 0x00]));

    // String ABI payload: UTF-8 bytes start at base + 8.
    for (let i = 0; i < bytes.length; i++) {
      parts.push(new Uint8Array([OPCODE_LOCAL_GET]));
      parts.push(encodeULEB128(scratchIndex));
      parts.push(new Uint8Array([OPCODE_I32_CONST]));
      parts.push(encodeSLEB128(BigInt(8 + i)));
      parts.push(new Uint8Array([OPCODE_I32_ADD]));

      parts.push(new Uint8Array([OPCODE_I32_CONST]));
      parts.push(encodeSLEB128(BigInt(bytes[i]!)));

      parts.push(new Uint8Array([OPCODE_I32_STORE8]));
      parts.push(MEMARG_ALIGN1_OFFSET0);
    }

    continue;
  }

  parts.push(
    encodeExprRaw(
      inst.id,
      instructionsById,
      functionIndexByName,
      fn,
      localIndexBySlotId,
      arrayBaseLocalIndexBySlotId,
      structBaseLocalIndexBySlotId,
    ),
  );
  parts.push(new Uint8Array([OPCODE_LOCAL_SET]));
  parts.push(encodeULEB128(scratchIndex));
  continue;
}
    if (inst.kind === "store") {
      const localIndex = localIndexBySlotId.get(inst.slot);
      if (localIndex === undefined) {
        // Unreachable given validateScope() already ran — defensive only.
        throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated local for slot ${inst.slot}` });
      }
      parts.push(encodeExpr(inst.value.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId));
      parts.push(new Uint8Array([OPCODE_LOCAL_SET]));
      parts.push(encodeULEB128(localIndex));
    } else if (inst.kind === "array_store") {
      // v29-D5 (write-path extension, mirroring D4's own array_load
      // baseRef support): array_store never had baseRef support for
      // its OWN base address at all — D4's own explicit scope was
      // read-only (array_load); nested/field-based WRITE (b.values[i]
      // = x) was out of D4's own authorization. Confirmed directly:
      // this exact gap is what this round's own regression sweep
      // caught ("expected a validated array base local for slot -1")
      // for `b.values[1] = 99`. Mirrors array_load's own baseRef
      // pattern exactly: materialize the base expression once into its
      // own dedicated scratch, for the identical reason (repeated
      // internal use — the runtime length read, then the element
      // address — would otherwise re-run the outer expression's own
      // side-effecting bytecode multiple times).
      const baseRefScratchForStore = inst.baseRef ? getBaseRefScratchLocalIndex(fn) : -1;
      const setBaseScratchForStore = inst.baseRef
        ? concatBytes(
            encodeExpr(inst.baseRef.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId),
            new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(baseRefScratchForStore),
          )
        : new Uint8Array(0);
      if (inst.baseRef) parts.push(setBaseScratchForStore);
      const baseLocalIndex = inst.baseRef ? baseRefScratchForStore : arrayBaseLocalIndexBySlotId.get(inst.slot);
      if (baseLocalIndex === undefined) {
        // Unreachable given validateScope() already ran — defensive only.
        throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for slot ${inst.slot}` });
      }
      const slotMeta = fn.locals.find(l => l.id === inst.slot);
      // V29-D2 (fix B): a parameter's own array is already allocated by
      // the caller — it must NEVER be bump-allocated or have its
      // header (re)written here, unlike a literal array's own
      // first-store allocation. Guarded explicitly by isArrayParam,
      // not merely by allocatedArraySlots' own tracking (which was
      // never designed with parameter slots in mind at all).
      // v29-D5: a baseRef-driven write targets an EXISTING array (the
      // one baseRef's own expression already resolved to) — it must
      // NEVER be bump-allocated or have its header rewritten either,
      // for the identical reason as an array parameter. Confirmed
      // necessary directly: without this guard, `b.values[1] = 99`
      // would have re-allocated and overwritten the header of an
      // already-live array, corrupting it.
      if (slotMeta?.isArrayParam !== true && !inst.baseRef) {
        const elementCount = slotMeta?.length ?? 1;
        if (!allocatedArraySlots.has(inst.slot)) {
          allocatedArraySlots.add(inst.slot);
          parts.push(encodeArrayAllocation(bumpGlobalIndex, baseLocalIndex, elementCount));
          const arrayBaseExprForHeader = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseLocalIndex));
          parts.push(encodeArrayHeaderStore(arrayBaseExprForHeader, elementCount));
        }
      }
      const arrayBaseExpr = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseLocalIndex));
      const rawIndexExpr = encodeExpr(inst.index.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId);
      // v29-D4 (Gap A, Nested Literal Construction): when the stored
      // VALUE is itself an array reference (arraySlot set, the SAME
      // sentinel shape already proven for call arguments — D2's own
      // work), it is NOT an ordinary SSA value — encodeExpr(-1, ...)
      // would throw "no definition found for id %-1" (confirmed
      // directly by a real emission attempt this round). The correct
      // value is a direct read of the referenced inner array's own
      // existing base-address local — the SAME local
      // arrayBaseLocalIndexBySlotId already tracks for it, requiring
      // no new allocation, no new local group.
      const valueExpr = inst.value.arraySlot !== undefined
        ? (() => {
            const innerBaseLocalIndex = arrayBaseLocalIndexBySlotId.get(inst.value.arraySlot!);
            if (innerBaseLocalIndex === undefined) {
              throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for inner array slot ${inst.value.arraySlot}` });
            }
            return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(innerBaseLocalIndex));
          })()
        // v29-D5 (Slice 5, array-of-structs): the structSlot-tagged
        // analog of the arraySlot case immediately above — a struct
        // reference used as an array element's own value (e.g.
        // `[Point(1,2), Point(3,4)]`) is NOT an ordinary SSA value
        // either; confirmed directly by a real emission attempt this
        // round ("no definition found for id %-1"), the same failure
        // mode as the arraySlot case, for the analogous, previously-
        // unaddressed reference kind.
        : inst.value.structSlot !== undefined
        ? (() => {
            const innerStructBaseLocalIndex = structBaseLocalIndexBySlotId.get(inst.value.structSlot!);
            if (innerStructBaseLocalIndex === undefined) {
              throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated struct base local for inner struct slot ${inst.value.structSlot}` });
            }
            return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(innerStructBaseLocalIndex));
          })()
        : encodeExpr(inst.value.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
      // FIX (per issues/triple-evaluation-of-array-index-expression.md):
      // same materialization pattern as the array_load site above.
      const scratchIndex = getIndexScratchLocalIndex(fn);
      const materializedIndexExpr = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(scratchIndex));
      const setScratch = concatBytes(rawIndexExpr, new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(scratchIndex));
      parts.push(setScratch);
      // V29-D2 (fix B/§4): same runtime-header-read path as array_load,
      // for the identical reason (a parameter's own real length is not
      // known at compile time).
      // v29-D5: a baseRef-driven write ALSO always reads the runtime
      // header — its own real length can never be a compile-time
      // constant either (slotMeta is undefined for it), mirroring
      // array_load's own identical baseRef-aware logic exactly.
      // Confirmed necessary directly: without this, the bounds check
      // would have used the wrong, hardcoded fallback of 1.
      const storeKnownLength: number | Uint8Array = (inst.baseRef || slotMeta?.isArrayParam === true || slotMeta?.isArrayResult === true)
        ? encodeArrayLengthLoad(arrayBaseExpr)
        : (slotMeta?.length ?? 1);
      parts.push(encodeBoundsCheck(materializedIndexExpr, storeKnownLength));
      // v29-D4/D5: an array_ref-typed element (this outer slot stores
      // array references) OR a structSlot-tagged VALUE (this array
      // stores struct references — e.g. Point[] — confirmed directly
      // this round: the array's own slotMeta.type does not report
      // "array_ref" for a struct-of-elements array, so the VALUE's own
      // tag, not slotMeta.type alone, is the correct signal here) is
      // written with the i32 variant — both are base addresses, never
      // the full i64 scalar width.
      const elementStore = (slotMeta?.type === "array_ref" || inst.value.structSlot !== undefined)
        ? encodeArrayRefElementStore(arrayBaseExpr, materializedIndexExpr, valueExpr)
        : encodeArrayElementStore(arrayBaseExpr, materializedIndexExpr, valueExpr);
      parts.push(elementStore);
    } else if (inst.kind === "field_store") {
      // Struct support, Phase 1 (per WASM_BUMP_ALLOCATOR_STUDY.md §4,
      // point 4): mirrors array_store's own "allocate on first use"
      // pattern, but simpler — no header write (structs have none,
      // per struct-memory.ts's own header comment), and no bounds
      // check (fieldIndex is a compile-time-known constant from
      // StructLayoutCalculator, never a runtime-computed index — this
      // is the real, structural reason no bounds check is needed
      // here, not an oversight).
      const baseLocalIndex = structBaseLocalIndexBySlotId.get(inst.slot);
      if (baseLocalIndex === undefined) {
        // Unreachable given validateScope() already ran — defensive only.
        throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated struct base local for slot ${inst.slot}` });
      }
      const slotMeta = fn.locals.find(l => l.id === inst.slot);
      const structSize = slotMeta?.structLayout?.size ?? 0;
      if (!allocatedStructSlots.has(inst.slot)) {
        allocatedStructSlots.add(inst.slot);
        parts.push(encodeStructAllocation(bumpGlobalIndex, baseLocalIndex, structSize));
      }
      const structBaseExpr = concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(baseLocalIndex));
      const fieldOffset = slotMeta?.structLayout?.fields[inst.fieldIndex]?.offset ?? 0;
      // v29-D5 (Slice 4/5): when the stored VALUE is itself an array
      // reference (arraySlot set — the same sentinel shape D4 already
      // proved for call arguments and array_store), it is NOT an
      // ordinary SSA value — encodeExpr(-1, ...) would throw "no
      // definition found for id %-1" (confirmed directly by a real
      // emission attempt this round, for `struct Box { values: int[] }`'s
      // own construction). The correct value is a direct read of the
      // referenced inner array's own existing base-address local —
      // mirroring the identical fix D4 already made for array_store's
      // own value emission.
      const valueExpr = inst.value.arraySlot !== undefined
        ? (() => {
            const innerBaseLocalIndex = arrayBaseLocalIndexBySlotId.get(inst.value.arraySlot!);
            if (innerBaseLocalIndex === undefined) {
              throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for inner array slot ${inst.value.arraySlot}` });
            }
            return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(innerBaseLocalIndex));
          })()
        : encodeExpr(inst.value.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
      // v29-D5 (Slice 4): pass the field's own real type so
      // encodeStructFieldStore can choose the correct width.
      const fieldType = slotMeta?.structLayout?.fields[inst.fieldIndex]?.type;
      parts.push(encodeStructFieldStore(structBaseExpr, fieldOffset, valueExpr, fieldType));
    } else if (inst.kind === "call") {
      // P1-3C: a `call` instruction appearing directly as a statement
      // (its result unused - e.g. `print(42)`, a void Runtime import
      // call) was previously silently skipped here entirely - this
      // if/else-if chain had no case for it at all, so no OPCODE_CALL
      // bytecode was ever emitted for a bare call statement, even
      // though encodeExprRaw's own "call" handling (used when a call's
      // result IS consumed by another expression) already existed and
      // was already correct. Confirmed void-only for the current
      // WASM-importable-extern scope (isWasmImportableExtern requires
      // returnType "i64" or "void"): a "void" call pushes zero WASM
      // stack values, so appending its bytecode directly, with no
      // `drop`, is stack-balance-correct. An "i64"-returning call used
      // as a bare statement (result genuinely discarded) is not
      // reachable from any current UR-source construct reaching this
      // encoder, so no `drop` case is added speculatively - if one
      // becomes reachable later, that is a new Finding, not silently
      // assumed correct here.
      //
      // V2-M2 encoder-bug fix (authorized, narrow scope): a call whose
      // result IS referenced by a later instruction in this same block
      // (e.g. `print(input())` - the input() call sits as its own
      // top-level instruction, but its result is ALSO the argument to
      // print()) must NOT ALSO be emitted here as an independent bare
      // statement - doing so previously produced two real OPCODE_CALLs
      // for one logical IR call (the confirmed double-invocation bug,
      // silently masked for pure functions, made observable by
      // input()'s real side effect on stdin). See
      // isReferencedElsewhere()'s own comment for the full root-cause
      // account and this fix's exact, narrow boundary.
      // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: a call whose
      // own resultArraySlot is set must ALWAYS be emitted here as its
      // own independent statement (with its own local.set — see below),
      // even when isReferencedElsewhere(inst.id, block) would say its
      // result is "referenced elsewhere" (e.g. `useIt(make())` — the
      // OUTER call's own argument references make()'s result via
      // `arraySlot`, not by re-resolving make()'s own id through
      // encodeExpr the way a normal scalar call-as-argument would).
      // Unlike a normal SSA id reference (where the consuming
      // expression RE-EMITS the producer's own bytecode inline, making
      // "skip the bare statement" a safe, correct de-duplication),
      // reading via `arraySlot` never re-emits the call — it only
      // reads a local a PRIOR local.set must already have populated.
      // Skipping this call's own emission here, as V2-M2's own
      // de-duplication logic would otherwise do, left that local at
      // its default, uninitialized value — confirmed directly,
      // empirically, this round (`useIt(make())` traced and fixed
      // precisely this way, not by disabling V2-M2's own real,
      // still-necessary fix for the normal scalar-call case).
      if (!isReferencedElsewhere(inst.id, block) || (inst.kind === "call" && inst.resultArraySlot !== undefined)) {
        // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: ROOT CAUSE,
        // traced precisely (per explicit instruction, before any fix):
        // every array-returning `call` instruction shares the SAME
        // sentinel id (-1) — confirmed directly, real IR inspection,
        // multiple calls in one block. encodeExprRaw(inst.id, ...)
        // re-looks-up "the instruction with this id" via the SHARED
        // instructionsById map, which — because the map is built by
        // `.set(inst.id, inst)` over ALL of this block's instructions —
        // only ever holds the LAST call that happened to share id -1,
        // regardless of which `inst` this loop iteration is actually
        // processing. Confirmed empirically: with two array-returning
        // calls in one function, BOTH ended up reading the SECOND
        // call's own real result.
        //
        // This is NOT an id-collision the IR itself needs to change —
        // the SAME id=-1 sentinel pattern is already correct and
        // load-bearing elsewhere (array/struct slot references, per
        // the file's own extensive existing comments on this exact
        // convention) precisely because those OTHER sites never
        // re-look-up by id at all — they read inst.arraySlot/
        // structSlot directly from the instruction object already in
        // hand. The fix applies that SAME already-correct principle
        // here: for a call instruction, build its own bytecode
        // directly from the `inst` reference this loop iteration
        // already, correctly holds — never re-resolving it by id
        // through the shared, collision-prone map.
        // B-1 Gate (type-only): this code is inside the
        // `else if (inst.kind === "call")` branch, so the former
        // `inst.kind === "call" ? <IIFE> : encodeExprRaw(inst.id, ...)`
        // ternary's false arm was unreachable (TS2339: 'id' on 'never').
        // The dead arm is removed; the always-taken arm is unchanged.
        const callBytes = (() => {
              const funcIndex = functionIndexByName.get(inst.callee);
              if (funcIndex === undefined) {
                throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_RUNTIME_FEATURE, functionName: fn.sourceName, message: `internal error: expected a validated call target for '${inst.callee}'` });
              }
              const argExprs = inst.args.map(a => {
                if (a.arraySlot !== undefined) {
                  const callerBaseLocalIndex = arrayBaseLocalIndexBySlotId.get(a.arraySlot);
                  if (callerBaseLocalIndex === undefined) {
                    throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: call argument references array slot ${a.arraySlot}, which has no known base-address local in the caller` });
                  }
                  return concatBytes(new Uint8Array([OPCODE_LOCAL_GET]), encodeULEB128(callerBaseLocalIndex));
                }
                return encodeExpr(a.id, instructionsById, functionIndexByName, fn, localIndexBySlotId, arrayBaseLocalIndexBySlotId, structBaseLocalIndexBySlotId);
              });
              return concatBytes(...argExprs, OPCODE_CALL, encodeULEB128(funcIndex));
            })();
        // Gate V1-GAP-006-WASM-ARRAY-RETURN-IMPLEMENTATION: a call
        // instruction whose own IR marks resultArraySlot (the callee
        // returns an array — confirmed directly, real IR inspection
        // this round: {"kind":"call", "type":"void", ...,
        // "resultArraySlot":N}) now produces a REAL i32 value on the
        // WASM stack (the callee's own function type was corrected,
        // this same Gate, to declare an i32 result for an array-
        // returning function). That value must be captured into the
        // SAME base-address local arrayBaseLocalIndexBySlotId already
        // reserves for slot N (fn.locals' own isArrayResult-marked
        // entry) via local.set — otherwise it is left on the stack
        // (or silently mismatched) and the local a later array_load
        // reads from keeps its default, wrong value. This was
        // confirmed directly, empirically, this round: without this
        // fix, `a[0]` of a real, differently-valued returned array
        // read back a wrong, unrelated value instead of the actual
        // element.
        if (inst.kind === "call" && inst.resultArraySlot !== undefined) {
          const resultLocalIndex = arrayBaseLocalIndexBySlotId.get(inst.resultArraySlot);
          if (resultLocalIndex === undefined) {
            throw new WasmUnsupportedError({ code: WASM_CODES.UNSUPPORTED_INSTRUCTION, functionName: fn.sourceName, message: `internal error: expected a validated array base local for call result array slot ${inst.resultArraySlot}` });
          }
          const OPCODE_LOCAL_SET = 0x21;
          parts.push(concatBytes(callBytes, new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(resultLocalIndex)));
        } else {
          parts.push(callBytes);
        }
      }
    }
  }
  return concatBytes(...parts);
}

