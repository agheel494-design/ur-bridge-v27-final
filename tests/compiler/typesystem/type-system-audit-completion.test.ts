import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";

// Completes the Type System audit's own remaining candidates.
//
// Self-correction made before writing this file: TY3002/TY6002 did
// NOT need investigation - direct source inspection showed they were
// already wired to real trigger conditions. Confirmed live below.

function trace(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  const t = typeCheck(p.program);
  return t.diagnostics.map((d) => d.code);
}

describe("Type System Audit completion", () => {
  it("TY6002 (EMPTY_ARRAY_LITERAL) fires correctly", () => {
    expect(trace("function main(): int\n  let x = []\n  return 0\nend")).toContain("TY6002");
  });

  it("TY3002 (UNARY_TYPE_ERROR) fires correctly", () => {
    expect(trace("function main(): int\n  let x: bool = true\n  let y = -x\n  return 0\nend")).toContain("TY3002");
  });

  it("REAL EVIDENCE: TY2001 is not fired by a real assignment type conflict - TY2002 fires instead (increases confidence TY2001 is potentially dormant, does not prove unreachable under all paths)", () => {
    const codes = trace("function main(): int\n  let x: bool = 5\n  return 0\nend");
    expect(codes).toContain("TY2002");
    expect(codes).not.toContain("TY2001");
  });

  it("REAL EVIDENCE: TY5001 is not fired by an undefined parameter type - TY1001 fires instead (increases confidence, does not fully prove)", () => {
    const codes = trace("function f(x: NoSuchType): int\n  return 1\nend\nfunction main(): int\n  return 0\nend");
    expect(codes).toContain("TY1001");
    expect(codes).not.toContain("TY5001");
  });
});
