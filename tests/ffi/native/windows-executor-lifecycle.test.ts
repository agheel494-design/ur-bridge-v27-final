import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";

describe.skipIf(process.platform !== "win32")("WindowsExecutor lifecycle", () => {
  it("rejects calls after the native library is unloaded", () => {
    const executor = createPlatformExecutor("windows");
    const handle = executor.load(
      resolve(process.cwd(), 'tests/fixtures/sqlite/sqlite3.dll'),
    );

    executor.unload(handle);

    expect(() =>
      executor.execute(handle, [{
        symbol: "sqlite3_libversion",
        args: [],
        returnKind: "str",
      }]),
    ).toThrow(/unloaded/i);
  });
});
