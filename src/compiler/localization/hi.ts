// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Hindi (hi)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
//
// Note: Hindi (Devanagari script, U+0900-U+097F) required extending the
// Lexer's Unicode identifier ranges (isUnicodeLetter/isIdentContinue in
// lexer.ts) to recognize Devanagari letters and combining marks (matras).
// This was an additive Unicode-range extension only — no existing range
// or logic was modified. See lexer.test.ts for the corresponding tests.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const hi: LanguageDescriptor = {
  code: "hi",
  name: "Hindi",
  keywords: {
    "कार्य":  "FUNCTION",
    "मान":    "LET",
    "प्रकार": "TYPE",
    "संरचना": "STRUCT",
    "आयात":   "IMPORT",
    "वापस":   "RETURN",
    "समाप्त": "END",
    "अगर":    "IF",
    "अन्यथा": "ELSE",
    "जबतक":   "WHILE",
    "प्रत्येक": "FOR",
    "रोक":    "BREAK",
    "जारी":   "CONTINUE",
    "सत्य":   "TRUE",
    "असत्य":  "FALSE",
    "शून्य":  "NULL",
    "में":    "IN",
  },
};
