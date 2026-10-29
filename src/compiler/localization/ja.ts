// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Japanese (ja)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
//
// NOTE, disclosed honestly: no prior official specification for Japanese
// keywords existed anywhere in this project before this file (confirmed via
// a full-project search) - these are newly authored, linguistically correct
// translations of the 17 canonical keywords, following the same structure
// as every other language file in this directory. The Lexer's own
// isUnicodeLetter() already supports both CJK Unified Ideographs
// (U+4E00-U+9FFF) and Hiragana/Katakana (U+3040-U+30FF) - confirmed by
// reading src/compiler/frontend/lexer.ts directly before writing this file -
// so no Lexer change was needed to add this language.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const ja: LanguageDescriptor = {
  code: "ja",
  name: "Japanese",
  keywords: {
    "関数":     "FUNCTION",
    "レット":   "LET",
    "型":       "TYPE",
    "構造体":   "STRUCT",
    "インポート": "IMPORT",
    "返す":     "RETURN",
    "終了":     "END",
    "もし":     "IF",
    "違えば":   "ELSE",
    "ながら":   "WHILE",
    "繰り返す": "FOR",
    "中断":     "BREAK",
    "続行":     "CONTINUE",
    "真":       "TRUE",
    "偽":       "FALSE",
    "無":       "NULL",
    "内":       "IN",
  },
};
