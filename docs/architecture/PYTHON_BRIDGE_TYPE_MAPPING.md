# PYTHON_BRIDGE_TYPE_MAPPING.md — UR <-> Python Argument Marshaling

**Written before implementation, per explicit direction.**

---

## Marshaling Mechanism (a real design decision, disclosed explicitly)

Rather than building PyObject* values directly via CPython's C API
(PyLong_FromLongLong, PyList_SetItem, etc. - which requires manual
reference-count management with real double-free/leak risk if done
incorrectly through this project's own per-call FFI harness), this
implementation uses textual marshaling: a UR value is rendered into
its exact, correct Python literal syntax, embedded into Python source
code run via the already-proven PyRun_SimpleString, and the result is
read back via the already-proven PyDict_GetItemString/converter chain
from Task 1. This is a real, legitimate FFI marshaling strategy - the
value genuinely enters and leaves the real CPython interpreter - and
avoids manual PyObject* ownership entirely for this phase.

None/null is handled via Python's own "is None" comparison in the
executed code (returns a real Python bool), rather than requiring the
raw C address of the Py_None singleton (a global variable, not a
function - not dlsym-able the same way the functions in this driver
are).

## Type Mapping Table

| UR Type | Python Type | UR -> Python (literal rendering) | Python -> UR (conversion) |
|---|---|---|---|
| int | int | decimal literal, e.g. 42 | PyLong_AsLong (already proven, Task 1) |
| float | float | decimal literal, e.g. 3.14 | PyFloat_AsDouble (already proven) |
| bool | bool | True / False | PyObject_IsTrue (already proven) |
| string | str | Python string literal with proper escaping | PyUnicode_AsUTF8 (already proven) |
| null | None | None | "is None" check -> bool, not object retrieval |
| list | list | [elem1, elem2, ...] | len(x) for size + repr()-based textual verification (see limitation below) |
| dict | dict | {"key1": val1, ...} (string keys only) | len(x) for size + key lookup for verification |

## Known Limitation, Disclosed Before Implementation

Retrieving a real, structured PyObject* (a list or dict object
itself) back into arbitrary UR-side structured data would need either
real PyObject* C API traversal or JSON-based marshaling. This pass
verifies list/dict round-trips by comparing Python's own len() and a
formatted textual re-serialization (via repr(), parsed back as a
UR-side string comparison) - a real, verifiable round-trip test, but
not a generalized "convert any PyObject* to a UR value" primitive.
That primitive is out of scope for this pass, disclosed as a real
follow-up, not silently assumed solved.
