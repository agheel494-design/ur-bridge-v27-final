// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Golden Tests (Level 3.1A.1)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../../src/backend/wasm/emit-wasm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = __dirname;

function toHex(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = [...bytes.slice(i, i + 16)].map(b => b.toString(16).padStart(2, "0"));
    lines.push(chunk.join(" "));
  }
  return lines.join("\n") + "\n";
}

const caseDirs = readdirSync(GOLDEN_ROOT).filter(name => statSync(join(GOLDEN_ROOT, name)).isDirectory());

describe("WASM Backend 3.1A.1 — golden byte snapshots + execution results", () => {
  for (const dir of caseDirs) {
    const programPath = join(GOLDEN_ROOT, dir, "program.ur");
    if (!existsSync(programPath)) continue;

    it(`${dir}: emitted bytes match the golden snapshot, and real execution matches the golden result`, async () => {
      const hexPath = join(GOLDEN_ROOT, dir, "expected.wasm.hex");
      const resultPath = join(GOLDEN_ROOT, dir, "expected.result.txt");
      expect(existsSync(hexPath), `${dir}/expected.wasm.hex missing — run: tsx tools/generate-wasm-golden.ts`).toBe(true);
      expect(existsSync(resultPath), `${dir}/expected.result.txt missing — run: tsx tools/generate-wasm-golden.ts`).toBe(true);

      const src = readFileSync(programPath, "utf-8");
      const { tokens } = lex(src);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "program.ur", dir);
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;

      const bytes = emitWasmModule(ir.value);
      expect(toHex(bytes)).toBe(readFileSync(hexPath, "utf-8"));

      expect(WebAssembly.validate(bytes)).toBe(true);
      const { instance } = await WebAssembly.instantiate(bytes);
      const result = (instance.exports.main as () => bigint)();
      const expectedResult = readFileSync(resultPath, "utf-8").trim();
      expect(result.toString()).toBe(expectedResult);
    });
  }
});
