// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Struct Memory (Phase 1: local struct only)
//
// Per WASM_BUMP_ALLOCATOR_STUDY.md §4's own entry-point ordering (point 1):
// a struct has NO header (unlike an array's own `length` header) — its
// own structLayout.size is fully known at compile time, so there is no
// runtime bookkeeping needed at the base address at all. This is a real,
// favorable difference from arrays, confirmed here, not assumed.
//
// v29-D5 (Slice 4, WASM Width Contract §4): a struct field is read/
// written at its own REAL width, not unconditionally as i64 — the prior
// version of this file's own comment ("i64 is the only integer width
// supported anywhere in this Backend today") is now out of date: D4
// already added an i32 path for array elements; this file's own i64-only
// field access was a separate, real, pre-existing gap, confirmed
// directly by a real WebAssembly.Module() CompileError this round
// (struct { label: string } — "i64.store[1] expected type i64, found
// call of type i32"), entirely independent of arrays. A reference-typed
// field (string, array_ref) is i32-width in WASM; an i64/f64-typed
// field keeps its own existing width. This is a WIDTH-selection rule
// only (per the Design's own explicit §1/§4 refusal to unify
// semantics) — it does not imply string and array_ref share any other
// behavior; each keeps its own separate length-source and access rules.
// ─────────────────────────────────────────────────────────────────────────────

import { encodeULEB128, encodeSLEB128, concatBytes } from "./leb128.js";
import { OPCODE_GLOBAL_GET, OPCODE_GLOBAL_SET, OPCODE_I32_ADD, OPCODE_I32_CONST, OPCODE_I32_LOAD, OPCODE_I32_STORE, OPCODE_LOCAL_SET, OPCODE_I64_LOAD, OPCODE_I64_STORE } from "./wasm-opcodes.js";
import type { IRType } from "../../shared/ir.js";

const MEMARG_ALIGN8_OFFSET0 = new Uint8Array([0x03, 0x00]);
// v29-D5: 4-byte alignment for the new i32 field path — mirrors D4's
// own MEMARG_ALIGN4_OFFSET0 (array-memory.ts) exactly, for the exact
// same reason: WASM's own spec requires a memory instruction's declared
// alignment to never exceed its own natural width (i32 = 4 bytes =
// exponent 2, not 3/8-byte).
const MEMARG_ALIGN4_OFFSET0 = new Uint8Array([0x02, 0x00]);

export function encodeStructFieldAddress(structBaseExpr: Uint8Array, fieldOffset: number): Uint8Array {
  return concatBytes(
    structBaseExpr,
    new Uint8Array([OPCODE_I32_CONST]), encodeSLEB128(BigInt(fieldOffset)),
    new Uint8Array([OPCODE_I32_ADD]),
  );
}

/** v29-D5: true for a reference-width field (string, array_ref) — i32 in WASM. False (i64) for every other currently-supported field type. A width classification only, per §1/§4 — never a semantic unification. */
function isReferenceWidthField(fieldType: IRType): boolean {
  return fieldType === "string" || fieldType === "array_ref";
}

export function encodeStructFieldLoad(structBaseExpr: Uint8Array, fieldOffset: number, fieldType: IRType = "i64"): Uint8Array {
  const address = encodeStructFieldAddress(structBaseExpr, fieldOffset);
  return isReferenceWidthField(fieldType)
    ? concatBytes(address, new Uint8Array([OPCODE_I32_LOAD]), MEMARG_ALIGN4_OFFSET0)
    : concatBytes(address, new Uint8Array([OPCODE_I64_LOAD]), MEMARG_ALIGN8_OFFSET0);
}

export function encodeStructFieldStore(structBaseExpr: Uint8Array, fieldOffset: number, valueExpr: Uint8Array, fieldType: IRType = "i64"): Uint8Array {
  const address = encodeStructFieldAddress(structBaseExpr, fieldOffset);
  return isReferenceWidthField(fieldType)
    ? concatBytes(address, valueExpr, new Uint8Array([OPCODE_I32_STORE]), MEMARG_ALIGN4_OFFSET0)
    : concatBytes(address, valueExpr, new Uint8Array([OPCODE_I64_STORE]), MEMARG_ALIGN8_OFFSET0);
}

export function encodeStructAllocation(bumpGlobalIndex: number, localIndex: number, structSize: number): Uint8Array {
  return concatBytes(
    new Uint8Array([OPCODE_GLOBAL_GET]), encodeULEB128(bumpGlobalIndex),
    new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(localIndex),
    new Uint8Array([OPCODE_GLOBAL_GET]), encodeULEB128(bumpGlobalIndex),
    new Uint8Array([OPCODE_I32_CONST]), encodeSLEB128(BigInt(structSize)),
    new Uint8Array([OPCODE_I32_ADD]),
    new Uint8Array([OPCODE_GLOBAL_SET]), encodeULEB128(bumpGlobalIndex),
  );
}
