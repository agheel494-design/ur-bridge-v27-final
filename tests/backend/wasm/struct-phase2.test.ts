import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";

async function run(src: string, exportName = "f"): Promise<bigint> {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const wasmBytes = emitWasmModule(ir.value);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return (instance.exports as any)[exportName]();
}

describe("WASM Backend Struct Phase 2: struct inside if/else and while, multiple structs, real execution", () => {
  it("struct field mutation inside a while loop produces the correct result", async () => {
    const result = await run("struct Counter\n  value: int\nend\nfunction f(): int\n  let c = Counter(0)\n  let i = 0\n  while i < 5\n    c.value = c.value + 1\n    i = i + 1\n  end\n  return c.value\nend\n");
    expect(result).toBe(5n);
  });

  it("struct field mutation inside if/else (both branches allocated in entry) produces the correct result", async () => {
    const result = await run("struct Point\n  x: int\nend\nfunction f(): int\n  let p = Point(10)\n  if p.x > 5\n    p.x = p.x + 100\n  else\n    p.x = 0\n  end\n  return p.x\nend\n");
    expect(result).toBe(110n);
  });

  it("REGRESSION MARKER: two structs plus an array, mutated inside a while loop together, do not collide in local-index or memory-address space", async () => {
    const result = await run("struct A\n  v: int\nend\nstruct B\n  v: int\nend\nfunction f(): int\n  let a = A(1)\n  let b = B(10)\n  let arr = [100, 200]\n  let i = 0\n  while i < 3\n    a.v = a.v + 1\n    b.v = b.v + 2\n    i = i + 1\n  end\n  return a.v + b.v + arr[0]\nend\n");
    expect(result).toBe(120n);
  });

  it("STRESS: 100 independently-allocated struct variables in the same function, all read back correctly", async () => {
    let src = "struct P\n  v: int\nend\nfunction f(): int\n";
    let sumExpr = "0";
    let expected = 0;
    for (let i = 0; i < 100; i++) {
      src += `  let s${i} = P(${i})\n`;
      sumExpr += ` + s${i}.v`;
      expected += i;
    }
    src += `  return ${sumExpr}\nend\n`;
    const result = await run(src);
    expect(result).toBe(BigInt(expected));
  });

  it("STRESS: 5000 field_store/field_load operations via a single loop, correct final value", async () => {
    const result = await run("struct Counter\n  value: int\nend\nfunction f(): int\n  let c = Counter(0)\n  let i = 0\n  while i < 5000\n    c.value = c.value + 1\n    i = i + 1\n  end\n  return c.value\nend\n");
    expect(result).toBe(5000n);
  });

  it("STRESS: 10 structs mutated together across 1000 loop iterations (10000 total field_store operations), correct final sum", async () => {
    let src = "struct P\n  v: int\nend\nfunction f(): int\n";
    for (let i = 0; i < 10; i++) src += `  let s${i} = P(0)\n`;
    src += "  let i = 0\n  while i < 1000\n";
    for (let i = 0; i < 10; i++) src += `    s${i}.v = s${i}.v + 1\n`;
    src += "    i = i + 1\n  end\n";
    let sumExpr = "0";
    for (let i = 0; i < 10; i++) sumExpr += ` + s${i}.v`;
    src += `  return ${sumExpr}\nend\n`;
    const result = await run(src);
    expect(result).toBe(10000n);
  });

  it("DETERMINISTIC FUZZ (seed-fixed, reproducible): 200 randomly-shaped struct programs all produce the correct result", async () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const rndInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

    let allPassed = true;
    const failures: string[] = [];

    for (let trial = 0; trial < 200; trial++) {
      const numFields = rndInt(1, 5);
      const fieldNames = Array.from({ length: numFields }, (_, i) => `f${i}_x${rndInt(0, 999)}`);
      const numStructs = rndInt(1, 6);

      let src = "struct S\n";
      for (const fn of fieldNames) src += `  ${fn}: int\n`;
      src += "end\nfunction f(): int\n";

      const initValues: number[][] = [];
      for (let s = 0; s < numStructs; s++) {
        const vals = fieldNames.map(() => rndInt(0, 100));
        initValues.push(vals);
        src += `  let s${s} = S(${vals.join(", ")})\n`;
      }
      const expectedFinal = initValues.map(v => [...v]);
      const numOps = rndInt(0, 10);
      for (let op = 0; op < numOps; op++) {
        const s = rndInt(0, numStructs - 1);
        const fIdx = rndInt(0, numFields - 1);
        const delta = rndInt(0, 50);
        const isSub = rnd() < 0.5;
        src += `  s${s}.${fieldNames[fIdx]} = s${s}.${fieldNames[fIdx]} ${isSub ? "-" : "+"} ${delta}\n`;
        expectedFinal[s][fIdx] += isSub ? -delta : delta;
      }
      const expectedSum = expectedFinal.flat().reduce((a, b) => a + b, 0);
      const returnExpr = initValues.map((_, s) => fieldNames.map(fname => `s${s}.${fname}`).join(" + ")).join(" + ");
      src += `  return ${returnExpr}\nend\n`;

      try {
        const result = await run(src);
        if (result !== BigInt(expectedSum)) {
          allPassed = false;
          failures.push(`trial ${trial}: expected ${expectedSum}, got ${result}`);
        }
      } catch (e: any) {
        allPassed = false;
        failures.push(`trial ${trial}: threw ${e.message}`);
      }
    }

    if (!allPassed) console.error(failures.slice(0, 5).join("\n"));
    expect(allPassed).toBe(true);
  }, 20000);

  it("KNOWN, DISCLOSED SCOPE BOUNDARY: conditionally constructing a struct inside only one branch of if/else is explicitly rejected, not silently mishandled", () => {
    const src = "struct Point\n  x: int\nend\nfunction f(): int\n  let y = 1\n  if y == 1\n    let p = Point(5)\n    y = p.x\n  else\n    y = 0\n  end\n  return y\nend\n";
    const { program } = parse(lex(src).tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) { expect(true).toBe(true); return; }
    expect(() => emitWasmModule(ir.value)).toThrow();
  });
});
