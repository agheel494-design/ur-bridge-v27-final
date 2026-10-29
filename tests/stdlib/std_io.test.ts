import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";

// UR Standard Library v1.0 Foundation Sprint — std.io
// Minimal scope: write, writeLine, readLine. Thin wrappers around the
// existing print/input builtins — no new compiler capability used.

const libSrc = readFileSync(new URL("../../stdlib/std_io.ur", import.meta.url), "utf-8");

async function compileAndRunC(mainBody: string): Promise<{ ok: boolean; exitCode?: number; diag?: string }> {
  const src = libSrc + `\nfunction main(): int\n${mainBody}\nend\n`;
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) return { ok: false, diag: `parse: ${JSON.stringify(errors)}` };
  const tc = typeCheck(program);
  const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErr.length) return { ok: false, diag: `typecheck: ${JSON.stringify(tcErr)}` };
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) return { ok: false, diag: `lower: ${JSON.stringify(ir.diagnostics)}` };
  const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
  if (!compiled.ok) return { ok: false, diag: "C compile failed" };
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return { ok: true, exitCode: r.exitCode };
}

describe("std.io (UR Standard Library v1.0 Foundation Sprint) — C Backend", () => {
  it("write(s) compiles and runs without error", async () => {
    const r = await compileAndRunC('  write("hello")\n  return 0');
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("writeLine(s) compiles and runs without error (uses two print() calls, not concatenation)", async () => {
    const r = await compileAndRunC('  writeLine("hello")\n  return 0');
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("readLine() compiles and runs without error (delegates to input() — see API Freeze Check note in docs: PROVISIONAL)", async () => {
    const r = await compileAndRunC("  let s = readLine()\n  return 0");
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("string concatenation (s + \"\\n\") is confirmed NOT to work — the reason writeLine uses two print() calls instead", async () => {
    const src = 'function main(): int\n  let s: string = "a" + "\\n"\n  return 0\nend\n';
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (ir.ok) {
      const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
      expect(compiled.ok).toBe(false); // confirms the documented reason writeLine is implemented the way it is
    }
  });
});

describe("std.io — WASM Backend correctly rejects (documented limitation, same as std.math)", () => {
  it("write/writeLine calls are rejected on WASM (no function-arguments support yet)", () => {
    const src = libSrc + '\nfunction main(): int\n  write("hi")\n  return 0\nend\n';
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true); // reaches IR fine
    if (ir.ok) {
      let rejected = false;
      try { emitWasmModule(ir.value); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
  });
});
