import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";

// WASM Backend Struct support, Phase 1 (per WASM_BUMP_ALLOCATOR_STUDY.md
// and the explicit staged-implementation direction): local struct only,
// straight-line functions only (no if/else, no loops, no parameters, no
// returns, no imports). Real proof: real WASM bytecode generated, real
// execution via the real WebAssembly runtime, not just IR/encoder success.

async function compileAndRunWasm(src: string, exportName = "f"): Promise<bigint> {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const wasmBytes = emitWasmModule(ir.value);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return (instance.exports as any)[exportName]();
}

describe("WASM Backend Struct Phase 1: local struct only, real WASM generation + real execution", () => {
  it("real struct construction and field read produce the correct real runtime result via WebAssembly", async () => {
    const result = await compileAndRunWasm("struct Point\n  x: int\n  y: int\nend\nfunction f(): int\n  let p = Point(3, 4)\n  return p.x + p.y\nend\n");
    expect(result).toBe(7n);
  });

  it("real field mutation (multiple field_stores to the same slot) produces the correct real runtime result", async () => {
    const result = await compileAndRunWasm("struct Counter\n  value: int\nend\nfunction f(): int\n  let c = Counter(0)\n  c.value = c.value + 1\n  c.value = c.value + 1\n  return c.value\nend\n");
    expect(result).toBe(2n);
  });

  it("a single-field struct works correctly", async () => {
    const result = await compileAndRunWasm("struct Box\n  value: int\nend\nfunction f(): int\n  let b = Box(42)\n  return b.value\nend\n");
    expect(result).toBe(42n);
  });

  it("multiple, independently-allocated struct variables in the same function do not alias each other", async () => {
    const result = await compileAndRunWasm("struct Point\n  x: int\nend\nfunction f(): int\n  let a = Point(1)\n  let b = Point(2)\n  a.x = 100\n  return a.x + b.x\nend\n");
    expect(result).toBe(102n);
  });

  it("REGRESSION MARKER (risk table's own first row): a struct and an array coexisting in the same function do not collide in local-index or memory-address space", async () => {
    const result = await compileAndRunWasm("struct Point\n  x: int\nend\nfunction f(): int\n  let arr = [10, 20, 30]\n  let p = Point(5)\n  return arr[1] + p.x\nend\n");
    expect(result).toBe(25n);
  });

  it("KNOWN, DISCLOSED SCOPE BOUNDARY: struct-typed function parameters are explicitly rejected in Phase 1 (not silently mishandled) - a later phase, per the staged plan", () => {
    const src = "struct Point\n  x: int\nend\nfunction useIt(p: Point): int\n  return p.x\nend\nfunction f(): int\n  return 0\nend\n";
    const { program } = parse(lex(src).tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    expect(() => emitWasmModule(ir.value)).toThrow();
  });
});
