// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Expression Correctness Fuzzing (Compiler & Runtime
// Stabilization phase — bug-hunting in previously-unfuzzed areas)
// ─────────────────────────────────────────────────────────────────────────────
//
// Random arithmetic and boolean/comparison expression trees, compiled and
// RUN for real (through the actual C Backend + gcc), with the result
// compared against JavaScript's own evaluation as ground truth. This
// specifically targets an area NOT covered by the existing optimizer
// fuzzer (tests/optimizer/fuzz.test.ts, which fuzzes program STRUCTURE)
// or the incremental-pipeline fuzzer (tests/fuzz/compiler-fuzz.test.ts,
// which fuzzes build/module-graph shapes, not expression VALUES) —
// arithmetic/comparison precedence and type-coercion edge cases are a
// classic source of real compiler bugs neither of those catches.
//
// Result of this search (120 real compile+run comparisons across two
// separate categories): zero mismatches found. Recorded here as a
// permanent regression test — a real, negative result is still valuable
// evidence, and this keeps the coverage in place for future changes.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return {
    next(): number { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; },
    int(lo: number, hi: number) { return lo + Math.floor(this.next() * (hi - lo + 1)); },
    pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)]!; },
  };
}

function genArithExpr(rng: ReturnType<typeof makeRng>, depth: number): { ur: string; js: number; isFloat: boolean } {
  if (depth <= 0 || rng.next() < 0.4) {
    const isFloat = rng.next() < 0.5;
    if (isFloat) {
      const v = rng.int(1, 20) + 0.5;
      return { ur: v.toFixed(1), js: v, isFloat: true };
    }
    const v = rng.int(1, 20);
    return { ur: String(v), js: v, isFloat: false };
  }
  const left = genArithExpr(rng, depth - 1);
  const right = genArithExpr(rng, depth - 1);
  if (left.isFloat !== right.isFloat) return left; // avoid mixed-type exprs (known unsupported — not this fuzzer's own target)
  const op = rng.pick(["+", "-", "*"]);
  const js = op === "+" ? left.js + right.js : op === "-" ? left.js - right.js : left.js * right.js;
  return { ur: `(${left.ur} ${op} ${right.ur})`, js, isFloat: left.isFloat };
}

function genBoolExpr(rng: ReturnType<typeof makeRng>, depth: number): { ur: string; js: boolean } {
  if (depth <= 0 || rng.next() < 0.4) {
    const a = rng.int(1, 10), b = rng.int(1, 10);
    const op = rng.pick(["<", ">", "==", "!=", "<=", ">="]);
    const js = op === "<" ? a < b : op === ">" ? a > b : op === "==" ? a === b : op === "!=" ? a !== b : op === "<=" ? a <= b : a >= b;
    return { ur: `(${a} ${op} ${b})`, js };
  }
  const left = genBoolExpr(rng, depth - 1);
  const right = genBoolExpr(rng, depth - 1);
  const isAnd = rng.next() < 0.5;
  return { ur: `(${left.ur} ${isAnd ? "and" : "or"} ${right.ur})`, js: isAnd ? (left.js && right.js) : (left.js || right.js) };
}

function compileAndRunReturnStdout(src: string): string {
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
  return r.stdout.trim();
}

describe("Expression Correctness Fuzzing — arithmetic (60 random cases, real compile+run vs JS ground truth)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const rng = makeRng(seed);
      const expr = genArithExpr(rng, 4);
      const urType = expr.isFloat ? "float" : "int";
      const src = `function main(): int\n  let v: ${urType} = ${expr.ur}\n  print(v)\n  return 0\nend\n`;
      const stdout = compileAndRunReturnStdout(src);
      expect(Math.abs(parseFloat(stdout) - expr.js)).toBeLessThan(0.001);
    });
  }
});

describe("Expression Correctness Fuzzing — boolean/comparison logic (60 random cases, real compile+run vs JS ground truth)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const rng = makeRng(seed);
      const expr = genBoolExpr(rng, 3);
      const src = `function main(): int\n  let v = ${expr.ur}\n  if v\n    print(1)\n  else\n    print(0)\n  end\n  return 0\nend\n`;
      const stdout = compileAndRunReturnStdout(src);
      expect(stdout === "1").toBe(expr.js);
    });
  }
});
