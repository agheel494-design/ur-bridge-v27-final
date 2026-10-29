// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge CLI — Diagnostics Reporter
//
// Professional error/warning/note/help reporting, modeled after rustc/clang
// diagnostic output: severity-coded headers, source snippets with a caret
// pointer, and a final summary line.
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "note" | "help";

export interface Diagnostic {
  severity: Severity;
  /** Stable diagnostic code, e.g. "UR1001" */
  code: string;
  message: string;
  file: string;
  line: number;
  column: number;
  /** Optional length of the offending span on `line`, for the caret underline */
  length?: number;
  /** Optional source line text, used to render the code snippet */
  sourceLine?: string;
  /** Additional notes/help attached to this diagnostic */
  related?: Array<{ severity: Severity; message: string }>;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
}

export function summarize(diags: Diagnostic[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
  }
  return { errors, warnings };
}

export function hasErrors(diags: Diagnostic[]): boolean {
  return diags.some(d => d.severity === "error");
}
