// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Layer C, Gate C-1: Grammar Extraction & Contract
// ─────────────────────────────────────────────────────────────────────────────
//
// Produces ONE generatable data contract for a future VS Code TextMate
// grammar, sourced directly from the REAL, already-tested Language Mapper
// (src/compiler/localization/) — not hand-transcribed. Every surface
// keyword and every alias for all 10 shipped languages is included, since
// this script imports the real ALL_LANGUAGES export and iterates it
// directly rather than typing words from memory.
//
// Per the C-1 authorization: does NOT modify the Lexer, Parser, Language
// Mapper, or any keyword data. Read-only consumer of existing, already-
// ratified exports (ALL_LANGUAGES, detectCrossLanguageCollisions).
//
// Universal lexical rules (comments, strings, numbers, identifiers,
// operators, punctuation) are NOT per-language — they come from lexer.ts
// itself, cited by exact line reference below, not guessed.

import { ALL_LANGUAGES, detectCrossLanguageCollisions } from "../../src/compiler/localization/index.js";
import type { CanonicalKeyword } from "../../src/compiler/localization/canonical.js";

export type KeywordEntry = {
  readonly surfaceWord: string;
  readonly canonical: CanonicalKeyword;
  readonly languageCode: string;
  readonly languageName: string;
};

export type GrammarContract = {
  readonly generatedFrom: string;
  readonly languages: ReadonlyArray<{ code: string; name: string }>;
  readonly keywords: readonly KeywordEntry[];
  readonly crossLanguageCollisions: ReturnType<typeof detectCrossLanguageCollisions>;
  readonly lexicalRules: {
    readonly identifierStart: string;
    readonly identifierContinue: string;
    readonly lineComment: string;
    readonly blockComment: string;
    readonly stringLiteral: string;
    readonly numberLiteral: string;
    readonly operators: readonly string[];
    readonly punctuationNotes: readonly string[];
  };
};

/** Extracts every surface keyword, for every language, with every alias -
 *  by iterating the REAL ALL_LANGUAGES export directly. No word in this
 *  list is typed by hand; each one comes from Object.entries() on a real
 *  language module's own `keywords` table. */
function extractAllKeywords(): KeywordEntry[] {
  const entries: KeywordEntry[] = [];
  for (const lang of ALL_LANGUAGES) {
    for (const [surfaceWord, canonical] of Object.entries(lang.keywords)) {
      entries.push({ surfaceWord, canonical, languageCode: lang.code, languageName: lang.name });
    }
  }
  return entries;
}

export function buildGrammarContract(): GrammarContract {
  const keywords = extractAllKeywords();
  const collisions = detectCrossLanguageCollisions();

  return {
    generatedFrom: "src/compiler/localization/index.ts (ALL_LANGUAGES, detectCrossLanguageCollisions) - real exports, not transcribed",
    languages: ALL_LANGUAGES.map(l => ({ code: l.code, name: l.name })),
    keywords,
    crossLanguageCollisions: collisions,
    lexicalRules: {
      // Every rule below cites the exact source in src/compiler/frontend/lexer.ts
      // it was read from this round - not assumed, not guessed.
      identifierStart:
        "isIdentStart (lexer.ts ~L156-158): a Unicode letter (per isUnicodeLetter, ~L120-153: " +
        "ASCII, Arabic U+0621-063A/U+0641-064A/U+066E-06FF/U+0750-077F/U+FB50-FDFF/U+FE70-FEFF, " +
        "Latin Extended U+00C0-024F, Greek U+0370-03FF, Cyrillic U+0400-04FF, " +
        "CJK U+4E00-9FFF, Devanagari U+0900-0961/U+0971-097F, Hiragana/Katakana U+3040-30FF) or underscore (0x5F)",
      identifierContinue:
        "isIdentContinue (lexer.ts ~L160-172): identifierStart, OR ASCII digit 0-9, OR " +
        "Arabic tashkeel diacritics U+064B-065F/U+0670, OR Devanagari combining marks " +
        "U+0900-0903/U+093A-094F/U+0955-0963/U+0966-096F (Devanagari digits)",
      lineComment: "// (lexer.ts ~L256, verified present)",
      blockComment: "/* ... */ (lexer.ts ~L262, verified present)",
      stringLiteral: "quoted text; both \" and ' delimiters, both with escape handling confirmed (lexer.ts ~L287, ~L332)",
      numberLiteral: "INT_LIT / FLOAT_LIT (lexer.ts ~L47-48, ~L397) - distinguished by presence of a decimal point",
      operators: [
        "+ (PLUS)", "- (MINUS)", "* (STAR)", "/ (SLASH)", "% (PERCENT)",
        "= (EQ)", "== (EQ_EQ)", "!= (BANG_EQ)",
        "< (LT)", "<= (LT_EQ)", "> (GT)", ">= (GT_EQ)",
        "&& (AND)", "|| (OR)", "! (BANG)",
      ],
      punctuationNotes: [
        ". (DOT)",
        ", or \u060C — Arabic comma U+060C also produces COMMA (lexer.ts ~L431, verified present) - a genuinely multilingual punctuation detail, not assumed",
        ": (COLON)",
        "( ) (LPAREN/RPAREN)",
        "[ ] (LBRACKET/RBRACKET)",
        "IN is CONTEXTUAL, not a globally-reserved keyword (canonical.ts: CANONICAL_TO_TOKEN.IN = \"IDENTIFIER\") - only meaningful inside a for...in construct; a grammar may choose to highlight it unconditionally as a simplification, or only in that context - not decided by this contract",
      ],
    },
  };
}
