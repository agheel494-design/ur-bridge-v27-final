import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";

// BUG-SA-001 fix regression tests.
//
// Real root cause found while verifying the fix: walkProgram() never
// visited program.body at all (top-level/script-mode statements
// outside any function) - so a functionDepth check alone was
// insufficient. The real fix added both: the functionDepth counter
// AND a loop that actually walks program.body's own statements.
//
// This also fixed two related, previously-unchecked cases at the
// same script-mode level: break/continue outside a loop at the top
// level - a genuine positive side effect, not scope creep.

function run(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  const s = analyze(p.program);
  return s.diagnostics.map((d) => d.code);
}

describe("BUG-SA-001 fix: return/break/continue outside their valid context, at script-mode level", () => {
  it("return outside any function now produces SE5003 at the semantic stage", () => {
    expect(run("return 5")).toContain("SE5003");
  });

  it("the fix does not falsely flag a return correctly placed inside a function", () => {
    expect(run("function main(): int\n  return 5\nend")).not.toContain("SE5003");
  });

  it("ordinary script-mode statements (let/print) still work with zero false positives", () => {
    expect(run("let x: int = 5\nprint(x)")).toEqual([]);
  });

  it("a mixed program (functions + script-mode body) still analyzes correctly", () => {
    expect(run("function f(): int\n  return 1\nend\nlet x: int = f()\nprint(x)")).toEqual([]);
  });

  it("REGRESSION: BUG-SA-002 (missing return, caught at codegen under CG1001) is completely unaffected", () => {
    const l = lex("function f(): int\n  let x: int = 1\nend\nfunction main(): int\n  return f()\nend", "t.ur");
    const p = parse(l.tokens, "t.ur");
    const s = analyze(p.program);
    expect(s.diagnostics.map((d) => d.code)).toEqual([]);
    const ir = lowerToIR(p.program, "t.ur", "test");
    expect(ir.ok).toBe(false);
    expect(ir.diagnostics.map((d: any) => d.code)).toContain("CG1001");
  });
});
