// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Portuguese (pt)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const pt: LanguageDescriptor = {
  code: "pt",
  name: "Portuguese",
  keywords: {
    "funcao":     "FUNCTION",
    "seja":       "LET",
    "tipo":       "TYPE",
    "estrutura":  "STRUCT",
    "importar":   "IMPORT",
    "retornar":   "RETURN",
    "fim":        "END",
    "se":         "IF",
    "senao":      "ELSE",
    "enquanto":   "WHILE",
    "para":       "FOR",
    "pare":       "BREAK",
    "continue":   "CONTINUE",
    "verdadeiro": "TRUE",
    "falso":      "FALSE",
    "nulo":       "NULL",
    "em":         "IN",
  },
};
