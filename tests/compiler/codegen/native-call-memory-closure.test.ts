// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 4.2 Memory Management Closure
// ─────────────────────────────────────────────────────────────────────────────
//
// Closes the remaining memory-management gaps identified by explicit
// review: handle reuse (a REAL bug found and fixed during this exact
// testing — see mem_lib.c's own header comment on ur_mem_alloc), invalid
// allocation sizes (negative/zero/unreasonably large), and stress testing
// (thousands of cycles). Windows/macOS validation is explicitly NOT
// covered here — disclosed as genuinely unachievable from this Linux
// sandbox, not silently skipped.

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

const OK = 0, INVALID_SIZE = 5;

describe("Stage 4.2 Closure — Handle reuse (REAL BUG found and fixed during this exact testing)", () => {
  it("freeing an allocation, then allocating again (often the SAME address via malloc reuse), correctly treats the new allocation as live, not a false use-after-free", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let p1 = mem.alloc(8)\n" +
      "  mem.free(p1)\n" +
      "  let p2 = mem.alloc(8)\n" +
      "  mem.writeI64(p2, 777)\n" +
      "  print(mem.readI64(p2))\n" +
      "  print(mem.lastError())\n" +
      "  mem.free(p2)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`777\n${OK}`);
  });

  it("stress: 5000 alloc/write/read/free cycles of the same size (near-guaranteed address reuse across the run) — every cycle correct, zero false-positive errors", async () => {
    const r = await runUr(
      "import mem\nfunction main(): int\n" +
      "  let i = 0\n  let allOk = 1\n" +
      "  while i < 5000\n" +
      "    let p = mem.alloc(8)\n" +
      "    mem.writeI64(p, i)\n" +
      "    let v = mem.readI64(p)\n" +
      "    if v != i\n      allOk = 0\n    end\n" +
      "    if mem.lastError() != 0\n      allOk = 0\n    end\n" +
      "    mem.free(p)\n" +
      "    i = i + 1\n" +
      "  end\n" +
      "  print(allOk)\n  return 0\nend\n"
    );
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe("1");
  });
});

describe("Stage 4.2 Closure — Invalid allocation size rejection", () => {
  it("a negative size is rejected (error code 5), not passed through to malloc as a huge unsigned value", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(0 - 5)\n  print(p)\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`0\n${INVALID_SIZE}`);
  });
  it("a zero size is rejected (error code 5)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(0)\n  print(p)\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`0\n${INVALID_SIZE}`);
  });
  it("an unreasonably large size (10 GiB, beyond the library's own sane cap) is rejected (error code 5), not attempted", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(10737418240)\n  print(p)\n  print(mem.lastError())\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(`0\n${INVALID_SIZE}`);
  });
  it("a normal, reasonable size still works correctly (sanity — the size cap doesn't over-reject)", async () => {
    const r = await runUr("import mem\nfunction main(): int\n  let p = mem.alloc(64)\n  print(mem.lastError())\n  mem.free(p)\n  return 0\nend\n");
    expect(r.stdout.trim().replace(/\r\n/g, "\n")).toBe(String(OK));
  });
});
