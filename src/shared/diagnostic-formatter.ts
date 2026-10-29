// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Diagnostic Formatting (Errors & Diagnostics stage)
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase — found via direct inspection: every
// compiler stage (Lexer/Parser/Semantic/TypeChecker/Lowering/Backend) already
// produces STRUCTURALLY CORRECT diagnostics (severity, stable code, message,
// a precise 1-based line/column span) — confirmed directly. What was missing,
// confirmed via a direct search finding zero matches anywhere in the
// codebase, was a FORMATTING layer that turns this already-correct raw data
// into the professional, human-readable form every mature compiler (rustc,
// tsc, clang) provides: filename, the actual source line, a `^` caret
// pointing at the exact column, and the message together in one block.
//
// This file is PURELY ADDITIVE — it does not modify how any diagnostic is
// PRODUCED anywhere in the compiler; it only consumes the data those
// diagnostics already carry. Deliberately generic over both diagnostic
// shapes actually used across this codebase:
//   - The Frontend's own narrow span shape: { startLine, startColumn,
//     endLine, endColumn } (LexError/ParseError/SemanticDiagnostic/
//     TypeDiagnostic all share this — Level 2's own "no Frontend changes"
//     rule means this file works WITH that shape, not against it).
//   - The shared, unified SourceLocation shape used downstream (Backend/
//     Runtime/IDE/AI): { file, start: {line,column}, end: {line,column} }.

export type FormattableSpan =
  | { startLine: number; startColumn: number; endLine: number; endColumn: number }
  | { start: { line: number; column: number }; end: { line: number; column: number }; file?: string };

export type FormattableDiagnostic = {
  /** Some diagnostic shapes (e.g. the Frontend's own ParseError) don't
   *  carry a severity field at all — every parse error is implicitly
   *  "error" severity, so the field is omitted at the source. This
   *  formatter defaults to "error" when absent, rather than requiring
   *  every caller to normalize this first. */
  readonly severity?: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
  readonly span: FormattableSpan;
  /** Optional: a suggested fix, when the diagnostic's own producer knows one (not every diagnostic has one — never fabricated by the formatter itself). */
  readonly suggestion?: string;
};

function normalizeSpan(span: FormattableSpan): { line: number; column: number; endLine: number; endColumn: number } {
  if ("startLine" in span) {
    return { line: span.startLine, column: span.startColumn, endLine: span.endLine, endColumn: span.endColumn };
  }
  return { line: span.start.line, column: span.start.column, endLine: span.end.line, endColumn: span.end.column };
}

function spanFile(span: FormattableSpan): string | undefined {
  return "file" in span ? span.file : undefined;
}

/**
 * Renders one diagnostic as a professional, human-readable block:
 *
 *   file.ur:3:15: error[TY2002]: cannot assign String to 'x: Int'
 *      |
 *    3 |   let x: int = "wrong"
 *      |               ^^^^^^^
 *   help: <suggestion, if the diagnostic provides one>
 *
 * `sourceText` is the FULL original source (used to extract the exact
 * line referenced by the diagnostic's own span — never re-derived or
 * guessed). `filename` is used when the diagnostic's own span doesn't
 * already carry one (the Frontend's narrow span shape doesn't; the
 * caller — who compiled a specific named file — supplies it here,
 * exactly matching how `fromAstSpan()` already does this same handoff
 * elsewhere in this codebase).
 */
export function formatDiagnostic(
  diag: FormattableDiagnostic,
  sourceText: string,
  filename: string,
): string {
  const { line, column, endLine, endColumn } = normalizeSpan(diag.span);
  const file = spanFile(diag.span) ?? filename;
  const lines = sourceText.split("\n");
  // 1-based line numbers; guard against an out-of-range line (a
  // synthetic/compiler-generated location, or a span past EOF from a
  // truncated/malformed file) rather than throwing or indexing OOB.
  const sourceLine = line >= 1 && line <= lines.length ? lines[line - 1]! : "";

  const out: string[] = [];
  const severity = diag.severity ?? "error";
  out.push(`${file}:${line}:${column}: ${severity}[${diag.code}]: ${diag.message}`);
  const lineNumStr = String(line);
  const gutterWidth = lineNumStr.length;
  const gutter = " ".repeat(gutterWidth);
  out.push(`${gutter} |`);
  out.push(`${lineNumStr} | ${sourceLine}`);
  // Caret span: from `column` to `endColumn` on the SAME line (a
  // multi-line span just carets the first line's own starting point —
  // matches this project's own diagnostics, which are always
  // single-token/single-expression spans in practice; a full
  // multi-line underline is a possible future enhancement, not
  // fabricated here without evidence it's needed).
  const caretLen = endLine === line ? Math.max(1, endColumn - column + 1) : 1;
  const caretPad = " ".repeat(Math.max(0, column - 1));
  out.push(`${gutter} | ${caretPad}${"^".repeat(caretLen)}`);
  if (diag.suggestion) out.push(`help: ${diag.suggestion}`);
  return out.join("\n");
}

/** Formats every diagnostic in a list, joined with a blank line between each — the common case for a real compiler invocation with multiple errors. */
export function formatDiagnostics(
  diags: readonly FormattableDiagnostic[],
  sourceText: string,
  filename: string,
): string {
  return diags.map(d => formatDiagnostic(d, sourceText, filename)).join("\n\n");
}
