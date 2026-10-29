# UR-Bridge — Supported Platforms

**This document reflects only what has been directly tested and
verified, per this project's own standing "docs must match code"
discipline — not aspirational or planned support.** Every statement
below names its evidence in square brackets; the keys are listed under
"Evidence" at the end.

---

## Officially Supported and Tested

### Linux (x86_64)

- **Verified host**: Ubuntu 24.04 (Linux 6.8), GCC 13.3.0, Node.js
  v22.23.3. [T1-L, P2]
- **Build**: `npm run build` exits 0 with 0 TypeScript diagnostics;
  `dist/` is complete; `ur-ide` answers `GET /` with 200; the built CLI
  launcher matches the source CLI on a 249-program corpus. [T1-L,
  on the B-1r2 tree, not on this candidate's tree; the build inputs of the two trees are byte-identical, which is an inference, not a run on this tree]
- **Test suite**: of 3591 results, 3582 pass and 5 fail on the verified
  host. [T1-L, on the B-1r2 tree; not run on this candidate's tree]
  A cause is proposed for each of the 5 in the verification record;
  none has yet received a release ruling.
- **Memory safety**: the AddressSanitizer/UndefinedBehaviorSanitizer
  tests run as part of that suite and are not among the failures.
  [T1-L, on the B-1r2 tree]
- **This is the project's official baseline** — the reference platform
  all other claims are measured against.

### WebAssembly (via any WASM-compatible host)

- The WASM Backend's own output is validated with
  `WebAssembly.validate()` and executed via `WebAssembly.instantiate()`
  throughout this project's own test suite (Node.js's own WASM runtime)
  — this is host-agnostic by WASM's own design, but only Node.js's
  runtime has been directly exercised by this project's own tests.

## NOT Officially Supported

### Windows (x64): not officially supported; verified within a defined scope

Windows is **not an officially supported platform** for this release.
A defined scope has nevertheless been verified on one Windows 10 host.
It is stated here exactly, so that it is neither overstated nor hidden.

**Verified host**: Windows 10 (build 10.0.19045), Node.js v24.15.0,
Python 3.13.0, MinGW-w64 GCC 14.2.0. [P1, P3, T1-W]

**Verified on that host:**
- **Production build** (`node tools/build.mjs`): a TypeScript build with
  no diagnostics; `dist/` CLI, IDE server, runtime and IDE page;
  `BUILD_INFO.json`. The built CLI runs `version`, `init`, `run` and
  `build` with plain Node. [HAFIX, through the build tests]
- **IDE and launcher**: `ur-ide` answers `GET /` with 200, and the built
  CLI launcher matches the source CLI on a 249-program corpus. [T1-W,
  on the B-1r2 tree, not on this candidate's tree; the build inputs of the two trees are byte-identical, which is an inference, not a run on this tree]
- **IDE tests**: the IDE server and CLI/IDE parity tests pass (15/15, in
  three separate runs). [HAFIX]
- **FRI on Windows: not established for this release.** In one targeted
  run the FRI test files passed (126/126) with a helper built from
  source [P3]. In a later full run on this tree with a different helper
  binary, the FRI tests failed [G1016]. The cause has not been
  determined. No support for FRI on Windows is claimed.

**Requirements for FRI on Windows**: MinGW-w64 on `PATH`, and
`ur-fri-jobrun.exe` built from `src/native/ur-fri-jobrun.c`. Without the
helper, every FRI call fails closed with `FRI_CONTAINMENT_UNAVAILABLE`.
[P3, HAFIX]

**C backend toolchain**: on Windows, `tools/backend/c-compile.ts` uses a
bundled MinGW `gcc` when one is present. [code: `c-compile.ts`]

**Does not work on Windows** (established by code inspection and test
results):
- **Native FFI executor**: `src/ffi/native/platform-executors.ts`
  defines `WindowsExecutorStub`, and its `load()`, `execute()` and
  `unload()` methods each call `notSupported()`. This is a deliberate,
  explicit stub. [code]
- **Native-library imports through the built-in registry** (`import
  sqlite3` and the other registry libraries): the registry in
  `src/compiler/semantic/native-library-registry.ts` resolves these to
  Linux library paths, or builds paths that are not valid on Windows.
  The corresponding tests fail on Windows. [code; REG]
- **Sanitizer builds**: AddressSanitizer/UndefinedBehaviorSanitizer
  builds fail, because MinGW-w64 has no sanitizer runtime. [REG]

**Behaves differently on Windows**, for executables produced by the C
backend. The C backend is reached through the compiler tooling, not
through `ur run`/`ur build`; see `KNOWN_LIMITATIONS.md` V1.0-3.
- They write Windows line endings (`\r\n`) to standard output. [REG]
- A program that recurses to depth 50,000 completes on Linux but ends
  with a stack overflow (`0xC00000FD`) on Windows. [REG]
- A crash is reported as a Windows exception code, not as a POSIX
  signal name. [REG]
- The process exit status is 32-bit: values above 255 or below 0 are not
  truncated to 8 bits as they are on Linux. [REG]

**Test suite on Windows**: the full suite is **not clean**.
- A full run of 3539 tests on the verified host, without the FRI helper,
  had 240 failures. [HAFIX]
- 57 of these passed in the targeted FRI run [P3] (see the FRI
  statement above), and 1 was measured to be timing variance [P1].
- The remaining 182 also fail on the earlier candidate tree. A cause is
  proposed for each in the verification record [REG]; none has yet
  received a release ruling.

### macOS

Same situation as Windows for the native FFI executor
(`MacOsExecutorStub`, same explicit `notSupported()` pattern) — never
built or tested on macOS by this project's own CI/test history.

## Why This Matters

Per an explicit stabilization directive: if a platform is not
officially supported, this must be documented clearly rather than
either (a) silently claiming support that doesn't exist, or (b)
treating the absence of untested-platform verification as a release
blocker. Linux is this project's release baseline. Its verified scope
and its 5 known test failures are stated above. Windows is not
officially supported: what was verified on Windows, what does not work
there, and how it behaves differently are stated above. macOS is
unverified. Platforms that are not officially supported are not release
blockers.

## Evidence

The keys used above refer to the V1.0 verification record:

| Key | Item | Tree |
|---|---|---|
| T1-L | `T1-LINUX-transcript-T1.txt`, sha256 `7f850157…f223` (transcript) | B-1r2 |
| T1-W | `T1-WIN-B1r2-DELIVER.zip`, sha256 `5c7c2ec0…` | B-1r2 |
| HAFIX | `HAFIX-WIN-DELIVER.zip`, sha256 `1c6c1936…` | c338608b |
| P1 | `P1-ABBA-WIN-DELIVER.zip`, sha256 `e8224246…` | c338608b vs B-1r2 |
| P2 | operator terminal output `p.txt`, sha256 `c8f7269c…` | c338608b |
| P3 | `P3-FRI-WIN-DELIVER.zip`, sha256 `b2ad6707…` | c338608b |
| G1016 | `GATES-20261016-r2.zip`, sha256 `6bba28b7…` (this tree plus helper binary `a957dd81…`) | c338608b |
| REG | `CORRECTED-FAILURES-REGISTER.json` (proposed cause for each failing test; not a release ruling) | — |
| code | the source file named in the statement | this tree |
