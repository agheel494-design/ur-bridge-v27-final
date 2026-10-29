import { describe, it, expect } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";

describe("WindowsExecutor load failure", () => {
  it("reports a missing DLL without claiming success", () => {
    const loader = new NativeFfiLoader(createPlatformExecutor("windows"));

    const result = loader.load({
      name: "missing-test-library",
      libraryPath: "D:/test/tests/fixtures/sqlite/definitely-missing-ur-test.dll",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.reason).toMatch(/load|module|library|failed|cannot|could not/i);
    }

    console.log("MISSING_DLL_FAILURE_HANDLED: PASS");
  });
});
