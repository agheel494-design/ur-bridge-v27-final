// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dead Code Elimination: small baseline benchmark
// Level 2.9, per explicit review request
// ─────────────────────────────────────────────────────────────────────────────
//
// NOT the future Performance Dashboard (OPTIMIZER_SPEC.md §11 —
// explicitly deferred, cross-cutting, built as its own later phase).
// This is a small, one-off, repeatable script recording DCE's time and
// removed-instruction count at three synthetic sizes, purely to
// establish a BASELINE for future comparison if the algorithm ever
// changes — not to render any judgment about performance now.
//
// Run manually: tsx tools/benchmark-dce.ts

import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { deadCodeEliminationPass } from "../src/optimizer/dead-code-elimination.js";
import { runPipeline, validateFunction } from "../src/optimizer/pass.js";

/**
 * Synthesizes a function with roughly `targetInstructionCount`
 * instructions: half genuinely dead (unused local constants/binops),
 * half live (chained into the final returned sum) — a realistic mix
 * rather than an all-dead or all-live degenerate case.
 */
function synthesize(targetInstructionCount: number): string {
  const halfCount = Math.floor(targetInstructionCount / 2);
  const lines: string[] = ["function bench(): int"];
  lines.push("  let total = 0");
  for (let i = 0; i < halfCount; i++) {
    lines.push(`  let dead${i} = ${i} + ${i + 1}`); // genuinely dead: never read
  }
  for (let i = 0; i < halfCount; i++) {
    lines.push(`  total = total + ${i}`); // genuinely live: feeds the final return
  }
  lines.push("  return total");
  lines.push("end");
  return lines.join("\n") + "\n";
}

function runBenchmark(targetInstructionCount: number): void {
  const src = synthesize(targetInstructionCount);
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) { console.log(`SKIP ${targetInstructionCount}: parse errors`); return; }
  const ir = lowerToIR(program, "bench.ur", "bench");
  if (!ir.ok) { console.log(`SKIP ${targetInstructionCount}: lowering failed`); return; }
  const fn = ir.value.functions[0]!;
  const beforeCount = fn.blocks.flatMap(b => b.instructions).length;

  const start = performance.now();
  const optimized = runPipeline(fn, [deadCodeEliminationPass]);
  const elapsedMs = performance.now() - start;

  const afterCount = optimized.blocks.flatMap(b => b.instructions).length;
  const removed = beforeCount - afterCount;
  const violations = validateFunction(optimized);

  console.log(
    `target=${targetInstructionCount.toString().padStart(6)}  ` +
    `actualBefore=${beforeCount.toString().padStart(6)}  ` +
    `after=${afterCount.toString().padStart(6)}  ` +
    `removed=${removed.toString().padStart(6)}  ` +
    `time=${elapsedMs.toFixed(2).padStart(8)}ms  ` +
    `violations=${violations.length}`,
  );
}

console.log("UR Optimizer — DCE baseline benchmark (per explicit review request; NOT the Performance Dashboard)");
console.log("=".repeat(100));
for (const size of [1000, 5000, 10000]) {
  runBenchmark(size);
}
