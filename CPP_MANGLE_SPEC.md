# Itanium C++ ABI Mangler Specification (Phase 7, RC1 — FROZEN)

**Status: stable, frozen.** Module: `src/ffi/bindgen/cpp/itanium-mangle.ts`.
Behavior changes require a new g++-verified ground-truth fixture
demonstrating the change before merging.

## Methodology: g++ as the oracle, not the spec text

The Itanium C++ ABI mangling grammar is easy to get subtly wrong from
reading the spec alone — particularly the substitution-compression rules
(`S_`, `S0_`, `S1_`, ...). Rather than hand-deriving expected mangled
names from the written grammar, every fixture in
`tests/ffi/cpp/itanium-mangle.test.ts` was captured by:

1. Writing a small, real C++ snippet, giving every function/method a
   body and ensuring it is **called** somewhere (unused inline methods
   are never emitted into an object file at all — this caught a real
   authoring mistake during development).
2. `g++ -c file.cpp -o file.o`
3. `nm file.o | grep ' [TW] '` and reading the mangled name directly out
   of the real symbol table.

This means every rule documented below is empirically verified against
`g++ 13.3.0` (Ubuntu 24.04, x86-64 System V / Itanium C++ ABI), not
reconstructed from memory of the specification.

## Supported constructs

- Free functions, namespaced or not, including overloads
- Class/struct member functions, including `const`-qualified
- Constructors (`C1`, "complete object constructor") and destructors
  (`D1`, "complete object destructor")
- Static methods (no special marker in the mangled name — only the
  trampoline-generation layer needs to know a method is static, to omit
  the implicit `this` parameter)
- Builtin types: `void`, `bool`, `char`, `signed char`, `unsigned char`,
  `short`, `unsigned short`, `int`, `unsigned int`, `long`,
  `unsigned long`, `long long`, `unsigned long long`, `float`, `double`,
  `long double`
- Pointers, references, `const`-qualification (including combinations,
  e.g. `const char*` -> `PKc`, `const Widget&` -> `RK6Widget`)
- Explicit template class instantiation (e.g. `Box<int>` -> `3BoxIiE`),
  monomorphized at bindgen time
- The full Itanium substitution table, including the subtlest verified
  case: partial-prefix reuse mid-construction (e.g. reusing `a` from
  `a::b::Foo` while building `a::c::Bar` in the same signature)

## NOT supported (will throw, not silently mis-mangle)

Templates beyond explicit single/multi-parameter instantiation (no
SFINAE, no argument deduction), rvalue references, function-pointer
parameters, multi-dimensional arrays, and operator overloading. See
CPP_SUPPORTED_FEATURES.md for the full project-wide scope boundary.

## Rules verified against real g++ output

| Rule | Example | g++-verified mangled form |
|---|---|---|
| Free function, single param | `void foo(int)` | `_Z3fooi` |
| Overload by param types | `void foo(int, double)` | `_Z3fooid` |
| No params | `int bar()` | `_Z3barv` |
| Single-level namespace | `ns1::baz(int)` | `_ZN3ns13bazEi` |
| Nested namespace | `ns1::ns2::qux(double, const char*)` | `_ZN3ns13ns23quxEdPKc` |
| Default constructor | `Widget::Widget()` | `_ZN6WidgetC1Ev` |
| Parameterized ctor (overload) | `Widget::Widget(int)` | `_ZN6WidgetC1Ei` |
| Destructor | `Widget::~Widget()` | `_ZN6WidgetD1Ev` |
| Const method | `Widget::area() const` | `_ZNK6Widget4areaEv` (the `K` sits right after `N`, before the prefix — not wrapping the return/param types) |
| Static method | `Widget::count()` | `_ZN6Widget5countEv` (structurally identical to a non-static member; staticness isn't encoded in the name) |
| Reference to class | `void f(Widget&)` | `_Z1fR6Widget` |
| Repeated reference (substitution) | `void f(Widget&, Widget&)` | second `Widget&` -> `S0_`, not re-spelled |
| Cross-namespace partial substitution | `void f(a::b::Foo&, a::c::Bar&)` | `_Z1fRN1a1b3FooERNS_1c3BarE` — `a` backreferenced as `S_` mid-construction of the second param |
| Function's own name is NOT a substitution prefix | `a::b::Foo::m(a::b::Foo&, a::b::Foo&, a::b::Foo&)` | `_ZN1a1b3Foo1mERS1_S2_S2_` — class prefixes get indices 0-2; "m" itself is skipped, so the reference-to-Foo compound type is index 3 (`S2_`), not 4 |
| Template instantiation | `Box<int>::Box(int)` | `_ZN3BoxIiEC1Ei` |
| Different instantiations share only the bare name | `f(Box<int>&, Box<double>&)` | `_Z1fR3BoxIiERS_IdE` — `Box` backreferenced (`S_`) but `<double>`'s args are spelled out fresh |

## Test results (current)

`tests/ffi/cpp/itanium-mangle.test.ts`: 33/33 passing, covering every row
above plus the builtin-type code table and error handling for
out-of-scope constructs.

## Regression ledger

Three real bugs were found and fixed during development, each with a
permanent g++-verified regression test:

1. Ctor/dtor tokens (`C1`/`D1`) were being run through the same
   length-prefixing logic as ordinary identifiers, producing `2C1`
   instead of the literal `C1`.
2. Multi-component named types used as a parameter type (not as a
   function's own qualified name) were missing their `N...E` nested-name
   wrapper entirely.
3. The function/method's own name was being registered as a new
   substitution-table entry, which is wrong — only the namespace/class
   prefix is independently substitutable. This was only caught by
   deliberately constructing a 3-reference-deep substitution case
   (`a::b::Foo::m(a::b::Foo&, a::b::Foo&, a::b::Foo&)`); two-reference
   cases pass even with this bug present, which is why that specific
   fixture is called out by name in the test file's comments as the one
   that must never be simplified away.
