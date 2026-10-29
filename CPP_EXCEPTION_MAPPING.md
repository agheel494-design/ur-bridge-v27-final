# C++ Exception Mapping (Phase 7, RC1 — FROZEN)

**Status: stable, frozen.** Behavior changes require a new regression
test demonstrating the change before merging.

## Why this exists

A C++ exception must never cross an `extern "C"` FFI boundary. The
instant it reaches non-C++ calling code (or even C++ compiled with
incompatible unwind tables, which a dynamically loaded `.so` may well
be), the behavior is undefined — in practice this usually means an
immediate crash (`std::terminate`) with no useful diagnostic. Every
generated binding must catch exceptions *at* the boundary and convert
them into a status code UR can branch on safely.

## Architectural design

`src/ffi/bindgen/cpp/cpp-exceptions.ts` generates one `extern "C"`
trampoline per public method/function. Each trampoline:

1. Calls the real C++ method/function inside a `try` block.
2. On success, writes the return value through an out-parameter and
   returns `UR_OK`.
3. On a thrown exception, catches it in a fixed cascade (see below),
   copies `.what()` into a caller-supplied buffer, and returns the
   matching `UrErrorCode`.
4. As a final safety net, `catch (...)` catches anything else —
   including values that aren't `std::exception`-derived at all
   (`throw 42;`) — and returns `UR_UNKNOWN_THROWN_VALUE` with a fixed
   diagnostic message (no `.what()` is available for non-exception
   throws).

Destructors are **not** wrapped: they're implicitly `noexcept` in
standard C++, and a throwing destructor calls `std::terminate`
regardless of any surrounding `try/catch`, so wrapping one would be
misleading rather than protective.

## Full execution path

```
C++ Header  →  Header Parser  →  Declaration Model  →  Binding Plan
   →  Itanium Mangler  →  ABI Validation
   →  Exception Trampoline Generator (this module)
   →  g++ Compilation (real .so)  →  Dynamic Loading (dlopen)
   →  UR Runtime (dlsym by mangled/trampoline name)
   →  Exception Mapping (this module's generated code, at runtime)
   →  UR Diagnostics (UrErrorCode + message surfaced to UR code)
```

See CPP_BINDING_PIPELINE.md for the full pipeline document shared across
all C++ binding stages.

## Supported exception types and their error codes

| Code | Value | Matches |
|---|---|---|
| `UR_OK` | 0 | success |
| `UR_INVALID_ARGUMENT` | 1 | `std::invalid_argument` |
| `UR_OUT_OF_RANGE` | 2 | `std::out_of_range` |
| `UR_LOGIC_ERROR` | 3 | `std::logic_error` (or any other `logic_error`-derived type not listed above) |
| `UR_RUNTIME_ERROR` | 4 | `std::runtime_error` (or any other `runtime_error`-derived type) |
| `UR_UNKNOWN_EXCEPTION` | 5 | `std::exception` (the root) — covers `std::exception` thrown directly, and any user-defined type deriving from it that isn't one of the above |
| `UR_UNKNOWN_THROWN_VALUE` | 6 | anything not derived from `std::exception` at all |

## Catch-clause order (load-bearing, not cosmetic)

C++ tries `catch` clauses in **textual order** and stops at the first
type match — unlike function overload resolution, it does not pick the
*best* match. The clauses are therefore emitted most-derived first:

```
std::invalid_argument   (derives from logic_error)
std::out_of_range       (derives from logic_error)
std::logic_error
std::runtime_error
std::exception            <- root, catch-all for the standard hierarchy
catch (...)                <- absolute safety net, non-exception throws
```

Reversing this order doesn't fail to compile — it silently
misclassifies every `invalid_argument`/`out_of_range` as the generic
`logic_error`, which is exactly the kind of bug this design (and its
regression tests) is built to prevent.

## Practical example

Given this header:

```cpp
class Parser {
public:
  int parseStrict(int value) const; // throws std::invalid_argument / std::out_of_range
};
```

The pipeline generates (abbreviated):

```cpp
extern "C" int Parser_parseStrict(const void* self, int a0, int* outResult, char* errBuf, int errBufLen) {
  try {
    *outResult = static_cast<const Parser*>(self)->parseStrict(a0);
    return UR_OK;
  } catch (const std::invalid_argument& e) {
    ur_copy_err(errBuf, errBufLen, e.what());
    return UR_INVALID_ARGUMENT;
  } catch (const std::out_of_range& e) {
    ur_copy_err(errBuf, errBufLen, e.what());
    return UR_OUT_OF_RANGE;
  } catch (const std::logic_error& e) { /* ... */ return UR_LOGIC_ERROR;
  } catch (const std::runtime_error& e) { /* ... */ return UR_RUNTIME_ERROR;
  } catch (const std::exception& e) { /* ... */ return UR_UNKNOWN_EXCEPTION;
  } catch (...) { /* ... */ return UR_UNKNOWN_THROWN_VALUE;
  }
}
```

UR's runtime resolves `"Parser_parseStrict"` via `dlsym()` and calls it
exactly like any other C function — the exception is fully contained on
the C++ side.

## Verification — no simulation

Every claim above is backed by a **real** `g++`-compiled,
`dlopen()`-loaded, `dlsym()`-called test, never a hand-typed/mocked
mangled name or simulated exception.

### Test results (current)

| Test file | Kind | Result |
|---|---|---|
| `tests/ffi/cpp/cpp-exceptions.test.ts` | unit (string-level, no toolchain) | 12/12 pass |
| `tests/ffi/cpp/cpp-exception-mapping-e2e.test.ts` | end-to-end, real g++ | 1/1 pass (8 internal assertions) |
| `tests/ffi/cpp/cpp-exception-mapping-full-matrix-e2e.test.ts` | end-to-end, real g++, full coverage matrix | 1/1 pass (35 internal assertions) |

`cpp-exception-mapping-full-matrix-e2e.test.ts` drives the actual
pipeline (`parseCppHeader` → `buildBindingPlan` →
`emitExceptionSafeTrampolines` → real `g++` → `dlopen`/`dlsym`) against
`tests/ffi/cpp/fixtures/exception-lab.{h,cpp}`, one real throwing C++
method per required case:

| Case | C++ throws | Verified UR code | Message check |
|---|---|---|---|
| `throwsRuntimeError` | `std::runtime_error` | `UR_RUNTIME_ERROR` | exact match |
| `throwsLogicErrorBase` | `std::logic_error` (base, not a derived type) | `UR_LOGIC_ERROR` | exact match |
| `throwsInvalidArgument` | `std::invalid_argument` | `UR_INVALID_ARGUMENT` | exact match |
| `throwsOutOfRange` | `std::out_of_range` | `UR_OUT_OF_RANGE` | exact match |
| `throwsExceptionBase` | `std::exception` (root, thrown directly) | `UR_UNKNOWN_EXCEPTION` | non-empty (libstdc++'s default message is implementation-defined, not asserted exactly) |
| `throwsCustomException` | user-defined type deriving from `std::exception`, overriding `what()` | `UR_UNKNOWN_EXCEPTION` | exact match — proves virtual dispatch through `.what()` works correctly across the boundary |
| `throwsUnknownValue` | `throw 42;` — **not** derived from `std::exception` at all | `UR_UNKNOWN_THROWN_VALUE` | fixed diagnostic message |

For every case, the test performs **both**: (a) calling the real method
directly via ordinary C++ linkage (ground truth) and (b) calling it
through the `dlsym`-resolved generated trampoline — for both the success
path and the throwing path — and asserts they agree. A passing run means:
no exception ever crossed the FFI boundary, the error code is correct for
every case in the hierarchy (including the two that must *not* be
misclassified as the generic `logic_error`), the message is preserved
exactly where extractable, and the success path's return value is
byte-for-byte identical whether called directly or through the
trampoline.

Both end-to-end tests skip gracefully (not fail) if `g++` isn't in
`PATH`; `cpp-exceptions.test.ts` (string-level generated-source checks —
catch order, signatures, code-gen shape) has no toolchain dependency and
is the always-on primary gate.

## Regression test ledger

Bugs found during this phase's development, each permanently covered:

1. **Missing catch-all for non-`std::exception` throws.** The initial
   design only handled the five named standard types; a raw `throw 42;`
   would have escaped the trampoline entirely and called
   `std::terminate`. Fixed by adding the mandatory `catch (...)` clause
   with a new `UR_UNKNOWN_THROWN_VALUE` code. Covered by
   `cpp-exceptions.test.ts` ("emits a final catch(...) safety net...")
   and the `throwsUnknownValue` case in the full-matrix e2e test.
2. **Catch-order regressions are silent, not compile errors.** There is
   no test that can catch a reordering via type-checking alone — only a
   real throw-and-observe test can. This is why the full-matrix e2e test
   throws `std::logic_error` *directly* (not just its derived types):
   it's the one case that would still report a code if order were wrong
   in a way that simple invalid_argument/out_of_range tests wouldn't
   catch (e.g., logic_error accidentally placed before invalid_argument
   would make logic_error's direct-throw case look right while silently
   breaking invalid_argument — the test suite checks both ends of this).

Any future bug found in this area must be added to this ledger and given
a permanent regression test before being considered fixed.

## Known limitations (documented per Phase 7 closure criteria)

- Only the standard hierarchy listed above is auto-mapped to a specific
  `UrErrorCode`. A user-defined exception hierarchy with its own base
  types (not deriving from `std::exception`) falls through to
  `UR_UNKNOWN_THROWN_VALUE` via `catch (...)`, with no message — the
  bindgen has no way to discover an arbitrary library's custom exception
  taxonomy from a header alone. A future phase could accept an explicit
  mapping table from the caller, the same way template instantiations
  are explicitly requested today.
- `noexcept` specifications on the source method are not currently read
  or used to skip generating a try/catch (every non-destructor
  trampoline is wrapped unconditionally) — this is always correct, just
  not maximally optimized.
- Error messages are copied into a fixed-size caller-provided buffer
  (`errBuf`/`errBufLen`); a `.what()` longer than the buffer is
  truncated, not reported as an additional error.
- Destructors are never exception-wrapped (see "Architectural design"
  above) — this is intentional, not a gap.
