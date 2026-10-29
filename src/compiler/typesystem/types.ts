// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Type System: Type Definitions
//
// Defines the UR type algebra:
//   Primitives : Int, Float, Bool, Char, String
//   Collections: Array<T>, Map<K,V>, Set<T>, Tuple<...Ts>, Optional<T>
//   Special    : Unknown (type not yet resolved), Never (unreachable),
//                ErrorType (propagation sentinel so one type error does not
//                cascade into hundreds of downstream errors)
//
// No dependency on src/compiler, src/runtime, src/cli, src/lsp, src/urpm.
// ─────────────────────────────────────────────────────────────────────────────

// ── Primitive kinds ────────────────────────────────────────────────────────────

export type PrimitiveKind = "Int" | "Float" | "Bool" | "Char" | "String" | "Byte" | "NativePtr";

export const PRIMITIVES = new Set<PrimitiveKind>(["Int", "Float", "Bool", "Char", "String", "Byte", "NativePtr"]);

// ── URType discriminated union ────────────────────────────────────────────────

export type URType =
  | PrimitiveType
  | ArrayType
  | MapType
  | SetType
  | TupleType
  | OptionalType
  | FunctionType
  | StructType
  | GenericParamType
  | UnknownType
  | NeverType
  | ErrorType;

/** A primitive scalar type: Int, Float, Bool, Char, String */
export interface PrimitiveType {
  kind: "Primitive";
  name: PrimitiveKind;
}

/** Array<element> */
export interface ArrayType {
  kind: "Array";
  element: URType;
}

/** Map<key, value> */
export interface MapType {
  kind: "Map";
  key: URType;
  value: URType;
}

/** Set<element> */
export interface SetType {
  kind: "Set";
  element: URType;
}

/** Tuple<t0, t1, ..., tN> */
export interface TupleType {
  kind: "Tuple";
  elements: URType[];
}

/** Optional<inner> — wraps any type to allow null */
export interface OptionalType {
  kind: "Optional";
  inner: URType;
}

/** fn(param1: T1, ...) -> R */
export interface FunctionType {
  kind: "Function";
  params: URType[];
  ret: URType;
}

/** A flat struct type (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2). Fields are in DECLARATION order — the same order used for structural comparison (§2.4) and positional construction (§2.7). Two StructTypes are the same type iff they have the same `name` (structs are nominal, not structural, for type-identity purposes — matching the fact that Level 2.8 has no anonymous struct types at all). */
export interface StructType {
  kind: "Struct";
  name: string;
  fields: readonly { name: string; type: URType }[];
}

/** A generic type parameter (e.g. T in fn identity<T>(x: T) -> T). */
export interface GenericParamType {
  kind: "GenericParam";
  name: string;
}

/** Type not yet inferred/resolved — used during incremental inference. */
export interface UnknownType {
  kind: "Unknown";
}

/** Type of an expression that can never produce a value (e.g. after return). */
export interface NeverType {
  kind: "Never";
}

/** Sentinel produced when a type error is detected, so downstream checks
 *  can suppress cascading errors by treating ErrorType as compatible with
 *  everything. */
export interface ErrorType {
  kind: "Error";
}

// ── Singleton factories ────────────────────────────────────────────────────────

export const T_INT:     PrimitiveType = Object.freeze({ kind: "Primitive", name: "Int"    });
export const T_FLOAT:   PrimitiveType = Object.freeze({ kind: "Primitive", name: "Float"  });
export const T_BOOL:    PrimitiveType = Object.freeze({ kind: "Primitive", name: "Bool"   });
export const T_CHAR:    PrimitiveType = Object.freeze({ kind: "Primitive", name: "Char"   });
export const T_STRING:  PrimitiveType = Object.freeze({ kind: "Primitive", name: "String" });
/** §6.1 Tier 1 (general-purpose) — per SPEC_IMPLEMENTATION_MATRIX.md's finding, `byte` was documented but entirely missing; added here as an independent, general-purpose Tier 1 primitive, deliberately NOT reusing Tier 2's FFI-specific `u8` machinery (see ADR_1_TIER2_TYPES_DECISION.md — Tier 1 and Tier 2 are kept cleanly separate by design). */
export const T_BYTE:    PrimitiveType = Object.freeze({ kind: "Primitive", name: "Byte"   });
// Native Pointer ABI — Gate A (Type Design, narrow scope, authorized):
// an opaque foreign-pointer handle for Native FFI boundaries only - no
// arithmetic, no dereference, no casts, no operators are wired up for
// it anywhere in this compiler (BINOP_MAP/UNOP_MAP and the checker's own
// operator-compatibility tables are deliberately left untouched) - its
// only supported operations are: declare (as a function parameter/return
// type), pass through as an argument, and return. This is deliberately
// NOT restricted to signatures.ur specifically - no existing mechanism
// in resolveTypeRef() scopes a type name to one specific source context,
// and building that restriction would itself be new gating logic beyond
// this Gate's "define the type and its constraints" scope - so the
// restriction is achieved by omission of any operation, not by an
// enforced source-location check. Flagged explicitly, not hidden.
export const T_NATIVE_PTR: PrimitiveType = Object.freeze({ kind: "Primitive", name: "NativePtr" });
export const T_UNKNOWN: UnknownType   = Object.freeze({ kind: "Unknown" });
export const T_NEVER:   NeverType     = Object.freeze({ kind: "Never" });
export const T_ERROR:   ErrorType     = Object.freeze({ kind: "Error" });

export function tArray(element: URType): ArrayType    { return { kind: "Array",    element };           }
export function tMap(key: URType, value: URType): MapType { return { kind: "Map", key, value };         }
export function tSet(element: URType): SetType        { return { kind: "Set",      element };           }
export function tTuple(elements: URType[]): TupleType { return { kind: "Tuple",    elements };          }
export function tOptional(inner: URType): OptionalType { return { kind: "Optional", inner };            }
export function tFunction(params: URType[], ret: URType): FunctionType { return { kind: "Function", params, ret }; }
export function tStruct(name: string, fields: readonly { name: string; type: URType }[]): StructType { return { kind: "Struct", name, fields }; }
export function tGenericParam(name: string): GenericParamType { return { kind: "GenericParam", name }; }

// ── Display ──────────────────────────────────────────────────────────────────

export function typeToString(t: URType): string {
  switch (t.kind) {
    case "Primitive":    return t.name;
    case "Array":        return `Array<${typeToString(t.element)}>`;
    case "Map":          return `Map<${typeToString(t.key)}, ${typeToString(t.value)}>`;
    case "Set":          return `Set<${typeToString(t.element)}>`;
    case "Tuple":        return `Tuple<${t.elements.map(typeToString).join(", ")}>`;
    case "Optional":     return `Optional<${typeToString(t.inner)}>`;
    case "Function":     return `fn(${t.params.map(typeToString).join(", ")}) -> ${typeToString(t.ret)}`;
    case "Struct":       return t.name;
    case "GenericParam": return t.name;
    case "Unknown":      return "Unknown";
    case "Never":        return "Never";
    case "Error":        return "<error>";
  }
}

// ── Structural equality ───────────────────────────────────────────────────────

export function typesEqual(a: URType, b: URType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "Primitive":    return (b as PrimitiveType).name === a.name;
    case "Array":        return typesEqual(a.element, (b as ArrayType).element);
    case "Map":          return typesEqual(a.key, (b as MapType).key) && typesEqual(a.value, (b as MapType).value);
    case "Set":          return typesEqual(a.element, (b as SetType).element);
    case "Optional":     return typesEqual(a.inner, (b as OptionalType).inner);
    case "GenericParam": return (b as GenericParamType).name === a.name;
    case "Tuple": {
      const bt = b as TupleType;
      return a.elements.length === bt.elements.length && a.elements.every((e, i) => typesEqual(e, bt.elements[i]!));
    }
    case "Function": {
      const bf = b as FunctionType;
      return typesEqual(a.ret, bf.ret) && a.params.length === bf.params.length && a.params.every((p, i) => typesEqual(p, bf.params[i]!));
    }
    case "Struct":       return (b as StructType).name === a.name;
    case "Unknown": case "Never": case "Error": return true;
  }
}

/** Is this type an error sentinel? */
export function isError(t: URType): t is ErrorType { return t.kind === "Error"; }
/** Is this type the unknown sentinel? */
export function isUnknown(t: URType): t is UnknownType { return t.kind === "Unknown"; }
/** True for Int or Float */
export function isNumeric(t: URType): boolean { return t.kind === "Primitive" && (t.name === "Int" || t.name === "Float"); }
