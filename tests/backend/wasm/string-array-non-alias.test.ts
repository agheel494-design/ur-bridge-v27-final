import { describe, expect, it } from "vitest";

import {
  buildIR,
  makeHostStub,
} from "../../../tools/backend/differential-runner.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";

describe("WASM 3.1C.3 - string and array memory non-aliasing", () => {
  it("allocates an array after an input string without overlapping the string allocation", async () => {
    const built = buildIR(`
function main(): int
  let s = input()
  let arr = [10, 20, 30]
  return arr[1]
end
`);

    expect(built.ok).toBe(true);

    if (!built.ok) {
      throw new Error(`buildIR failed: ${built.detail}`);
    }

    const hostStub = makeHostStub("abc");
    const originalInput =
      hostStub.importObject.ur_runtime.ur_input_string;

    let stringBase: number | undefined;

    hostStub.importObject.ur_runtime.ur_input_string = () => {
      const offset = originalInput();
      stringBase = offset;
      return offset;
    };

    const emittedBytes = emitWasmModule(built.module);
    const wasmBuffer: ArrayBuffer =
      new Uint8Array(emittedBytes).buffer;

    expect(WebAssembly.validate(wasmBuffer)).toBe(true);

    const { instance } = await WebAssembly.instantiate(
      wasmBuffer,
      hostStub.importObject,
    );

    hostStub.setMemoryRefs(instance);

    const exports = instance.exports as {
      main: () => bigint;
      memory: WebAssembly.Memory;
      ur_bump: WebAssembly.Global;
    };

    expect(Number(exports.ur_bump.value)).toBe(8);

    const returnValue = exports.main();

    expect(stringBase).toBe(8);

    if (stringBase === undefined) {
      throw new Error("ur_input_string was not called");
    }

    const stringByteLength = new TextEncoder().encode("abc").length;
    const stringEnd = stringBase + 8 + stringByteLength;
    const expectedArrayBase = stringEnd;

    const view = new DataView(exports.memory.buffer);

    expect(Number(view.getBigInt64(expectedArrayBase, true))).toBe(3);
    expect(Number(exports.ur_bump.value)).toBe(
      expectedArrayBase + 8 + (3 * 8),
    );
    expect(returnValue).toBe(20n);
  });
});