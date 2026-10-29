// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Constant Folding: Golden Tests
// Level 2.9, OPTIMIZER_SPEC.md §8
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../../src/optimizer/dead-code-elimination.js";
import { runPipeline } from "../../../src/optimizer/pass.js";
import type { OptimizationPass } from "../../../src/optimizer/pass.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = __dirname;

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v), 2) + "\n";
}

function passesFor(dir: string): OptimizationPass[] {
  if (dir.includes("dce")) return [deadCodeEliminationPass];
  return [constantFoldingPass];
}

const caseDirs = readdirSync(GOLDEN_ROOT).filter(name => statSync(join(GOLDEN_ROOT, name)).isDirectory());

describe("optimizer/golden — before/after IR snapshots (Constant Folding, Dead Code Elimination)", () => {
  for (const dir of caseDirs) {
    const programPath = join(GOLDEN_ROOT, dir, "program.ur");
    if (!existsSync(programPath)) continue;

    it(`${dir}: actual before/after IR matches the committed golden snapshots exactly`, () => {
      const beforePath = join(GOLDEN_ROOT, dir, "expected.before.ir.json");
      const afterPath = join(GOLDEN_ROOT, dir, "expected.after.ir.json");
      expect(existsSync(beforePath), `${dir}/expected.before.ir.json missing — run: tsx tools/generate-optimizer-golden.ts`).toBe(true);
      expect(existsSync(afterPath), `${dir}/expected.after.ir.json missing — run: tsx tools/generate-optimizer-golden.ts`).toBe(true);

      const src = readFileSync(programPath, "utf-8");
      const { tokens } = lex(src);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "program.ur", dir);
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;

      const beforeFn = ir.value.functions[0]!;
      const afterFn = runPipeline(beforeFn, passesFor(dir));

      const actualBefore = stableStringify(beforeFn);
      const actualAfter = stableStringify(afterFn);
      const expectedBefore = readFileSync(beforePath, "utf-8");
      const expectedAfter = readFileSync(afterPath, "utf-8");

      expect(actualBefore).toBe(expectedBefore);
      expect(actualAfter).toBe(expectedAfter);
    });
  }
});
