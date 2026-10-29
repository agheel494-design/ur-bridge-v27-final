// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Stable ABI: Public API
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AbiVersion,
  AbiPrimitiveKind,
  AbiPrimitiveType,
  AbiPointerType,
  AbiReferenceType,
  AbiFunctionPointerType,
  AbiField,
  AbiStructType,
  AbiUnionType,
  AbiEnumType,
  AbiArrayType,
  AbiSliceType,
  AbiStringType,
  AbiType,
  CallingConvention,
  AbiParam,
  AbiFunctionSignature,
  AbiModule,
  AbiConstant,
  AbiCompatibility,
  AbiBreakageKind,
  AbiBreakage,
} from "./types.js";

export { CURRENT_ABI_VERSION } from "./types.js";

export type {
  LayoutResult,
  FieldLayout,
  TargetPlatform,
  LayoutVerification,
  FieldMismatch,
} from "./layout.js";

export {
  computeLayout,
  verifyStructLayout,
  buildStructType,
  PLATFORM_X64_SYSV,
  PLATFORM_X64_WIN64,
  PLATFORM_ARM64,
  PLATFORM_WASM32,
} from "./layout.js";

export {
  abiVersionToString,
  compareAbiVersion,
  isAbiBackwardCompatible,
  checkAbiCompatibility,
  mangleC,
  mangleUR,
} from "./versioning.js";
