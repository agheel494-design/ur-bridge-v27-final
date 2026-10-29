// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Semantic Analyzer: Diagnostics
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceSpan } from "../frontend/ast.js";

export type SemanticSeverity = "error" | "warning" | "note";

export interface SemanticDiagnostic {
  severity: SemanticSeverity;
  /** Stable error code. S = semantic; 4 digits. */
  code: string;
  message: string;
  span: SourceSpan;
  /** Optional secondary spans (e.g. "previously declared here"). */
  related?: Array<{ message: string; span: SourceSpan }> | undefined;
}

export interface SemanticResult {
  diagnostics: SemanticDiagnostic[];
  /** True iff no error-severity diagnostics. */
  valid: boolean;
}

export function makeResult(diagnostics: SemanticDiagnostic[]): SemanticResult {
  return {
    diagnostics,
    valid: diagnostics.every(d => d.severity !== "error"),
  };
}

// ── Error codes ───────────────────────────────────────────────────────────────
// SE1xxx  Name resolution
// SE2xxx  Duplicate definitions
// SE3xxx  Function / call checking
// SE4xxx  Assignment checking
// SE5xxx  Control-flow checking

export const CODES = {
  UNDEFINED_SYMBOL:   "SE1001",
  UNDEFINED_FUNCTION: "SE1002",
  UNDEFINED_TYPE:     "SE1003",

  DUPLICATE_VARIABLE:  "SE2001",
  DUPLICATE_FUNCTION:  "SE2002",
  DUPLICATE_PARAM:     "SE2003",
  DUPLICATE_MODULE:    "SE2004",
  DUPLICATE_STRUCT:    "SE2005", // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.1
  DUPLICATE_FIELD:     "SE2006", // Level 2.8

  ARITY_MISMATCH:      "SE3001",
  NOT_A_FUNCTION:      "SE3002",

  ASSIGN_TO_CONST:     "SE4001",
  ASSIGN_TO_PARAM:     "SE4002",

  BREAK_OUTSIDE_LOOP:  "SE5001",
  CONTINUE_OUTSIDE_LOOP: "SE5002",
  RETURN_OUTSIDE_FN:   "SE5003",

  INVALID_FIELD_TYPE:  "SE6001", // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.6 — fields must be primitive scalar types
} as const;
