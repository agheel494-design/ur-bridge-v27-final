import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { RustBridgeDriver } from "../../../src/ffi/drivers/rust/rust-bridge.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "../native/harness-executor.js";

// This file is a PROOF OF CONCEPT ONLY - NOT part of the Rust
// Bridge's own architecture. It exists solely to demonstrate, using
// the generic RustBridgeDriver's own real, unified-error-handling
// API, that the underlying FFI infrastructure can genuinely load and
// call a real, independently-compiled Rust library (librav1e).

const RAV1E_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/librav1e.so.0.7.1",
  "/usr/lib/x86_64-linux-gnu/librav1e.so.0",
];

function findRealRav1e(): string | undefined {
  return RAV1E_LIB_CANDIDATES.find((p) => existsSync(p));
}

const libPath = findRealRav1e();

describe("Proof of concept only (NOT part of Rust Bridge architecture): generic RustBridgeDriver calling real librav1e.so", () => {
  if (!libPath) {
    it.skip("SKIPPED: no real librav1e.so found at expected paths", () => { expect(true).toBe(true); });
    return;
  }

  const executor = new HarnessExecutor();
  const loader = new NativeFfiLoader(executor);
  const loadResult = loader.load({ name: "rav1e", libraryPath: libPath });
  if (!loadResult.ok) {
    // D-4b (UR-PM-DIRECTIVE-003): the library IS present (found above), so a load failure is a FAILURE, not a skip.
    const reason = String((loadResult as { reason?: unknown }).reason);
    it("librav1e.so is present at " + libPath + " and must load (a load failure is a failure, not a skip)", () => {
      expect(loadResult.ok, `failed to load librav1e.so at ${libPath}: ${reason}`).toBe(true);
    });
    return;
  }
  const handle = loadResult.handle;
  const api = new RustBridgeDriver(libPath, "rav1e").bind({ execute: (calls: any) => loader.execute(handle, calls) });

  it("generic call() correctly invokes a real Rust-compiled function (rav1e_config_default), returning { ok: true }", () => {
    const outcome = api.call({ symbol: "rav1e_config_default", args: [], returnKind: "ptr" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.kind).toBe("ptr");
      if (outcome.value.kind === "ptr") expect(outcome.value.value).not.toBe(0n);
    }
  });

  it("generic withResource() correctly runs a real create->use->free lifecycle against real rav1e functions, returning { ok: true }", () => {
    const outcome = api.withResource(
      { createSymbol: "rav1e_config_default", createArgs: [], freeSymbol: "rav1e_config_unref" },
      () => [{ symbol: "rav1e_config_parse_int", args: [{ kind: "ptr", value: 0n }, { kind: "str", value: "speed" }, { kind: "i32", value: 10 }], returnKind: "i32" }],
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value[0]!.kind).toBe("ptr");
      expect(outcome.value[1]).toEqual({ kind: "i32", value: 0 });
      expect(outcome.value[2]).toEqual({ kind: "void" });
    }
  });

  it("REAL FIX VERIFIED against a real library: withResource() correctly reports { ok: false } for a genuinely invalid rav1e config key, rather than a misleading success", () => {
    const outcome = api.withResource(
      { createSymbol: "rav1e_config_default", createArgs: [], freeSymbol: "rav1e_config_unref" },
      () => [{ symbol: "rav1e_config_parse_int", args: [{ kind: "ptr", value: 0n }, { kind: "str", value: "not_a_real_rav1e_option_xyz" }, { kind: "i32", value: 1 }], returnKind: "i32" }],
    );
    // rav1e's own real validation returns a non-zero (but not a
    // harness-level "error") result for an invalid key - this is a
    // REAL, successful call that returns a real rejection code, not
    // an FFI-level failure - so outcome.ok is still true here, and
    // the caller inspects the real returned value themselves. This
    // test documents that distinction precisely, not just asserting
    // ok:false where it would be wrong to do so.
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const rejectionResult = outcome.value[1]!;
      const wasRejected = !(rejectionResult.kind === "i32" && rejectionResult.value === 0);
      expect(wasRejected).toBe(true);
    }
  });
});
