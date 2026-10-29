# V1_0_FINAL_FROZEN_BASELINE.md

**This document is FROZEN as of its own creation. It describes the exact, immutable state of UR Language v1.0.0. It must not be edited to reflect future changes - v2.0 development creates new documents; it does not rewrite this one.**

---

## Version

**Product/Language Version**: UR Language v1.0.0 (what ur version reports; the VERSION file's own content)

**Repository/Technical Identity**: ur-bridge-v27, 27.0.0 (package.json) - a distinct, intentionally-separate concept denoting this repository's own internal development-generation lineage (confirmed via this repository's own git tag history: v27-rc1, v27-level2-6-control-flow, v27-wasm-3.1b-rc1, etc.), not a product version number. See README.md's own "Naming Note" for the full documented reasoning. This is a deliberate, understood dual-identity - not an error requiring correction.

## Commit

**Release Content Commit**: 372b200f124b00cef0da696c2299a7fb5f01d856 (the last commit changing release-facing content - the README.md documentation correction)

**Tag Commit** (includes the release content commit plus this baseline document itself): 48fd31d92ba277794d6875e1675553f0f2583905

## Tag

**Release Tag**: ur-language-v1.0.0 (points to commit 48fd31d92ba277794d6875e1675553f0f2583905)

## SHA-256

**Release Artifact**: UR-v1.0.0-Windows.zip
**SHA-256**: bd428c46a02e7c8c67eec433970b5442f248a7f8bd51ad5fc23ed802b3590ef9

Artifact built via git archive --format=zip from the ur-language-v1.0.0 tag - contains exactly the 969 files tracked by git at that commit, with zero node_modules, zero dist/, zero temporary test shims, zero untracked debug/log artifacts (verified: run-logs-independent-review/, run-logs-struct-phase1/, and an empty src/ffi/drivers/zlib/ directory were confirmed untracked and correctly excluded; the four run-logs* directories explicitly marked in .gitignore as "real deliverable evidence" - run-logs/, run-logs-languages/, run-logs-regression-post-doc-fix/, run-logs-js-bridge-module-resolution-fix/ - are correctly included, being tracked files).

## Supported Languages

10 languages, aggregated from src/compiler/localization/index.ts's own ALL_LANGUAGES export: Arabic (ar), English (en), French (fr), Spanish (es), German (de), Japanese (ja), Russian (ru), Chinese (zh), Portuguese (pt), Hindi (hi). Cross-language keyword collisions: zero, per detectCrossLanguageCollisions(). Multilingual Equivalence Validation: CONDITIONAL - Calculator and Undefined-Variable-Error categories proven equivalent across all 10 languages (20/20 executions, 0 semantic mismatches); Functions, Control Flow, Arrays, Strings, remaining Error cases, and Interop categories not yet executed. OOP: Not In Current Contract (no OOP/class canonical keyword exists in the baseline).

## Supported Platforms

- Linux: primary development and validation platform.
- Windows 10: independently field-tested and PASSED (Windows Track A, A1-A14 - see below).
- macOS: not yet supported.

## CLI Status

PROVEN. ur init, ur run, ur build, ur version, ur help all live-verified, including on real Windows 10 hardware by an independent tester. Package management (ur publish, ur search, ur install) proven for the single-package lifecycle; multi-package dependency resolution/conflict detection is implemented in the isolated src/urpm/ package but not reachable from the real CLI (documented limitation, not fixed for v1.0).

## Compiler Status

PROVEN. Lexer, Parser, Semantic Analyzer, Type Checker all confirmed stable and producing a unified, professional diagnostic format (file:line:col: error[CODE]: message + visual caret) - independently re-verified on Windows 10.

## Runtime Status

PROVEN. The Interpreter (the real execution path behind ur run/ur build) confirmed correct across the full language surface tested in this project's own extensive Gate history (control flow, arrays including dynamic construction, structs, recursion, scope/frame isolation, N-arg function calls). UrPanic (division-by-zero, bounds, recursion-limit) confirmed with a distinct, deliberate exit code (101).

## Package/Import Status

PROVEN for the core, single-dependency lifecycle: ur_packages/<name>/ convention, import statement, ur publish/search/install. Known limitations (documented, not fixed for v1.0): weak SemVer validation at publish time (accepts non-conformant version strings); multi-package dependency graph/conflict/circular-dependency resolution exists only in the isolated src/urpm/ package, not reachable from the real CLI (update command does not exist in the real CLI dispatch).

## FFI Status

PROVEN for the manifest-based mechanism (the sole system reachable from .ur import statements, per a pre-existing, ratified architectural decision - src/ffi/drivers/* is a separate, internal toolkit, deliberately not reachable from UR source). Module resolution contract, confirmed via live testing: compiled runtimes (c, cpp, rust, go, java, wasm) resolve ur_packages/<pkg>/ first, then the process's own working directory; interpreted runtimes (python, javascript) resolve via their own native, cwd-relative import/require mechanism only - ur_packages/<pkg>/ is never consulted for those two. A crash on malformed manifest.json (missing module/exports fields) was found and fixed (tag ffi-manifest-crash-fix-v1).

## WASM Status

Implemented (src/backend/wasm/), but NOT CLI-Reachable. No ur build --target=wasm or equivalent flag exists; --wasm/--target=wasm are silently ignored by the real CLI, producing ordinary .js output. Used internally only by tools/run-conformance.ts and tools/generate-wasm-golden.ts. Explicitly out of this release's own surface - a Future Capability / v2.x candidate, not part of v1.0.

## Known Limitations

- for i in <range> syntax, switch, try/catch, first-class function values: absent (Lexer/Parser/IR-Builder gaps).
- Growable/dynamic-length collections: fixed-buffer-array pattern only.
- Native string concatenation and indexing: absent (stdlib functions available instead).
- Nested/transitive imports: explicitly rejected.
- publish accepts semantically-invalid version strings (weak validation).
- Multi-package dependency resolution/conflict/circular-dependency detection: implemented in an isolated module, not reachable from the real CLI.
- Runtime/Import/Package error messages lack the stable [CODE] + precise-location structure that Compiler Frontend (Lexer/Parser/Semantic/TypeChecker) errors already have.
- WASM Backend: Implemented, not CLI-reachable.
- Multilingual Equivalence Gate: CONDITIONAL, not GREEN - only 2 of 9 required test categories executed to date.

## Known Test Failures

12 known environment failures, stable across this project's entire history at every checked baseline (Stage 8E-F, Part D-3A, Part D-8, this final release commit): tests/stdlib/std_math.test.ts (1), tests/platform/architecture-rules.test.ts (1), tests/cli/build-tsx-independence.test.ts (2), tests/cli/cli.test.ts (1), tests/examples.test.ts (5), tests/ffi/drivers/js-bridge-export-patterns.test.ts (1), tests/ide/ide-server.test.ts (1). Total suite: 3499 passed / 12 known environment failures / 0 new regressions at this exact commit.

## Windows Track A Result

PASS. Independently tested on genuine Windows 10 hardware by an independent party; source modifications by tester: NO.

| # | Area | Result |
|---|---|---|
| A1 | CLI Discovery | PASS |
| A2 | First User Experience | PASS |
| A3 | Basic Language | PASS |
| A4 | Control Flow | PASS |
| A5 | Functions | PASS |
| A6 | Frame Isolation | PASS |
| A7 | Negative Compilation | PASS |
| A8 | Runtime Errors | PASS |
| A9 | Package / Import | N/A |
| A10 | FFI | N/A |
| A11 | Build | PASS |
| A12 | Windows Clean Install | PASS |
| A13 | PATH Integration | PASS (closed via installer/windows/ur-bridge.iss fix, tag a13-path-fix-v1; re-verified PASS by the independent tester) |
| A14 | PATH With Spaces | PASS |

Total: 12 PASS / 0 FAIL / 0 BLOCKED / 2 N/A.

## Release Date

This document's own creation date, per the Release Closure process: 2026-08-29 (session date).

## Self-Hosting Status (For the Avoidance of Doubt)

Full Self-Hosting is NOT CLAIMED for this release. A Mini Self-Hosted Compiler Pipeline's own feasibility was separately, independently proven (K1 through K5, Stage 8A through 8J-R) - this demonstrates that UR is capable of hosting increasingly complex parts of a compiler toolchain within itself, but this is explicitly distinct from, and does not constitute, "UR is Self-Hosting." That claim requires the full Self-Hosting Gate sequence through S14, not yet undertaken.

---

**V1.0 = FROZEN at commit 372b200f124b00cef0da696c2299a7fb5f01d856, tag ur-language-v1.0.0.**

**This baseline document must not be edited after this point.** Any future correction or clarification belongs in a new, dated document; this file is the permanent historical record of what v1.0.0 was, verified, at the moment of its own freeze.
