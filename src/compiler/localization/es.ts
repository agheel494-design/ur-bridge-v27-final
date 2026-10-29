// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Spanish (es)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const es: LanguageDescriptor = {
  code: "es",
  name: "Spanish",
  keywords: {
    "funcion":   "FUNCTION",
    "sea":       "LET",
    "tipo":      "TYPE",
    "estructura":"STRUCT",
    "importar":  "IMPORT",
    "retornar":  "RETURN",
    "fin":       "END",
    "si":        "IF",
    "sino":      "ELSE",
    "mientras":  "WHILE",
    "para":      "FOR",
    "romper":    "BREAK",
    "continuar": "CONTINUE",
    "verdadero": "TRUE",
    "falso":     "FALSE",
    "nulo":      "NULL",
    "en":        "IN",
  },
};
