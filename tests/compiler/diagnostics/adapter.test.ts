import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { fromLexError, fromParseError, fromSemanticDiagnostic, fromTypeDiagnostic } from "../../../src/compiler/diagnostics/adapter.js";

describe("Diagnostics Adapter - 4 independent real conversion paths (per explicit review requirement, no synthetic data for the primary path in each)", () => {
  it("LexError (real unterminated string) converts correctly", () => {
    const result = lex('let x = "unterminated', "test.ur");
    expect(result.errors.length).toBe(1);
    const converted = fromLexError(result.errors[0]);
    expect(converted.code).toBe("LE002");
    expect(converted.file).toBe("test.ur");
    expect(converted.severity).toBe("error");
  });

  it("ParseError (real missing closing paren) converts correctly", () => {
    const lexResult = lex('function main(): int\n  print(1\nend', "test.ur");
    const parseResult = parse(lexResult.tokens, "test.ur");
    expect(parseResult.errors.length).toBe(1);
    const converted = fromParseError(parseResult.errors[0], "test.ur");
    expect(converted.code).toBe("PE003");
    expect(converted.line).toBe(3);
  });

  it("SemanticDiagnostic (real undefined symbol) converts correctly", () => {
    const lexResult = lex('function main(): int\n  print(undefined_var)\nend', "test.ur");
    const parseResult = parse(lexResult.tokens, "test.ur");
    const semResult = analyze(parseResult.program);
    expect(semResult.diagnostics.length).toBeGreaterThan(0);
    const converted = fromSemanticDiagnostic(semResult.diagnostics[0], "test.ur");
    expect(converted.code).toBe("SE1001");
  });

  it("TypeDiagnostic (real type mismatch) converts correctly", () => {
    const lexResult = lex('function main(): int\n  let x: int = "text"\nend', "test.ur");
    const parseResult = parse(lexResult.tokens, "test.ur");
    const typeResult = typeCheck(parseResult.program);
    expect(typeResult.diagnostics.length).toBeGreaterThan(0);
    const converted = fromTypeDiagnostic(typeResult.diagnostics[0], "test.ur");
    expect(converted.code).toBe("TY2002");
  });
});
