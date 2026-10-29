// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — AST
// Specification: UR_LANGUAGE_SPEC_1_0.md
// ─────────────────────────────────────────────────────────────────────────────
//
// This AST is 90% identical to RC2's AST so that RC2's Semantic Analyzer,
// Type System, and Module System can be reused without modification.
//
// Key differences from RC2 AST:
//   1. Program has no ModuleDecl (UR 1.0 has no `module` keyword at top-level)
//   2. ImportDecl.path is string[] (identifier path) not a string literal
//   3. FunctionDecl uses UR 1.0 keywords internally (surface text is irrelevant
//      past the Parser — both "دالة" and "function" produce FunctionDecl)
//   4. SwitchStatement and TryCatchStatement are present for RC2 compatibility
//      but the UR 1.0 Parser never produces them (reserved for Spec 1.1)
//   5. IfExpression: `if` can appear as an expression (UR 1.0 §5.6);
//      represented as ConditionalExpression for compatibility
//
// SourceSpan uses code-point column offsets, matching the Lexer's Span type.
// ─────────────────────────────────────────────────────────────────────────────

export interface SourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Node {
  span: SourceSpan;
}

// ── Program ───────────────────────────────────────────────────────────────────

export interface Program extends Node {
  kind: "Program";
  /** Always empty in UR 1.0 (no `module` keyword). Kept for RC2 compatibility. */
  modules: ModuleDecl[];
  functions: FunctionDecl[];
  /** Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.1 — flat structs, no nesting. */
  structs: StructDecl[];
  /** Per SPEC_IMPLEMENTATION_MATRIX.md's `type` alias finding (§5.11) — pure compile-time aliases, e.g. `type MyInt = int`. Resolved entirely by the Type Checker; Lowering/Backends never see this declaration kind. */
  typeAliases: TypeAliasDecl[];
  globals: GlobalVariableDecl[];
  imports: ImportDecl[];
  /** Statements at the top level that are not declarations (scripts). */
  body: Statement[];
}

/** Kept for RC2 Semantic compatibility — not produced by UR 1.0 Parser. */
export interface ModuleDecl extends Node {
  kind: "ModuleDecl";
  name: string;
}

export interface ImportDecl extends Node {
  kind: "ImportDecl";
  /**
   * Module path as an identifier sequence.
   * `import math`          → path: ["math"]
   * `import std.io`        → path: ["std", "io"]
   * `استورد حساب`         → path: ["حساب"]
   */
  path: string[];
  alias?: string | undefined;
}

export interface GlobalVariableDecl extends Node {
  kind: "GlobalVariableDecl";
  name: string;
  isConst: boolean;
  type?: TypeRef | undefined;
  initializer?: Expression | undefined;
}

// ── Function ──────────────────────────────────────────────────────────────────

export interface FunctionDecl extends Node {
  kind: "FunctionDecl";
  name: string;
  params: Param[];
  returnType?: TypeRef | undefined;
  body: BlockStatement;
}

export interface Param extends Node {
  kind: "Param";
  name: string;
  type?: TypeRef | undefined;
}

// ── Struct (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2) ──────────────────────
//
// Flat only: every field must be a primitive scalar type. No nested
// structs, no array-typed fields (§2.6 of the ratified spec) — enforced
// by Semantic Analyzer, not by this AST shape itself (the AST allows any
// TypeRef in a field for now, exactly like Param already does; Semantic
// is where the "primitive scalar only" restriction is actually checked).

export interface StructDecl extends Node {
  kind: "StructDecl";
  name: string;
  fields: StructField[];
}

/** §5.11 — `type NAME = type_expr`. Pure compile-time alias; only the Type Checker consumes this (via resolveTypeRef registering `name` against `aliasedType`). Never reaches Lowering. */
export interface TypeAliasDecl extends Node {
  kind: "TypeAliasDecl";
  name: string;
  aliasedType: TypeRef;
}

export interface StructField extends Node {
  kind: "StructField";
  name: string;
  type: TypeRef;
}

export interface TypeRef extends Node {
  kind: "TypeRef";
  /** Canonical type name: "int" not "عدد" (canonicalized during parsing). Never includes "[]" — array-ness is tracked separately in arrayDepth. */
  name: string;
  typeArgs?: TypeRef[] | undefined;
  /** Number of `[]` suffixes (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1.2). 0/undefined = not an array. Parses to any depth structurally (`int[][]` -> 2), even though Level 2.8's TypeChecker only ever ACCEPTS depth 1 — depth > 1 is parsed but rejected later, never a Parser/Grammar restriction. */
  arrayDepth?: number | undefined;
}

// ── Statements ────────────────────────────────────────────────────────────────

export type Statement =
  | VariableDeclaration
  | Assignment
  | IfStatement
  | WhileStatement
  | ForStatement
  | SwitchStatement      // reserved for Spec 1.1 — not produced by UR 1.0 Parser
  | TryCatchStatement    // reserved for Spec 1.1 — not produced by UR 1.0 Parser
  | BreakStatement
  | ContinueStatement
  | ReturnStatement
  | ExpressionStatement
  | BlockStatement;

export interface BlockStatement extends Node {
  kind: "BlockStatement";
  statements: Statement[];
}

export interface VariableDeclaration extends Node {
  kind: "VariableDeclaration";
  name: string;
  isConst: boolean;
  type?: TypeRef | undefined;
  initializer?: Expression | undefined;
}

export interface Assignment extends Node {
  kind: "Assignment";
  operator: string;  // "=" | "+=" | "-=" | "*=" | "/=" | "%="
  target: Expression;
  value: Expression;
}

export interface IfStatement extends Node {
  kind: "IfStatement";
  condition: Expression;
  thenBranch: BlockStatement;
  elseBranch?: BlockStatement | IfStatement | undefined;
}

export interface WhileStatement extends Node {
  kind: "WhileStatement";
  condition: Expression;
  body: BlockStatement;
}

export interface ForStatement extends Node {
  kind: "ForStatement";
  binding: string;
  iterable: Expression;
  body: BlockStatement;
}

/** Reserved for Spec 1.1. Not produced by UR 1.0 Parser. */
export interface SwitchCase extends Node {
  kind: "SwitchCase";
  test?: Expression | undefined;
  body: Statement[];
}

/** Reserved for Spec 1.1. */
export interface SwitchStatement extends Node {
  kind: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

/** Reserved for Spec 1.1. */
export interface TryCatchStatement extends Node {
  kind: "TryCatchStatement";
  tryBlock: BlockStatement;
  catchParam?: string | undefined;
  catchBlock?: BlockStatement | undefined;
  finallyBlock?: BlockStatement | undefined;
}

export interface BreakStatement    extends Node { kind: "BreakStatement" }
export interface ContinueStatement extends Node { kind: "ContinueStatement" }

export interface ReturnStatement extends Node {
  kind: "ReturnStatement";
  value?: Expression | undefined;
}

export interface ExpressionStatement extends Node {
  kind: "ExpressionStatement";
  expression: Expression;
}

// ── Expressions ───────────────────────────────────────────────────────────────

export type Expression =
  | Identifier
  | IntLiteral
  | FloatLiteral
  | StringLiteral
  | CharLiteral
  | BoolLiteral
  | NullLiteral
  | ArrayLiteral
  | UnaryExpression
  | BinaryExpression
  | ConditionalExpression
  | CallExpression
  | MemberExpression
  | IndexExpression;

/** Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1.1 — `[1, 2, 3]`. Element type is inferred by the Type Checker from the elements; not annotated here. */
export interface ArrayLiteral extends Node {
  kind: "ArrayLiteral";
  elements: Expression[];
}

export interface Identifier extends Node {
  kind: "Identifier";
  name: string;
}

export interface IntLiteral extends Node {
  kind: "IntLiteral";
  value: number;
  raw: string;
}

export interface FloatLiteral extends Node {
  kind: "FloatLiteral";
  value: number;
  raw: string;
}

export interface StringLiteral extends Node {
  kind: "StringLiteral";
  value: string;
  raw: string;
}

/** Per SPEC_IMPLEMENTATION_MATRIX.md's `char` literal finding — a single Unicode scalar value, distinct from StringLiteral so the Type Checker can assign T_CHAR (not T_STRING) to it directly. */
export interface CharLiteral extends Node {
  kind: "CharLiteral";
  value: string; // exactly one Unicode scalar value, enforced by the Lexer (LE005)
  raw: string;
}

export interface BoolLiteral extends Node {
  kind: "BoolLiteral";
  value: boolean;
}

export interface NullLiteral extends Node {
  kind: "NullLiteral";
}

export interface UnaryExpression extends Node {
  kind: "UnaryExpression";
  operator: "-" | "!" ;
  operand: Expression;
}

export interface BinaryExpression extends Node {
  kind: "BinaryExpression";
  /** "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||" */
  operator: string;
  left: Expression;
  right: Expression;
}

/**
 * `if condition thenBranch else elseBranch end` used as an expression.
 * Also represents RC2's `condition ? consequent : alternate` ternary.
 * The Semantic Analyzer sees this as a single unified conditional expression.
 */
export interface ConditionalExpression extends Node {
  kind: "ConditionalExpression";
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression extends Node {
  kind: "CallExpression";
  callee: Expression;
  args: Expression[];
}

export interface MemberExpression extends Node {
  kind: "MemberExpression";
  object: Expression;
  property: string;
}

export interface IndexExpression extends Node {
  kind: "IndexExpression";
  object: Expression;
  index: Expression;
}

// ── Type name canonicalization ─────────────────────────────────────────────────

/**
 * Maps user-facing type names (both Arabic and English) to the canonical
 * name stored in TypeRef.name. Called by the Parser during AST construction.
 */
/**
 * OFFICIAL DECISION (final, not a half-translated ambiguous state):
 * type NAMES (int/float/bool/string/char/byte/null/void) are translated
 * ONLY for Arabic and English (Tier 1). Every other localized language
 * (zh/ja/fr/de/es/ru/pt/hi and any future addition) uses these type
 * names in ENGLISH, unconditionally — keywords (function/let/return/
 * end/if/while/...) are still fully translated per that language's own
 * localization file; only the built-in type NAMES stay English. This
 * is a deliberate, permanent design choice — not a gap awaiting future
 * translation — made to keep the type system's own vocabulary (the
 * strings compared against everywhere: type-env.ts, checker.ts, the
 * C/WASM Backends) from multiplying across every localization file.
 */
export const CANONICAL_TYPE: Record<string, string> = {
  // Tier 1 — Arabic
  "عدد":    "int",
  "عشري":  "float",
  "منطقي": "bool",
  "نص":    "string",
  "حرف":   "char",
  "بايت":  "byte",
  "لاشيء": "null",
  // Tier 1 — English (identity mapping, listed for completeness)
  "int":    "int",
  "float":  "float",
  "bool":   "bool",
  "string": "string",
  "char":   "char",
  "byte":   "byte",
  "null":   "null",
  "void":   "void",
  // Tier 2 — ABI-precise
  "i8": "i8", "i16": "i16", "i32": "i32", "i64": "i64",
  "u8": "u8", "u16": "u16", "u32": "u32", "u64": "u64",
  "f32": "f32", "f64": "f64",
};
