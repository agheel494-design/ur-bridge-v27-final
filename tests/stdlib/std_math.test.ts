import { describe, it, expect } from "vitest";
import { runOnWasmBackend, makeHostStub } from "../../tools/backend/differential-runner.js";
import { readFileSync } from "fs";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";

// UR Standard Library v1.0 Foundation Sprint — std.math
// Per explicit small-scope instruction: 4 functions only (abs/min/max/clamp).
// Verified on the C Backend (works); the WASM Backend correctly and
// currently rejects every call here, since it does not yet support
// function calls with arguments (tracked as v1.1 scope,
// UR_LANGUAGE_VERSION_MATRIX.md) — asserted explicitly below, not
// silently skipped, so a future WASM fix is caught by this same test.

const libSrc = readFileSync(new URL("../../stdlib/std_math.ur", import.meta.url), "utf-8");

async function compileAndRunC(mainBody: string): Promise<number> {
  const src = libSrc + `\nfunction main(): int\n${mainBody}\nend\n`;
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse: ${JSON.stringify(errors)}`);
  const tc = typeCheck(program);
  const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErr.length) throw new Error(`typecheck: ${JSON.stringify(tcErr)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower: ${JSON.stringify(ir.diagnostics)}`);
  const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
  if (!compiled.ok) throw new Error(`C compile failed`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r.exitCode;
}

function wasmRejects(mainBody: string): boolean {
  const src = libSrc + `\nfunction main(): int\n${mainBody}\nend\n`;
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) return false; // shouldn't happen given the C-side check already passed
  try { emitWasmModule(ir.value); return false; }
  catch { return true; }
}

describe("std.math (UR Standard Library v1.0 Foundation Sprint) — C Backend", () => {
  it("abs(-5) == 5", async () => { expect(await compileAndRunC("  return abs(0 - 5)")).toBe(5); });
  it("abs(5) == 5", async () => { expect(await compileAndRunC("  return abs(5)")).toBe(5); });
  it("min(3, 7) == 3", async () => { expect(await compileAndRunC("  return min(3, 7)")).toBe(3); });
  it("max(3, 7) == 7", async () => { expect(await compileAndRunC("  return max(3, 7)")).toBe(7); });
  it("clamp(15, 0, 10) == 10 (above range)", async () => { expect(await compileAndRunC("  return clamp(15, 0, 10)")).toBe(10); });
  it("clamp(-5, 0, 10) == 0 (below range)", async () => { expect(await compileAndRunC("  return clamp(0 - 5, 0, 10)")).toBe(0); });
  it("clamp(5, 0, 10) == 5 (within range)", async () => { expect(await compileAndRunC("  return clamp(5, 0, 10)")).toBe(5); });
});

describe("std.math — WASM Backend correctly rejects (documented limitation, not silently skipped)", () => {
  // RB3-TEST-REALIGNMENT - DR-RB3-01 (Option A, APPROVED): WASM function arguments are part of the
  // ratified V1.0 WASM contract, so std.math calls are ACCEPTED and must equal the C backend.
  it("[DR-RB3-01] std.math calls are ACCEPTED on WASM and equal the C backend (formerly rejected: no function arguments)", async () => {
    for (const [body, expected] of [["  return abs(5)", 5], ["  return min(3, 7)", 3]] as const) {
      expect(wasmRejects(body)).toBe(false);
      const { tokens } = lex(libSrc + `\nfunction main(): int\n${body}\nend\n`);
      const ir = lowerToIR(parse(tokens).program, "t.ur", "t");
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;
      const wasm = await runOnWasmBackend(ir.value, makeHostStub());
      expect(wasm.firstFailedPhase).toBeNull();
      expect(Number((wasm.observed as { returnValue: number | bigint }).returnValue)).toBe(expected);
      expect(await compileAndRunC(body)).toBe(expected);
    }
  });
});
