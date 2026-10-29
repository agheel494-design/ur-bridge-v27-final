// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: German (de)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const de: LanguageDescriptor = {
  code: "de",
  name: "German",
  keywords: {
    "funktion":    "FUNCTION",
    "sei":         "LET",
    "typ":         "TYPE",
    "struktur":    "STRUCT",
    "importieren": "IMPORT",
    "zurueckgeben":"RETURN",
    "ende":        "END",
    "wenn":        "IF",
    "sonst":       "ELSE",
    "waehrend":    "WHILE",
    "fuer":        "FOR",
    "abbrechen":   "BREAK",
    "weiter":      "CONTINUE",
    "wahr":        "TRUE",
    "falsch":      "FALSE",
    "null":        "NULL",
    "in":          "IN",
  },
};
