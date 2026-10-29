import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";

// Parser Audit - closes the 3 previously-untested codes found in the
// full-scope inventory: PE005, PE006, PE007. All 11 ParseError codes
// were confirmed used (0 dormant), only these 3 lacked coverage.

function codes(src: string) {
  const l = lex(src, "t.ur");
  const p = parse(l.tokens, "t.ur");
  return p.errors.map((e) => e.code);
}

describe("Parser Audit: previously-untested codes", () => {
  it("PE005: missing name after 'type'/'struct'/'function' keyword", () => {
    expect(codes("type = int")).toContain("PE005");
  });

  it("PE006: missing identifier after 'let'", () => {
    expect(codes("let = 5")).toContain("PE006");
  });

  it("PE007: missing '=' in a let statement (no initializer)", () => {
    expect(codes("let x: int")).toContain("PE007");
  });
});
