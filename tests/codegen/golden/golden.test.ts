// ─────────────────────────────────────────────────────────────────────────────
// UR — Golden Tests: IR and C emission regression guard
// Level 2 — Phase 2.1-2.3 closure
// ─────────────────────────────────────────────────────────────────────────────
//
//   program.ur → (recompile) → actual IR / actual C
//                                  ↓ compare byte-for-byte ↓
//                          expected.ir.json / expected.c
//
// This test NEVER writes the golden files — see tools/generate-golden.ts
// for the (developer-run-only) generator. If this test fails, it means
// either (a) a real regression was introduced, or (b) an intentional
// design change was made and the golden files need regenerating (after
// review) via `tsx tools/generate-golden.ts`. The test cannot tell these
// apart — that judgment call belongs to a human reviewing the diff.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { renderCfgText } from "../../../src/shared/cfg-debug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = __dirname;

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v), 2) + "\n";
}

const caseDirs = readdirSync(GOLDEN_ROOT).filter(name => statSync(join(GOLDEN_ROOT, name)).isDirectory());

describe("Golden Tests — IR and C emission match the recorded baseline exactly", () => {
  expect(caseDirs.length, "golden test cases must exist — the directory should not be empty").toBeGreaterThan(0);

  for (const dir of caseDirs) {
    const programPath = join(GOLDEN_ROOT, dir, "program.ur");
    const irPath = join(GOLDEN_ROOT, dir, "expected.ir.json");
    const cPath = join(GOLDEN_ROOT, dir, "expected.c");

    it(`${dir}: actual IR matches expected.ir.json byte-for-byte`, () => {
      expect(existsSync(programPath), `${dir}/program.ur must exist`).toBe(true);
      expect(existsSync(irPath), `${dir}/expected.ir.json missing — run: tsx tools/generate-golden.ts`).toBe(true);

      const src = readFileSync(programPath, "utf-8");
      const { tokens } = lex(src);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "program.ur", dir);
      expect(ir.ok, `${dir}: IR lowering must succeed`).toBe(true);
      if (!ir.ok) return;

      const actual = stableStringify(ir.value);
      const expected = readFileSync(irPath, "utf-8");
      expect(actual).toBe(expected);
    });

    it(`${dir}: actual generated C matches expected.c byte-for-byte`, () => {
      expect(existsSync(cPath), `${dir}/expected.c missing — run: tsx tools/generate-golden.ts`).toBe(true);

      const src = readFileSync(programPath, "utf-8");
      const { tokens } = lex(src);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "program.ur", dir);
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;

      const actualC = emitC(ir.value);
      const expectedC = readFileSync(cPath, "utf-8");
      expect(actualC).toBe(expectedC);
    });

    it(`${dir}: actual CFG visual structure matches expected.cfg.txt exactly`, () => {
      const cfgPath = join(GOLDEN_ROOT, dir, "expected.cfg.txt");
      expect(existsSync(cfgPath), `${dir}/expected.cfg.txt missing — run: tsx tools/generate-golden.ts`).toBe(true);

      const src = readFileSync(programPath, "utf-8");
      const { tokens } = lex(src);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "program.ur", dir);
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;

      const actualCfg = ir.value.functions.map(fn => renderCfgText(fn)).join("\n\n") + "\n";
      const expectedCfg = readFileSync(cfgPath, "utf-8");
      expect(actualCfg).toBe(expectedCfg);
    });
  }
});

describe("Golden Tests — every case still passes Semantic + TypeChecker cleanly (sanity)", () => {
  for (const dir of caseDirs) {
    it(`${dir}: program.ur has zero lex/parse/semantic/type diagnostics`, () => {
      const src = readFileSync(join(GOLDEN_ROOT, dir, "program.ur"), "utf-8");
      const { tokens, errors: lexErrors } = lex(src);
      expect(lexErrors).toHaveLength(0);
      const { program, errors: parseErrors } = parse(tokens);
      expect(parseErrors).toHaveLength(0);
      const sem = analyze(program);
      expect(sem.diagnostics).toHaveLength(0);
      const types = typeCheck(program);
      expect(types.diagnostics).toHaveLength(0);
    });
  }
});
