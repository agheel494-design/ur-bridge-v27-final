#!/usr/bin/env -S npx tsx
// UR Language Conformance Suite — Official Runner
//
// Usage: npx tsx tools/run-conformance.ts
//
// Runs every case in conformance/ against the current compiler,
// compares actual output to the recorded .expected.json, and prints
// a clear PASS/FAIL report. Exits non-zero if any case fails, so it
// is safe to use as a CI/Quality-Gate check.
//
// This is intentionally standalone (does not depend on Vitest) so it
// can run with a single command in any environment with tsx
// available, per explicit Stage 1 instruction: "أداة تشغيل رسمية
// تعمل بأمر واحد."

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "./backend/c-compile.js";
import { emitWasmModule } from "../src/backend/wasm/emit-wasm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_DIR = join(__dirname, "..", "conformance");

function irSummary(mod: any) {
  const counts: Record<string, number> = {};
  for (const fn of mod.functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        counts[inst.kind] = (counts[inst.kind] ?? 0) + 1;
      }
    }
  }
  return { functionCount: mod.functions.length, instructionKindCounts: counts };
}

function stripLocations(diags: readonly any[]): any[] {
  return diags.map(d => ({ code: d.code, message: d.message, severity: d.severity }));
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface CaseResult {
  name: string;
  pass: boolean;
  failReason?: string;
}

async function runCase(name: string): Promise<CaseResult> {
  const src = readFileSync(join(CONFORMANCE_DIR, `${name}.ur`), "utf-8");
  const expected = JSON.parse(readFileSync(join(CONFORMANCE_DIR, `${name}.expected.json`), "utf-8"));

  const { tokens } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  if (!deepEqual(stripLocations(parseErrors), stripLocations(expected.parseDiagnostics ?? []))) {
    return { name, pass: false, failReason: `parseDiagnostics mismatch: got ${JSON.stringify(stripLocations(parseErrors))}` };
  }
  if (parseErrors.length) return { name, pass: true };

  const tc = typeCheck(program);
  if (!deepEqual(stripLocations(tc.diagnostics ?? []), stripLocations(expected.typecheckDiagnostics ?? []))) {
    return { name, pass: false, failReason: `typecheckDiagnostics mismatch` };
  }
  const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErr.length) return { name, pass: true };

  const ir = lowerToIR(program, `${name}.ur`, name);
  if (ir.ok !== expected.lowerOk) return { name, pass: false, failReason: `lowerOk mismatch: expected ${expected.lowerOk}, got ${ir.ok}` };
  if (!ir.ok) {
    if (!deepEqual(stripLocations(ir.diagnostics ?? []), stripLocations(expected.lowerDiagnostics ?? []))) {
      return { name, pass: false, failReason: `lowerDiagnostics mismatch` };
    }
    return { name, pass: true };
  }

  if (!deepEqual(irSummary(ir.value), expected.irSummary)) {
    return { name, pass: false, failReason: `irSummary mismatch` };
  }

  const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
  if (compiled.ok !== expected.cCompiles) return { name, pass: false, failReason: `cCompiles mismatch` };
  if (compiled.ok) {
    const r = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    if (r.exitCode !== expected.cRuntimeExitCode) {
      return { name, pass: false, failReason: `cRuntimeExitCode mismatch: expected ${expected.cRuntimeExitCode}, got ${r.exitCode}` };
    }
  }

  try {
    const bytes = emitWasmModule(ir.value);
    if (!expected.wasmAccepted) return { name, pass: false, failReason: `wasmAccepted mismatch: expected rejection, but WASM accepted the module` };
    const { instance } = (await WebAssembly.instantiate(bytes)) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
    const result = ((instance.exports.main as () => bigint)()).toString();
    if (result !== expected.wasmRuntimeResult) return { name, pass: false, failReason: `wasmRuntimeResult mismatch: expected ${expected.wasmRuntimeResult}, got ${result}` };
  } catch {
    if (expected.wasmAccepted) return { name, pass: false, failReason: `wasmAccepted mismatch: expected acceptance, but WASM rejected the module` };
  }

  return { name, pass: true };
}

async function main() {
  const caseNames = readdirSync(CONFORMANCE_DIR)
    .filter(f => f.endsWith(".ur"))
    .map(f => f.slice(0, -3))
    .sort();

  console.log(`UR Language Conformance Suite — ${caseNames.length} case(s)\n`);

  const results: CaseResult[] = [];
  for (const name of caseNames) {
    try {
      results.push(await runCase(name));
    } catch (e) {
      results.push({ name, pass: false, failReason: `THREW: ${(e as Error).message}` });
    }
  }

  for (const r of results) {
    console.log(`${r.pass ? "✓ PASS" : "✗ FAIL"}  ${r.name}${r.failReason ? " — " + r.failReason : ""}`);
  }

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Total: ${results.length}  Passed: ${passCount}  Failed: ${failCount}`);
  console.log(failCount === 0 ? "\n✅ ALL CONFORMANCE CASES PASS" : "\n❌ CONFORMANCE FAILURES DETECTED");

  process.exit(failCount === 0 ? 0 : 1);
}

main();
