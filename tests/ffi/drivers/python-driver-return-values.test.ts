import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { PythonDriver } from "../../../src/ffi/drivers/python/python-driver.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "../native/harness-executor.js";

// FFI Python Bridge, Phase 2, Task 1: real Python function return
// values, not just executed side-effecting code. Proven live against
// real libpython.so.

const PYTHON_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so",
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0",
];

function findRealLibpython(): string | undefined {
  return PYTHON_LIB_CANDIDATES.find((p) => existsSync(p));
}

const libPath = findRealLibpython();

describe("FFI Python Bridge Phase 2 Task 1: real function return values, no simulation", () => {
  if (!libPath) {
    it.skip("SKIPPED: no real libpython.so found", () => { expect(true).toBe(true); });
    return;
  }

  const executor = new HarnessExecutor();
  const loader = new NativeFfiLoader(executor);
  const loadResult = loader.load({ name: "CPython", libraryPath: libPath });
  if (!loadResult.ok) {
    // D-4b (UR-PM-DIRECTIVE-003): the library IS present (found above), so a load failure is a FAILURE, not a skip.
    const reason = String((loadResult as { reason?: unknown }).reason);
    it("libpython.so is present at " + libPath + " and must load (a load failure is a failure, not a skip)", () => {
      expect(loadResult.ok, `failed to load libpython.so at ${libPath}: ${reason}`).toBe(true);
    });
    return;
  }
  const handle = loadResult.handle;
  const boundLoaderExecutor = { execute: (calls: any) => loader.execute(handle, calls) };
  const api = new PythonDriver(libPath).bind(boundLoaderExecutor);

  it("real Python function returning int: def f(): return 42", () => {
    const value = api.callFunctionSimple("def f():\n    return 42\nresult = f()", "result", "int");
    expect(value).toBe(42n);
  });

  it("real Python function returning float: def f(): return 3.14", () => {
    const value = api.callFunctionSimple("def f():\n    return 3.14\nresult = f()", "result", "float");
    expect(value).toBe(3.14);
  });

  it("real Python function returning bool: def f(): return True", () => {
    const value = api.callFunctionSimple("def f():\n    return True\nresult = f()", "result", "bool");
    expect(value).toBe(true);
  });

  it("real Python function returning bool False", () => {
    const value = api.callFunctionSimple("def f():\n    return False\nresult = f()", "result", "bool");
    expect(value).toBe(false);
  });

  it("real Python function returning string: def f(): return 'hi'", () => {
    const value = api.callFunctionSimple("def f():\n    return 'hi'\nresult = f()", "result", "string");
    expect(value).toBe("hi");
  });
});
