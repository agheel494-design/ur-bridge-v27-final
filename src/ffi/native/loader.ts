// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: Generic Loader
// Phase 7 — Native Ecosystem Hardening
// ─────────────────────────────────────────────────────────────────────────────
//
// The single entry point for all native library access in UR-Bridge.
// Responsibilities:
//   1. Library cache — a given .so path is loaded at most once per
//      loader instance; every driver asking for the same path gets the
//      same handle.
//   2. ABI version verification — before returning a handle the loader
//      calls the library's version symbol (if the descriptor specifies
//      one) and runs the compatibility check.
//   3. Diagnostic logging — every load, verify, execute, and unload
//      event is passed to an optional logger. Callers can hook their
//      own logging infrastructure here.
//   4. Platform dispatch — the loader is constructed with a concrete
//      IPlatformExecutor; it never calls dlopen/LoadLibrary directly.
//   5. Safe teardown — unloadAll() releases all handles in reverse-load
//      order; individual handles can be released earlier.
//
// Thread safety: JavaScript (and TypeScript compiled to JS) is single-
// threaded per event loop. This loader is therefore safe from data races
// without additional locking. Marking the internal maps as private is
// sufficient isolation within the single-threaded UR runtime model.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  NativeLibraryHandle,
  NativeLibraryDescriptor,
  NativeCall,
  NativeCallResult,
  AbiCompatibility,
  DiagnosticEvent,
  DiagnosticLogger,
  IPlatformExecutor,
  INativeDriver,
} from "./types.js";

export type LoadResult =
  | { ok: true;  handle: NativeLibraryHandle; abiCheck?: AbiCompatibility; diagnostics: DiagnosticEvent[] }
  | { ok: false; reason: string; diagnostics: DiagnosticEvent[] };

export type BindResult<T> =
  | { ok: true;  api: T;            diagnostics: DiagnosticEvent[] }
  | { ok: false; reason: string;    diagnostics: DiagnosticEvent[] };

export class NativeFfiLoader {
  private readonly executor: IPlatformExecutor;
  private readonly logger: DiagnosticLogger | null;

  /** Maps libraryPath → loaded handle (the library cache). */
  private readonly cache = new Map<string, NativeLibraryHandle>();

  /** Load order for deterministic reverse-order teardown. */
  private readonly loadOrder: string[] = [];

  constructor(executor: IPlatformExecutor, logger?: DiagnosticLogger) {
    this.executor = executor;
    this.logger = logger ?? null;
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Loads a native library described by `descriptor`. Returns a cached
   * handle if the library was already loaded (no double-loading). Runs
   * the ABI version check before returning if the descriptor specifies
   * a version symbol.
   */
  load(descriptor: NativeLibraryDescriptor): LoadResult {
    const events: DiagnosticEvent[] = [];
    const log = (level: DiagnosticEvent["level"], message: string) => {
      const ev: DiagnosticEvent = { level, library: descriptor.name, message, timestamp: Date.now() };
      events.push(ev);
      this.logger?.(ev);
    };

    // Cache hit
    const cached = this.cache.get(descriptor.libraryPath);
    if (cached) {
      log("info", `cache hit for ${descriptor.libraryPath}`);
      return { ok: true, handle: cached, diagnostics: events };
    }

    // Load
    let handle: NativeLibraryHandle;
    try {
      handle = this.executor.load(descriptor.libraryPath);
    } catch (err) {
      const reason = `failed to load ${descriptor.libraryPath}: ${err instanceof Error ? err.message : String(err)}`;
      log("error", reason);
      return { ok: false, reason, diagnostics: events };
    }
    log("info", `loaded ${descriptor.libraryPath} (${descriptor.name})`);

    // ABI version check
    let abiCheck: AbiCompatibility | undefined;
    if (descriptor.versionSymbol && descriptor.expectedVersion && descriptor.versionExtractor) {
      try {
        const [versionResult] = this.executor.execute(handle, [{
          symbol: descriptor.versionSymbol,
          args: [],
          returnKind: "str",
        }]);
        const runtimeVersion = versionResult
          ? descriptor.versionExtractor(versionResult)
          : "(unknown)";

        abiCheck = checkVersionCompatibility(descriptor.expectedVersion, runtimeVersion);
        if (!abiCheck.compatible) {
          log("error", `ABI mismatch: ${abiCheck.reason}`);
          this.executor.unload(handle);
          return { ok: false, reason: abiCheck.reason, diagnostics: events };
        }
        if (abiCheck.runtimeVersion !== descriptor.expectedVersion) {
          log("warn", `minor version difference: expected ${descriptor.expectedVersion}, got ${abiCheck.runtimeVersion} — should be compatible`);
        } else {
          log("info", `ABI verified: ${descriptor.name} ${abiCheck.runtimeVersion}`);
        }
      } catch (err) {
        log("warn", `ABI version check failed (${err instanceof Error ? err.message : String(err)}) — proceeding without verification`);
      }
    }

    this.cache.set(descriptor.libraryPath, handle);
    this.loadOrder.push(descriptor.libraryPath);
    return { ok: true, handle, abiCheck, diagnostics: events };
  }

  /**
   * Load a library, verify ABI, and immediately bind a typed driver API.
   * This is the one-stop convenience method for driver authors.
   */
  bind<T>(driver: INativeDriver<T>): BindResult<T> {
    const loadResult = this.load(driver.descriptor);
    if (!loadResult.ok) {
      return { ok: false, reason: loadResult.reason, diagnostics: loadResult.diagnostics };
    }
    const handle = loadResult.handle;
    try {
      const api = driver.bind({
        execute: (calls: NativeCall[]) => this.executor.execute(handle, calls),
      });
      return { ok: true, api, diagnostics: loadResult.diagnostics };
    } catch (err) {
      const reason = `driver bind failed: ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, reason, diagnostics: loadResult.diagnostics };
    }
  }

  /**
   * Execute calls directly against a loaded handle. Used by drivers and
   * tests that need lower-level access than `bind()` provides.
   */
  execute(handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    return this.executor.execute(handle, calls);
  }

  /** Unload a specific library. The cache entry is removed. */
  unload(handle: NativeLibraryHandle): void {
    this.executor.unload(handle);
    this.cache.delete(handle.libraryPath);
    const idx = this.loadOrder.indexOf(handle.libraryPath);
    if (idx !== -1) this.loadOrder.splice(idx, 1);
    this.logger?.({ level: "info", library: handle.libraryPath, message: "unloaded", timestamp: Date.now() });
  }

  /** Unload all cached libraries in reverse load order (safe teardown). */
  unloadAll(): void {
    for (const path of [...this.loadOrder].reverse()) {
      const handle = this.cache.get(path);
      if (handle) this.unload(handle);
    }
  }

  /** Returns the set of currently cached library paths. */
  get loadedLibraries(): ReadonlySet<string> {
    return new Set(this.cache.keys());
  }
}

// ── ABI version compatibility logic (library-independent) ─────────────────
//
// Follows the same major/minor/patch policy as tools/sqlite3-version-check.ts
// but is now a pure TypeScript function usable by any driver:
//   major mismatch  → incompatible (generation halted)
//   minor mismatch  → warning (generation proceeds)
//   patch mismatch  → silent
//
// The version format expected is MAJOR.MINOR.PATCH (e.g. "3.45.1").
// Libraries with different version formats should provide a custom
// versionExtractor in their descriptor.

export function checkVersionCompatibility(expected: string, actual: string): AbiCompatibility {
  // Accepts MAJOR.MINOR.PATCH or MAJOR.MINOR (patch defaults to 0).
  // Libraries like zlib use "1.3" rather than "1.3.0".
  const parseV = (v: string): [number, number, number] | undefined => {
    const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!m) return undefined;
    return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  };
  const e = parseV(expected);
  const a = parseV(actual);
  if (!e || !a) {
    return { compatible: false, runtimeVersion: actual, reason: `unparseable version string (expected="${expected}", actual="${actual}")` };
  }
  if (a[0] !== e[0]) {
    return {
      compatible: false,
      runtimeVersion: actual,
      reason: `major version mismatch: header targets ${expected} (major=${e[0]}), runtime is ${actual} (major=${a[0]}). The public C API is not guaranteed compatible across major versions.`,
    };
  }
  // minor/patch: compatible
  return { compatible: true, runtimeVersion: actual };
}
