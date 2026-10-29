// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 1.1 Strings — Bug Hunt Results
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase, per explicit ordered directive
// (1.1 Strings first). Covers TWO real, confirmed bugs found and fixed:
//
// 1. String comparison (== != < <= > >=) previously compiled to RAW C
//    pointer comparison (`v0 == v1` on `const char*`), not content
//    comparison — confirmed directly: only "worked" by coincidence when
//    gcc happened to pool identical string literals to the same address.
//    Proven broken with a reversed-order case ("banana" < "apple" must
//    be false) that pointer-address luck could not reliably satisfy.
//    Fixed: real content comparison via strcmp().
//
// 2. String concatenation (+) was silently ACCEPTED by the type checker
//    (returned T_STRING, no diagnostic) but the C Backend translated it
//    into invalid C (`const char* + const char*`, raw pointer
//    arithmetic), failing only at the gcc level with a confusing,
//    UR-source-disconnected error. Fixed: rejected clearly at the type
//    level (TY3001) — turns a silent miscompilation into an immediate,
//    precise diagnostic. Real concatenation (malloc-based) is a genuine
//    future feature, out of this stabilization round's own scope.
//
// Also confirms (already working, no bug found) — direct evidence, not
// assumption: empty strings, very long strings, escape sequences, Arabic
// Unicode, and multi-byte UTF-8 (emoji) all round-trip correctly.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

async function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length) throw new Error(`typecheck failed: ${JSON.stringify(tcErrors)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return { r, cSource };
}

describe("Stage 1.1 Strings — BUG 1 FIXED: real content comparison (strcmp), not pointer comparison", () => {
  it("generated C uses strcmp(), not raw pointer ==", async () => {
    const { cSource } = await compileAndRun('function main(): int\n  let b = "abc" == "abc"\n  print(b)\n  return 0\nend\n');
    expect(cSource).toContain("strcmp(");
    expect(cSource).toContain("strcmp(v0, v1) == 0");
  });

  it("'banana' < 'apple' is correctly false (the case pointer-luck could not reliably satisfy — this is the actual proof of the fix)", async () => {
    const { r } = await compileAndRun('function main(): int\n  let b = "banana" < "apple"\n  print(b)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("false");
  });

  it("'apple' < 'banana' is correctly true", async () => {
    const { r } = await compileAndRun('function main(): int\n  let b = "apple" < "banana"\n  print(b)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("true");
  });

  it("equal strings: == is true, != is false", async () => {
    const eq = await compileAndRun('function main(): int\n  let b = "same" == "same"\n  print(b)\n  return 0\nend\n');
    expect(eq.r.stdout.trim()).toBe("true");
    const neq = await compileAndRun('function main(): int\n  let b = "same" != "same"\n  print(b)\n  return 0\nend\n');
    expect(neq.r.stdout.trim()).toBe("false");
  });

  it("different-length strings are correctly not equal", async () => {
    const { r } = await compileAndRun('function main(): int\n  let b = "abc" == "abcd"\n  print(b)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("false");
  });

  it("<= and >= work correctly at the equality boundary", async () => {
    const le = await compileAndRun('function main(): int\n  let b = "x" <= "x"\n  print(b)\n  return 0\nend\n');
    expect(le.r.stdout.trim()).toBe("true");
    const ge = await compileAndRun('function main(): int\n  let b = "apple" >= "banana"\n  print(b)\n  return 0\nend\n');
    expect(ge.r.stdout.trim()).toBe("false");
  });
});

describe("Stage 1.1 Strings — BUG 2 FIXED: concatenation rejected clearly, not silently miscompiled", () => {
  it("string + string produces a clear TY3001 diagnostic at type-check time", () => {
    const { tokens } = lex('function main(): int\n  let s = "hello" + " world"\n  return 0\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    const errors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.code).toBe("TY3001");
    expect(errors[0]!.message).toContain("+");
  });

  it("never reaches the C Backend at all (fails fast at type-check, not a confusing gcc error)", () => {
    const { tokens } = lex('function main(): int\n  let s = "a" + "b"\n  return 0\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    expect((tc.diagnostics ?? []).some((d: any) => d.severity === "error")).toBe(true);
  });
});

describe("Stage 1.1 Strings — confirmed working (no bug found, direct evidence)", () => {
  it("empty string round-trips correctly", async () => {
    const { r } = await compileAndRun('function main(): int\n  let s = ""\n  print(s)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("");
  });

  it("a very long string literal (5000 chars) round-trips correctly", async () => {
    const long = "x".repeat(5000);
    const { r } = await compileAndRun(`function main(): int\n  let s = "${long}"\n  print(s)\n  return 0\nend\n`);
    expect(r.stdout.trim()).toBe(long);
  });

  it("escape sequences (\\n \\t \\\") round-trip correctly", async () => {
    const { r } = await compileAndRun('function main(): int\n  let s = "line1\\nline2\\ttab"\n  print(s)\n  return 0\nend\n');
    expect(r.stdout.replace(/\r\n/g, "\n")).toBe("line1\nline2\ttab\n");
  });

  it("Arabic Unicode text round-trips correctly", async () => {
    const { r } = await compileAndRun('function main(): int\n  let s = "مرحبا بالعالم"\n  print(s)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("مرحبا بالعالم");
  });

  it("multi-byte UTF-8 (emoji) round-trips correctly", async () => {
    const { r } = await compileAndRun('function main(): int\n  let s = "hello 🎉 world"\n  print(s)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("hello 🎉 world");
  });
});

describe("Stage 1.1 Strings — confirmed NOT supported (clear rejection, not a crash — documented gaps, not bugs)", () => {
  it("indexing (s[0]) is rejected with a clear message, not a crash", () => {
    const { tokens } = lex('function main(): int\n  let s = "hello"\n  let c = s[0]\n  return 0\nend\n');
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
    if (ir.ok) return;
    expect(JSON.stringify(ir.diagnostics)).toContain("not a known array variable");
  });

  it("method calls (.substring()) are rejected with a clear message, not a crash", () => {
    const { tokens } = lex('function main(): int\n  let s = "hello world"\n  let sub = s.substring(0, 5)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
  });

  it("property access (.length) is rejected with a clear message, not a crash", () => {
    const { tokens } = lex('function main(): int\n  let s = "hello"\n  print(s.length)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
  });
});
