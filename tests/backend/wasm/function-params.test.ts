import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";
import { WASM_CODES, WasmUnsupportedError } from "../../../src/backend/wasm/wasm-diagnostics.js";
import { makeHostStub } from "../../../tools/backend/differential-runner.js";

async function run(src: string, exportName = "main"): Promise<bigint> {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const wasmBytes = emitWasmModule(ir.value);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return (instance.exports as any)[exportName]();
}

describe("WASM Backend function parameters (primitives) - Gate 3's own 8 required tests", () => {
  it("Test 1: two functions with two DIFFERENT signatures work independently", async () => {
    const result = await run("function add(a: int, b: int): int\n  return a + b\nend\nfunction single(x: int): int\n  return x\nend\nfunction main(): int\n  return add(1, 2) + single(10)\nend\n");
    expect(result).toBe(13n);
  });

  it("Test 2: two functions with the IDENTICAL signature reuse one type (deduplication), both callable correctly", async () => {
    const result = await run("function add(a: int, b: int): int\n  return a + b\nend\nfunction sub2(a: int, b: int): int\n  return a - b\nend\nfunction main(): int\n  return add(10, 3) + sub2(10, 3)\nend\n");
    expect(result).toBe(20n);
  });

  it("Test 3: nested/chained calls - one call's result feeds another call's argument", async () => {
    const result = await run("function add(a: int, b: int): int\n  return a + b\nend\nfunction inc(x: int): int\n  return x + 1\nend\nfunction main(): int\n  return inc(add(1, 2))\nend\n");
    expect(result).toBe(4n);
  });

  it("Test 4: a parameter used inside a while loop across multiple iterations produces the correct result", async () => {
    const result = await run("function sumUpTo(n: int): int\n  let total = 0\n  let i = 0\n  while i < n\n    total = total + i\n    i = i + 1\n  end\n  return total\nend\nfunction main(): int\n  return sumUpTo(5)\nend\n");
    expect(result).toBe(10n);
  });

  it("Test 5: a function with parameters AND its own local scalar AND its own local array - no local-index collision", async () => {
    const result = await run("function f(a: int, b: int): int\n  let sum = a + b\n  let arr = [100, 200]\n  return sum + arr[0]\nend\nfunction main(): int\n  return f(1, 2)\nend\n");
    expect(result).toBe(103n);
  });

  // P0 D-A1 (PM decision 2026-10-18): the former Test 6 expected print(5) to be
  // rejected with WASM1004. That expectation is stale: print(int) is imported as
  // ur_print_int (P1-3C; DR-RB3-01 amended), and the same assertion was already
  // superseded in emit-wasm.test.ts. The test is corrected, not the
  // implementation: 6a proves print(int) is accepted by an OBSERVED host call;
  // 6b proves an extern outside the WASM-importable set (f64) is still
  // rejected with WASM1004; 6c records the separate bool-constant rejection
  // (WASM1001, D-A1-bis). Lowering failure is an explicit failure, not a
  // silent pass.
  function lowerForTest6(src: string) {
    const { program, errors } = parse(lex(src).tokens);
    expect(errors, `parse errors: ${JSON.stringify(errors)}`).toEqual([]);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok, `lowering failed: ${ir.ok ? "" : JSON.stringify(ir.diagnostics)}`).toBe(true);
    if (!ir.ok) throw new Error("unreachable: lowering asserted ok above");
    return ir.value;
  }

  it("Test 6a: print(5) (a Builtin with an int argument) is ACCEPTED on WASM and really calls the host import ur_print_int(5n) exactly once", async () => {
    const module = lowerForTest6("function main(): int\n  print(5)\n  return 1\nend\n");
    const wasmBytes = new Uint8Array(emitWasmModule(module));
    const stub = makeHostStub();
    const { instance } = await WebAssembly.instantiate(wasmBytes, stub.importObject);
    stub.setMemoryRefs(instance);
    const result = (instance.exports as any).main();
    expect(result).toBe(1n);
    expect(stub.printedInts).toEqual([5n]);
    expect(stub.printedFloats).toEqual([]);
    expect(stub.printedStrings).toEqual([]);
  });

  it("Test 6b: print(<float>) via print(1.5) is still REJECTED on WASM at the import boundary with WASM1004, naming the extern ur_print_float", () => {
    const module = lowerForTest6("function main(): int\n  print(1.5)\n  return 1\nend\n");
    let caught: unknown;
    try { emitWasmModule(module); } catch (e) { caught = e; }
    expect(caught, "emitWasmModule must throw").toBeInstanceOf(WasmUnsupportedError);
    expect((caught as WasmUnsupportedError).diagnostic.code).toBe(WASM_CODES.UNSUPPORTED_RUNTIME_FEATURE);
    expect((caught as Error).message).toContain("ur_print_float");
  });

  // P0 D-A1-bis (PM decision 2026-10-18, option c): print(true) is NOT an
  // import-boundary case. It is rejected earlier, with WASM1001, because a
  // bool constant is not yet supported on WASM; the call check is never
  // reached. This separate test records that real behaviour under its own code.
  it("Test 6c: print(true) is REJECTED on WASM with WASM1001 (bool constant not supported yet), before the import-boundary check", () => {
    const module = lowerForTest6("function main(): int\n  print(true)\n  return 1\nend\n");
    let caught: unknown;
    try { emitWasmModule(module); } catch (e) { caught = e; }
    expect(caught, "emitWasmModule must throw").toBeInstanceOf(WasmUnsupportedError);
    expect((caught as WasmUnsupportedError).diagnostic.code).toBe(WASM_CODES.UNSUPPORTED_INSTRUCTION);
    expect((caught as Error).message).toContain("const_bool");
  });

  it("Test 8: WebAssembly.instantiate() itself succeeds for a varied set of parameter/return-type combinations", async () => {
    const zeroParam = await run("function main(): int\n  return 42\nend\n");
    const oneParam = await run("function f(x: int): int\n  return x\nend\nfunction main(): int\n  return f(5)\nend\n");
    const twoParam = await run("function f(a: int, b: int): int\n  return a + b\nend\nfunction main(): int\n  return f(2, 3)\nend\n");
    const threeParam = await run("function f(a: int, b: int, c: int): int\n  return a + b + c\nend\nfunction main(): int\n  return f(1, 2, 3)\nend\n");
    expect([zeroParam, oneParam, twoParam, threeParam]).toEqual([42n, 5n, 5n, 6n]);
  });

  it("KNOWN, DISCLOSED SCOPE BOUNDARY: struct-typed function parameters remain explicitly rejected (a separate, later phase)", () => {
    const src = "struct Point\n  x: int\nend\nfunction useIt(p: Point): int\n  return p.x\nend\nfunction main(): int\n  return 0\nend\n";
    const { program } = parse(lex(src).tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) return;
    expect(() => emitWasmModule(ir.value)).toThrow();
  });
});
