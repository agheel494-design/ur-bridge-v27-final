# UR-Bridge libc portability fix — candidate report

## Scope
- `src/compiler/semantic/native-library-registry.ts`
- `tests/compiler/codegen/native-call-hardening-edge-cases.test.ts`

## Changes made
1. `NativeLibraryEntry.libraryPath` is now optional to represent platform C-runtime symbols that do not require a separate shared-library link input.
2. `libm` and `libc` registry entries omit Linux `.so` paths on Windows. Linux keeps the existing absolute paths.
3. `libc.strlen` uses the standard C return type `size_t`, matching `<string.h>` across LP64 Linux and LLP64 Windows, rather than hard-coded `unsigned long`.
4. Tests now permit omitted link paths, assert Windows omits Linux CRT/math library paths, check the generated `strlen` declaration, and add direct `abs(-42) == 42` and `strlen("hello world") == 11` execution cases.

## Verification
- TypeScript source check: PASS (`tsc --noEmit`).
- Targeted test-file type check: PASS (`tsc --noEmit ... native-call-hardening-edge-cases.test.ts`).
- Native C ABI probe on Linux GCC 14.2.0: PASS (`ABS=42`, `STRLEN=11`, exit 0), compiled with `-std=c99 -Wall -Wextra -Werror` using standard headers and `extern int abs(int)` / `extern size_t strlen(const char*)`. Re-run in this continuation and observed the expected output.
- Full targeted Vitest execution: BLOCKED in this environment. Direct `node node_modules/vitest/vitest.mjs run tests/compiler/codegen/native-call-hardening-edge-cases.test.ts` fails before test collection because `@rollup/rollup-linux-x64-gnu` is missing. The bundled dependencies contain Windows-native packages (`@esbuild/win32-x64`) and lack Linux-native optional binaries. An attempt to install the missing Linux packages timed out. This is an environment limitation, not a passing Vitest result.
- Windows UR-Bridge execution: NOT VERIFIED here; requires running the targeted test on the user's Windows/MinGW environment.

## Next required verification
Run on the Windows/MinGW machine with the project dependencies already installed:

```powershell
npx vitest run tests/compiler/codegen/native-call-hardening-edge-cases.test.ts
```

The two new execution tests must pass (`libc.abs(-42)` prints `42`; `libc.strlen("hello world")` prints `11`). Then run the targeted suite on Linux as well. Record the exact exit codes and test counts. Do not close the gate if either run fails or cannot be performed.

## Gate status
`BLOCKED — WINDOWS E2E NOT YET VERIFIED`.
This candidate is not a claim of a closed gate. Run the targeted test on Windows and Linux before authorizing closure.
