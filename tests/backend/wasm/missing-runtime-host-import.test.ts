import { describe, expect, it } from "vitest";

import {
  buildIR,
  makeHostStub,
  runOnWasmBackend,
} from "../../../tools/backend/differential-runner.js";

describe("WASM 3.1C.2 - missing runtime host import", () => {
  it("fails clearly at instantiation when a required host function is missing", async () => {
    const built = buildIR(`
function main(): int
  print(5)
  return 0
end
`);

    expect(built.ok).toBe(true);

    if (!built.ok) {
      throw new Error(`buildIR failed: ${built.detail}`);
    }

    const fullStub = makeHostStub();

    const {
      ur_print_int: _removedPrintInt,
      ...runtimeWithoutPrintInt
    } = fullStub.importObject.ur_runtime;

    const missingHostStub = {
      ...fullStub,
      importObject: {
        ...fullStub.importObject,
        ur_runtime: runtimeWithoutPrintInt,
      },
    };

    const result = await runOnWasmBackend(
      built.module,
      missingHostStub as typeof fullStub,
    );

    expect(result.BUILD).toBe("PASS");
    expect(result.VALIDATE).toBe("PASS");
    expect(result.INSTANTIATE).toBe("FAIL");
    expect(result.EXECUTE).toBe("SKIPPED");
    expect(result.firstFailedPhase).toBe("INSTANTIATE");
    expect(result.observed).toContain("WebAssembly.instantiate threw:");
    expect(result.observed).toContain("ur_runtime");
    expect(result.observed).toContain("ur_print_int");
  });
});