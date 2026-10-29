// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: French (fr)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const fr: LanguageDescriptor = {
  code: "fr",
  name: "French",
  keywords: {
    "fonction":  "FUNCTION",
    "soit":      "LET",
    "type":      "TYPE",
    "structure": "STRUCT",
    "importer":  "IMPORT",
    "retourner": "RETURN",
    "fin":       "END",
    "si":        "IF",
    "sinon":     "ELSE",
    "tantque":   "WHILE",
    "pour":      "FOR",
    "arreter":   "BREAK",
    "continuer": "CONTINUE",
    "vrai":      "TRUE",
    "faux":      "FALSE",
    "nul":       "NULL",
    "dans":      "IN",
  },
};
