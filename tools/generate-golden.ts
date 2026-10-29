// ─────────────────────────────────────────────────────────────────────────────
// UR — Golden Test Generator
// Level 2 — tests/codegen/golden/
// ─────────────────────────────────────────────────────────────────────────────
//
// DEVELOPER TOOL — not part of the automated test suite. Run manually:
//
//   tsx tools/generate-golden.ts
//
// Regenerates expected.ir.json and expected.c for every tests/codegen/golden/*/
// directory containing a program.ur, from the CURRENT compiler output. This
// should only be run deliberately, after a reviewed, intentional change to
// the IR shape or C emission — running it blindly would silently overwrite
// the anti-regression baseline with whatever the compiler currently does,
// defeating the entire purpose of golden testing.
//
// The actual test (tests/codegen/golden/golden.test.ts) NEVER writes these
// files — it only compares current output against what's already there.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { analyze } from "../src/compiler/semantic/index.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../src/backend/c/emit-c.js";
import { renderCfgText } from "../src/shared/cfg-debug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = join(__dirname, "..", "tests", "codegen", "golden");

/** Deterministic JSON serialization: bigint -> "<n>n" string, stable key order via JSON.stringify's own insertion order (object literals in this codebase are constructed in a fixed field order). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v), 2) + "\n";
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
      console.log(`SKIP ${dir}: no program.ur found`);
      continue;
    }

    const { tokens, errors: lexErrors } = lex(src);
    if (lexErrors.length) { console.log(`SKIP ${dir}: lex errors`, lexErrors); continue; }

    const { program, errors: parseErrors } = parse(tokens);
    if (parseErrors.length) { console.log(`SKIP ${dir}: parse errors`, parseErrors); continue; }

    const sem = analyze(program);
    if (sem.diagnostics.length) { console.log(`SKIP ${dir}: semantic errors`, sem.diagnostics); continue; }

    const types = typeCheck(program);
    if (types.diagnostics.length) { console.log(`SKIP ${dir}: type errors`, types.diagnostics); continue; }

    const ir = lowerToIR(program, "program.ur", dir);
    if (!ir.ok) { console.log(`SKIP ${dir}: IR lowering failed`, ir.diagnostics); continue; }

    const cSource = emitC(ir.value);
    const cfgText = ir.value.functions.map(fn => renderCfgText(fn)).join("\n\n");

    writeFileSync(join(GOLDEN_ROOT, dir, "expected.ir.json"), stableStringify(ir.value));
    writeFileSync(join(GOLDEN_ROOT, dir, "expected.c"), cSource);
    writeFileSync(join(GOLDEN_ROOT, dir, "expected.cfg.txt"), cfgText + "\n");
    console.log(`GENERATED ${dir}`);
    generated++;
  }

  console.log(`\n${generated} golden file pair(s) generated.`);
}

main();
