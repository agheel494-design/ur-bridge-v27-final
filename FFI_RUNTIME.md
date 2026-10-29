# UR FFI Runtime (Phase 6 memory layer + Phase 7 native call execution)

**Status: stable.** Module: `src/ffi/runtime/memory.ts` (Phase 6). The
native-library call execution model documented below (dlopen/dlsym by
mangled or trampoline name) is the Phase 7 addition that this document
formalizes.

## Two layers, one runtime

The FFI runtime has two distinct responsibilities that together let UR
code call into a real native library:

1. Memory marshaling (`src/ffi/runtime/memory.ts`, Phase 6) - converts
   values between UR's in-memory representation and the native ABI's
   representation: string encoding/decoding (`encodeString`,
   `decodeString`), struct marshaling/unmarshaling (`marshalStruct`,
   `unmarshalStruct`), a callback registry for passing UR function values
   as native function pointers (`FfiCallbackRegistry`), a scoped
   allocation arena for native-side temporaries (`FfiArena`), and a
   safety checker (`checkFfiSafety`) that validates a call won't violate
   basic FFI invariants before it happens.

2. Native call execution (Phase 7) - once a binding plan exists (C or
   C++, see CPP_BINDING_PIPELINE.md and CPP_BINDING_GENERATOR.md), the
   runtime resolves and calls the real compiled symbol. There are two
   supported execution strategies, chosen per binding:

   - Trampoline-compiled (preferred when source is available): the
     bindgen emits an extern "C" wrapper (see CPP_EXCEPTION_MAPPING.md),
     which is compiled together with the real header/source by
     g++/clang++ into a .so. The UR runtime then calls the trampoline's
     flat, predictable name (Widget_resize, Parser_parseStrict, ...) -
     no mangling knowledge needed at call time, since the trampoline
     already did the C++-call translation at compile time.
   - Direct dlsym-by-mangled-name (for precompiled libraries where
     recompiling a trampoline isn't possible or desirable, e.g. binding
     directly to an already-built third-party .so): the UR runtime
     resolves the real Itanium-mangled symbol directly via dlsym() (see
     CPP_MANGLE_SPEC.md for how that name is derived) and calls it
     through a raw function-pointer cast following the Itanium calling
     convention - this as an implicit first argument for non-static
     members, ordinary arguments after. This is the technique validated
     end-to-end in tests/ffi/cpp/cpp-real-native-e2e.test.ts: a
     completely independent program, never linked against the library's
     object file, discovers and calls every constructor, destructor,
     const method, static method, and template instantiation purely via
     dlopen() plus dlsym(), getting numerically correct real results.

Both strategies converge on the same place: a real, dynamically loaded
.so, called through symbol names the bindgen pipeline produced - never a
hand-typed or simulated symbol name in any test that exercises this
runtime.

## Why two strategies, not one

Trampoline-compiled is simpler and gives the C++ compiler a chance to
catch type errors and handle exceptions safely (see
CPP_EXCEPTION_MAPPING.md) - it's the default whenever a library's source
or headers are available to compile against. Direct dlsym-by-mangled-name
exists for the case Phase 7's Priority 4 (real native library
integration) specifically calls for: binding to an already-compiled
third-party library (SQLite3, OpenCV, ONNX Runtime) without requiring a
full recompile of that library, and in the C++ case, without even
requiring its full source - only its public header (for sizeof/layout)
and the compiled .so.

## Safety boundary

checkFfiSafety (Phase 6) validates calls at the marshaling layer (buffer
bounds, pointer non-null where required, encoding consistency).
cpp-exceptions.ts (Phase 7) validates the C++-specific boundary: no
exception may ever propagate out of a native call back into UR. Together
these are the two halves of "a native call from UR cannot corrupt the UR
runtime or crash the process due to a native-side error" - the first
covers data-shape errors, the second covers control-flow errors
(exceptions) from the C++ side specifically. C-only libraries (no
exceptions in the ABI) only need the first half.

## Verification

Phase 6 marshaling: tests/ffi/ffi-runtime.test.ts (32/32 passing).
Phase 7 native call execution: see the end-to-end tests listed in
CPP_BINDING_PIPELINE.md's coverage table, all of which exercise this
runtime's calling-convention model for real, not as a simulation.

## Known limitations

- The direct dlsym-by-mangled-name strategy currently requires the
  caller to provide sizeof(T) for object allocation, which in turn
  requires a complete (non-opaque) class declaration from a real header
  - see CPP_BINDING_GENERATOR.md's "Known limitations".
- There is currently no automatic fallback from trampoline-compiled to
  direct-dlsym (or vice versa) if one strategy fails to build/link; the
  caller chooses the strategy per binding.
