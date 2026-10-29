// src/compiler/diagnostics/adapter.ts — Diagnostics Adapter
//
// PURPOSE: converts each of the four separate Frontend diagnostic
// types (LexError, ParseError, SemanticDiagnostic, TypeDiagnostic)
// into the existing Diagnostic shape already defined in
// src/compiler/diagnostics/reporter.ts - WITHOUT modifying any of
// the four original files, and without modifying reporter.ts either.
//
// WHY AN ADAPTER, NOT A MERGE: the Frontend Freeze status ("frozen
// per the Level 2 rule", per a comment in src/shared/diagnostics.ts)
// is not backed by any ADR, governance document, or specification
// found in this repository - it exists only as a code comment. Per
// this project's own standard (no policy from a comment alone), the
// freeze's own status is UNKNOWN - not confirmed active, not
// confirmed lifted. The conservative choice, per explicit direction,
// is to treat it as still in effect until a real ADR says otherwise:
// this adapter changes NOTHING in lexer.ts, parser.ts,
// semantic/diagnostics.ts, or typesystem/type-diagnostics.ts.

import type { LexError } from "../frontend/lexer.js";
import type { ParseError } from "../frontend/parser.js";
import type { SemanticDiagnostic } from "../semantic/diagnostics.js";
import type { TypeDiagnostic } from "../typesystem/type-diagnostics.js";
import type { Diagnostic, Severity } from "./reporter.js";
import type { FormattableDiagnostic } from "../../shared/diagnostic-formatter.js";

// LexError/ParseError have no severity field at all (every lex/parse
// error is implicitly "error" today) - real, disclosed limitation,
// not something this adapter invents a severity for.
const IMPLICIT_SEVERITY: Severity = "error";

export function fromLexError(err: LexError): Diagnostic {
  return {
    severity: IMPLICIT_SEVERITY,
    code: err.code,
    message: err.message,
    file: err.span.file,
    line: err.span.startLine,
    column: err.span.startCol,
    length: err.span.startLine === err.span.endLine ? Math.max(1, err.span.endCol - err.span.startCol + 1) : undefined,
  };
}

/**
 * B-1 Gate (D-3): converts a LexError into the FormattableDiagnostic shape
 * consumed by formatDiagnostic (CLI) and the IDE server.
 *
 * Before: both call sites cast `LexError` directly to FormattableDiagnostic
 * (TS2352). A LexError's span names its columns `startCol`/`endCol` while
 * FormattableSpan expects `startColumn`/`endColumn`, and it carries the
 * lexer's own placeholder file name ("<input>"). The CLI therefore printed
 * `<input>:2:undefined: error[LE002] ...` with no caret, and the IDE sent
 * lexer diagnostics without a column.
 *
 * After: the column fields are mapped by name (the same mapping
 * fromLexError above already uses), and the placeholder file name is not
 * carried over, so the caller's own file name is used — exactly as for
 * parser errors. Code and message are unchanged; severity is omitted, as
 * for ParseError (formatDiagnostic defaults it to "error").
 */
export function lexErrorToFormattable(err: LexError): FormattableDiagnostic {
  return {
    code: err.code,
    message: err.message,
    span: { startLine: err.span.startLine, startColumn: err.span.startCol, endLine: err.span.endLine, endColumn: err.span.endCol },
  };
}

export function fromParseError(err: ParseError, file: string): Diagnostic {
  // ParseError's own SourceSpan has no file field (confirmed
  // directly against ast.ts) - the caller must supply it.
  return {
    severity: IMPLICIT_SEVERITY,
    code: err.code,
    message: err.message,
    file,
    line: err.span.startLine,
    column: err.span.startColumn,
    length: err.span.startLine === err.span.endLine ? Math.max(1, err.span.endColumn - err.span.startColumn + 1) : undefined,
  };
}

function mapSemanticSeverity(s: "error" | "warning" | "note"): Severity {
  return s;
}

export function fromSemanticDiagnostic(diag: SemanticDiagnostic, file: string): Diagnostic {
  return {
    severity: mapSemanticSeverity(diag.severity),
    code: diag.code,
    message: diag.message,
    file,
    line: diag.span.startLine,
    column: diag.span.startColumn,
    length: diag.span.startLine === diag.span.endLine ? Math.max(1, diag.span.endColumn - diag.span.startColumn + 1) : undefined,
    related: diag.related?.map((r) => ({ severity: "note" as Severity, message: r.message })),
  };
}

export function fromTypeDiagnostic(diag: TypeDiagnostic, file: string): Diagnostic {
  return {
    severity: mapSemanticSeverity(diag.severity),
    code: diag.code,
    message: diag.message,
    file,
    line: diag.span.startLine,
    column: diag.span.startColumn,
    length: diag.span.startLine === diag.span.endLine ? Math.max(1, diag.span.endColumn - diag.span.startColumn + 1) : undefined,
    related: diag.related?.map((r) => ({ severity: "note" as Severity, message: r.message })),
  };
}

// Fix-it hints: NOT implemented in this pass. Real, disclosed gap -
// none of the four source types carry any suggested-fix data today,
// so there is nothing real for this adapter to convert. Adding
// fix-it data would mean adding a new field to one of the four
// frozen-status types themselves - out of scope for a conservative
// adapter pending the Frontend Freeze's own documented resolution.
