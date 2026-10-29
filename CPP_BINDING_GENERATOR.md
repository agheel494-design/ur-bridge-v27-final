# C++ Binding Generator (Phase 7, RC1 — FROZEN)

**Status: stable, frozen.** Modules: `src/ffi/bindgen/cpp/cpp-converter.ts`
(Binding Plan) and `src/ffi/bindgen/cpp/cpp-exceptions.ts` (Trampoline
Generator). Behavior changes require a new regression test before
merging.

## What this stage does

Takes the parsed declaration model (`CppTopDecl[]` from
`cpp-header-parser.ts`) and produces two things:

1. **Binding Plan** (`cpp-converter.ts`) — a flat, concrete list of every
   exported symbol (`BoundClass[]`, `BoundFunction[]`), with:
   - only `public` class members included (private/protected are parsed
     for completeness but never exported - opaque-handle FFI never needs
     raw field layout)
   - every template class either monomorphized against an explicit
     instantiation request, or reported in `unboundTemplates` (never
     silently dropped)
   - a real Itanium-mangled symbol name attached to every function/method
     via `itanium-mangle.ts`

2. **Exception-safe trampolines** (`cpp-exceptions.ts`) - one
   `extern "C"` C++ function per bound method/function, ready to compile
   alongside the real header. See CPP_EXCEPTION_MAPPING.md for the
   exception-handling design in detail.

## Binding Plan data model

```ts
type BoundMethod = {
  kind: "ctor" | "dtor" | "method" | "static-method";
  name: string;            // "" for ctor/dtor
  params: CppParam[];
  returnType: CppType;
  isConst: boolean;
  mangledName: string;      // real Itanium ABI symbol
};

type BoundClass = {
  namespace: string[];
  className: string;
  bindingName: string;      // "Box_int" for an instantiation of Box<int>; == className otherwise
  isOpaque: boolean;
  templateArgs?: CppType[];
  methods: BoundMethod[];
};
```

## Template instantiation: explicit, not inferred

```ts
buildBindingPlan(parsed, [
  { namespace: [], className: "Box", args: [{ kind: "builtin", name: "int" }], label: "int" },
]);
```

produces a `BoundClass` named `Box_int` whose methods have `T`
substituted with `int` everywhere (parameters and return types), mangled
as real `Box<int>` symbols (`_ZN3BoxIiEC1Ei`, etc. - see
CPP_MANGLE_SPEC.md). A template class with no matching instantiation
request is NOT silently dropped - it's listed in `plan.unboundTemplates`
so callers can detect a missed binding.

## Trampoline naming and overload disambiguation

Trampoline names are flat and C-ABI-safe: `${bindingName}_${methodName}`
(`Widget_resize`), `${bindingName}_ctor` / `${bindingName}_dtor` for
constructors/destructors. Overloaded methods/constructors get a numeric
suffix in declaration order (`Widget_ctor`, `Widget_ctor_1`) - this is
deterministic and tested directly in `cpp-exceptions.test.ts`.

## Calling convention

Every trampoline follows one fixed shape:

```
extern "C" int <name>(
  [const] void* self,        // omitted for static methods and free functions
  <param0>, <param1>, ...,
  <ReturnType>* outResult,    // omitted when the return type is void
  char* errBuf, int errBufLen
);
```

returning a `UrErrorCode` (see CPP_EXCEPTION_MAPPING.md). `self` is
caller-allocated raw memory sized via `sizeof(T)` from the real header -
the bindgen does not (and cannot, for an opaque type) invent its own
layout; it always defers to the real C++ compiler's understanding of the
class via the header it was generated from.

## Verification - no simulation

`tests/ffi/cpp/cpp-converter.test.ts` (9/9 passing) checks every mangled
name the Binding Plan produces against the same g++-verified ground truth
used by the mangler's own tests. `tests/ffi/cpp/cpp-real-native-e2e.test.ts`
drives the full pipeline for real: parses a real header, builds a real
binding plan (including a `Box<int>` instantiation), compiles a real
`.so` with `g++` from separately-compiled real source, and calls every
constructor/destructor/method/static-method purely via `dlopen()` plus
`dlsym()` using the mangled names the pipeline itself produced - never a
hardcoded symbol name. A passing run is computed, numeric proof
(`resize(6,7)` then `area() == 42`, `Box<int>.set(25).get() == 25`, etc.),
not a structural-only check.

## Known limitations

- No inheritance support (single or multiple) - see
  CPP_SUPPORTED_FEATURES.md.
- `self` allocation size must come from a real header with the complete
  class declaration available (including private members), since C++
  `sizeof` requires a complete type. There is currently no fallback for
  binding against a precompiled library when only a partial/opaque
  forward declaration is available.
- Trampoline generation for free functions inside deeply nested
  namespaces uses underscore-joined names (`ns1_ns2_fn`); a naming
  collision between e.g. `ns1::ns2::fn` and a literal top-level
  `ns1_ns2_fn` is theoretically possible but not currently detected.
