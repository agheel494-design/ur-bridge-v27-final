// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Russian (ru)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const ru: LanguageDescriptor = {
  code: "ru",
  name: "Russian",
  keywords: {
    "функция":    "FUNCTION",
    "пусть":      "LET",
    "тип":        "TYPE",
    "структура":  "STRUCT",
    "импорт":     "IMPORT",
    "вернуть":    "RETURN",
    "конец":      "END",
    "если":       "IF",
    "иначе":      "ELSE",
    "пока":       "WHILE",
    "для":        "FOR",
    "прервать":   "BREAK",
    "продолжить": "CONTINUE",
    "истина":     "TRUE",
    "ложь":       "FALSE",
    "нуль":       "NULL",
    "в":          "IN",
  },
};
