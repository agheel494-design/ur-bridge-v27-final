// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Runtime: Memory Manager + Call Marshaler
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Manages the boundary between UR-managed memory and C/native memory.
// Handles: allocations, string encoding, struct marshaling, callback registration.

import type { AbiType, AbiStructType } from "../abi/types.js";
import { computeLayout, PLATFORM_X64_SYSV, type TargetPlatform } from "../abi/layout.js";

// ── Ownership model for cross-boundary values ──────────────────────────────

export type FfiOwnership =
  | "owned-by-ur"      // UR allocator owns; C must not free
  | "owned-by-c"       // C allocator owns; UR must not free
  | "borrowed"         // neither side frees; caller manages lifetime
  | "shared-rc";       // reference counted across boundary

export type FfiValue = {
  ownership: FfiOwnership;
  type: AbiType;
  // In a real runtime this would be a pointer into WASM linear memory
  // or a JS ArrayBuffer view. For the IR layer, we use a typed descriptor.
  data: FfiData;
};

export type FfiData =
  | { kind: "primitive"; value: number | bigint | boolean }
  | { kind: "cstr";      ptr: number; byteLen: number }
  | { kind: "struct";    ptr: number; sizeBytes: number }
  | { kind: "ptr";       addr: number; nullable: boolean }
  | { kind: "slice";     ptr: number; len: number; elementSize: number }
  | { kind: "void" };

// ── String encoding/decoding ───────────────────────────────────────────────

export type StringEncoding = "utf8" | "utf16" | "ascii" | "cstr";

export type EncodedString = {
  bytes: Uint8Array;
  nullTerminated: boolean;
  encoding: StringEncoding;
};

export function encodeString(s: string, encoding: StringEncoding): EncodedString {
  switch (encoding) {
    case "utf8":
    case "cstr": {
      const encoder = new TextEncoder();
      const raw = encoder.encode(s);
      const bytes = new Uint8Array(raw.length + (encoding === "cstr" ? 1 : 0));
      bytes.set(raw);
      // null terminator already zero
      return { bytes, nullTerminated: encoding === "cstr", encoding };
    }
    case "ascii": {
      const bytes = new Uint8Array(s.length + 1);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0x7f;
      return { bytes, nullTerminated: true, encoding };
    }
    case "utf16": {
      const bytes = new Uint8Array((s.length + 1) * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), true);
      return { bytes, nullTerminated: true, encoding };
    }
  }
}

export function decodeString(bytes: Uint8Array, encoding: StringEncoding): string {
  switch (encoding) {
    case "utf8":
    case "cstr": {
      const nullIdx = bytes.indexOf(0);
      const slice = nullIdx >= 0 ? bytes.slice(0, nullIdx) : bytes;
      return new TextDecoder("utf-8").decode(slice);
    }
    case "ascii": {
      let s = "";
      for (const b of bytes) { if (b === 0) break; s += String.fromCharCode(b & 0x7f); }
      return s;
    }
    case "utf16": {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let s = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = view.getUint16(i, true);
        if (code === 0) break;
        s += String.fromCharCode(code);
      }
      return s;
    }
  }
}

// ── Struct marshaling (struct → flat bytes) ────────────────────────────────

function primKind(t: AbiType): string | null {
  return t.kind === "primitive" ? t.prim : null;
}

export function marshalStruct(
  t: AbiStructType,
  values: Record<string, number | bigint | boolean>,
  platform: TargetPlatform = PLATFORM_X64_SYSV
): Uint8Array {
  const layout = computeLayout(t, platform);
  const buf = new Uint8Array(layout.sizeBytes);
  const view = new DataView(buf.buffer);

  for (let idx = 0; idx < t.fields.length; idx++) {
    const field = t.fields[idx]!;
    const fieldLayout = layout.fields?.[idx];
    if (!fieldLayout) continue;
    const val = values[field.name];
    if (val === undefined) continue;

    const off = fieldLayout.offsetBytes;
    const kind = primKind(field.type);
    const n = typeof val === "bigint" ? Number(val) : typeof val === "boolean" ? (val ? 1 : 0) : val;

    switch (fieldLayout.sizeBytes) {
      case 1:
        view.setUint8(off, n & 0xff);
        break;
      case 2:
        if (kind === "i16") view.setInt16(off, n, true);
        else view.setUint16(off, n, true);
        break;
      case 4:
        if (kind === "f32") view.setFloat32(off, n, true);
        else if (kind === "i32" || kind === "isize") view.setInt32(off, n, true);
        else view.setUint32(off, n, true);
        break;
      case 8:
        if (kind === "f64") {
          view.setFloat64(off, n, true);
        } else if (kind === "i64" || kind === "isize" || kind === "u64" || kind === "usize") {
          // CRITICAL: i64/u64 fields must always be written via
          // setBigInt64/setBigUint64, regardless of whether the caller
          // passed a bigint or a plain JS number. The previous version
          // only took this path when `typeof val === "bigint"` and
          // otherwise fell through to `setFloat64(off, n, true)` — which
          // writes the IEEE-754 bit pattern of the float, not the
          // integer's value. A caller passing a plain number (e.g. `42`)
          // for a u64 field silently corrupted the field into a garbage
          // huge integer (the float's bit pattern reinterpreted as u64)
          // rather than losing mere precision. Fixed by converting a
          // plain-number input to BigInt here, so this branch always
          // executes for 64-bit integer kinds no matter the input type.
          const big = typeof val === "bigint" ? val : BigInt(Math.trunc(n));
          if (kind === "i64" || kind === "isize") view.setBigInt64(off, big, true);
          else view.setBigUint64(off, big, true);
        } else {
          view.setFloat64(off, n, true);
        }
        break;
    }
  }

  return buf;
}

export function unmarshalStruct(
  t: AbiStructType,
  buf: Uint8Array,
  platform: TargetPlatform = PLATFORM_X64_SYSV
): Record<string, number | bigint> {
  const layout = computeLayout(t, platform);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const result: Record<string, number | bigint> = {};

  for (let idx = 0; idx < t.fields.length; idx++) {
    const field = t.fields[idx]!;
    const fieldLayout = layout.fields?.[idx];
    if (!fieldLayout) continue;

    const off = fieldLayout.offsetBytes;
    const kind = primKind(field.type);

    switch (fieldLayout.sizeBytes) {
      case 1:
        result[field.name] = kind === "i8" ? view.getInt8(off) : view.getUint8(off);
        break;
      case 2:
        result[field.name] = kind === "i16" ? view.getInt16(off, true) : view.getUint16(off, true);
        break;
      case 4:
        if (kind === "f32") result[field.name] = view.getFloat32(off, true);
        else if (kind === "i32" || kind === "isize") result[field.name] = view.getInt32(off, true);
        else result[field.name] = view.getUint32(off, true);
        break;
      case 8:
        if (kind === "f64") result[field.name] = view.getFloat64(off, true);
        else if (kind === "i64" || kind === "isize") result[field.name] = view.getBigInt64(off, true);
        else if (kind === "u64" || kind === "usize") result[field.name] = view.getBigUint64(off, true);
        else result[field.name] = view.getFloat64(off, true);
        break;
    }
  }

  return result;
}

// ── Call marshaling pipeline ───────────────────────────────────────────────

export type FfiCallDescriptor = {
  symbol: string;          // C function name
  params: FfiValue[];
  returnType: AbiType;
  ownership: FfiOwnership; // ownership of return value
};

export type FfiCallResult =
  | { ok: true;  value: FfiValue }
  | { ok: false; error: FfiError };

export type FfiError =
  | { kind: "symbol_not_found"; symbol: string }
  | { kind: "type_mismatch";    expected: string; got: string }
  | { kind: "null_dereference"; symbol: string }
  | { kind: "c_exception";      message: string }
  | { kind: "abi_version";      required: string; available: string };

// ── Callback registration ──────────────────────────────────────────────────

export type FfiCallback = {
  id: number;
  urFunction: string;     // UR function name
  cSignature: string;     // expected C type signature
  registered: boolean;
};

export class FfiCallbackRegistry {
  private callbacks = new Map<number, FfiCallback>();
  private nextId = 1;

  register(urFunction: string, cSignature: string): FfiCallback {
    const cb: FfiCallback = {
      id: this.nextId++,
      urFunction,
      cSignature,
      registered: true,
    };
    this.callbacks.set(cb.id, cb);
    return cb;
  }

  unregister(id: number): boolean {
    return this.callbacks.delete(id);
  }

  get(id: number): FfiCallback | undefined {
    return this.callbacks.get(id);
  }

  all(): FfiCallback[] {
    return [...this.callbacks.values()];
  }
}

// ── Memory arena for FFI temporaries ──────────────────────────────────────
// Allocations are freed as a batch at the end of an FFI call frame.

export class FfiArena {
  private allocations: Uint8Array[] = [];
  private totalBytes = 0;

  alloc(size: number): Uint8Array {
    const buf = new Uint8Array(size);
    this.allocations.push(buf);
    this.totalBytes += size;
    return buf;
  }

  allocString(s: string, encoding: StringEncoding): { buf: Uint8Array; byteLen: number } {
    const encoded = encodeString(s, encoding);
    const buf = this.alloc(encoded.bytes.length);
    buf.set(encoded.bytes);
    return { buf, byteLen: encoded.bytes.length };
  }

  reset(): void {
    this.allocations = [];
    this.totalBytes = 0;
  }

  get stats(): { allocationCount: number; totalBytes: number } {
    return { allocationCount: this.allocations.length, totalBytes: this.totalBytes };
  }
}

// ── Safety checker (pre-call validation) ──────────────────────────────────

export type SafetyViolation = {
  param: string;
  kind: "null_ptr" | "misaligned" | "out_of_bounds" | "invalid_enum";
  description: string;
};

export function checkFfiSafety(
  call: FfiCallDescriptor,
  knownEnumValues?: Map<string, Set<number>>
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];

  for (let i = 0; i < call.params.length; i++) {
    const p = call.params[i]!;
    const name = `param[${i}]`;

    if (p.data.kind === "ptr" && !p.data.nullable && p.data.addr === 0) {
      violations.push({ param: name, kind: "null_ptr", description: "non-nullable pointer is null" });
    }

    if (p.type.kind === "enum" && p.data.kind === "primitive") {
      const vals = knownEnumValues?.get(p.type.name);
      const v = Number(p.data.value);
      if (vals && !vals.has(v)) {
        violations.push({ param: name, kind: "invalid_enum", description: `${v} is not a valid ${p.type.name} variant` });
      }
    }
  }

  return violations;
}
