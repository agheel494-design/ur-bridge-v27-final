// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Diagnostics
// Level 2 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────
//
// A single unified diagnostic shape for everything DOWNSTREAM of the
// Frontend: Backend (codegen errors), Runtime (panics reported back with a
// source location), IDE (surfacing any of the above), and AI (explaining
// any of the above). This does NOT replace the Frontend's own diagnostic
// types (LexError/ParseError/SemanticDiagnostic/TypeDiagnostic) — those are
// frozen per the Level 2 rule against Frontend changes. Instead, each of
// those has a small converter into this shared shape, so the LSP and future
// tooling only need to understand ONE diagnostic contract regardless of
// which compiler stage produced it.
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceLocation } from "./locations.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

/** Which layer of the system produced this diagnostic. */
export type DiagnosticSource =
  | "lexer"
  | "parser"
  | "semantic"
  | "typechecker"
  | "codegen"
  | "backend"
  | "runtime"
  | "ai";

export type SharedDiagnostic = {
  readonly source: DiagnosticSource;
  readonly severity: DiagnosticSeverity;
  /** Stable code, e.g. "SE1001", "IR2001", "CG3001" — see build.ts for the codegen/backend code ranges. */
  readonly code: string;
  readonly message: string;
  readonly location: SourceLocation;
};

/** Codegen/Backend diagnostic code ranges (Frontend codes — LEXXX/PEXXX/SEXXX/TYXXX — are unchanged and owned by the Frontend). */
export const CODEGEN_CODES = {
  UNSUPPORTED_CONSTRUCT: "CG1001", // an AST node the lowering pass doesn't support in this Level 2 phase
  UNRESOLVED_CALL: "CG1002",       // a call to a function the IR builder could not resolve
  // Gate V1-GAP-002-SELF-REFERENCE-DIAGNOSTIC: a struct-layout
  // computation failure that is a KNOWN, diagnosable language-level
  // problem (recursive-by-value struct, or a field whose own type
  // could not be resolved) — NOT an internal invariant violation.
  INVALID_STRUCT_LAYOUT: "CG1003",
  INTERNAL_ERROR: "CG9001",        // an invariant violation in the lowering pass itself
} as const;

export const BACKEND_CODES = {
  COMPILE_FAILED: "BE1001", // the C compiler (or future backend) rejected the emitted output
  LINK_FAILED: "BE1002",
} as const;

export function makeDiagnostic(
  source: DiagnosticSource,
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  location: SourceLocation
): SharedDiagnostic {
  return { source, severity, code, message, location };
}
