import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";

describe.skipIf(process.platform !== "win32")("WindowsExecutor native types", () => {
  it("handles string and integer results", () => {
    const executor = createPlatformExecutor("windows");
    const handle = executor.load(
      resolve(process.cwd(), 'tests/fixtures/sqlite/sqlite3.dll'),
    );

    try {
      const results = executor.execute(handle, [
        {
          symbol: "sqlite3_libversion",
          args: [],
          returnKind: "str",
        },
        {
          symbol: "sqlite3_libversion_number",
          args: [],
          returnKind: "i32",
        },
      ]);

      expect(results[0].kind).toBe("str");
      if (results[0].kind === "str") {
        expect(results[0].value).toMatch(/^\d+\.\d+\.\d+$/);
      }

      expect(results[1].kind).toBe("i32");
      if (results[1].kind === "i32") {
        expect(results[1].value).toBeGreaterThan(0);
      }
    } finally {
      executor.unload(handle);
    }
  });
});
