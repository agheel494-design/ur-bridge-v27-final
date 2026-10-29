// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Lexer
// Specification: UR_LANGUAGE_SPEC_1_0.md
// ─────────────────────────────────────────────────────────────────────────────
//
// Converts UTF-8 source text into a Token[]. Both Arabic and English surface
// forms map to identical canonical TokenKind values — the Parser and all
// downstream stages never see surface-language variation.
//
// Design invariants (must never be violated):
//   1. The Lexer emits ONE token kind per concept (FUNCTION_KW for both
//      "function" and "دالة"). Adding a new surface language = adding rows
//      to KEYWORD_MAP, nothing else.
//   2. END_KW is the single unified block terminator. The Lexer does NOT
//      know what kind of block it terminates — that is the Parser's job
//      (Block Stack). No "endif", "endwhile", "endfn" ever.
//   3. Error recovery: on any unrecognized character the Lexer emits an
//      ERROR token and continues. It never aborts. All errors are
//      collected in the returned LexResult.errors array.
//   4. Every token carries a Span with 1-based line/col (code-point offset,
//      not byte offset). This is required for LSP and diagnostics.
// ─────────────────────────────────────────────────────────────────────────────

// ── Token types ────────────────────────────────────────────────────────────

export type TokenKind =
  // Declaration keywords
  | "FUNCTION_KW"  // function / func / دالة
  | "LET_KW"       // let / var / عرف / دع
  | "TYPE_KW"      // type / نوع
  | "STRUCT_KW"    // struct / بنية — Level 2.8, per LANGUAGE_SYNTAX_1_1_SPEC.md §2.1
  | "IMPORT_KW"    // import / استورد
  | "RETURN_KW"    // return / أرجع
  | "END_KW"       // end / نهاية  — unified block terminator
  // Control flow keywords
  | "IF_KW"        // if / إذا
  | "ELSE_KW"      // else / وإلا
  | "WHILE_KW"     // while / بينما / طالما
  | "FOR_KW"       // for / لكل
  | "BREAK_KW"     // break / اكسر
  | "CONTINUE_KW"  // continue / تابع
  // Literal keywords
  | "TRUE_LIT"     // true / صحيح
  | "FALSE_LIT"    // false / خطأ
  | "NULL_LIT"     // null / لاشيء
  // Literals
  | "INT_LIT"
  | "FLOAT_LIT"
  | "STRING_LIT"
  | "CHAR_LIT"
  | "IDENTIFIER"
  // Operators
  | "PLUS"         // +
  | "MINUS"        // -
  | "STAR"         // *
  | "SLASH"        // /
  | "PERCENT"      // %
  | "EQ"           // =
  | "EQ_EQ"        // ==
  | "BANG_EQ"      // !=
  | "LT"           // <
  | "LT_EQ"        // <=
  | "GT"           // >
  | "GT_EQ"        // >=
  | "AND"          // &&
  | "OR"           // ||
  | "BANG"         // !
  | "DOT"          // .
  | "COMMA"        // , or ،
  | "COLON"        // :
  | "LPAREN"       // (
  | "RPAREN"       // )
  | "LBRACKET"     // [
  | "RBRACKET"     // ]
  // Structure
  | "NEWLINE"      // \n (statement separator)
  | "EOF"
  | "ERROR";       // unrecognized character — Lexer continues

export type Span = {
  readonly file: string;
  readonly startLine: number;  // 1-based
  readonly startCol: number;   // 1-based, code-point offset
  readonly endLine: number;
  readonly endCol: number;
};

export type Token = {
  readonly kind: TokenKind;
  readonly text: string;      // original surface text
  readonly span: Span;
};

export type LexError = {
  readonly code: "LE001" | "LE002" | "LE003" | "LE004" | "LE005";
  readonly message: string;
  readonly span: Span;
};

export type LexResult = {
  readonly tokens: Token[];
  readonly errors: LexError[];
};

// ── Canonical keyword lookup ────────────────────────────────────────────────
//
// The Lexer no longer hardcodes any language's keyword text. All surface
// words for all supported languages (Arabic, English, French, Spanish,
// German, Japanese, Russian, Chinese, Portuguese, Hindi) are aggregated by
// the Language Mapper in src/compiler/localization/index.ts. Adding a new
// language means adding a file there — this file never changes.
//
//   User Source → Language Mapper → Canonical Keywords → Lexer (HERE) → Parser
//
import { AGGREGATED_KEYWORD_MAP } from "../localization/index.js";
const KEYWORD_MAP: ReadonlyMap<string, TokenKind> = AGGREGATED_KEYWORD_MAP;

// ── Unicode helpers ────────────────────────────────────────────────────────

function isUnicodeLetter(cp: number): boolean {
  // Fast path for ASCII letters
  if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) return true;
  // Underscore
  if (cp === 0x5F) return true;
  // Arabic letters: U+0621–U+063A (basic Arabic letters: ء-غ)
  if (cp >= 0x0621 && cp <= 0x063A) return true;
  // Arabic letters: U+0641–U+064A (ف-ي)
  if (cp >= 0x0641 && cp <= 0x064A) return true;
  // Arabic letters with diacritics: U+0660–U+0669 are digits, skip
  // Arabic Extended letters: U+066E–U+06FF (excluding punctuation at start of block)
  if (cp >= 0x066E && cp <= 0x06FF) return true;
  // Note: U+0600–U+0620 and U+063B–U+0640 are Arabic control/punctuation — excluded
  // Extended Arabic: U+0750–U+077F
  if (cp >= 0x0750 && cp <= 0x077F) return true;
  // Arabic Presentation Forms: U+FB50–U+FDFF, U+FE70–U+FEFF
  if (cp >= 0xFB50 && cp <= 0xFDFF) return true;
  if (cp >= 0xFE70 && cp <= 0xFEFF) return true;
  // Latin Extended: U+00C0–U+024F
  if (cp >= 0x00C0 && cp <= 0x024F) return true;
  // Greek: U+0370–U+03FF
  if (cp >= 0x0370 && cp <= 0x03FF) return true;
  // Cyrillic: U+0400–U+04FF
  if (cp >= 0x0400 && cp <= 0x04FF) return true;
  // CJK Unified Ideographs: U+4E00–U+9FFF
  if (cp >= 0x4E00 && cp <= 0x9FFF) return true;
  // Devanagari (Hindi): U+0900–U+0961 letters (excludes U+0962-0963 marks,
  // U+0966-096F digits which are handled separately by isDigit's caller context)
  if (cp >= 0x0900 && cp <= 0x0961) return true;
  if (cp >= 0x0971 && cp <= 0x097F) return true;
  // Hiragana/Katakana: U+3040–U+30FF
  if (cp >= 0x3040 && cp <= 0x30FF) return true;
  return false;
}

function isIdentStart(cp: number): boolean {
  return isUnicodeLetter(cp) || cp === 0x5F; // underscore
}

function isIdentContinue(cp: number): boolean {
  if (isIdentStart(cp) || (cp >= 0x30 && cp <= 0x39)) return true; // 0-9
  // Arabic diacritics (tashkeel): combining marks that attach to a
  // preceding letter (e.g. shadda ّ U+0651, fatha َ U+064E, etc.)
  // These cannot start an identifier but are valid mid-identifier.
  if (cp >= 0x064B && cp <= 0x065F) return true;
  if (cp === 0x0670) return true; // superscript alef
  // Devanagari (Hindi) combining marks: matras (vowel signs) and virama.
  // Same rationale as Arabic diacritics above — cannot start an
  // identifier but attach to a preceding consonant mid-identifier.
  if (cp >= 0x0900 && cp <= 0x0903) return true; // candrabindu, anusvara, visarga
  if (cp >= 0x093A && cp <= 0x094F) return true; // matras + virama
  if (cp >= 0x0955 && cp <= 0x0963) return true; // additional vowel signs
  if (cp >= 0x0966 && cp <= 0x096F) return true; // Devanagari digits
  return false;
}

function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

function isHexDigit(cp: number): boolean {
  return isDigit(cp) ||
    (cp >= 0x41 && cp <= 0x46) ||  // A-F
    (cp >= 0x61 && cp <= 0x66);     // a-f
}

// ── Lexer ──────────────────────────────────────────────────────────────────

export function lex(source: string, file = "<input>"): LexResult {
  // Convert source to array of Unicode code points so we index by code point,
  // not by UTF-16 code unit. This handles Arabic, emoji, and all non-BMP chars.
  const codePoints = [...source].map(c => c.codePointAt(0)!);
  const chars = [...source]; // parallel array of single-char strings

  let pos = 0;           // current code-point index
  let line = 1;
  let col = 1;           // 1-based code-point column

  const tokens: Token[] = [];
  const errors: LexError[] = [];

  // ── Position helpers ─────────────────────────────────────────────────────

  function peek(offset = 0): number {
    return codePoints[pos + offset] ?? 0;
  }

  function peekChar(offset = 0): string {
    return chars[pos + offset] ?? "";
  }

  function advance(): string {
    const ch = chars[pos] ?? "";
    const cp = codePoints[pos] ?? 0;
    pos++;
    if (cp === 0x0A) { line++; col = 1; } // LF
    else col++;
    return ch;
  }

  function currentSpan(startLine: number, startCol: number): Span {
    return { file, startLine, startCol, endLine: line, endCol: col - 1 };
  }

  function makeToken(kind: TokenKind, text: string, sl: number, sc: number): Token {
    return { kind, text, span: { file, startLine: sl, startCol: sc, endLine: line, endCol: col - 1 } };
  }

  function addError(code: LexError["code"], message: string, sl: number, sc: number): void {
    errors.push({ code, message, span: { file, startLine: sl, startCol: sc, endLine: line, endCol: col } });
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  while (pos < codePoints.length) {
    const sl = line, sc = col;
    const cp = peek();

    // ── CRLF / LF newlines ─────────────────────────────────────────────────
    if (cp === 0x0D && peek(1) === 0x0A) { // CRLF
      advance(); advance();
      tokens.push(makeToken("NEWLINE", "\r\n", sl, sc));
      continue;
    }
    if (cp === 0x0A) { // LF
      advance();
      tokens.push(makeToken("NEWLINE", "\n", sl, sc));
      continue;
    }

    // ── Whitespace (non-newline) ───────────────────────────────────────────
    if (cp === 0x20 || cp === 0x09 || cp === 0x0D) { // space, tab, CR alone
      advance();
      continue;
    }

    // ── Line comment // ────────────────────────────────────────────────────
    if (cp === 0x2F && peek(1) === 0x2F) {
      while (pos < codePoints.length && peek() !== 0x0A) advance();
      continue; // no token, but do NOT consume the newline
    }

    // ── Block comment /* ... */ ────────────────────────────────────────────
    if (cp === 0x2F && peek(1) === 0x2A) {
      advance(); advance(); // consume /*
      while (pos < codePoints.length) {
        if (peek() === 0x2A && peek(1) === 0x2F) { advance(); advance(); break; }
        advance();
      }
      continue;
    }

    // ── String literal ─────────────────────────────────────────────────────
    if (cp === 0x22) { // "
      advance(); // opening quote
      let value = "";
      let closed = false;
      while (pos < codePoints.length && peek() !== 0x0A) {
        const c = peek();
        if (c === 0x22) { advance(); closed = true; break; } // closing "
        if (c === 0x5C) { // backslash escape
          advance();
          const esc = peek();
          if (esc === 0x6E)       { advance(); value += "\n"; }
          else if (esc === 0x74)  { advance(); value += "\t"; }
          else if (esc === 0x72)  { advance(); value += "\r"; }
          else if (esc === 0x5C)  { advance(); value += "\\"; }
          else if (esc === 0x22)  { advance(); value += '"'; }
          else if (esc === 0x75 && peekChar(1) === "{") { // \u{HHHH}
            advance(); advance(); // u {
            let hex = "";
            while (pos < codePoints.length && peek() !== 0x7D) { // }
              if (!isHexDigit(peek())) break;
              hex += advance();
            }
            if (peek() === 0x7D) { advance(); }
            const cp2 = parseInt(hex, 16);
            if (!isNaN(cp2) && cp2 <= 0x10FFFF) value += String.fromCodePoint(cp2);
            else addError("LE003", `Invalid Unicode escape \\u{${hex}}`, sl, sc);
          } else {
            addError("LE003", `Unknown escape sequence \\${peekChar()}`, sl, sc);
            value += advance();
          }
        } else {
          value += advance();
        }
      }
      if (!closed) addError("LE002", "Unterminated string literal", sl, sc);
      tokens.push(makeToken("STRING_LIT", value, sl, sc));
      continue;
    }

    // ── Char literal ───────────────────────────────────────────────────────
    // Per SPEC_IMPLEMENTATION_MATRIX.md's finding: `char` is a documented
    // Tier 1 type (§6.1) with no literal syntax anywhere in §5.9 — this is
    // the fix, mirroring the string literal's own escape handling above,
    // but delimited by single quotes and enforcing exactly one character.
    if (cp === 0x27) { // '
      advance(); // opening quote
      let value = "";
      let closed = false;
      let charCount = 0;
      while (pos < codePoints.length && peek() !== 0x0A) {
        const c = peek();
        if (c === 0x27) { advance(); closed = true; break; } // closing '
        if (c === 0x5C) { // backslash escape — same escapes as string literals
          advance();
          const esc = peek();
          if (esc === 0x6E)       { advance(); value += "\n"; }
          else if (esc === 0x74)  { advance(); value += "\t"; }
          else if (esc === 0x72)  { advance(); value += "\r"; }
          else if (esc === 0x5C)  { advance(); value += "\\"; }
          else if (esc === 0x27)  { advance(); value += "'"; }
          else if (esc === 0x75 && peekChar(1) === "{") { // \u{HHHH}
            advance(); advance(); // u {
            let hex = "";
            while (pos < codePoints.length && peek() !== 0x7D) { // }
              if (!isHexDigit(peek())) break;
              hex += advance();
            }
            if (peek() === 0x7D) { advance(); }
            const cp2 = parseInt(hex, 16);
            if (!isNaN(cp2) && cp2 <= 0x10FFFF) value += String.fromCodePoint(cp2);
            else addError("LE003", `Invalid Unicode escape \\u{${hex}}`, sl, sc);
          } else {
            addError("LE003", `Unknown escape sequence \\${peekChar()}`, sl, sc);
            value += advance();
          }
          charCount++;
        } else {
          value += advance();
          charCount++;
        }
      }
      if (!closed) addError("LE002", "Unterminated char literal", sl, sc);
      else if (charCount === 0) addError("LE005", "Empty char literal — a char literal must contain exactly one character", sl, sc);
      else if (charCount > 1) addError("LE005", `Char literal contains ${charCount} characters — a char literal must contain exactly one`, sl, sc);
      tokens.push(makeToken("CHAR_LIT", value, sl, sc));
      continue;
    }

    // ── Numeric literals ───────────────────────────────────────────────────
    if (isDigit(cp)) {
      let num = "";
      let isFloat = false;

      if (cp === 0x30 && peek(1) === 0x78) { // 0x hex
        num = advance() + advance();
        while (pos < codePoints.length && (isHexDigit(peek()) || peek() === 0x5F)) {
          const c = advance(); if (c !== "_") num += c;
        }
      } else if (cp === 0x30 && peek(1) === 0x62) { // 0b binary
        num = advance() + advance();
        while (pos < codePoints.length && (peek() === 0x30 || peek() === 0x31 || peek() === 0x5F)) {
          const c = advance(); if (c !== "_") num += c;
        }
      } else {
        while (pos < codePoints.length && (isDigit(peek()) || peek() === 0x5F)) {
          const c = advance(); if (c !== "_") num += c;
        }
        // decimal point
        if (peek() === 0x2E && isDigit(peek(1))) {
          isFloat = true;
          num += advance(); // .
          while (pos < codePoints.length && (isDigit(peek()) || peek() === 0x5F)) {
            const c = advance(); if (c !== "_") num += c;
          }
        }
        // exponent
        if (peek() === 0x65 || peek() === 0x45) { // e / E
          isFloat = true;
          num += advance();
          if (peek() === 0x2B || peek() === 0x2D) num += advance();
          if (!isDigit(peek())) addError("LE004", "Expected digit after exponent", sl, sc);
          while (pos < codePoints.length && isDigit(peek())) num += advance();
        }
      }
      tokens.push(makeToken(isFloat ? "FLOAT_LIT" : "INT_LIT", num, sl, sc));
      continue;
    }

    // ── Identifiers and keywords ───────────────────────────────────────────
    if (isIdentStart(cp)) {
      let word = "";
      while (pos < codePoints.length && isIdentContinue(peek())) word += advance();
      const kw = KEYWORD_MAP.get(word);
      tokens.push(makeToken(kw ?? "IDENTIFIER", word, sl, sc));
      continue;
    }

    // ── Two-character operators ────────────────────────────────────────────
    if (cp === 0x3D && peek(1) === 0x3D) { advance(); advance(); tokens.push(makeToken("EQ_EQ",   "==", sl, sc)); continue; }
    if (cp === 0x21 && peek(1) === 0x3D) { advance(); advance(); tokens.push(makeToken("BANG_EQ", "!=", sl, sc)); continue; }
    if (cp === 0x3C && peek(1) === 0x3D) { advance(); advance(); tokens.push(makeToken("LT_EQ",   "<=", sl, sc)); continue; }
    if (cp === 0x3E && peek(1) === 0x3D) { advance(); advance(); tokens.push(makeToken("GT_EQ",   ">=", sl, sc)); continue; }
    if (cp === 0x26 && peek(1) === 0x26) { advance(); advance(); tokens.push(makeToken("AND",     "&&", sl, sc)); continue; }
    if (cp === 0x7C && peek(1) === 0x7C) { advance(); advance(); tokens.push(makeToken("OR",      "||", sl, sc)); continue; }

    // ── Single-character operators and punctuation ─────────────────────────
    const SINGLE: Record<number, TokenKind> = {
      0x2B: "PLUS",      // +
      0x2D: "MINUS",     // -
      0x2A: "STAR",      // *
      0x2F: "SLASH",     // /
      0x25: "PERCENT",   // %
      0x3D: "EQ",        // =
      0x3C: "LT",        // <
      0x3E: "GT",        // >
      0x21: "BANG",      // !
      0x2E: "DOT",       // .
      0x2C: "COMMA",     // ,
      0x060C: "COMMA",   // ، Arabic comma (U+060C)
      0x3A: "COLON",     // :
      0x28: "LPAREN",    // (
      0x29: "RPAREN",    // )
      0x5B: "LBRACKET",  // [
      0x5D: "RBRACKET",  // ]
    };

    // Arabic comma U+060C
    const arabicComma = 0x060C;
    const singleKind = SINGLE[cp === arabicComma ? arabicComma : cp];
    if (singleKind !== undefined) {
      const ch = advance();
      tokens.push(makeToken(singleKind, ch, sl, sc));
      continue;
    }

    // ── Unrecognized character — error recovery ────────────────────────────
    const ch = advance();
    addError("LE001", `Unrecognized character: U+${cp.toString(16).toUpperCase().padStart(4, "0")} '${ch}'`, sl, sc);
    tokens.push(makeToken("ERROR", ch, sl, sc));
  }

  tokens.push({ kind: "EOF", text: "", span: { file, startLine: line, startCol: col, endLine: line, endCol: col } });
  return { tokens, errors };
}
