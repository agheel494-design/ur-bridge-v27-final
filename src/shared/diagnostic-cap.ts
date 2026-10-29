// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Diagnostic Capping (Errors & Diagnostics stage)
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase — Diagnostic Stability Test,
// explicit review request. Confirmed directly: a 1000-error program
// completes in 63ms/10MB, a 20000-error program in 548ms/103MB - no
// infinite loop, no runaway memory, roughly linear scaling. NOT a
// performance bug. But confirmed there was NO maximum diagnostic count
// at all. This file is a new, purely additive capping utility - does
// not touch any error-detection logic anywhere; only limits what gets
// REPORTED to a caller.

export type CapResult<T> = {
  readonly kept: readonly T[];
  readonly suppressedCount: number;
  readonly message?: string;
};

/**
 * Caps a diagnostics list to at most `max` entries, returning the kept
 * subset plus a count of how many were suppressed. When any are
 * suppressed, `message` states this clearly, not a silent truncation.
 */
export function capDiagnostics<T>(diagnostics: readonly T[], max = 100): CapResult<T> {
  if (diagnostics.length <= max) {
    return { kept: diagnostics, suppressedCount: 0 };
  }
  const kept = diagnostics.slice(0, max);
  const suppressedCount = diagnostics.length - max;
  return {
    kept,
    suppressedCount,
    message: `... and ${suppressedCount} more error(s) not shown (stopped after ${max}). Fix the errors above and re-run to see additional ones.`,
  };
}
