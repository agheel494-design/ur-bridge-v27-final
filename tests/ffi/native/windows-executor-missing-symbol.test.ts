import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";

describe.skipIf(process.platform !== "win32")("WindowsExecutor missing symbol", () => {
  it("returns an error for a symbol that does not exist", () => {
    const executor = createPlatformExecutor("windows");
    const handle = executor.load(
      resolve(process.cwd(), 'tests/fixtures/sqlite/sqlite3.dll'),
    );

    try {
      const result = executor.execute(handle, [{
        symbol: "ur_symbol_that_does_not_exist_001",
        args: [],
        returnKind: "i32",
      }]);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe("error");

      if (result[0].kind === "error") {
        expect(result[0].message.length).toBeGreaterThan(0);
      }

      console.log("MISSING_SYMBOL_HANDLED: PASS");
    } finally {
      executor.unload(handle);
    }
  });
});
