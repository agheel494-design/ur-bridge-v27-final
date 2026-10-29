// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Build Results
// Level 2 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────
//
// A single result shape used by Codegen (AST → IR) and Backend (IR → C →
// executable) so that future consumers (CLI, LSP, AI) can depend on one
// contract regardless of which stage produced the result. Mirrors the
// success/diagnostics pattern already established by the Frontend's
// SemanticResult/TypeCheckResult, generalized with a generic payload.
// ─────────────────────────────────────────────────────────────────────────────

import type { SharedDiagnostic } from "./diagnostics.js";

export type BuildResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly SharedDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly SharedDiagnostic[] };

export function buildOk<T>(value: T, diagnostics: readonly SharedDiagnostic[] = []): BuildResult<T> {
  return { ok: true, value, diagnostics };
}

export function buildFail<T>(diagnostics: readonly SharedDiagnostic[]): BuildResult<T> {
  return { ok: false, diagnostics };
}

/** True iff the result has no error-severity diagnostics (warnings/info are fine). */
export function hasErrors(diagnostics: readonly SharedDiagnostic[]): boolean {
  return diagnostics.some(d => d.severity === "error");
}
