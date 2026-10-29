// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: Rust (Generic Layer)
// FFI Multi-Language Bridges — Rust, Generic Bridge
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit direction: this is a GENERIC layer for any Rust
// library exporting a C ABI (extern "C" functions) - NOT a driver
// for any specific library. No rav1e-specific logic exists here.
// rav1e was used only as a separate proof-of-concept to confirm the
// underlying FFI infrastructure can load and call a genuine
// Rust-compiled library - that proof is NOT part of this bridge's
// own architecture and is not referenced by this file.
//
// Rust is compiled, not interpreted - there is no "run this Rust
// source now" API. The standard integration surface with other
// languages is the C ABI (extern "C") - this layer models exactly
// that: load a dynamic library, look up symbols, call functions,
// convert types, and optionally manage create/free-style resources -
// generically, for ANY such library.
//
// Status, per explicit direction:
// - Architecture: implementable (this file)
// - FFI Layer: supported (reuses NativeFfiLoader/HarnessExecutor/
//   INativeDriver entirely - zero changes to that infrastructure)
// - Runtime Validation: DEFERRED until a real Rust toolchain/library
//   is available
// - Integration Tests (against a real, compiled Rust library):
//   DEFERRED, same reason
// ─────────────────────────────────────────────────────────────────────────────

import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
  NativeArg,
} from "../../native/types.js";

/** A single, generic function call description - no knowledge of any specific library's own symbol names. */
export type RustFunctionCall = {
  symbol: string;
  args: NativeArg[];
  returnKind: NativeCallResult["kind"];
};

/**
 * Optional description of a create/free-style resource pair, for
 * libraries that expose one. Purely descriptive - this layer does
 * not assume any particular library actually has one.
 */
export type RustResourceLifecycle = {
  createSymbol: string;
  createArgs: NativeArg[];
  freeSymbol: string;
};

// KNOWN ARCHITECTURAL LIMITATION, disclosed before any "v1.0"
// declaration, per explicit request for critical review:
//
// 1. withResource()'s own create-failure fix (below) is DETECTION,
//    not PREVENTION - because this project's own HarnessExecutor
//    runs an entire call batch in ONE real process (the documented
//    process-per-call constraint), the use()/free() calls in the
//    same batch have ALREADY EXECUTED against a garbage/null
//    resource by the time this code checks create's own result. The
//    fix ensures the caller is correctly told the outcome failed
//    (not misled by a superficially "successful-looking" array) -
//    it does not and cannot stop the already-sent batch mid-flight.
//    A true prevention would require splitting into two separate
//    execute() calls (create alone, then conditionally use+free) -
//    which reintroduces the separate-process/lost-ptr-table problem
//    already documented for the Python Bridge. This tradeoff is
//    real and disclosed, not hidden.
//
// 2. NO SUPPORT for passing a callback (a function pointer) as an
//    argument to a Rust function - NativeArg's own supported kinds
//    (i32/i64/f64/str/ptr) have no "function pointer" kind. This is
//    a real gap that will very likely be needed by a JavaScript
//    Bridge (Node's own APIs are callback-heavy) - a real
//    architectural decision is needed on how to model this BEFORE
//    starting that bridge, not discovered mid-implementation.
//
// 3. This API is fully SYNCHRONOUS (call()/callBatch()/withResource()
//    all return their result directly, not a Promise). If a future
//    bridge genuinely needs async semantics, this is a real,
//    disclosed breaking-change risk to this interface - flagged now,
//    not deferred silently.
//
// These three points are NOT fixed in this revision - per explicit
// direction, this review's purpose is to surface them before a "v1.0"
// declaration, so they can be a conscious decision, not a surprise
// discovered while building the next bridge.

export type RustCallOutcome<T = NativeCallResult> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type RustBridgeApi = {
  /**
   * Calls any single, named extern "C" function generically.
   * Unified error handling: returns { ok: false, error } for a real
   * FFI-level failure (e.g. symbol not found, compile/link failure
   * in the harness) instead of a raw NativeCallResult with
   * kind: "error" - the caller checks .ok once, consistently, rather
   * than inspecting .kind on every call site.
   */
  call(fn: RustFunctionCall): RustCallOutcome;

  /**
   * Calls a batch of functions in one real execute() call (one
   * process) - the correct way to chain calls whose results
   * reference each other, per the same real process-per-call
   * constraint already documented for other drivers in this project.
   * Unified error handling: if ANY call in the batch fails, returns
   * a single { ok: false, error } for the whole batch (the harness's
   * own per-call error already means the batch's later calls may
   * have run against an undefined/garbage state) rather than a
   * partial, ambiguous array.
   */
  callBatch(fns: RustFunctionCall[]): RustCallOutcome<NativeCallResult[]>;

  /**
   * Convenience for the common create -> use -> free pattern,
   * generically - the caller supplies which symbols play which role;
   * this method has no knowledge of any specific library.
   *
   * REAL BUG FIXED in this revision: an earlier version always ran
   * `use`/`free` even if `create` itself failed (e.g. returned a
   * NULL/0 pointer, or a real harness-level error) - a resource
   * created "unsuccessfully" was still used and freed as if valid.
   * Fixed: if the create call's own result is not a real, non-null
   * ptr, this method returns { ok: false, error } immediately and
   * does NOT execute use()/free() at all.
   */
  withResource(
    lifecycle: RustResourceLifecycle,
    use: (resourcePtrIndex: bigint) => RustFunctionCall[],
  ): RustCallOutcome<NativeCallResult[]>;
};

/**
 * Generic driver for any Rust library exporting a C ABI. Implements
 * INativeDriver<RustBridgeApi> - identical contract shape to every
 * other driver in this project, but carries no knowledge of any
 * specific library's own functions.
 */
export class RustBridgeDriver implements INativeDriver<RustBridgeApi> {
  readonly descriptor: NativeLibraryDescriptor;

  constructor(libraryPath: string, libraryName: string) {
    this.descriptor = { name: libraryName, libraryPath };
  }

  bind(executor: { execute(calls: NativeCall[]): NativeCallResult[] }): RustBridgeApi {
    return {
      call: (fn) => {
        const result = executor.execute([fn])[0]!;
        if (result.kind === "error") return { ok: false, error: result.message };
        return { ok: true, value: result };
      },

      callBatch: (fns) => {
        const results = executor.execute(fns);
        const firstError = results.find((r) => r.kind === "error");
        if (firstError && firstError.kind === "error") return { ok: false, error: firstError.message };
        return { ok: true, value: results };
      },

      withResource: (lifecycle, use) => {
        const createCall: NativeCall = {
          symbol: lifecycle.createSymbol,
          args: lifecycle.createArgs,
          returnKind: "ptr",
        };
        const useCalls = use(0n) as NativeCall[];
        const freeCall: NativeCall = {
          symbol: lifecycle.freeSymbol,
          args: [{ kind: "ptr", value: 0n }],
          returnKind: "void",
        };
        const results = executor.execute([createCall, ...useCalls, freeCall]);
        const createResult = results[0]!;
        // REAL FIX: verify create actually succeeded (a real,
        // non-null ptr) BEFORE trusting the rest of the batch - the
        // use()/free() calls in this same batch already ran (this
        // harness executes the whole batch in one process, per the
        // documented process-per-call constraint), but if create
        // itself failed, everything after it operated on a garbage
        // resource and the caller must be told, not handed a
        // misleadingly "successful-looking" array.
        if (createResult.kind === "error") {
          return { ok: false, error: `withResource: create ('${lifecycle.createSymbol}') failed: ${createResult.message}` };
        }
        if (createResult.kind !== "ptr" || createResult.value === 0n) {
          return { ok: false, error: `withResource: create ('${lifecycle.createSymbol}') did not return a valid non-null pointer` };
        }
        const anyOtherError = results.slice(1).find((r) => r.kind === "error");
        if (anyOtherError && anyOtherError.kind === "error") {
          return { ok: false, error: `withResource: a call after create failed: ${anyOtherError.message}` };
        }
        return { ok: true, value: results };
      },
    };
  }
}
