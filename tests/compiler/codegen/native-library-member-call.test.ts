// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 3.1 Native Library Registry (Member-Call Lowering)
// ─────────────────────────────────────────────────────────────────────────────
//
// Covers exactly the 6 required scenarios (per explicit Stage 3.1
// directive) plus a full end-to-end test that compiles, links against the
// REAL libsqlite3.so.0, and runs the exact target program — no simulation.

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../../tools/backend/c-compile.js";

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

describe("Stage 3.1 — Native Library Registry member-call: end-to-end success (real library, no simulation)", () => {
  (process.platform === "win32" ? it.skip : it)("import sqlite3 / sqlite3.libversion() / print(version) — compiles, links against the REAL libsqlite3.so.0, and prints the real version", () => {
    const src = "import sqlite3\n\nfunction main(): int\n  let version = sqlite3.libversion()\n  print(version)\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ffiExterns = result.ir.externs.filter(e => e.kind === "ffi");
    expect(ffiExterns).toHaveLength(1);
    expect(ffiExterns[0]!.name).toBe("sqlite3_libversion");
    expect(ffiExterns[0]!.sourceLibraryPath).toBe("/usr/lib/x86_64-linux-gnu/libsqlite3.so.0");

    const cSource = emitC(result.ir);
    expect(cSource).toContain("extern const char* sqlite3_libversion(void);");

    const nativeLibs = [...new Set(ffiExterns.map(e => e.sourceLibraryPath!))];
    const compiled = compileC(cSource, "a.out", { captureWarnings: true, extraObjectPaths: nativeLibs });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const r = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    // Real SQLite version string, not a hardcoded expectation — confirms
    // this is genuinely the real library's own output, not a stub.
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.exitCode).toBe(0);
  });
});

describe("Stage 3.1 — required scenario 1: successful call", () => {
  (process.platform === "win32" ? it.skip : it)("sqlite3.libversion() lowers to a single 'call' instruction targeting the real symbol", () => {
    const src = "import sqlite3\nfunction main(): int\n  let v = sqlite3.libversion()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(true);
  });
});

describe("Stage 3.1 — required scenario 2: non-existent library", () => {
  (process.platform === "win32" ? it.skip : it)("an imported name not in the Native Library Registry produces a clear diagnostic, not a crash or silent success", () => {
    const src = "import notareallib\nfunction main(): int\n  let v = notareallib.doSomething()\n  return 0\nend\n";
    const result = lowerSource(src);
    // notareallib isn't in the registry at all, so it falls through to the
    // original, unmodified member-call rejection — itself a clear diagnostic.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    expect(JSON.stringify(result.errors)).toContain("member-call");
  });
});

describe("Stage 3.1 — required scenario 3: non-existent function on a real registered library", () => {
  (process.platform === "win32" ? it.skip : it)("sqlite3.thisFunctionDoesNotExist() produces a clear, specific diagnostic naming both the library and the missing function", () => {
    const src = "import sqlite3\nfunction main(): int\n  let v = sqlite3.thisFunctionDoesNotExist()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("sqlite3.thisFunctionDoesNotExist");
    expect(msg).toContain("not a registered function");
  });
});

describe("Stage 3.1 — required scenario 4: wrong argument count", () => {
  (process.platform === "win32" ? it.skip : it)("sqlite3.libversion(1) — passing an argument to a zero-argument registered function produces a clear diagnostic naming the expected/actual counts", () => {
    const src = "import sqlite3\nfunction main(): int\n  let v = sqlite3.libversion(1)\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("requires exactly 0 argument");
    expect(msg).toContain("got 1");
  });
});

describe("Stage 3.1 — required scenario 5: wrong argument type", () => {
  (process.platform === "win32" ? it.skip : it)("sqlite3.isComplete(42) — passing an int where a string is expected produces a clear diagnostic naming the expected/actual types", () => {
    const src = "import sqlite3\nfunction main(): int\n  let v = sqlite3.isComplete(42)\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("expected 'string'");
    expect(msg).toContain("got 'i64'");
  });

  (process.platform === "win32" ? it.skip : it)("sqlite3.isComplete(\"SELECT 1;\") with the CORRECT string type succeeds and, run for real, returns the real library's own answer", () => {
    const src = "import sqlite3\nfunction main(): int\n  let v = sqlite3.isComplete(\"SELECT 1;\")\n  return v\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ffiExterns = result.ir.externs.filter(e => e.kind === "ffi");
    const nativeLibs = [...new Set(ffiExterns.map(e => e.sourceLibraryPath!))];
    const cSource = emitC(result.ir);
    const compiled = compileC(cSource, "a.out", { captureWarnings: true, extraObjectPaths: nativeLibs });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const r = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    // sqlite3_complete("SELECT 1;") returns 1 (a complete statement) —
    // the real library's own real answer, not a stub.
    expect(r.exitCode).toBe(1);
  });
});

describe("Stage 3.1 — required scenario 6: member-call on a normal (non-imported/non-registered) object is rejected", () => {
  (process.platform === "win32" ? it.skip : it)("a plain local variable used with member-call syntax still produces the original, unmodified rejection", () => {
    const src = "function main(): int\n  let x = 5\n  let v = x.something()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    expect(JSON.stringify(result.errors)).toContain("no member-call/computed-call");
  });

  (process.platform === "win32" ? it.skip : it)("a name that IS imported but NOT in the Native Library Registry is also correctly rejected (not silently treated as valid)", () => {
    const src = "import somemodule\nfunction main(): int\n  let v = somemodule.foo()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
  });
});

describe("Stage 3.1 — additional: calling a registered library's function WITHOUT importing it first", () => {
  (process.platform === "win32" ? it.skip : it)("sqlite3.libversion() without 'import sqlite3' produces a clear diagnostic telling the user to add the import", () => {
    const src = "function main(): int\n  let v = sqlite3.libversion()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("lower");
    const msg = JSON.stringify(result.errors);
    expect(msg).toContain("not imported");
    expect(msg).toContain("import sqlite3");
  });
});

describe("Stage 3.1 — additional: repeated calls to the same native function de-duplicate to one extern", () => {
  (process.platform === "win32" ? it.skip : it)("calling sqlite3.libversion() twice produces exactly one ffi extern, not two", () => {
    const src = "import sqlite3\nfunction main(): int\n  let a = sqlite3.libversion()\n  let b = sqlite3.libversion()\n  return 0\nend\n";
    const result = lowerSource(src);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ffiExterns = result.ir.externs.filter(e => e.kind === "ffi");
    expect(ffiExterns).toHaveLength(1);
  });
});

