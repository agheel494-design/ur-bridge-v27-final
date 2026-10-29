// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Type System: Public API
// ─────────────────────────────────────────────────────────────────────────────

export { typeCheck } from "./checker.js";
export type { TypeCheckResult, TypeDiagnostic, TypeDiagSeverity } from "./type-diagnostics.js";
export { TCODES } from "./type-diagnostics.js";

export type {
  URType, PrimitiveKind,
  PrimitiveType, ArrayType, MapType, SetType, TupleType, OptionalType,
  FunctionType, GenericParamType, UnknownType, NeverType, ErrorType,
} from "./types.js";

export {
  PRIMITIVES,
  T_INT, T_FLOAT, T_BOOL, T_CHAR, T_STRING,
  T_UNKNOWN, T_NEVER, T_ERROR,
  tArray, tMap, tSet, tTuple, tOptional, tFunction, tGenericParam,
  typeToString, typesEqual, isError, isUnknown, isNumeric,
} from "./types.js";

export { isAssignable, isCompatible, binaryOpResultType, unaryOpResultType } from "./compatibility.js";
export { resolveTypeRef, resolveOptionalTypeRef, TypeEnv } from "./type-env.js";
