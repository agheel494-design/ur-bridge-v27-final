// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Golden Test Generator
// Level 2.9 — tests/optimizer/golden/
// ─────────────────────────────────────────────────────────────────────────────
//
// DEVELOPER TOOL — not part of the automated test suite. Run manually:
//
//   tsx tools/generate-optimizer-golden.ts
//
// Regenerates expected.before.ir.json and expected.after.ir.json for every
// tests/optimizer/golden/*/ directory containing a program.ur, from the
// CURRENT Constant Folding pass output. Mirrors tools/generate-golden.ts's
// exact pattern and caveats — only run deliberately, after a reviewed,
// intentional change to pass behavior.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../src/optimizer/dead-code-elimination.js";
import { runPipeline } from "../src/optimizer/pass.js";
import type { OptimizationPass } from "../src/optimizer/pass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = join(__dirname, "..", "tests", "optimizer", "golden");

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v), 2) + "\n";
}

/** Which pass(es) a given golden case exercises, inferred from its directory name — explicit and simple rather than a generic config mechanism for just two passes. */
function passesFor(dir: string): OptimizationPass[] {
  if (dir.includes("dce")) return [deadCodeEliminationPass];
  return [constantFoldingPass];
}

function main(): void {
  const entries = readdirSync(GOLDEN_ROOT).filter(name => statSync(join(GOLDEN_ROOT, name)).isDirectory());
  let generated = 0;

  for (const dir of entries) {
    const programPath = join(GOLDEN_ROOT, dir, "program.ur");
    let src: string;
    try {
      src = readFileSync(programPath, "utf-8");
    } catch {
      continue;
    }

    const { tokens } = lex(src);
    const { program, errors: parseErrors } = parse(tokens);
    if (parseErrors.length) { console.log(`SKIP ${dir}: parse errors`); continue; }
    const ir = lowerToIR(program, "program.ur", dir);
    if (!ir.ok) { console.log(`SKIP ${dir}: lowering failed`); continue; }

    const beforeFn = ir.value.functions[0]!;
    const afterFn = runPipeline(beforeFn, passesFor(dir));

    writeFileSync(join(GOLDEN_ROOT, dir, "expected.before.ir.json"), stableStringify(beforeFn));
    writeFileSync(join(GOLDEN_ROOT, dir, "expected.after.ir.json"), stableStringify(afterFn));
    console.log(`GENERATED ${dir}`);
    generated++;
  }

  console.log(`\n${generated} optimizer golden file pair(s) generated.`);
}

main();
