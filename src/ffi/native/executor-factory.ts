import type { IPlatformExecutor, Platform } from "./types.js";
import {
  detectPlatform,
  LinuxExecutorStub,
  MacOsExecutorStub,
  WasmExecutorStub,
} from "./platform-executors.js";
import { WindowsExecutor } from "./windows-executor.js";

/**
 * Creates the executor for a requested runtime platform.
 * Windows uses the real Koffi-backed executor.
 * Other platforms retain their existing implementations.
 */
export function createPlatformExecutor(
  platform: Platform = detectPlatform(),
): IPlatformExecutor {
  switch (platform) {
    case "windows":
      return new WindowsExecutor();
    case "linux":
      return new LinuxExecutorStub();
    case "macos":
      return new MacOsExecutorStub();
    case "wasm":
      return new WasmExecutorStub();
    default: {
      const unsupported: never = platform;
      throw new Error(`Unsupported native platform: ${unsupported}`);
    }
  }
}
