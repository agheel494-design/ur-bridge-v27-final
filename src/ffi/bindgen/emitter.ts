// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Binding Generator: UR Code Emitter
// Phase 6 — Stable ABI + FFI
// REWRITTEN per explicit "Fix UR Bindgen Generator" directive (Stage 2):
// this emitter now targets ONLY real UR v1.0 syntax — confirmed directly
// against the real lexer/parser/type-checker, not assumed. See
// issues/ffi-bindgen-generates-invalid-ur-syntax.md for the original defect
// this rewrite fixes (the prior version emitted `fn`/`module`/`pub`/`unsafe`/
// Rust-style pointers — none of which exist in UR v1.0).
// ─────────────────────────────────────────────────────────────────────────────
//
// Design constraints, confirmed directly against the real compiler before
// writing this emitter (not assumed):
//   - UR v1.0 has NO pointer type. Every C pointer/handle is represented as
//     `int` (an opaque numeric address) — the same representation this
//     project's own FFI runtime memory arena already uses internally
//     (bigint-typed handles).
//   - UR v1.0 has NO `extern`/`unsafe`/module-statement/visibility-modifier
//     syntax. Emitted functions are ordinary UR functions with an EMPTY body
//     (confirmed directly: an empty function body parses and typechecks
//     successfully) — honestly representing that no real FFI call mechanism
//     exists yet for user UR code to invoke; these are placeholder
//     signatures, not working bindings, until a language-level FFI
//     mechanism is designed (tracked separately, not part of this fix).
//   - UR v1.0 struct names CANNOT be used as an explicit parameter/return
//     type annotation (confirmed directly: produces TY2002/TY1001 — the
//     already-documented `named-type-annotations-not-resolved` limitation).
//     Struct declarations are still emitted (for documentation of a type's
//     real field layout), but every function signature uses only primitive
//     types — struct/opaque pointers become `int` handles.
//   - UR v1.0 has no `union`, no `enum` declaration, no function-pointer
//     type. C constructs using these are either skipped (with an explanatory
//     comment) or, for enums specifically, flattened into individual
//     top-level `let` constants (matching how UR already represents C
//     `#define` constants).
//
// Generated files are human-readable and can be checked into source control.

import type {
  AbiModule, AbiType, AbiFunctionSignature, AbiStructType,
  AbiEnumType, AbiUnionType, AbiConstant, AbiParam,
} from "../abi/types.js";
import { abiVersionToString } from "../abi/versioning.js";

// ── Type → UR type name (real UR v1.0 primitives only) ─────────────────────
//
// Returns null when a type cannot be represented in real UR v1.0 syntax at
// all (e.g. a function-pointer type) — callers use this to skip/comment out
// the affected declaration rather than emit invalid syntax.

function urTypeName(t: AbiType): string | null {
  switch (t.kind) {
    case "primitive":
      switch (t.prim) {
        case "void": return null; // handled specially by callers (empty return)
        case "bool": return "bool";
        case "i8": case "i16": case "i32": case "i64":
        case "u8": case "u16": case "u32": case "u64":
          return "int"; // UR's only general-purpose integer type
        case "f32": case "f64":
          return "float";
        default:
          return "int";
      }
    case "pointer":
    case "reference":
      // No pointer/reference type in UR v1.0 — represent as an opaque
      // numeric handle, matching this project's own FFI runtime convention.
      return "int";
    case "fnptr":
      // No function-pointer type in UR v1.0 — genuinely unrepresentable.
      return null;
    case "struct":
    case "union":
    case "enum":
      // Struct/union/enum NAMES cannot be used as parameter/return type
      // annotations (confirmed: TY2002/TY1001) — always use the opaque
      // handle representation in signatures, even though the struct's own
      // layout may separately be documented via emitStruct().
      return "int";
    case "array":
    case "slice":
      // No array-of-T parameter type support confirmed safe for arbitrary
      // element types in a function signature this generator controls —
      // conservatively treated as unrepresentable rather than guessing.
      return null;
    case "string":
      return "string";
  }
}

// ── Identifier sanitization (real UR v1.0 reserved keywords) ──────────────
//
// Confirmed directly against src/compiler/localization/en.ts's own keyword
// table — this is the complete, real list, not guessed. C identifiers are
// free to use words like `type`, `end`, `let` etc. as function/param/field/
// constant names; UR reserves these. Caught directly by this fix's own
// end-to-end test (a `type` struct field in a realistic OpenCV-like header
// produced real parse errors before this sanitization existed).

const UR_RESERVED_KEYWORDS = new Set([
  "function", "func", "let", "var", "type", "struct", "import", "return",
  "end", "if", "else", "while", "for", "break", "continue", "true", "false",
  "null", "in",
]);

function sanitizeIdent(name: string): string {
  return UR_RESERVED_KEYWORDS.has(name) ? `${name}_` : name;
}



function emitStruct(t: AbiStructType, out: string[]): boolean {
  // Only emit if every field is representable with a real UR primitive —
  // otherwise skip with an explanatory comment rather than emit a struct
  // with an invalid field type.
  const fieldTypes = t.fields.map(f => ({ f, urType: urTypeName(f.type) }));
  const unrepresentable = fieldTypes.filter(x => x.urType === null);
  if (unrepresentable.length > 0) {
    out.push(`// Struct '${t.name}' skipped: field(s) [${unrepresentable.map(x => x.f.name).join(", ")}] have no UR v1.0 representation.`);
    out.push("");
    return false;
  }
  out.push(`// C struct '${t.name}' — size: ${t.sizeBytes} bytes, align: ${t.alignBytes} bytes.`);
  out.push(`// NOTE: this struct's layout is documented here for reference only —`);
  out.push(`// it is NOT used as a parameter/return type anywhere in this file`);
  out.push(`// (UR v1.0 cannot resolve a struct name as an explicit type annotation —`);
  out.push(`// see issues/named-type-annotations-not-resolved.md). Opaque handles`);
  out.push(`// (represented as 'int') are used in every function signature instead.`);
  out.push(`struct ${sanitizeIdent(t.name)}`);
  for (const { f, urType } of fieldTypes) {
    out.push(`  ${sanitizeIdent(f.name)}: ${urType}`);
  }
  out.push(`end`);
  out.push("");
  return true;
}

// ── Union / Enum: no real UR v1.0 equivalent ────────────────────────────────

function emitUnion(t: AbiUnionType, out: string[]): void {
  out.push(`// Union '${t.name}' skipped: UR v1.0 has no union type.`);
  out.push("");
}

function emitEnum(t: AbiEnumType, out: string[]): void {
  out.push(`// C enum '${t.name}' — UR v1.0 has no enum declaration.`);
  out.push(`// Flattened into individual constants (matching how C #define`);
  out.push(`// constants are already represented):`);
  for (const v of t.variants) {
    out.push(`let ${sanitizeIdent(t.name)}_${sanitizeIdent(v.name)} = ${v.value}`);
  }
  out.push("");
}

// ── Constant emitter (top-level let — UR v1.0 has no 'const') ─────────────

function emitConstant(c: AbiConstant, out: string[]): boolean {
  const urType = urTypeName(c.type);
  if (urType === null) {
    out.push(`// Constant '${c.name}' skipped: no UR v1.0 representation for its type.`);
    return false;
  }
  // UR v1.0 has no 'const' keyword — top-level 'let' is the real, confirmed
  // equivalent (verified directly: parses and typechecks at module scope).
  out.push(`let ${sanitizeIdent(c.name)} = ${c.value}`);
  return true;
}

// ── Function emitter (real UR syntax, empty body — see module header) ─────

function emitFunction(fn: AbiFunctionSignature, out: string[]): boolean {
  const paramTypes = fn.params.map((p: AbiParam) => ({ p, urType: urTypeName(p.type) }));
  const unrepresentable = paramTypes.filter(x => x.urType === null);
  if (unrepresentable.length > 0) {
    out.push(`// Function '${fn.name}' skipped: parameter(s) [${unrepresentable.map(x => x.p.name).join(", ")}] have no UR v1.0 representation.`);
    out.push("");
    return false;
  }

  const params = paramTypes.map(({ p, urType }) => `${sanitizeIdent(p.name)}: ${urType}`).join(", ");
  const retType = urTypeName(fn.ret);
  const retClause = retType === null ? "" : `: ${retType}`;

  out.push(`// Mangled: ${fn.mangledName}`);
  out.push(`// NOTE: this is a PLACEHOLDER signature, not a working binding.`);
  out.push(`// UR v1.0 has no 'extern'/FFI-call mechanism for user code yet —`);
  out.push(`// this function's body is intentionally empty. See`);
  out.push(`// issues/ffi-bindgen-generates-invalid-ur-syntax.md for the`);
  out.push(`// language-level work this depends on.`);
  out.push(`function ${sanitizeIdent(fn.name)}(${params})${retClause}`);
  if (retType !== null) {
    out.push(`  return ${defaultReturnValue(retType)}`);
  }
  out.push(`end`);
  out.push("");
  return true;
}

function defaultReturnValue(urType: string): string {
  if (urType === "bool") return "false";
  if (urType === "float") return "0.0";
  if (urType === "string") return "\"\"";
  return "0";
}

// ── Main emitter ───────────────────────────────────────────────────────────

export type EmitOptions = {
  includeWrappers?: boolean;   // retained for API compatibility; no longer
                                // distinct from the main declaration, since
                                // UR v1.0 has no separate unsafe/safe-wrapper
                                // concept — always emits one declaration per
                                // function regardless of this option's value.
  includeComments?: boolean;   // emit doc comments (default: true)
  modulePath?: string;         // retained for API compatibility; UR v1.0 has
                                // no 'module' statement, so this is now only
                                // used in the header comment, not as syntax.
};

export function emitUrBindings(module: AbiModule, opts: EmitOptions = {}): string {
  const includeComments = opts.includeComments ?? true;
  const modulePath = opts.modulePath ?? module.name;

  const out: string[] = [];

  // Header (comment only — UR v1.0 has no 'module' statement)
  out.push(`// ────────────────────────────────────────────────────────────`);
  out.push(`// Auto-generated UR bindings for: ${module.name}`);
  out.push(`// Intended module path: ${modulePath} (informational only —`);
  out.push(`// UR v1.0 has no 'module' statement to declare this with)`);
  out.push(`// ABI version: ${abiVersionToString(module.version)}`);
  out.push(`// DO NOT EDIT — regenerate with: urpm bindgen ${module.name}`);
  out.push(`// ────────────────────────────────────────────────────────────`);
  out.push(``);

  // Constants
  if (module.constants.length > 0) {
    if (includeComments) out.push(`// ── Constants ─────────────────────────────────────────────`);
    for (const c of module.constants) emitConstant(c, out);
    out.push(``);
  }

  // Types (structs documented; unions/enums flattened or skipped, per the
  // constraints in this file's own header comment)
  if (module.types.length > 0) {
    if (includeComments) out.push(`// ── Types ─────────────────────────────────────────────────`);
    for (const t of module.types) {
      switch (t.kind) {
        case "struct": emitStruct(t, out); break;
        case "union":  emitUnion(t, out);  break;
        case "enum":   emitEnum(t, out);   break;
      }
    }
  }

  // Functions (real UR syntax, opaque-handle parameters, empty bodies)
  if (module.functions.length > 0) {
    if (includeComments) out.push(`// ── Functions (placeholder signatures — see notes above) ───`);
    for (const fn of module.functions) emitFunction(fn, out);
  }

  return out.join("\n");
}

// ── Emit TypeScript declaration file (for interop with TS host) ───────────

export function emitTsDeclarations(module: AbiModule): string {
  const out: string[] = [];
  out.push(`// Auto-generated TypeScript declarations for: ${module.name}`);
  out.push(`// ABI version: ${abiVersionToString(module.version)}`);
  out.push(``);

  for (const c of module.constants) {
    out.push(`export declare const ${c.name}: ${c.type.prim === "f64" ? "number" : "number"};`);
  }
  out.push(``);

  for (const fn of module.functions) {
    const params = fn.params
      .map((p: AbiParam) => `${p.name}: ${tsTypeName(p.type)}`)
      .join(", ");
    const ret = tsTypeName(fn.ret);
    out.push(`export declare function ${fn.name}(${params}): ${ret};`);
  }

  return out.join("\n");
}

function tsTypeName(t: AbiType): string {
  switch (t.kind) {
    case "primitive":
      if (t.prim === "void") return "void";
      if (t.prim === "bool") return "boolean";
      if (t.prim.startsWith("f")) return "number";
      if (t.prim === "i64" || t.prim === "u64") return "bigint";
      return "number";
    case "pointer":
    case "reference": return "number"; // WASM linear memory address
    case "string":    return "string";
    case "struct":
    case "union":
    case "enum":      return t.name;
    case "array":
    case "slice":     return `${tsTypeName(t.element)}[]`;
    case "fnptr":     return "Function";
  }
}
