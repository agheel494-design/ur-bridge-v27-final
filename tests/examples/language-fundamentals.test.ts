import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";

// A precise, isolated map of UR's own real fundamentals - discovered
// by directly, individually testing each real capability BEFORE
// committing to a larger example program (per the established
// discipline: real programs reveal real gaps, but isolated tests
// pinpoint them precisely without wasting a larger program's own
// design on a single unrelated blocker).

function compiles(src: string): boolean {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  return ir.ok;
}

describe("UR Language Fundamentals: precise capability map (confirmed live, not assumed)", () => {
  it("WORKS: recursion (factorial)", () => {
    expect(compiles("function factorial(n: int): int\n  if n <= 1\n    return 1\n  end\n  return n * factorial(n - 1)\nend\nfunction main(): int\n  return factorial(5)\nend\n")).toBe(true);
  });

  it("WORKS: struct construction and field access inside any function (not just main)", () => {
    expect(compiles("struct Point\n  x: int\n  y: int\nend\nfunction helper(): int\n  let p = Point(3, 4)\n  return p.x + p.y\nend\nfunction main(): int\n  return helper()\nend\n")).toBe(true);
  });

  it("WORKS: passing a struct AS a function parameter", () => {
    expect(compiles("struct Point\n  x: int\n  y: int\nend\nfunction sumCoords(p: Point): int\n  return p.x + p.y\nend\nfunction main(): int\n  let p = Point(3, 4)\n  return sumCoords(p)\nend\n")).toBe(true);
  });

  it("NOW WORKS (per Priority 2 Stabilization Sprint - was a real, confirmed limit before, fixed via Solution A: callee returns the struct by value, matching C's own native semantics): returning a struct as a function's own return type", () => {
    expect(compiles("struct Point\n  x: int\n  y: int\nend\nfunction makePoint(a: int, b: int): Point\n  return Point(a, b)\nend\nfunction main(): int\n  let p = makePoint(3, 4)\n  return p.x + p.y\nend\n")).toBe(true);
  });

  it("DOES NOT WORK (real, confirmed limit, matches the earlier tic-tac-toe discovery): passing an array as a function parameter", () => {
    expect(compiles("function sumArr(arr: [int; 3]): int\n  return arr[0] + arr[1] + arr[2]\nend\nfunction main(): int\n  let a = [1, 2, 3]\n  return sumArr(a)\nend\n")).toBe(false);
  });
});
