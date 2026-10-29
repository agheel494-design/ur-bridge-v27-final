# UR C Backend Specification

**Status:** Phase 2.3, complete **within its defined scope** (see §1)
**Location:** `src/backend/c/emit-c.ts` (pure IR→C emission), `tools/backend/c-compile.ts` (gcc invocation — lives outside `src/` because it uses Node's `child_process`/`fs`, consistent with this project's established rule that `src/` stays free of Node APIs)

---

## 1. Scope Statement

This document does **not** claim "the Backend is complete." It documents
exactly what Phase 2.3 supports, verified by real `gcc` compilation, real
execution, real exit-code checks, real `-Wall -Wextra` warning capture, and
real AddressSanitizer runs — and equally clearly documents what it does
**not** support yet.

C was chosen as the first backend (not LLVM, not WASM) because it is
portable, requires no new toolchain dependency, and is directly executable
— ideal for proving the first full compiler pipeline before investing in a
heavier backend. Future backends (LLVM, WASM) will consume the **same** IR
(`src/shared/ir.ts`) — nothing about this backend's existence constrains
them.

---

## 2. Feature Support Matrix (verified by real compile + real execution + ASan)

| Feature | Supported | Verified by |
|---|---|---|
| Hello World (exit-code proof) | ✅ | real gcc compile, real run, exit code checked |
| Variables | ✅ | same |
| Arithmetic (`+ - * / %`) | ✅ | same, operator precedence checked |
| Comparison (`== != < <= > >=`) | ✅ | bool-returning `main` → 0/1 exit code |
| Logical (`&& \|\|`) | ✅ | same |
| Function calls (direct, by name) | ✅ | same |
| Nested function calls | ✅ | 5-level deep call chain verified |
| Return (explicit) | ✅ | same |
| Reassignment (SSA rebind) | ✅ | same |
| Multi-language source (Arabic keywords) | ✅ | same — `main` identifier itself is never localized (see IR_SPEC.md §6 and the entry-point convention below) |
| `if` / `else` | ❌ | rejected with `CG1001` at the IR stage, before ever reaching this Backend |
| `while` | ❌ | rejected with `CG1001` |
| `for` | ❌ | rejected with `CG1001` |
| structs / arrays / maps | ❌ | no IR representation exists yet |
| FFI calls from generated code | ❌ | no IR representation exists yet |
| stdout / `print()` | ❌ | intentionally deferred to the Standard Library phase — see §3 |

Zero compiler warnings (`-Wall -Wextra`) and zero AddressSanitizer findings
across every supported case — verified in `tests/backend/c/e2e-compile-run.test.ts`.

---

## 3. Program Entry Point Convention

UR identifiers (function/variable names) are **never localized** — only
keywords are (see `src/compiler/localization/`). This means there is no
principled way for the compiler to recognize a translated word as "the
entry point" across 10 languages. The adopted convention, consistent with
C/Rust/Go/Zig:

> **The entry point function must be literally named `main`** (an ordinary
> Latin identifier), regardless of which language's keywords the rest of
> the program uses.

Example — valid Arabic-keyword program with the required `main` identifier:

```ur
دالة اجمع(أ: عدد, ب: عدد): عدد
  أرجع أ + ب
نهاية

دالة main(): عدد
  عرف س = اجمع(5, 7)
  أرجع س
نهاية
```

If no function named `main` exists in the module, `emitC()` produces a
`.c` file with no C `main()` function — it compiles as a library-only
translation unit, not a runnable executable.

---

## 4. Import Status — Explicit, to prevent misreading multi-file support

| Stage | Status |
|---|---|
| **Parsed** | ✓ — `import x.y` parses correctly at the Frontend level (Level 1, frozen) |
| **Resolved** | ✗ — no cross-file symbol resolution exists in the Codegen/Backend pipeline |
| **Linked** | ✗ — no multi-file linking model exists |
| **Generated** | ✗ — an imported module's code is never emitted or referenced by the C Backend |

**Concretely:** a program containing `import math` compiles and lowers to
IR successfully as long as it never actually *uses* an unresolvable
cross-file symbol — the `import` statement itself is simply inert at this
phase. A genuinely multi-file UR project (e.g. `main.ur` calling a
function defined in `utils/math.ur`) is **not yet supported end-to-end**
by Codegen/Backend, even though each file individually parses, analyzes,
and type-checks correctly (Level 1 capability, unaffected). True
multi-file compilation requires a module-linking design decision not yet
made — this is explicitly reserved for a future phase.

---

## 5. Known Portability Caveat: Non-ASCII C Identifiers

The current Backend emits qualified C symbol names by sanitizing non-ASCII
characters in the **module** name to underscores (`src/shared/symbols.ts`'s
`qualifiedName()`), but does **not** sanitize the **function/parameter**
name itself when it originates from a non-Latin UR identifier (e.g. an
Arabic function name `اجمع` is emitted verbatim as part of the C symbol
name `ur_<module>_اجمع`, and Arabic parameter names become C parameter
names like `p_أ`).

**This currently works** — verified empirically: gcc 13.3.0 under
`-std=c99 -Wall -Wextra` accepts raw UTF-8 bytes in C identifiers with
zero warnings, and the resulting binary runs correctly with zero
AddressSanitizer findings (see `tests/backend/c/e2e-compile-run.test.ts`,
"Arabic-keyword program").

**This is not guaranteed by the C99 standard itself** — it is a GCC
extension (long-standing but not universal). A portable C backend
targeting other compilers (Clang, MSVC, older/embedded C toolchains) is
**not guaranteed** to accept this without either an explicit non-ASCII
identifier extension flag or symbol mangling.

**Planned resolution (future phase, not yet scheduled):** introduce real
symbol mangling for non-ASCII UR identifiers in `qualifiedName()` (e.g. a
transliteration or hash-based scheme), decoupling the emitted C symbol
name from the source identifier's script entirely, the same way C++
compilers mangle names independent of their spelling. This is deferred
because (a) it works correctly today on the toolchain this project
targets, and (b) designing a stable, collision-free mangling scheme is
real engineering work that deserves its own reviewed phase, not a rushed
fix bundled into Phase 2.3's closure.

---

## 6. Compilation Flags

| Purpose | Flags |
|---|---|
| Standard build | `-std=c99 -O0` |
| Warning capture (testing) | adds `-Wall -Wextra` |
| Memory-safety verification (testing) | adds `-fsanitize=address -g` |

No optimization flags are used in Phase 2.3 — there is no Optimizer yet
(a separate, not-yet-started phase). `-O0` ensures the generated C's
structure maps as directly as possible to the IR for debugging clarity.

---

## 7. What Is Explicitly Out of Scope (Phase 2.3)

Everything listed as ❌ in §2, plus:
- Debug symbol generation (DWARF/line-table emission) — not yet implemented.
- Linking against external libraries (FFI from generated code).
- Any optimization pass (constant folding, dead code elimination) —
  these belong to a future Optimizer phase operating on the IR, not the
  Backend.
- LLVM and WASM backends — planned to consume the same IR once it is
  extended with control flow.
