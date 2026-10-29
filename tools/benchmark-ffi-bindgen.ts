#!/usr/bin/env -S npx tsx
// UR-Bridge — FFI Bindgen Benchmark (Stage 2.5)
//
// Usage: npx tsx tools/benchmark-ffi-bindgen.ts
//
// Measures: generation time for 1000 functions, memory delta, output
// file size, and downstream validity (the generated 1000-function
// binding is also fed through the real UR lexer/parser/type-checker
// to confirm speed doesn't come at the cost of correctness).

import { parseCHeader } from "../src/ffi/bindgen/c-header-parser.js";
import { convertCHeaderToAbi } from "../src/ffi/bindgen/converter.js";
import { emitUrBindings } from "../src/ffi/bindgen/emitter.js";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";

const FUNCTION_COUNT = 1000;

function buildSyntheticHeader(count: number): string {
  let header = "";
  for (let i = 0; i < count; i++) {
    header += `int func_${i}(int a, float b, const char* c);\n`;
  }
  return header;
}

async function main() {
  const header = buildSyntheticHeader(FUNCTION_COUNT);

  const memBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();

  const h = parseCHeader(header);
  const { module } = convertCHeaderToAbi(h, { moduleName: "bench" });
  const code = emitUrBindings(module);

  const t1 = performance.now();
  const memAfter = process.memoryUsage().heapUsed;

  console.log(`UR-Bridge FFI Bindgen Benchmark — ${FUNCTION_COUNT} functions\n`);
  console.log(`Functions generated:        ${module.functions.length}`);
  console.log(`Generation time (parse+convert+emit): ${(t1 - t0).toFixed(2)}ms`);
  console.log(`Memory delta (heap):         ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Output size:                 ${(Buffer.byteLength(code, "utf-8") / 1024).toFixed(2)} KB (${code.length} chars)`);

  // Downstream validity + its own timing — speed must not come at the
  // cost of correctness.
  const t2 = performance.now();
  const { tokens } = lex(code);
  const { errors, program } = parse(tokens);
  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  const t3 = performance.now();

  console.log(`\nDownstream validity: parse errors=${errors.length}, typecheck errors=${tcErrors.length}`);
  console.log(`lex+parse+typecheck time for ${FUNCTION_COUNT} generated functions: ${(t3 - t2).toFixed(2)}ms`);

  if (errors.length > 0 || tcErrors.length > 0) {
    console.error("\n❌ BENCHMARK FAILED: generated output is not valid UR at this scale.");
    process.exit(1);
  }
  console.log("\n✅ Generated output is valid UR at 1000-function scale.");
}

main();
