// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Lexer Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex, type Token, type TokenKind } from "../../../src/compiler/frontend/lexer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function kinds(src: string): TokenKind[] {
  return lex(src).tokens.map(t => t.kind);
}

function texts(src: string): string[] {
  return lex(src).tokens.map(t => t.text);
}

function noErrors(src: string): void {
  const r = lex(src);
  if (r.errors.length > 0) throw new Error(`Expected 0 errors, got: ${r.errors.map(e => e.message).join("; ")}`);
}

function firstKind(src: string): TokenKind {
  return lex(src).tokens[0]!.kind;
}

// ── Keyword canonicalization ──────────────────────────────────────────────────

describe("Lexer — keyword canonicalization (Arabic = English = same token)", () => {
  const pairs: [string, string, TokenKind][] = [
    ["function", "دالة",   "FUNCTION_KW"],
    ["func",     "دالة",   "FUNCTION_KW"],
    ["let",      "عرف",    "LET_KW"],
    ["var",      "دع",     "LET_KW"],
    ["type",     "نوع",    "TYPE_KW"],
    ["import",   "استورد", "IMPORT_KW"],
    ["return",   "أرجع",   "RETURN_KW"],
    ["end",      "نهاية",  "END_KW"],
    ["if",       "إذا",    "IF_KW"],
    ["else",     "وإلا",   "ELSE_KW"],
    ["while",    "بينما",  "WHILE_KW"],
    ["while",    "طالما",  "WHILE_KW"],
    ["for",      "لكل",    "FOR_KW"],
    ["break",    "اكسر",   "BREAK_KW"],
    ["continue", "تابع",   "CONTINUE_KW"],
    ["true",     "صحيح",  "TRUE_LIT"],
    ["false",    "خطأ",    "FALSE_LIT"],
    ["null",     "لاشيء",  "NULL_LIT"],
  ];

  for (const [eng, ar, expected] of pairs) {
    it(`"${eng}" and "${ar}" both produce ${expected}`, () => {
      expect(firstKind(eng)).toBe(expected);
      expect(firstKind(ar)).toBe(expected);
    });
  }
});

// ── END_KW is unified ─────────────────────────────────────────────────────────

describe("Lexer — END_KW is the single unified block terminator", () => {
  it('"end" produces END_KW', () => {
    expect(firstKind("end")).toBe("END_KW");
  });
  it('"نهاية" produces END_KW', () => {
    expect(firstKind("نهاية")).toBe("END_KW");
  });
  it("END_KW does NOT vary by block type — same token for function, if, while, for", () => {
    // The Lexer cannot and must not know what kind of block it closes.
    // All four uses produce the same END_KW token.
    const fn_end    = lex("function f()\nend\n").tokens.find(t => t.kind === "END_KW");
    const if_end    = lex("if x\nend\n").tokens.find(t => t.kind === "END_KW");
    const while_end = lex("while x\nend\n").tokens.find(t => t.kind === "END_KW");
    const for_end   = lex("for i in x\nend\n").tokens.find(t => t.kind === "END_KW");
    expect(fn_end?.kind).toBe("END_KW");
    expect(if_end?.kind).toBe("END_KW");
    expect(while_end?.kind).toBe("END_KW");
    expect(for_end?.kind).toBe("END_KW");
    // All carry the same surface text
    expect(fn_end?.text).toBe("end");
    expect(if_end?.text).toBe("end");
  });
  it('"endif", "endwhile", "endfn" are IDENTIFIERS, not keywords', () => {
    // These must never be reserved — spec §3.5 explicitly forbids them
    expect(firstKind("endif")).toBe("IDENTIFIER");
    expect(firstKind("endwhile")).toBe("IDENTIFIER");
    expect(firstKind("endfn")).toBe("IDENTIFIER");
  });
});

// ── Identifiers ────────────────────────────────────────────────────────────────

describe("Lexer — identifiers", () => {
  it("Latin ASCII identifier", () => {
    expect(firstKind("hello")).toBe("IDENTIFIER");
    expect(lex("hello").tokens[0]!.text).toBe("hello");
  });
  it("Arabic identifier", () => {
    expect(firstKind("اجمع")).toBe("IDENTIFIER");
  });
  it("Identifier with underscore", () => {
    expect(firstKind("_x")).toBe("IDENTIFIER");
    expect(firstKind("my_var")).toBe("IDENTIFIER");
  });
  it("Identifier with digits (not starting)", () => {
    expect(firstKind("x1")).toBe("IDENTIFIER");
  });
  it('"in" and "في" are IDENTIFIERS outside for context (not reserved)', () => {
    expect(firstKind("in")).toBe("IDENTIFIER");
    expect(firstKind("في")).toBe("IDENTIFIER");
  });
  it("Mixed Arabic-digit identifier", () => {
    expect(firstKind("متغير1")).toBe("IDENTIFIER");
  });
});

// ── Integer literals ──────────────────────────────────────────────────────────

describe("Lexer — integer literals", () => {
  it("decimal integer", () => {
    expect(firstKind("42")).toBe("INT_LIT");
    expect(lex("42").tokens[0]!.text).toBe("42");
  });
  it("hex integer", () => {
    expect(firstKind("0xFF")).toBe("INT_LIT");
    expect(lex("0xFF").tokens[0]!.text).toBe("0xFF");
  });
  it("binary integer", () => {
    expect(firstKind("0b1010")).toBe("INT_LIT");
  });
  it("underscore separators are stripped from value", () => {
    const t = lex("1_000_000").tokens[0]!;
    expect(t.kind).toBe("INT_LIT");
    expect(t.text).toBe("1000000");
  });
});

// ── Float literals ────────────────────────────────────────────────────────────

describe("Lexer — float literals", () => {
  it("basic float", () => {
    expect(firstKind("3.14")).toBe("FLOAT_LIT");
  });
  it("float with exponent", () => {
    expect(firstKind("1e10")).toBe("FLOAT_LIT");
    expect(firstKind("1.5e-3")).toBe("FLOAT_LIT");
  });
  it("integer without dot is INT_LIT not FLOAT_LIT", () => {
    expect(firstKind("42")).toBe("INT_LIT");
  });
});

// ── String literals ────────────────────────────────────────────────────────────

describe("Lexer — string literals", () => {
  it("empty string", () => {
    const t = lex('""').tokens[0]!;
    expect(t.kind).toBe("STRING_LIT");
    expect(t.text).toBe("");
  });
  it("ASCII string", () => {
    const t = lex('"hello"').tokens[0]!;
    expect(t.kind).toBe("STRING_LIT");
    expect(t.text).toBe("hello");
  });
  it("Arabic string", () => {
    const t = lex('"مرحبا"').tokens[0]!;
    expect(t.kind).toBe("STRING_LIT");
    expect(t.text).toBe("مرحبا");
  });
  it("emoji string", () => {
    const t = lex('"😀"').tokens[0]!;
    expect(t.kind).toBe("STRING_LIT");
    expect(t.text).toBe("😀");
  });
  it("escape sequences: \\n \\t \\\\ \\\"", () => {
    const t = lex('"a\\nb\\t\\\\"').tokens[0]!;
    expect(t.text).toBe("a\nb\t\\");
  });
  it("Unicode escape \\u{1F600}", () => {
    const t = lex('"\\u{1F600}"').tokens[0]!;
    expect(t.text).toBe("😀");
  });
  it("unterminated string produces LE002 error", () => {
    const r = lex('"hello');
    expect(r.errors[0]?.code).toBe("LE002");
  });
});

// ── Operators ─────────────────────────────────────────────────────────────────

describe("Lexer — operators", () => {
  const cases: [string, TokenKind][] = [
    ["+", "PLUS"], ["-", "MINUS"], ["*", "STAR"], ["/", "SLASH"], ["%", "PERCENT"],
    ["=", "EQ"], ["==", "EQ_EQ"], ["!=", "BANG_EQ"],
    ["<", "LT"], ["<=", "LT_EQ"], [">", "GT"], [">=", "GT_EQ"],
    ["&&", "AND"], ["||", "OR"], ["!", "BANG"],
    [".", "DOT"], [",", "COMMA"], [":", "COLON"],
    ["(", "LPAREN"], [")", "RPAREN"], ["[", "LBRACKET"], ["]", "RBRACKET"],
  ];
  for (const [src, expected] of cases) {
    it(`"${src}" → ${expected}`, () => {
      expect(firstKind(src)).toBe(expected);
    });
  }
  it("Arabic comma ، produces COMMA", () => {
    expect(firstKind("،")).toBe("COMMA");
  });
});

// ── Newlines ──────────────────────────────────────────────────────────────────

describe("Lexer — newlines", () => {
  it("LF produces NEWLINE token", () => {
    const k = kinds("a\nb");
    expect(k).toContain("NEWLINE");
  });
  it("CRLF produces one NEWLINE token (not two)", () => {
    const r = lex("a\r\nb");
    const newlines = r.tokens.filter(t => t.kind === "NEWLINE");
    expect(newlines).toHaveLength(1);
  });
  it("trailing EOF always present", () => {
    const r = lex("x");
    expect(r.tokens[r.tokens.length - 1]!.kind).toBe("EOF");
  });
});

// ── Comments ──────────────────────────────────────────────────────────────────

describe("Lexer — comments are discarded", () => {
  it("line comment produces no token", () => {
    const r = lex("// this is a comment\nx");
    const nonNewline = r.tokens.filter(t => t.kind !== "NEWLINE" && t.kind !== "EOF");
    expect(nonNewline[0]!.kind).toBe("IDENTIFIER");
    expect(nonNewline[0]!.text).toBe("x");
  });
  it("Arabic line comment", () => {
    const r = lex("// هذا تعليق\nx");
    const idents = r.tokens.filter(t => t.kind === "IDENTIFIER");
    expect(idents[0]!.text).toBe("x");
  });
  it("block comment produces no tokens", () => {
    const r = lex("/* comment */ x");
    const meaningful = r.tokens.filter(t => t.kind !== "EOF");
    expect(meaningful[0]!.kind).toBe("IDENTIFIER");
  });
  it("comment does NOT consume the following newline", () => {
    const r = lex("x // comment\ny");
    expect(r.tokens.some(t => t.kind === "NEWLINE")).toBe(true);
  });
});

describe("Lexer — Arabic diacritics (tashkeel) regression", () => {
  // Regression: discovered during Frontend integration testing. An
  // identifier containing a diacritic (e.g. shadda ّ U+0651 in "صنّف")
  // was split into two separate identifiers plus an ERROR token, because
  // isIdentContinue() did not recognize combining diacritic marks. This in
  // turn triggered an infinite loop in the Parser (see parser.test.ts
  // "ERROR token does not cause infinite loop").
  it("identifier containing shadda (ّ U+0651) is a single IDENTIFIER token", () => {
    const r = lex("صنّف");
    expect(r.errors).toHaveLength(0);
    expect(r.tokens[0]!.kind).toBe("IDENTIFIER");
    expect(r.tokens[0]!.text).toBe("صنّف");
  });
  it("identifier with fatha, kasra, damma diacritics", () => {
    // مَرْحَبًا with diacritics — should lex as one identifier, zero errors
    const r = lex("مَرْحَبًا");
    expect(r.errors).toHaveLength(0);
    expect(r.tokens[0]!.kind).toBe("IDENTIFIER");
  });
  it("keyword recognition still works when keyword itself has no diacritics", () => {
    // Ensure the diacritic fix didn't break plain keyword matching
    expect(firstKind("نهاية")).toBe("END_KW");
    expect(firstKind("دالة")).toBe("FUNCTION_KW");
  });
});

// ── Span tracking ─────────────────────────────────────────────────────────────

describe("Lexer — span tracking", () => {
  it("first token on line 1 col 1", () => {
    const t = lex("hello").tokens[0]!;
    expect(t.span.startLine).toBe(1);
    expect(t.span.startCol).toBe(1);
  });
  it("second line token has correct line number", () => {
    const r = lex("a\nb");
    const b = r.tokens.find(t => t.text === "b")!;
    expect(b.span.startLine).toBe(2);
    expect(b.span.startCol).toBe(1);
  });
  it("column accounts for multi-char tokens", () => {
    const r = lex("ab cd");
    const cd = r.tokens.find(t => t.text === "cd")!;
    expect(cd.span.startCol).toBe(4);
  });
  it("Arabic identifier column uses code-point offset, not byte offset", () => {
    // "مرحبا x" — Arabic word is 5 code points, then space, then x at col 7
    const r = lex("مرحبا x");
    const x = r.tokens.find(t => t.text === "x")!;
    expect(x.span.startCol).toBe(7); // 5 Arabic chars + 1 space + 1
  });
});

// ── Error recovery ────────────────────────────────────────────────────────────

describe("Lexer — error recovery", () => {
  it("unrecognized character produces LE001 error and ERROR token", () => {
    const r = lex("a @ b");
    const err = r.errors[0];
    expect(err?.code).toBe("LE001");
    const errorToken = r.tokens.find(t => t.kind === "ERROR");
    expect(errorToken?.text).toBe("@");
  });
  it("lexer continues after unrecognized character", () => {
    const r = lex("a @ b");
    const idents = r.tokens.filter(t => t.kind === "IDENTIFIER");
    expect(idents).toHaveLength(2);
    expect(idents[0]!.text).toBe("a");
    expect(idents[1]!.text).toBe("b");
  });
  it("multiple errors collected without abort", () => {
    const r = lex("@ $ # x");
    expect(r.errors).toHaveLength(3);
    expect(r.tokens.find(t => t.kind === "IDENTIFIER")?.text).toBe("x");
  });
  it("invalid unicode escape produces LE003 error", () => {
    const r = lex('"\\u{ZZZZ}"');
    const err = r.errors.find(e => e.code === "LE003");
    expect(err).toBeDefined();
  });
});

// ── Real program tokenization ─────────────────────────────────────────────────

describe("Lexer — real program tokenization", () => {
  const arabicProgram = `
استورد حساب

دالة اجمع(أ، ب)
    أرجع أ + ب
نهاية

اطبع(اجمع(5، 7))
`.trim();

  const englishProgram = `
import math

function add(a, b)
    return a + b
end

print(add(5, 7))
`.trim();

  it("Arabic program: zero lexer errors", () => {
    expect(lex(arabicProgram).errors).toHaveLength(0);
  });
  it("English program: zero lexer errors", () => {
    expect(lex(englishProgram).errors).toHaveLength(0);
  });

  it("both programs produce the same canonical token KIND sequence", () => {
    const arabicKinds = lex(arabicProgram).tokens.map(t => t.kind);
    const englishKinds = lex(englishProgram).tokens.map(t => t.kind);
    expect(arabicKinds).toEqual(englishKinds);
  });

  it("Arabic program contains IMPORT_KW → IDENTIFIER → NEWLINE", () => {
    const k = lex(arabicProgram).tokens.map(t => t.kind);
    const importIdx = k.indexOf("IMPORT_KW");
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(k[importIdx + 1]).toBe("IDENTIFIER");
  });

  it("FUNCTION_KW followed by IDENTIFIER 'اجمع'", () => {
    const tokens = lex(arabicProgram).tokens;
    const fnIdx = tokens.findIndex(t => t.kind === "FUNCTION_KW");
    expect(tokens[fnIdx + 1]?.kind).toBe("IDENTIFIER");
    expect(tokens[fnIdx + 1]?.text).toBe("اجمع");
  });

  it("END_KW appears once in the Arabic program", () => {
    const ends = lex(arabicProgram).tokens.filter(t => t.kind === "END_KW");
    expect(ends).toHaveLength(1);
    expect(ends[0]!.text).toBe("نهاية");
  });

  it("END_KW appears once in the English program", () => {
    const ends = lex(englishProgram).tokens.filter(t => t.kind === "END_KW");
    expect(ends).toHaveLength(1);
    expect(ends[0]!.text).toBe("end");
  });
});

describe("Lexer — language mixing", () => {
  it("Arabic keywords and English identifiers in same file: zero errors", () => {
    const mixed = `استورد sqlite\nدالة main()\n  let x = 42\nنهاية`;
    expect(lex(mixed).errors).toHaveLength(0);
  });
  it("mixed file produces same canonical tokens as pure-Arabic or pure-English equivalent", () => {
    const mixed = `import حساب\nfunction اجمع(a, b)\n  return a + b\nنهاية`;
    const r = lex(mixed);
    expect(r.errors).toHaveLength(0);
    const k = r.tokens.map(t => t.kind);
    expect(k[0]).toBe("IMPORT_KW");
    expect(k[2]).toBe("NEWLINE");
    expect(k[3]).toBe("FUNCTION_KW");
    expect(k[k.indexOf("END_KW")]).toBe("END_KW");
  });
});

describe("Lexer - LANGUAGE FREEZE FIX: char literal syntax (was entirely absent, SPEC_IMPLEMENTATION_MATRIX.md finding)", () => {
  it("FIXED: a single-character literal 'a' produces exactly one CHAR_LIT token with value 'a'", () => {
    const { tokens } = lex("'a'");
    const charTok = tokens.find(t => t.kind === "CHAR_LIT");
    expect(charTok?.text).toBe("a");
  });

  it("FIXED: an empty char literal '' is rejected with LE005", () => {
    const { errors } = lex("''") as any;
    expect(errors.some((e: any) => e.code === "LE005")).toBe(true);
  });

  it("FIXED: a multi-character literal 'ab' is rejected with LE005", () => {
    const { errors } = lex("'ab'") as any;
    expect(errors.some((e: any) => e.code === "LE005")).toBe(true);
  });

  it("FIXED: escape sequences work the same as in string literals (\\n)", () => {
    const { tokens } = lex("'\\n'");
    const charTok = tokens.find(t => t.kind === "CHAR_LIT");
    expect(charTok?.text).toBe("\n");
  });
});
