import { describe, expect, it } from "vitest";

import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";
import { SYNTHETIC_LOCATION } from "../../../src/shared/locations.js";
import type { IRModule } from "../../../src/shared/ir.js";

describe("WASM 3.1C.1 - runtime import section", () => {
  it("emits no imports when no runtime extern is used", () => {
    const module: IRModule = {
      moduleName: "runtime_import_none",
      globals: [],
      externs: [],
      functions: [
        {
          qualifiedName: "ur_runtime_import_none_main",
          sourceName: "main",
          params: [],
          returnType: "i64",
          entryBlock: 0,
          location: SYNTHETIC_LOCATION,
          locals: [],
          blocks: [
            {
              id: 0,
              label: "entry",
              instructions: [
                {
                  kind: "const",
                  id: 0,
                  type: "i64",
                  value: { kind: "const_int", value: 0n },
                  location: SYNTHETIC_LOCATION,
                },
              ],
              terminator: {
                kind: "return",
                value: { id: 0 },
                location: SYNTHETIC_LOCATION,
              },
            },
          ],
        },
      ],
    };

    const emittedBytes = emitWasmModule(module);
    const wasmBuffer: ArrayBuffer = new Uint8Array(emittedBytes).buffer;

    expect(WebAssembly.validate(wasmBuffer)).toBe(true);

    const wasmModule = new WebAssembly.Module(wasmBuffer);
    expect(WebAssembly.Module.imports(wasmModule)).toEqual([]);
  });
});