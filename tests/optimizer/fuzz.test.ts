// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Fuzz Tests
// Level 2.9 Review & Stabilization, per explicit review request
// ─────────────────────────────────────────────────────────────────────────────
//
// Rather than generating raw, low-level random IR (which risks being
// structurally invalid in ways unrelated to what we actually want to
// fuzz — the OPTIMIZER's behavior), this generates many random, valid
// UR SOURCE programs via a deterministic seeded PRNG (reproducible
// failures, not a different random program every CI run), and pushes
// each through the REAL, complete pipeline: Lex -> Parse -> Semantic ->
// TypeCheck -> Lower -> [Constant Folding -> DCE] -> Optimization
// Validator -> Backend -> real gcc compile -> real execution — for
// BOTH the unoptimized baseline and the optimized version — asserting
// identical observable behavior for every single generated program.

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { checkModuleInvariants } from "../../src/shared/ir.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import { validateOptimization } from "../../src/optimizer/validate.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

function gccAvailable(): boolean {
  try { execSync("gcc --version", { stdio: "ignore" }); return true; } catch { return false; }
}
const hasGcc = gccAvailable();

/** A small, deterministic seeded PRNG (mulberry32) — reproducible across runs, no external dependency. */
function makeRng(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
function choice<T>(rng: () => number, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)]!;
}

/** Generates one random, valid UR program body using a small grammar of statements — plain arithmetic, if/else, while, arrays, structs — with a bounded, deterministic size. */
function generateRandomProgram(rng: () => number): string {
  const lines: string[] = [];
  let varCounter = 0;
  // CONFIRMED BUG (fixed): an earlier draft tracked all defined
  // variable names in ONE pool, regardless of type, and picked from it
  // for arithmetic operands — occasionally picking an array- or
  // struct-typed variable as an operand to `+`/`-`/`*`, which the
  // TypeChecker correctly rejects (TY3001). Fixed by tracking
  // int-typed variables SEPARATELY; arithmetic contexts only ever draw
  // from `intVars`.
  const intVars: string[] = [];

  function newIntVar(): string {
    const name = `v${varCounter++}`;
    intVars.push(name);
    return name;
  }
  function newNonIntVar(): string {
    return `v${varCounter++}`; // deliberately NOT added to intVars
  }

  function randomExprUsingExistingVarsOrLiteral(): string {
    if (intVars.length > 0 && rng() < 0.5) return choice(rng, intVars);
    return String(randInt(rng, 0, 20));
  }

  const structUsed = rng() < 0.5;
  if (structUsed) {
    lines.push("struct Pair", "  a: int", "  b: int", "end");
  }

  lines.push("function main(): int");

  const arrVar = newNonIntVar();
  lines.push(`  let ${arrVar} = [${randInt(rng, 1, 9)}, ${randInt(rng, 1, 9)}, ${randInt(rng, 1, 9)}]`);

  let structVar: string | undefined;
  if (structUsed) {
    structVar = newNonIntVar();
    lines.push(`  let ${structVar} = Pair(${randInt(rng, 1, 9)}, ${randInt(rng, 1, 9)})`);
  }

  const totalVar = newIntVar();
  lines.push(`  let ${totalVar} = 0`);

  const statementCount = randInt(rng, 3, 8);
  for (let i = 0; i < statementCount; i++) {
    const kind = choice(rng, ["arith", "if", "while", "arrayRead", "deadConst"] as const);
    if (kind === "arith") {
      const a = randomExprUsingExistingVarsOrLiteral();
      const b = randomExprUsingExistingVarsOrLiteral();
      const op = choice(rng, ["+", "-", "*"]);
      lines.push(`  ${totalVar} = ${totalVar} + (${a} ${op} ${b})`);
    } else if (kind === "if") {
      const cmp = choice(rng, ["==", "!=", "<", ">"]);
      lines.push(`  if ${totalVar} ${cmp} ${randInt(rng, 0, 10)}`);
      lines.push(`    ${totalVar} = ${totalVar} + ${randInt(rng, 1, 5)}`);
      lines.push(`  else`);
      lines.push(`    ${totalVar} = ${totalVar} + ${randInt(rng, 1, 5)}`);
      lines.push(`  end`);
    } else if (kind === "while") {
      const loopVar = newIntVar();
      const bound = randInt(rng, 1, 4);
      lines.push(`  let ${loopVar} = 0`);
      lines.push(`  while ${loopVar} < ${bound}`);
      lines.push(`    ${totalVar} = ${totalVar} + ${loopVar}`);
      lines.push(`    ${loopVar} = ${loopVar} + 1`);
      lines.push(`  end`);
    } else if (kind === "arrayRead") {
      lines.push(`  ${totalVar} = ${totalVar} + ${arrVar}[${randInt(rng, 0, 2)}]`);
    } else {
      // Deliberately dead: a foldable constant expression assigned to a variable never read again.
      const deadVar = newIntVar();
      lines.push(`  let ${deadVar} = ${randInt(rng, 1, 9)} + ${randInt(rng, 1, 9)}`);
      intVars.pop(); // don't let later statements reference this dead var - keep it genuinely dead
    }
  }

  if (structVar) lines.push(`  ${totalVar} = ${totalVar} + ${structVar}.a`);
  lines.push(`  return ${totalVar}`);
  lines.push("end");
  return lines.join("\n") + "\n";
}

function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length) throw new Error(`parse errors: ${JSON.stringify(parseErrors)}`);
  const sem = analyze(program);
  if (sem.diagnostics.length) throw new Error(`semantic errors: ${JSON.stringify(sem.diagnostics)}`);
  const types = typeCheck(program);
  if (types.diagnostics.length) throw new Error(`type errors: ${JSON.stringify(types.diagnostics)}`);
  const ir = lowerToIR(program, "fuzz.ur", "fuzz");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  const preViolations = checkModuleInvariants(ir.value);
  if (preViolations.length) throw new Error(`pre-opt IR invalid: ${JSON.stringify(preViolations)}`);

  const baselineCompiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
  if (!baselineCompiled.ok) throw new Error(`baseline gcc failed: ${JSON.stringify(baselineCompiled.diagnostics)}`);
  const baseline = runExecutable(baselineCompiled.value);
  cleanupExecutable(baselineCompiled.value);

  const fn = ir.value.functions[0]!;
  const optimizedFn = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
  const optValidation = validateOptimization(fn, optimizedFn);
  if (!optValidation.valid) throw new Error(`Optimization Validator failed: ${JSON.stringify(optValidation.violations)}`);
  if (validateFunction(optimizedFn).length) throw new Error("post-opt IR invalid");

  const optimizedCompiled = compileC(emitC({ ...ir.value, functions: [optimizedFn] }), "a.out", { captureWarnings: true });
  if (!optimizedCompiled.ok) throw new Error(`optimized gcc failed: ${JSON.stringify(optimizedCompiled.diagnostics)}`);
  const optimized = runExecutable(optimizedCompiled.value);
  cleanupExecutable(optimizedCompiled.value);

  return { baselineExit: baseline.exitCode, optimizedExit: optimized.exitCode, warnings: optimizedCompiled.value.warnings };
}

describe("optimizer fuzz tests — many random valid UR programs, full pipeline, real execution", () => {
  if (!hasGcc) { it.skip("SKIPPED: gcc not available", () => expect(true).toBe(true)); return; }

  const SEED = 20260709; // fixed seed - reproducible across every run, per explicit determinism requirement established for the Dataflow Framework
  const PROGRAM_COUNT = 30;
  const rng = makeRng(SEED);

  for (let i = 0; i < PROGRAM_COUNT; i++) {
    const src = generateRandomProgram(rng);
    it(`random program #${i} (seed ${SEED}): baseline and optimized produce IDENTICAL real execution results`, () => {
      let result;
      try {
        result = compileAndRun(src);
      } catch (e) {
        throw new Error(`FAILED on generated program:\n${src}\n\nError: ${e instanceof Error ? e.message : String(e)}`);
      }
      expect(result.optimizedExit).toBe(result.baselineExit);
      expect(result.warnings.trim()).toBe("");
    });
  }
});
