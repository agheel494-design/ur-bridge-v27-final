import { describe, expect, it } from "vitest";
import { createPlatformExecutor } from "../../../src/ffi/native/executor-factory.js";
import { WindowsExecutor } from "../../../src/ffi/native/windows-executor.js";
import {
  LinuxExecutorStub,
  MacOsExecutorStub,
  WasmExecutorStub,
} from "../../../src/ffi/native/platform-executors.js";

describe("createPlatformExecutor", () => {
  it("selects the real Windows executor", () => {
    const executor = createPlatformExecutor("windows");
    expect(executor).toBeInstanceOf(WindowsExecutor);
    expect(executor.platform).toBe("windows");
  });

  it("preserves the existing Linux executor implementation", () => {
    expect(createPlatformExecutor("linux")).toBeInstanceOf(LinuxExecutorStub);
  });

  it("preserves the existing macOS executor implementation", () => {
    expect(createPlatformExecutor("macos")).toBeInstanceOf(MacOsExecutorStub);
  });

  it("preserves the existing WASM executor implementation", () => {
    expect(createPlatformExecutor("wasm")).toBeInstanceOf(WasmExecutorStub);
  });
});
