import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";

// Independent, dedicated test - not dependent on BUG-SA-001's own fix
// happening to have covered this case by coincidence. Discovered
// while fixing BUG-SA-001 (same root cause: program.body was never
// walked), but tracked here as its own proven behavior with its own
// name, per explicit direction.

function run(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  const s = analyze(p.program);
  return s.diagnostics.map((d) => d.code);
}

describe("Script-mode break outside a loop", () => {
  it("break at top level (script mode), with no enclosing loop, produces SE5001", () => {
    expect(run("break")).toContain("SE5001");
  });

  it("a correctly-nested break inside a real loop at script-mode level is still accepted", () => {
    expect(run("while true\n  break\nend")).toEqual([]);
  });
});
