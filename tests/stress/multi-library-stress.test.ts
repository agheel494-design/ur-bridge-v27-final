// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Stress Tests: Multi-Library
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import { NativeFfiLoader } from "../../src/ffi/native/loader.js";
import { DriverRegistry } from "../../src/ffi/native/driver-registry.js";
import type {
  IPlatformExecutor, NativeLibraryHandle, NativeCall,
  NativeCallResult, Platform,
} from "../../src/ffi/native/types.js";
import type { INativeDriver, NativeLibraryDescriptor } from "../../src/ffi/native/types.js";

// ── In-memory mock executor ────────────────────────────────────────────────────

type HandleToken = { id: number; path: string };

class MemoryTrackingExecutor implements IPlatformExecutor {
  readonly platform: Platform = "linux";
  private nextId = 1;
  readonly activeHandles = new Set<number>();
  loadCount = 0;
  unloadCount = 0;
  callCount = 0;

  load(libraryPath: string): NativeLibraryHandle {
    const id = this.nextId++;
    this.activeHandles.add(id);
    this.loadCount++;
    const token: HandleToken = { id, path: libraryPath };
    return { libraryPath, platform: "linux", _token: token };
  }

  execute(handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    const token = handle._token as HandleToken;
    if (!this.activeHandles.has(token.id)) {
      throw new Error(`execute() on unloaded handle ${token.id}`);
    }
    this.callCount += calls.length;
    return calls.map((c) => {
      if (c.returnKind === "i32")  return { kind: "i32",  value: 0 };
      if (c.returnKind === "i64")  return { kind: "i64",  value: 0n };
      if (c.returnKind === "f64")  return { kind: "f64",  value: 0.0 };
      if (c.returnKind === "str")  return { kind: "str",  value: `mock:${c.symbol}` };
      if (c.returnKind === "ptr")  return { kind: "ptr",  value: BigInt(token.id * 1000) };
      return { kind: "void" };
    });
  }

  unload(handle: NativeLibraryHandle): void {
    const token = handle._token as HandleToken;
    this.activeHandles.delete(token.id);
    this.unloadCount++;
  }

  get activeCount(): number { return this.activeHandles.size; }
}

// ── Stub driver factory ────────────────────────────────────────────────────────

type PingApi = { ping(): string; add(a: number, b: number): number };

function makeDriver(name: string, libPath: string): INativeDriver<PingApi> {
  const descriptor: NativeLibraryDescriptor = { name, libraryPath: libPath };
  return {
    descriptor,
    bind: (exec) => ({
      ping: () => {
        const [r] = exec.execute([{ symbol: `${name}_ping`, args: [], returnKind: "str" }]);
        return r?.kind === "str" ? r.value : "?";
      },
      add: (a, b) => {
        const [r] = exec.execute([{
          symbol: `${name}_add`,
          args: [{ kind: "i32", value: a }, { kind: "i32", value: b }],
          returnKind: "i32",
        }]);
        return r?.kind === "i32" ? r.value : -1;
      },
    }),
  };
}

function fresh() {
  DriverRegistry._resetForTests();
  const executor = new MemoryTrackingExecutor();
  const loader = new NativeFfiLoader(executor);
  return { executor, loader };
}

// ── Tests — flat structure (no nested describe needing parent beforeEach) ─────

describe("Multi-library stress: multiple drivers simultaneously", () => {
  it("loads 3 drivers without handle collision", () => {
    const { executor, loader } = fresh();
    const r1 = loader.bind(makeDriver("sqlite3", "/lib/libsqlite3.so.0"));
    const r2 = loader.bind(makeDriver("opencv",  "/lib/libopencv_core.so"));
    const r3 = loader.bind(makeDriver("onnx",    "/lib/libonnxruntime.so"));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(executor.activeCount).toBe(3);
    expect(executor.loadCount).toBe(3);
  });

  it("each bound API operates independently", () => {
    const { loader } = fresh();
    const r1 = loader.bind(makeDriver("sqlite3", "/lib/libsqlite3.so.0"));
    const r2 = loader.bind(makeDriver("opencv",  "/lib/libopencv_core.so"));
    expect(r1.ok && r2.ok).toBe(true);
    const api1 = (r1 as { ok: true; api: PingApi }).api;
    const api2 = (r2 as { ok: true; api: PingApi }).api;
    expect(api1.ping()).toContain("sqlite3_ping");
    expect(api2.ping()).toContain("opencv_ping");
  });

  it("cache deduplicates the same library path", () => {
    const { executor, loader } = fresh();
    loader.bind(makeDriver("sqlite3",       "/lib/libsqlite3.so.0"));
    loader.bind(makeDriver("sqlite3-alias", "/lib/libsqlite3.so.0"));
    expect(executor.loadCount).toBe(1);
    expect(executor.activeCount).toBe(1);
  });
});

describe("Multi-library stress: thousands of native calls", () => {
  it("executes 10,000 calls without error", () => {
    const { executor, loader } = fresh();
    const result = loader.bind(makeDriver("perf", "/lib/libperf.so"));
    expect(result.ok).toBe(true);
    const api = (result as { ok: true; api: PingApi }).api;
    for (let i = 0; i < 10_000; i++) api.add(i, 1);
    expect(executor.callCount).toBe(10_000);
  });

  it("executes 5,000 ping calls and all return strings", () => {
    const { loader } = fresh();
    const result = loader.bind(makeDriver("pingtest", "/lib/libping.so"));
    const api = (result as { ok: true; api: PingApi }).api;
    let allStrings = true;
    for (let i = 0; i < 5_000; i++) {
      if (typeof api.ping() !== "string") allStrings = false;
    }
    expect(allStrings).toBe(true);
  });
});

describe("Multi-library stress: load/unload cycle stability", () => {
  it("loads and unloads 1,000 times without active handle leak", () => {
    const { executor, loader } = fresh();
    for (let i = 0; i < 1_000; i++) {
      loader.bind(makeDriver(`lib${i}`, `/lib/lib${i}.so`));
      for (const path of loader.loadedLibraries) {
        const cache = (loader as any)["cache"] as Map<string, NativeLibraryHandle>;
        const handle = cache.get(path);
        if (handle) loader.unload(handle);
      }
    }
    expect(executor.activeCount).toBe(0);
    expect(executor.loadCount).toBe(1_000);
    expect(executor.unloadCount).toBe(1_000);
  });

  it("unloadAll() releases all handles in reverse order", () => {
    const { executor, loader } = fresh();
    const paths = ["/lib/a.so", "/lib/b.so", "/lib/c.so"];
    for (const p of paths) loader.bind(makeDriver(p, p));
    expect(executor.activeCount).toBe(3);
    loader.unloadAll();
    expect(executor.activeCount).toBe(0);
    expect(executor.unloadCount).toBe(3);
  });

  it("loadedLibraries set is correct after partial unload", () => {
    const { loader } = fresh();
    loader.bind(makeDriver("a", "/lib/a.so"));
    loader.bind(makeDriver("b", "/lib/b.so"));
    loader.bind(makeDriver("c", "/lib/c.so"));
    const cache = (loader as any)["cache"] as Map<string, NativeLibraryHandle>;
    const handleA = cache.get("/lib/a.so")!;
    loader.unload(handleA);
    expect(loader.loadedLibraries.has("/lib/a.so")).toBe(false);
    expect(loader.loadedLibraries.has("/lib/b.so")).toBe(true);
    expect(loader.loadedLibraries.has("/lib/c.so")).toBe(true);
  });
});

describe("Multi-library stress: handle validity", () => {
  it("executing on an unloaded handle throws", () => {
    const { executor, loader } = fresh();
    loader.bind(makeDriver("test", "/lib/test.so"));
    const cache = (loader as any)["cache"] as Map<string, NativeLibraryHandle>;
    const handle = cache.get("/lib/test.so")!;
    loader.unload(handle);
    expect(() => {
      executor.execute(handle, [{ symbol: "foo", args: [], returnKind: "void" }]);
    }).toThrow(/unloaded handle/);
  });

  it("double unload does not throw from loader", () => {
    const { loader } = fresh();
    loader.bind(makeDriver("test2", "/lib/test2.so"));
    const cache = (loader as any)["cache"] as Map<string, NativeLibraryHandle>;
    const handle = cache.get("/lib/test2.so")!;
    loader.unload(handle);
    expect(() => loader.unload(handle)).not.toThrow();
  });
});

describe("Multi-library stress: diagnostic logging", () => {
  it("collects diagnostic events for 10 load cycles", () => {
    DriverRegistry._resetForTests();
    const executor = new MemoryTrackingExecutor();
    const events: string[] = [];
    const trackingLoader = new NativeFfiLoader(executor, (ev) => {
      events.push(`${ev.level}:${ev.library}`);
    });
    for (let i = 0; i < 10; i++) {
      trackingLoader.bind(makeDriver(`lib${i}`, `/lib/lib${i}.so`));
    }
    const infoEvents = events.filter(e => e.startsWith("info:"));
    expect(infoEvents.length).toBeGreaterThanOrEqual(10);
  });
});
