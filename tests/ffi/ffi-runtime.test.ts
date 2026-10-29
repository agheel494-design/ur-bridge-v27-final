// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: FFI Runtime (Memory, Marshaling, Safety)
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  encodeString, decodeString,
  marshalStruct, unmarshalStruct,
  FfiArena, FfiCallbackRegistry,
  checkFfiSafety,
} from "../../src/ffi/runtime/memory.js";
import { buildStructType, PLATFORM_X64_SYSV } from "../../src/ffi/abi/layout.js";
import type { FfiCallDescriptor, FfiValue } from "../../src/ffi/runtime/memory.js";
import type { AbiType } from "../../src/ffi/abi/types.js";

// ── String encoding ────────────────────────────────────────────────────────

describe("FFI Runtime — String encoding", () => {
  it("encodes UTF-8 string correctly", () => {
    const encoded = encodeString("hello", "utf8");
    expect(encoded.encoding).toBe("utf8");
    expect(encoded.bytes[0]).toBe(0x68); // 'h'
    expect(encoded.nullTerminated).toBe(false);
  });

  it("cstr encoding adds null terminator", () => {
    const encoded = encodeString("hi", "cstr");
    expect(encoded.bytes[2]).toBe(0); // null terminator
    expect(encoded.nullTerminated).toBe(true);
    expect(encoded.bytes.length).toBe(3);
  });

  it("decodes UTF-8 round-trip", () => {
    const s = "Hello, World!";
    const encoded = encodeString(s, "utf8");
    const decoded = decodeString(encoded.bytes, "utf8");
    expect(decoded).toBe(s);
  });

  it("decodes cstr stops at null", () => {
    const buf = new Uint8Array([65, 66, 67, 0, 68, 69]); // "ABC\0DE"
    expect(decodeString(buf, "cstr")).toBe("ABC");
  });

  it("encodes Arabic string as UTF-8", () => {
    const arabic = "مرحبا";
    const encoded = encodeString(arabic, "utf8");
    const decoded = decodeString(encoded.bytes, "utf8");
    expect(decoded).toBe(arabic);
  });

  it("encodes ASCII string", () => {
    const encoded = encodeString("test", "ascii");
    expect(encoded.encoding).toBe("ascii");
    expect(encoded.bytes[0]).toBe(116); // 't'
  });

  it("ASCII strips high bits", () => {
    // char code 0x90 → 0x10 after & 0x7f
    const buf = new Uint8Array([0x90, 0]);
    const s = decodeString(buf, "ascii");
    expect(s.charCodeAt(0)).toBe(0x10);
  });

  it("encodes UTF-16 string", () => {
    const s = "AB";
    const encoded = encodeString(s, "utf16");
    // UTF-16 LE: 0x41, 0x00, 0x42, 0x00, 0x00, 0x00
    expect(encoded.bytes[0]).toBe(0x41);
    expect(encoded.bytes[1]).toBe(0x00);
    expect(encoded.bytes[2]).toBe(0x42);
  });

  it("decodes UTF-16 string", () => {
    const s = "XY";
    const encoded = encodeString(s, "utf16");
    const decoded = decodeString(encoded.bytes, "utf16");
    expect(decoded).toBe(s);
  });

  it("empty string encodes to empty bytes (utf8)", () => {
    const encoded = encodeString("", "utf8");
    expect(encoded.bytes.length).toBe(0);
  });

  it("empty cstr encodes to single null byte", () => {
    const encoded = encodeString("", "cstr");
    expect(encoded.bytes.length).toBe(1);
    expect(encoded.bytes[0]).toBe(0);
  });
});

// ── Struct marshaling ──────────────────────────────────────────────────────

describe("FFI Runtime — Struct marshaling", () => {
  const Point2Type = buildStructType("Point2", [
    { name: "x", type: { kind: "primitive", prim: "i32" } },
    { name: "y", type: { kind: "primitive", prim: "i32" } },
  ], PLATFORM_X64_SYSV);

  it("marshals struct to bytes", () => {
    const buf = marshalStruct(Point2Type, { x: 10, y: 20 }, PLATFORM_X64_SYSV);
    const view = new DataView(buf.buffer);
    expect(view.getInt32(0, true)).toBe(10);
    expect(view.getInt32(4, true)).toBe(20);
  });

  it("unmarshals bytes to struct", () => {
    const buf = marshalStruct(Point2Type, { x: 42, y: -7 }, PLATFORM_X64_SYSV);
    const vals = unmarshalStruct(Point2Type, buf, PLATFORM_X64_SYSV);
    expect(Number(vals["x"]!)).toBe(42);
    expect(Number(vals["y"]!)).toBe(-7);
  });

  it("marshal/unmarshal round-trip", () => {
    const values = { x: 100, y: 200 };
    const buf = marshalStruct(Point2Type, values, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(Point2Type, buf, PLATFORM_X64_SYSV);
    expect(Number(result["x"]!)).toBe(100);
    expect(Number(result["y"]!)).toBe(200);
  });

  it("buffer size matches struct size", () => {
    const buf = marshalStruct(Point2Type, { x: 0, y: 0 }, PLATFORM_X64_SYSV);
    expect(buf.byteLength).toBe(Point2Type.sizeBytes);
  });

  it("marshals struct with padding", () => {
    const MixedType = buildStructType("Mixed", [
      { name: "flag", type: { kind: "primitive", prim: "u8" } },
      { name: "val",  type: { kind: "primitive", prim: "u32" } },
    ], PLATFORM_X64_SYSV);

    const buf = marshalStruct(MixedType, { flag: 1, val: 999 }, PLATFORM_X64_SYSV);
    const vals = unmarshalStruct(MixedType, buf, PLATFORM_X64_SYSV);
    expect(Number(vals["flag"]!)).toBe(1);
    expect(Number(vals["val"]!)).toBe(999);
  });
});

// ── i64/u64 BigInt/Number regression (Verification & Recovery Mission) ────────
//
// Bug: marshalStruct() only encoded 64-bit integer fields via
// setBigInt64/setBigUint64 when the caller passed a `bigint`. If a plain
// JS `number` was passed instead (a very plausible caller mistake, since
// small integers fit in either type), the code silently fell through to
// setFloat64(off, n, true) — writing the IEEE-754 bit pattern of the float
// instead of the integer's value. This was NOT mere precision loss; it was
// total data corruption (e.g. the number 42 became the u64 value
// 4631107791820423168). Fixed by always routing i64/u64/isize/usize kinds
// through setBigInt64/setBigUint64, converting a plain-number input to
// BigInt first when needed.

describe("FFI Runtime — i64/u64 BigInt/Number regression (data corruption fix)", () => {
  const U64Type = buildStructType("U64Holder", [
    { name: "value", type: { kind: "primitive", prim: "u64" } },
  ], PLATFORM_X64_SYSV);

  const I64Type = buildStructType("I64Holder", [
    { name: "value", type: { kind: "primitive", prim: "i64" } },
  ], PLATFORM_X64_SYSV);

  it("REGRESSION: u64 field passed as plain number round-trips correctly (was corrupted before fix)", () => {
    const buf = marshalStruct(U64Type, { value: 42 }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(U64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(42n);
  });

  it("REGRESSION: i64 field passed as plain number round-trips correctly", () => {
    const buf = marshalStruct(I64Type, { value: 1000 }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(I64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(1000n);
  });

  it("i64 field passed as negative plain number round-trips correctly", () => {
    const buf = marshalStruct(I64Type, { value: -12345 }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(I64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(-12345n);
  });

  it("u64 field passed as BigInt (large, beyond Number.MAX_SAFE_INTEGER) round-trips exactly", () => {
    const large = 18446744073709551615n; // u64 max
    const buf = marshalStruct(U64Type, { value: large }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(U64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(large);
  });

  it("i64 field passed as BigInt (min i64) round-trips exactly", () => {
    const min = -9223372036854775808n;
    const buf = marshalStruct(I64Type, { value: min }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(I64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(min);
  });

  it("u64 field passed as BigInt (max i64, within safe bigint range) round-trips exactly", () => {
    const val = 9223372036854775807n; // i64 max, valid u64 too
    const buf = marshalStruct(U64Type, { value: val }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(U64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(val);
  });

  it("zero as plain number for u64 round-trips correctly (not NaN or corrupted)", () => {
    const buf = marshalStruct(U64Type, { value: 0 }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(U64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).toBe(0n);
  });

  it("does NOT produce the specific historical corruption value for input 42", () => {
    // The exact corrupted value observed before the fix — asserting
    // against it directly makes any regression to the old behavior
    // impossible to miss.
    const buf = marshalStruct(U64Type, { value: 42 }, PLATFORM_X64_SYSV);
    const result = unmarshalStruct(U64Type, buf, PLATFORM_X64_SYSV);
    expect(result["value"]).not.toBe(4631107791820423168n);
    expect(result["value"]).toBe(42n);
  });
});

// ── FfiArena ──────────────────────────────────────────────────────────────

describe("FFI Runtime — FfiArena", () => {
  it("allocates buffer of given size", () => {
    const arena = new FfiArena();
    const buf = arena.alloc(64);
    expect(buf.byteLength).toBe(64);
  });

  it("tracks allocation stats", () => {
    const arena = new FfiArena();
    arena.alloc(32);
    arena.alloc(64);
    expect(arena.stats.allocationCount).toBe(2);
    expect(arena.stats.totalBytes).toBe(96);
  });

  it("reset clears all allocations", () => {
    const arena = new FfiArena();
    arena.alloc(100);
    arena.reset();
    expect(arena.stats.allocationCount).toBe(0);
    expect(arena.stats.totalBytes).toBe(0);
  });

  it("allocates and stores string", () => {
    const arena = new FfiArena();
    const { buf, byteLen } = arena.allocString("hello", "cstr");
    expect(byteLen).toBe(6); // 5 chars + null
    expect(buf[0]).toBe(0x68); // 'h'
    expect(buf[5]).toBe(0); // null terminator
  });

  it("multiple allocations are independent", () => {
    const arena = new FfiArena();
    const a = arena.alloc(4);
    const b = arena.alloc(4);
    a[0] = 0xAA;
    b[0] = 0xBB;
    expect(a[0]).toBe(0xAA);
    expect(b[0]).toBe(0xBB);
  });
});

// ── FfiCallbackRegistry ───────────────────────────────────────────────────

describe("FFI Runtime — FfiCallbackRegistry", () => {
  it("registers a callback and assigns id", () => {
    const reg = new FfiCallbackRegistry();
    const cb = reg.register("myUrFn", "void(*)(int)");
    expect(cb.id).toBeGreaterThan(0);
    expect(cb.urFunction).toBe("myUrFn");
    expect(cb.registered).toBe(true);
  });

  it("retrieves registered callback", () => {
    const reg = new FfiCallbackRegistry();
    const cb = reg.register("fn1", "int(*)(void)");
    const retrieved = reg.get(cb.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.urFunction).toBe("fn1");
  });

  it("unregisters callback", () => {
    const reg = new FfiCallbackRegistry();
    const cb = reg.register("fn", "void(*)(void)");
    expect(reg.unregister(cb.id)).toBe(true);
    expect(reg.get(cb.id)).toBeUndefined();
  });

  it("ids are unique", () => {
    const reg = new FfiCallbackRegistry();
    const ids = new Set(Array.from({ length: 50 }, () => reg.register("f", "void(*)(void)").id));
    expect(ids.size).toBe(50);
  });

  it("lists all callbacks", () => {
    const reg = new FfiCallbackRegistry();
    reg.register("a", "void(*)(void)");
    reg.register("b", "void(*)(void)");
    expect(reg.all()).toHaveLength(2);
  });
});

// ── Safety checker ─────────────────────────────────────────────────────────

describe("FFI Runtime — Safety checker", () => {
  const i32Type: AbiType = { kind: "primitive", prim: "i32" };
  const enumType: AbiType = {
    kind: "enum", name: "Dir",
    discriminantType: "i32",
    variants: [{ name: "North", value: 0 }, { name: "South", value: 1 }],
    repr: "C",
  };

  function makeCall(params: FfiValue[]): FfiCallDescriptor {
    return {
      symbol: "test_fn",
      params,
      returnType: i32Type,
      ownership: "borrowed",
    };
  }

  it("passes with valid non-null pointer", () => {
    const call = makeCall([{
      ownership: "borrowed",
      type: { kind: "pointer", pointee: i32Type, mutable: false, nullable: false },
      data: { kind: "ptr", addr: 0x1000, nullable: false },
    }]);
    expect(checkFfiSafety(call)).toHaveLength(0);
  });

  it("detects null non-nullable pointer", () => {
    const call = makeCall([{
      ownership: "borrowed",
      type: { kind: "pointer", pointee: i32Type, mutable: false, nullable: false },
      data: { kind: "ptr", addr: 0, nullable: false },
    }]);
    const violations = checkFfiSafety(call);
    expect(violations.some(v => v.kind === "null_ptr")).toBe(true);
  });

  it("allows null on nullable pointer", () => {
    const call = makeCall([{
      ownership: "borrowed",
      type: { kind: "pointer", pointee: i32Type, mutable: false, nullable: true },
      data: { kind: "ptr", addr: 0, nullable: true },
    }]);
    expect(checkFfiSafety(call)).toHaveLength(0);
  });

  it("detects invalid enum value", () => {
    const validValues = new Map([["Dir", new Set([0, 1])]]);
    const call = makeCall([{
      ownership: "borrowed",
      type: enumType,
      data: { kind: "primitive", value: 99 }, // 99 is not a valid Dir
    }]);
    const violations = checkFfiSafety(call, validValues);
    expect(violations.some(v => v.kind === "invalid_enum")).toBe(true);
  });

  it("passes valid enum value", () => {
    const validValues = new Map([["Dir", new Set([0, 1])]]);
    const call = makeCall([{
      ownership: "borrowed",
      type: enumType,
      data: { kind: "primitive", value: 1 },
    }]);
    expect(checkFfiSafety(call, validValues)).toHaveLength(0);
  });

  it("no violations on empty params", () => {
    const call = makeCall([]);
    expect(checkFfiSafety(call)).toHaveLength(0);
  });
});
