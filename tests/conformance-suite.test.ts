import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "fs";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../tools/backend/c-compile.js";
import { emitWasmModule } from "../src/backend/wasm/emit-wasm.js";

// UR Language Conformance Test Suite
//
// Every case in conformance/ has a `.ur` source file and a matching
// `.expected.json` recording actual pipeline output at the time it was
// generated (parse diagnostics, typecheck diagnostics, Lowering
// success/diagnostics, an IR instruction-kind-count summary, C Backend
// compile/runtime result, WASM Backend accept/reject result).
//
// This suite exists specifically so that any future compiler change
// which alters behavior for one of these cases is caught immediately,
// by name — matching the explicit purpose requested: a single
// reference point that "makes any future compiler change measurable
// and prevents regressions," not a general test of compiler internals.

const CONFORMANCE_DIR = new URL("../conformance/", import.meta.url);

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

function stripLocations(diags: any[]): any[] {
  // Compare diagnostics by code + message only — exact source-span
  // columns/lines are not the conformance contract; the CODE and
  // MESSAGE are (matching this project's own "docs must match code"
  // emphasis on message wording, not incidental position data).
  return diags.map(d => ({ code: d.code, message: d.message, severity: d.severity }));
}

const caseNames = readdirSync(fileURLToPath(new URL(".", CONFORMANCE_DIR)))
  .filter(f => f.endsWith(".ur"))
  .map(f => f.slice(0, -3))
  .sort();

describe("UR Language Conformance Suite", () => {
  for (const name of caseNames) {
    it(`${name}: matches recorded expected.json`, async () => {
      const src = readFileSync(new URL(`${name}.ur`, CONFORMANCE_DIR), "utf-8");
      const expected = JSON.parse(readFileSync(new URL(`${name}.expected.json`, CONFORMANCE_DIR), "utf-8"));

      const { tokens } = lex(src);
      const { program, errors: parseErrors } = parse(tokens);
      expect(stripLocations(parseErrors)).toEqual(stripLocations(expected.parseDiagnostics ?? []));
      if (parseErrors.length) return; // matches the generator's own early-stop logic

      const tc = typeCheck(program);
      expect(stripLocations(tc.diagnostics ?? [])).toEqual(stripLocations(expected.typecheckDiagnostics ?? []));
      const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
      if (tcErr.length) return;

      const ir = lowerToIR(program, `${name}.ur`, name);
      expect(ir.ok).toBe(expected.lowerOk);
      if (!ir.ok) {
        expect(stripLocations(ir.diagnostics ?? [])).toEqual(stripLocations(expected.lowerDiagnostics ?? []));
        return;
      }

      expect(irSummary(ir.value)).toEqual(expected.irSummary);

      const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
      expect(compiled.ok).toBe(expected.cCompiles);
      if (compiled.ok) {
        const r = runExecutable(compiled.value);
        cleanupExecutable(compiled.value);
        expect(r.exitCode).toBe(expected.cRuntimeExitCode);
      }

      try {
        const bytes = emitWasmModule(ir.value);
        expect(expected.wasmAccepted).toBe(true);
        const { instance } = await WebAssembly.instantiate(bytes);
        const result = ((instance.exports.main as () => bigint)()).toString();
        expect(result).toBe(expected.wasmRuntimeResult);
      } catch (e) {
        expect(expected.wasmAccepted).toBe(false);
      }
    });
  }
});
