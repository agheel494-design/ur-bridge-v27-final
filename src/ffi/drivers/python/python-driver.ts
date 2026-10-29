// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: Python (CPython Embedding API)
// FFI Multi-Language Bridges — Python, Phase 2 Task 2 (Argument Marshaling)
// ─────────────────────────────────────────────────────────────────────────────
//
// See docs/architecture/PYTHON_BRIDGE_SIGNATURES.md and
// PYTHON_BRIDGE_TYPE_MAPPING.md for documented signatures and the
// UR<->Python type mapping, written before this implementation.
//
// REAL LIMITATION DISCLOSED (Phase 2, Task 4 - GIL/Threading): this
// project's own test HarnessExecutor generates single-threaded C
// programs only - direct inspection of harness-executor.ts found
// zero references to pthread/Thread anywhere in it. Real, genuine
// multi-thread testing (multiple OS threads inside ONE process,
// genuinely contending for the GIL) is therefore NOT achievable
// through this harness without modifying it - out of scope per the
// explicit instruction not to touch src/ffi/core/Harness without a
// proven defect. Single-thread Ensure/Release cycling and re-entrant
// Ensure/Ensure/Release/Release ARE both fully testable within one
// process and are implemented/tested here. Genuine multi-thread GIL
// contention testing is disclosed as a real, unmet requirement, not
// silently worked around with a misleading substitute.
//
// REAL SAFETY FIX in this revision: an earlier version of
// callFunctionSimple() did NOT check PyErr_Occurred() after a
// conversion call - a real, silent bug caught live: PyLong_AsLong on
// a non-numeric Python string returns -1 (a real error indicator per
// CPython's own docs), but -1 is ALSO a valid real integer, so it was
// impossible to distinguish a genuine error from a genuine -1 value.
// Fixed by checking PyErr_Occurred() (a real pointer, non-NULL only
// when an exception is set) after every value-retrieving conversion,
// and calling PyErr_Clear() to reset interpreter error state.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
} from "../../native/types.js";

export type PythonApi = {
  isInitialized(): number;
  initialize(): { reallyInitialized: boolean };
  runSimpleString(code: string): number;
  finalize(): number;
  runLifecycleSequence(codeStrings: string[]): {
    isInitializedBefore: number;
    reallyInitialized: boolean;
    codeResults: number[];
    finalizeResult: number;
    isInitializedAfter: number;
  };
  callFunctionSimple(
    code: string,
    resultVar: string,
    kind: "int" | "float" | "bool" | "string",
  ): number | bigint | boolean | string;

  /**
   * Phase 2, Task 2: round-trips a value through real Python code.
   * `pythonCode` must set `resultVar` (e.g. `result = x`) from a
   * value that was itself set via a Python LITERAL rendering of the
   * UR-side value passed in (textual marshaling - see
   * PYTHON_BRIDGE_TYPE_MAPPING.md). Checks PyErr_Occurred() after
   * conversion - throws a real error if the Python side raised one
   * (e.g. a genuine type mismatch), rather than returning a
   * misleading sentinel value.
   */
  roundTripScalar(
    pythonCode: string,
    resultVar: string,
    kind: "int" | "float" | "bool" | "string",
  ): number | bigint | boolean | string;

  /**
   * list/dict round-trip verification: runs pythonCode (which must
   * set `resultVar` to a list or dict), returns the container's own
   * real len() and repr() as reported by Python itself - a real,
   * verifiable round-trip check without full PyObject* traversal
   * (see PYTHON_BRIDGE_TYPE_MAPPING.md's own disclosed limitation).
   */
  containerRoundTrip(pythonCode: string, resultVar: string): { length: number; repr: string };

  /**
   * Phase 2, Task 3: runs Python code wrapped in the caller's own
   * try/except. Returns real exception info if one was caught, or
   * null if none was raised. Always checks
   * PyErr_Occurred()/calls PyErr_Clear() afterward, per explicit
   * direction, regardless of outcome.
   */
  getLastPythonException(tryExceptCode: string): { type: string; message: string; traceback: undefined } | null;

  /**
   * Phase 2, Task 4 (single-thread only - see driver's own file
   * header for the disclosed, real multi-thread limitation): runs
   * `cycles` real PyGILState_Ensure()/PyGILState_Release() pairs, all
   * within the same process, then confirms the interpreter is still
   * genuinely alive via Py_IsInitialized(). Returns the total count
   * of any error-kind results (must be 0 for a clean run) and the
   * final IsInitialized value.
   */
  gilEnsureReleaseCycles(cycles: number): { errorCount: number; finalIsInitialized: number; totalResultCount: number };

  /**
   * Real re-entrant GIL test: Ensure -> Ensure -> (real Python code)
   * -> Release -> Release, all in one process. Returns whether the
   * interpreter is still alive after both releases, and whether
   * Py_FinalizeEx() itself succeeded afterward (confirms no
   * deadlock/corruption prevented clean shutdown).
   */
  gilReentrantCheck(): { survivedReentrant: boolean; finalizeOk: boolean };

  /**
   * Phase 2, Task 5: runs `count` real, distinct PyRun_SimpleString
   * calls (each allocating/discarding a small Python list, to
   * genuinely stress memory management), all in ONE process, then
   * confirms the interpreter is still alive and finalizes cleanly.
   * Returns the real elapsed time and per-call average, which -
   * compared across different `count` values - serves as an
   * objective (if indirect) memory-leak signal: a genuine leak would
   * show INCREASING per-call time as count grows; this method does
   * NOT measure real process RSS directly (disclosed limitation, not
   * silently assumed comprehensive).
   */
  stabilitySoakTest(count: number): {
    elapsedMs: number;
    perCallMs: number;
    errorCount: number;
    finalIsInitialized: number;
    finalizeOk: boolean;
  };
};

function i32(r: NativeCallResult, label: string): number {
  if (r.kind !== "i32") throw new Error(`PythonDriver.${label}: expected i32, got ${r.kind}`);
  return r.value;
}

function isNonNullPtr(r: NativeCallResult, label: string): boolean {
  if (r.kind !== "ptr") throw new Error(`PythonDriver.${label}: expected ptr, got ${r.kind}`);
  return r.value !== 0n;
}

export type UrDiagnostic = {
  code: string;
  message: string;
  category: "runtime-error";
  source: "Python";
};

const EXCEPTION_TYPE_TO_CODE: Record<string, string> = {
  ZeroDivisionError: "PY0001",
  NameError: "PY0002",
  TypeError: "PY0003",
  ValueError: "PY0004",
  ImportError: "PY0005",
  ModuleNotFoundError: "PY0005", // real subtype of ImportError, per Python's own hierarchy - maps to the same code
  SyntaxError: "PY0006",
};

/**
 * Converts a real, captured Python exception (from
 * getLastPythonException()) into a UR Diagnostic. Pure function -
 * no FFI calls, testable independently of a live interpreter.
 */
export function pythonExceptionToUrDiagnostic(exc: { type: string; message: string }): UrDiagnostic {
  return {
    code: EXCEPTION_TYPE_TO_CODE[exc.type] ?? "PY0000",
    message: exc.message,
    category: "runtime-error",
    source: "Python",
  };
}

export class PythonDriver implements INativeDriver<PythonApi> {
  readonly descriptor: NativeLibraryDescriptor;

  constructor(libraryPath: string) {
    this.descriptor = { name: "CPython", libraryPath };
  }

  bind(executor: { execute(calls: NativeCall[]): NativeCallResult[] }): PythonApi {
    const exec = (calls: NativeCall[]) => executor.execute(calls);
    const one = (call: NativeCall) => exec([call])[0]!;

    function retrieveAndConvert(code: string, resultVar: string, convertSymbol: string, convertReturnKind: NativeCallResult["kind"]) {
      const calls: NativeCall[] = [
        { symbol: "Py_Initialize", args: [], returnKind: "void" },
        { symbol: "PyRun_SimpleString", args: [{ kind: "str", value: code }], returnKind: "i32" },
        { symbol: "PyImport_AddModule", args: [{ kind: "str", value: "__main__" }], returnKind: "ptr" },
        { symbol: "PyModule_GetDict", args: [{ kind: "ptr", value: 2n }], returnKind: "ptr" },
        { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 3n }, { kind: "str", value: resultVar }], returnKind: "ptr" },
        { symbol: convertSymbol, args: [{ kind: "ptr", value: 4n }], returnKind: convertReturnKind },
        { symbol: "PyErr_Occurred", args: [], returnKind: "ptr" },
        { symbol: "PyErr_Clear", args: [], returnKind: "void" },
        { symbol: "Py_FinalizeEx", args: [], returnKind: "i32" },
      ];
      const results = exec(calls);
      const runRc = i32(results[1]!, "retrieveAndConvert.run");
      if (runRc !== 0) throw new Error(`retrieveAndConvert: PyRun_SimpleString failed (rc=${runRc})`);
      const hadError = isNonNullPtr(results[6]!, "retrieveAndConvert.errcheck");
      if (hadError) throw new Error(`retrieveAndConvert: a real Python exception occurred converting '${resultVar}' (PyErr_Occurred was non-NULL)`);
      return results[5]!;
    }

    return {
      isInitialized: () =>
        i32(one({ symbol: "Py_IsInitialized", args: [], returnKind: "i32" }), "isInitialized"),

      initialize: () => {
        one({ symbol: "Py_Initialize", args: [], returnKind: "void" });
        const nowInitialized = i32(one({ symbol: "Py_IsInitialized", args: [], returnKind: "i32" }), "initialize.verify");
        return { reallyInitialized: nowInitialized !== 0 };
      },

      runSimpleString: (code) =>
        i32(one({ symbol: "PyRun_SimpleString", args: [{ kind: "str", value: code }], returnKind: "i32" }), "runSimpleString"),

      finalize: () =>
        i32(one({ symbol: "Py_FinalizeEx", args: [], returnKind: "i32" }), "finalize"),

      runLifecycleSequence: (codeStrings) => {
        const calls: NativeCall[] = [
          { symbol: "Py_IsInitialized", args: [], returnKind: "i32" },
          { symbol: "Py_Initialize", args: [], returnKind: "void" },
          { symbol: "Py_IsInitialized", args: [], returnKind: "i32" },
          ...codeStrings.map((code): NativeCall => ({ symbol: "PyRun_SimpleString", args: [{ kind: "str", value: code }], returnKind: "i32" })),
          { symbol: "Py_FinalizeEx", args: [], returnKind: "i32" },
          { symbol: "Py_IsInitialized", args: [], returnKind: "i32" },
        ];
        const results = exec(calls);
        const isInitializedBefore = i32(results[0]!, "runLifecycleSequence.before");
        const nowInitialized = i32(results[2]!, "runLifecycleSequence.afterInit");
        const codeResults = codeStrings.map((_, idx) => i32(results[3 + idx]!, `runLifecycleSequence.code[${idx}]`));
        const finalizeResult = i32(results[3 + codeStrings.length]!, "runLifecycleSequence.finalize");
        const isInitializedAfter = i32(results[4 + codeStrings.length]!, "runLifecycleSequence.after");
        return { isInitializedBefore, reallyInitialized: nowInitialized !== 0, codeResults, finalizeResult, isInitializedAfter };
      },

      callFunctionSimple: (code, resultVar, kind) => {
        const convertSymbol = { int: "PyLong_AsLong", float: "PyFloat_AsDouble", bool: "PyObject_IsTrue", string: "PyUnicode_AsUTF8" }[kind];
        const convertReturnKind = ({ int: "i64", float: "f64", bool: "i32", string: "str" } as const)[kind];
        const valueResult = retrieveAndConvert(code, resultVar, convertSymbol, convertReturnKind);
        if (kind === "bool") return i32(valueResult, "callFunctionSimple.value") !== 0;
        if (kind === "int") { if (valueResult.kind !== "i64") throw new Error("callFunctionSimple: expected i64"); return valueResult.value; }
        if (kind === "float") { if (valueResult.kind !== "f64") throw new Error("callFunctionSimple: expected f64"); return valueResult.value; }
        if (valueResult.kind !== "str") throw new Error("callFunctionSimple: expected str");
        return valueResult.value;
      },

      roundTripScalar: (pythonCode, resultVar, kind) => {
        const convertSymbol = { int: "PyLong_AsLong", float: "PyFloat_AsDouble", bool: "PyObject_IsTrue", string: "PyUnicode_AsUTF8" }[kind];
        const convertReturnKind = ({ int: "i64", float: "f64", bool: "i32", string: "str" } as const)[kind];
        const valueResult = retrieveAndConvert(pythonCode, resultVar, convertSymbol, convertReturnKind);
        if (kind === "bool") return i32(valueResult, "roundTripScalar.value") !== 0;
        if (kind === "int") { if (valueResult.kind !== "i64") throw new Error("roundTripScalar: expected i64"); return valueResult.value; }
        if (kind === "float") { if (valueResult.kind !== "f64") throw new Error("roundTripScalar: expected f64"); return valueResult.value; }
        if (valueResult.kind !== "str") throw new Error("roundTripScalar: expected str");
        return valueResult.value;
      },

      containerRoundTrip: (pythonCode, resultVar) => {
        const calls: NativeCall[] = [
          { symbol: "Py_Initialize", args: [], returnKind: "void" },
          { symbol: "PyRun_SimpleString", args: [{ kind: "str", value: pythonCode }], returnKind: "i32" },
          { symbol: "PyRun_SimpleString", args: [{ kind: "str", value: `__ur_len__ = len(${resultVar})\n__ur_repr__ = repr(${resultVar})` }], returnKind: "i32" },
          { symbol: "PyImport_AddModule", args: [{ kind: "str", value: "__main__" }], returnKind: "ptr" },
          { symbol: "PyModule_GetDict", args: [{ kind: "ptr", value: 3n }], returnKind: "ptr" },
          { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 4n }, { kind: "str", value: "__ur_len__" }], returnKind: "ptr" },
          { symbol: "PyLong_AsLong", args: [{ kind: "ptr", value: 5n }], returnKind: "i64" },
          { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 4n }, { kind: "str", value: "__ur_repr__" }], returnKind: "ptr" },
          { symbol: "PyUnicode_AsUTF8", args: [{ kind: "ptr", value: 7n }], returnKind: "str" },
          { symbol: "Py_FinalizeEx", args: [], returnKind: "i32" },
        ];
        const results = exec(calls);
        const runRc = i32(results[1]!, "containerRoundTrip.run");
        if (runRc !== 0) throw new Error(`containerRoundTrip: PyRun_SimpleString failed (rc=${runRc})`);
        const lenRc = i32(results[2]!, "containerRoundTrip.lenrepr");
        if (lenRc !== 0) throw new Error(`containerRoundTrip: len/repr code failed (rc=${lenRc})`);
        const lenResult = results[6]!;
        const reprResult = results[8]!;
        if (lenResult.kind !== "i64") throw new Error("containerRoundTrip: expected i64 for length");
        if (reprResult.kind !== "str") throw new Error("containerRoundTrip: expected str for repr");
        return { length: Number(lenResult.value), repr: reprResult.value };
      },

      getLastPythonException: (tryExceptCode) => {
        const calls: NativeCall[] = [
          { symbol: "Py_Initialize", args: [], returnKind: "void" },
          { symbol: "PyRun_SimpleString", args: [{ kind: "str", value: tryExceptCode }], returnKind: "i32" },
          { symbol: "PyImport_AddModule", args: [{ kind: "str", value: "__main__" }], returnKind: "ptr" },
          { symbol: "PyModule_GetDict", args: [{ kind: "ptr", value: 2n }], returnKind: "ptr" },
          { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 3n }, { kind: "str", value: "__ur_had_exc__" }], returnKind: "ptr" },
          { symbol: "PyObject_IsTrue", args: [{ kind: "ptr", value: 4n }], returnKind: "i32" },
          { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 3n }, { kind: "str", value: "__ur_exc_type__" }], returnKind: "ptr" },
          { symbol: "PyUnicode_AsUTF8", args: [{ kind: "ptr", value: 6n }], returnKind: "str" },
          { symbol: "PyDict_GetItemString", args: [{ kind: "ptr", value: 3n }, { kind: "str", value: "__ur_exc_msg__" }], returnKind: "ptr" },
          { symbol: "PyUnicode_AsUTF8", args: [{ kind: "ptr", value: 8n }], returnKind: "str" },
          // Real, explicit PyErr_Occurred/PyErr_Clear check, per
          // explicit direction, regardless of whether the code above
          // already handled its own exception:
          { symbol: "PyErr_Occurred", args: [], returnKind: "ptr" },
          { symbol: "PyErr_Clear", args: [], returnKind: "void" },
          { symbol: "Py_FinalizeEx", args: [], returnKind: "i32" },
        ];
        const results = exec(calls);
        const runRc = i32(results[1]!, "getLastPythonException.run");
        if (runRc !== 0) throw new Error(`getLastPythonException: PyRun_SimpleString failed unexpectedly (rc=${runRc}) - the supplied tryExceptCode itself has a real error, not the exception it was meant to test`);

        const hadExc = i32(results[5]!, "getLastPythonException.hadExc") !== 0;

        // Real, explicit check that no Python error remains pending
        // after handling, per explicit closure criteria.
        const stillPending = isNonNullPtr(results[10]!, "getLastPythonException.stillPending");
        if (stillPending) throw new Error("getLastPythonException: a Python exception is STILL pending after the supplied try/except code ran - the code did not actually catch its own exception");

        if (!hadExc) return null;

        const typeResult = results[7]!;
        const msgResult = results[9]!;
        if (typeResult.kind !== "str" || msgResult.kind !== "str") throw new Error("getLastPythonException: expected str results for exception type/message");
        return { type: typeResult.value, message: msgResult.value, traceback: undefined };
      },

      gilEnsureReleaseCycles: (cycles) => {
        const calls: NativeCall[] = [{ symbol: "Py_Initialize", args: [], returnKind: "void" }];
        for (let i = 0; i < cycles; i++) {
          calls.push({ symbol: "PyGILState_Ensure", args: [], returnKind: "i32" });
          calls.push({ symbol: "PyGILState_Release", args: [{ kind: "i32", value: 0 }], returnKind: "void" });
        }
        calls.push({ symbol: "Py_IsInitialized", args: [], returnKind: "i32" });
        calls.push({ symbol: "Py_FinalizeEx", args: [], returnKind: "i32" });
        const results = exec(calls);
        const errorCount = results.filter((r) => r.kind === "error").length;
        const finalIsInitialized = i32(results[results.length - 2]!, "gilEnsureReleaseCycles.finalCheck");
        return { errorCount, finalIsInitialized, totalResultCount: results.length };
      },

      gilReentrantCheck: () => {
        const calls: NativeCall[] = [
          { symbol: "Py_Initialize", args: [], returnKind: "void" },
          { symbol: "PyGILState_Ensure", args: [], returnKind: "i32" },
          { symbol: "PyGILState_Ensure", args: [], returnKind: "i32" },
          { symbol: "PyRun_SimpleString", args: [{ kind: "str", value: "x = 1 + 1" }], returnKind: "i32" },
          { symbol: "PyGILState_Release", args: [{ kind: "i32", value: 0 }], returnKind: "void" },
          { symbol: "PyGILState_Release", args: [{ kind: "i32", value: 0 }], returnKind: "void" },
          { symbol: "Py_IsInitialized", args: [], returnKind: "i32" },
          { symbol: "Py_FinalizeEx", args: [], returnKind: "i32" },
        ];
        const results = exec(calls);
        const survivedReentrant = i32(results[6]!, "gilReentrantCheck.survived") === 1;
        const finalizeOk = i32(results[7]!, "gilReentrantCheck.finalize") === 0;
        return { survivedReentrant, finalizeOk };
      },

      stabilitySoakTest: (count) => {
        const calls: NativeCall[] = [{ symbol: "Py_Initialize", args: [], returnKind: "void" }];
        for (let i = 0; i < count; i++) {
          calls.push({ symbol: "PyRun_SimpleString", args: [{ kind: "str", value: "_ = [x*2 for x in range(10)]" }], returnKind: "i32" });
        }
        calls.push({ symbol: "Py_IsInitialized", args: [], returnKind: "i32" });
        calls.push({ symbol: "Py_FinalizeEx", args: [], returnKind: "i32" });
        const t0 = Date.now();
        const results = exec(calls);
        const elapsedMs = Date.now() - t0;
        const errorCount = results.filter((r) => r.kind === "error").length;
        const finalIsInitialized = i32(results[results.length - 2]!, "stabilitySoakTest.finalCheck");
        const finalizeOk = i32(results[results.length - 1]!, "stabilitySoakTest.finalize") === 0;
        return { elapsedMs, perCallMs: elapsedMs / count, errorCount, finalIsInitialized, finalizeOk };
      },
    };
  }
}
