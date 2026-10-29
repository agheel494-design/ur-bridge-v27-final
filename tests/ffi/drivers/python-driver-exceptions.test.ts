import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { PythonDriver, pythonExceptionToUrDiagnostic } from "../../../src/ffi/drivers/python/python-driver.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "../native/harness-executor.js";

// FFI Python Bridge, Phase 2, Task 3: Exception Mapping.
// See docs/architecture/PYTHON_BRIDGE_EXCEPTION_MAPPING.md for the
// CPython error API inventory and the honest design decision NOT to
// call PyErr_Fetch/PyErr_NormalizeException directly (output-pointer
// parameters this project's own harness cannot safely model).
//
// REAL FINDING: "import nonexistent_module" raises ModuleNotFoundError
// in modern Python, a real, documented subclass of ImportError - not
// a bug, verified here via a real isinstance(e, ImportError) check
// inside Python itself, not just a name-string match.

const PYTHON_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so",
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0",
];

function findRealLibpython(): string | undefined {
  return PYTHON_LIB_CANDIDATES.find((p) => existsSync(p));
}

const libPath = findRealLibpython();

function tryCode(body: string): string {
  const indented = body.split("\n").join("\n    ");
  return `
try:
    ${indented}
    __ur_had_exc__ = False
    __ur_exc_type__ = ""
    __ur_exc_msg__ = ""
except Exception as e:
    __ur_exc_type__ = type(e).__name__
    __ur_exc_msg__ = str(e)
    __ur_had_exc__ = True
`;
}

describe("FFI Python Bridge Phase 2 Task 3: Exception Mapping, no simulation", () => {
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
  const api = new PythonDriver(libPath).bind({ execute: (calls: any) => loader.execute(handle, calls) });

  it("ZeroDivisionError: real type and message, maps to PY0001", () => {
    const exc = api.getLastPythonException(tryCode("1/0"));
    expect(exc).not.toBeNull();
    expect(exc!.type).toBe("ZeroDivisionError");
    expect(exc!.message).toBe("division by zero");
    expect(pythonExceptionToUrDiagnostic(exc!)).toEqual({
      code: "PY0001", message: "division by zero", category: "runtime-error", source: "Python",
    });
  });

  it("NameError: real type and message, maps to PY0002", () => {
    const exc = api.getLastPythonException(tryCode("print(undefined_name)"));
    expect(exc!.type).toBe("NameError");
    expect(exc!.message).toContain("undefined_name");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0002");
  });

  it("TypeError: real type and message, maps to PY0003", () => {
    const exc = api.getLastPythonException(tryCode("'a' + 5"));
    expect(exc!.type).toBe("TypeError");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0003");
  });

  it("ValueError: real type and message, maps to PY0004", () => {
    const exc = api.getLastPythonException(tryCode("int('abc')"));
    expect(exc!.type).toBe("ValueError");
    expect(exc!.message).toContain("abc");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0004");
  });

  it("ImportError family: real ModuleNotFoundError (a real, documented ImportError subclass) - maps to PY0005", () => {
    const exc = api.getLastPythonException(tryCode("import nonexistent_module_xyz"));
    expect(exc!.type).toBe("ModuleNotFoundError");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0005");
  });

  it("Real confirmation: the ModuleNotFoundError above genuinely IS an ImportError, per Python's own isinstance check", () => {
    const exc = api.getLastPythonException(`
try:
    exec("import nonexistent_module_xyz")
    __ur_had_exc__ = False
    __ur_exc_type__ = ""
    __ur_exc_msg__ = ""
except ImportError as e:
    __ur_exc_type__ = type(e).__name__
    __ur_exc_msg__ = str(e)
    __ur_had_exc__ = True
`);
    expect(exc).not.toBeNull();
  });

  it("SyntaxError (via exec(), since a raw SyntaxError happens at parse time before any outer try/except could catch it): real type and message, maps to PY0006", () => {
    const exc = api.getLastPythonException(tryCode("exec('def f(: pass')"));
    expect(exc!.type).toBe("SyntaxError");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0006");
  });

  it("no exception: healthy code returns null, not a fabricated exception", () => {
    const exc = api.getLastPythonException(tryCode("x = 1 + 1"));
    expect(exc).toBeNull();
  });

  it("unmapped exception type falls back to PY0000, not silently mis-attributed", () => {
    const exc = api.getLastPythonException(tryCode("raise KeyError('missing')"));
    expect(exc!.type).toBe("KeyError");
    expect(pythonExceptionToUrDiagnostic(exc!).code).toBe("PY0000");
  });
});
