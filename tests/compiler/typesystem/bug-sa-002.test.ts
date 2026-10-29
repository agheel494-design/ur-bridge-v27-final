import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";

// BUG-SA-002 fix regression tests.
//
// Real minimal fix: a simple, AST-level allPathsReturn() check added
// to checker.ts's own checkFunction(), NOT a port of lowerToIR's own
// CG1001 logic (built on IR basic-block/terminator state that
// doesn't exist at type-checking). Wired to the already-defined but
// previously dormant TY4001 (MISSING_RETURN).
//
// Real discovery while implementing: IfStatement's own elseBranch
// type is IfStatement | BlockStatement (else-if chains nest
// IfStatement directly) - confirmed via tsc, handled explicitly.

function trace(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  const s = analyze(p.program);
  const t = typeCheck(p.program);
  return { typeCodes: t.diagnostics.map((d) => d.code), semOk: s.diagnostics.length === 0 };
}

describe("BUG-SA-002 fix: missing/incomplete return paths now caught at type-checking, not silently reaching codegen", () => {
  it("a function with no return at all now produces TY4001 at the type-check stage", () => {
    const r = trace("function f(): int\n  let x: int = 1\nend");
    expect(r.typeCodes).toContain("TY4001");
  });

  it("an if with no else (one branch returns, no fallback) now produces TY4001", () => {
    const r = trace("function f(x: bool): int\n  if x\n    return 1\n  end\nend");
    expect(r.typeCodes).toContain("TY4001");
  });

  it("REGRESSION: full if/else where both branches return is still accepted", () => {
    const r = trace("function f(x: bool): int\n  if x\n    return 1\n  else\n    return 2\n  end\nend");
    expect(r.typeCodes).not.toContain("TY4001");
  });

  it("REGRESSION: a while loop with a return placed after it is still accepted", () => {
    const r = trace("function f(): int\n  while true\n    print(1)\n  end\n  return 5\nend");
    expect(r.typeCodes).not.toContain("TY4001");
  });

  it("REGRESSION: a void function with no return is still accepted", () => {
    const r = trace("function f()\n  print(1)\nend");
    expect(r.typeCodes).not.toContain("TY4001");
  });

  it("REGRESSION: nested if/else/if where every path returns is still accepted (else-if chain)", () => {
    const r = trace("function f(x: int): int\n  if x == 1\n    return 1\n  else\n    if x == 2\n      return 2\n    else\n      return 3\n    end\n  end\nend");
    expect(r.typeCodes).not.toContain("TY4001");
  });

  it("REGRESSION: BUG-SA-001 (return outside a function) remains fixed, unaffected by this change", () => {
    const l = lex("return 5", "t.ur");
    const p = parse(l.tokens, "t.ur");
    const s = analyze(p.program);
    expect(s.diagnostics.map((d) => d.code)).toContain("SE5003");
  });

  it("an else-if chain with no final else still correctly triggers TY4001 (the algorithm does not understand condition semantics like 'not x' covering the remaining case - it only checks for a syntactic final else, which is correct for this minimal, conservative design)", () => {
    const r = trace("function f(x: bool): int\n  if x\n    return 1\n  else if not x\n    return 2\n  end\nend");
    expect(r.typeCodes).toContain("TY4001");
  });

  it("a while loop whose own body returns, but with no return after the loop, still correctly triggers TY4001 (a loop may never execute, so a return only inside it never counts as covering every path - matches the 'while does not count' rule already established)", () => {
    const r = trace("function f(x: bool): int\n  while x\n    return 1\n  end\nend");
    expect(r.typeCodes).toContain("TY4001");
  });
});
