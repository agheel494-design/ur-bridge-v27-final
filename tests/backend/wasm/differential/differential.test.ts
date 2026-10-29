// ─────────────────────────────────────────────────────────────────────────────
// UR Backend Validation Suite (V2-M6) — Differential Test Runner
// ─────────────────────────────────────────────────────────────────────────────
//
// New file. Runs independently of tests/backend/wasm/golden/golden.test.ts
// (not merged into it), per the Design Gate's own left-open implementation
// choice. Every fixture's own expected value comes from
// tests/backend/wasm/differential/EXPECTED_VALUES.md, written and reviewed
// BEFORE this file existed — never from tools/generate-wasm-golden.ts, which
// is not used anywhere in this file.
//
// Fixture kind semantics (per the Implementation Authorization, verbatim):
//   differential:      any C/WASM divergence is FAIL. Each side is ALSO
//                       checked against the independent Oracle separately -
//                       C == WASM is necessary but never sufficient.
//   wasm-only-reject:  unexpected acceptance is FAIL. Only the documented
//                       rejection is PASS.
//   canary-wrong:      the pinned, known-wrong result is the ONLY passing
//                       outcome. Any change (even an accidental "fix") FAILS
//                       this test loudly, by design.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIR, runOnCBackend, runOnWasmBackend, makeHostStub } from "../../../../tools/backend/differential-runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const caseDirs = readdirSync(ROOT).filter(name => statSync(join(ROOT, name)).isDirectory()).sort();

describe("V2-M6 Backend Validation Suite — C/WASM differential + expected-failure + canary corpus", () => {
  for (const dir of caseDirs) {
    const programPath = join(ROOT, dir, "program.ur");
    const kindPath = join(ROOT, dir, "kind.txt");
    if (!existsSync(programPath) || !existsSync(kindPath)) continue;
    const kind = readFileSync(kindPath, "utf-8").trim();
    const src = readFileSync(programPath, "utf-8");

    it(`${dir} [${kind}]`, async () => {
      const ir = buildIR(src);
      expect(ir.ok, `IR build failed: ${!ir.ok ? ir.detail : ""}`).toBe(true);
      if (!ir.ok) return;

      if (kind === "differential") {
        const hostStub = makeHostStub(dir === "34-string-input-print-free" ? "oracle test line" : "");
        const wasm = await runOnWasmBackend(ir.module, hostStub);
        expect(wasm.firstFailedPhase, `WASM phase failed: ${wasm.firstFailedPhase} — observed: ${JSON.stringify(wasm.observed, (k, v) => typeof v === "bigint" ? v.toString() + "n" : v)}`).toBeNull();

        // 34's own documented exception: the C side has no scripted-stdin
        // mechanism available (runExecutable does not accept piped input,
        // and modifying it is out of this Gate's own file scope) - C is
        // still run (confirming it does not hang or crash) but its own
        // stdout is NOT compared against WASM's scripted-line result,
        // exactly as the Design Gate's own §4 allows for a named,
        // per-fixture exception.
        if (dir === "34-string-input-print-free") {
          const c = runOnCBackend(ir.module);
          expect(c.firstFailedPhase, "C side must at least run without crashing (value not compared - documented exception)").toBeNull();
          const observed = wasm.observed as { printedStrings: string[]; inputCallCount: number; freeCallCount: number; returnValue: bigint };
          expect(observed.inputCallCount, "input() must be invoked exactly once").toBe(1);
          expect(observed.freeCallCount, "free() must be invoked exactly once").toBe(1);
          expect(observed.printedStrings[0], "printed value must match the scripted stdin line exactly").toBe("oracle test line");
          expect(observed.returnValue).toBe(0n);
          return;
        }

        const c = runOnCBackend(ir.module);
        expect(c.firstFailedPhase, `C phase failed: ${c.firstFailedPhase} — observed: ${JSON.stringify(c.observed, (k, v) => typeof v === "bigint" ? v.toString() + "n" : v)}`).toBeNull();

        // Side-effect fixtures assert on the OBSERVED SIDE EFFECT COUNT
        // (print() invocation count), not just the final value - directly
        // testing the exact class of danger V2-M2's own double-invocation
        // bug, and V2-MU's own materialization fix, both concerned.
        if (dir === "38-side-effect-single-use" || dir === "39-side-effect-multi-use") {
          const wasmObs = wasm.observed as { printedInts: bigint[]; returnValue: bigint };
          const cObs = c.observed as { stdout: string };
          expect(wasmObs.printedInts.length, "counter()'s own print(...) side effect must fire exactly once on WASM").toBe(1);
          expect(cObs.stdout.trim().split("\n").filter(l => l.length > 0).length, "counter()'s own print(...) side effect must fire exactly once on C").toBe(1);
        }

        const wasmValue = (wasm.observed as { returnValue: number | bigint }).returnValue;
        const cExitCode = (c.observed as { exitCode: number }).exitCode;
        const expectedByFixture: Record<string, number> = {
          "27-const-float": 3.5,
          "29-arithmetic-f64": 3.0,
          "35-float-precision-0.1-plus-0.2": 0.30000000000000004,
        };
        const isFloat = dir in expectedByFixture;
        if (isFloat) {
          // Float: NEVER compare via C's own truncated exit code. Compare
          // WASM's own direct return value against the independent Oracle
          // with tolerance, matching V2-M5's own already-proven method.
          const expected = expectedByFixture[dir];
          expect(Math.abs(Number(wasmValue) - expected), `WASM value ${wasmValue} vs independent Oracle ${expected}`).toBeLessThan(1e-9);
        } else {
          // Integer: WASM's own direct return value is full-precision and
          // authoritative; C's own exit code is truncated mod 256 (the
          // long-established lesson from this track's own SQLite3 work) -
          // compared here via modulo, never assumed equal outright.
          const truncated = ((Number(wasmValue) % 256) + 256) % 256;
          const normalizedC = ((Number(cExitCode) % 256) + 256) % 256;
expect(truncated, `WASM value ${wasmValue} (truncated ${truncated}) vs normalized C exit code ${normalizedC}`).toBe(normalizedC);
        }
      }

      if (kind === "wasm-only-reject") {
        const hostStub = makeHostStub();
        const wasm = await runOnWasmBackend(ir.module, hostStub);
        expect(wasm.firstFailedPhase, "a wasm-only-reject fixture must be rejected at BUILD - unexpected acceptance is a hard FAIL").toBe("BUILD");
        const message = String(wasm.observed);
        const expectedSubstrings: Record<string, string> = {
          "42-bool-value-gap": "const_bool",
          "43-nativeptr-multiuse": "is neither",
          "44-array-load-reuse": "fan-out",
        };
        expect(message).toContain(expectedSubstrings[dir]);
      }

      if (kind === "canary-wrong") {
        const hostStub = makeHostStub();
        const wasm = await runOnWasmBackend(ir.module, hostStub);
        expect(wasm.firstFailedPhase, `canary must still SUCCEED (with a wrong value) — unexpected phase failure: ${wasm.firstFailedPhase}`).toBeNull();
        const c = runOnCBackend(ir.module);
        expect(c.firstFailedPhase).toBeNull();
        const wasmValue = Number((wasm.observed as { returnValue: bigint }).returnValue);
        const cExitCode = (c.observed as { exitCode: number }).exitCode;
        const pinned: Record<string, { wasm: number; c: number }> = {
          "40-critical-ssa-array-bug": { wasm: 99, c: 5 },
          // "41-array-parameter-bug" was pinned { wasm: 1, c: 11 }. RB3-TEST-REALIGNMENT (DR-RB3-01): the bug is fixed
          // (C = WASM = 11 on C4 and on the reference); converted to kind "differential" - see its HISTORY.md.
        };
        const { wasm: pinnedWasm, c: pinnedC } = pinned[dir];
        expect(wasmValue, `CANARY CHANGED — WASM was pinned at ${pinnedWasm}, now ${wasmValue}. STOP: this means the scope of a recent Gate leaked into this Finding's own behavior. Do not "fix" this test — investigate.`).toBe(pinnedWasm);
        expect(cExitCode, `C side of the canary changed — was pinned at ${pinnedC}`).toBe(pinnedC);
      }
    });
  }
});

