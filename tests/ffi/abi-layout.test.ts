// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: ABI Layout Engine
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  computeLayout, buildStructType, verifyStructLayout,
  PLATFORM_X64_SYSV, PLATFORM_WASM32, PLATFORM_ARM64,
} from "../../src/ffi/abi/layout.js";
import type { AbiStructType, AbiType } from "../../src/ffi/abi/types.js";

describe("ABI Layout — Primitives", () => {
  it("void has zero size", () => {
    const r = computeLayout({ kind: "primitive", prim: "void" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(0);
    expect(r.alignBytes).toBe(1);
  });

  it("bool is 1 byte", () => {
    const r = computeLayout({ kind: "primitive", prim: "bool" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(1);
  });

  it("i32 is 4 bytes aligned to 4", () => {
    const r = computeLayout({ kind: "primitive", prim: "i32" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(4);
    expect(r.alignBytes).toBe(4);
  });

  it("i64 is 8 bytes aligned to 8", () => {
    const r = computeLayout({ kind: "primitive", prim: "i64" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(8);
    expect(r.alignBytes).toBe(8);
  });

  it("i128 is 16 bytes aligned to 16", () => {
    const r = computeLayout({ kind: "primitive", prim: "i128" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(16);
    expect(r.alignBytes).toBe(16);
  });

  it("usize is pointer-width on x64", () => {
    const r = computeLayout({ kind: "primitive", prim: "usize" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(8);
    expect(r.alignBytes).toBe(8);
  });

  it("usize is 4 bytes on wasm32", () => {
    const r = computeLayout({ kind: "primitive", prim: "usize" }, PLATFORM_WASM32);
    expect(r.sizeBytes).toBe(4);
    expect(r.alignBytes).toBe(4);
  });
});

describe("ABI Layout — Pointers", () => {
  it("pointer is 8 bytes on x64", () => {
    const t: AbiType = {
      kind: "pointer",
      pointee: { kind: "primitive", prim: "i32" },
      mutable: false,
      nullable: true,
    };
    const r = computeLayout(t, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(8);
    expect(r.alignBytes).toBe(8);
  });

  it("pointer is 4 bytes on wasm32", () => {
    const t: AbiType = {
      kind: "pointer",
      pointee: { kind: "primitive", prim: "i32" },
      mutable: true,
      nullable: false,
    };
    const r = computeLayout(t, PLATFORM_WASM32);
    expect(r.sizeBytes).toBe(4);
  });
});

describe("ABI Layout — Structs (C-compatible)", () => {
  it("simple struct { u8, u32 } has padding", () => {
    // C layout: u8 at 0, 3 bytes padding, u32 at 4, total size = 8
    const t = buildStructType("Point2", [
      { name: "flags", type: { kind: "primitive", prim: "u8" } },
      { name: "value", type: { kind: "primitive", prim: "u32" } },
    ], PLATFORM_X64_SYSV);

    expect(t.fields[0]!.offsetBytes).toBe(0);
    expect(t.fields[1]!.offsetBytes).toBe(4);
    expect(t.sizeBytes).toBe(8);
    expect(t.alignBytes).toBe(4);
  });

  it("struct { i32, i64 } aligns i64 to 8", () => {
    const t = buildStructType("Mixed", [
      { name: "a", type: { kind: "primitive", prim: "i32" } },
      { name: "b", type: { kind: "primitive", prim: "i64" } },
    ], PLATFORM_X64_SYSV);

    expect(t.fields[0]!.offsetBytes).toBe(0);
    expect(t.fields[1]!.offsetBytes).toBe(8);
    expect(t.sizeBytes).toBe(16);
  });

  it("packed struct has no padding", () => {
    const t = buildStructType("Packed", [
      { name: "a", type: { kind: "primitive", prim: "u8" } },
      { name: "b", type: { kind: "primitive", prim: "u32" } },
    ], PLATFORM_X64_SYSV, true);

    expect(t.fields[0]!.offsetBytes).toBe(0);
    expect(t.fields[1]!.offsetBytes).toBe(1);
    expect(t.sizeBytes).toBe(5);
  });

  it("empty struct has size 0", () => {
    const t = buildStructType("Empty", [], PLATFORM_X64_SYSV);
    expect(t.sizeBytes).toBe(0);
  });

  it("struct size rounds up to alignment", () => {
    // { i64, u8 } → size = 16 (not 9), aligns to 8
    const t = buildStructType("Padded", [
      { name: "x", type: { kind: "primitive", prim: "i64" } },
      { name: "y", type: { kind: "primitive", prim: "u8" } },
    ], PLATFORM_X64_SYSV);
    expect(t.sizeBytes).toBe(16);
    expect(t.alignBytes).toBe(8);
  });

  it("nested struct preserves alignment", () => {
    const inner = buildStructType("Inner", [
      { name: "x", type: { kind: "primitive", prim: "f32" } },
      { name: "y", type: { kind: "primitive", prim: "f32" } },
    ], PLATFORM_X64_SYSV);

    const outer = buildStructType("Outer", [
      { name: "tag",   type: { kind: "primitive", prim: "u8" } },
      { name: "inner", type: inner },
    ], PLATFORM_X64_SYSV);

    expect(outer.fields[1]!.offsetBytes).toBe(4); // aligned to f32 (4)
    expect(outer.sizeBytes).toBe(12);
  });
});

describe("ABI Layout — Arrays", () => {
  it("array of i32[4] is 16 bytes", () => {
    const t: AbiType = {
      kind: "array",
      element: { kind: "primitive", prim: "i32" },
      length: 4,
    };
    const r = computeLayout(t, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(16);
    expect(r.alignBytes).toBe(4);
  });
});

describe("ABI Layout — Slices", () => {
  it("slice is { ptr, len } = 16 bytes on x64", () => {
    const t: AbiType = { kind: "slice", element: { kind: "primitive", prim: "u8" } };
    const r = computeLayout(t, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(16);
    expect(r.alignBytes).toBe(8);
  });

  it("slice is 8 bytes on wasm32", () => {
    const t: AbiType = { kind: "slice", element: { kind: "primitive", prim: "u8" } };
    const r = computeLayout(t, PLATFORM_WASM32);
    expect(r.sizeBytes).toBe(8);
  });
});

describe("ABI Layout — Strings", () => {
  it("cstr is a pointer", () => {
    const r = computeLayout({ kind: "string", encoding: "cstr" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(8);
  });

  it("utf8 string is fat pointer { data, len, cap }", () => {
    const r = computeLayout({ kind: "string", encoding: "utf8" }, PLATFORM_X64_SYSV);
    expect(r.sizeBytes).toBe(24); // 3 × 8
  });
});

describe("ABI Layout — verifyStructLayout", () => {
  it("passes when declared offsets match computed", () => {
    const t: AbiStructType = {
      kind: "struct",
      name: "Verified",
      fields: [
        { name: "a", type: { kind: "primitive", prim: "u32" }, offsetBytes: 0 },
        { name: "b", type: { kind: "primitive", prim: "u32" }, offsetBytes: 4 },
      ],
      sizeBytes: 8,
      alignBytes: 4,
      packed: false,
      repr: "C",
    };
    const result = verifyStructLayout(t, PLATFORM_X64_SYSV);
    expect(result.ok).toBe(true);
  });

  it("fails when declared offsets are wrong", () => {
    const t: AbiStructType = {
      kind: "struct",
      name: "Wrong",
      fields: [
        { name: "a", type: { kind: "primitive", prim: "u8" },  offsetBytes: 0 },
        { name: "b", type: { kind: "primitive", prim: "u32" }, offsetBytes: 1 }, // wrong: should be 4
      ],
      sizeBytes: 8,
      alignBytes: 4,
      packed: false,
      repr: "C",
    };
    const result = verifyStructLayout(t, PLATFORM_X64_SYSV);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatches).toHaveLength(1);
      expect(result.mismatches[0]!.field).toBe("b");
      expect(result.mismatches[0]!.declaredOffset).toBe(1);
      expect(result.mismatches[0]!.computedOffset).toBe(4);
    }
  });
});
