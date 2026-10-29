// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Canonical Keyword Vocabulary
// Specification: UR_LANGUAGE_SPEC_1_0.md §3
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the ONLY file in src/compiler/localization/ that references
// TokenKind. Every per-language file (ar.ts, en.ts, fr.ts, ...) maps surface
// words to one of the CanonicalKeyword values below — nothing else. This
// keeps the Language Mapper committed to a fixed, closed vocabulary that
// the Lexer already understands, so adding a language never requires
// touching the Lexer, Parser, AST, Semantic Analyzer, or Type System.
//
// Architecture (mandated):
//   User Source → Language Mapper → Canonical Keywords → Lexer → Parser → ...
//
// The Language Mapper (index.ts in this directory) is responsible ONLY for
// turning a surface word into a CanonicalKeyword. It has zero knowledge of
// Parser, Semantic, Type Checker, or Runtime — enforced by architecture
// tests (see tests/platform/architecture-rules.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { TokenKind } from "../frontend/lexer.js";

/**
 * The closed set of canonical keyword concepts every supported language
 * must be able to express. This list must stay in lockstep with the
 * keyword-producing TokenKind values in lexer.ts's KEYWORD_MAP — adding a
 * new canonical keyword here without a corresponding TokenKind (or vice
 * versa) is a contract violation caught by tests/compiler/localization/.
 */
export type CanonicalKeyword =
  | "FUNCTION" | "LET" | "TYPE" | "STRUCT" | "IMPORT" | "RETURN" | "END"
  | "IF" | "ELSE" | "WHILE" | "FOR" | "BREAK" | "CONTINUE"
  | "TRUE" | "FALSE" | "NULL"
  | "IN"; // contextual — used only inside `for`, never globally reserved

/** Maps each CanonicalKeyword to the TokenKind the Lexer already recognizes. */
export const CANONICAL_TO_TOKEN: Record<CanonicalKeyword, TokenKind> = {
  FUNCTION: "FUNCTION_KW",
  LET:      "LET_KW",
  TYPE:     "TYPE_KW",
  STRUCT:   "STRUCT_KW",
  IMPORT:   "IMPORT_KW",
  RETURN:   "RETURN_KW",
  END:      "END_KW",
  IF:       "IF_KW",
  ELSE:     "ELSE_KW",
  WHILE:    "WHILE_KW",
  FOR:      "FOR_KW",
  BREAK:    "BREAK_KW",
  CONTINUE: "CONTINUE_KW",
  TRUE:     "TRUE_LIT",
  FALSE:    "FALSE_LIT",
  NULL:     "NULL_LIT",
  IN:       "IDENTIFIER", // contextual, not globally reserved — see spec §5.8
};

/**
 * A per-language keyword table: surface word → canonical keyword.
 * This is the ONLY shape a language file may export. It contains no
 * TokenKind values directly and no logic — pure data.
 */
export type LanguageKeywordTable = Readonly<Record<string, CanonicalKeyword>>;

/** Metadata every language module must declare, for diagnostics and tooling. */
export type LanguageDescriptor = {
  /** ISO 639-1 code, e.g. "ar", "en", "fr". */
  code: string;
  /** Human-readable name in English, for logs/diagnostics. */
  name: string;
  /** The keyword table itself. */
  keywords: LanguageKeywordTable;
};
