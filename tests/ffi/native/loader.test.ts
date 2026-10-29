// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Generic Native FFI Loader
// Phase 7 — Native Ecosystem Hardening
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { NativeFfiLoader, checkVersionCompatibility } from "../../../src/ffi/native/loader.js";
import type {
  IPlatformExecutor, NativeLibraryHandle, NativeCall,
  NativeCallResult, NativeLibraryDescriptor, INativeDriver, DiagnosticEvent,
} from "../../../src/ffi/native/types.js";

// ── Minimal mock executor ─────────────────────────────────────────────────

function makeExecutor(overrides?: {
  loadResult?: NativeLibraryHandle | "throw";
  executeResults?: NativeCallResult[];
}): IPlatformExecutor & { unloadCount: number; execCount: number } {
  let unloadCount = 0, execCount = 0;
  return {
    platform: "linux",
    unloadCount,
    execCount,
    load(path: string): NativeLibraryHandle {
      if (overrides?.loadResult === "throw") throw new Error("dlopen failed: mock error");
      return overrides?.loadResult ?? { libraryPath: path, platform: "linux", _token: path };
    },
    execute(_h: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
      execCount++;
      return overrides?.executeResults ?? calls.map(() => ({ kind: "void" as const }));
    },
    unload(_h: NativeLibraryHandle) { unloadCount++; },
  };
}

const MOCK_DESC: NativeLibraryDescriptor = { name: "MockLib", libraryPath: "/fake/libmock.so" };

// ── checkVersionCompatibility ─────────────────────────────────────────────

describe("checkVersionCompatibility", () => {
  it("is compatible when versions match exactly", () => {
    expect(checkVersionCompatibility("3.45.1", "3.45.1").compatible).toBe(true);
  });

  it("is compatible when only patch differs", () => {
    const r = checkVersionCompatibility("3.45.0", "3.45.1");
    expect(r.compatible).toBe(true);
    expect(r.runtimeVersion).toBe("3.45.1");
  });

  it("is compatible when minor version is newer (SQLite 3.x guarantee)", () => {
    expect(checkVersionCompatibility("3.39.0", "3.45.1").compatible).toBe(true);
  });

  it("is NOT compatible when major version differs", () => {
    const r = checkVersionCompatibility("3.45.1", "4.0.0");
    expect(r.compatible).toBe(false);
    if (!r.compatible) expect(r.reason).toContain("major version mismatch");
  });

  it("handles 2-component version strings like zlib's '1.3' (patch defaults to 0)", () => {
    // Regression: checkVersionCompatibility failed for zlib "1.3" because
    // the parser required MAJOR.MINOR.PATCH exactly.
    expect(checkVersionCompatibility("1.3.0", "1.3").compatible).toBe(true);
    expect(checkVersionCompatibility("1.3", "1.3.1").compatible).toBe(true);
  });

  it("2-component major mismatch is still caught", () => {
    const r = checkVersionCompatibility("1.3", "2.0");
    expect(r.compatible).toBe(false);
  });

  it("returns an error for an unparseable version string", () => {
    const r = checkVersionCompatibility("3.45.1", "unknown");
    expect(r.compatible).toBe(false);
  });
});

// ── NativeFfiLoader — library cache ──────────────────────────────────────

describe("NativeFfiLoader — library cache", () => {
  it("loads a library and records it in loadedLibraries", () => {
    const exec = makeExecutor();
    const loader = new NativeFfiLoader(exec);
    const result = loader.load(MOCK_DESC);
    expect(result.ok).toBe(true);
    expect(loader.loadedLibraries.has(MOCK_DESC.libraryPath)).toBe(true);
  });

  it("returns the cached handle on a second load (no double-load)", () => {
    const exec = makeExecutor();
    const loader = new NativeFfiLoader(exec);
    const r1 = loader.load(MOCK_DESC);
    const r2 = loader.load(MOCK_DESC);
    expect(r1.ok && r2.ok && r1.ok === r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.handle).toBe(r2.handle); // same object reference
    }
    expect(r2.diagnostics.some(d => d.message.includes("cache hit"))).toBe(true);
  });

  it("loads distinct libraries independently", () => {
    const exec = makeExecutor();
    const loader = new NativeFfiLoader(exec);
    loader.load({ name: "A", libraryPath: "/fake/a.so" });
    loader.load({ name: "B", libraryPath: "/fake/b.so" });
    expect(loader.loadedLibraries.size).toBe(2);
  });
});

// ── NativeFfiLoader — error handling ─────────────────────────────────────

describe("NativeFfiLoader — error handling", () => {
  it("returns ok:false when the executor throws on load", () => {
    const exec = makeExecutor({ loadResult: "throw" });
    const loader = new NativeFfiLoader(exec);
    const result = loader.load(MOCK_DESC);
    expect(result.ok).toBe(false);
    expect(loader.loadedLibraries.size).toBe(0);
  });

  it("does not cache a failed load", () => {
    const exec = makeExecutor({ loadResult: "throw" });
    const loader = new NativeFfiLoader(exec);
    loader.load(MOCK_DESC);
    loader.load(MOCK_DESC); // second attempt — should re-try, not cache the failure
    // Both calls should have failed, nothing cached
    expect(loader.loadedLibraries.size).toBe(0);
  });
});

// ── NativeFfiLoader — ABI version check ──────────────────────────────────

describe("NativeFfiLoader — ABI version check", () => {
  const descWithVersion: NativeLibraryDescriptor = {
    ...MOCK_DESC,
    expectedVersion: "3.45.1",
    versionSymbol: "sqlite3_libversion",
    versionExtractor: (r) => (r.kind === "str" ? r.value : ""),
  };

  it("accepts a library whose runtime version matches the expected version", () => {
    const exec = makeExecutor({ executeResults: [{ kind: "str", value: "3.45.1" }] });
    const loader = new NativeFfiLoader(exec);
    const result = loader.load(descWithVersion);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.abiCheck?.compatible).toBe(true);
  });

  it("emits a warn diagnostic (but stays ok) for a minor version difference", () => {
    const exec = makeExecutor({ executeResults: [{ kind: "str", value: "3.46.0" }] });
    const events: DiagnosticEvent[] = [];
    const loader = new NativeFfiLoader(exec, (e) => events.push(e));
    const result = loader.load(descWithVersion);
    expect(result.ok).toBe(true);
    expect(events.some(e => e.level === "warn" && e.message.includes("minor version difference"))).toBe(true);
  });

  it("rejects (ok:false) when major version is incompatible", () => {
    const exec = makeExecutor({ executeResults: [{ kind: "str", value: "4.0.0" }] });
    const loader = new NativeFfiLoader(exec);
    const result = loader.load(descWithVersion);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("major version mismatch");
  });
});

// ── NativeFfiLoader — diagnostic logging ─────────────────────────────────

describe("NativeFfiLoader — diagnostic logging", () => {
  it("delivers an info event on successful load", () => {
    const exec = makeExecutor();
    const events: DiagnosticEvent[] = [];
    const loader = new NativeFfiLoader(exec, (e) => events.push(e));
    loader.load(MOCK_DESC);
    expect(events.some(e => e.level === "info" && e.message.includes("loaded"))).toBe(true);
  });

  it("delivers an error event when load fails", () => {
    const exec = makeExecutor({ loadResult: "throw" });
    const events: DiagnosticEvent[] = [];
    const loader = new NativeFfiLoader(exec, (e) => events.push(e));
    loader.load(MOCK_DESC);
    expect(events.some(e => e.level === "error")).toBe(true);
  });
});

// ── NativeFfiLoader — bind() with INativeDriver ───────────────────────────

describe("NativeFfiLoader — bind() with typed driver", () => {
  it("calls driver.bind() after successful load and returns the typed API", () => {
    const exec = makeExecutor({ executeResults: [{ kind: "i32", value: 42 }] });
    const loader = new NativeFfiLoader(exec);

    const driver: INativeDriver<{ getAnswer: () => number }> = {
      descriptor: MOCK_DESC,
      bind(e) {
        return {
          getAnswer: () => {
            const [r] = e.execute([{ symbol: "get_answer", args: [], returnKind: "i32" }]);
            return r?.kind === "i32" ? r.value : -1;
          },
        };
      },
    };

    const result = loader.bind(driver);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.api.getAnswer()).toBe(42);
    }
  });
});

// ── NativeFfiLoader — unload and unloadAll ────────────────────────────────

describe("NativeFfiLoader — teardown", () => {
  it("unload() removes the library from the cache", () => {
    const exec = makeExecutor();
    const loader = new NativeFfiLoader(exec);
    const r = loader.load(MOCK_DESC);
    expect(r.ok).toBe(true);
    if (r.ok) loader.unload(r.handle);
    expect(loader.loadedLibraries.size).toBe(0);
  });

  it("unloadAll() empties the cache in reverse load order", () => {
    const exec = makeExecutor();
    const unloaded: string[] = [];
    const execWithTracking: IPlatformExecutor = {
      ...exec,
      unload(h) { unloaded.push(h.libraryPath); },
    };
    const loader = new NativeFfiLoader(execWithTracking);
    loader.load({ name: "A", libraryPath: "/fake/a.so" });
    loader.load({ name: "B", libraryPath: "/fake/b.so" });
    loader.load({ name: "C", libraryPath: "/fake/c.so" });
    loader.unloadAll();
    expect(loader.loadedLibraries.size).toBe(0);
    // Reverse load order: C, B, A
    expect(unloaded).toEqual(["/fake/c.so", "/fake/b.so", "/fake/a.so"]);
  });
});
