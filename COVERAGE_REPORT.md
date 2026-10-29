# Coverage Report — Item 4

**Status: manual analysis, not tool-generated. No real coverage tool
(`@vitest/coverage-v8`, `nyc`, `c8`) is available in this environment
(confirmed directly: `npm ls @vitest/coverage-v8` → empty; neither
`nyc` nor `c8` installed) — a genuine, disclosed limitation, not a
number to be faked. This report is a file-reference-based proxy: does
at least one test file import/reference each source file, directly or
transitively through a well-tested consumer.**

---

## Method (disclosed precisely, to avoid overclaiming precision)

1. Enumerate every `.ts` file under `src/` (excluding `.test.ts`).
2. For each, check whether ANY `.test.ts` file imports it directly, OR
   whether it's imported by a SOURCE file that IS directly tested
   (indirect/transitive coverage — common for internal helper
   modules).
3. Files with NEITHER direct nor transitive test exposure are flagged
   as genuinely untested.

**This is not line/branch coverage** — a file being "referenced by a
test" does not mean every line in it executes. This report answers a
narrower, but still meaningful, question: which files have ZERO
test exposure of any kind.

## Headline Numbers

- **104** total source files under `src/` (excluding test files).
- **69** total test files under `tests/`.
- **101 of 104** source files have direct or transitive test exposure.
- **3 of 104** source files have ZERO test exposure — not referenced
  by any test file, and not imported by any OTHER source file that is
  itself tested.

## Files With Zero Test Exposure

| File | Lines | Notes |
|---|---|---|
| `src/compiler/diagnostics/reporter.ts` | 44 | Not imported by any file, test or source, anywhere in the repository. |
| `src/ffi/drivers/onnx/onnx-driver.ts` | 310 | Same — zero references anywhere. |
| `src/ffi/drivers/ros2/ros2-driver.ts` | 313 | Same — zero references anywhere. |

**667 total lines with zero confirmed test exposure.** Whether these
are dead code, work-in-progress scaffolding, or intentionally
speculative driver stubs was not determined this round — flagged as a
question for whoever owns FFI drivers/diagnostics, not classified
further without more context.

## Self-Correction During This Analysis (disclosed, not hidden)

The first pass of this analysis, using a simpler basename-matching
heuristic, incorrectly flagged 2 additional files as untested:
- `src/compiler/localization/zh.ts` — actually referenced by
  `src/compiler/localization/index.ts` AND 2 real test files
  (`tests/platform/architecture-rules.test.ts`,
  `tests/compiler/localization/multi-language.test.ts`). The
  basename `"zh"` was too short/ambiguous for the original heuristic.
- `src/lsp/incremental-bridge.ts` — actually referenced by
  `src/lsp/lsp-server.ts` and `tests/lsp/lsp.test.ts`.

Both corrected before this report was finalized, by directly grepping
for real references rather than trusting the first pass's own output.

## Files With Indirect (Transitive) Coverage Only — Worth Naming, Not a Gap

These 4 WASM Backend helper modules are not directly imported by any
`.test.ts` file, but ARE imported by `src/backend/wasm/emit-wasm.ts`,
which itself has 191 passing tests exercising it extensively — their
own logic is exercised as a direct consequence:
- `src/backend/wasm/array-memory.ts`
- `src/backend/wasm/call-graph.ts`
- `src/backend/wasm/leb128.ts`
- `src/backend/wasm/wasm-opcodes.ts`

Not flagged as a coverage gap — named here for transparency about the
method's own limits (transitive exposure is not the same guarantee as
a dedicated unit test, even though it's a real signal of exercise).

## Regression Tests for Recently-Closed Defects — Audit

| Defect | Regression Test Status |
|---|---|
| WASM SSA materialization bug (`issues/wasm-loop-local-let-affecting-outer-state.md`) | ✅ 3 tests in `tests/backend/wasm/emit-wasm.test.ts`'s "STAGE 4 FIX" block |
| `PE010` single-modifier case | ✅ tested (`tests/compiler/frontend/parser.test.ts`) |
| `PE010` STACKED-modifier case (`SIMULATED_AUDIT_REPORT.md` Finding 1) | — **N/A, correctly**: this defect is still OPEN, not fixed — no regression test expected until a fix exists. |

No gap found here: every CLOSED defect this project's own history
tracks has a corresponding regression test.

## Recommendation

1. Investigate the 3 zero-exposure files (`reporter.ts`,
   `onnx-driver.ts`, `ros2-driver.ts`) — either add tests if they're
   live code paths, or document them as intentionally-unused
   scaffolding if not.
2. If a genuine coverage percentage is required going forward, install
   `@vitest/coverage-v8` in a network-connected environment (this
   environment's own npm-registry limitation, documented extensively
   elsewhere, blocks this from here) and re-run this analysis with
   real line/branch numbers rather than this file-reference proxy.
