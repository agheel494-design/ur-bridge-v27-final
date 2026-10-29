// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Golden Test Generator (Level 3.1A.1)
// ─────────────────────────────────────────────────────────────────────────────
//
// DEVELOPER TOOL — not part of the automated test suite. Run manually:
//   tsx tools/generate-wasm-golden.ts
//
// Since raw WASM binary is not human-reviewable, the golden snapshot is
// stored as readable hex (one byte pair per line grouping, per
// WASM_BACKEND_SPEC.md section 7's note that no wasm2wat tool exists
// in this environment) alongside each case's expected execution result.

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../src/backend/wasm/emit-wasm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = join(__dirname, "..", "tests", "backend", "wasm", "golden");

function toHex(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = [...bytes.slice(i, i + 16)].map(b => b.toString(16).padStart(2, "0"));
    lines.push(chunk.join(" "));
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
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
    const { program, errors } = parse(tokens);
    if (errors.length) { console.log(`SKIP ${dir}: parse errors`); continue; }
    const ir = lowerToIR(program, "program.ur", dir);
    if (!ir.ok) { console.log(`SKIP ${dir}: lowering failed`); continue; }

    const bytes = emitWasmModule(ir.value);
    writeFileSync(join(GOLDEN_ROOT, dir, "expected.wasm.hex"), toHex(bytes));

    const { instance } = (await WebAssembly.instantiate(bytes)) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
    const result = (instance.exports.main as () => bigint)();
    writeFileSync(join(GOLDEN_ROOT, dir, "expected.result.txt"), result.toString() + "\n");

    console.log(`GENERATED ${dir} (${bytes.length} bytes, result=${result})`);
    generated++;
  }

  console.log(`\n${generated} WASM golden case(s) generated.`);
}

main();
