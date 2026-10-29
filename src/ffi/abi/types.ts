// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Stable ABI: Type System
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Defines the canonical ABI type representations that cross language boundaries.
// Once published as part of a versioned ABI, these MUST NOT change in a breaking way.

export type AbiVersion = {
  major: number; // breaking changes bump major
  minor: number; // additive changes bump minor
  patch: number; // bug fixes only
};

export const CURRENT_ABI_VERSION: AbiVersion = { major: 1, minor: 0, patch: 0 };

// ── Primitive Types ────────────────────────────────────────────────────────

export type AbiPrimitiveKind =
  | "void"
  | "bool"
  | "i8"  | "i16"  | "i32"  | "i64"  | "i128"
  | "u8"  | "u16"  | "u32"  | "u64"  | "u128"
  | "f32" | "f64"
  | "usize" | "isize"; // platform-width

export type AbiPrimitiveType = {
  kind: "primitive";
  prim: AbiPrimitiveKind;
};

// ── Pointer / Reference Types ──────────────────────────────────────────────

export type AbiPointerType = {
  kind: "pointer";
  pointee: AbiType;
  mutable: boolean;
  nullable: boolean; // corresponds to *T vs *?T
};

export type AbiReferenceType = {
  kind: "reference";
  pointee: AbiType;
  mutable: boolean;
  // references are always non-null
};

export type AbiFunctionPointerType = {
  kind: "fnptr";
  params: AbiType[];
  ret: AbiType;
  convention: CallingConvention;
};

// ── Aggregate Types ────────────────────────────────────────────────────────

export type AbiField = {
  name: string;
  type: AbiType;
  offsetBytes: number; // explicit — no implicit reordering allowed in stable ABI
};

export type AbiStructType = {
  kind: "struct";
  name: string;
  fields: AbiField[];
  sizeBytes: number;
  alignBytes: number;
  packed: boolean;
  repr: "C" | "UR"; // "C" = C-compatible layout
};

export type AbiUnionType = {
  kind: "union";
  name: string;
  variants: AbiField[];
  sizeBytes: number;  // = max(variant.sizeBytes)
  alignBytes: number;
  repr: "C";
};

export type AbiEnumType = {
  kind: "enum";
  name: string;
  discriminantType: AbiPrimitiveKind; // i32 by default
  variants: Array<{ name: string; value: number | bigint }>;
  repr: "C";
};

export type AbiArrayType = {
  kind: "array";
  element: AbiType;
  length: number; // fixed-size only; dynamic = slice
};

export type AbiSliceType = {
  kind: "slice";
  element: AbiType;
  // ABI layout: { data: *T, len: usize }
};

export type AbiStringType = {
  kind: "string";
  encoding: "utf8" | "utf16" | "ascii" | "cstr"; // cstr = null-terminated
};

export type AbiType =
  | AbiPrimitiveType
  | AbiPointerType
  | AbiReferenceType
  | AbiFunctionPointerType
  | AbiStructType
  | AbiUnionType
  | AbiEnumType
  | AbiArrayType
  | AbiSliceType
  | AbiStringType;

// ── Calling Conventions ────────────────────────────────────────────────────

export type CallingConvention =
  | "C"        // System V AMD64 ABI (Linux/macOS x86-64)
  | "win64"    // Microsoft x64 calling convention
  | "aapcs64"  // ARM64 (AArch64)
  | "wasm"     // WebAssembly
  | "ur";      // UR internal (not for FFI export)

// ── ABI Function Signature ─────────────────────────────────────────────────

export type AbiParam = {
  name: string;
  type: AbiType;
  passBy: "value" | "pointer" | "reference";
};

export type AbiFunctionSignature = {
  name: string;
  mangledName: string; // C-mangled export name
  params: AbiParam[];
  ret: AbiType;
  convention: CallingConvention;
  noexcept: boolean;   // C++ noexcept — important for FFI safety
  deprecated: boolean;
  since: AbiVersion;   // version this symbol was introduced
};

// ── ABI Module (stable versioned interface) ────────────────────────────────

export type AbiModule = {
  name: string;
  version: AbiVersion;
  functions: AbiFunctionSignature[];
  types: AbiType[];           // exported struct/enum/union types
  constants: AbiConstant[];
};

export type AbiConstant = {
  name: string;
  type: AbiPrimitiveType;
  value: number | bigint | boolean;
  since: AbiVersion;
};

// ── ABI Compatibility Check Result ────────────────────────────────────────

export type AbiCompatibility =
  | { compatible: true }
  | { compatible: false; breaking: AbiBreakage[] };

export type AbiBreakageKind =
  | "type_layout_changed"
  | "function_removed"
  | "parameter_type_changed"
  | "return_type_changed"
  | "calling_convention_changed"
  | "struct_field_removed"
  | "struct_field_reordered"
  | "enum_variant_removed"
  | "enum_discriminant_changed";

export type AbiBreakage = {
  kind: AbiBreakageKind;
  symbol: string;
  description: string;
};
