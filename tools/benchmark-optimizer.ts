#!/usr/bin/env -S npx tsx
// UR-Bridge — Optimizer Multi-Size Benchmark
// Compiler & Runtime Stabilization phase, per explicit review request:
// a single-size benchmark can hide residual superlinear scaling (exactly
// what happened here — see OPTIMIZER_PERFORMANCE_REPORT.md for the full
// story). This benchmark always runs across multiple sizes so a future
// regression can't hide in an untested range again.
//
// Usage: npx tsx tools/benchmark-optimizer.ts
// For accurate heap-delta numbers: node --expose-gc $(which tsx) tools/benchmark-optimizer.ts

import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { runPipeline } from "../src/optimizer/pass.js";
import { constantFoldingPass } from "../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../src/optimizer/dead-code-elimination.js";

declare const global: { gc?: () => void };

function buildProgram(fnCount: number): string {
  let src = "";
  for (let i = 0; i < fnCount; i++) {
    src += `function f${i}(a: int, b: int): int\n`;
    src += `  let x = a + b\n  let y = x * 2\n`;
    src += `  if y > 10\n    y = y - 1\n  else\n    y = y + 1\n  end\n`;
    src += `  let i = 0\n  while i < 5\n    y = y + i\n    i = i + 1\n  end\n`;
    src += `  return y\nend\n\n`;
  }
  src += `function main(): int\n  return f0(1, 2)\nend\n`;
  return src;
}

function fmtMB(bytes: number) { return (bytes / 1024 / 1024).toFixed(2) + " MB"; }

function main() {
  console.log("UR-Bridge Optimizer Multi-Size Benchmark\n");
  console.log("size".padEnd(8), "total(ms)".padEnd(12), "ms/fn".padEnd(10), "heapΔ".padEnd(10), "rssΔ");

  for (const size of [50, 200, 1000, 5000]) {
    const src = buildProgram(size);
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "bench.ur", "bench");
    if (!ir.ok) { console.log(`${size}: LOWER FAIL`); continue; }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();
    const t0 = performance.now();
    for (const fn of ir.value.functions) {
      runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass], ir.value.functions);
    }
    const elapsed = performance.now() - t0;
    const memAfter = process.memoryUsage();

    console.log(
      String(size).padEnd(8),
      elapsed.toFixed(2).padEnd(12),
      (elapsed / size).toFixed(3).padEnd(10),
      fmtMB(memAfter.heapUsed - memBefore.heapUsed).padEnd(10),
      fmtMB(memAfter.rss - memBefore.rss),
    );
  }

  console.log("\nNote: ms/fn should stay roughly CONSTANT across sizes for a");
  console.log("truly linear-time optimizer. A growing ms/fn at larger sizes");
  console.log("indicates residual superlinear scaling — see");
  console.log("OPTIMIZER_PERFORMANCE_REPORT.md for this project's own known,");
  console.log("disclosed status on this point (not yet fully linear at 5000+).");
}

main();
