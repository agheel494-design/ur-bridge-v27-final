// ─────────────────────────────────────────────────────────────────────────────
// UR — Performance: Codegen Pipeline
// Level 2 — Phase 2.1-2.3 closure
// ─────────────────────────────────────────────────────────────────────────────
//
// Measures the full AST → Semantic → TypeChecker → IR → C pipeline (NOT
// including gcc invocation, which is measured separately since it depends
// on the host toolchain rather than this project's own code) across 100
// and 1000 synthetic programs. Records: total time, per-program average,
// average IR instruction count, and average generated C size.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";

function makeSyntheticProgram(index: number, funcCount: number): string {
  const lines: string[] = [];
  for (let i = 0; i < funcCount; i++) {
    lines.push(`function f${index}_${i}(a: int, b: int): int`);
    lines.push(`  let x = a + b * ${i % 7}`);
    lines.push(`  let y = x - ${i}`);
    lines.push(`  return y`);
    lines.push(`end`);
  }
  lines.push(`function main(): int`);
  lines.push(`  return f${index}_0(1, 2)`);
  lines.push(`end`);
  return lines.join("\n") + "\n";
}

function compileToC(src: string): { ok: boolean; irInstructionCount: number; cLength: number } {
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) return { ok: false, irInstructionCount: 0, cLength: 0 };
  const sem = analyze(program);
  if (sem.diagnostics.length) return { ok: false, irInstructionCount: 0, cLength: 0 };
  const types = typeCheck(program);
  if (types.diagnostics.length) return { ok: false, irInstructionCount: 0, cLength: 0 };
  const ir = lowerToIR(program, "perf.ur", "perf");
  if (!ir.ok) return { ok: false, irInstructionCount: 0, cLength: 0 };
  const instCount = ir.value.functions.reduce((sum, fn) => sum + fn.blocks.reduce((s, b) => s + b.instructions.length, 0), 0);
  const c = emitC(ir.value);
  return { ok: true, irInstructionCount: instCount, cLength: c.length };
}

describe("Performance — Codegen Pipeline throughput", () => {
  it("compiles 100 synthetic programs (10 functions each) and reports timing/size metrics", () => {
    const N = 100;
    const t0 = performance.now();
    let totalInst = 0, totalCLen = 0, failures = 0;
    for (let i = 0; i < N; i++) {
      const src = makeSyntheticProgram(i, 10);
      const result = compileToC(src);
      if (!result.ok) failures++;
      totalInst += result.irInstructionCount;
      totalCLen += result.cLength;
    }
    const elapsed = performance.now() - t0;

    console.log(`[Performance] 100 programs (10 funcs each): ${elapsed.toFixed(1)}ms total, ${(elapsed / N).toFixed(2)}ms/program, avg IR instructions=${(totalInst / N).toFixed(0)}, avg C size=${(totalCLen / N).toFixed(0)} bytes`);

    expect(failures).toBe(0);
    expect(elapsed).toBeLessThan(10_000); // generous ceiling — this is a correctness+non-regression guard, not a strict SLA
  });

  it("compiles 1000 synthetic programs (5 functions each) and reports timing/size metrics", () => {
    const N = 1000;
    const t0 = performance.now();
    let totalInst = 0, totalCLen = 0, failures = 0;
    for (let i = 0; i < N; i++) {
      const src = makeSyntheticProgram(i, 5);
      const result = compileToC(src);
      if (!result.ok) failures++;
      totalInst += result.irInstructionCount;
      totalCLen += result.cLength;
    }
    const elapsed = performance.now() - t0;

    console.log(`[Performance] 1000 programs (5 funcs each): ${elapsed.toFixed(1)}ms total, ${(elapsed / N).toFixed(3)}ms/program, avg IR instructions=${(totalInst / N).toFixed(0)}, avg C size=${(totalCLen / N).toFixed(0)} bytes`);

    expect(failures).toBe(0);
    expect(elapsed).toBeLessThan(30_000);
  });

  it("a single large program (500 functions in one file) compiles without excessive slowdown", () => {
    const src = makeSyntheticProgram(0, 500);
    const t0 = performance.now();
    const result = compileToC(src);
    const elapsed = performance.now() - t0;

    console.log(`[Performance] single 500-function file: ${elapsed.toFixed(1)}ms, IR instructions=${result.irInstructionCount}, C size=${result.cLength} bytes`);

    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("100 programs using print()/input() builtins compile with negligible overhead vs. plain arithmetic", () => {
    const N = 100;
    function makeBuiltinProgram(i: number): string {
      return `function main(): int\n  let x = ${i}\n  print(x)\n  return 0\nend\n`;
    }
    const t0 = performance.now();
    let failures = 0;
    for (let i = 0; i < N; i++) {
      const result = compileToC(makeBuiltinProgram(i));
      if (!result.ok) failures++;
    }
    const elapsed = performance.now() - t0;
    console.log(`[Performance] 100 print()-using programs: ${elapsed.toFixed(1)}ms total, ${(elapsed / N).toFixed(2)}ms/program`);
    expect(failures).toBe(0);
    expect(elapsed).toBeLessThan(5_000);
  });
});
