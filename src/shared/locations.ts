// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Locations
// Level 2 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the single source of truth for "where in source code" across every
// layer of UR: Compiler (Lexer/Parser/AST), Backend (IR → C), Runtime
// (panics/traces), IDE (LSP positions), and AI (referencing code locations
// in explanations). It intentionally mirrors the shape already used by
// src/compiler/frontend/ast.ts's SourceSpan and src/compiler/frontend/lexer.ts's
// Span — this file does not replace those (Level 2 rule: no Frontend changes),
// it gives downstream layers (Backend/Runtime/IDE/AI) a shared vocabulary to
// depend on without importing internal Frontend types directly.
// ─────────────────────────────────────────────────────────────────────────────

/** A single point in a source file. 1-based line, 1-based column (code-point offset). */
export type SourcePoint = {
  readonly line: number;
  readonly column: number;
};

/** A span of source text, from one point to another, within a named file. */
export type SourceLocation = {
  readonly file: string;
  readonly start: SourcePoint;
  readonly end: SourcePoint;
};

/** Converts a Frontend-style {startLine,startColumn,endLine,endColumn} span into a SourceLocation. */
export function fromAstSpan(
  file: string,
  span: { startLine: number; startColumn: number; endLine: number; endColumn: number }
): SourceLocation {
  return {
    file,
    start: { line: span.startLine, column: span.startColumn },
    end: { line: span.endLine, column: span.endColumn },
  };
}

/** A synthetic location for compiler-generated code with no real source origin (e.g. implicit returns). */
export const SYNTHETIC_LOCATION: SourceLocation = {
  file: "<synthetic>",
  start: { line: 0, column: 0 },
  end: { line: 0, column: 0 },
};

export function isSynthetic(loc: SourceLocation): boolean {
  return loc.file === SYNTHETIC_LOCATION.file;
}
