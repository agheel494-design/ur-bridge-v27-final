import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The FIRST real, standalone UR program (examples/calculator.ur) -
// per the direct discussion that a real program is worth more than
// architectural documentation. Confirms the Runtime Builtin
// philosophy (print(...) as a real, working Intrinsic, per
// ARCHITECTURE.md §9) via a real gcc compile + standalone execution
// - not a manually-invoked WebAssembly call.

describe("examples/calculator.ur: the first real, standalone UR program", () => {
  it("compiles through the full real pipeline (Lexer -> Parser -> IR -> C) with zero errors", () => {
    const src = readFileSync(__dirname + "/../../examples/calculator.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "calculator.ur", "calculator");
    expect(ir.ok).toBe(true);
  });

  it("compiles via real gcc and runs as a genuinely standalone terminal program, producing the real, correct output", () => {
    const src = readFileSync(__dirname + "/../../examples/calculator.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "calculator.ur", "calculator");
    if (!ir.ok) throw new Error("lowering failed");
    const cSource = emitC(ir.value);
    writeFileSync("/tmp/calculator_regression.c", cSource);
    execSync(`gcc /tmp/calculator_regression.c runtime/ur_runtime.c -I runtime -o /tmp/calculator_regression_bin`, { cwd: __dirname + "/../.." });
    const output = execSync("/tmp/calculator_regression_bin").toString().replace(/\r\n/g, "\n");
    // Real, expected values: 17+5=22, 17-5=12, 17*5=85, 17/5=3 (int), 17/0=0 (safe), isPrime(17)=true, isPrime(20)=false
    expect(output.trim().split("\n")).toEqual(["22", "12", "85", "3", "0", "true", "false"]);
  });
});

