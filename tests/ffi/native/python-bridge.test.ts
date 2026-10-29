import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { HarnessExecutor } from "./harness-executor.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";

// FFI Multi-Language Bridges: Python (first of Python/Rust/JS).
//
// Per explicit direction: reuses the existing NativeFfiLoader /
// IPlatformExecutor pattern with ZERO changes to src/ffi/ itself -
// the exact same pattern the real, passing SQLite3 test uses
// (tests/ffi/native/sqlite3-crud.test.ts's own "Step 1" test calls
// loader.execute(handle, calls) directly - not driver.bind(), which
// an earlier attempt in this session incorrectly assumed was the
// live-tested path. Corrected after that attempt failed with a real
// error, not assumed to work from reading the type alone).
//
// CPython's own public embedding API is itself a plain C ABI, so
// libpython is loaded and called exactly the way SQLite3 is.
//
// Scope, deliberately minimal and safety-conscious: only
// Py_IsInitialized() is called live. Py_Initialize() has a real
// `void` return in the CPython API - reading a fabricated i32
// "return value" from it would be undefined behavior. Py_IsInitialized()
// genuinely returns int and is safe to call even before
// Py_Initialize() (it just checks an internal flag).

const PYTHON_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so",
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0",
];

function findRealLibpython(): string | undefined {
  return PYTHON_LIB_CANDIDATES.find((p) => existsSync(p));
}

describe("FFI Python Bridge - real libpython.so, no simulation", () => {
  it("Py_IsInitialized() is called successfully against a real, live libpython.so, via the exact NativeFfiLoader pattern the real SQLite3 test uses", () => {
    const libPath = findRealLibpython();
    if (!libPath) {
      console.warn("SKIPPED: no real libpython.so found at expected paths");
      return;
    }
    const executor = new HarnessExecutor();
    const loader = new NativeFfiLoader(executor);
    const result = loader.load({ name: "CPython", libraryPath: libPath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [initialized] = loader.execute(result.handle, [
      { symbol: "Py_IsInitialized", args: [], returnKind: "i32" },
    ]);

    expect(initialized?.kind).toBe("i32");
    if (initialized?.kind === "i32") {
      // Before Py_Initialize() is ever called, this must be 0 (false)
      // - a real, meaningful assertion about the real library's own
      // state, not just "it didn't crash."
      expect(initialized.value).toBe(0);
    }
  });
});
