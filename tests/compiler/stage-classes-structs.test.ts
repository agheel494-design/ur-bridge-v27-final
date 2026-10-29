// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage Classes/Structs — Bug Hunt Results
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase. UR has NO "class" construct —
// confirmed absent from every UR-language document (already documented
// as v2.0, architectural). The closest, actually testable capability is
// `struct` (data-only: no methods, no constructors beyond the implicit
// field-order constructor, no inheritance, no `this`).
//
// ZERO new bugs found this stage. One PRE-EXISTING, already-tracked
// limitation (issues/named-type-annotations-not-resolved.md, OPEN,
// deferred to v1.1) is confirmed to ALSO block struct values as
// function parameters/return types — not a new finding, same root
// cause, noted in that issue file directly rather than opening a
// duplicate.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

async function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const sem = analyze(program);
  const semErrors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (semErrors.length) throw new Error(`semantic failed: ${JSON.stringify(semErrors)}`);
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
  return r;
}

describe("Stage Classes/Structs — confirmed working (no bug found)", () => {
  it("struct construction and field read", async () => {
    const r = await compileAndRun('struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(3, 4)\n  print(p.x)\n  print(p.y)\n  return 0\nend\n');
    expect(r.stdout).toBe("3\n4\n");
  });

  it("field write (mutation) works correctly", async () => {
    const r = await compileAndRun('struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(3, 4)\n  p.x = 99\n  print(p.x)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("99");
  });

  it("struct copy semantics: assignment copies BY VALUE, mutating the copy does not affect the original", async () => {
    const r = await compileAndRun('struct Point\n  x: int\nend\nfunction main(): int\n  let a = Point(1)\n  let b = a\n  b.x = 99\n  print(a.x)\n  print(b.x)\n  return 0\nend\n');
    expect(r.stdout).toBe("1\n99\n");
  });

  it("a plain function taking extracted-field arguments works as a method-substitute", async () => {
    const r = await compileAndRun('struct Point\n  x: int\n  y: int\nend\nfunction distanceLike(x: int, y: int): int\n  return x + y\nend\nfunction main(): int\n  let p = Point(3, 4)\n  print(distanceLike(p.x, p.y))\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("7");
  });
});

describe("Stage Classes/Structs — errors correctly rejected (sound behavior, not a bug)", () => {
  it("accessing a nonexistent field name is rejected with a clear diagnostic", () => {
    const { tokens } = lex('struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(1, 2)\n  print(p.z)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    const errors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("no field 'z'");
  });

  it("wrong field TYPE in construction is rejected with a clear diagnostic", () => {
    const { tokens } = lex('struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point("a", 2)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    const errors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.code).toBe("TY5002");
  });

  it("wrong argument COUNT in construction is rejected with a clear diagnostic (caught by Semantic, SE3001)", () => {
    const { tokens } = lex('struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(1)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const sem = analyze(program);
    const errors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.code).toBe("SE3001");
    expect(errors[0]!.message).toContain("2 field(s)");
  });

  it("'this' does not exist — correctly rejected as an undefined symbol (UR has no OOP model, expected, not a bug)", () => {
    const { tokens } = lex('struct Point\n  x: int\nend\nfunction main(): int\n  let p = Point(1)\n  print(this.x)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const sem = analyze(program);
    const errors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.message).toContain("undefined symbol 'this'");
  });
});

describe("Stage Classes/Structs — REAL FIX confirmed: struct-as-function-signature limitation resolved (was PRE-EXISTING, already-tracked; fixed via TypeChecker/type-env.ts changes)", () => {
  it("REAL FIX: a struct type CAN NOW be used as a function parameter type (previously-tracked limitation resolved - TypeChecker's own structTypes map, already built correctly during hoisting, is now actually consulted by resolveOptionalTypeRef before declaring a type unknown)", () => {
    const { tokens } = lex('struct Point\n  x: int\nend\nfunction getX(p: Point): int\n  return p.x\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    const errors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBe(0);
  });

  it("REAL FIX: a struct type CAN NOW be used as a function return type (same fix)", () => {
    const { tokens } = lex('struct Point\n  x: int\n  y: int\nend\nfunction make(): Point\n  return Point(1, 2)\nend\n');
    const { program } = parse(tokens);
    const tc = typeCheck(program);
    const errors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(errors.length).toBe(0);
  });
});

describe("Stage Classes/Structs — performance with many struct instances", () => {
  it("creating and reading 5000 struct instances in a loop completes quickly with correct results", async () => {
    const r = await compileAndRun(
      'struct Point\n  x: int\n  y: int\nend\n' +
      'function main(): int\n' +
      '  let i = 0\n  let total = 0\n' +
      '  while i < 5000\n' +
      '    let p = Point(i, i)\n' +
      '    total = total + p.x\n' +
      '    i = i + 1\n' +
      '  end\n' +
      '  print(total)\n  return 0\nend\n'
    );
    expect(r.stdout.trim()).toBe("12497500");
  });
});
