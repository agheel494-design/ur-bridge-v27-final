// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Diagnostic Codes
// WASM_BACKEND_SPEC.md §1.2 (ratified)
// ─────────────────────────────────────────────────────────────────────────────

export const WASM_CODES = {
  UNSUPPORTED_INSTRUCTION: "WASM1001",
  UNSUPPORTED_CFG_SHAPE: "WASM1002",
  UNSUPPORTED_AGGREGATE: "WASM1003",
  UNSUPPORTED_RUNTIME_FEATURE: "WASM1004",
} as const;

export interface WasmDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly functionName: string;
}

/** Thrown by the emitter for any construct outside the current sub-phase's Feature Matrix (WASM_BACKEND_SPEC.md §0) — the Backend refuses to emit anything for that function, per §1.2's "never silently downgraded to a warning" rule. */
export class WasmUnsupportedError extends Error {
  constructor(public readonly diagnostic: WasmDiagnostic) {
    super(`[${diagnostic.code}] ${diagnostic.functionName}: ${diagnostic.message}`);
    this.name = "WasmUnsupportedError";
  }
}
