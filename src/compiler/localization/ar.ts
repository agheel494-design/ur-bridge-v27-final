// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Arabic (ar)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const ar: LanguageDescriptor = {
  code: "ar",
  name: "Arabic",
  keywords: {
    "دالة":   "FUNCTION",
    "عرف":    "LET",
    "دع":     "LET",
    "نوع":    "TYPE",
    "بنية":   "STRUCT",
    "استورد": "IMPORT",
    "أرجع":   "RETURN",
    "نهاية":  "END",
    "إذا":    "IF",
    "وإلا":   "ELSE",
    "بينما":  "WHILE",
    "طالما":  "WHILE",
    "لكل":    "FOR",
    "اكسر":   "BREAK",
    "تابع":   "CONTINUE",
    "صحيح":   "TRUE",
    "خطأ":    "FALSE",
    "لاشيء":  "NULL",
    "في":     "IN",
  },
};
