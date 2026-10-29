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

// The THIRD real, standalone UR program (examples/rpn_evaluator.ur).
// Designed precisely within the confirmed Language Fundamentals Map
// (ARCHITECTURE.md §11) - recursion (used for power()) and a
// manually-managed stack array kept local to main() (per the
// confirmed array-parameter limitation).

describe("examples/rpn_evaluator.ur: the third real, standalone UR program", () => {
  it("compiles through the full real pipeline with zero errors", () => {
    const src = readFileSync(__dirname + "/../../examples/rpn_evaluator.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "rpn.ur", "rpn");
    expect(ir.ok).toBe(true);
  });

  it("compiles via real gcc and runs standalone: (3+4)*2=14, and recursion (2^10=1024) both correct", () => {
    const src = readFileSync(__dirname + "/../../examples/rpn_evaluator.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "rpn.ur", "rpn");
    if (!ir.ok) throw new Error("lowering failed");
    writeFileSync("/tmp/rpn_regression.c", emitC(ir.value));
    execSync(`gcc /tmp/rpn_regression.c runtime/ur_runtime.c -I runtime -o /tmp/rpn_regression_bin`, { cwd: __dirname + "/../.." });
    const output = execSync("/tmp/rpn_regression_bin").toString().replace(/\r\n/g, "\n").trim().split("\n");
    expect(output).toEqual(["14", "1024"]);
  });
});

