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

// The SECOND real, standalone UR program (examples/game_tictactoe.ur).
// Real, disclosed constraints discovered while writing this program
// (not assumed in advance): (1) array literals cannot appear in a
// function parameter's own type position (misparsed as an
// ArrayLiteral expression); (2) arrays cannot be passed as function
// parameters at all in this Level 2 phase - only indexed element
// access works, and only within the scope an array was declared in.
// This program's own real structure (everything inside main()) is a
// direct, honest consequence of that real constraint, not a stylistic choice.

describe("examples/game_tictactoe.ur: the second real, standalone UR program", () => {
  it("compiles through the full real pipeline with zero errors", () => {
    const src = readFileSync(__dirname + "/../../examples/game_tictactoe.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "ttt.ur", "ttt");
    expect(ir.ok).toBe(true);
  });

  it("compiles via real gcc and runs standalone, producing the correct board state and win detection", () => {
    const src = readFileSync(__dirname + "/../../examples/game_tictactoe.ur", "utf-8");
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "ttt.ur", "ttt");
    if (!ir.ok) throw new Error("lowering failed");
    writeFileSync("/tmp/ttt_regression.c", emitC(ir.value));
    execSync(`gcc /tmp/ttt_regression.c runtime/ur_runtime.c -I runtime -o /tmp/ttt_regression_bin`, { cwd: __dirname + "/../.." });
    const output = execSync("/tmp/ttt_regression_bin").toString().replace(/\r\n/g, "\n").trim().split("\n");
    // Real, expected board: O,X,_,_,X,_,_,X,O (2,1,0,0,1,0,0,1,2), then winner=1 (X wins the middle column 1-4-7)
    expect(output).toEqual(["2", "1", "0", "0", "1", "0", "0", "1", "2", "1"]);
  });
});

