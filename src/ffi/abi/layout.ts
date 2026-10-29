// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Stable ABI: Layout Engine
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Computes deterministic, C-compatible memory layouts for all ABI types.
// Layout results are FROZEN once published — the engine must never change
// how it computes offsets for existing types.

import type {
  AbiType,
  AbiStructType,
  AbiUnionType,
  AbiArrayType,
  AbiSliceType,
  AbiPrimitiveKind,
  AbiField,
} from "./types.js";

export type LayoutResult = {
  sizeBytes: number;
  alignBytes: number;
  fields?: FieldLayout[]; // only for structs/unions
};

export type FieldLayout = {
  name: string;
  offsetBytes: number;
  sizeBytes: number;
  alignBytes: number;
};

// ── Target Platform ────────────────────────────────────────────────────────

export type TargetPlatform = {
  pointerBytes: number;  // 4 = 32-bit, 8 = 64-bit
  convention: "sysv"   | "win64" | "aapcs64" | "wasm32";
};

export const PLATFORM_X64_SYSV: TargetPlatform  = { pointerBytes: 8, convention: "sysv" };
export const PLATFORM_X64_WIN64: TargetPlatform = { pointerBytes: 8, convention: "win64" };
export const PLATFORM_ARM64: TargetPlatform     = { pointerBytes: 8, convention: "aapcs64" };
export const PLATFORM_WASM32: TargetPlatform    = { pointerBytes: 4, convention: "wasm32" };

// ── Primitive Sizes ────────────────────────────────────────────────────────

function primitiveLayout(prim: AbiPrimitiveKind, platform: TargetPlatform): LayoutResult {
  switch (prim) {
    case "void":   return { sizeBytes: 0, alignBytes: 1 };
    case "bool":   return { sizeBytes: 1, alignBytes: 1 };
    case "i8":
    case "u8":     return { sizeBytes: 1, alignBytes: 1 };
    case "i16":
    case "u16":    return { sizeBytes: 2, alignBytes: 2 };
    case "i32":
    case "u32":
    case "f32":    return { sizeBytes: 4, alignBytes: 4 };
    case "i64":
    case "u64":
    case "f64":    return { sizeBytes: 8, alignBytes: 8 };
    case "i128":
    case "u128":   return { sizeBytes: 16, alignBytes: 16 };
    case "usize":
    case "isize":  return { sizeBytes: platform.pointerBytes, alignBytes: platform.pointerBytes };
  }
}

// ── Alignment helpers ──────────────────────────────────────────────────────

function alignUp(offset: number, align: number): number {
  return Math.ceil(offset / align) * align;
}

// ── Struct Layout (C-compatible) ───────────────────────────────────────────

function layoutStruct(t: AbiStructType, platform: TargetPlatform): LayoutResult {
  if (t.packed) return layoutPackedStruct(t, platform);

  const fieldLayouts: FieldLayout[] = [];
  let offset = 0;
  let maxAlign = 1;

  for (const field of t.fields) {
    const fl = computeLayout(field.type, platform);
    offset = alignUp(offset, fl.alignBytes);
    maxAlign = Math.max(maxAlign, fl.alignBytes);
    fieldLayouts.push({
      name: field.name,
      offsetBytes: offset,
      sizeBytes: fl.sizeBytes,
      alignBytes: fl.alignBytes,
    });
    offset += fl.sizeBytes;
  }

  // Final padding so sizeof(Struct) % alignof(Struct) == 0
  const totalSize = alignUp(offset, maxAlign);

  return {
    sizeBytes: totalSize,
    alignBytes: maxAlign,
    fields: fieldLayouts,
  };
}

function layoutPackedStruct(t: AbiStructType, platform: TargetPlatform): LayoutResult {
  const fieldLayouts: FieldLayout[] = [];
  let offset = 0;

  for (const field of t.fields) {
    const fl = computeLayout(field.type, platform);
    fieldLayouts.push({
      name: field.name,
      offsetBytes: offset,
      sizeBytes: fl.sizeBytes,
      alignBytes: 1,
    });
    offset += fl.sizeBytes;
  }

  return { sizeBytes: offset, alignBytes: 1, fields: fieldLayouts };
}

// ── Union Layout ───────────────────────────────────────────────────────────

function layoutUnion(t: AbiUnionType, platform: TargetPlatform): LayoutResult {
  let maxSize = 0;
  let maxAlign = 1;
  const fieldLayouts: FieldLayout[] = [];

  for (const v of t.variants) {
    const fl = computeLayout(v.type, platform);
    maxSize  = Math.max(maxSize, fl.sizeBytes);
    maxAlign = Math.max(maxAlign, fl.alignBytes);
    fieldLayouts.push({ name: v.name, offsetBytes: 0, sizeBytes: fl.sizeBytes, alignBytes: fl.alignBytes });
  }

  const totalSize = alignUp(maxSize, maxAlign);
  return { sizeBytes: totalSize, alignBytes: maxAlign, fields: fieldLayouts };
}

// ── Array Layout ───────────────────────────────────────────────────────────

function layoutArray(t: AbiArrayType, platform: TargetPlatform): LayoutResult {
  const el = computeLayout(t.element, platform);
  return {
    sizeBytes: el.sizeBytes * t.length,
    alignBytes: el.alignBytes,
  };
}

// ── Slice Layout: { data: *T, len: usize } ─────────────────────────────────

function layoutSlice(t: AbiSliceType, platform: TargetPlatform): LayoutResult {
  const ptr = platform.pointerBytes;
  return { sizeBytes: ptr * 2, alignBytes: ptr };
}

// ── Main entry ─────────────────────────────────────────────────────────────

export function computeLayout(t: AbiType, platform: TargetPlatform): LayoutResult {
  switch (t.kind) {
    case "primitive":  return primitiveLayout(t.prim, platform);
    case "pointer":
    case "reference":
    case "fnptr":      return { sizeBytes: platform.pointerBytes, alignBytes: platform.pointerBytes };
    case "struct":     return layoutStruct(t, platform);
    case "union":      return layoutUnion(t, platform);
    case "enum": {
      const disc = primitiveLayout(t.discriminantType, platform);
      return { sizeBytes: disc.sizeBytes, alignBytes: disc.alignBytes };
    }
    case "array":      return layoutArray(t, platform);
    case "slice":      return layoutSlice(t, platform);
    case "string": {
      if (t.encoding === "cstr") {
        return { sizeBytes: platform.pointerBytes, alignBytes: platform.pointerBytes };
      }
      // UR strings: { data: *u8, len: usize, cap: usize }
      return { sizeBytes: platform.pointerBytes * 3, alignBytes: platform.pointerBytes };
    }
  }
}

// ── Verify explicit offsets match computed layout ──────────────────────────

export type LayoutVerification =
  | { ok: true }
  | { ok: false; mismatches: FieldMismatch[] };

export type FieldMismatch = {
  field: string;
  declaredOffset: number;
  computedOffset: number;
};

export function verifyStructLayout(
  t: AbiStructType,
  platform: TargetPlatform
): LayoutVerification {
  const result = computeLayout(t, platform);
  const mismatches: FieldMismatch[] = [];

  if (result.fields) {
    for (let i = 0; i < t.fields.length; i++) {
      const declared = t.fields[i]!;
      const computed = result.fields[i]!;
      if (declared.offsetBytes !== computed.offsetBytes) {
        mismatches.push({
          field: declared.name,
          declaredOffset: declared.offsetBytes,
          computedOffset: computed.offsetBytes,
        });
      }
    }
  }

  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}

// ── Build AbiStructType from field declarations (auto-compute offsets) ─────

export function buildStructType(
  name: string,
  fields: Omit<AbiField, "offsetBytes">[],
  platform: TargetPlatform,
  packed = false
): AbiStructType {
  // First pass: build a dummy struct to compute layout
  const dummy: AbiStructType = {
    kind: "struct",
    name,
    fields: fields.map(f => ({ ...f, offsetBytes: 0 })),
    sizeBytes: 0,
    alignBytes: 0,
    packed,
    repr: "C",
  };

  const result = computeLayout(dummy, platform);

  return {
    kind: "struct",
    name,
    fields: fields.map((f, i) => ({
      ...f,
      offsetBytes: result.fields![i]!.offsetBytes,
    })),
    sizeBytes: result.sizeBytes,
    alignBytes: result.alignBytes,
    packed,
    repr: "C",
  };
}
