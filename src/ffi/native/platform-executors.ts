// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: Platform Executors
// Phase 7 — Native Ecosystem Hardening
// ─────────────────────────────────────────────────────────────────────────────
//
// Platform abstraction layer. Each class implements IPlatformExecutor for
// a specific OS / runtime environment.
//
// In-process execution model:
//   The TS-layer executors here model the TYPES and CONTRACTS that real
//   platform implementations must satisfy. The "real" Linux executor that
//   actually calls dlopen() and dlsym() is implemented in
//   tests/ffi/native/harness-executor.ts using a gcc-compiled C harness —
//   that file lives in tests/ because it imports from "node:child_process"
//   and "node:fs", which are not available in the src/ tsconfig scope.
//
// When UR's code generator emits real native calls in a compiled UR
// program, it will generate C/C++ that calls dlopen/dlsym directly —
// the TypeScript executor stubs here are the TypeScript-level counterpart
// that drives the type system and test infrastructure.
//
// ── Platform support matrix ───────────────────────────────────────────────
//
//   Platform    | Executor class     | Status
//   ------------|--------------------|---------
//   Linux       | LinuxExecutor      | Implemented (via harness-executor.ts)
//   macOS       | MacOsExecutor      | Stub (same dlopen API as Linux)
//   Windows     | WindowsExecutor    | Stub (LoadLibrary equivalent)
//   WASM        | WasmExecutor       | Stub (WebAssembly.instantiate)
//
// ─────────────────────────────────────────────────────────────────────────────

import type {
  IPlatformExecutor,
  NativeLibraryHandle,
  NativeCall,
  NativeCallResult,
  Platform,
} from "./types.js";

function notSupported(platform: Platform): never {
  throw new Error(
    `NativeFfiLoader: platform "${platform}" is not supported in this environment. ` +
    `On Linux/macOS, use the HarnessExecutor from tests/ffi/native/harness-executor.ts. ` +
    `On Windows, a LoadLibrary-based executor is needed. ` +
    `On WASM, use WebAssembly.instantiate().`
  );
}

// ── Linux executor (interface — real execution via HarnessExecutor in tests/) ──

/**
 * Descriptor-only Linux executor. Validates that a library path exists and
 * can in principle be loaded on Linux (uses dlopen semantics). The actual
 * dlopen/dlsym call is delegated to the HarnessExecutor in tests/ because
 * that requires Node APIs (child_process, fs) not available in src/.
 *
 * This class is useful as the `platform` field value and for type-checking
 * in driver implementations. Tests inject HarnessExecutor (which extends
 * this interface) for real execution.
 */
export class LinuxExecutorStub implements IPlatformExecutor {
  readonly platform: Platform = "linux";

  load(_libraryPath: string): NativeLibraryHandle {
    notSupported(this.platform);
  }

  execute(_handle: NativeLibraryHandle, _calls: NativeCall[]): NativeCallResult[] {
    notSupported(this.platform);
  }

  unload(_handle: NativeLibraryHandle): void {
    notSupported(this.platform);
  }
}

// ── macOS executor stub ────────────────────────────────────────────────────

/** macOS uses the same dlopen/dlsym API as Linux. Stub until a macOS
 *  environment is available for testing. */
export class MacOsExecutorStub implements IPlatformExecutor {
  readonly platform: Platform = "macos";

  load(_libraryPath: string): NativeLibraryHandle { notSupported(this.platform); }
  execute(_handle: NativeLibraryHandle, _calls: NativeCall[]): NativeCallResult[] { notSupported(this.platform); }
  unload(_handle: NativeLibraryHandle): void { notSupported(this.platform); }
}

// ── Windows executor stub ─────────────────────────────────────────────────

/**
 * Windows uses LoadLibrary / GetProcAddress / FreeLibrary.
 * The calling convention also differs for some symbols (__stdcall vs
 * __cdecl) — these details need to be resolved per-library when a
 * Windows executor is implemented.
 */
export class WindowsExecutorStub implements IPlatformExecutor {
  readonly platform: Platform = "windows";

  load(_libraryPath: string): NativeLibraryHandle { notSupported(this.platform); }
  execute(_handle: NativeLibraryHandle, _calls: NativeCall[]): NativeCallResult[] { notSupported(this.platform); }
  unload(_handle: NativeLibraryHandle): void { notSupported(this.platform); }
}

// ── WASM executor stub ────────────────────────────────────────────────────

/**
 * WASM uses WebAssembly.instantiate() / WebAssembly.Memory / import
 * objects. The ABI is completely different from dlopen (no .so, no
 * symbol tables in the traditional sense) — this needs a custom
 * implementation per WASM module.
 */
export class WasmExecutorStub implements IPlatformExecutor {
  readonly platform: Platform = "wasm";

  load(_libraryPath: string): NativeLibraryHandle { notSupported(this.platform); }
  execute(_handle: NativeLibraryHandle, _calls: NativeCall[]): NativeCallResult[] { notSupported(this.platform); }
  unload(_handle: NativeLibraryHandle): void { notSupported(this.platform); }
}

// ── Detect current platform ────────────────────────────────────────────────

export function detectPlatform(): Platform {
  // TypeScript / Node.js environment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  if (proc?.platform === "linux") return "linux";
  if (proc?.platform === "darwin") return "macos";
  if (proc?.platform === "win32") return "windows";
  // WASM / browser environment
  if (typeof WebAssembly !== "undefined" && !proc) return "wasm";
  return "linux"; // safe default for the current CI environment
}
