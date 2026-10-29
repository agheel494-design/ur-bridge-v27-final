// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Runtime Stabilization — Memory Safety, Round 2
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase, continued. Covers:
//
// 1. FIXED: invalid pointer passed to free() (e.g. a string literal, never
//    heap-allocated) previously reached glibc's own free() and aborted
//    with an uncaught SIGABRT. Fixed with the same tracking mechanism as
//    double-free.
//
// 2. A REAL BUG FOUND BY STRESS TESTING, in the fix itself, and FIXED: the
//    tracking tables only ever grew (entries added, never removed) —
//    confirmed directly that a program doing 50,000+ sequential
//    input()+free() cycles incorrectly panicked with "invalid pointer"
//    around the 4096th cycle. Fixed: pointers are removed from the
//    allocated-table on free, and from the freed-table on fresh
//    reallocation of a reused address — verified up to 200,000 cycles.
//
// 3. A SECOND bug found during the SAME re-verification: checking
//    "known allocation" BEFORE "already freed" misclassified a genuine
//    double-free as "invalid pointer". Fixed by checking "already freed"
//    first.
//
// 4. Option C (per explicit review decision) for stack overflow: no depth
//    counter, no signal handler — a permanent test measuring the REAL
//    crash threshold, so a future regression is caught.
//
// 5. Long-running execution: 10 million arithmetic operations, and heavy
//    sequential alloc/free cycling (200,000).

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";
import { spawnSync } from "child_process";

async function compileAndRun(src: string, stdin?: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  if (stdin !== undefined) {
    const result = spawnSync(compiled.value.executablePath, [], { input: stdin, encoding: "utf-8" });
    cleanupExecutable(compiled.value);
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1, signal: result.signal };
  }
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r;
}

describe("Runtime Stabilization — BUG FIXED: invalid pointer passed to free()", () => {
  it("free() on a string literal (never heap-allocated) panics cleanly, does not raise SIGABRT", async () => {
    const r = await compileAndRun('function main(): int\n  free("hello")\n  return 0\nend\n');
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(101);
    expect(r.stderr).toContain("invalid pointer passed to free");
  });
});

describe("Runtime Stabilization — BUG FOUND AND FIXED (in the fix itself, via stress testing): tracking-table capacity exhaustion caused false positives at scale", () => {
  it("200,000 sequential input()+free() cycles all succeed correctly", async () => {
    const CYCLES = 200000;
    const src = `function main(): int\n  let i = 0\n  while i < ${CYCLES}\n    let s = input()\n    free(s)\n    i = i + 1\n  end\n  print(i)\n  return 0\nend\n`;
    const stdinInput = Array.from({ length: CYCLES }, () => "x").join("\n") + "\n";
    const r = await compileAndRun(src, stdinInput);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(String(CYCLES));
  }, 20000);

  it("a genuine double-free is STILL correctly detected even after the removal fix", async () => {
    const r = await compileAndRun("function main(): int\n  let s = input()\n  free(s)\n  free(s)\n  return 0\nend\n", "hello\n");
    expect(r.exitCode).toBe(101);
    expect(r.stderr).toContain("double free detected");
  });
});

describe("Runtime Stabilization — Option C: stack overflow is documented and measured, NOT fixed with a counter or signal handler", () => {
  it("recursion at a depth known to be safe (50,000) does not crash", async () => {
    const src = 'function rec(n: int): int\n  if n <= 0\n    return 0\n  end\n  return 1 + rec(n - 1)\nend\nfunction main(): int\n  print(rec(50000))\n  return 0\nend\n';
    const r = await compileAndRun(src);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("50000");
  });

  it("recursion at a depth known to crash this environment (500,000) raises SIGSEGV — this is the CURRENT, documented, accepted-for-v1.0 behavior (RUNTIME_STABILIZATION_REPORT.md); this test exists so a change in this threshold is visible in future runs", async () => {
    const src = 'function rec(n: int): int\n  if n <= 0\n    return 0\n  end\n  return 1 + rec(n - 1)\nend\nfunction main(): int\n  print(rec(500000))\n  return 0\nend\n';
    const r = await compileAndRun(src);
    if (process.platform === "win32") {
  expect(r.exitCode).toBe(3221225725);
} else {
  expect(r.signal).toBe("SIGSEGV");
}
  });
});

describe("Runtime Stabilization — long-running execution stability", () => {
  it("10 million arithmetic operations complete correctly and quickly", async () => {
    const src = 'function main(): int\n  let i = 0\n  let total = 0\n  while i < 10000000\n    total = total + 1\n    i = i + 1\n  end\n  print(total)\n  return 0\nend\n';
    const t0 = performance.now();
    const r = await compileAndRun(src);
    const elapsed = performance.now() - t0;
    expect(r.stdout.trim()).toBe("10000000");
    expect(elapsed).toBeLessThan(10000);
  }, 15000);
});

