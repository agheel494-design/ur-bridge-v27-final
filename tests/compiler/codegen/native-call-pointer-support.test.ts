// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 4.2 Pointer Support (read/write/arithmetic)
// ─────────────────────────────────────────────────────────────────────────────
//
// UR itself still has NO pointer type at the language level (unchanged,
// per the standing constraint — no Parser/Lexer/keyword changes). These
// tests prove UR programs can now allocate, read, write, and offset
// through an opaque i64 handle via registered native calls, against a
// real, compiled, purpose-built shared library
// (tests/fixtures/ffi-type-coverage/libmem.so).

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

describe("Stage 4.2 — Pointer allocation, read/write, arithmetic (real native memory ops)", () => {
  it("write then read back an i32 through an allocated buffer", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  mem.writeI32(p, 424242)\n  print(mem.readI32(p))\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("424242");
  });

  it("write then read back an i64 through an allocated buffer (value exceeding int32 range)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  mem.writeI64(p, 9876543210)\n  print(mem.readI64(p))\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("9876543210");
  });

  it("write then read back an f64 (double) through an allocated buffer", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  mem.writeF64(p, 3.14159)\n  print(mem.readF64(p))\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("3.14159");
  });

  it("write then read back a u8 through an allocated buffer", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(4)\n  mem.writeU8(p, 200)\n  print(mem.readU8(p))\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("200");
  });

  it("pointer arithmetic: offset(p, 8) then write/read at that offset independently of the base", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let p = mem.alloc(16)\n" +
      "  let p2 = mem.offset(p, 8)\n" +
      "  mem.writeI64(p2, 999888777)\n" +
      "  print(mem.readI64(p2))\n" +
      "  mem.free(p)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("999888777");
  });

  it("writing at an offset does not corrupt the base address's own separately-written value (proves distinct memory locations)", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let p = mem.alloc(16)\n" +
      "  let p2 = mem.offset(p, 8)\n" +
      "  mem.writeI32(p, 111)\n" +
      "  mem.writeI64(p2, 222)\n" +
      "  print(mem.readI32(p))\n" +
      "  print(mem.readI64(p2))\n" +
      "  mem.free(p)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("111\n222");
  });

  it("pointer-to-pointer: writePtr then readPtr round-trips the exact same handle", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let outer = mem.alloc(8)\n" +
      "  let inner = mem.alloc(4)\n" +
      "  mem.writePtr(outer, inner)\n" +
      "  let readBack = mem.readPtr(outer)\n" +
      "  if readBack == inner\n    print(1)\n  else\n    print(0)\n  end\n" +
      "  mem.free(inner)\n  mem.free(outer)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("1");
  });

  it("struct-like layout: two differently-typed fields at different offsets in ONE allocation, both correct independently", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let p = mem.alloc(16)\n" +
      "  let f0 = mem.offset(p, 0)\n" +
      "  let f1 = mem.offset(p, 8)\n" +
      "  mem.writeI64(f0, 111)\n" +
      "  mem.writeF64(f1, 2.5)\n" +
      "  print(mem.readI64(f0))\n" +
      "  print(mem.readF64(f1))\n" +
      "  mem.free(p)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("111\n2.5");
  });

  it("two separate allocations produce two distinct, non-overlapping pointers", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let p1 = mem.alloc(8)\n" +
      "  let p2 = mem.alloc(8)\n" +
      "  if p1 == p2\n    print(0)\n  else\n    print(1)\n  end\n" +
      "  mem.free(p1)\n  mem.free(p2)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("1");
  });
});

describe("Stage 4.2 — Generated C code correctness for non-pointer argument narrowing (writeI32/writeU8)", () => {
  it("mem.writeI32's wrapper casts its i64-typed value argument down to int32_t before calling", async () => {
    const { tokens } = lex("import mem\nfunction main(): int\n  let p = mem.alloc(4)\n  mem.writeI32(p, 1)\n  mem.free(p)\n  return 0\nend\n");
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const cSource = emitC(ir.value);
    expect(cSource).toContain("(int32_t)a1");
  });

  it("mem.writeU8's wrapper casts its i64-typed value argument down to uint8_t before calling", async () => {
    const { tokens } = lex("import mem\nfunction main(): int\n  let p = mem.alloc(4)\n  mem.writeU8(p, 1)\n  mem.free(p)\n  return 0\nend\n");
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const cSource = emitC(ir.value);
    expect(cSource).toContain("(uint8_t)a1");
  });
});
