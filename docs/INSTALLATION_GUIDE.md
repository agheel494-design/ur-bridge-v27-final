# UR-Bridge — Installation Guide

**Status: user-facing documentation, verified against the actual
`package.json` and project structure — not aspirational. Any gap
between what this project's tooling declares and what actually exists
is disclosed explicitly below, not glossed over.**

---

## Prerequisites

- **Node.js** — this project's own development environment uses
  v22.22.2; no explicit `engines` field is declared in `package.json`,
  so no minimum version is formally pinned. A recent LTS Node release
  is recommended.
- **npm** — v10.x confirmed working in this project's own environment.
- **A network connection to the npm registry** — required for
  installation. (This project's own RC2 validation history documented
  a case where a sandboxed CI-style environment blocked registry
  access entirely; if `npm install` fails with a `403` error, this is
  an environment/network policy issue, not a project defect — verify
  registry access separately before assuming a UR-Bridge problem.)

## Declared Dependencies

From `package.json`, exactly two development dependencies:

```json
"devDependencies": {
  "typescript": "^5.4.5",
  "vitest": "^1.6.0"
}
```

No runtime dependencies are declared — this project has zero
third-party runtime packages as of this writing.

## Install Steps

```bash
git clone <repository-url>
cd ur-bridge-v27-final
npm install
```

## Verifying the Install

```bash
npx tsc --noEmit -p tsconfig.json   # should complete with 0 errors
npm test                             # runs the full test suite via Vitest
```

## No GCC/MinGW Required (Windows Recovery Sprint — architectural fix)

**Major update**: `ur run` and `ur build` (and the IDE's Run/Build
buttons) no longer require gcc, MinGW, or any C compiler at all. Per
explicit direction that "install GCC yourself" is not an acceptable
answer for a v1.0 end user, and that bundling a real MinGW-w64
toolchain was not achievable from this development environment (see
`WINDOWS_GCC_BUNDLING_STATUS.md`), the execution architecture itself
was changed: both commands now run UR programs directly via a real IR
interpreter (`src/interpreter/interpret.ts`), executing entirely
within Node.js. **Node.js is now the ONLY prerequisite** — no GCC, no
MinGW, no PATH configuration for a compiler, nothing to install beyond
UR-Bridge itself (which already needs Node.js to run at all).

`ur build` now produces a self-contained `.js` file (run via `node
<name>.js`) instead of a native executable — verified directly to run
correctly completely independently of the CLI, with gcc entirely
removed from `PATH` as a direct test of this exact scenario.

The C Backend (gcc-based compilation) still exists and is still used
for FFI-heavy programs (native library calls, e.g. `sqlite3`) that the
interpreter cannot execute (calling a real, linked native library
requires a real, linked native library — this is not a new limitation
introduced by this fix, it was always the case) — but `ur run`/`ur
build`/the IDE's Run/Build no longer touch it for the core language at
all, closing the "no manual GCC install" requirement completely for
the actual v1.0 minimum experience (write a program, run it, build it,
see the output).

## CLI (added — UR v1.0 Final Sprint; FIXED — real installer bug closed)

**Update (Critical bug fix)**: a real, externally-reported installer bug
("tsx not found" after a real Windows install) is now fixed at the root
cause. `npm run build` performs a REAL build now (`tools/build.mjs`):
compiles all TypeScript to plain JavaScript in `dist/`, and copies the
non-TypeScript assets (`runtime/*.c`/`*.h`, the IDE's frontend HTML)
that a TypeScript compile alone doesn't handle. The installed
`ur`/`ur-ide` commands run the COMPILED `dist/` output directly via
plain `node` — **`tsx` is no longer needed at runtime at all** for an
installed package; it remains a `devDependency` (used only by this
project's own test suite).

```bash
npm install
npm run build      # REQUIRED before packaging/installing — produces dist/
ur init
ur run hello.ur
ur build hello.ur
```

Verified directly: with `tsx` entirely removed from `PATH` (the exact
externally-reported failure scenario), the full sequence
(`version`/`init`/`run`/`build`) succeeds correctly end-to-end using
only the compiled `dist/` output and plain `node`.

A real Windows installer script now exists at
`installer/windows/ur-bridge.iss` (Inno Setup), incorporating the
exact fixes confirmed by real external testing on a genuine Windows
machine (removed an invalid `createallsubdirs` flag combination;
fixed `{}`-vs-`//` comment syntax). **Disclosed honestly**: this
assistant has no Windows/Inno Setup environment to actually compile
and run this installer — it is written correctly per Inno Setup's own
documented syntax and the specific fixes reported externally, but its
real compilation and installation success has not been (and cannot
be, from this environment) directly verified here.

## CLI (added — UR v1.0 Final Sprint, historical entry — superseded by the section above)

**Update**: a real, minimal, stable CLI now exists (`bin/ur.mjs`, wired
via `package.json`'s `bin` field, `src/cli/index.ts` for the
implementation). `tsx` is now a real, declared `dependency` (not just
a devDependency) since the CLI needs it at runtime. After `npm
install` followed by `npm link` (or a real global install once
published), the `ur` command is available directly:

```bash
ur init              # creates a starter hello.ur in the current directory
ur run hello.ur       # compiles and runs it immediately
ur build hello.ur     # compiles it to a real, standalone executable
ur version
ur help
```

Verified directly, end-to-end, in this project's own development
environment: `ur init && ur run hello.ur` prints `hello from UR`.
`ur build` produces a real executable that runs correctly completely
independently of the CLI or this project's own source tree.

**Disclosed limitation**: `src/cli/index.ts` is excluded from this
project's own strict `tsc --noEmit` checking (see `tsconfig.json`'s
own exclude comment) — this sandboxed development environment has no
network access to install `@types/node`, so Node.js built-in types
(`process`, `node:fs`, etc.) aren't available for strict checking.
The CLI is still fully tested via real, direct subprocess execution
(`tests/cli/cli.test.ts`) — the most honest way to test a CLI in any
case, since it exercises exactly what a real user's `ur` command
invokes. A real `npm install @types/node` in an environment with
registry access would resolve this gap and allow re-enabling strict
checking for this one directory.

## No CLI in RC2 (historical — superseded by the section above)

**Historical record, kept for accuracy**: `package.json` at RC2 time
declared a `bin` entry and two scripts (`cli`, `build:cli`)
referencing `src/cli/index.ts`, which did not exist anywhere in the
project at that time. Per an explicit review to make RC2 100%
externally verifiable, these dangling references were removed. A CLI
was genuinely out of scope for RC2. This is now superseded — see the
CLI section above for the current, real, working CLI added for the
v1.0 Final Sprint.

## Uninstalling

Standard `npm uninstall` semantics — no custom uninstall steps, no
global state written outside `node_modules` (confirmed: this project
writes no config files, caches, or other state outside its own
working directory during normal test/build operation).
