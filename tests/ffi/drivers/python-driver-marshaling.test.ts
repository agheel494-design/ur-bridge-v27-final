import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { PythonDriver } from "../../../src/ffi/drivers/python/python-driver.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "../native/harness-executor.js";

// FFI Python Bridge, Phase 2, Task 2: Argument Marshaling (UR<->Python
// round-trip), per docs/architecture/PYTHON_BRIDGE_TYPE_MAPPING.md.
//
// CRITICAL FIX made while building this: an earlier version of the
// scalar converter did NOT check PyErr_Occurred() - PyLong_AsLong on
// a non-numeric string silently returned -1 (a real, valid integer
// value too), making a genuine type error indistinguishable from a
// real -1. Fixed by checking PyErr_Occurred() after every
// conversion and throwing a real error when set.

const PYTHON_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so",
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0",
];

function findRealLibpython(): string | undefined {
  return PYTHON_LIB_CANDIDATES.find((p) => existsSync(p));
}

const libPath = findRealLibpython();

describe("FFI Python Bridge Phase 2 Task 2: Argument Marshaling round-trips, no simulation", () => {
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

  describe("int", () => {
    it("success: 42", () => {
      expect(api.roundTripScalar("x = 42\nresult = x", "result", "int")).toBe(42n);
    });
    it("zero (empty-equivalent)", () => {
      expect(api.roundTripScalar("x = 0\nresult = x", "result", "int")).toBe(0n);
    });
    it("large: int64 max", () => {
      expect(api.roundTripScalar("x = 9223372036854775807\nresult = x", "result", "int")).toBe(9223372036854775807n);
    });
    it("type error: non-numeric string throws a real error, not a silent -1", () => {
      expect(() => api.roundTripScalar('x = "not a number"\nresult = x', "result", "int")).toThrow();
    });
  });

  describe("float", () => {
    it("success: 3.14", () => {
      expect(api.roundTripScalar("x = 3.14\nresult = x", "result", "float")).toBe(3.14);
    });
    it("zero", () => {
      expect(api.roundTripScalar("x = 0.0\nresult = x", "result", "float")).toBe(0);
    });
    it("large: 1e300", () => {
      expect(api.roundTripScalar("x = 1e300\nresult = x", "result", "float")).toBe(1e300);
    });
    it("type error: non-numeric string throws", () => {
      expect(() => api.roundTripScalar('x = "abc"\nresult = x', "result", "float")).toThrow();
    });
  });

  describe("bool", () => {
    it("success: True", () => {
      expect(api.roundTripScalar("x = True\nresult = x", "result", "bool")).toBe(true);
    });
    it("success: False", () => {
      expect(api.roundTripScalar("x = False\nresult = x", "result", "bool")).toBe(false);
    });
    // No "large"/"empty" concept applies to bool - only 2 valid values.
  });

  describe("string", () => {
    it("success: 'hello'", () => {
      expect(api.roundTripScalar("x = 'hello'\nresult = x", "result", "string")).toBe("hello");
    });
    it("empty string", () => {
      expect(api.roundTripScalar('x = ""\nresult = x', "result", "string")).toBe("");
    });
    it("large: a long repeated string", () => {
      const expected = "a".repeat(10000);
      expect(api.roundTripScalar(`x = "a" * 10000\nresult = x`, "result", "string")).toBe(expected);
    });
    it("KNOWN LIMITATION, disclosed: a string containing a real newline breaks this harness's own output-parsing protocol (same class of issue as print() colliding with stdout, documented in PYTHON_BRIDGE_SIGNATURES.md) - confirmed here as a real failure, not silently avoided", () => {
      expect(() => api.roundTripScalar('x = "line1\\nline2"\nresult = x', "result", "string")).toThrow();
    });
  });

  describe("null", () => {
    it("UR null -> Python None -> UR null: is-None check is True", () => {
      expect(api.roundTripScalar("x = None\nresult = (x is None)", "result", "bool")).toBe(true);
    });
    it("a real, non-null value correctly reports is-None as False", () => {
      expect(api.roundTripScalar("x = 5\nresult = (x is None)", "result", "bool")).toBe(false);
    });
  });

  describe("list", () => {
    it("success: [1, 2, 3]", () => {
      const r = api.containerRoundTrip("x = [1, 2, 3]\nresult = x", "result");
      expect(r.length).toBe(3);
      expect(r.repr).toBe("[1, 2, 3]");
    });
    it("empty list", () => {
      const r = api.containerRoundTrip("x = []\nresult = x", "result");
      expect(r.length).toBe(0);
      expect(r.repr).toBe("[]");
    });
    it("large: a 1000-element list", () => {
      const r = api.containerRoundTrip("x = list(range(1000))\nresult = x", "result");
      expect(r.length).toBe(1000);
    });
    it("type error: len() on a non-container raises a real Python TypeError, surfaced as a real thrown error", () => {
      expect(() => api.containerRoundTrip("x = 42\nresult = x", "result")).toThrow();
    });
  });

  describe("dict", () => {
    it("success: {'a': 1, 'b': 2}", () => {
      const r = api.containerRoundTrip("x = {'a': 1, 'b': 2}\nresult = x", "result");
      expect(r.length).toBe(2);
      expect(r.repr).toBe("{'a': 1, 'b': 2}");
    });
    it("empty dict", () => {
      const r = api.containerRoundTrip("x = {}\nresult = x", "result");
      expect(r.length).toBe(0);
      expect(r.repr).toBe("{}");
    });
    it("large: a 500-key dict", () => {
      const r = api.containerRoundTrip("x = {str(i): i for i in range(500)}\nresult = x", "result");
      expect(r.length).toBe(500);
    });
    it("type error: len() on a non-container raises a real error", () => {
      expect(() => api.containerRoundTrip("x = 3.14\nresult = x", "result")).toThrow();
    });
  });
});
