// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Type System: Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: SourceSpan is a plain interface (no runtime code). We need it only
// as a TypeScript type, so we use `import type`. This is safe — SourceSpan
// has no class body or const that needs to exist at runtime.
import type { SourceSpan } from "../frontend/ast.js";

export type TypeDiagSeverity = "error" | "warning" | "note";

export interface TypeDiagnostic {
  severity: TypeDiagSeverity;
  code: string;
  message: string;
  span: SourceSpan;
  related?: Array<{ message: string; span: SourceSpan }> | undefined;
}

export interface TypeCheckResult {
  diagnostics: TypeDiagnostic[];
  valid: boolean;
}

export function makeTypeResult(diagnostics: TypeDiagnostic[]): TypeCheckResult {
  return { diagnostics, valid: diagnostics.every(d => d.severity !== "error") };
}

export const TCODES = {
  UNKNOWN_TYPE:            "TY1001",
  TYPE_ARG_COUNT_MISMATCH: "TY1002",
  TYPE_MISMATCH:           "TY2001",
  ASSIGN_TYPE_MISMATCH:    "TY2002",
  RETURN_TYPE_MISMATCH:    "TY2003",
  CONDITION_NOT_BOOL:      "TY2004",
  OPERATOR_TYPE_ERROR:     "TY3001",
  UNARY_TYPE_ERROR:        "TY3002",
  MISSING_RETURN:          "TY4001",
  PARAM_TYPE_MISMATCH:     "TY5001",
  CALL_ARG_TYPE_MISMATCH:  "TY5002",
  ARRAY_ELEMENT_TYPE_MISMATCH: "TY6001", // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1.1
  EMPTY_ARRAY_LITERAL: "TY6002", // Level 2.8 — rejected per review: no Generics means no way to express an empty array's element type
} as const;

export function typeError(
  code: string,
  message: string,
  span: SourceSpan,
  related?: Array<{ message: string; span: SourceSpan }>,
): TypeDiagnostic {
  return { severity: "error", code, message, span, related };
}
