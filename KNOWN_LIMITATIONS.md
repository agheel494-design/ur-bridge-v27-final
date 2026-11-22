# UR-Bridge — Known Limitations

## V1.0 candidate — current limitations (DRAFT)

> This section describes the V1.0 release candidate: C5-r2 (= C4 + RB3-G6 test/infrastructure corrections + F3 runtime
> correction + `package-lock.json` + release documentation) + the B-1 build fixes + the Windows test-harness fixes
> (W-2, W-1, H-a) + this documentation update. Its exact identity is recorded in the release record, not in this file.
> It **takes precedence** over the older sections further down where they conflict; those older
> sections are kept unchanged as history. V1.0 is not authorized until the formal release decision.

### V1.0-1. Build (`npm run build`)
- The 18 TypeScript diagnostics of C5-r2 are fixed in this candidate (B-1).
- On the B-1r2 tree, whose build inputs are byte-identical to this candidate's, `npm run build` exits 0, TypeScript
  5.9.3 reports 0 diagnostics, `dist/` is complete (runtime, IDE page, `BUILD_INFO.json`, smoke test) and `ur-ide`
  answers `GET /` with 200 (Windows: raw results; Linux: terminal output).
- **Not yet run on this candidate's tree.** The statement above is an inference from input identity. Release
  Verification on this tree is pending.

### V1.0-2. FRI (foreign runtime interface)
- **FRI is trusted foreign execution.** No isolation, no sandbox, not a security boundary. Foreign code runs with the
  rights of the UR process. Containment (cgroup v2 on Linux, Job Object on Windows) is lifecycle and resource control
  only.
- If containment is unavailable (no cgroup v2 on Linux; `ur-fri-jobrun.exe` not built on Windows), FRI calls fail
  closed with `FRI_CONTAINMENT_UNAVAILABLE`.
- `nativeptr` values cannot cross the FRI boundary (`FRI_UNSUPPORTED_ARGUMENT`).
- `call_external` returns `int` only; float, string and other results panic (DR-RB3-03). Example:
  `call_external("python","math","sqrt",64)` panics because the result is the float `8.0`.
- Foreign stdout is not a result. It appears on UR stderr as diagnostics (DR-RB3-02).
- Manifest packages need a sibling `signatures.ur`, or the import fails with `IM1001` (DR-RB3-04).
- The `call_external` security tests prove data arrival and the absence of execution for the current code. They have
  **not been mutation-tested** (DR-RB3-02). A Security Mutation Gate is outside V1.0.

### V1.0-3. WASM backend
- The V1.0 WASM contract is **DR-RB3-01 (amended)**: a construct is accepted when a differential test shows the same
  behaviour as C. That includes unary minus, value reuse, calls with arguments, conditional array allocation in one
  branch, nested array literals, floats and the host builtins `input`/`print`/`free`. The older "WASM Backend
  Limitations" list below is superseded where it says otherwise.
- Still rejected: array allocation inside a loop body (`WASM1002`), and the `wasm-only-reject` fixtures (bool value
  gap, `nativeptr` multi-use, `array_load` result reuse).
- The WASM and C backends are reached through the compiler tooling, not through the `ur` CLI.

### V1.0-4. C backend: confirmed defects found by the RB-4 analysis (classified; release-impact decision pending)
Both fail loudly at C compile time (`BE1001`, gcc error). Neither produces a wrong result silently. The interpreter
(`ur run`) is not affected.
- `free()` on an owning local array: the C backend emits `ur_free(arr, n)` instead of `ur_free_array(arr, n)`, and gcc
  rejects the call.
- A user function with a `nativeptr` parameter: the C backend emits the explicit marker type
  `nativeptr_unsupported_by_c_backend`, and gcc rejects it (`BE1001`). Nothing is produced silently. `ur run` is not
  affected.

### V1.0-5. Diagnostics
- Lexer errors are reported like other diagnostics: the CLI prints `file:line:col` and a caret line; the IDE shows the
  column. Error code, message, line and exit code (1) are unchanged (B-1, D-3).

### V1.0-6. Verification status of this candidate
- **IDE:** the IDE server and CLI/IDE parity tests pass on Windows (15/15 in three runs) on the code tree of this
  candidate, and on Linux (15/15, terminal output). `ur-ide` `GET /` → 200 was shown on the B-1r2 tree only.
- **Full suite:** no full release verification on one tree on both platforms exists yet. Release Verification is
  pending.

### V1.0-7. Compiler-internal API precondition
- `lowerToIR()` requires a program that already passed semantic analysis and type checking (documented precondition in
  `src/compiler/codegen/lower-to-ir.ts`). Called on a program that semantic analysis rejects (for example a struct
  field of type `nativeptr` or an array field), it is rejected with `StructLayoutRejectionError`; a `null` parameter
  yields `ok:false` (`CG1002`). Both paths are unreachable from the `ur` CLI, the IDE server and the sandbox executor,
  which always run semantic analysis first (`SE6001`). The in-tree tools that skip it operate only on the repository's
  own fixed corpora.

### V1.0-8. Windows: not officially supported (verified scope in `SUPPORTED_PLATFORMS.md`)
- **Not officially supported.** Windows is not an officially supported platform for this release. `SUPPORTED_PLATFORMS.md`
  states what was verified on one Windows 10 host, with its evidence.
- **FRI helper required.** FRI on Windows needs the containment helper `ur-fri-jobrun.exe`, built from source with
  MinGW-w64. Without it, every FRI call fails closed with `FRI_CONTAINMENT_UNAVAILABLE`.
- **FRI on Windows is not established for this release.** The evidence conflicts and the cause is under investigation
  (see `SUPPORTED_PLATFORMS.md`). No support for FRI on Windows is claimed.
- **Does not work on Windows:**
  - the native FFI executor (`WindowsExecutorStub` → `notSupported()`);
  - native-library imports through the built-in registry (`import sqlite3` and the other registry libraries), because
    the registry resolves them to Linux library paths;
  - AddressSanitizer/UBSan builds, because MinGW-w64 has no sanitizer runtime.
- **Behaves differently on Windows** (C-backend executables, which are reached through the compiler tooling, not
  `ur run`/`ur build`; see V1.0-3):
  - they write `\r\n` line endings to standard output;
  - recursion to depth 50,000, which completes on Linux, ends with a stack overflow (`0xC00000FD`);
  - crashes report a Windows exception code, not a POSIX signal name;
  - exit statuses are 32-bit.
- **Test suite not clean.** The full test suite is not clean on Windows: 182 tests fail on the verified host. A cause
  is proposed for each in the verification record; none has yet received a release ruling.

---

## Earlier content (history, unchanged)


**Consolidates limitations already established and verified elsewhere
in this project's documentation — no new claims introduced here.**

---

## Platform Limitations

- **Windows and macOS are not supported** — see `SUPPORTED_PLATFORMS.md`
  for the specific, code-level evidence (`notSupported()` stubs in the
  native FFI executor; no Windows/MinGW-specific logic anywhere in the
  C Backend build tooling).

  > **Superseded for the V1.0 candidate.** See `SUPPORTED_PLATFORMS.md` and V1.0-8 above. Windows remains not
  > officially supported, but a defined scope has been verified on Windows. The statement above that the C Backend
  > build tooling has "no Windows/MinGW-specific logic" is no longer accurate: `tools/backend/c-compile.ts` uses a
  > bundled MinGW `gcc` on Windows when one is present.

## WASM Backend Limitations (see `docs/WASM_BACKEND_GUIDE.md` for full detail)

- No floating-point support (`const`/`binop`).
- No unary operators (`neg`/`not`).
- No function calls with arguments (zero-argument calls only).
- No conditional array allocation (every array must be allocated in
  the function's entry block).
- No Runtime imports / Builtins (`print`/`input`/`free` not callable
  from WASM-compiled code).
- No garbage collection or `free` for arrays — a bump allocator that
  never frees, bounded by one WASM memory page.
- No struct support in the WASM Backend specifically (structs exist in
  the language and the C Backend, not yet integrated with the WASM
  Backend's own array model).
- No nested control flow combined with arrays (e.g., an array access
  inside an `if` that's itself inside a `while`).
- **FIXED (was a correctness bug — a loop-local `let` variable used
  to update two different outer variables in the same iteration
  previously produced a silently WRONG result on WASM)** — root-caused
  in Stage 3 (`STAGE3_WASM_RCA_VALIDATION_FINAL.md`, Confirmed
  verdict), designed in Stage 3.5 (`PATCH_DESIGN_WASM_SSA.md`), and
  fixed in Stage 4: `encodeStatements()`/`encodeExpr()`
  (`src/backend/wasm/emit-wasm.ts`) now materialize every `const`/
  `load`/`binop` value into a dedicated scratch local at its own
  position in a block, before any later instruction (including an
  intervening `store`) is encoded — see `getMaterializedIds()`.
  Confirmed directly: the original minimal reproducer now returns `1`
  (matching C), and `examples/fibonacci.ur` now returns `55` on WASM
  too (previously `512`). Full history in
  `issues/wasm-loop-local-let-affecting-outer-state.md`.

All of the above are tracked, scoped future work — see
`UR_BRIDGE_V28_MASTER_ROADMAP.md`.

## Tooling Limitations

- **No working CLI** — `package.json` does not declare one (removed
  after confirming it was never implemented); use the compiler
  pipeline directly, per `docs/USING_UR_BRIDGE_TODAY.md`.
- **No verified npm-registry-connected build** from this project's own
  development sessions — every internal test run in this project's
  own history used a disclosed, non-real Vitest-compatible substitute,
  since this environment's own network policy blocks the public
  registry. A genuine `npm install`/Vitest run in a network-enabled
  environment has not yet been independently confirmed and recorded
  with raw logs (see `RC2_VALIDATION_REPORT.md` and
  `EXTERNAL_VERIFICATION_PROCEDURE.md`).

## Language Limitations (pre-existing, Level 2.8, out of this
## release's own scope)

- **Tier 2 ABI-precise types (`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f32`/`f64`) are FFI/ABI-only** — per `ADR_1_TIER2_TYPES_DECISION.md`, they cannot be used in ordinary function signatures or variable declarations. Use `int`/`float` for general-purpose code.
- **Unannotated parameters/variables used with unary `!` or in multi-argument calls require explicit type annotations** (`let x: bool = ...`, `function add(a: int, b: int)`) — per `SPEC_IMPLEMENTATION_MATRIX.md`'s Finding F4. UR v1.0 has no bidirectional type inference; an unannotated value's type stays unresolved until it reaches a context providing one explicitly.
- **FIXED — `PE010` diagnostic contract now honored for stacked modifiers** (was: "Regression Against Documented Diagnostic Contract" — `async const function main()...` previously only flagged `const`; `async` was silently swallowed as a meaningless expression statement). Fixed in `parser.ts`'s top-level dispatch loop: `isModifierChainBeforeDeclaration()` now scans forward through the ENTIRE chain of consecutive bare identifiers before a declaration keyword (not just one token ahead), so every word in a stacked-modifier sequence gets its own `PE010`, not just the one immediately before `function`/`struct`/`type`. Verified directly for 1, 2, and 3 stacked modifiers.
- **`byte`'s range and arithmetic semantics are undecided** (found by adversarial audit; classification: **Missing Semantic Specification**, not a confirmed bug) — `let x: byte = 999`/`= 0 - 5` are silently accepted and wrap (C `uint8_t` semantics); `byte + byte` is rejected entirely (`TY3001`). §6.1 of `UR_LANGUAGE_SPEC_1_0.md` names `byte` as "Unsigned 8-bit integer" but states no explicit range-enforcement or operator-support requirement — real languages disagree on this exact question (Rust panics in debug / wraps in release; Ada raises a Constraint_Error; C wraps; Java requires an explicit cast), so "Unsigned 8-bit integer" alone cannot settle it. An architectural decision (matching the `ADR-1` precedent) is needed before either behavior can be called correct or a defect.
- **Duplicate `type` alias names are silently allowed** (found by adversarial audit, unclassified — not confirmed as a defect vs. intentional shadowing) — `type A = int` then `type A = float` produces no diagnostic.
- Single-element arrays previously produced invalid C — this specific
  issue is FIXED (see `issues/level-2.8-single-element-array-c-backend-bug.md`).
- No dynamic array length. Nested arrays are supported in V1.0.
- **FIXED — returning/assigning an array by bare identifier produced
  invalid C, not a clear rejection** (Stage Functions bug hunt,
  Compiler & Runtime Stabilization phase). `resolveVar()` unconditionally
  emitted a `load` for any slot-backed variable, including array-typed
  ones — violating `toIRType()`'s own documented precondition ("callers
  must check for CG1001" for Array types). Confirmed directly: `return
  a` (array-typed) produced invalid C (`void v6 = slot_a;`), a hard gcc
  crash with zero UR-level diagnostic. Fixed: `resolveVar` now rejects
  bare array-identifier references clearly, consistent with this
  project's own existing array-limitation diagnostics. Legitimate array
  indexing (`arr[i]`) is unaffected — confirmed directly, still works
  correctly everywhere it did before.
- **Methodological note, not a compiler defect**: `lowerToIR()`'s own
  documented precondition is that Semantic analysis (`analyze()`) has
  already run with zero errors — it does not call `analyze()`
  internally. An earlier finding in this same stage ("wrong argument
  count isn't caught") was itself a false positive caused by an ad hoc
  test pipeline skipping this required precondition — confirmed
  directly: `analyze()` correctly catches both too-few and too-many
  argument counts (`SE3001`) when properly included. Retracted; no fix
  was needed for this specific case.
- **FIXED — integer literals beyond safe precision (`2^53-1`) were
  silently corrupted, not just genuinely-overflowing ones** (Stage 1.3
  Type Conversions bug hunt, Category A/Critical, Compiler & Runtime
  Stabilization phase). Confirmed directly: a realistic nanosecond
  timestamp and even `2^53+1` (an ordinary, in-range i64 value) both
  silently corrupted to a different, wrong number — real data
  corruption, not a rare edge case. Fixed for v1.0 by rejecting any
  unsafe literal explicitly (`PE011`) rather than silently continuing.
  Full 64-bit precision for every legal i64 literal is a recorded,
  deliberately-deferred v1.1 item — see
  `UR_LANGUAGE_VERSION_MATRIX.md`'s own dedicated row for the full
  engineering rationale, not merely an inline code comment.
- **FIXED — array type annotations (`int[]`, `float[]`, ...) were
  silently dropped, always resolving to the plain scalar element
  type** (Stage 1.2 Arrays bug hunt, Compiler & Runtime Stabilization
  phase). `resolveTypeRef()` never consulted a `TypeRef`'s own
  `arrayDepth` field — confirmed directly: `let b: int[] = a` produced
  `TY2002: cannot assign Array<Int> to 'b: Int'`, proving the
  annotation itself resolved to `Int`, not `Array<Int>`. The same
  defect silently broke array function-parameter and array
  return-type annotations too. Fixed: the resolved base type is now
  wrapped in `tArray()` once per unit of `arrayDepth`. Confirmed
  working end-to-end: `let arr: int[] = [1, 2, 3]` (explicit
  annotation + literal initializer) now compiles and runs correctly —
  previously silently broken for ANY explicit array annotation.
- **Related, genuinely separate limitation (not fixed, out of this
  round's own scope)**: Lowering's own array-slot tracking still
  requires a KNOWN, LITERAL size at the point of declaration (to emit
  a fixed-size C array) — so assigning FROM an existing array
  (`let b: int[] = a`, no literal) or passing/returning an array
  through a function signature still fails clearly at Lowering
  ("not a known array variable") once the value is actually used,
  even though these now correctly TYPE-CHECK. A full fix needs a
  different array representation (pointer+length pairs) — a genuinely
  larger redesign, not attempted this round.
- **Corrected inaccurate comment**: `parser.ts` previously claimed
  multi-dimensional array types (`int[][]`) are "rejected at the
  TypeChecker level" — confirmed this was never actually implemented;
  `int[][]` type-checks successfully and is only rejected later, at
  Lowering. Comment corrected to match reality; behavior itself
  (eventual clear rejection) was never wrong, only the documentation
  of WHERE it happens.
- **Confirmed working (no bug found)**: array bounds checking is real
  and safe for both reads and writes (a clean panic, exit code 101 —
  not a crash, not silent garbage); large arrays (tested to 1000
  elements) and `while`-based iteration both work correctly.
- **Confirmed NOT supported (documented, not a bug)**: empty array
  literals (`[]` — ambiguous element type, `TY6002`).
- **[V1.0-DOC-DRIFT-MULTIARRAY-003 correction]**: this entry previously
  also listed "nested array literals ([[1,2],[3,4]], clear Lowering-
  level rejection)" as not supported — confirmed directly, this is no
  longer accurate. Nested array literals type-check, lower, and
  correctly execute on the Interpreter, the C backend, and the WASM
  backend today; this is a real, supported, in-contract UR v1.0
  capability, not a limitation. The empty-array-literal limitation
  above (`TY6002`) is unaffected and remains accurate.
- **FIXED — string comparison (`==`/`!=`/`<`/`<=`/`>`/`>=`) was raw C
  pointer comparison, not content comparison** (Stage 1.1 Strings bug
  hunt, Compiler & Runtime Stabilization phase). Confirmed directly:
  the C Backend translated string comparisons into a raw C infix
  operator on two `const char*` values — always pointer/address
  comparison in C, never content — the appearance of correctness in
  simple cases was coincidental (gcc pools identical string literals to
  the same address at `-O0`). Proven broken with a reversed-order case
  (`"banana" < "apple"` must be `false`) that address-pooling luck could
  not reliably satisfy. Fixed: string comparisons now emit a real
  `strcmp()` call. See `tests/compiler/stage-1-1-strings.test.ts`.
- **FIXED — string concatenation (`+`) was silently accepted by the
  type checker but the C Backend could not actually implement it**
  (Stage 1.1 Strings bug hunt). The type checker previously returned
  `T_STRING` for `string + string` (claiming a valid, working
  operation), but the C Backend translated `+` into raw C pointer
  arithmetic (`const char* + const char*`), invalid C, failing only
  with a confusing gcc-level error disconnected from the UR source.
  Fixed: rejected clearly at the type level (`TY3001`) instead. Real
  string concatenation (malloc-based, with its own ownership/lifetime
  questions) remains a genuine future feature, out of this
  stabilization round's own scope — not implemented, only the silent
  miscompilation is fixed.
- **Confirmed NOT supported (documented, not a bug — clear rejection,
  no crash)**: string indexing (`s[0]`), method calls (`.substring()`),
  and property access (`.length`) all produce clear diagnostics via
  the existing "not a known array/struct variable" / "no member-call"
  checks — genuinely unimplemented features, not silent failures.
- **Confirmed working (no bug found)**: empty strings, very long
  string literals (tested to 5000 chars), escape sequences, Arabic
  Unicode text, and multi-byte UTF-8 (emoji) all round-trip correctly
  through the full compile-and-run pipeline.

## What Is NOT a Limitation (confirmed working, listed to avoid confusion)

- Bounds checking is mandatory and always active — this is a design
  guarantee, not a limitation.
- Integer arithmetic, control flow (`if`/`while`/`break`/`continue`),
  local variables, and zero-argument function calls are fully
  supported and extensively tested on both backends.
