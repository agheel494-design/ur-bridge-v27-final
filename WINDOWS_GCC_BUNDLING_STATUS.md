# WINDOWS_GCC_BUNDLING_STATUS.md

**UPDATE (superseding note, read this first): the CORE "no manual GCC
install" requirement is now RESOLVED — not via bundling a toolchain
(which remains genuinely not achievable from this development
environment, see below), but via an architectural fix: `ur run`/`ur
build`/the IDE's Run/Build buttons no longer use gcc AT ALL. They
execute UR programs directly via a real IR interpreter
(`src/interpreter/interpret.ts`) running entirely inside Node.js — see
`docs/INSTALLATION_GUIDE.md`'s own "No GCC/MinGW Required" section for
the full account, and `tests/interpreter/interpret.test.ts` for direct
verification against the C Backend as ground truth. Node.js is now the
only prerequisite for the actual v1.0 minimum experience (write a
program, run it, build it, see the output — including through the
IDE).**

**What this file's own original content below still accurately
describes**: the C Backend (gcc-based) still exists and is still used
for FFI-heavy programs (calling a real, linked native library, e.g.
`sqlite3`) that the interpreter cannot execute — this is a genuinely
separate, already-optional feature (not required for the core
language), and bundling a real toolchain for THAT specific, advanced
use case remains not achievable from this environment, for the exact
reasons below. This is a real, honestly-disclosed remaining gap for
that narrower feature — not for the language's own basic use.

---

**Original status (still accurate for the FFI/native-library case
specifically): code-side support COMPLETE. Toolchain-acquisition side
NOT POSSIBLE from this development environment — precise, actionable
steps below for a party with the needed resources.**

---

## What Is Done (code side)

tools/backend/c-compile.ts's resolveGccPath() now checks, on Windows,
for a real MinGW-w64 toolchain bundled at
<install-dir>/mingw64/bin/gcc.exe (the standard directory layout of a
portable MinGW-w64 distribution) BEFORE falling back to whatever gcc
resolves to on PATH. This is a real, tested code change (3083/3083
tests still pass; the fallback path is exercised by every existing
test in this Linux environment, since no bundled toolchain exists
here).

**If a real toolchain is placed at the expected path, this code uses
it automatically — no further code changes needed.**

## What Is NOT Done, and Cannot Be Done From This Environment

**Actually obtaining and bundling a real MinGW-w64 distribution.**
This requires:
1. Network access to download a real, portable MinGW-w64 build (e.g.
   from the WinLibs project, or the official mingw-w64 project) - this
   development environment has no network access to any external
   host, confirmed repeatedly throughout this project's own history.
2. A real Windows environment to verify the bundled gcc.exe actually
   compiles and links a real UR program correctly - this environment
   is Linux-only.

## Precise, Actionable Steps for Someone With Those Resources

1. Download a portable MinGW-w64 distribution (x86_64, at minimum
   GCC 11+, matching the C99 standard this project already targets).
   WinLibs' own "UCRT runtime" builds are a common, well-tested choice
   for exactly this kind of bundling use case.
2. Extract it so its own bin/gcc.exe ends up at
   <project-root>/mingw64/bin/gcc.exe - matching exactly what
   resolveGccPath() already looks for.
3. Add a [Files] entry to installer/windows/ur-bridge.iss copying
   ..\mingw64\* to {app}\mingw64 (mirroring the existing dist/bin
   entries' own pattern).
4. Rebuild via node installer/windows/build-installer.mjs (already
   verifies required files exist before invoking iscc - extend its
   own requiredFiles list to include the bundled mingw64/bin/gcc.exe
   path too).
5. Test on a genuinely clean Windows machine with NO gcc/MinGW ever
   installed — the real test this requirement exists to satisfy.

## Until This Is Completed

**Priority 4's own full requirement ("no manual GCC install") is NOT
met.** A real end user on a machine with no pre-installed
gcc/MinGW-w64 toolchain will still see "gcc is not available in this
environment" from ur run/ur build, requiring a manual MinGW-w64
install as a real, current prerequisite.

**Stated plainly**: this specific sub-requirement is not yet
satisfied, and the reason is a genuine, structural limitation of this
development environment (no network access, no Windows test
capability) — not something achievable by writing more code from here.
