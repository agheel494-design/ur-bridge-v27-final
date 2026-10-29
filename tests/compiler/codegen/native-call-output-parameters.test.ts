// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 3.3 Output Parameter Support (sqlite3.open/close)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../../tools/backend/c-compile.js";

async function compileAndRun(src: string) {
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
  return { r, cSource, ir: ir.value };
}

describe("Stage 3.3 — Output parameter support: sqlite3.open/close, real execution end-to-end", () => {
  it("sqlite3.open(':memory:') returns a real, non-zero handle", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  print(db)\n  return 0\nend\n");
    const handle = Number(r.stdout.trim().replace(/\r\n/g, "\n"));
    expect(handle).toBeGreaterThan(0);
  });

  it("sqlite3.close(db) on a handle sqlite3.open() returned succeeds (rc=0)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  return sqlite3.close(db)\nend\n");
    expect(r.exitCode).toBe(0);
  });

  it("open+close round-trip works for a real on-disk-style path too (:memory: is not special-cased)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\"file::memory:?cache=shared\")\n  return sqlite3.close(db)\nend\n");
    expect(r.exitCode).toBe(0);
  });

  it("two separate open() calls in the same program produce two DIFFERENT handles, and both close successfully", async () => {
    const { r } = await compileAndRun(
      "import sqlite3\nfunction main(): int\n" +
      "  let db1 = sqlite3.open(\":memory:\")\n" +
      "  let db2 = sqlite3.open(\":memory:\")\n" +
      "  print(db1)\n  print(db2)\n" +
      "  let rc1 = sqlite3.close(db1)\n" +
      "  let rc2 = sqlite3.close(db2)\n" +
      "  return rc1 + rc2\nend\n"
    );
    const [h1, h2] = r.stdout.trim().replace(/\r\n/g, "\n").split("\n").map(Number);
    expect(h1).toBeGreaterThan(0);
    expect(h2).toBeGreaterThan(0);
    expect(h1).not.toBe(h2);
    expect(r.exitCode).toBe(0);
  });
});

describe("Stage 3.3 — Generated C code correctness for output parameters", () => {
  it("opaque struct 'sqlite3' is forward-declared exactly once, even though referenced by both open (outParam) and close (pointer arg)", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  return sqlite3.close(db)\nend\n");
    const matches = cSource.match(/typedef struct sqlite3 sqlite3;/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("the extern prototype for sqlite3_open includes BOTH real parameters (filename AND the out-pointer), matching the real C signature exactly", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  return 0\nend\n");
    expect(cSource).toContain("extern int sqlite3_open(const char*, sqlite3**);");
  });

  it("the wrapper for sqlite3_open declares a local sqlite3* variable, passes its address, and returns it (not the real function's own rc)", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  return 0\nend\n");
    expect(cSource).toContain("sqlite3* __ur_ffi_out = 0;");
    expect(cSource).toContain("sqlite3_open(a0, &__ur_ffi_out);");
    expect(cSource).toContain("return (int64_t)__ur_ffi_out;");
  });

  it("the wrapper for sqlite3_close casts its int64_t argument back to the real sqlite3* pointer type", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\":memory:\")\n  return sqlite3.close(db)\nend\n");
    expect(cSource).toContain("(sqlite3*)a0");
  });

  it("if only sqlite3.close is called with a hand-computed int (no open() in the program), the opaque struct is still declared correctly", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.close(0)\nend\n");
    expect(cSource).toContain("typedef struct sqlite3 sqlite3;");
    expect(cSource).toContain("extern int sqlite3_close(sqlite3*);");
  });
});

describe("Stage 3.3 — Output parameter diagnostics (UR-visible signature hides the out-param entirely)", () => {
  it("sqlite3.open() takes exactly ONE UR-visible argument, matching paramTypes (NOT the real 2-parameter C signature)", () => {
    const { tokens } = lex("import sqlite3\nfunction main(): int\n  let db = sqlite3.open()\n  return 0\nend\n");
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
    if (ir.ok) return;
    const msg = JSON.stringify(ir.diagnostics);
    expect(msg).toContain("requires exactly 1 argument");
    expect(msg).toContain("got 0");
  });

  it("sqlite3.open(a, b) with 2 arguments is correctly rejected — the out-param is NOT user-suppliable", () => {
    const { tokens } = lex("import sqlite3\nfunction main(): int\n  let db = sqlite3.open(\"a\", \"b\")\n  return 0\nend\n");
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
    if (ir.ok) return;
    expect(JSON.stringify(ir.diagnostics)).toContain("got 2");
  });
});
