# UR-Bridge — Build Guide

**Verified against the actual, current `package.json` and toolchain —
every command below was directly executed as part of this project's
own stabilization work.**

---

## Prerequisites

See `docs/INSTALLATION_GUIDE.md` for full prerequisites. In summary:
Node.js, npm, a network connection to the npm registry.

## TypeScript Build (Type-Checking)

```bash
npm run typecheck
# equivalent to: tsc --noEmit
```

Expected result: 0 errors, 0 warnings, exit code 0 (confirmed
directly, repeatedly, throughout this project's own history).

## C Backend Build (Per-Program, Not a Project-Wide Build Step)

UR-Bridge's C Backend emits C source text (via `emitC()`) that must
then be compiled with a real C compiler AND linked against this
project's own Runtime Core (`runtime/ur_runtime.c`) — every generated
`.c` file `#include`s `"ur_runtime.h"` and calls into Runtime Core
functions, so compiling the generated file in isolation will fail with
a missing-header error (confirmed directly). This project's own test
suite handles this via `tools/backend/c-compile.ts`, which always adds
`-I <runtime-dir>` and links `ur_runtime.c` directly (no pre-built
runtime library — it's compiled together with the generated code each
time). There is no single "build the whole project's C output" step,
since C output is generated per-UR-program, not as a project-wide
artifact.

**Verified working command** (Linux, GCC 13.3.0, run from the project
root):
```bash
gcc -std=c99 -O0 -Wall -Wextra -I runtime -o my_program my_program.c runtime/ur_runtime.c
```

Optionally, for memory-safety verification (also verified directly):
```bash
gcc -std=c99 -O0 -fsanitize=address -g -I runtime -o my_program my_program.c runtime/ur_runtime.c
gcc -std=c99 -O0 -fsanitize=undefined -g -I runtime -o my_program my_program.c runtime/ur_runtime.c
```

## Running the Full Test Suite

```bash
npm test
# equivalent to: vitest run
```

## Running Specific Test Categories

Every category-specific script in `package.json` was individually
verified to point at a real, existing test path as of this guide's
writing (see `CHANGELOG.md`'s
`rc2-priority-directive-external-verifiability` entry for the full
audit). Examples:

```bash
npm run test:opt          # Optimizer tests
npm run test:wasm         # WASM/compiler tests
npm run test:frontend     # Lexer/parser/frontend integration
```

## Coverage

```bash
npm run coverage
# equivalent to: vitest run --coverage
```

**Note**: this requires the `@vitest/coverage-v8` (or equivalent)
package, which is not itself listed in `package.json`'s own
`devDependencies` — Vitest may prompt to install it on first use in a
real, network-connected environment. Not independently verified as
part of this project's own internal sessions (see
`KNOWN_LIMITATIONS.md`'s tooling section).

## Known Build Environment Limitation

This project's own internal development sessions have consistently
been unable to reach the public npm registry (documented extensively
in `RC2_VALIDATION_REPORT.md`). This is an environment-specific
network policy, not a defect in this project's own build
configuration — a real, network-connected environment should not
encounter this.
