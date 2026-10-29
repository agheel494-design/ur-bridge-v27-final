import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";

// Independent, dedicated test, per direct feedback - same reasoning
// as script_mode_break_outside_loop.test.ts.

function run(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  const s = analyze(p.program);
  return s.diagnostics.map((d) => d.code);
}

describe("Script-mode continue outside a loop", () => {
  it("continue at top level (script mode), with no enclosing loop, produces SE5002", () => {
    expect(run("continue")).toContain("SE5002");
  });

  it("a correctly-nested continue inside a real loop at script-mode level is still accepted", () => {
    expect(run("while true\n  continue\nend")).toEqual([]);
  });
});
