// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 4.2 Memory Safety Layer
// ─────────────────────────────────────────────────────────────────────────────
//
// Closes the 4 safety gaps identified by explicit review before Stage 4.2
// could be considered complete: out-of-bounds detection, alignment
// correctness (32-bit and 64-bit), use-after-free/double-free detection,
// and documented (tested) pointer-arithmetic bounds behavior. Every test
// runs a real UR program against the hardened libmem.so (tracking table +
// validate_access(), see tests/fixtures/ffi-type-coverage/mem_lib.c) — no
// simulation, no mocking.

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

// Error code constants, matching mem_lib.c's own #defines exactly.
const OK = 0, OOB = 1, USE_AFTER_FREE = 2, UNKNOWN_PTR = 3, DOUBLE_FREE = 4;

describe("Stage 4.2 Safety — 1. Out-of-bounds detection", () => {
  it("writing an i64 (8 bytes) into a 4-byte buffer is detected as OOB, not silently corrupting adjacent memory", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(4)\n  mem.writeI64(p, 999)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OOB));
  });
  it("OOB is detected even when reached via pointer arithmetic (offset within the buffer, but the access WIDTH extends past the end)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  let p2 = mem.offset(p, 4)\n  mem.writeI64(p2, 999)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OOB));
  });
  it("a write exactly at the buffer's own boundary (fits exactly) is NOT flagged as OOB", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  mem.writeI64(p, 42)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OK));
  });
  it("OOB read (not just write) is also detected", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(2)\n  let v = mem.readI64(p)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OOB));
  });
});

describe("Stage 4.2 Safety — 2. Alignment correctness (32-bit and 64-bit)", () => {
  it("i64 (8-byte) read/write at an INTENTIONALLY UNALIGNED offset (1, not a multiple of 8) round-trips correctly", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  let p2 = mem.offset(p, 1)\n  mem.writeI64(p2, 123456789)\n  print(mem.readI64(p2))\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`123456789\n${OK}`);
  });
  it("i32 (4-byte) read/write at an INTENTIONALLY UNALIGNED offset (3, not a multiple of 4) round-trips correctly", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  let p2 = mem.offset(p, 3)\n  mem.writeI32(p2, 987654)\n  print(mem.readI32(p2))\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`987654\n${OK}`);
  });
  it("f64 (double, 8-byte) read/write at an unaligned offset (5) round-trips correctly", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(16)\n  let p2 = mem.offset(p, 5)\n  mem.writeF64(p2, 3.14159)\n  print(mem.readF64(p2))\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`3.14159\n${OK}`);
  });
  it("naturally-ALIGNED i64 access (offset 0 of a fresh allocation) also works correctly (baseline, not just the unaligned case)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  mem.writeI64(p, 111)\n  print(mem.readI64(p))\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("111");
  });
});

describe("Stage 4.2 Safety — 3. Use-after-free detection", () => {
  it("writing to a freed pointer is detected (error code 2), not silently corrupting freed/reused memory", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  mem.free(p)\n  mem.writeI32(p, 1)\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(USE_AFTER_FREE));
  });
  it("reading a freed pointer is detected AND returns a safe default (0), not garbage/crash", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  mem.writeI32(p, 555)\n  mem.free(p)\n  print(mem.readI32(p))\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`0\n${USE_AFTER_FREE}`);
  });
});

describe("Stage 4.2 Safety — 4. Double-free detection and pointer-arithmetic bounds documentation", () => {
  it("freeing an already-freed pointer is detected (error code 4), not a crash or silent no-op", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  mem.free(p)\n  mem.free(p)\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(DOUBLE_FREE));
  });
  it("computing an out-of-range address via offset() itself does NOT error (matches documented, deliberate C-pointer-arithmetic semantics — the violation is caught at the point of read/write, not at offset computation)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  let farOut = mem.offset(p, 100000)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OK));
  });
  it("dereferencing (read) an address computed via offset() that lands outside the buffer IS caught (the deferred check happens correctly)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(8)\n  let farOut = mem.offset(p, 100000)\n  let v = mem.readI32(farOut)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(UNKNOWN_PTR));
  });
});

describe("Stage 4.2 Safety — additional: unknown/untracked pointer detection", () => {
  it("using an arbitrary integer (never returned by mem.alloc) as a pointer is detected, not a crash", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  print(mem.readI32(999999))\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`0\n${UNKNOWN_PTR}`);
  });
});
