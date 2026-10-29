# UR v28 — Strategic Vision (Technical Director's Directive)

**Status: recorded directive, not an implementation plan. This
document captures the strategic direction as given — actual
implementation of any item here requires its own dedicated,
scoped-down design/RCA/implementation cycle, matching this project's
own established discipline throughout the v1.0 cycle. Nothing in this
document is implemented yet.**

---

## Effective Immediately

- UR v1.0 RC1 development is closed. No new features on `release/v1.0`
  — critical bug fixes only (see `BRANCH_SPECIFICATION_release-v1.0.md`).
- All new work moves to `develop-v28`.

## Seven Teams, in Priority Order

### 1. UR Bridge (⭐⭐⭐⭐⭐ — highest priority)
Build a system letting UR import other languages' libraries. Order:
Python → JavaScript/Node.js → C/C++ → Rust → Java → .NET → Go.
Requires: Architecture design, ABI, Memory Bridge, Error Translation,
Type Mapping, Package Mapping.

### 2. AI Compiler (⭐⭐⭐⭐⭐)
Not a chatbot — a compiler that optimizes performance, selects
algorithms, selects backend, analyzes performance, and suggests
improvements, without changing user code.

### 3. Intent Programming (⭐⭐⭐⭐⭐)
UR's own intended identity: express "what I want" instead of "how to
do it," translated into real UR code.

### 4. IDE
Debugger, Profiler, Memory Viewer, AI Assistant, Refactoring, Package
Manager Integration.

### 5. URPM
Evolve into a universal package manager: UR packages, Python packages,
JavaScript packages, and eventually other languages.

### 6. Documentation
Developer Guide, Compiler Guide, Architecture Book, Bridge Book,
AI Book.

### 7. Website
Documentation Portal, Playground, Package Registry, Community, Blog,
Showcase.

## Explicitly Prohibited Right Now

- Reimplementing Python libraries inside UR.
- Reimplementing NumPy, Pandas, or TensorFlow.
- Adding dozens of small language features.
- Changing syntax without a strong reason.

## Strategic Goal

Not "a language easier than Python" — a single language that reaches
the best of every programming language, with an intelligent compiler,
intent-based programming, and an integrated development environment:
a platform, not just a language.

---

## Engineering Reality Check (this assistant's own assessment, stated directly rather than silently deferred)

**Correction to an initial assumption**: Team 1 (UR Bridge) is NOT
starting from zero for C/C++. Direct inventory found substantial,
already-TESTED infrastructure:
`src/ffi/bindgen/c-header-parser.ts`, `converter.ts`, `emitter.ts`,
`src/ffi/bindgen/cpp/` (header parser, converter, exception handling,
and a full Itanium name-mangling implementation), `src/ffi/abi/`
(layout, types, versioning), a native package planner
(`src/ffi/urpm-native/native-packages.ts`), and an FFI runtime memory
arena (`src/ffi/runtime/memory.ts`). **18 of these 20 files have real
test coverage**; only `onnx-driver.ts` and `ros2-driver.ts` (domain-
specific driver stubs, consistent with `COVERAGE_REPORT.md`'s own
earlier finding) lack it.

`tests/ffi/integration.test.ts` contains a genuine "Phase 6 End-to-End
Integration" test using a **realistic SQLite3 C header**: parse →
convert → ABI-compatibility-check → emit bindings → generate a native-
package link plan. Confirmed directly this round: **14/14 passing.**

**The precise, remaining gap — now CONFIRMED directly, not
hypothesized**: `emitUrBindings()` produces UR-syntax-LOOKING source
text, but this text is **not valid UR v1.0 syntax at all**. Directly
tested this round: generated the exact SQLite3 binding
`tests/ffi/integration.test.ts` itself uses, and ran it through the
real UR lexer/parser. **Result: 43 parse errors.**

The generated syntax (`module extern/sqlite3;`, `fn sqlite3_open(...)`,
`pub fn`, `*?mut *?mut sqlite3`, `unsafe { __ffi::sqlite3_open(...) }`)
uses `fn` (not UR's real `function`), a `module` statement UR v1.0
doesn't have, Rust-style pointer/mutability syntax (`*?mut`), and an
`unsafe { }` block construct — none of which exist anywhere in
`UR_LANGUAGE_SPEC_1_0.md`. This appears to be a forward-looking,
aspirational syntax design for a future UR dialect, not the current
language. `tests/ffi/bindgen.test.ts`'s own "emits valid UR binding
code" test name is misleading: it only checks `toContain()` for
specific substrings, never actually parses the output with the real
UR parser — so this gap has been invisible to the existing test suite
this entire time.

This is the natural, concretely-scoped first deliverable for Team 1,
not a from-scratch ABI/Memory-Bridge design effort — and it is now a
CONFIRMED defect/gap, not a speculative one:

> Either (a) implement the `fn`/`module`/`pub`/`unsafe`/`*?mut` syntax
> extensions in the real UR lexer/parser/compiler as their own
> deliberate v28 language decision (a substantial scope of its own,
> needing the same CFG-design discipline as any other syntax
> addition), or (b) rewrite `emitUrBindings()` to emit text using
> UR's ACTUAL current v1.0 syntax (`function`, no `module` statement,
> no `unsafe`/`*?mut`) so generated bindings are usable TODAY without
> waiting on new language design. Recommend (b) as the faster,
> lower-risk path to a genuine "call a real C function from UR"
> milestone, with (a) as a legitimate but separate, larger future
> decision if the aspirational syntax is intentional and desired.

This reframes the earlier, broader assessment: Python/JS/Rust/Java/
.NET/Go interop each remain much larger, less-scoped efforts (no
comparable existing infrastructure was found for any of them in this
inventory pass) — but C/C++ specifically has a real, tested head
start at the TOOLING level, with one now-confirmed, precisely-located
gap between that tooling's output and the real, current language.

The broader caution from this document's original assessment still
applies to the OTHER 6 teams and to languages beyond C/C++ within
Team 1 itself: each remains a genuinely large effort without
comparable existing groundwork, and should not be started in parallel
without its own scoped-down first deliverable, matching the discipline
already demonstrated for the WASM SSA fix cycle.
