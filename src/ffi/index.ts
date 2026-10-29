// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI: Public API
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────

// ABI
export * from "./abi/index.js";

// Binding Generator
export { parseCHeader, tokenizeCHeader } from "./bindgen/c-header-parser.js";
export type {
  CDecl, CTypeRef, CStructDecl, CEnumDecl, CFunctionDecl,
  CTypedef, CDefine, CHeader, CParseError, CField, CParam,
  CToken, CTokenKind, CEnumVariant,
} from "./bindgen/c-header-parser.js";

export { convertCHeaderToAbi } from "./bindgen/converter.js";
export type { BindgenOptions, BindgenResult } from "./bindgen/converter.js";

export { emitUrBindings, emitTsDeclarations } from "./bindgen/emitter.js";
export type { EmitOptions } from "./bindgen/emitter.js";

// FFI Runtime
export {
  encodeString,
  decodeString,
  marshalStruct,
  unmarshalStruct,
  FfiCallbackRegistry,
  FfiArena,
  checkFfiSafety,
} from "./runtime/memory.js";
export type {
  FfiOwnership, FfiValue, FfiData, FfiCallDescriptor,
  FfiCallResult, FfiError, FfiCallback, SafetyViolation,
  StringEncoding, EncodedString,
} from "./runtime/memory.js";

// urpm Native
export {
  makeNativePackageDb,
  resolveNativePackage,
  generateLinkerFlags,
  planNativeInstall,
  WELL_KNOWN_LIBRARIES,
} from "./urpm-native/native-packages.js";
export type {
  NativeLibFormat, NativePlatformTarget, NativeLibArtifact,
  NativePackageManifest, NativeRegistryEntry, NativePackageVersion,
  InstalledNativePackage, InstalledArtifact, NativePackageDb,
  NativeResolutionResult, NativeResolutionError, LinkerFlags,
  NativeInstallPlan, WellKnownLibrary, WellKnownLibraryInfo,
} from "./urpm-native/native-packages.js";

// Native platform executor factory
export { createPlatformExecutor } from "./native/executor-factory.js";
