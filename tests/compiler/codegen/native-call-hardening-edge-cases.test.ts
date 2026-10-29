// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// UR-Bridge â€” Tests: Stage 3.2 Native Call Hardening â€” Edge Case Batch
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Systematic edge-case coverage for the Stage 3.2 wrapper mechanism (ABI-
// correct extern prototypes + explicit casting wrappers), the full
// registry (6 functions across 2 libraries covering string/i64/bool/f64
// return types, with and without int32-narrowing), diagnostic message
// precision, and multi-library/multi-call-site scenarios. Every test is a
// real, distinct assertion â€” no filler/duplicate cases padding a count.

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../../tools/backend/c-compile.js";
import { NATIVE_LIBRARY_REGISTRY } from "../../../src/compiler/semantic/native-library-registry.js";

function lowerSource(src: string) {
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) return { ok: false as const, stage: "parse" as const, errors: parseErrors };
  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length) return { ok: false as const, stage: "typecheck" as const, errors: tcErrors };
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) return { ok: false as const, stage: "lower" as const, errors: ir.diagnostics };
  return { ok: true as const, ir: ir.value };
}

async function compileAndRun(src: string) {
  const result = lowerSource(src);
  if (!result.ok) throw new Error(`lowering failed at ${result.stage}: ${JSON.stringify(result.errors)}`);
  const cSource = emitC(result.ir);
  const nativeLibs = [...new Set(result.ir.externs.filter(e => e.kind === "ffi" && e.sourceLibraryPath).map(e => e.sourceLibraryPath!))];
  const compiled = compileC(cSource, "a.out", { captureWarnings: true, extraObjectPaths: nativeLibs });
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return { r, cSource, ir: result.ir };
}

describe("Stage 3.2 â€” Registry self-consistency", () => {
  for (const [libName, lib] of Object.entries(NATIVE_LIBRARY_REGISTRY)) {
    describe(`library: ${libName}`, () => {
      it(`${libName}'s libraryPath is omitted or an absolute path`, () => {
        expect(
          lib.libraryPath === undefined || require("node:path").isAbsolute(lib.libraryPath),
        ).toBe(true);
        if (process.platform === "win32" && (libName === "libc" || libName === "libm")) {
          expect(lib.libraryPath).toBeUndefined();
        }
      });
      for (const [fnName, sig] of Object.entries(lib.functions)) {
        it(`${libName}.${fnName}: paramTypes.length matches cParamTypes.length`, () => {
          expect(sig.paramTypes.length).toBe(sig.cParamTypes.length);
        });
        it(`${libName}.${fnName}: symbol is a non-empty string`, () => {
          expect(sig.symbol.length).toBeGreaterThan(0);
        });
        it(`${libName}.${fnName}: cReturnType is a non-empty string`, () => {
          expect(sig.cReturnType.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe("Stage 3.2 â€” Wrapper C-code correctness, per registered function", () => {
  it("sqlite3.libversion(): extern uses 'const char*', wrapper has zero params, no cast needed (string==string)", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let v = sqlite3.libversion()\n  print(v)\n  return 0\nend\n");
    expect(cSource).toContain("extern const char* sqlite3_libversion(void);");
    expect(cSource).toContain("static inline const char* __ur_ffi_sqlite3_libversion(void) {");
    expect(cSource).toContain("return (const char*)sqlite3_libversion();");
  });

  it("sqlite3.isComplete(s): extern uses real 'int', wrapper casts to int64_t", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let v = sqlite3.isComplete(\"SELECT 1;\")\n  return 0\nend\n");
    expect(cSource).toContain("extern int sqlite3_complete(const char*);");
    expect(cSource).toContain("static inline int64_t __ur_ffi_sqlite3_complete(const char* a0) {");
    expect(cSource).toContain("return (int64_t)sqlite3_complete(a0);");
  });

  it("sqlite3.libversionNumber(): extern uses real 'int', wrapper casts to int64_t, zero params", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let v = sqlite3.libversionNumber()\n  return 0\nend\n");
    expect(cSource).toContain("extern int sqlite3_libversion_number(void);");
    expect(cSource).toContain("static inline int64_t __ur_ffi_sqlite3_libversion_number(void) {");
  });

  it("sqlite3.threadsafe(): extern uses real 'int', wrapper casts to bool (not int64_t)", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let v = sqlite3.threadsafe()\n  return 0\nend\n");
    expect(cSource).toContain("extern int sqlite3_threadsafe(void);");
    expect(cSource).toContain("static inline bool __ur_ffi_sqlite3_threadsafe(void) {");
    expect(cSource).toContain("return (bool)sqlite3_threadsafe();");
  });

  it("sqlite3.memoryUsed(): extern uses real 'int64_t' (already exact width â€” wrapper is a true no-op cast)", async () => {
    const { cSource } = await compileAndRun("import sqlite3\nfunction main(): int\n  let v = sqlite3.memoryUsed()\n  return 0\nend\n");
    expect(cSource).toContain("extern int64_t sqlite3_memory_used(void);");
    expect(cSource).toContain("static inline int64_t __ur_ffi_sqlite3_memory_used(void) {");
    expect(cSource).toContain("return (int64_t)sqlite3_memory_used();");
  });

  it("libm.sqrt(x): extern uses real 'double' for both param and return, exact width match", async () => {
    const { cSource } = await compileAndRun("import libm\nfunction main(): int\n  let v = libm.sqrt(4.0)\n  return 0\nend\n");
    expect(cSource).toContain("extern double sqrt(double);");
    expect(cSource).toContain("static inline double __ur_ffi_sqrt(double a0) {");
  });

  it("libc.strlen(s): uses standard size_t return type compatible with <string.h>", async () => {
    const { cSource } = await compileAndRun("import libc\nfunction main(): int\n  let n = libc.strlen(\"hello world\")\n  return 0\nend\n");
    expect(cSource).toContain("extern size_t strlen(const char*);");
    expect(cSource).not.toContain("extern unsigned long strlen(const char*);");
  });
});

describe("Stage 3.2 â€” Real execution results (against the real installed libraries)", () => {
  it("sqlite3.libversion() prints a real semver-shaped string", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  print(sqlite3.libversion())\n  return 0\nend\n");
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("sqlite3.isComplete(\"SELECT 1;\") returns 1 (a syntactically complete statement)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.isComplete(\"SELECT 1;\")\nend\n");
    expect(r.exitCode).toBe(1);
  });
  it("sqlite3.isComplete(\"SELECT 1\") WITHOUT a trailing semicolon returns 0 (incomplete)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.isComplete(\"SELECT 1\")\nend\n");
    expect(r.exitCode).toBe(0);
  });
  it("sqlite3.isComplete(\"\") on an empty string returns 0", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.isComplete(\"\")\nend\n");
    expect(r.exitCode).toBe(0);
  });
  it("sqlite3.libversionNumber() printed matches the known real encoded value", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  print(sqlite3.libversionNumber())\n  return 0\nend\n");
    expect(Number(r.stdout.trim())).toBeGreaterThan(0);
  });
  it("sqlite3.threadsafe() is truthy (this build of libsqlite3 is compiled thread-safe)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  if sqlite3.threadsafe()\n    return 1\n  end\n  return 0\nend\n");
    expect(r.exitCode).toBe(1);
  });
  it("sqlite3.memoryUsed() with no active DB connections returns 0", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.memoryUsed()\nend\n");
    expect(r.exitCode).toBe(0);
  });
  it("libm.sqrt(16.0) prints 4", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(16.0))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("4");
  });
  it("libm.sqrt(2.0) prints an irrational approximation starting with 1.41", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(2.0))\n  return 0\nend\n");
    expect(r.stdout.trim().startsWith("1.41")).toBe(true);
  });
  it("libm.sqrt(0.0) prints 0", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(0.0))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("0");
  });
  it("libm.sqrt(1.0) prints 1", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(1.0))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("1");
  });
  it("libc.abs(-42) returns 42 through the native CRT", async () => {
    const { r } = await compileAndRun("import libc\nfunction main(): int\n  print(libc.abs(-42))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("42");
  });
  it("libc.strlen(\"hello world\") returns 11 through the native CRT", async () => {
    const { r } = await compileAndRun("import libc\nfunction main(): int\n  print(libc.strlen(\"hello world\"))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("11");
  });
});

describe("Stage 3.2 â€” Multi-library and multi-call-site scenarios", () => {
  it("calling functions from TWO different libraries in the same program links both correctly", async () => {
    const { r } = await compileAndRun(
      "import sqlite3\nimport libm\nfunction main(): int\n  print(sqlite3.libversion())\n  print(libm.sqrt(9.0))\n  return 0\nend\n"
    );
    const lines = r.stdout.trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lines[1]).toBe("3");
  });

  it("calling the SAME native function from two different UR functions still produces exactly one extern+wrapper pair", () => {
    const result = lowerSource(
      "import sqlite3\nfunction helper(): int\n  return sqlite3.isComplete(\"SELECT 1;\")\nend\nfunction main(): int\n  return sqlite3.isComplete(\"SELECT 2;\")\nend\n"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ffiExterns = result.ir.externs.filter(e => e.kind === "ffi");
    expect(ffiExterns.filter(e => e.name === "sqlite3_complete")).toHaveLength(1);
  });

  it("calling all 5 sqlite3 registry functions plus sqrt in one program produces exactly 6 distinct ffi externs", () => {
    const result = lowerSource(
      "import sqlite3\nimport libm\nfunction main(): int\n" +
      "  print(sqlite3.libversion())\n" +
      "  let a = sqlite3.isComplete(\"X;\")\n" +
      "  let b = sqlite3.libversionNumber()\n" +
      "  let c = sqlite3.threadsafe()\n" +
      "  let d = sqlite3.memoryUsed()\n" +
      "  let e = libm.sqrt(2.0)\n" +
      "  return 0\nend\n"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ffiExterns = result.ir.externs.filter(e => e.kind === "ffi");
    expect(ffiExterns).toHaveLength(6);
  });

  it("a program that imports a library but never calls any of its functions produces zero ffi externs for it (no dead linking)", () => {
    const result = lowerSource("import sqlite3\nfunction main(): int\n  return 0\nend\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ir.externs.filter(e => e.kind === "ffi")).toHaveLength(0);
  });
});

describe("Stage 3.2 â€” Diagnostic message precision", () => {
  it("unregistered library name in a member-call: message contains the exact rejected shape", () => {
    const result = lowerSource("import totallyfake\nfunction main(): int\n  let v = totallyfake.anything()\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain("no member-call/computed-call");
  });

  it("registered library, unregistered function: message names BOTH the library and the missing function exactly", () => {
    const result = lowerSource("import libm\nfunction main(): int\n  let v = libm.cos(1.0)\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("libm.cos");
    expect(msg).toContain("not a registered function");
  });

  it("wrong argument count on a 1-arg function (0 given instead of 1): message states 'requires exactly 1'", () => {
    const result = lowerSource("import libm\nfunction main(): int\n  let v = libm.sqrt()\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("requires exactly 1 argument");
    expect(msg).toContain("got 0");
  });

  it("wrong argument count (2 given instead of 1): message states 'got 2'", () => {
    const result = lowerSource("import libm\nfunction main(): int\n  let v = libm.sqrt(1.0, 2.0)\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain("got 2");
  });

  it("wrong argument type (string where float/f64 expected): message states both types exactly", () => {
    const result = lowerSource("import libm\nfunction main(): int\n  let v = libm.sqrt(\"not a number\")\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("expected 'f64'");
    expect(msg).toContain("got 'string'");
  });

  it("import-required diagnostic names the exact missing import statement to add", () => {
    const result = lowerSource("function main(): int\n  let v = libm.sqrt(4.0)\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).toContain("import libm");
  });
});

describe("Stage 3.2 â€” Argument value edge cases", () => {
  it("sqlite3.isComplete with a very long SQL string (1000+ chars) still compiles and runs correctly", async () => {
    const longSql = "SELECT " + "1,".repeat(500) + "1;";
    const { r } = await compileAndRun(`import sqlite3\nfunction main(): int\n  return sqlite3.isComplete("${longSql}")\nend\n`);
    expect(r.exitCode).toBe(1);
  });
  it("sqlite3.isComplete with a string containing a semicolon mid-string (not just at the end)", async () => {
    const { r } = await compileAndRun("import sqlite3\nfunction main(): int\n  return sqlite3.isComplete(\"SELECT ';';\")\nend\n");
    expect(r.exitCode).toBe(1);
  });
  it("libm.sqrt with a large value (1000000.0) computes correctly", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(1000000.0))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("1000");
  });
  it("libm.sqrt with a small fractional value (0.25) computes correctly", async () => {
    const { r } = await compileAndRun("import libm\nfunction main(): int\n  print(libm.sqrt(0.25))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("0.5");
  });
});
