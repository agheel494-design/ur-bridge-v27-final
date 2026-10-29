// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Runtime Stabilization — Memory & Runtime Safety
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase. TWO real Critical (Category A)
// findings, per the explicit "any crash is Critical, stop until closed"
// policy:
//
// 1. FIXED: integer division/modulo by zero previously raised SIGFPE (an
//    unhandled crash) — confirmed directly only AFTER fixing a separate,
//    real gap in the test harness (runExecutable() was silently
//    discarding the real termination signal). Fixed the actual crash:
//    binop emission now checks for a zero divisor on integer division/
//    modulo and panics cleanly (matching the established array-bounds-
//    check pattern) instead of letting raw C division raise SIGFPE.
//    Float division-by-zero is unaffected (IEEE 754 correctly produces
//    `inf`, confirmed already working).
//
// 2. CONFIRMED, NOT FIXED (per explicit "stop before big redesign,
//    report only" policy): deep recursion causes an unhandled SIGSEGV
//    starting between 50,000 and 100,000 levels — a realistic depth. A
//    safe fix needs real, Linux/POSIX-specific systems programming with
//    no way to verify Windows behavior from this environment —
//    documented in RUNTIME_STABILIZATION_REPORT.md, not implemented.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

async function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r;
}

describe("Runtime Stabilization — BUG FIXED: integer division/modulo by zero (was SIGFPE, now a clean panic)", () => {
  it("integer division by zero panics cleanly (exit 101, no signal), does not raise SIGFPE", async () => {
    const r = await compileAndRun("function main(): int\n  let a = 10\n  let b = 0\n  print(a / b)\n  return 0\nend\n");
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(101);
    expect(r.stderr).toContain("division by zero");
  });

  it("integer modulo by zero panics cleanly too", async () => {
    const r = await compileAndRun("function main(): int\n  let a = 10\n  let b = 0\n  print(a % b)\n  return 0\nend\n");
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(101);
  });

  it("float division by zero is UNAFFECTED by the fix — still correctly produces IEEE 754 infinity, not a panic", async () => {
    const r = await compileAndRun("function main(): int\n  let a = 10.0\n  let b = 0.0\n  print(a / b)\n  return 0\nend\n");
    expect(r.signal).toBeNull();
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("inf");
  });

  it("normal (non-zero-divisor) integer division still works correctly", async () => {
    const r = await compileAndRun("function main(): int\n  print(10 / 2)\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("5");
  });

  it("normal modulo still works correctly", async () => {
    const r = await compileAndRun("function main(): int\n  print(10 % 3)\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("1");
  });

  it("division with a negative divisor still works correctly", async () => {
    const r = await compileAndRun("function main(): int\n  print(10 / (0 - 2))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("-5");
  });
});

describe("Runtime Stabilization — infrastructure fix: runExecutable now reports the real termination signal", () => {
  it("a process killed by a signal reports the real signal name, not just a generic -1 (documents the current, confirmed-but-unfixed SIGSEGV state — see RUNTIME_STABILIZATION_REPORT.md)", async () => {
    const src = 'function rec(n: int): int\n  if n <= 0\n    return 0\n  end\n  return 1 + rec(n - 1)\nend\nfunction main(): int\n  print(rec(500000))\n  return 0\nend\n';
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lower failed");
    const cSource = emitC(ir.value);
    const compiled = compileC(cSource, "a.out", {});
    if (!compiled.ok) throw new Error("C compile failed");
    const r = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    if (process.platform === "win32") {
  expect(r.exitCode).toBe(3221225725);
} else {
  expect(r.signal).toBe("SIGSEGV");
}
  });
});

