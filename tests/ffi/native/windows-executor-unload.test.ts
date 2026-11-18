import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";

describe.skipIf(process.platform !== "win32")("WindowsExecutor unload contract", () => {
  it("allows repeated unload calls without throwing", () => {
    const executor = createPlatformExecutor("windows");
    const handle = executor.load(resolve(process.cwd(), 'tests/fixtures/sqlite/sqlite3.dll'));

    expect(() => executor.unload(handle)).not.toThrow();
    expect(() => executor.unload(handle)).not.toThrow();
  });
});
