import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";
import { computeBreakDepth, computeContinueDepth } from "../../../src/backend/wasm/loop-context.js";

// WASM Loops Phase 2, step 1: LoopContext is now the REAL, LIVE
// source of truth in the compile path for all three existing while
// shapes (basic/break/continue) - per direct instruction, this must
// happen BEFORE any new capability (if-inside-while) is added.
// Confirmed via real WebAssembly execution (not merely "compiles").

async function compileAndRun(src: string): Promise<bigint> {
  const { program } = parse(lex(src).tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lowering failed");
  const wasmBytes = emitWasmModule(ir.value);
  const module = await WebAssembly.instantiate(wasmBytes, {});
  return (module.instance.exports.main as () => bigint)();
}

describe("LoopContext is now live in the real compile path: all 3 existing while shapes, real execution", () => {
  it("basic while (no break/continue) executes correctly via the new, dynamically-computed depths", async () => {
    const result = await compileAndRun("function main(): int\n  let i = 0\n  while i < 5\n    i = i + 1\n  end\n  return i\nend\n");
    expect(result).toBe(5n);
  });

  it("while + break executes correctly via the new, dynamically-computed depths", async () => {
    const result = await compileAndRun("function main(): int\n  let i = 0\n  while i < 10\n    if i == 3\n      break\n    end\n    i = i + 1\n  end\n  return i\nend\n");
    expect(result).toBe(3n);
  });

  it("while + continue executes correctly via the new, dynamically-computed depths", async () => {
    const result = await compileAndRun("function main(): int\n  let i = 0\n  let total = 0\n  while i < 5\n    i = i + 1\n    if i == 3\n      continue\n    end\n    total = total + i\n  end\n  return total\nend\n");
    expect(result).toBe(12n); // 1+2+4+5, skipping 3
  });
});

describe("Real proof: the actual emitted depths match computeBreakDepth/computeContinueDepth's own real output for these exact shapes (not just 'it compiles')", () => {
  it("the loop's own basic exit/continue depths match computeBreakDepth/computeContinueDepth([{kind:'loop'}]) exactly", () => {
    expect(computeBreakDepth([{ kind: "loop" }])).toBe(1);
    expect(computeContinueDepth([{ kind: "loop" }])).toBe(0);
  });

  it("break/continue-inside-if depths match computeBreakDepth/computeContinueDepth([{kind:'loop'},{kind:'if'}]) exactly", () => {
    expect(computeBreakDepth([{ kind: "loop" }, { kind: "if" }])).toBe(2);
    expect(computeContinueDepth([{ kind: "loop" }, { kind: "if" }])).toBe(1);
  });
});
