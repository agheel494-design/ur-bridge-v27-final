// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage Imports — Bug Hunt Results
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase. MAJOR ARCHITECTURAL FINDING
// (not a bug — an engineering report was written, no redesign started,
// per explicit review policy): TWO SEPARATE import systems exist:
//
// 1. The Native Library Registry mechanism (import sqlite3 + member-
//    calls) — the ONLY one actually wired into the real compiler
//    pipeline. Tested thoroughly below.
// 2. A general-purpose UR-to-UR module system (src/compiler/module/,
//    ImportResolver: relative/stdlib/package imports, circular-import
//    detection, topological build ordering) — real, sophisticated
//    code with its own test file, but CONFIRMED via direct search to
//    be referenced by ZERO real pipeline entry points — genuinely
//    disconnected, dead infrastructure from the real compiler's own
//    perspective.
//
// See IMPORTS_ARCHITECTURE_REPORT.md for the full engineering answer
// to the explicit review question.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";

function fullPipeline(src: string): { stage: string; ok: boolean; message?: string } {
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) return { stage: "parse", ok: false, message: JSON.stringify(parseErrors[0]) };
  const sem = analyze(program);
  const semErrors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (semErrors.length) return { stage: "semantic", ok: false, message: JSON.stringify(semErrors[0]) };
  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length) return { stage: "typecheck", ok: false, message: JSON.stringify(tcErrors[0]) };
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) return { stage: "lower", ok: false, message: JSON.stringify(ir.diagnostics) };
  return { stage: "none", ok: true };
}

describe("Stage Imports — real, connected mechanism (Native Library Registry) — confirmed working", () => {
  it("a single import works correctly", () => {
    expect(fullPipeline("import sqlite3\nfunction main(): int\n  print(sqlite3.libversion())\n  return 0\nend\n").ok).toBe(true);
  });

  it("multiple distinct imports work correctly", () => {
    expect(fullPipeline("import sqlite3\nimport libm\nfunction main(): int\n  print(sqlite3.libversion())\n  print(libm.sqrt(4.0))\n  return 0\nend\n").ok).toBe(true);
  });

  it("a duplicate import (same library twice) is correctly rejected (SE2002, sound behavior, not a bug)", () => {
    const result = fullPipeline("import sqlite3\nimport sqlite3\nfunction main(): int\n  print(sqlite3.libversion())\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("semantic");
    expect(result.message).toContain("duplicate import");
  });
});

describe("Stage Imports — bogus/unregistered import names: lazy validation confirmed (intentional design, not a new bug)", () => {
  it("importing a name that matches no registered library is silently accepted if never used (lazy validation, consistent with existing design)", () => {
    expect(fullPipeline("import totallyFakeLibXYZ\nfunction main(): int\n  return 0\nend\n").ok).toBe(true);
  });

  it("importing a bogus name and then ACTUALLY using it via member-call is correctly rejected", () => {
    const result = fullPipeline("import totallyFakeLibXYZ\nfunction main(): int\n  print(totallyFakeLibXYZ.doStuff())\n  return 0\nend\n");
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("lower");
  });
});

describe("Stage Imports — confirmed NOT supported by the connected system (missing feature, matches the disconnected module-system finding)", () => {
  it("import aliasing ('import X as Y') is not supported", () => {
    const result = fullPipeline("import sqlite3 as db\nfunction main(): int\n  return 0\nend\n");
    expect(result.stage).toBe("parse");
  });

  it("relative imports ('./module') are not supported by the connected parser", () => {
    const result = fullPipeline("import ./mymodule\nfunction main(): int\n  return 0\nend\n");
    expect(result.stage).toBe("parse");
  });

  it("scoped/stdlib-style import paths ('std/io') are not supported by the connected parser either", () => {
    const result = fullPipeline("import std/io\nfunction main(): int\n  return 0\nend\n");
    expect(result.stage).toBe("parse");
  });
});

describe("Stage Imports — performance", () => {
  it("1000 functions using registered-library imports compile within a reasonable time budget", () => {
    let src = "import sqlite3\n";
    for (let i = 0; i < 1000; i++) src += `function f${i}(): int\n  print(sqlite3.libversion())\n  return 0\nend\n`;
    src += "function main(): int\n  return 0\nend\n";
    const t0 = performance.now();
    const result = fullPipeline(src);
    const elapsed = performance.now() - t0;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
