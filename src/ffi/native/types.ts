// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: Core Types
// Phase 7 — Native Ecosystem Hardening
// ─────────────────────────────────────────────────────────────────────────────
//
// Pure TypeScript interfaces — zero platform or Node dependencies.
// Every driver (SQLite, OpenCV, ONNX, zlib, OpenSSL, libcurl …) and every
// platform executor (Linux/dlopen, Windows/LoadLibrary, macOS/dlopen,
// WASM) programs against these contracts, not against each other.
//
// ── Architecture ─────────────────────────────────────────────────────────
//
//   UR Program
//       │
//       ▼
//   NativeFfiLoader  (src/ffi/native/loader.ts)
//       │  — library cache, ABI verification, diagnostic log
//       ▼
//   IPlatformExecutor  (this file)
//       ├── Linux / dlopen
//       ├── Windows / LoadLibrary
//       ├── macOS / dlopen
//       └── WASM stub
//       │
//       ▼
//   ISymbolResolver  (src/ffi/native/symbol-resolver.ts)
//       │  — lazy resolution, per-library symbol cache
//       ▼
//   NativeCallResult  — typed result surfaced to UR/FFI Runtime
//
// ─────────────────────────────────────────────────────────────────────────────

/** Opaque handle to a loaded native library. */
export type NativeLibraryHandle = {
  readonly libraryPath: string;
  readonly platform: Platform;
  /** Internal platform-specific token (e.g. void* on Linux, HMODULE on Windows). */
  readonly _token: unknown;
};

/** Target platform — determines which executor is used. */
export type Platform = "linux" | "macos" | "windows" | "wasm";

/** Resolved symbol: a name + the opaque callable reference on the platform. */
export type NativeSymbol = {
  readonly name: string;
  readonly handle: NativeLibraryHandle;
  readonly _callable: unknown;
};

// ── Typed argument and result values ─────────────────────────────────────
//
// These are the typed "wires" between UR's type system and the native ABI.
// Every driver describes its calls in these terms; the executor translates
// them into the platform's actual calling convention.

export type NativeArg =
  | { kind: "i32";      value: number }
  | { kind: "i64";      value: bigint }
  | { kind: "f64";      value: number }
  | { kind: "str";      value: string }
  | { kind: "null_str"                }  // NULL const char*
  | { kind: "ptr";      value: bigint }  // pass a pointer returned by a prior call
  | { kind: "null_ptr"                }; // NULL void*

export type NativeCallResult =
  | { kind: "i32";   value: number  }
  | { kind: "i64";   value: bigint  }
  | { kind: "f64";   value: number  }
  | { kind: "str";   value: string  }
  | { kind: "ptr";   value: bigint  }   // opaque pointer (address as u64)
  | { kind: "void"                  }
  | { kind: "error"; message: string };

// ── Library descriptor ────────────────────────────────────────────────────
//
// Describes a native library in a platform-independent way. Drivers pass
// this to NativeFfiLoader.load() rather than interacting with the OS
// directly — the loader picks the right executor and manages caching.

export type NativeLibraryDescriptor = {
  /** Human-readable name for diagnostics, e.g. "SQLite3". */
  name: string;
  /** Fully-qualified path to the .so / .dll / .dylib. */
  libraryPath: string;
  /**
   * Expected version string (e.g. "3.45.1").
   * If provided, the loader calls the version symbol and verifies
   * compatibility before returning the handle.
   */
  expectedVersion?: string;
  /** Symbol to call to retrieve the runtime version (e.g. "libversion" or "getVersionString"). */
  versionSymbol?: string;
  /** Extracts the version string from the symbol's return value. */
  versionExtractor?: (result: NativeCallResult) => string;
};

// ── ABI compatibility result ──────────────────────────────────────────────

export type AbiCompatibility =
  | { compatible: true;  runtimeVersion: string }
  | { compatible: false; runtimeVersion: string; reason: string };

// ── Platform executor interface ───────────────────────────────────────────
//
// The single abstraction point that makes the whole system platform-
// portable. Linux, Windows, macOS, and WASM each provide an implementation;
// the loader selects one at construction time.

export type NativeCall = {
  symbol: string;
  args: NativeArg[];
  returnKind: NativeCallResult["kind"];
};

export interface IPlatformExecutor {
  readonly platform: Platform;

  /** Load a library and return its handle. Throws on failure. */
  load(libraryPath: string): NativeLibraryHandle;

  /** Execute a sequence of calls against an already-loaded library. */
  execute(handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[];

  /** Release the library handle. Safe to call multiple times. */
  unload(handle: NativeLibraryHandle): void;
}

// ── Diagnostic event ─────────────────────────────────────────────────────

export type DiagnosticLevel = "info" | "warn" | "error";

export type DiagnosticEvent = {
  level: DiagnosticLevel;
  library: string;
  message: string;
  timestamp: number; // Date.now()
};

export type DiagnosticLogger = (event: DiagnosticEvent) => void;

// ── Driver interface ──────────────────────────────────────────────────────
//
// Each named library (SQLite, OpenCV, ONNX, …) provides a driver that
// implements this interface. The driver knows about library-specific
// things (version symbols, ABI invariants, high-level CRUD helpers);
// the loader knows about platform things (caching, lifecycle, errors).

export interface INativeDriver<T> {
  readonly descriptor: NativeLibraryDescriptor;
  /** Called after the library is loaded and ABI-verified. Returns a typed API. */
  bind(loader: { execute(calls: NativeCall[]): NativeCallResult[] }): T;
}
