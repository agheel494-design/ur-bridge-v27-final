// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Layer C, Gate C-2: TextMate Grammar Generator
// ─────────────────────────────────────────────────────────────────────────────
//
// Pipeline, exactly as authorized:
//   src/compiler/localization/ (ALL_LANGUAGES)
//     → C-1 contract (tools/grammar/keyword-contract.generated.json)
//     → THIS generator
//     → extensions/vscode/syntaxes/ur.tmLanguage.json
//
// This generator reads ONLY the C-1 contract JSON from disk — it does NOT
// import ALL_LANGUAGES or any localization file directly. C-1 already did
// that extraction; re-importing it here would create a second path to the
// same data and risk the two drifting apart. No keyword is written by
// hand anywhere in this file — every surface word in the generated
// grammar comes from iterating contract.keywords.
//
// ── IN — an explicit, separate, documented design decision ─────────────────
// Per the Design Gate: whether IN's own surface words are highlighted at
// all is a real UX choice, not a technical necessity, and must not be
// silently folded into the reserved-keyword generation. Decision recorded
// HERE, at the top of this file, exactly as required — not decided
// implicitly by omission or inside the main keyword loop:
//
//   DECISION: IN is highlighted, but under a SEPARATE scope
//   (keyword.other.contextual.ur), never keyword.control.ur or any other
//   scope shared with a genuinely reserved keyword. TextMate cannot verify
//   IN's own real grammatical context (only meaningful inside `for x in
//   y`, per CANONICAL_TO_TOKEN.IN = "IDENTIFIER" — it is not a reserved
//   token at the compiler level at all). This may highlight `in`-like
//   words even where they are being used as ordinary identifiers. This is
//   a disclosed, accepted simplification of a purely regex-based grammar,
//   not a claim that the grammar understands the `for` construct.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, "keyword-contract.generated.json");
const OUTPUT_PATH = join(__dirname, "..", "..", "extensions", "vscode", "syntaxes", "ur.tmLanguage.json");

type ContractKeyword = { surfaceWord: string; canonical: string; languageCode: string; languageName: string };
type Contract = { keywords: ContractKeyword[] };

/** Micro-Fix C-2.1: maps each of the 17 REAL canonical concepts (present
 *  per-entry in the C-1 contract's own "canonical" field - not invented
 *  here) to the TextMate scope category the ORIGINAL Layer C Design Gate
 *  itself already specified in its own §B (Scope Taxonomy). This is not
 *  a new taxonomy - it is the already-approved 3-way split, finally
 *  implemented correctly instead of collapsed into one scope. Every one
 *  of the 17 real CanonicalKeyword values is listed explicitly, so a
 *  future 18th canonical concept (should one ever be added to
 *  canonical.ts) fails loudly here rather than silently defaulting to
 *  the wrong scope - see the exhaustiveness check in main() below. */
const CANONICAL_TO_SCOPE: Record<string, string> = {
  FUNCTION: "keyword.control.ur",
  IF: "keyword.control.ur",
  ELSE: "keyword.control.ur",
  WHILE: "keyword.control.ur",
  FOR: "keyword.control.ur",
  RETURN: "keyword.control.ur",
  END: "keyword.control.ur",
  BREAK: "keyword.control.ur",
  CONTINUE: "keyword.control.ur",
  LET: "keyword.other.ur",
  TYPE: "keyword.other.ur",
  STRUCT: "keyword.other.ur",
  IMPORT: "keyword.other.ur",
  TRUE: "constant.language.ur",
  FALSE: "constant.language.ur",
  NULL: "constant.language.ur",
  // IN is deliberately absent here - handled entirely separately, per
  // the standing, unchanged IN design decision (see below).
};


/** The exact identifier-continue Unicode ranges C-1's own contract already
 *  cites verbatim from lexer.ts's own isIdentContinue/isUnicodeLetter -
 *  re-encoded here as an actual regex character class, since C-1's own
 *  contract stores this as a human-readable citation string, not
 *  regex-ready data. Every range below matches a range this generator's
 *  own header comment (and C-1's own lexicalRules.identifierContinue
 *  field) already documents — not a new claim introduced here. */
const IDENTIFIER_CONTINUE_CLASS =
  "A-Za-z0-9_" +
  "\\u0621-\\u063A\\u0641-\\u064A\\u066E-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF" + // Arabic + extended + presentation forms
  "\\u00C0-\\u024F" + // Latin Extended
  "\\u0370-\\u03FF" + // Greek
  "\\u0400-\\u04FF" + // Cyrillic
  "\\u4E00-\\u9FFF" + // CJK
  "\\u0900-\\u0963\\u0966-\\u096F\\u0971-\\u097F" + // Devanagari (letters + combining marks + digits)
  "\\u3040-\\u30FF" + // Hiragana/Katakana
  "\\u064B-\\u065F\\u0670"; // Arabic tashkeel + superscript alef

/** Micro-Fix C-2.1: the identifier-START class - a SUBSET of
 *  IDENTIFIER_CONTINUE_CLASS above, per the real lexer.ts's own
 *  isIdentStart()/isUnicodeLetter(): excludes ASCII digits and the
 *  combining-mark ranges (Arabic tashkeel, Devanagari matras/digits),
 *  none of which can legally START an identifier - only continue one.
 *  Reusing the same cited Unicode ranges from lexer.ts already
 *  documented above, minus the continue-only additions. */
const IDENTIFIER_START_CLASS =
  "A-Za-z_" +
  "\\u0621-\\u063A\\u0641-\\u064A\\u066E-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF" +
  "\\u00C0-\\u024F" +
  "\\u0370-\\u03FF" +
  "\\u0400-\\u04FF" +
  "\\u4E00-\\u9FFF" +
  "\\u0900-\\u0961\\u0971-\\u097F" + // Devanagari letters only, NOT the combining/digit ranges
  "\\u3040-\\u30FF";

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Builds a lookaround-bounded alternation for a set of surface words -
 *  NOT \b, per this Gate's own decisive finding that \b fails entirely
 *  on non-Latin scripts (confirmed directly: /\bدالة\b/.test("دالة") is
 *  false even for the isolated word). Longest-first ordering is a
 *  defensive regex-safety default (irrelevant for this specific 174-word
 *  set, already confirmed collision-free by C-1's own review, but
 *  correct practice for a generator that must remain correct if the
 *  word list changes). */
function buildBoundedAlternation(words: readonly string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(escapeRegex);
  return `(?<![${IDENTIFIER_CONTINUE_CLASS}])(${escaped.join("|")})(?![${IDENTIFIER_CONTINUE_CLASS}])`;
}

function main() {
  const contractRaw = readFileSync(CONTRACT_PATH, "utf-8");
  const contract: Contract = JSON.parse(contractRaw);
  const contractHash = createHash("sha256").update(contractRaw).digest("hex");

  // Micro-Fix C-2.1: group reserved words by their OWN real "canonical"
  // field (already present per-entry in the contract, not invented here)
  // into the three scope buckets CANONICAL_TO_SCOPE maps them to - no
  // hand-written word list, only a grouping derived from real data.
  // Exhaustiveness check: every canonical actually present in the
  // contract (other than IN, handled separately below) MUST have a
  // scope mapping - fails loudly rather than silently dropping a
  // future 18th canonical concept into no scope at all.
  const wordsByScope = new Map<string, string[]>();
  for (const k of contract.keywords) {
    if (k.canonical === "IN") continue; // handled entirely separately below
    const scope = CANONICAL_TO_SCOPE[k.canonical];
    if (!scope) {
      throw new Error(`No scope mapping for canonical "${k.canonical}" (surface word "${k.surfaceWord}") - CANONICAL_TO_SCOPE must be updated before this generator can run. Stopping rather than silently defaulting.`);
    }
    if (!wordsByScope.has(scope)) wordsByScope.set(scope, []);
    wordsByScope.get(scope)!.push(k.surfaceWord);
  }
  // IN: kept fully separate, per the standing, unchanged design decision.
  const inWords = contract.keywords.filter(k => k.canonical === "IN").map(k => k.surfaceWord);

  const keywordPatterns = [...wordsByScope.entries()].map(([scope, words]) => ({
    name: scope,
    match: buildBoundedAlternation(words),
  }));
  const inPattern = buildBoundedAlternation(inWords);
  // Identifier pattern: intentionally conservative - matches anything
  // identifier-SHAPED per the real Lexer's own start/continue rules,
  // with no attempt to infer whether it's a variable, function, or type
  // name (TextMate is not a semantic parser, and this Gate does not
  // pretend otherwise). Placed AFTER keywords/in-contextual in pattern
  // order (see `patterns` below) so a real keyword is matched by its
  // own rule first; this rule only catches what those rules did not.
  const identifierPattern = `[${IDENTIFIER_START_CLASS}][${IDENTIFIER_CONTINUE_CLASS}]*`;

  const grammar = {
    "//": "GENERATED FILE - DO NOT EDIT BY HAND. Regenerate via tools/grammar/generate-grammar.ts. Any manual edit will be overwritten and will silently diverge from src/compiler/localization/ - the single source of truth.",
    "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
    name: "UR",
    scopeName: "source.ur",
    // Staleness metadata - ignored by the real TextMate engine at runtime,
    // read only by this project's own tooling (see check-grammar-staleness.ts)
    // to detect when keyword-contract.generated.json has changed since this
    // file was last generated.
    "x-ur-generator-metadata": {
      generatedFrom: "tools/grammar/keyword-contract.generated.json",
      contractSha256: contractHash,
      generatorScript: "tools/grammar/generate-grammar.ts",
    },
    patterns: [
      { include: "#comments" },
      { include: "#strings" },
      { include: "#numbers" },
      { include: "#keywords" },
      { include: "#in-contextual" },
      { include: "#operators" },
      { include: "#identifiers" },
    ],
    repository: {
      comments: {
        patterns: [
          { name: "comment.line.double-slash.ur", match: "//.*$" },
          { name: "comment.block.ur", begin: "/\\*", end: "\\*/" },
        ],
      },
      strings: {

        patterns: [
          {
            name: "string.quoted.double.ur",
            begin: "\"",
            end: "\"",
            patterns: [{ name: "constant.character.escape.ur", match: "\\\\." }],
          },
          {
            name: "string.quoted.single.ur",
            begin: "'",
            end: "'",
            patterns: [{ name: "constant.character.escape.ur", match: "\\\\." }],
          },
        ],
      },
      numbers: {
        patterns: [{ name: "constant.numeric.ur", match: "\\d+(\\.\\d+)?" }],
      },
      keywords: {
        // Micro-Fix C-2.1: multiple patterns, one per real scope bucket
        // (keywordPatterns is built above from the contract's own
        // "canonical" field, grouped via CANONICAL_TO_SCOPE - not a
        // hand-written per-word list).
        patterns: keywordPatterns,
      },
      "in-contextual": {
        // Separate scope, separate repository entry, per the explicit IN
        // decision documented at the top of this file - never merged into
        // the "keywords" rule above.
        patterns: [{ name: "keyword.other.contextual.ur", match: inPattern }],
      },
      operators: {
        patterns: [
          {
            name: "keyword.operator.ur",
            match: "==|!=|<=|>=|&&|\\|\\||[+\\-*/%=<>!]",
          },
          { name: "punctuation.separator.ur", match: "[,\\u060C]" },
        ],
      },
      identifiers: {
        // Micro-Fix C-2.1: a single, conservative catch-all rule. Placed
        // last in the top-level `patterns` order (see above), so any
        // real keyword/IN word is matched by its OWN earlier rule first
        // - this only catches identifier-shaped text those rules left
        // unmatched.
        patterns: [{ name: "variable.other.ur", match: identifierPattern }],
      },
    },
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(grammar, null, 2) + "\n", "utf-8");
  const totalReserved = [...wordsByScope.values()].reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  ${totalReserved} reserved keyword surface words across ${wordsByScope.size} scopes, ${inWords.length} contextual IN surface words`);
  console.log(`  Contract hash embedded: ${contractHash.slice(0, 16)}...`);
}


main();
