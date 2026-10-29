import { describe, it, expect } from "vitest";
import { computeStructLayout } from "../../../src/compiler/typesystem/struct-layout-calculator.js";

describe("StructLayoutCalculator - the single, shared layout computation", () => {
  it("Scenario 1 (empty struct): size is exactly 0, alignment is exactly 1", () => {
    const layout = computeStructLayout("Empty", []);
    expect(layout.size).toBe(0);
    expect(layout.alignment).toBe(1);
    expect(layout.fields).toEqual([]);
  });

  it("Scenario 2 (single field): a single int field has size 8, alignment 8, offset 0", () => {
    const layout = computeStructLayout("Box", [{ name: "value", type: "i64" }]);
    expect(layout.size).toBe(8);
    expect(layout.alignment).toBe(8);
    expect(layout.fields[0]!.offset).toBe(0);
  });

  it("Scenario 3 (multi-field): matches STRUCT_MEMORY_LAYOUT.md's own worked example exactly - x@0, y@8, z@16, size=24, alignment=8", () => {
    const layout = computeStructLayout("Point", [
      { name: "x", type: "i64" },
      { name: "y", type: "bool" },
      { name: "z", type: "i64" },
    ]);
    expect(layout.fields[0]!.offset).toBe(0);
    expect(layout.fields[1]!.offset).toBe(8);
    expect(layout.fields[2]!.offset).toBe(16);
    expect(layout.size).toBe(24);
    expect(layout.alignment).toBe(8);
  });

  it("all-bool struct: alignment is 1, no padding needed between fields", () => {
    const layout = computeStructLayout("Flags", [
      { name: "a", type: "bool" },
      { name: "b", type: "bool" },
      { name: "c", type: "bool" },
    ]);
    expect(layout.fields[0]!.offset).toBe(0);
    expect(layout.fields[1]!.offset).toBe(1);
    expect(layout.fields[2]!.offset).toBe(2);
    expect(layout.size).toBe(3);
    expect(layout.alignment).toBe(1);
  });

  it("Scenario 4 (nested struct): outer struct's field offset accounts for the inner struct's own size/alignment, inline (not a pointer)", () => {
    const inner = computeStructLayout("Inner", [{ name: "v", type: "i64" }]);
    const outer = computeStructLayout("Outer", [
      { name: "a", type: "i64" },
      { name: "inner", type: "i64", nestedLayout: inner },
      { name: "b", type: "i64" },
    ]);
    expect(outer.fields[0]!.offset).toBe(0);
    expect(outer.fields[1]!.offset).toBe(8);
    expect(outer.fields[1]!.nestedLayout).toBe(inner);
    expect(outer.fields[2]!.offset).toBe(16);
    expect(outer.size).toBe(24);
  });

  it("field order is always declaration order, never reordered for packing efficiency", () => {
    const layout = computeStructLayout("Mixed", [
      { name: "flag1", type: "bool" },
      { name: "num", type: "i64" },
      { name: "flag2", type: "bool" },
    ]);
    expect(layout.fields.map(f => f.name)).toEqual(["flag1", "num", "flag2"]);
    expect(layout.fields[0]!.offset).toBe(0);
    expect(layout.fields[1]!.offset).toBe(8);
    expect(layout.fields[2]!.offset).toBe(16);
    expect(layout.size).toBe(24);
  });
});
