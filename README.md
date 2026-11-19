# UR Programming Language

Start here: UR_LANGUAGE_V1_0.md — Official UR V1.0 Developer Guide.

**A multilingual programming language built for humans.**


**UR V1.0 · Stable Release · C Backend · WebAssembly**

[Download V1.0](https://github.com/agheel494-design/ur-bridge-v27-final/releases/tag/v1.0.0) · [Getting Started](docs/INSTALLATION_GUIDE.md) · [Documentation](docs/) · [Examples](examples/)
---


## Why UR?

- **Multilingual by design** — UR is designed around a human-readable, multilingual programming experience.
- **A practical toolchain** — the project includes a real CLI, C execution path, WebAssembly backend, and package-management workflow.
- **Verified, not aspirational** — supported features and known limitations are documented separately so implemented capabilities remain distinguishable from deferred scope.

**A compiler for the UR programming language**, targeting a C Backend
(the primary, CLI-reachable execution path) and including an
implemented WASM Backend (see "Backends" below for its own precise,
current status).

## Naming Note (documented, not unilaterally resolved — see `CONTRIBUTING.md`/`RELEASE_PROCESS.md`)

This project has two coexisting identities:
- **Technical/repository identity**: `ur-bridge-v27`, version `27.0.0`
  (`package.json`). This repository's own `git` history (tags such as
  `v27-rc1`, `v27-level2-6-control-flow`, `v27-wasm-3.1b-rc1`) confirms
  "v27" denotes this repository's own internal development-generation
  lineage — the 27th major iteration of this codebase's own build —
  not a product version number.
- **Product/language identity**: `UR Language v1.0.0` (`VERSION`, and
  what `ur version` itself reports) — the version a user of the
  language actually sees.

These are two distinct, correctly-separate concepts (repository
lineage vs. product release), not a conflict to be "fixed" by making
one number match the other. Both are retained as-is — see
`RELEASE_PROCESS.md`'s own "Open Question" section for the full prior
context.

## Status

**UR V1.0 is released and published as `v1.0.0`.** The final release is anchored to commit `82ccb01ceee47ffe8dd00aa7358208e5d22a772d`. Final verification and publication evidence is recorded in `UR_V1_0_FINAL_RELEASE_EVIDENCE.md`.

*Earlier field test (not evidence for this candidate):*
`V1_0_FINAL_FROZEN_BASELINE.md` records a Windows 10 field test
("Windows Track A": 12 PASS, 0 FAIL, 2 N/A; package/import and FFI not
applicable).
- It was made on an earlier tree: tag `ur-language-v1.0.0`, artifact
  `UR-v1.0.0-Windows.zip` with 969 files.
- That is not this candidate.
- Its raw results are not part of this candidate's verification record.
- That record calls the tester independent but does not identify
  them, so their independence is not established.
- It therefore verifies nothing about this candidate.

`V1_0_FINAL_FROZEN_BASELINE.md` is kept unchanged as the record of an
earlier "v1.0.0" declaration. Under the current release process that
declaration is not the V1.0 release, and V1.0 has not been released.
The version shown by `ur version` (`1.0.0`) is the language version
this CLI targets (`src/cli/index.ts`), not a release statement.

## What UR Currently Supports (verified via this project's own executed
test evidence — not aspirational)

See `UR_LANGUAGE_VERSION_MATRIX.md` for the complete, authoritative
list. In summary: variables, functions (both 0-arg and N-arg calls,
verified via the Interpreter execution path used by `ur run`/`ur
build`), `if`/`else`, `while`, `for` (over arrays), `break`/`continue`,
arrays (including dynamically-constructed arrays, both as local
variables and as function return values), structs (including arrays of
structs), strings (equality and a stdlib of operations — see
`docs/STDLIB_MATH.md`/`docs/STDLIB_IO.md`), a real CLI (`ur init`,
`ur run`, `ur build`, `ur version`, `ur help`), and a package manager
(`ur publish`/`ur search`/`ur install`, working with the `import`
statement's own `ur_packages/<name>/` convention).

**Explicitly NOT yet supported**, each deferred with an explicit,
documented reason — see `KNOWN_LIMITATIONS.md` for the full, precise
list: `for i in <range>` syntax, `switch`, `try`/`catch`, first-class
function values, growable/dynamic-length collections (fixed-buffer
arrays only), native string concatenation/indexing, and nested/
transitive `import`s.

## Backends

- **C Backend**: the primary execution path reachable from the real
  CLI (`ur run`/`ur build`).
- **WASM Backend**: implemented in `src/backend/wasm/`, but not
  currently wired to any CLI command or flag — there is no
  `ur build --target=wasm` today. It is used internally for
  conformance/golden-fixture tooling only. Treated as a future
  capability, not part of the current release surface, until a
  dedicated design/Gate authorizes CLI integration.

## Platforms

- **Linux**: primary development and validation platform.
- **Windows**: not officially supported for this release. A defined
  scope has been verified on Windows 10 — see `SUPPORTED_PLATFORMS.md`
  for exactly what was verified, what does not work on Windows, and
  what behaves differently.
- **macOS**: not yet supported; prepared for later in CI
  (`.github/workflows/ci.yml`), not yet enabled.

## Getting Started

```bash
ur init          # creates a starter hello.ur
ur run hello.ur  # runs it
```

See `docs/INSTALLATION_GUIDE.md` and `docs/USING_UR_BRIDGE_TODAY.md`
for the full CLI reference (`init`, `run`, `build`, `version`, `help`,
plus package management via `publish`/`search`/`install`) and FFI usage
via a package's own `manifest.json`.

## Examples

See `examples/` and `docs/EXAMPLES.md` — every example is directly
tested and verified to compile and run correctly; no example exists
for any unsupported feature.

## Standard Library

See `docs/STDLIB_MATH.md` and `docs/STDLIB_IO.md`. See
`STDLIB_API_FREEZE_CHECK.md` for which functions are Frozen (safe to
depend on) vs. Provisional.

## Development

See `CONTRIBUTING.md` for the mandatory process order and verification
requirements, and `RELEASE_PROCESS.md` for the release status levels
and Stage sequence this project follows.

## Language Conformance

See `docs/CONFORMANCE_SUITE.md` — the official, systematic reference
for verified language behavior. Run it yourself:

```bash
npm install
npm run conformance
```

## Known Limitations

See `KNOWN_LIMITATIONS.md` — kept current, with every item classified
precisely (confirmed defect vs. missing semantic specification vs.
deliberately deferred scope).
