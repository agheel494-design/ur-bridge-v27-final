// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: IR Interpreter (Windows Recovery Sprint, Priority 4 — Option 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// The accepted architectural fix for "no manual GCC install": `ur run`
// and `ur build` (and the IDE's Run/Build buttons) no longer use the C
// Backend/gcc at all — they execute via this interpreter directly in
// Node.js. This file validates the interpreter's correctness by
// comparing its output against the C Backend as ground truth across
// every major language feature this project has tested throughout its
// own development history.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { interpretModule } from "../../src/interpreter/interpret.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

function interpretSrc(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  return interpretModule(ir.value, "main");
}

function interpretSrcWithInput(src: string, lines: string[]) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);

  let index = 0;
  return interpretModule(
    ir.value,
    "main",
    undefined,
    undefined,
    { readLine: () => lines[index++] ?? "" },
  );
}
async function compareToC(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lower failed");
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error("C compile failed");
  const cResult = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  const interpResult = interpretModule(ir.value, "main");
  return { cResult, interpResult };
}

describe("Interpreter — correctness vs the C Backend as ground truth", () => {
  it("input() returns the injected input line", () => {
    const result = interpretSrcWithInput(
      "function main(): int\n  let s = input()\n  print(s)\n  return 0\nend\n",
      ["hello"],
    );

    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("basic arithmetic matches", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  print(2 + 3 * 4)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("14");
  });

  it("variables and reassignment match", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let x = 5\n  x = x + 10\n  print(x)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
  });

  it("if/else control flow matches", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let x = 7\n  if x > 5\n    print(1)\n  else\n    print(0)\n  end\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
  });

  it("while loops match", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let i = 0\n  let total = 0\n  while i < 10\n    total = total + i\n    i = i + 1\n  end\n  print(total)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("45");
  });

  it("recursion (factorial) matches", async () => {
    const { cResult, interpResult } = await compareToC("function fact(n: int): int\n  if n <= 1\n    return 1\n  end\n  return n * fact(n - 1)\nend\nfunction main(): int\n  print(fact(8))\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("40320");
  });

  it("mutual recursion matches", async () => {
    const { cResult, interpResult } = await compareToC("function isEven(n: int): bool\n  if n == 0\n    return true\n  end\n  return isOdd(n - 1)\nend\nfunction isOdd(n: int): bool\n  if n == 0\n    return false\n  end\n  return isEven(n - 1)\nend\nfunction main(): int\n  if isEven(20)\n    print(1)\n  end\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
  });

  it("arrays (construction + indexing) match", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let arr = [10, 20, 30]\n  print(arr[0] + arr[1] + arr[2])\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("60");
  });

  it("arrays inside a loop match", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let arr = [1, 2, 3, 4, 5]\n  let i = 0\n  let total = 0\n  while i < 5\n    total = total + arr[i]\n    i = i + 1\n  end\n  print(total)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("15");
  });

  it("array parameter mutation is visible to the caller", () => {
    const result = interpretSrc(
      "function mutate(xs: int[]): int\n" +
      "  xs[1] = 99\n" +
      "  return 0\n" +
      "end\n" +
      "function main(): int\n" +
      "  let values: int[] = [10, 20, 30]\n" +
      "  mutate(values)\n" +
      "  if values[1] == 99\n" +
      "    return 0\n" +
      "  end\n" +
      "  return 1\n" +
      "end\n",
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("struct parameter mutation does not escape to the caller", () => {
    const result = interpretSrc(
      "struct Point\n" +
      "  x: int\n" +
      "  y: int\n" +
      "end\n" +
      "function mutate(p: Point): int\n" +
      "  p.x = 99\n" +
      "  return p.x\n" +
      "end\n" +
      "function main(): int\n" +
      "  let p = Point(10, 20)\n" +
      "  let inside: int = mutate(p)\n" +
      "  if inside == 99 && p.x == 10\n" +
      "    return 0\n" +
      "  end\n" +
      "  return 1\n" +
      "end\n",
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("structs (construction + field access) match", async () => {
    const { cResult, interpResult } = await compareToC("struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(3, 4)\n  print(p.x + p.y)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("7");
  });

  it("strings match", async () => {
    const { cResult, interpResult } = await compareToC('function main(): int\n  print("hello from interpreter")\n  return 0\nend\n');
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
  });

  it("string comparison matches", async () => {
    const { cResult, interpResult } = await compareToC('function main(): int\n  print("apple" < "banana")\n  return 0\nend\n');
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("true");
  });

  it("floats match (including whole-number formatting, e.g. 5.0 -> '5')", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  print(3.5 + 1.5)\n  return 0\nend\n");
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
    expect(interpResult.stdout.trim()).toBe("5");
  });

  it("Arabic string content matches", async () => {
    const { cResult, interpResult } = await compareToC('function main(): int\n  print("مرحبا بالعالم")\n  return 0\nend\n');
    expect(interpResult.stdout.trim()).toBe(cResult.stdout.trim());
  });

  it("division by zero panics cleanly in both, matching exit code and message", async () => {
    const { cResult, interpResult } = await compareToC("function main(): int\n  let a = 10\n  let b = 0\n  print(a / b)\n  return 0\nend\n");
    expect(interpResult.exitCode).toBe(101);
    expect(interpResult.stderr).toContain("division by zero");
    expect(cResult.exitCode).toBe(101);
  });

  it("array index out of bounds panics cleanly, does not silently return garbage or crash the interpreter process", () => {
    const result = interpretSrc("function main(): int\n  let arr = [1, 2, 3]\n  print(arr[10])\n  return 0\nend\n");
    expect(result.exitCode).toBe(101);
    expect(result.stderr).toContain("out of bounds");
  });
});
