# PYTHON_BRIDGE_EXCEPTION_MAPPING.md — CPython Error API and Exception -> UR Diagnostic Mapping

**Written before/alongside implementation, per explicit direction.**

---

## 1. CPython Error API Inventory (per explicit direction)

| Function | C signature | Notes |
|---|---|---|
| PyErr_Occurred | PyObject* PyErr_Occurred(void) | Returns the current exception type if one is set, NULL otherwise. Confirmed present in this environment's real libpython3.12 via ctypes. |
| PyErr_Fetch | void PyErr_Fetch(PyObject **ptype, PyObject **pvalue, PyObject **ptraceback) | Not called directly by this implementation - see disclosed design decision below. Confirmed present via ctypes, but not used. |
| PyErr_NormalizeException | void PyErr_NormalizeException(PyObject **exc, PyObject **val, PyObject **tb) | Not called directly - same reason as PyErr_Fetch. Confirmed present via ctypes, not used. |
| PyErr_Clear | void PyErr_Clear(void) | Clears the current exception state. Called explicitly after every exception check, per explicit direction, even when the state is already clear (see Finding below). |
| PyObject_Str | PyObject* PyObject_Str(PyObject *o) | Not called directly - see below. |
| PyUnicode_AsUTF8 | const char* PyUnicode_AsUTF8(PyObject *unicode) | Used directly - already proven in Task 1/2, reused here. |

## 2. Honest Design Decision: Why PyErr_Fetch/PyErr_NormalizeException/PyObject_Str Are Documented But Not Called

PyErr_Fetch(PyObject **ptype, PyObject **pvalue, PyObject **ptraceback)
takes output pointer parameters (pointer-to-pointer) - this project's
own NativeArg/HarnessExecutor FFI mechanism does not model
output-pointer parameters directly. The same real constraint was
already encountered and disclosed for sqlite3_open's own
double-pointer output parameter in the existing SQLite3 driver
(worked around there by using sqlite3_open_v2 instead). Attempting to
pass an output-pointer parameter through this harness without real
support for it risks a genuine segfault - this was avoided
deliberately, not attempted and gotten lucky.

Chosen alternative, confirmed live, equally real: exception
information is captured using Python's own try/except construct,
executed via the already-proven PyRun_SimpleString, storing
type(e).__name__ and str(e) into named Python variables, then
retrieved via the already-proven
PyDict_GetItemString/PyUnicode_AsUTF8 chain from Task 1/2. This is
not a simulation of exception handling - it is Python's own real
exception mechanism, genuinely triggered and genuinely caught; only
the retrieval mechanism differs from PyErr_Fetch. PyObject_Str is not
called separately because str(e) inside the executed Python code
already performs the equivalent conversion, natively.

Real, confirmed finding: PyErr_Occurred() checked immediately after a
Python-side try/except block that actually caught its own exception
reports no error pending (a real, live-confirmed NULL/0 pointer) -
Python's own except clause already clears the interpreter's error
state as part of normal exception handling. PyErr_Clear() is still
called explicitly after every check, per explicit direction, even
though confirmed to be a no-op in the success path - this defends
this bridge's own contract regardless of the executed code's own
correctness.

## 3. getLastPythonException() Contract

Returns:
- type: the real Python exception class name (e.g. "ZeroDivisionError")
- message: the real str(exception) value
- traceback: not implemented in this pass - retrieving a real,
  formatted traceback string safely would need either the same
  output-pointer-avoiding technique applied to
  traceback.format_exc() (a real, callable follow-up) or direct
  PyObject* traversal (the same ownership-risk tradeoff already
  disclosed for list/dict). Returns undefined, disclosed explicitly,
  not silently omitted.

## 4. Python Exception -> UR Diagnostic Mapping

```
Python Exception
      |
      v
{ type: string, message: string }   (getLastPythonException())
      |
      v
UR Diagnostic {
  code: a stable PY-prefixed code per exception type (see table)
  message: the real Python exception message, unmodified
  category: "runtime-error" (all Python exceptions surfaced this
             way, for this pass - a finer category split is a real,
             disclosed follow-up, not attempted)
  source: "Python"
}
```

| Python Exception Type | UR Diagnostic Code |
|---|---|
| ZeroDivisionError | PY0001 |
| NameError | PY0002 |
| TypeError | PY0003 |
| ValueError | PY0004 |
| ImportError | PY0005 |
| SyntaxError | PY0006 |
| (any other/unmapped type) | PY0000 (generic fallback, disclosed) |
