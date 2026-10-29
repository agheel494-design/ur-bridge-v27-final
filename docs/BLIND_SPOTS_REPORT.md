# BLIND_SPOTS_REPORT.md

Not "which tests fail" — **which real parts of the system have zero
test coverage at all.** Each item below was confirmed by directly
searching for the corresponding source/test files, not assumed.

## Confirmed, zero-coverage blind spots

1. **Go native driver (`src/ffi/drivers/*go*`)** — confirmed via direct
   `find`: **no such file exists at all**, and correspondingly zero
   test file exists for it either. Go support in this project exists
   ONLY through the newer `call_external`/Manifest FRI mechanism
   (compiles a real `.go` source file via `go run` at call time) — a
   completely different, much simpler mechanism than the native
   dlopen-based drivers Python/JS/C++/Rust have. There is no Go
   equivalent of those native drivers at all.

2. **Rust/Go/Java/C# runtimes inside FRI (`call_external`/Manifest)** —
   the code path exists and is exercised live in this project's own
   development history (confirmed working for C/C++ using the same
   code path), but **zero automated test in this repository actually
   executes a real `rustc`/`go`/`javac`/`dotnet` toolchain** — this
   sandbox does not have them installed, and no CI configuration in
   this repository currently provisions them either (confirmed:
   `.github/workflows/ci.yml` does not install these 4 toolchains).
   **This is the single largest, most consequential blind spot in the
   entire project** — an entire class of claimed language capability
   has never actually been executed by any automated test, anywhere,
   in this project's own history.

3. **C# support specifically** — even the *code path* is incomplete:
   confirmed directly in `src/interpreter/interpret.ts`'s own `csharp`
   branch, which only checks `dotnet --version` and then unconditionally
   throws "dotnet script execution not implemented" — there is no real
   execution logic at all yet, unlike the other 9 runtimes.

4. **LLVM Backend** — does not exist in `src/` at all (confirmed via
   direct search). Zero code, zero tests. Referenced only in
   documentation file names (`LLVM_ENVIRONMENT_REQUIREMENTS.md`) as
   aspirational/planning material, not implementation.

5. **Android/iOS/Game Engine/GUI/AI Runtime backends** — do not exist
   in `src/` at all (confirmed via direct search) — consistent with
   the official Feature Freeze directive explicitly deferring these
   to v2.0.

6. **Cross-platform C compiler variation (Clang, MSVC)** — every C
   Backend test in this repository's own history has run against
   `gcc` only (confirmed: `tools/backend/c-compile.ts`'s own
   `resolveGccPath()` looks for `gcc` specifically). Zero test has run
   the generated C code through Clang or MSVC. Given the C Backend's
   own generated code is meant to be portable C, this is a real,
   plausible risk, not just a formality — MSVC in particular has
   real, known behavioral differences from GCC (e.g. no VLA support in
   older versions) that have never been checked against this project's
   own generated output.

7. **Cross-platform OS variation (this project's own automated tests
   have only ever run on Linux, in this session's own sandbox)** —
   the recent real Windows manual verification (this same review
   thread) is the ONLY evidence this project has ever run on Windows
   at all; there is zero automated, repeatable test that runs on
   Windows or macOS. Every "Passed: N/N" figure quoted anywhere in
   this project's own history to date was produced on Linux.

8. **`call_external`'s own argument-parsing edge cases beyond what has
   been directly tested**: confirmed tested — strings, arrays,
   numbers, Unicode, escaped quotes, zero arguments. **Not** confirmed
   tested: deeply nested objects/arrays as arguments, arguments
   containing embedded null bytes, extremely large argument payloads
   (e.g. megabyte-sized strings) — no test exists for any of these.

9. **The WASM Backend's own "Golden" test suite (84 tests) and the
   Conformance suite (11 tests) are both real and passing, but their
   own combined 95 tests are dwarfed by WASM Backend's own 2,133 source
   lines** — the lowest tests-per-source-line ratio of any backend in
   this project, a real, disclosed signal (not proof of a defect, but
   a real signal) that the WASM Backend may have more untested
   code-paths per line than the C Backend does.

## What this report deliberately does NOT claim

This report does not claim any of the above blind spots contain a
real defect — only that no automated evidence currently exists either
way for them. Some (Android, LLVM) are correctly out of scope for
v1.0 by explicit prior decision. Others (Rust/Go/Java/C# runtime
verification, Clang/MSVC, Windows/macOS) are real gaps that should be
closed before claiming v1.0 is fully verified across its own stated
platform/language support matrix.
