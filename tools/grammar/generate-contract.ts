// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Layer C, Gate C-1: Contract Generator
// ─────────────────────────────────────────────────────────────────────────────
//
// Writes tools/grammar/keyword-contract.generated.json from the real
// Language Mapper. Re-running this script after a future language is
// added to src/compiler/localization/ regenerates the contract
// automatically — this is the "single generatable source" C-1 requires,
// as opposed to hand-copying keyword lists into a grammar file.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildGrammarContract } from "./extract-keyword-contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "keyword-contract.generated.json");

const contract = buildGrammarContract();
writeFileSync(outputPath, JSON.stringify(contract, null, 2) + "\n", "utf-8");

console.log(`Wrote ${outputPath}`);
console.log(`  ${contract.languages.length} languages, ${contract.keywords.length} keyword entries (all aliases included), ${contract.crossLanguageCollisions.length} collisions`);
