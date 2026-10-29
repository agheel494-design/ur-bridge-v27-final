# C++ Binding Support — Phase 7 Scope (RC1)

This is the authoritative list of what UR-Bridge's C++ bindgen supports
and explicitly does **not** support in the current release. Scope was
agreed deliberately to get excellent compatibility with common C++
libraries without taking on the complexity of a full C++ compiler
front-end — see ROADMAP_LOCK.md "Phase 7" for the engineering rationale.

## Supported

| Feature | Status | Notes |
|---|---|---|
| Namespaces | ✅ Full | Arbitrary nesting depth, re-opened namespaces |
| Classes / structs | ✅ Basic | Single translation-unit, flat layout, no inheritance |
| Constructors | ✅ | Including multiple overloaded constructors |
| Destructors | ✅ | Not wrapped in exception handling (see below) |
| Methods | ✅ | Including `const`-qualified and `static` |
| Function overloading | ✅ | Distinguished by Itanium-mangled parameter types |
| Function/method parameters | ✅ | Builtins, pointers, references, `const`-qualified, named (class) types |
| Simple template instantiation | ✅ | Single- or multi-type-parameter class templates, **explicit instantiation only** — no template argument deduction, no SFINAE |
| Exception mapping | ✅ | `std::exception`, `std::logic_error`, `std::runtime_error`, `std::invalid_argument`, `std::out_of_range`, user-defined types deriving from `std::exception`, and a `catch(...)` safety net for anything else — see CPP_EXCEPTION_MAPPING.md |
| Itanium C++ ABI name mangling | ✅ | Verified against real g++ 13.3.0 output, including substitution compression |
| Virtual methods | ✅ (incidentally) | The trampoline calls through a real object pointer, so the C++ compiler's own vtable dispatch works transparently — bindgen does not need to special-case `virtual` |

## Explicitly Out of Scope for This RC

| Feature | Why |
|---|---|
| Multiple inheritance | Requires `this`-pointer adjustment thunks per base subobject; deferred until there's a concrete library requiring it |
| Single inheritance | Same complexity class as multiple inheritance for correct FFI binding generation (vtable layout, base subobject offsets); deferred together |
| RTTI (`dynamic_cast`, `typeid`) | Not meaningful across an opaque-handle FFI boundary in this design |
| SFINAE / Concepts | Compile-time-only C++ features with no ABI representation to bind to |
| Template argument deduction | Bindgen requires explicit instantiation requests; it does not infer template arguments from usage |
| Non-type template parameters, variadic templates | Out of scope for "simple template instantiation" |
| Operator overloading | Not yet mapped to UR's call syntax |
| Lambdas, function-pointer parameters | Not parsed |
| Preprocessor conditionals (`#ifdef`) | Same limitation as the C header parser (Phase 6) |
| Move semantics / rvalue references (`&&`) | Parameters are pass-by-value, pointer, or lvalue-reference only |

## Architecture

See CPP_BINDING_PIPELINE.md for the full pipeline diagram and
CPP_EXCEPTION_MAPPING.md for exception-handling details.

## Verification Standard

Every claim in this document is backed by either:
- a fixed expected-value test cross-checked against real `g++ 13.3.0`
  output (`tests/ffi/cpp/itanium-mangle.test.ts`,
  `tests/ffi/cpp/cpp-header-parser.test.ts`,
  `tests/ffi/cpp/cpp-converter.test.ts`,
  `tests/ffi/cpp/cpp-exceptions.test.ts`), or
- a live compile-with-g++-and-run end-to-end test
  (`tests/ffi/cpp/cpp-real-native-e2e.test.ts`,
  `tests/ffi/cpp/cpp-exception-mapping-e2e.test.ts`,
  `tests/ffi/cpp/cpp-exception-mapping-full-matrix-e2e.test.ts`).

No claim in this document rests on simulated or hand-typed "expected"
mangled names — every mangled-name fixture was captured by compiling real
C++ and reading the symbol table with `nm`.
