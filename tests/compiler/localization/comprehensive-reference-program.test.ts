import { describe, it, expect } from "vitest";
import { ALL_LANGUAGES } from "../../../src/compiler/localization/index.js";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";

// UR 1.0 Comprehensive Reference Program - full pipeline, all 10
// languages, per explicit direction. Uses ONLY features confirmed
// genuinely supported end-to-end (Lexer->Parser->Semantic->
// TypeChecker->Canonical IR) - see docs/architecture/
// UR_1.0_LANGUAGE_COVERAGE.md for the full, per-feature evidence
// table.

function wordFor(lang: any, canonical: string): string {
  for (const [word, c] of Object.entries(lang.keywords)) {
    if (c === canonical) return word;
  }
  throw new Error(`No word for ${canonical} in ${lang.code}`);
}

function buildReferenceProgram(lang: any): string {
  const T = (c: string) => wordFor(lang, c);
  return `${T("TYPE")} Integer = int

${T("FUNCTION")} factorial(n: int): int
  ${T("IF")} n == 0
    ${T("RETURN")} 1
  ${T("ELSE")}
    ${T("RETURN")} n * factorial(n - 1)
  ${T("END")}
${T("END")}

${T("FUNCTION")} sumRange(n: int): int
  ${T("LET")} result: int = 0
  ${T("LET")} i: int = 0
  ${T("WHILE")} i < n
    ${T("IF")} i == 3
      i = i + 1
    ${T("ELSE")}
      result = result + i
      i = i + 1
    ${T("END")}
  ${T("END")}
  ${T("RETURN")} result
${T("END")}

${T("FUNCTION")} main(): int
  ${T("LET")} valid: bool = ${T("TRUE")}
  ${T("IF")} valid == ${T("FALSE")}
    ${T("RETURN")} 0
  ${T("END")}
  ${T("LET")} count: int = 5
  ${T("LET")} fact5: int = factorial(5)
  ${T("RETURN")} sumRange(count) + fact5
${T("END")}
`;
}

function stripIdentifierText(node: any): any {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(stripIdentifierText);
  const out: any = {};
  for (const key of Object.keys(node)) {
    if (key === "span" || key === "name" || key === "binding" || key === "path") continue;
    out[key] = stripIdentifierText(node[key]);
  }
  return out;
}

describe("UR 1.0 Comprehensive Reference Program: full pipeline, all 10 languages, zero manual editing", () => {
  for (const lang of ALL_LANGUAGES as any[]) {
    it(`${lang.code} (${lang.name}): zero errors through Lexer, Parser, Semantic, TypeChecker, and Canonical IR`, () => {
      const src = buildReferenceProgram(lang);
      const l = lex(src, `${lang.code}.ur`);
      expect(l.errors.length).toBe(0);
      const p = parse(l.tokens, `${lang.code}.ur`);
      expect(p.errors.length).toBe(0);
      const sem = analyze(p.program);
      expect(sem.diagnostics.length).toBe(0);
      const tc = typeCheck(p.program);
      expect(tc.diagnostics.length).toBe(0);
      const ir = lowerToIR(p.program, `${lang.code}.ur`, `mod_${lang.code}`);
      expect(ir.ok).toBe(true);
    });
  }

  it("all 10 languages produce a STRUCTURALLY IDENTICAL AST for the reference program (identifier text stripped, everything else compared byte-for-byte)", () => {
    const fingerprints: Record<string, string> = {};
    for (const lang of ALL_LANGUAGES as any[]) {
      const src = buildReferenceProgram(lang);
      const tokens = lex(src, `${lang.code}.ur`).tokens;
      const program = parse(tokens, `${lang.code}.ur`).program;
      fingerprints[lang.code] = JSON.stringify(stripIdentifierText(program));
    }
    const baseline = fingerprints["en"]!;
    for (const [code, fp] of Object.entries(fingerprints)) {
      expect(fp).toBe(baseline);
    }
  });
});
