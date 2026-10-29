// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Chinese, Simplified (zh)
// ─────────────────────────────────────────────────────────────────────────────
// Pure data. No logic, no TokenKind references, no knowledge of the Parser,
// Semantic Analyzer, Type Checker, or Runtime.
// ─────────────────────────────────────────────────────────────────────────────

import type { LanguageDescriptor } from "./canonical.js";

export const zh: LanguageDescriptor = {
  code: "zh",
  name: "Chinese (Simplified)",
  keywords: {
    "函数": "FUNCTION",
    "设":   "LET",
    "类型": "TYPE",
    "结构": "STRUCT",
    "导入": "IMPORT",
    "返回": "RETURN",
    "结束": "END",
    "如果": "IF",
    "否则": "ELSE",
    "当":   "WHILE",
    "对于": "FOR",
    "中断": "BREAK",
    "继续": "CONTINUE",
    "真":   "TRUE",
    "假":   "FALSE",
    "空":   "NULL",
    "在":   "IN",
  },
};
