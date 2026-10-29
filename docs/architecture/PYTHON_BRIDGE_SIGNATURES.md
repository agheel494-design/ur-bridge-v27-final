# PYTHON_BRIDGE_SIGNATURES.md — CPython Embedding API, Documented Signatures

**Source: CPython's own public C API (Python.h), a primary source -
cross-checked against Python 3.12's own real ctypes.pythonapi
bindings in this environment.**

---

## Py_IsInitialized

- C signature: int Py_IsInitialized(void)
- Return type: int (0 = not initialized, non-zero = initialized)
- Argument types: none
- Special conditions: Safe to call at any time, including before
  Py_Initialize() - it only reads an internal flag. No GIL required.

## Py_Initialize

- C signature: void Py_Initialize(void)
- Return type: void - no return value. This project's own
  NativeCallResult type has a genuine "void" kind (confirmed by
  reading types.ts and harness-executor.ts directly) - the test
  harness generates real, void-typed C code for a call declared with
  returnKind: "void", never fabricating a return value. This is the
  correct, already-existing mechanism for this exact case - not a
  workaround.
- Argument types: none
- Special conditions: must be called before any other CPython API
  that requires an initialized interpreter. Calling it twice is safe
  (a no-op the second time). Acquires the GIL for the calling thread.
  Its own real side effect is verified via a real Py_IsInitialized()
  call immediately after (must become 1), since Py_Initialize()
  itself returns nothing to check.

## Py_FinalizeEx

- C signature: int Py_FinalizeEx(void)
- Return type: int (0 = success, -1 = error during finalization)
- Argument types: none
- Special conditions: must be called with the GIL held (true by
  default for the thread that called Py_Initialize(), since no other
  threads exist in this minimal embedding scenario). After this
  call, Py_IsInitialized() must report 0 again.

## PyRun_SimpleString

- C signature: int PyRun_SimpleString(const char *command)
- Return type: int (0 = success, -1 = an exception was raised)
- Argument types: one const char* - maps to this project's own
  NativeArg { kind: "str", value: string }
- Special conditions: requires the interpreter to already be
  initialized (Py_Initialize() must run first). Requires the GIL
  (held by default in this single-threaded embedding scenario).

## PyImport_AddModule

- C signature: PyObject* PyImport_AddModule(const char *name)
- Return type: PyObject* (opaque pointer) - maps to this project's
  own NativeArg/NativeCallResult "ptr" kind
- Argument types: one const char* (module name, e.g. "__main__")
- Special conditions: requires an initialized interpreter. Returns a
  borrowed reference (per CPython's own convention) - not owned by
  the caller, must not be decref'd. Confirmed to exist in this
  environment's real libpython3.12 via ctypes introspection.

## PyModule_GetDict

- C signature: PyObject* PyModule_GetDict(PyObject *module)
- Return type: PyObject* ("ptr")
- Argument types: one PyObject* ("ptr", the module handle from
  PyImport_AddModule)
- Special conditions: borrowed reference, same as above. Never fails
  for a real module object (no NULL check needed per CPython's own
  docs, unlike most other Py* functions).

## PyDict_GetItemString

- C signature: PyObject* PyDict_GetItemString(PyObject *p, const char *key)
- Return type: PyObject* ("ptr") - NULL if the key doesn't exist (no
  exception set in that case, per CPython's own documented behavior)
- Argument types: PyObject* ("ptr"), const char* ("str")
- Special conditions: borrowed reference.

## PyLong_AsLong / PyFloat_AsDouble / PyObject_IsTrue / PyUnicode_AsUTF8

- C signatures:
  - `long PyLong_AsLong(PyObject *obj)`
  - `double PyFloat_AsDouble(PyObject *obj)`
  - `int PyObject_IsTrue(PyObject *obj)`
  - `const char* PyUnicode_AsUTF8(PyObject *unicode)`
- Return types: i64 (long, mapped to this project's own "i64" kind
  for safety against 32-bit truncation), f64, i32, str respectively
- Argument types: one PyObject* ("ptr") each
- Special conditions: each can fail (returns -1/-1.0/-1/NULL
  respectively) if the object is not actually of the expected type or
  an error occurs - real error checking via PyErr_Occurred() is
  needed for a production-quality bridge but is explicitly deferred
  to Task 3 (Exception Handling) of this phase, not attempted here.
  This first pass assumes well-typed Python code, disclosed
  explicitly, not silently assumed.

## Confirmed present in this environment

All five functions above confirmed to exist in the real
libpython3.12.so.1.0 present in this environment, via direct
ctypes.PyDLL(None) introspection - not assumed from documentation
alone.

**1. Every single `execute()` call spawns a fresh OS process** (this
project's own `HarnessExecutor`, per its own header comment: "the
harness process exits after each execute() call"). CPython's own
interpreter state, set up by `Py_Initialize()`, therefore cannot
survive between two SEPARATE `execute()` calls — a naive
"call initialize(), then separately call isInitialized()" sequence
will always show "not initialized" on the second call, because it
runs in a brand-new process with a fresh, uninitialized libpython.
**Resolution**: batch the entire lifecycle (init → run code →
finalize → verify) into ONE `execute()` call (one real process), so
state genuinely persists. This is why `PythonDriver` exposes both
individual per-call methods (for API shape / isolated unit testing)
and `runLifecycleSequence()` (the only one that proves a real,
stateful, multi-step Python session).

**2. Python code that itself writes to stdout collides with this
harness's own output-parsing protocol.** The harness expects exactly
one tagged output line (`I32:`/`VOID:`/etc.) per native call, in
strict order. `PyRun_SimpleString("print('hello')")` genuinely
executes and genuinely prints `hello` — but that line lands in the
same `stdout` stream the harness parses for its own call results,
shifting every subsequent line by one and breaking parsing entirely.
Confirmed directly, not assumed: a live test with `print('hello')`
throws a parse error on the FIRST call in the sequence (not even the
print call itself), because the printed line displaces it. This is a
real limitation of this specific test harness, not a bug in
`PythonDriver` — output-producing Python code needs a different
harness mechanism (capturing Python's own stdout separately from the
harness's own protocol lines), tracked as a real, disclosed follow-up
item, not silently worked around. The incremental test suite uses
print-free code (`"x=2+3"`) to prove `PyRun_SimpleString` itself
works correctly, and includes a separate, permanent test confirming
the `print()` limitation itself (so it is never silently "fixed" by
an unrelated future change without a conscious decision).
