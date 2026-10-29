# UR Language v1.0 — Release Notes (RELEASE CANDIDATE, DRAFT)

> **Status of this document:** draft release notes for the V1.0 release candidate (C5-r2 + B-1 build fixes + Windows
> test-harness fixes + documentation update; its exact identity is recorded in the release record). It is **not** a release
> announcement. V1.0 is **NOT AUTHORIZED** until the project's formal release decision (the Project Owner, after
> Release Verification). Statements below describe the candidate tree as it is, with the evidence that supports them.

**Package identity:** npm package `ur-bridge-v27`, version `27.0.0`. The UR **language** version this CLI targets is
`1.0.0` (`ur version` prints `ur 1.0.0`). The two identities are deliberate and documented; they are not a mismatch.

**Candidate base:** C4 (`files=1039 tree_sha256=f788b04ff41dba6f11d1a85b02e97b377ba69e98e3d9b84f01faee4e796ed106`),
the tree verified by GATE-026. C5-r2 = C4 + the RB3-G6 test/infrastructure corrections + the F3 runtime correction +
`package-lock.json` + release documentation and approved decision records (owner decision of 2026-10-08). The only
production-source change in C5-r2 relative to C4 is F3 (one line in `src/interpreter/interpret.ts`). This candidate
adds to C5-r2: the B-1 build fixes (10 source files and 1 tool; 4 new test files under `tests/b1/`), the Windows
test-harness fixes W-2, W-1 and H-a (2 test files under `tests/ide/`), and this documentation update.

---

## 1. What V1.0 contains (contract scope)

Source: `GATE_025_RELEASE_CONTRACT_LEDGER_UPDATE` (contract ledger, 0 unresolved rows) and the approved decision
records in `docs/decisions/`.

| In scope | Notes |
|---|---|
| Core language | Bilingual keywords; 10 languages: ar, en, fr, es, de, ja, ru, zh, pt, hi |
| Interpreter (`ur run`) | The CLI execution path |
| C backend | Reached through the project's compiler tooling, not through the `ur` CLI |
| WASM backend | Within the V1.0 WASM contract of **DR-RB3-01 (amended)**: a construct is accepted when a differential test proves the same behaviour as C. Not reachable from the `ur` CLI |
| `for x in arr` | |
| FRI: manifest-based foreign imports (Mechanism B) and `call_external` | Under the FRI contract in §2 |

**Not in V1.0:** native FFI Mechanism A, compound/nested field access, `for i in 1 to 5`, C#, self-hosting, and any
"12 languages" claim.

## 2. FRI (foreign runtime interface) — GATE-026 remediation

| Item | Behaviour in this candidate |
|---|---|
| D1: typed result channel | A foreign call returns its value only through the dedicated typed result channel (`UR_FRI_RESULT_PATH`). Foreign stdout is never a UR value; it is routed to UR stderr as diagnostics (DR-RB3-02) |
| D2: containment | Each foreign call runs in a contained process: cgroup v2 on Linux, a Job Object helper (`ur-fri-jobrun.exe`) on Windows. Timeouts, output limits, termination of the whole foreign process tree. Failures carry a typed `FRI_*` prefix (DR-RB3-05). If containment is unavailable, the call fails closed with `FRI_CONTAINMENT_UNAVAILABLE` |
| D3: contract wording | **FRI is trusted foreign execution.** It provides no isolation and no sandbox guarantee, and it is not a security boundary. Containment is lifecycle and resource control only |
| D4: native pointers | A `nativeptr` argument is rejected at the FRI process boundary (`FRI_UNSUPPORTED_ARGUMENT`) before any foreign process starts |
| D5: manifest identifiers | Manifest identifiers are validated before any foreign code is generated (`FRI_INVALID_MANIFEST_IDENTIFIER`) |
| D6: cleanup | Per-call temporary directories are removed on every path |

Contract details that users must know:
- `call_external` returns **int only**. A float, string or other result panics; it is never coerced (DR-RB3-03).
- A manifest package must have a sibling `signatures.ur`; without it the import fails with `IM1001` (DR-RB3-04).
- A `./` or `../` JavaScript/TypeScript module path is resolved relative to the manifest directory (DR-RB3-05).

## 3. Status of this candidate (no claim of release readiness)

| Topic | State | Where recorded |
|---|---|---|
| `npm run build` | The 18 TypeScript diagnostics of C5-r2 are fixed (B-1). Exit 0 and a complete `dist/` were shown on the B-1r2 tree (byte-identical build inputs); not yet run on this candidate's tree | `KNOWN_LIMITATIONS.md` §V1.0-1 |
| Full test suite | No full release verification on this candidate's tree on both platforms yet. Release Verification is pending | `KNOWN_LIMITATIONS.md` §V1.0-6 |
| FRI on Windows | Not established for this release: the evidence conflicts and the cause is under investigation | `SUPPORTED_PLATFORMS.md` |
| Pinned dependencies | `package-lock.json` is now part of the tree (RB-5) | `CHANGELOG.md` |
| `main(): bool` exit code | Fixed on the interpreter (F3): `true` → 1, `false` → 0, as on the C backend | `CHANGELOG.md` |

See `KNOWN_LIMITATIONS.md` (section "V1.0 candidate — current limitations") for everything a user should know before
use.

---

## Earlier release notes (history, unchanged)

# UR-Bridge — Release Notes: Frontend Restored from RC2 (rc2)

**Release date:** 2026-06-28
**Base:** v27-rc1 (906/906 tests, 0 TypeScript errors)
**This release:** 1066/1066 tests, 0 TypeScript errors

---

## Headline

The UR compiler now has a complete frontend: **Lexer → Parser → AST →
Semantic Analyzer → Type System → Module System**, integrated with v27's
existing FFI/ABI/Platform SDK infrastructure with zero regressions.

This closes the gap identified during the Phase 7 SQLite3 integration
review, where it was determined that no Frontend existed in any uploaded
project slice and that claims of "End-to-End from UR Source" could not be
substantiated. That gap is now closed.

---

## What changed

### New: Lexer and Parser (built fresh, not restored)

After discovering that RC2's Lexer/Parser assumed an incompatible surface
syntax (`{}` blocks, `fn` keyword, no Arabic support), and after explicitly
rejecting a syntax-translation shim (which would have meant maintaining
two parsers long-term), the engineering decision was to write a new
Lexer and Parser directly against `UR_LANGUAGE_SPEC_1_0.md` — the ratified
language specification — while producing an AST compatible with RC2's
downstream components.

Key language properties now implemented and tested:
- **True bilingualism**: Arabic and English keywords map to identical
  canonical tokens. `دالة` and `function` produce the same `FUNCTION_KW`.
  A file may freely mix both.
- **Unified block terminator**: `نهاية` / `end` closes every block type
  (function, if, while, for) — there is no `endif`, `endwhile`, etc.,
  by design.
- **`if` as expression or statement**: `let label = if cond ... else ... end`
  works identically in Arabic and English.
- **Full Unicode identifier support**, including Arabic diacritics
  (tashkeel).
- **Error recovery that never hangs**: every statement-parsing loop in
  the Parser has a defense-in-depth progress guarantee (see Fixed, below).

### Restored from RC2 (logic unchanged)

- Semantic Analyzer — name resolution, scope checking, control-flow
  validation (break/continue outside loop), arity checking.
- Type System — type checker, type environment, compatibility rules.
- Module System — module registry, import resolution, export checking.

These were ported with only import-path updates and one type adaptation
(`ImportDecl.path` changed from `string` to `string[]` to support dotted
import paths like `import std.io`) — no behavioral changes.

### Fixed

Two real bugs were found and fixed during integration testing, both
permanently regression-tested:

1. **Lexer**: Arabic diacritics (shadda, fatha, kasra, etc.) were not
   recognized as valid identifier-continuation characters, causing
   identifiers like `صنّف` to be incorrectly split.
2. **Parser**: the diacritic bug above exposed a more serious issue — an
   unexpected token could cause the Parser to loop forever without
   consuming input. Fixed at the root (guaranteed `advance()` on every
   error path) and reinforced with defense-in-depth guards across every
   statement-parsing loop.

---

## Test results

| Stage | Tests | Status |
|---|---|---|
| Lexer | 92 | ✅ all pass |
| Parser | 50 | ✅ all pass |
| Frontend Integration (full pipeline, Arabic + English) | 18 | ✅ all pass |
| Existing v27-rc1 suite (FFI, ABI, Platform SDK, urpm, LSP, etc.) | 906 | ✅ all pass, zero regressions |
| **Total** | **1066** | **✅ all pass** |
| TypeScript errors | — | **0** |
| Architecture Tests | 18 | ✅ all pass (no architectural conflicts) |

---

## What is NOT yet done

- **Code generation** (AST → SSA IR → WASM/native) is not yet connected
  to this new Frontend. The existing `src/compiler/incremental/` pipeline
  operates on file content hashes, not on this AST — wiring them together
  is the next milestone.
- **End-to-end UR Source → FFI → SQLite3** execution is therefore still
  not possible. The Frontend can now lex/parse/semantically-check a real
  UR program that calls `sqlite.open(...)`, but nothing yet compiles that
  AST down to a native call. This remains the closure criterion for the
  next phase.
- Struct/enum declarations, generics, pattern matching, closures, and
  error handling syntax are deferred to Specification 1.1 (see
  `UR_LANGUAGE_SPEC_1_0.md` §11).

---

## Files added/changed

See `CHANGELOG.md` for the complete file-level breakdown.

---

## UR Level 1 Complete — Natural Language Support (10 languages)

**Test count: 1487/1487 passing, 0 TypeScript errors.**

Note on this number: during final verification, a pre-existing corrupted
test file (`driver-registry.test.ts`, 35 tests, broken since before this
milestone) was discovered failing to load silently. It is now fixed and
its 35 tests are included in the 1487 total. See CHANGELOG.md for full
detail — this is disclosed transparently rather than presented as a clean
number with no history.

UR now supports writing programs in 10 natural languages — Arabic,
English, French, Spanish, German, Japanese, Russian, Chinese, Portuguese,
and Hindi — through a single canonical compiler pipeline. There is no
per-language Lexer, Parser, or AST; every language maps to the same
16 canonical keywords via an isolated Language Mapper
(`src/compiler/localization/`), verified to produce byte-identical
canonical token sequences and AST structure regardless of source language.

Import statements, control flow (if/while/for/break/continue), function
declarations, and all other structural keywords work identically and
interchangeably across all 10 languages — including mixed-language
programs in a single file.

Performance impact of adding 10 languages: unmeasurable (well under 1%
in both directions across all benchmarked operations).

---

## UR Level 1 — Final Closure: LSP Real Frontend Integration

**Test count: 1529/1529 passing, 0 TypeScript errors.**

The most severe defect found across this project's entire review history
is fixed in this release: the Language Server (LSP) was silently
disconnected from the real UR 1.0 compiler. Every diagnostic a developer
would have seen in their editor — errors, warnings — was fake; the wired
analysis function was a regex-based placeholder that never actually ran
the Lexer, Parser, Semantic Analyzer, or Type Checker, and always reported
zero problems regardless of how broken the code was.

This is now fixed. The LSP runs the real, full compiler pipeline on every
document open and change. Two related defects were found and fixed in the
same investigation: "Go to Definition" always pointed to the top of the
file regardless of the real symbol location, and diagnostics could get
stuck showing stale errors after reverting an edit back to previously-seen
content (a caching bug).

All fixes are backed by 26 new regression tests that open real UR 1.0
programs — in both English and Arabic — containing genuine errors
(undefined variables, type mismatches, wrong argument counts, syntax
errors, control-flow misuse) through the actual public LSP API, and assert
that the correct diagnostic codes are returned.

Performance with the real pipeline now active: ~3.5ms per document open,
~6ms per incremental change — no measurable memory leak across repeated
document lifecycles.

**LEVEL 1 COMPLETE — APPROVED FOR LEVEL 2.**
