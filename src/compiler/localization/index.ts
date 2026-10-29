// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Localization: Language Mapper
// ─────────────────────────────────────────────────────────────────────────────
//
//   User Source → Language Mapper → Canonical Keywords → Lexer → Parser → ...
//
// This module is the Language Mapper. It aggregates every per-language
// keyword table (ar, en, fr, es, de, ja, ru, zh, pt, hi) into a single
// surface-word → TokenKind lookup, which the Lexer consults instead of
// hardcoding any language's words directly.
//
// Architectural invariant (enforced by tests/compiler/localization/ and
// tests/platform/architecture-rules.test.ts): this module and every file
// it imports from (canonical.ts, ar.ts, en.ts, ...) has ZERO knowledge of
// the Parser, Semantic Analyzer, Type Checker, or Runtime. It exports pure
// lookup data and functions only. The only "downstream" type it references
// is TokenKind, which is the contract the Lexer already exposes — the
// Mapper's entire purpose is to feed the Lexer, so this reference is
// expected and intentional, not a violation.
//
// Adding a new language: create `src/compiler/localization/<code>.ts`
// exporting a LanguageDescriptor, then add it to ALL_LANGUAGES below.
// Nothing else in the compiler needs to change — not the Lexer's scanning
// logic, not the Parser, not the AST, not Semantic, not TypeSystem.
// ─────────────────────────────────────────────────────────────────────────────

import type { TokenKind } from "../frontend/lexer.js";
import type { CanonicalKeyword, LanguageDescriptor } from "./canonical.js";
import { CANONICAL_TO_TOKEN } from "./canonical.js";

import { ar } from "./ar.js";
import { en } from "./en.js";
import { fr } from "./fr.js";
import { es } from "./es.js";
import { de } from "./de.js";
import { ja } from "./ja.js";
import { ru } from "./ru.js";
import { zh } from "./zh.js";
import { pt } from "./pt.js";
import { hi } from "./hi.js";

/** Every supported language, in the order they were added. */
export const ALL_LANGUAGES: readonly LanguageDescriptor[] = [ar, en, fr, es, de, ja, ru, zh, pt, hi];

/**
 * Aggregated surface-word → TokenKind map, built once at module load from
 * every language's keyword table. This is what the Lexer actually queries.
 */
export const AGGREGATED_KEYWORD_MAP: ReadonlyMap<string, TokenKind> = buildAggregatedMap();

/**
 * Aggregated surface-word → CanonicalKeyword map (pre-TokenKind), used by
 * callers that need the canonical concept rather than the Lexer-specific
 * TokenKind — e.g. the Parser's contextual "IN" check (see isCanonicalIn).
 */
export const AGGREGATED_CANONICAL_MAP: ReadonlyMap<string, CanonicalKeyword> = buildAggregatedCanonicalMap();

function buildAggregatedCanonicalMap(): Map<string, CanonicalKeyword> {
  const map = new Map<string, CanonicalKeyword>();
  for (const lang of ALL_LANGUAGES) {
    for (const [word, canonical] of Object.entries(lang.keywords)) {
      const existing = map.get(word);
      if (existing !== undefined && existing !== canonical) {
        // Two languages disagree on what this exact surface word means.
        // This is a real authoring conflict — surfaced via
        // detectCrossLanguageCollisions() rather than thrown here, so
        // callers can decide policy (tests assert zero collisions today).
        continue;
      }
      map.set(word, canonical);
    }
  }
  return map;
}

function buildAggregatedMap(): Map<string, TokenKind> {
  const map = new Map<string, TokenKind>();
  for (const [word, canonical] of AGGREGATED_CANONICAL_MAP_BOOTSTRAP()) {
    map.set(word, CANONICAL_TO_TOKEN[canonical]);
  }
  return map;
}

// Bootstrap helper: buildAggregatedMap runs before AGGREGATED_CANONICAL_MAP
// is assigned (module-evaluation order), so it rebuilds the canonical map
// locally rather than reading the not-yet-initialized export.
function AGGREGATED_CANONICAL_MAP_BOOTSTRAP(): Map<string, CanonicalKeyword> {
  return buildAggregatedCanonicalMap();
}

/**
 * Returns true if the given surface word is the canonical "IN" keyword in
 * ANY supported language. Used by the Parser's contextual `for x IN y`
 * check (UR_LANGUAGE_SPEC_1_0.md §5.8) so the Parser never hardcodes any
 * specific language's word for "in".
 */
export function isCanonicalIn(word: string): boolean {
  return AGGREGATED_CANONICAL_MAP.get(word) === "IN";
}

/**
 * Detects surface words that map to DIFFERENT canonical keywords across
 * languages — a real authoring conflict, since the Lexer cannot tell which
 * language a given token stream is written in and must resolve every word
 * to exactly one canonical meaning. Returns an empty array when there are
 * no conflicts (the expected, tested state for the 10 shipped languages).
 */
export function detectCrossLanguageCollisions(): Array<{
  word: string;
  languages: Array<{ code: string; canonical: CanonicalKeyword }>;
}> {
  const byWord = new Map<string, Array<{ code: string; canonical: CanonicalKeyword }>>();
  for (const lang of ALL_LANGUAGES) {
    for (const [word, canonical] of Object.entries(lang.keywords)) {
      const list = byWord.get(word) ?? [];
      list.push({ code: lang.code, canonical });
      byWord.set(word, list);
    }
  }
  const collisions: Array<{ word: string; languages: Array<{ code: string; canonical: CanonicalKeyword }> }> = [];
  for (const [word, entries] of byWord) {
    const distinctCanonicals = new Set(entries.map(e => e.canonical));
    if (distinctCanonicals.size > 1) {
      collisions.push({ word, languages: entries });
    }
  }
  return collisions;
}
