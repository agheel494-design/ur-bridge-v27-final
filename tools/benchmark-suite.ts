// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Real Benchmark Suite
// Level 2.9 Review & Stabilization, per explicit review request
// ─────────────────────────────────────────────────────────────────────────────
//
// Supersedes the earlier tools/benchmark-dce.ts (kept, but this is more
// complete): measures every stage separately —
//
//   Lowering time | Constant Folding time | DCE time | Backend time | Total
//
// — plus IR instruction counts before/after optimization, across a set
// of realistic program shapes (not just synthetic dead-code chains).
// This is a repeatable script producing a baseline snapshot, not a
// judgment about whether current numbers are "good" or "bad."
//
// Run manually: tsx tools/benchmark-suite.ts

import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { analyze } from "../src/compiler/semantic/index.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { constantFoldingPass } from "../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../src/optimizer/dead-code-elimination.js";
import { emitC } from "../src/backend/c/emit-c.js";
import type { IRFunction } from "../src/shared/ir.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, "..", "BENCHMARK_HISTORY.json");

type Scenario = { label: string; src: string };

const SCENARIOS: Scenario[] = [
  {
    label: "tiny (arithmetic only)",
    src: "function main(): int\n  return 2 + 3\nend\n",
  },
  {
    label: "small (while loop, 1 function)",
    src: "function main(): int\n  let i = 0\n  let total = 0\n  while i < 100\n    total = total + i\n    i = i + 1\n  end\n  return total\nend\n",
  },
  {
    label: "medium (struct + array + nested loops)",
    src: [
      "struct Point",
      "  x: int",
      "  y: int",
      "end",
      "function main(): int",
      "  let p = Point(0, 0)",
      "  let arr = [1, 2, 3, 4, 5]",
      "  let i = 0",
      "  while i < 5",
      "    let j = 0",
      "    while j < 5",
      "      p.x = p.x + arr[i % 5]",
      "      j = j + 1",
      "    end",
      "    i = i + 1",
      "  end",
      "  return p.x",
      "end",
      "",
    ].join("\n"),
  },
  {
    label: "large (20 functions, call chain + dead code)",
    src: (() => {
      let s = "";
      for (let i = 0; i < 20; i++) {
        s += `function f${i}(x: int): int\n  let dead${i} = ${i} + ${i + 1}\n  return ${i === 19 ? "x + 1" : `f${i + 1}(x) + 1`}\nend\n`;
      }
      s += "function main(): int\n  return f0(0)\nend\n";
      return s;
    })(),
  },
];

interface StageTiming {
  lexParseMs: number;
  semanticTypeMs: number;
  loweringMs: number;
  constantFoldingMs: number;
  dceMs: number;
  backendMs: number;
  totalMs: number;
  instructionsBefore: number;
  instructionsAfter: number;
}

function benchmarkScenario(src: string): StageTiming {
  const totalStart = performance.now();

  const t0 = performance.now();
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) throw new Error(`parse errors: ${JSON.stringify(parseErrors)}`);
  const t1 = performance.now();

  const sem = analyze(program);
  if (sem.diagnostics.length) throw new Error(`semantic errors: ${JSON.stringify(sem.diagnostics)}`);
  const types = typeCheck(program);
  if (types.diagnostics.length) throw new Error(`type errors: ${JSON.stringify(types.diagnostics)}`);
  const t2 = performance.now();

  const ir = lowerToIR(program, "bench.ur", "bench");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  const t3 = performance.now();

  let instructionsBefore = 0;
  let instructionsAfterCF = 0;
  let instructionsAfterDce = 0;
  let cfMs = 0;
  let dceMs = 0;

  const optimizedFns: IRFunction[] = [];
  for (const fn of ir.value.functions) {
    instructionsBefore += fn.blocks.flatMap(b => b.instructions).length;

    const cfStart = performance.now();
    const afterCf = constantFoldingPass.run(fn);
    cfMs += performance.now() - cfStart;
    instructionsAfterCF += afterCf.blocks.flatMap(b => b.instructions).length;

    const dceStart = performance.now();
    const afterDce = deadCodeEliminationPass.run(afterCf);
    dceMs += performance.now() - dceStart;
    instructionsAfterDce += afterDce.blocks.flatMap(b => b.instructions).length;

    optimizedFns.push(afterDce);
  }

  const backendStart = performance.now();
  emitC({ ...ir.value, functions: optimizedFns });
  const backendMs = performance.now() - backendStart;

  const totalMs = performance.now() - totalStart;

  return {
    lexParseMs: t1 - t0,
    semanticTypeMs: t2 - t1,
    loweringMs: t3 - t2,
    constantFoldingMs: cfMs,
    dceMs,
    backendMs,
    totalMs,
    instructionsBefore,
    instructionsAfter: instructionsAfterDce,
  };
}

function fmt(ms: number): string {
  return `${ms.toFixed(3)}ms`.padStart(10);
}

console.log("UR Optimizer — Real Benchmark Suite (per explicit review request)");
console.log("=".repeat(110));
console.log(
  "scenario".padEnd(38) +
  "lexParse".padStart(11) + "semType".padStart(11) + "lowering".padStart(11) +
  "constFold".padStart(11) + "dce".padStart(9) + "backend".padStart(10) +
  "total".padStart(10) + "  instr(before->after)"
);
console.log("-".repeat(110));

interface HistoryEntry {
  readonly recordedAt: string; // ISO timestamp
  readonly versionTag: string; // e.g. FREEZE_LOG.md's most recent tag, or "untagged"
  readonly results: Record<string, StageTiming>;
}

const runResults: Record<string, StageTiming> = {};

for (const scenario of SCENARIOS) {
  const timing = benchmarkScenario(scenario.src);
  runResults[scenario.label] = timing;
  console.log(
    scenario.label.padEnd(38) +
    fmt(timing.lexParseMs) + fmt(timing.semanticTypeMs) + fmt(timing.loweringMs) +
    fmt(timing.constantFoldingMs) + fmt(timing.dceMs) + fmt(timing.backendMs) +
    fmt(timing.totalMs) +
    `  ${timing.instructionsBefore} -> ${timing.instructionsAfter}`,
  );
}

console.log("\nNote: single-run wall-clock timings on this machine — a baseline for future comparison, not a performance claim.");

// Append this run to the historical record — per explicit review
// request — so future runs can be compared against every prior
// recorded run, not just the immediately preceding one.
const versionTagArg = process.argv[2] ?? "untagged";
const history: HistoryEntry[] = existsSync(HISTORY_PATH) ? JSON.parse(readFileSync(HISTORY_PATH, "utf-8")) : [];
history.push({ recordedAt: new Date().toISOString(), versionTag: versionTagArg, results: runResults });
writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
console.log(`\nAppended this run to ${HISTORY_PATH} (${history.length} recorded run(s) total). Pass a version tag as an argument, e.g.: tsx tools/benchmark-suite.ts v27-level2-9-optimizer`);
