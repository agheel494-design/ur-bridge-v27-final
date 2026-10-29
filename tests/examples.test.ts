import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "fs";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../tools/backend/c-compile.js";
import { emitWasmModule } from "../src/backend/wasm/emit-wasm.js";

// UR Language Official Examples — Stage 2 of the sequential roadmap.
// Every example in examples/ must compile and run correctly on the C
// Backend, per Stage 2's own explicit requirement ("مع اختبار كل
// مثال"). This suite enforces that directly.

const EXAMPLES_DIR = new URL("../examples/", import.meta.url);

const expectedResults: Record<string, number> = {
  basics_rectangle_area: 60,
  fibonacci: 55,
  array_sum: 108,
  struct_point: 4,
  factorial_recursive: 120,
  std_math_usage: 100,
  byte_pixel: 255,
  type_alias: 30,
  calculator: 0,
  point_factory: 0,
  // RB3-TEST-REALIGNMENT (STALE REFERENCE, RB3-B1): examples added after this table was written. Values verified
  // identical on the C backend and on the interpreter (`ur run`) before being recorded.
  game_tictactoe: 0,
  rpn_evaluator: 0,
};

// RB3-TEST-REALIGNMENT (STALE REFERENCE, RB3-B1): these examples import a manifest-based FRI package. FRI
// (Mechanism B) runs through the CLI/interpreter, not through this standalone C-backend harness (which lowers
// a single file without import resolution), so they are verified through the CLI instead - never skipped.
const friExamples: Record<string, number> = {
  "c-bridge-proof": 49,   // squareFn(7) via the C runtime
  "cpp-bridge-proof": 27, // tripleFn(9) via the C++ runtime
};

const exampleNames = readdirSync(fileURLToPath(new URL(".", EXAMPLES_DIR)))
  .filter(f => f.endsWith(".ur"))
  .map(f => f.slice(0, -3))
  .sort();

describe("UR Language Official Examples (examples/) — each runs correctly on the C Backend", () => {
  it("every .ur file in examples/ has a corresponding expected result recorded in this test file", () => {
    for (const name of exampleNames) {
      expect(name in expectedResults || name in friExamples, `examples/${name}.ur has no recorded expected result — add one before shipping`).toBe(true);
    }
  });

  for (const name of exampleNames.filter(n => !(n in friExamples))) {
    it(`${name}.ur compiles and runs correctly`, () => {
      const src = readFileSync(new URL(`${name}.ur`, EXAMPLES_DIR), "utf-8");
      const { tokens } = lex(src);
      const { program, errors } = parse(tokens);
      expect(errors).toEqual([]);
      const tc = typeCheck(program);
      const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
      expect(tcErr).toEqual([]);
      const ir = lowerToIR(program, `${name}.ur`, name);
      expect(ir.ok).toBe(true);
      if (!ir.ok) return;
      const compiled = compileC(emitC(ir.value), "a.out", { captureWarnings: true });
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const r = runExecutable(compiled.value);
      cleanupExecutable(compiled.value);
      expect(r.exitCode).toBe(expectedResults[name]);
    });
  }

  for (const [name, expected] of Object.entries(friExamples)) {
    it(`${name}.ur (FRI example) runs correctly through the CLI - exit ${expected}`, () => {
      const r = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("tsx/cli"), fileURLToPath(new URL("../src/cli/index.ts", import.meta.url)), "run", `${name}.ur`],
        { cwd: fileURLToPath(EXAMPLES_DIR), encoding: "utf-8" });
      expect(r.status).toBe(expected);
    });
  }

  it("basics_rectangle_area.ur ALSO runs correctly on the WASM Backend (no function-call-with-args, unlike most other examples)", async () => {
    const src = readFileSync(new URL("basics_rectangle_area.ur", EXAMPLES_DIR), "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "basics_rectangle_area.ur", "basics_rectangle_area");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const bytes = emitWasmModule(ir.value);
    const { instance } = await WebAssembly.instantiate(bytes);
    const result = (instance.exports.main as () => bigint)();
    expect(result).toBe(60n);
  });
});
