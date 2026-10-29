// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — LEB128 encoding helpers
// Level 3.1A.1, WASM_BACKEND_SPEC.md
// ─────────────────────────────────────────────────────────────────────────────
//
// WASM's binary format uses LEB128 (Little Endian Base 128) for every
// variable-length integer: section/vector lengths, type indices,
// signed constant values, and so on. Two variants: unsigned (used for
// counts/indices/lengths) and signed (used for i32.const/i64.const
// operands, which may be negative).

/** Unsigned LEB128 encoding — used for every count, index, and section/body length in this emitter. */
export function encodeULEB128(value: number): Uint8Array {
  if (value < 0) throw new Error(`encodeULEB128: negative value ${value}`);
  const bytes: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128); // avoid >>> on values that could exceed 32-bit range for large modules
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return new Uint8Array(bytes);
}

/** Signed LEB128 encoding (BigInt-based, since UR's i64 IR type needs the full 64-bit signed range) — used for i32.const/i64.const operands. */
export function encodeSLEB128(value: bigint): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  let more = true;
  while (more) {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    const signBitSet = (byte & 0x40) !== 0;
    if ((v === 0n && !signBitSet) || (v === -1n && signBitSet)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    bytes.push(byte);
  }
  return new Uint8Array(bytes);
}

/** Concatenates byte arrays/single bytes into one Uint8Array — the only way this module ever builds a section, never string-concatenation-style manual offset tracking. */
export function concatBytes(...parts: Array<Uint8Array | number[] | number>): Uint8Array {
  const arrays = parts.map(p => (typeof p === "number" ? new Uint8Array([p]) : p instanceof Uint8Array ? p : new Uint8Array(p)));
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Wraps a payload with its own ULEB128-encoded length, computed from
 * the ACTUAL payload byte length — never a hand-calculated size. This
 * is the direct fix for the exact bug found during WASM_BACKEND_SPEC.md's
 * own preparation (a hardcoded, wrong section size).
 */
export function withLength(payload: Uint8Array): Uint8Array {
  return concatBytes(encodeULEB128(payload.length), payload);
}

/** A WASM "vector": a ULEB128 count followed by that many encoded elements — the format used by every section (types, functions, exports, etc.). */
export function encodeVector(elements: readonly Uint8Array[]): Uint8Array {
  return concatBytes(encodeULEB128(elements.length), ...elements);
}
