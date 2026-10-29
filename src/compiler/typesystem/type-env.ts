// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Type System: Type Environment
//
// Key design rule: `URType` is a TypeScript discriminated-union (type alias),
// not a class — so it must be imported with `import type`. Only VALUE exports
// from types.ts (the const T_* singletons and the t*() factory functions and
// the PRIMITIVES Set) are imported normally.
// ─────────────────────────────────────────────────────────────────────────────

import type { TypeRef } from "../frontend/ast.js";

// Import the TYPE alias with `import type` (erased at runtime).
import type { URType, PrimitiveKind } from "./types.js";

// Import ONLY runtime values (constants, functions, objects) normally.
import {
  PRIMITIVES,
  T_INT, T_FLOAT, T_BOOL, T_CHAR, T_STRING, T_BYTE, T_NATIVE_PTR,
  T_UNKNOWN, T_ERROR,
  tArray, tMap, tSet, tTuple, tOptional, tGenericParam,
} from "./types.js";

// ── TypeEnv: maps identifier names → resolved URType ─────────────────────────

export class TypeEnv {
  private bindings: Map<string, URType>;
  readonly parent: TypeEnv | undefined;

  constructor(parent?: TypeEnv) {
    this.parent = parent;
    this.bindings = new Map();
  }

  set(name: string, type: URType): void {
    this.bindings.set(name, type);
  }

  get(name: string): URType | undefined {
    return this.bindings.get(name) ?? this.parent?.get(name);
  }

  child(): TypeEnv {
    return new TypeEnv(this);
  }
}

// ── TypeRef → URType resolution ───────────────────────────────────────────────

/**
 * Resolves a TypeRef AST node (e.g. `Array<Int>`) into a URType object.
 *
 * onUnknown is called when a name is not recognized (caller emits TY1001).
 */
export function resolveTypeRef(
  ref: TypeRef,
  onUnknown?: (name: string) => void,
  knownStructs?: ReadonlyMap<string, URType>,
): URType {
  const base = resolveTypeRefBase(ref, onUnknown, knownStructs);
  // Compiler & Runtime Stabilization FIX — confirmed real bug: this
  // function previously never consulted `ref.arrayDepth` at all — every
  // bracket-suffix array type annotation (`int[]`, parsed by the Parser
  // into `TypeRef { name: "int", arrayDepth: 1 }` — see parser.ts's own
  // comment on this exact syntax) silently resolved to the plain
  // element type, dropping the array-ness entirely. Confirmed directly:
  // `let b: int[] = a` produced `TY2002: cannot assign Array<Int> to
  // 'b: Int'` — proving `b`'s OWN declared type resolved to `Int`, not
  // `Array<Int>`, even though the Parser correctly recorded
  // `arrayDepth: 1`. Same defect made array function parameters and
  // array return-type annotations both unusable (confirmed: `arr:
  // int[]` and `function f(): int[]` produced the identical class of
  // error). Fixed: wrap the resolved base type in `tArray()` once per
  // unit of `arrayDepth` (multi-dimensional arrays remain a separate,
  // already-documented TypeChecker-level restriction — see parser.ts's
  // own comment — not reopened by this fix).
  if (ref.arrayDepth) {
    let result = base;
    for (let i = 0; i < ref.arrayDepth; i++) result = tArray(result);
    return result;
  }
  return base;
}

function resolveTypeRefBase(
  ref: TypeRef,
  onUnknown?: (name: string) => void,
  knownStructs?: ReadonlyMap<string, URType>,
): URType {
  const name = ref.name;
  const rawArgs = ref.typeArgs ?? [];

  // Helper: resolve the i-th type arg, defaulting to T_UNKNOWN.
  function arg(i: number): URType {
    const a = rawArgs[i];
    return a ? resolveTypeRef(a, onUnknown, knownStructs) : T_UNKNOWN;
  }

  // Primitive names. UR_LANGUAGE_SPEC_1_0.md §6.1 mandates lowercase
  // canonical names ("int", "float", "bool", "char", "string") as the
  // external contract — ast.ts's CANONICAL_TYPE table produces exactly
  // these. The internal PrimitiveKind representation in types.ts remains
  // capitalized ("Int", "Float", ...) as an implementation detail RC2
  // already established; this mapping is the single translation point
  // between the two, so no other file needs to know about the casing
  // difference.
  //
  // Regression: discovered during Frontend/TypeSystem integration —
  // every typed UR 1.0 program (`a: int`) was reported as TY1001 "unknown
  // type 'int'" because PRIMITIVES only recognized the capitalized form.
  // Fixed here, at the single normalization boundary, rather than by
  // changing ast.ts (would violate the ratified spec) or types.ts
  // (would be a much larger, unjustified internal refactor).
  const LOWERCASE_PRIMITIVE: Record<string, PrimitiveKind> = {
    int: "Int", float: "Float", bool: "Bool", char: "Char", string: "String", byte: "Byte",
    // Native Pointer ABI Gate A: "nativeptr" is intentionally added to
    // this SAME general resolution table, not a separate, restricted
    // one - no existing mechanism here scopes a type name to
    // signatures.ur specifically (see types.ts's own comment on
    // T_NATIVE_PTR). It is technically resolvable in any .ur source,
    // not only FFI signature declarations - the "FFI-only" intent is
    // enforced by this type having zero supported operations anywhere
    // else in the compiler, not by a source-location restriction.
    nativeptr: "NativePtr",
  };
  if (name in LOWERCASE_PRIMITIVE) {
    switch (LOWERCASE_PRIMITIVE[name]) {
      case "Int":    return T_INT;
      case "Float":  return T_FLOAT;
      case "Bool":   return T_BOOL;
      case "Char":   return T_CHAR;
      case "String": return T_STRING;
      case "Byte":   return T_BYTE;
      case "NativePtr": return T_NATIVE_PTR;
    }
  }

  // Primitive names — PRIMITIVES is a runtime Set<string>, safe to use here.
  if (PRIMITIVES.has(name as "Int")) {       // cast is purely to satisfy TS
    switch (name) {
      case "Int":    return T_INT;
      case "Float":  return T_FLOAT;
      case "Bool":   return T_BOOL;
      case "Char":   return T_CHAR;
      case "String": return T_STRING;
      case "Byte":   return T_BYTE;
      case "NativePtr": return T_NATIVE_PTR;
    }
  }

  switch (name) {
    case "Array":    return tArray(arg(0));
    case "Map":      return tMap(arg(0), arg(1));
    case "Set":      return tSet(arg(0));
    case "Tuple":    return tTuple(rawArgs.map(a => resolveTypeRef(a, onUnknown)));
    case "Optional": return tOptional(arg(0));
  }

  // Single uppercase letter or T-prefixed ident → generic type parameter,
  // UNLESS that exact name is already a known, user-declared struct.
  // Remediation Design Gate, Option B (per direct instruction): this is a
  // targeted restriction of the heuristic's own definition, not a check
  // reordering (Option A) and not a Context-Driven resolution redesign
  // (Option C, deferred as a Future Architecture Candidate for an
  // independent Type Resolution Architecture Gate). A real struct
  // declared by the user always takes priority over the naming
  // convention, since UR has no user-facing generics syntax today.
  if ((/^[A-Z]$/.test(name) || /^T[A-Z0-9]/.test(name)) && !knownStructs?.has(name)) {
    return tGenericParam(name);
  }

  // Real fix (Blocker 4, per explicit direction): a struct declared
  // in this program (or imported and pre-resolved by the caller) IS
  // a known, valid type — check before declaring it "unknown". This
  // is the exact, minimal fix for the previously-logged TY1001 Bug:
  // TypeChecker's own structTypes map was already being built
  // correctly (see checker.ts's own hoisting pass) but was never
  // consulted here.
  if (knownStructs?.has(name)) {
    return knownStructs.get(name)!;
  }

  // Unknown type name — report and return error sentinel.
  if (onUnknown) onUnknown(name);
  return T_ERROR;
}

/** Resolves an optional TypeRef; returns T_UNKNOWN when undefined. */
export function resolveOptionalTypeRef(
  ref: TypeRef | undefined,
  onUnknown?: (name: string) => void,
  knownStructs?: ReadonlyMap<string, URType>,
): URType {
  return ref ? resolveTypeRef(ref, onUnknown, knownStructs) : T_UNKNOWN;
}
