// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: ABI Versioning + Compatibility
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  checkAbiCompatibility,
  abiVersionToString,
  compareAbiVersion,
  isAbiBackwardCompatible,
  mangleC,
  mangleUR,
} from "../../src/ffi/abi/versioning.js";
import type { AbiModule, AbiFunctionSignature, AbiType } from "../../src/ffi/abi/types.js";
import { CURRENT_ABI_VERSION } from "../../src/ffi/abi/types.js";

const V1: import("../../src/ffi/abi/types.js").AbiVersion = { major: 1, minor: 0, patch: 0 };
const V1_1: import("../../src/ffi/abi/types.js").AbiVersion = { major: 1, minor: 1, patch: 0 };
const V2: import("../../src/ffi/abi/types.js").AbiVersion = { major: 2, minor: 0, patch: 0 };

const i32: AbiType = { kind: "primitive", prim: "i32" };
const i64: AbiType = { kind: "primitive", prim: "i64" };
const void_: AbiType = { kind: "primitive", prim: "void" };

function makeFn(name: string, params: AbiType[], ret: AbiType): AbiFunctionSignature {
  return {
    name,
    mangledName: name,
    params: params.map((t, i) => ({ name: `p${i}`, type: t, passBy: "value" })),
    ret,
    convention: "C",
    noexcept: true,
    deprecated: false,
    since: V1,
  };
}

function makeModule(fns: AbiFunctionSignature[], types: AbiType[] = []): AbiModule {
  return { name: "test", version: V1, functions: fns, types, constants: [] };
}

describe("ABI Version — comparison", () => {
  it("equal versions compare as 0", () => {
    expect(compareAbiVersion(V1, V1)).toBe(0);
  });

  it("V1 < V1.1", () => {
    expect(compareAbiVersion(V1, V1_1)).toBe(-1);
  });

  it("V2 > V1", () => {
    expect(compareAbiVersion(V2, V1)).toBe(1);
  });

  it("formats version string", () => {
    expect(abiVersionToString(V1)).toBe("1.0.0");
    expect(abiVersionToString(V1_1)).toBe("1.1.0");
  });
});

describe("ABI Version — backward compatibility", () => {
  it("same major is backward compatible", () => {
    expect(isAbiBackwardCompatible(V1, V1_1)).toBe(true);
  });

  it("different major is NOT backward compatible", () => {
    expect(isAbiBackwardCompatible(V1, V2)).toBe(false);
  });

  it("older installed vs newer required = incompatible", () => {
    expect(isAbiBackwardCompatible(V1_1, V1)).toBe(false);
  });
});

describe("ABI Compatibility — functions", () => {
  it("identical modules are compatible", () => {
    const fn = makeFn("sqlite3_open", [i32], i32);
    const a = makeModule([fn]);
    const b = makeModule([fn]);
    const r = checkAbiCompatibility(a, b);
    expect(r.compatible).toBe(true);
  });

  it("removed function is a breaking change", () => {
    const fn = makeFn("sqlite3_open", [i32], i32);
    const a = makeModule([fn]);
    const b = makeModule([]);
    const r = checkAbiCompatibility(a, b);
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "function_removed")).toBe(true);
      expect(r.breaking[0]!.symbol).toBe("sqlite3_open");
    }
  });

  it("return type change is breaking", () => {
    const old = makeFn("get_value", [], i32);
    const new_ = makeFn("get_value", [], i64);
    const r = checkAbiCompatibility(makeModule([old]), makeModule([new_]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "return_type_changed")).toBe(true);
    }
  });

  it("parameter type change is breaking", () => {
    const old = makeFn("process", [i32], void_);
    const new_ = makeFn("process", [i64], void_);
    const r = checkAbiCompatibility(makeModule([old]), makeModule([new_]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "parameter_type_changed")).toBe(true);
    }
  });

  it("calling convention change is breaking", () => {
    const old = makeFn("cb", [], void_);
    const new_: AbiFunctionSignature = { ...old, convention: "win64" };
    const r = checkAbiCompatibility(makeModule([old]), makeModule([new_]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "calling_convention_changed")).toBe(true);
    }
  });

  it("adding a parameter is breaking", () => {
    const old = makeFn("init", [], void_);
    const new_ = makeFn("init", [i32], void_);
    const r = checkAbiCompatibility(makeModule([old]), makeModule([new_]));
    expect(r.compatible).toBe(false);
  });

  it("adding a NEW function is NOT breaking", () => {
    const old = makeFn("old_fn", [], void_);
    const new1 = makeFn("old_fn", [], void_);
    const new2 = makeFn("new_fn", [], void_);
    const r = checkAbiCompatibility(makeModule([old]), makeModule([new1, new2]));
    expect(r.compatible).toBe(true);
  });
});

describe("ABI Compatibility — structs", () => {
  it("struct size change is breaking", () => {
    const s1: AbiType = {
      kind: "struct", name: "Vec3",
      fields: [
        { name: "x", type: { kind: "primitive", prim: "f32" }, offsetBytes: 0 },
        { name: "y", type: { kind: "primitive", prim: "f32" }, offsetBytes: 4 },
      ],
      sizeBytes: 8, alignBytes: 4, packed: false, repr: "C",
    };
    const s2: AbiType = {
      kind: "struct", name: "Vec3",
      fields: [
        { name: "x", type: { kind: "primitive", prim: "f32" }, offsetBytes: 0 },
        { name: "y", type: { kind: "primitive", prim: "f32" }, offsetBytes: 4 },
        { name: "z", type: { kind: "primitive", prim: "f32" }, offsetBytes: 8 },
      ],
      sizeBytes: 12, alignBytes: 4, packed: false, repr: "C",
    };
    const r = checkAbiCompatibility(makeModule([], [s1]), makeModule([], [s2]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "type_layout_changed")).toBe(true);
    }
  });

  it("field removal is breaking", () => {
    const s1: AbiType = {
      kind: "struct", name: "Pair",
      fields: [
        { name: "a", type: i32, offsetBytes: 0 },
        { name: "b", type: i32, offsetBytes: 4 },
      ],
      sizeBytes: 8, alignBytes: 4, packed: false, repr: "C",
    };
    const s2: AbiType = {
      kind: "struct", name: "Pair",
      fields: [{ name: "a", type: i32, offsetBytes: 0 }],
      sizeBytes: 4, alignBytes: 4, packed: false, repr: "C",
    };
    const r = checkAbiCompatibility(makeModule([], [s1]), makeModule([], [s2]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "struct_field_removed" || br.kind === "type_layout_changed")).toBe(true);
    }
  });
});

describe("ABI Compatibility — enums", () => {
  it("discriminant type change is breaking", () => {
    const e1: AbiType = {
      kind: "enum", name: "Status",
      discriminantType: "i32",
      variants: [{ name: "Ok", value: 0 }, { name: "Err", value: 1 }],
      repr: "C",
    };
    const e2: AbiType = {
      kind: "enum", name: "Status",
      discriminantType: "i8",
      variants: [{ name: "Ok", value: 0 }, { name: "Err", value: 1 }],
      repr: "C",
    };
    const r = checkAbiCompatibility(makeModule([], [e1]), makeModule([], [e2]));
    expect(r.compatible).toBe(false);
  });

  it("variant removal is breaking", () => {
    const e1: AbiType = {
      kind: "enum", name: "Color",
      discriminantType: "i32",
      variants: [{ name: "Red", value: 0 }, { name: "Green", value: 1 }, { name: "Blue", value: 2 }],
      repr: "C",
    };
    const e2: AbiType = {
      kind: "enum", name: "Color",
      discriminantType: "i32",
      variants: [{ name: "Red", value: 0 }, { name: "Blue", value: 2 }],
      repr: "C",
    };
    const r = checkAbiCompatibility(makeModule([], [e1]), makeModule([], [e2]));
    expect(r.compatible).toBe(false);
    if (!r.compatible) {
      expect(r.breaking.some(br => br.kind === "enum_variant_removed")).toBe(true);
    }
  });

  it("adding new variants is NOT breaking", () => {
    const e1: AbiType = {
      kind: "enum", name: "Dir",
      discriminantType: "i32",
      variants: [{ name: "North", value: 0 }],
      repr: "C",
    };
    const e2: AbiType = {
      kind: "enum", name: "Dir",
      discriminantType: "i32",
      variants: [{ name: "North", value: 0 }, { name: "South", value: 1 }],
      repr: "C",
    };
    const r = checkAbiCompatibility(makeModule([], [e1]), makeModule([], [e2]));
    expect(r.compatible).toBe(true);
  });
});

describe("Symbol mangling", () => {
  it("C mangling is identity", () => {
    expect(mangleC("sqlite", "sqlite3_open")).toBe("sqlite3_open");
  });

  it("UR mangling includes module and params", () => {
    const name = mangleUR("math", "add", [i32, i32]);
    expect(name).toContain("_UR_");
    expect(name).toContain("math");
    expect(name).toContain("add");
  });

  it("UR mangling with no params has no trailing underscore noise", () => {
    const name = mangleUR("io", "flush", []);
    expect(name).toBe("_UR_io_flush");
  });
});
