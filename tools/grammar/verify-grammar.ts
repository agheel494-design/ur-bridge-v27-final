// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Layer C, Gate C-2 (+ Micro-Fix C-2.1): Grammar Verification Suite
// ─────────────────────────────────────────────────────────────────────────────
//
// Tests the GENERATED grammar's own real regex patterns (not the contract
// directly - that's C-1's own already-proven job) using JS RegExp as an
// explicitly disclosed stand-in for the real Oniguruma engine VS Code
// actually uses (unavailable in this environment — see the Evidence
// Report's own PROVEN/UNVERIFIED section).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const grammar = JSON.parse(readFileSync(join(REPO_ROOT, "extensions/vscode/syntaxes/ur.tmLanguage.json"), "utf-8"));

// Micro-Fix C-2.1: keywords.patterns is now an ARRAY of per-scope rules,
// not a single rule. Build a combined "any reserved keyword" pattern for
// the tests that only care about detection (not which scope), and keep
// the per-scope patterns available separately for the new scope-specific
// tests below.
const keywordScopePatterns: { name: string; match: string }[] = grammar.repository.keywords.patterns;
const combinedKeywordPattern = keywordScopePatterns.map(p => `(?:${p.match})`).join("|");
const inPattern = grammar.repository["in-contextual"].patterns[0].match;
const commentLinePattern = grammar.repository.comments.patterns[0].match;
const numberPattern = grammar.repository.numbers.patterns[0].match;
const operatorPattern = grammar.repository.operators.patterns[0].match;
const punctuationPattern = grammar.repository.operators.patterns[1].match;
const identifierPattern = grammar.repository.identifiers.patterns[0].match;
const identifierScopeName = grammar.repository.identifiers.patterns[0].name;

let pass = 0, total = 0;
function check(label: string, condition: boolean) {
  total++;
  if (condition) { pass++; console.log(`${label}: PASS`); }
  else console.log(`${label}: FAIL`);
}

console.log("=== C-2 (+ C-2.1) Grammar Verification Suite ===\n");

console.log("--- Keyword boundary / lookaround (the decisive Arabic case) ---");
{
  const re = () => new RegExp(combinedKeywordPattern, "g");
  check("isolated Arabic keyword 'دالة' matches", re().test("دالة"));
  check("'دالة' embedded in 'دالةفرعية' does NOT match", !re().test("دالةفرعية"));
  check("full Arabic line matches exactly one keyword", [...("دالة main(): int".matchAll(re()))].length === 1);
  check("English 'function' still matches (regression on the Latin case)", re().test("function"));
  check("'functionX' (English keyword as a substring) does NOT match", !re().test("functionX"));
}

console.log("\n--- Micro-Fix C-2.1: canonical -> scope correctness (not just 'matched somehow') ---");
{
  const contract = JSON.parse(readFileSync(join(__dirname, "keyword-contract.generated.json"), "utf-8"));
  const CANONICAL_TO_EXPECTED_SCOPE: Record<string, string> = {
    FUNCTION: "keyword.control.ur", IF: "keyword.control.ur", ELSE: "keyword.control.ur",
    WHILE: "keyword.control.ur", FOR: "keyword.control.ur", RETURN: "keyword.control.ur",
    END: "keyword.control.ur", BREAK: "keyword.control.ur", CONTINUE: "keyword.control.ur",
    LET: "keyword.other.ur", TYPE: "keyword.other.ur", STRUCT: "keyword.other.ur", IMPORT: "keyword.other.ur",
    TRUE: "constant.language.ur", FALSE: "constant.language.ur", NULL: "constant.language.ur",
  };
  const samples: Array<[string, string]> = [
    ["function", "en"], ["دالة", "ar (FUNCTION)"],
    ["if", "en"], ["else", "en"], ["while", "en"], ["for", "en"],
    ["return", "en"], ["أرجع", "ar (RETURN)"], ["end", "en"], ["break", "en"], ["continue", "en"],
    ["let", "en"], ["عرف", "ar (LET)"], ["type", "en"], ["struct", "en"], ["import", "en"],
    ["true", "en"], ["false", "en"], ["null", "en"],
  ];
  for (const [word, label] of samples) {
    const entry = contract.keywords.find((k: any) => k.surfaceWord === word);
    if (!entry) { check(`${label} "${word}": found in contract`, false); continue; }
    const expectedScope = CANONICAL_TO_EXPECTED_SCOPE[entry.canonical];
    const rule = keywordScopePatterns.find(p => new RegExp(p.match).test(word));
    check(`${label} "${word}" (canonical ${entry.canonical}) -> scope ${expectedScope}`, rule?.name === expectedScope);
  }
}

console.log("\n--- Full multilingual corpus (11 real files) ---");
{
  const interopDir = join(REPO_ROOT, "tests/multilingual/interop");
  let totalHits = 0;
  for (const f of readdirSync(interopDir).filter(f => f.endsWith(".ur"))) {
    const text = readFileSync(join(interopDir, f), "utf-8");
    const hits = [...text.matchAll(new RegExp(combinedKeywordPattern, "g"))].length;
    totalHits += hits;
    check(`${f}: at least one keyword matched`, hits > 0);
  }
  const goldenText = readFileSync(join(REPO_ROOT, "tests/codegen/golden/08-arabic-keywords/program.ur"), "utf-8");
  const goldenHits = [...goldenText.matchAll(new RegExp(combinedKeywordPattern, "g"))].length;
  check("Arabic golden fixture: at least one keyword matched", goldenHits > 0);
  console.log(`  (total keyword matches across all 11 files: ${totalHits + goldenHits})`);
}

console.log("\n--- Negative controls, fresh words ---");
{
  const nonKeywords = ["main", "square", "helper", "counter", "محمد", "田中", "переменная", "x", "y"];
  for (const w of nonKeywords) {
    check(`"${w}" correctly NOT a keyword`, !new RegExp(combinedKeywordPattern).test(w));
  }
}

console.log("\n--- IN contextual, kept separate from reserved keywords ---");
{
  const reservedRe = new RegExp(combinedKeywordPattern);
  const inRe = new RegExp(inPattern);
  check("'in' (English) matches the SEPARATE in-contextual pattern", inRe.test("in"));
  check("'in' does NOT match the RESERVED keyword pattern (kept separate)", !reservedRe.test("in"));
}

console.log("\n--- Micro-Fix C-2.1: identifier pattern, the full required matrix ---");
{
  const idRe = () => new RegExp(identifierPattern, "g");
  const kwRe = () => new RegExp(combinedKeywordPattern, "g");

  check("ordinary ASCII identifier 'counter' matches the identifier pattern", idRe().test("counter"));
  check("Unicode identifier (fresh Arabic name, not a keyword) matches the identifier pattern", idRe().test("محمد"));
  check("Unicode identifier (fresh Japanese name) matches the identifier pattern", idRe().test("田中"));
  check("a real keyword ('function') matches the KEYWORD pattern", kwRe().test("function"));

  // The real correctness property: under the ACTUAL top-level pattern
  // order (keywords before identifiers), a real keyword is claimed by
  // the keyword rule first - simulate that order explicitly.
  function classify(word: string): string {
    for (const p of keywordScopePatterns) if (new RegExp(p.match).test(word)) return p.name;
    if (new RegExp(inPattern).test(word)) return "keyword.other.contextual.ur";
    if (new RegExp(identifierPattern).test(word)) return identifierScopeName;
    return "none";
  }
  check("'function' classifies as keyword.control.ur, NOT variable.other.ur, under real pattern precedence", classify("function") === "keyword.control.ur");
  check("Unicode identifier (not a keyword) classifies as variable.other.ur", classify("محمد") === identifierScopeName);
  check("'counter' (not a keyword) classifies as variable.other.ur", classify("counter") === identifierScopeName);
  check("keyword-prefixed longer identifier classifies as variable.other.ur, not split", classify("دالةفرعية") === identifierScopeName);
  check("'in' classifies as keyword.other.contextual.ur, not variable.other.ur", classify("in") === "keyword.other.contextual.ur");

  const topLevelOrder = grammar.patterns.map((p: any) => p.include);
  check("identifiers included AFTER strings and comments in top-level pattern order",
    topLevelOrder.indexOf("#identifiers") > topLevelOrder.indexOf("#strings") &&
    topLevelOrder.indexOf("#identifiers") > topLevelOrder.indexOf("#comments"));
}

console.log("\n--- Lexical constructs ---");
{
  check("// line comment matches", new RegExp(commentLinePattern).test("// a comment"));
  check("integer literal matches", new RegExp(numberPattern).test("42"));
  check("float literal matches", new RegExp(numberPattern).test("3.14"));
  check("== operator matches", new RegExp(operatorPattern).test("=="));
  check("&& operator matches", new RegExp(operatorPattern).test("&&"));
  check("ASCII comma matches punctuation", new RegExp(punctuationPattern).test(","));
  check("Arabic comma (U+060C) matches punctuation", new RegExp(punctuationPattern).test("\u060C"));
}

console.log("\n--- Mandatory false-green attack: remove Arabic, confirm detection ---");
{
  const contract = JSON.parse(readFileSync(join(__dirname, "keyword-contract.generated.json"), "utf-8"));
  const corrupted = contract.keywords.filter((k: any) => k.languageCode !== "ar");
  const IDC = "A-Za-z0-9_\\u0621-\\u063A\\u0641-\\u064A\\u066E-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u4E00-\\u9FFF\\u0900-\\u0963\\u0966-\\u096F\\u0971-\\u097F\\u3040-\\u30FF\\u064B-\\u065F\\u0670";
  const escapeRegex = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = corrupted.filter((k: any) => k.canonical !== "IN").map((k: any) => k.surfaceWord);
  const corruptedPattern = `(?<![${IDC}])(${[...words].sort((a: string, b: string) => b.length - a.length).map(escapeRegex).join("|")})(?![${IDC}])`;
  const arabicText = readFileSync(join(REPO_ROOT, "tests/multilingual/interop/ar.ur"), "utf-8");
  const originalHits = [...arabicText.matchAll(new RegExp(combinedKeywordPattern, "g"))].length;
  const corruptedHits = [...arabicText.matchAll(new RegExp(corruptedPattern, "g"))].length;
  console.log(`  Original grammar hits on ar.ur: ${originalHits}, corrupted (Arabic removed) hits: ${corruptedHits}`);
  check("false-green attack correctly detects the missing language (corrupted hits < original)", corruptedHits < originalHits);
}

console.log(`\n${pass}/${total} PASS`);
if (pass !== total) process.exit(1);
