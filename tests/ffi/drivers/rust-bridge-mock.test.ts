// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Generic Rust Bridge (Unit — no native library required)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit direction: real, live tests against a compiled Rust
// library are DEFERRED until a real Rust toolchain/library is
// available. These tests verify the generic RustBridgeDriver's own
// call encoding and unified error-handling contract, using a mock
// executor - no dlopen(), no real library required.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { RustBridgeDriver } from "../../../src/ffi/drivers/rust/rust-bridge.js";
import type { NativeCall, NativeCallResult } from "../../../src/ffi/native/types.js";

function makeMockExecutor(responses: NativeCallResult[]) {
  const executedCalls: NativeCall[] = [];
  return {
    executedCalls,
    execute: (calls: NativeCall[]): NativeCallResult[] => {
      executedCalls.push(...calls);
      return calls.map((_, i) => responses[i] ?? { kind: "i32", value: 0 });
    },
  };
}

describe("RustBridgeDriver (generic, library-agnostic) - mock only, no real library required", () => {
  it("call() returns { ok: true, value } for a successful call", () => {
    const mock = makeMockExecutor([{ kind: "i32", value: 42 }]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.call({ symbol: "some_arbitrary_extern_c_function", args: [], returnKind: "i32" });
    expect(outcome).toEqual({ ok: true, value: { kind: "i32", value: 42 } });
    expect(mock.executedCalls[0]?.symbol).toBe("some_arbitrary_extern_c_function");
  });

  it("call() returns { ok: false, error } uniformly for a real harness-level error, not a raw kind:'error' result", () => {
    const mock = makeMockExecutor([{ kind: "error", message: "symbol not found: nonexistent_fn" }]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.call({ symbol: "nonexistent_fn", args: [], returnKind: "i32" });
    expect(outcome).toEqual({ ok: false, error: "symbol not found: nonexistent_fn" });
  });

  it("call() correctly passes through arguments of every supported type (i32, i64, f64, str, ptr)", () => {
    const mock = makeMockExecutor([{ kind: "i32", value: 0 }]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    api.call({
      symbol: "generic_fn",
      args: [
        { kind: "i32", value: 1 },
        { kind: "i64", value: 2n },
        { kind: "f64", value: 3.14 },
        { kind: "str", value: "hello" },
        { kind: "ptr", value: 100n },
      ],
      returnKind: "i32",
    });
    expect(mock.executedCalls[0]?.args).toEqual([
      { kind: "i32", value: 1 },
      { kind: "i64", value: 2n },
      { kind: "f64", value: 3.14 },
      { kind: "str", value: "hello" },
      { kind: "ptr", value: 100n },
    ]);
  });

  it("callBatch() returns { ok: true, value: [...] } when every call succeeds", () => {
    const mock = makeMockExecutor([{ kind: "i32", value: 1 }, { kind: "i32", value: 2 }]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.callBatch([
      { symbol: "fn_a", args: [], returnKind: "i32" },
      { symbol: "fn_b", args: [], returnKind: "i32" },
    ]);
    expect(outcome).toEqual({ ok: true, value: [{ kind: "i32", value: 1 }, { kind: "i32", value: 2 }] });
    expect(mock.executedCalls.length).toBe(2);
  });

  it("callBatch() returns a single { ok: false, error } if ANY call in the batch fails, not a partial/ambiguous array", () => {
    const mock = makeMockExecutor([{ kind: "i32", value: 1 }, { kind: "error", message: "real failure in fn_b" }]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.callBatch([
      { symbol: "fn_a", args: [], returnKind: "i32" },
      { symbol: "fn_b", args: [], returnKind: "i32" },
    ]);
    expect(outcome).toEqual({ ok: false, error: "real failure in fn_b" });
  });

  it("withResource() correctly generates a create -> use -> free call sequence generically when create succeeds", () => {
    const mock = makeMockExecutor([
      { kind: "ptr", value: 999n }, // create
      { kind: "i32", value: 0 },    // use
      { kind: "void" },              // free
    ]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.withResource(
      { createSymbol: "generic_create", createArgs: [], freeSymbol: "generic_free" },
      () => [{ symbol: "generic_use", args: [], returnKind: "i32" }],
    );
    expect(outcome.ok).toBe(true);
    expect(mock.executedCalls.map((c) => c.symbol)).toEqual(["generic_create", "generic_use", "generic_free"]);
    expect(mock.executedCalls[2]?.args).toEqual([{ kind: "ptr", value: 0n }]);
  });

  it("REAL BUG FIX VERIFIED: withResource() reports { ok: false } when create returns a null (0) pointer, rather than silently treating the resource as valid", () => {
    const mock = makeMockExecutor([
      { kind: "ptr", value: 0n }, // create FAILS (null pointer)
      { kind: "i32", value: 0 },
      { kind: "void" },
    ]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.withResource(
      { createSymbol: "generic_create", createArgs: [], freeSymbol: "generic_free" },
      () => [{ symbol: "generic_use", args: [], returnKind: "i32" }],
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("did not return a valid non-null pointer");
  });

  it("REAL BUG FIX VERIFIED: withResource() reports { ok: false } when create itself returns a real harness-level error", () => {
    const mock = makeMockExecutor([
      { kind: "error", message: "real create failure" },
      { kind: "i32", value: 0 },
      { kind: "void" },
    ]);
    const api = new RustBridgeDriver("/fake/path.so", "some_library").bind(mock);
    const outcome = api.withResource(
      { createSymbol: "generic_create", createArgs: [], freeSymbol: "generic_free" },
      () => [{ symbol: "generic_use", args: [], returnKind: "i32" }],
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("real create failure");
  });

  it("descriptor correctly stores the caller-supplied library name and path - no hardcoded library identity", () => {
    const driver = new RustBridgeDriver("/some/custom/library.so", "my_custom_rust_lib");
    expect(driver.descriptor).toEqual({ name: "my_custom_rust_lib", libraryPath: "/some/custom/library.so" });
  });
});
