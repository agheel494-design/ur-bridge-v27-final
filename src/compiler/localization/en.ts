// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: English (en)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const en: LanguageDescriptor = {
  code: "en",
  name: "English",
  keywords: {
    "function": "FUNCTION",
    "func":     "FUNCTION",
    "let":      "LET",
    "var":      "LET",
    "type":     "TYPE",
    "struct":   "STRUCT",
    "import":   "IMPORT",
    "return":   "RETURN",
    "end":      "END",
    "if":       "IF",
    "else":     "ELSE",
    "while":    "WHILE",
    "for":      "FOR",
    "break":    "BREAK",
    "continue": "CONTINUE",
    "true":     "TRUE",
    "false":    "FALSE",
    "null":     "NULL",
    "in":       "IN",
  },
};
