// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 4.1 Full C Type Spectrum Coverage
// ─────────────────────────────────────────────────────────────────────────────
//
// Proves the wrapper mechanism (Stage 3.2/3.3) correctly handles EVERY C
// type Stage 4.1 requires — int8/16/32/64, uint8/16/32/64, float, double,
// bool, const char*, void* — against a real, compiled, purpose-built
// shared library (tests/fixtures/ffi-type-coverage/), not a mock. Every
// function is `x -> x+1` (or `!x`/identity) so the assertions are about
// the WRAPPER's own width/sign correctness crossing the FFI boundary, not
// about a real library's business logic.

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../../tools/backend/c-compile.js";

async function runUr(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const nativeLibs = [...new Set(ir.value.externs.filter(e => e.kind === "ffi" && e.sourceLibraryPath).map(e => e.sourceLibraryPath!))];
  const compiled = compileC(cSource, "a.out", { captureWarnings: true, extraObjectPaths: nativeLibs });
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r;
}

describe("Stage 4.1 — Full C type spectrum, real compiled+linked execution", () => {
  it("int8_t: testI8(5) == 6", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testI8(5))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("6");
  });
  it("int16_t: testI16(1000) == 1001", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testI16(1000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("1001");
  });
  it("int32_t: testI32(100000) == 100001", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testI32(100000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("100001");
  });
  it("int64_t: testI64(9000000000) == 9000000001 (beyond int32 range, proving no silent truncation)", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testI64(9000000000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("9000000001");
  });
  it("uint8_t: testU8(200) == 201", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testU8(200))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("201");
  });
  it("uint16_t: testU16(60000) == 60001", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testU16(60000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("60001");
  });
  it("uint32_t: testU32(4000000000) == 4000000001 (beyond int32 signed range)", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testU32(4000000000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("4000000001");
  });
  it("uint64_t: testU64(9000000000) == 9000000001", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testU64(9000000000))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("9000000001");
  });
  it("float: testFloat(3.5) == 4.5", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testFloat(3.5))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("4.5");
  });
  it("double: testDouble(3.5) == 4.5", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testDouble(3.5))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("4.5");
  });
  it("bool: testBool(false) == true", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  if typecov.testBool(false)\n    return 1\n  end\n  return 0\nend\n");
    expect(r.exitCode).toBe(1);
  });
  it("bool: testBool(true) == false", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  if typecov.testBool(true)\n    return 1\n  end\n  return 0\nend\n");
    expect(r.exitCode).toBe(0);
  });
  it("const char*: testCharPtr('hello') == 'hello' (identity, round-trips a real string pointer)", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testCharPtr(\"hello\"))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("hello");
  });
  it("void*: testVoidPtr(12345) == 12345 (identity, round-trips an opaque handle)", async () => {
    const r = await runUr("import typecov\nfunction main(): int\n  print(typecov.testVoidPtr(12345))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("12345");
  });
});
