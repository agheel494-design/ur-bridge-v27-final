// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Array Memory (Level 3.1B.1: Linear Memory Foundation)
// WASM_MEMORY_MODEL_SPEC.md, MEMORY_LAYOUT_EXAMPLES.md
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit review's exact scope for 3.1B.1:
//
//   ALLOWED:  memory section, a simple bump allocator (via one WASM
//             Global), the Array Header layout, the ONE address
//             formula, array_load/array_store lowering.
//
//   FORBIDDEN (this batch): bounds checking, resize, dynamic growth,
//             garbage collection, free — none of these exist here,
//             not even partially.
//
// SINGLE-SOURCE-OF-TRUTH REQUIREMENT (ratified, per explicit review):
// every address computation anywhere in this Backend must derive from
// the named constants below — never a literal `8` written
// independently at a second call site. This is checked by
// ELEMENT_SIZE_IMMUTABLE_CONTRACT and MEMORY_LAYOUT_IMMUTABLE_CONTRACT
// (tests/backend/wasm/emit-wasm.test.ts).

import { encodeULEB128, encodeSLEB128, concatBytes } from "./leb128.js";
import { OPCODE_END, OPCODE_GLOBAL_GET, OPCODE_GLOBAL_SET, OPCODE_I32_ADD, OPCODE_I32_CONST, OPCODE_I32_LOAD, OPCODE_I32_MUL, OPCODE_I32_OR, OPCODE_I32_STORE, OPCODE_I32_WRAP_I64, OPCODE_I64_CONST, OPCODE_I64_GE_S, OPCODE_I64_LOAD, OPCODE_I64_LT_S, OPCODE_I64_STORE, OPCODE_IF, OPCODE_LOCAL_SET, OPCODE_UNREACHABLE } from "./wasm-opcodes.js";

/** The size, in bytes, of one array element. Currently i64-only (per WASM_BACKEND_SPEC.md §0's Feature Matrix — i64 is the only integer width supported anywhere in this Backend). MEMORY_MODEL_SPEC.md's Single-Formula Commitment requires every address computation to derive from this constant, never a hardcoded `8`. */
export const ELEMENT_SIZE = 8;

/** The size, in bytes, of an array's header (currently just the `length` field, stored as one i64). Every array's data begins exactly ARRAY_HEADER_SIZE bytes after its base address. */
export const ARRAY_HEADER_SIZE = 8;

/** The first byte address the bump allocator ever hands out. Bytes [0, BUMP_INITIAL_ADDRESS) are permanently reserved and never allocated to any array — see WASM_MEMORY_MODEL_SPEC.md §1 (so that address 0 can never alias a real array's header). */
export const BUMP_INITIAL_ADDRESS = 8;

/** WASM's memarg immediate (alignment exponent + offset) that follows every load/store opcode. Alignment 3 = 2^3 = 8-byte-aligned (matching ELEMENT_SIZE/ARRAY_HEADER_SIZE exactly — see MEMORY_MODEL_SPEC.md §2's alignment note), offset 0 (the offset is always folded into the address expression itself, never into this immediate, keeping exactly one place — the address formula — that computes offsets). */
const MEMARG_ALIGN8_OFFSET0 = new Uint8Array([0x03, 0x00]);
// v29-D4: i32.load/i32.store's own natural width is 4 bytes — WASM's
// own spec requires a memory instruction's declared alignment to be
// AT MOST its natural width (confirmed directly by a real
// WebAssembly.Module() CompileError this round: "invalid alignment;
// expected maximum alignment is 2, actual alignment is 3" — reusing
// MEMARG_ALIGN8_OFFSET0, exponent 3/8-byte, for an i32 operation is
// invalid per spec). Exponent 2 = 2^2 = 4-byte alignment.
const MEMARG_ALIGN4_OFFSET0 = new Uint8Array([0x02, 0x00]);

/**
 * The ONE address formula (WASM_MEMORY_MODEL_SPEC.md §4's
 * Single-Formula Commitment): `arrayBase + ARRAY_HEADER_SIZE + index *
 * ELEMENT_SIZE`. `arrayBaseExpr` and `indexExpr` are each a caller-
 * supplied byte sequence that pushes the relevant value — `arrayBase`
 * as `i32`, `index` as `i64` (narrowed to `i32` here via
 * `i32.wrap_i64`, confirmed correct by direct hand-built-module
 * testing before this function was written).
 */
export function encodeElementAddress(arrayBaseExpr: Uint8Array, indexExpr: Uint8Array): Uint8Array {
  return concatBytes(
    arrayBaseExpr,
    new Uint8Array([OPCODE_I32_CONST]), encodeSLEB128(BigInt(ARRAY_HEADER_SIZE)),
    new Uint8Array([OPCODE_I32_ADD]),
    indexExpr,
    new Uint8Array([OPCODE_I32_WRAP_I64]),
    new Uint8Array([OPCODE_I32_CONST]), encodeSLEB128(BigInt(ELEMENT_SIZE)),
    new Uint8Array([OPCODE_I32_MUL]),
    new Uint8Array([OPCODE_I32_ADD]),
  );
}

/** Emits `i64.load` at the address computed by `encodeElementAddress()` — reads one array element. */
export function encodeArrayElementLoad(arrayBaseExpr: Uint8Array, indexExpr: Uint8Array): Uint8Array {
  return concatBytes(encodeElementAddress(arrayBaseExpr, indexExpr), new Uint8Array([OPCODE_I64_LOAD]), MEMARG_ALIGN8_OFFSET0);
}

/** Emits `i64.store` at the address computed by `encodeElementAddress()` — writes one array element. `valueExpr` must push exactly one `i64` value. */
export function encodeArrayElementStore(arrayBaseExpr: Uint8Array, indexExpr: Uint8Array, valueExpr: Uint8Array): Uint8Array {
  return concatBytes(encodeElementAddress(arrayBaseExpr, indexExpr), valueExpr, new Uint8Array([OPCODE_I64_STORE]), MEMARG_ALIGN8_OFFSET0);
}

// v29-D4 (Nested Array Model, first vertical slice): the array_ref
// element-read/write counterpart to the two functions immediately
// above — same address computation (encodeElementAddress, unchanged;
// ELEMENT_SIZE=8 stays the per-slot stride regardless of how many of
// those 8 bytes the value itself occupies, per the ratified Nested
// Array Reference Representation Contract), but i32.load/i32.store,
// not i64 — a reference is a base address (4 bytes on this target),
// never the full 8-byte scalar width. Confirmed necessary directly by
// a real WebAssembly.Module() CompileError this round ("i64.load[0]
// expected type i32, found i64.load of type i64") — the Contract's
// own semantic decision (reference = i32 address) cannot be realized
// without a genuinely distinct runtime read/write path at exactly
// this point; this is that path, and nothing more.
/** Emits `i32.load` at the address computed by `encodeElementAddress()` — reads one array_ref element (a nested-array reference: a base address only). */
export function encodeArrayRefElementLoad(arrayBaseExpr: Uint8Array, indexExpr: Uint8Array): Uint8Array {
  return concatBytes(encodeElementAddress(arrayBaseExpr, indexExpr), new Uint8Array([OPCODE_I32_LOAD]), MEMARG_ALIGN4_OFFSET0);
}

/** Emits `i32.store` at the address computed by `encodeElementAddress()` — writes one array_ref element. `valueExpr` must push exactly one `i32` value. */
export function encodeArrayRefElementStore(arrayBaseExpr: Uint8Array, indexExpr: Uint8Array, valueExpr: Uint8Array): Uint8Array {
  return concatBytes(encodeElementAddress(arrayBaseExpr, indexExpr), valueExpr, new Uint8Array([OPCODE_I32_STORE]), MEMARG_ALIGN4_OFFSET0);
}

/** Emits `i64.store` of `length` at `arrayBaseExpr` + offset 0 — writes the array's header. */
export function encodeArrayHeaderStore(arrayBaseExpr: Uint8Array, length: number): Uint8Array {
  return concatBytes(arrayBaseExpr, new Uint8Array([OPCODE_I64_CONST]), encodeSLEB128(BigInt(length)), new Uint8Array([OPCODE_I64_STORE]), MEMARG_ALIGN8_OFFSET0);
}

/**
 * Emits the bump-allocation sequence for one array of `elementCount`
 * elements: read the bump Global into `localIndex` (this array's base
 * address, an i32 local reused for every subsequent access to this
 * array within the function), then advance the bump Global by this
 * array's total size (`ARRAY_HEADER_SIZE + elementCount * ELEMENT_SIZE`
 * — the SAME two named constants as every other computation in this
 * module, per the single-source-of-truth requirement).
 */
export function encodeArrayAllocation(bumpGlobalIndex: number, localIndex: number, elementCount: number): Uint8Array {
  const totalSize = ARRAY_HEADER_SIZE + elementCount * ELEMENT_SIZE;
  const OPCODE_LOCAL_SET = 0x21;
  return concatBytes(
    new Uint8Array([OPCODE_GLOBAL_GET]), encodeULEB128(bumpGlobalIndex),
    new Uint8Array([OPCODE_LOCAL_SET]), encodeULEB128(localIndex),
    new Uint8Array([OPCODE_GLOBAL_GET]), encodeULEB128(bumpGlobalIndex),
    new Uint8Array([OPCODE_I32_CONST]), encodeSLEB128(BigInt(totalSize)),
    new Uint8Array([OPCODE_I32_ADD]),
    new Uint8Array([OPCODE_GLOBAL_SET]), encodeULEB128(bumpGlobalIndex),
  );
}

/** Encodes the module's `global` section: exactly one mutable `i32` global (the bump pointer), initialized to `BUMP_INITIAL_ADDRESS`. */
export function encodeGlobalSection(): Uint8Array {
  const SECTION_GLOBAL = 6;
  const VALTYPE_I32 = 0x7f;
  const MUTABLE = 0x01;
  const globalEntry = concatBytes(
    new Uint8Array([VALTYPE_I32, MUTABLE, OPCODE_I32_CONST]), encodeSLEB128(BigInt(BUMP_INITIAL_ADDRESS)), new Uint8Array([OPCODE_END]),
  );
  const payload = concatBytes(encodeULEB128(1), globalEntry);
  return concatBytes(new Uint8Array([SECTION_GLOBAL]), encodeULEB128(payload.length), payload);
}

/** Encodes the module's `memory` section: exactly one memory, minimum 1 page (64KiB) — sufficient for every array this narrow phase can construct, with no dynamic growth (deferred, explicitly out of scope). */
export function encodeMemorySection(): Uint8Array {
  const SECTION_MEMORY = 5;
  const LIMITS_MIN_ONLY = 0x00;
  const MIN_PAGES = 1;
  const payload = concatBytes(encodeULEB128(1), new Uint8Array([LIMITS_MIN_ONLY]), encodeULEB128(MIN_PAGES));
  return concatBytes(new Uint8Array([SECTION_MEMORY]), encodeULEB128(payload.length), payload);
}

/** WASM constant specific to bounds checking (3.1B.2), not duplicated elsewhere. */
const BLOCKTYPE_VOID = 0x40;

/** Emits `i64.load` at `arrayBaseExpr` + offset 0 — reads the array's own
 *  header, returning its real, current length as an i64 on the stack.
 *  V29-D2: the runtime-length counterpart to `encodeArrayHeaderStore`
 *  (which only writes it) — reads from the exact same offset that
 *  function writes to, and that MEMORY_LAYOUT_IMMUTABLE_CONTRACT already
 *  asserts holds the length. Used for array-typed function parameters,
 *  whose real length cannot be known at compile time by the callee. */
export function encodeArrayLengthLoad(arrayBaseExpr: Uint8Array): Uint8Array {
  return concatBytes(arrayBaseExpr, new Uint8Array([OPCODE_I64_LOAD]), MEMARG_ALIGN8_OFFSET0);
}

/**
 * Encodes the bounds check ratified in WASM_MEMORY_MODEL_SPEC.md §10b:
 * `if (i32.or (index < 0) (index >= knownLength)) { unreachable }` —
 * no `else` needed, mirroring the exact "if with only a then, no
 * else" pattern already proven for `break`/`continue`
 * (3.1A.6b/3.1A.6c).
 *
 * **FIXED (per issues/triple-evaluation-of-array-index-expression.md):
 * `indexExpr` is still inserted twice here (once per comparison) and
 * once more by this function's callers for the address computation —
 * but callers now pass an already-MATERIALIZED index (a cheap
 * `local.get` reading a scratch WASM local the caller computed the
 * real expression into exactly once beforehand), not the raw
 * expression itself. Duplicating a `local.get` is free (no
 * re-evaluation of anything with side effects); only duplicating the
 * ORIGINAL expression would have been a problem. This function's own
 * signature and behavior are unchanged — the fix lives entirely in
 * `emit-wasm.ts`'s callers (`getIndexScratchLocalIndex()` and its use
 * at both array_load/array_store sites).
 *
 * Per §10b's Correction 1: `knownLength` is THIS PHASE's mechanism for
 * obtaining the bound (the compile-time-known `IRLocalSlot.length`) —
 * not baked into `array_load`/`array_store`'s own interface. A future
 * phase reading the bound at runtime instead would only need to
 * change how the bound value here is obtained, not this function's
 * shape.
 *
 * V29-D2 (exactly the extension this comment's own prior text
 * anticipated): `length` now accepts either the original compile-time
 * number (existing literal-array path, byte-for-byte unchanged output)
 * or a pre-encoded byte sequence pushing an i64 length value at
 * runtime (the new array-parameter path, via `encodeArrayLengthLoad`
 * above) — this function's own comparison logic is otherwise
 * unchanged.
 */
export function encodeBoundsCheck(indexExpr: Uint8Array, length: number | Uint8Array): Uint8Array {
  const lengthExpr = typeof length === "number"
    ? concatBytes(new Uint8Array([OPCODE_I64_CONST]), encodeSLEB128(BigInt(length)))
    : length;
  return concatBytes(
    indexExpr,
    new Uint8Array([OPCODE_I64_CONST]), encodeSLEB128(0n),
    new Uint8Array([OPCODE_I64_LT_S]),
    indexExpr,
    lengthExpr,
    new Uint8Array([OPCODE_I64_GE_S]),
    new Uint8Array([OPCODE_I32_OR]),
    new Uint8Array([OPCODE_IF, BLOCKTYPE_VOID]),
    new Uint8Array([OPCODE_UNREACHABLE]),
    new Uint8Array([OPCODE_END]),
  );
}
