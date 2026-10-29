// F3-INTERPRETER-MAIN-EXIT-CODE — regression tests (RUNTIME_SPEC.md §6: a UR `main` returning `int` or `bool`
// becomes the real process exit code; bool -> 1/0). Interpreter and C backend must agree.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { interpretModule } from "../../src/interpreter/interpret.js";
import { emitC } from "../../src/backend/c/emit-c.js";
// Imported via the .ts path on purpose: this F3 Gate starts from C4, which still carries the stale committed
// tools/backend/c-compile.js (FINDING-A, fixed separately in RB3-TEST-INFRA-FIX). The .ts specifier keeps this new
// test loadable under real vitest on both lines of evidence without depending on that fix.
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.ts";

function both(src: string) {
  const ir = lowerToIR(parse(lex(src).tokens).program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const interp = interpretModule(ir.value, "main");
  const compiled = compileC(emitC(ir.value), "a.out", {});
  if (!compiled.ok) throw new Error("C compile failed");
  const c = runExecutable(compiled.value); cleanupExecutable(compiled.value);
  return { interp, c };
}
const BOOL_TRUE = "function isGreater(a: int, b: int): bool\n  return a > b\nend\n\nfunction main(): bool\n  return isGreater(5, 3)\nend\n";
const BOOL_FALSE = "function isGreater(a: int, b: int): bool\n  return a > b\nend\n\nfunction main(): bool\n  return isGreater(3, 5)\nend\n";

describe("F3 — main() exit code: Interpreter == C backend (RUNTIME_SPEC.md §6)", () => {
  it("main(): bool returning true -> exit 1 (interpreter and C)", () => {
    const { interp, c } = both(BOOL_TRUE);
    expect(interp.exitCode).toBe(1);
    expect(c.exitCode).toBe(1);
  });
  it("main(): bool returning false -> exit 0 (interpreter and C)", () => {
    const { interp, c } = both(BOOL_FALSE);
    expect(interp.exitCode).toBe(0);
    expect(c.exitCode).toBe(0);
  });
  it("main(): int is unchanged (42 and 0)", () => {
    expect(both("function main(): int\n  return 42\nend\n").interp.exitCode).toBe(42);
    expect(both("function main(): int\n  return 0\nend\n").interp.exitCode).toBe(0);
    expect(both("function main(): int\n  return 42\nend\n").c.exitCode).toBe(42);
  });
  it("ur_panic is unchanged: division by zero -> 101 with the same message, in a bool-returning main too", () => {
    const { interp, c } = both("function main(): bool\n  let a = 10\n  let b = 0\n  print(a / b)\n  return true\nend\n");
    expect(interp.exitCode).toBe(101);
    expect(interp.stderr).toContain("division by zero");
    expect(c.exitCode).toBe(101);
  });
  it("golden 04-comparison program: interpreter exit == C exit (the F-3 reproducer)", () => {
    const src = readFileSync(fileURLToPath(new URL("../codegen/golden/04-comparison/program.ur", import.meta.url)), "utf-8");
    const { interp, c } = both(src);
    expect(interp.exitCode).toBe(c.exitCode);
    expect(interp.exitCode).toBe(1);
  });
  it("end to end through the CLI (`ur run`): the real process exit code of main(): bool true is 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-f3-"));
    try {
      writeFileSync(join(dir, "t.ur"), BOOL_TRUE);
      const r = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url)), "run", "t.ur"], { cwd: dir, encoding: "utf-8" });
      expect(r.status).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
