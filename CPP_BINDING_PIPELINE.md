# C++ Binding Pipeline — Official Architecture (Phase 7, RC1)

This pipeline is the official interface for turning a real C++ header
into a working, exception-safe native binding. Any change to one of
these stages must pass the full regression suite for that stage **and**
every downstream stage before merging — this is what keeps "the parser
changed" from silently breaking "the mangler still produces correct
symbols," which is exactly the class of bug this pipeline is designed to
catch early.

```
C++ Header
   │
   ▼
Header Parser            src/ffi/bindgen/cpp/cpp-header-parser.ts
   │  (namespaces, classes, ctors/dtors, methods, simple templates)
   ▼
Declaration Model         CppTopDecl[] (CppClassDecl | CppFunctionDecl)
   │
   ▼
Binding Plan              src/ffi/bindgen/cpp/cpp-converter.ts
   │  (public-only filtering, explicit template instantiation,
   │   one BoundClass/BoundFunction per exported symbol)
   ▼
Itanium Mangler           src/ffi/bindgen/cpp/itanium-mangle.ts
   │  (real Itanium C++ ABI symbol names, g++-verified)
   ▼
ABI Validation             src/ffi/abi/  (Phase 6 — type layout, versioning)
   │
   ▼
Binding Generator /
Exception Trampoline      src/ffi/bindgen/cpp/cpp-exceptions.ts
   │  (extern "C" wrappers; every C++ exception caught at the boundary)
   ▼
g++ Compilation             real toolchain — produces a real .so
   │
   ▼
Dynamic Loading             dlopen() / dlsym() by the mangled/trampoline name
   │
   ▼
UR Runtime                  calls resolved symbols exactly as generated
   │
   ▼
Exception Mapping           C++ exception -> UrErrorCode + message
   │
   ▼
UR Diagnostics               safe, typed result surfaced to UR code
```

## Test coverage per stage

| Stage | Fast unit tests (always run) | Real g++ end-to-end tests |
|---|---|---|
| Header Parser | `tests/ffi/cpp/cpp-header-parser.test.ts` | (exercised inside the e2e tests below) |
| Binding Plan | `tests/ffi/cpp/cpp-converter.test.ts` | — |
| Itanium Mangler | `tests/ffi/cpp/itanium-mangle.test.ts` | — |
| Exception Trampoline Generator | `tests/ffi/cpp/cpp-exceptions.test.ts` | `tests/ffi/cpp/cpp-exception-mapping-e2e.test.ts`, `tests/ffi/cpp/cpp-exception-mapping-full-matrix-e2e.test.ts` |
| Full pipeline (classes, ctors/dtors, methods, templates) | — | `tests/ffi/cpp/cpp-real-native-e2e.test.ts` |

The fast unit tests are the primary, always-on correctness gate (no
toolchain dependency, run in any environment including this sandbox's
network-restricted CI). The end-to-end tests are the closing proof
required before any stage of this pipeline is considered "done" — they
compile real C++ with `g++`, `dlopen()` the result, and call it purely by
the names the pipeline itself produced (no hardcoded/mocked symbol names
anywhere in that loop). They skip gracefully (not fail) when `g++` isn't
in `PATH`, so `npm test` stays portable to toolchain-less environments
without weakening the correctness guarantee where a toolchain is present.

## Regression discipline

Every bug found during development of this pipeline was added to the
regression suite at the stage it was found, not just fixed silently:

- Itanium mangler: ctor/dtor tokens being length-prefixed like ordinary
  identifiers; multi-component named types missing their `N...E` wrapper;
  a function's own name incorrectly registered as a substitution prefix
  (caught by a deliberately deep 3-reference substitution ground-truth
  case). All three are permanently covered in
  `tests/ffi/cpp/itanium-mangle.test.ts`.
- Header parser: private data members inside a class body originally
  produced cascading parse errors instead of being silently skipped
  (opaque-handle bindings never need field layout) — covered in
  `tests/ffi/cpp/cpp-header-parser.test.ts`.

See CPP_EXCEPTION_MAPPING.md for the exception-handling-specific
regression history.
