import { describe, expect, it } from "vitest";

import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";
import {
  buildIR,
  makeHostStub,
} from "../../../tools/backend/differential-runner.js";

async function runStringLiteralProgram(value: string): Promise<string[]> {
  const built = buildIR(`
function main(): int
  print("${value}")
  return 0
end
`);

  expect(built.ok).toBe(true);

  if (!built.ok) {
    throw new Error(`buildIR failed: ${built.detail}`);
  }

  const bytes = emitWasmModule(built.module);
  const stub = makeHostStub();

  const { instance } = await WebAssembly.instantiate(
    bytes,
    stub.importObject,
  );

  stub.setMemoryRefs(instance);

  const main = instance.exports.main;
  expect(typeof main).toBe("function");

  const result = (main as CallableFunction)();
  expect(result).toBe(0n);

  return stub.printedStrings;
}

describe("WASM string literal host ABI", () => {
  it("materializes an ASCII UR-produced string so the host reads the correct bytes", async () => {
    expect(await runStringLiteralProgram("abc")).toEqual(["abc"]);
  });

  it("materializes a multi-byte UTF-8 UR-produced string so the host reads the correct bytes", async () => {
    expect(await runStringLiteralProgram("مرحبا")).toEqual(["مرحبا"]);
  });
});