# UR — RC3 candidate notes (UR-PM-DIRECTIVE-002)

**Status: candidate under review. NOT a release.** No V1.0 declaration. The licence and copyright holder are
not yet confirmed by the owner, so nothing built from this tree may be published or distributed.

## 1. What changed from RC2 (`76bf74c4`)

| ID | Change | Files | Behaviour of `src/` |
|---|---|---|---|
| D-4 | Tests that registered a passing placeholder ("SKIPPED: …", `expect(true).toBe(true)`) when a dependency (gcc, g++, libpython, librav1e, SQLite) is missing now register a real skip (`it.skip`, or `ctx.skip()` inside the two B-1 tests) | 18 test files | unchanged |
| D-5 | The duplicate `typecheck` script key in `package.json` is removed. The key that was in effect (`tsc --noEmit`) is kept | `package.json` | unchanged |
| D-6 | New official gate: the 110 multilingual cases (11 sets × 10 languages) are run through the real CLI and checked against each set's `expected.json` | `tests/multilingual/multilingual-110.test.ts` | unchanged |
| D-8 | `selfhost/lexer/charclass.ur` re-implements the lexer's identifier character classes in UR; a test checks it against the TypeScript lexer over code points 0–65535 | `selfhost/lexer/charclass.ur`, `tests/selfhost/charclass-equivalence.test.ts` | unchanged (the compiler still uses the TypeScript lexer; this is **not** self-hosting) |
| DOC | This file | `docs/release/RC3_RELEASE_NOTES.md` | — |

**Not in this candidate:** D-7 (source-relative package resolution). It is a separate proposal awaiting review.

## 2. Package import contract of THIS candidate

- `import <name>` looks for `<cwd>/ur_packages/<name>/index.ur` (a UR package) or
  `<cwd>/ur_packages/<name>/manifest.json` (a foreign-runtime package). **The folder of the source file is NOT
  searched.** Running a file from another folder gives `error[IM1001]: cannot find module` (Decision 2B).
- If `<cwd>/ur.lock` exists, a UR package must be registered in it with a matching SHA-256, or the import is
  rejected. A corrupted `ur.lock` rejects every import.
- For a `python` package, the package folder is put in front of `PYTHONPATH`. An existing `PYTHONPATH` is kept.
- Nested or transitive imports are rejected.
- A Python module that does not exist, or a Python function that raises, is reported only when the call runs:
  `UR panic: FRI_FAILED …`, exit 101. A missing runtime gives `FRI_RUNTIME_NOT_FOUND`, exit 101.

## 3. Foreign runtimes

The manifest accepts: python, javascript, typescript, c, cpp, wasm, rust, go, java, native.
The proof status of each one is in `docs/architecture/FFI_STATUS.md`. rust, go and java need their own
toolchain installed and are not runtime-proven there.
In this review cycle only the **python** runtime was exercised end to end (the standard library `math`, and a
module shipped next to a manifest). **No claim of complete cross-language interoperability is made.**

## 4. Platform

Only Linux x86_64 has clean test evidence. Windows has 182 open failures in its last raw run, and macOS has
never been run. The V1.0 platform scope is a decision for the owner and is not settled by this file.

## 5. Running without tsx

The built CLI (`dist/src/cli/index.js`, started by `bin/ur.mjs`) runs with plain Node.js; neither `npm install`
nor `tsx` is needed for the core CLI. `tsx` is needed only for the optional `typescript` foreign runtime
(found under `node_modules/.bin`, or via `TSX_BIN`, or on `PATH`).
`package.json` still lists `tsx` under `dependencies`; moving it needs a lockfile regeneration and is a separate
decision.

## 6. Known limitations carried into this candidate

- Package lookup is cwd-only (see §2), until D-7 is decided.
- When a native library is missing, the number of tests a file registers changes (one skip instead of the
  full set). This is why totals differ between hosts.
- `ur version` prints the language version (`1.0.0`); `package.json` carries the repository version
  (`27.0.0`).
- `dist/BUILD_INFO.json` records the build time, so two builds of the same source give different archives.
