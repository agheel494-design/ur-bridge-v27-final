import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";

// WASM Layer 2: real bytecode generation for the patterns Layer 1
// already accepted (per WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md).
// Every test here does a REAL WebAssembly.instantiate + REAL function
// call - not merely "did emitWasmModule throw" - per the explicit
// requirement for practical, verifiable evidence.

async function compileAndRun(src: string): Promise<bigint> {
  const { program } = parse(lex(src).tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lowering failed");
  const wasmBytes = emitWasmModule(ir.value);
  const module = await WebAssembly.instantiate(wasmBytes, {});
  return (module.instance.exports.main as () => bigint)();
}

describe("WASM Layer 2: real nested-if bytecode generation and execution", () => {
  it("the exact original motivating case (arr[0]/arr[1] via nested if) executes correctly: inner-true path", async () => {
    const result = await compileAndRun("function main(): int\n  let arr = [10, 20, 30]\n  let x = 0\n  if 1 == 1\n    if 2 == 2\n      x = arr[0]\n    else\n      x = arr[1]\n    end\n  else\n    x = 99\n  end\n  return x\nend\n");
    expect(result).toBe(10n);
  });

  it("same program, inner condition false: takes the else branch of the INNER if", async () => {
    const result = await compileAndRun("function main(): int\n  let arr = [10, 20, 30]\n  let x = 0\n  if 1 == 1\n    if 2 == 3\n      x = arr[0]\n    else\n      x = arr[1]\n    end\n  else\n    x = 99\n  end\n  return x\nend\n");
    expect(result).toBe(20n);
  });

  it("same program, outer condition false: takes the OUTER else, never touches the nested if at all", async () => {
    const result = await compileAndRun("function main(): int\n  let arr = [10, 20, 30]\n  let x = 0\n  if 1 == 2\n    if 2 == 2\n      x = arr[0]\n    else\n      x = arr[1]\n    end\n  else\n    x = 99\n  end\n  return x\nend\n");
    expect(result).toBe(99n);
  });

  it("nested if with no merge at all (every path returns directly)", async () => {
    const result = await compileAndRun("function main(): int\n  if 1 == 1\n    if 2 == 2\n      return 111\n    else\n      return 222\n    end\n  else\n    return 333\n  end\nend\n");
    expect(result).toBe(111n);
  });

  it("if WITHOUT else, containing a further nested if inside it", async () => {
    const result = await compileAndRun("function main(): int\n  let x = 5\n  if 1 == 1\n    if 2 == 2\n      x = 42\n    end\n  end\n  return x\nend\n");
    expect(result).toBe(42n);
  });

  it("real bytecode structural check: the generated .wasm contains real, valid magic number and version, and nested OPCODE_IF (0x04) appears more than once for a doubly-nested case", () => {
    const { program } = parse(lex("function main(): int\n  let x = 0\n  if 1 == 1\n    if 2 == 2\n      x = 1\n    else\n      x = 2\n    end\n  else\n    x = 3\n  end\n  return x\nend\n").tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const wasmBytes = emitWasmModule(ir.value);
    // Real WASM magic number (\0asm) and version 1.
    expect(Array.from(wasmBytes.slice(0, 8))).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const OPCODE_IF = 0x04;
    const ifCount = Array.from(wasmBytes).filter(b => b === OPCODE_IF).length;
    expect(ifCount).toBeGreaterThanOrEqual(2); // outer if + inner if, at minimum
  });

  it("Layer 1 is now actually used during real compilation - a previously-rejected nested-if program now compiles and runs, closing the isolated/unwired status", async () => {
    // This exact program shape was, before this Milestone, explicitly
    // rejected by validateScope with "unrecognized 7-block CFG shape".
    const result = await compileAndRun("function main(): int\n  let arr = [1, 2, 3]\n  let x = 0\n  if 5 == 5\n    if 6 == 6\n      x = arr[0]\n    else\n      x = arr[2]\n    end\n  else\n    x = 0\n  end\n  return x\nend\n");
    expect(result).toBe(1n);
  });
});
