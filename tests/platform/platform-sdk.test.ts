// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Platform SDK
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  PlatformSDK,
  NativeResourceManager,
  makeNativeError,
  type CapabilityGroup,
} from "../../src/platform-sdk/index.js";
import { DriverRegistry } from "../../src/ffi/native/driver-registry.js";
import type {
  IPlatformExecutor,
  NativeLibraryHandle,
  NativeCall,
  NativeCallResult,
  Platform,
  INativeDriver,
} from "../../src/ffi/native/types.js";

// ── Minimal mock executor ─────────────────────────────────────────────────────

class MockExecutor implements IPlatformExecutor {
  readonly platform: Platform = "linux";
  loadCount = 0;

  load(libraryPath: string): NativeLibraryHandle {
    this.loadCount++;
    return { libraryPath, platform: "linux", _token: libraryPath };
  }
  execute(_h: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    return calls.map(() => ({ kind: "void" as const }));
  }
  unload(_h: NativeLibraryHandle): void {}
}

// ── Stub driver factory ───────────────────────────────────────────────────────

type PingApi = { ping(): string };

function makePingDriver(name: string, path: string): INativeDriver<PingApi> {
  return {
    descriptor: { name, libraryPath: path },
    bind: () => ({ ping: () => `pong:${name}` }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("NativeResourceManager", () => {
  let rm: NativeResourceManager;
  beforeEach(() => { rm = new NativeResourceManager(); });

  it("starts with zero stats", () => {
    const s = rm.stats();
    expect(s.totalAllocated).toBe(0);
    expect(s.totalReleased).toBe(0);
    expect(s.currentlyLive).toBe(0);
  });

  it("allocate() increments totalAllocated and currentlyLive", () => {
    rm.allocate(1n, "database_connection", "sqlite3");
    expect(rm.stats().totalAllocated).toBe(1);
    expect(rm.stats().currentlyLive).toBe(1);
    expect(rm.isLive(1n)).toBe(true);
  });

  it("release() decrements currentlyLive and increments totalReleased", () => {
    rm.allocate(1n, "database_connection", "sqlite3");
    rm.release(1n);
    expect(rm.stats().currentlyLive).toBe(0);
    expect(rm.stats().totalReleased).toBe(1);
    expect(rm.isLive(1n)).toBe(false);
  });

  it("allocate() is idempotent for the same handle", () => {
    rm.allocate(1n, "database_connection", "sqlite3");
    rm.allocate(1n, "database_connection", "sqlite3"); // second call
    expect(rm.stats().totalAllocated).toBe(1);
  });

  it("detectLeaks() returns live resources", () => {
    rm.allocate(1n, "mat_handle", "opencv");
    rm.allocate(2n, "mat_handle", "opencv");
    rm.release(1n);
    const leaks = rm.detectLeaks();
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.handle).toBe(2n);
  });

  it("releaseAll() clears all tracked resources", () => {
    rm.allocate(1n, "database_connection", "sqlite3");
    rm.allocate(2n, "session_handle", "onnx");
    rm.releaseAll();
    expect(rm.stats().currentlyLive).toBe(0);
  });

  it("liveResources() returns readonly snapshot", () => {
    rm.allocate(10n, "prepared_statement", "sqlite3", "SELECT *");
    const live = rm.liveResources();
    expect(live[0]!.tag).toBe("SELECT *");
    expect(live[0]!.driverId).toBe("sqlite3");
  });
});

describe("makeNativeError", () => {
  it("creates a NativeError with correct shape", () => {
    const err = makeNativeError("DATABASE_ERROR", "connection failed", { driverId: "sqlite3" });
    expect(err.kind).toBe("DATABASE_ERROR");
    expect(err.message).toBe("connection failed");
    expect(err.driverId).toBe("sqlite3");
  });

  it("works without optional fields", () => {
    const err = makeNativeError("UNKNOWN_NATIVE_ERROR", "unexpected");
    expect(err.driverId).toBeUndefined();
  });
});

describe("PlatformSDK — construction and lifecycle", () => {
  let sdk: PlatformSDK;
  let executor: MockExecutor;

  beforeEach(() => {
    DriverRegistry._resetForTests();
    executor = new MockExecutor();
    sdk = new PlatformSDK(executor);
  });

  it("constructs without error", () => {
    expect(sdk).toBeDefined();
    expect(sdk.resources).toBeDefined();
    expect(sdk.loadedLibraries.size).toBe(0);
  });

  it("shutdown() calls unloadAll on the internal loader", () => {
    sdk.bindDriver(makePingDriver("A", "/lib/a.so"));
    sdk.shutdown();
    expect(sdk.loadedLibraries.size).toBe(0);
  });

  it("resourceStats() mirrors NativeResourceManager stats", () => {
    sdk.resources.allocate(1n, "database_connection", "test");
    const s = sdk.resourceStats();
    expect(s.currentlyLive).toBe(1);
  });
});

describe("PlatformSDK — bindDriver", () => {
  let sdk: PlatformSDK;

  beforeEach(() => {
    DriverRegistry._resetForTests();
    sdk = new PlatformSDK(new MockExecutor());
  });

  it("binds a driver directly and returns a working API", () => {
    const result = sdk.bindDriver(makePingDriver("MockLib", "/lib/mock.so"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.api.ping()).toBe("pong:MockLib");
  });

  it("caches the library: binding the same path twice calls load() once", () => {
    const exec = new MockExecutor();
    const s = new PlatformSDK(exec);
    s.bindDriver(makePingDriver("A", "/lib/same.so"));
    s.bindDriver(makePingDriver("B", "/lib/same.so")); // same path
    expect(exec.loadCount).toBe(1);
  });
});

describe("PlatformSDK — bindByCapability", () => {
  let sdk: PlatformSDK;

  beforeEach(() => {
    DriverRegistry._resetForTests();
    sdk = new PlatformSDK(new MockExecutor());
  });

  it("returns ok:false with a clear message when no driver satisfies the group", () => {
    const r = sdk.bindByCapability<PingApi>("database", "/lib/sqlite3.so");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("No registered driver satisfies");
  });

  it("binds the correct driver when one satisfies the database group", () => {
    DriverRegistry.register({
      metadata: {
        id: "sqlite3",
        name: "SQLite3",
        versionPolicy: { kind: "any" },
        capabilities: ["CONNECTION_LIFECYCLE", "PREPARED_STATEMENTS", "TRANSACTIONS", "PARAMETER_BINDING", "RESULT_COLUMNS", "UTF8_ROUNDTRIP", "ERROR_REPORTING", "MUTATION_INTROSPECTION"],
        description: "SQLite3 driver",
      },
      factory: (p) => makePingDriver("SQLite3", p),
    });

    const r = sdk.bindByCapability<PingApi>("database", "/lib/sqlite3.so");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.driverId).toBe("sqlite3");
      expect(r.driverName).toBe("SQLite3");
    }
  });

  it("does NOT pick a driver that only partially satisfies the group", () => {
    DriverRegistry.register({
      metadata: {
        id: "partial",
        name: "Partial DB",
        versionPolicy: { kind: "any" },
        capabilities: ["CONNECTION_LIFECYCLE"], // missing PREPARED_STATEMENTS + TRANSACTIONS
        description: "incomplete",
      },
      factory: (p) => makePingDriver("Partial", p),
    });
    const r = sdk.bindByCapability<PingApi>("database", "/lib/partial.so");
    expect(r.ok).toBe(false);
  });
});

describe("PlatformSDK — bindById", () => {
  let sdk: PlatformSDK;

  beforeEach(() => {
    DriverRegistry._resetForTests();
    sdk = new PlatformSDK(new MockExecutor());
  });

  it("returns ok:false for an unregistered id", () => {
    const r = sdk.bindById<PingApi>("unknown-driver", "/lib/x.so");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("not registered");
  });

  it("binds a registered driver by id", () => {
    DriverRegistry.register({
      metadata: { id: "zlib", name: "zlib", versionPolicy: { kind: "any" }, capabilities: ["COMPRESS", "DECOMPRESS"], description: "zlib" },
      factory: (p) => makePingDriver("zlib", p),
    });
    const r = sdk.bindById<PingApi>("zlib", "/lib/libz.so");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driverId).toBe("zlib");
  });
});

describe("PlatformSDK — query / canHandle / hasCapability", () => {
  let sdk: PlatformSDK;

  beforeEach(() => {
    DriverRegistry._resetForTests();
    sdk = new PlatformSDK(new MockExecutor());
    DriverRegistry.register({
      metadata: {
        id: "sqlite3",
        name: "SQLite3",
        versionPolicy: { kind: "any" },
        capabilities: ["CONNECTION_LIFECYCLE", "PREPARED_STATEMENTS", "TRANSACTIONS"],
        description: "SQLite3",
      },
      factory: (p) => makePingDriver("SQLite3", p),
    });
    DriverRegistry.register({
      metadata: {
        id: "opencv",
        name: "OpenCV",
        versionPolicy: { kind: "any" },
        capabilities: ["MAT_LIFECYCLE", "IMAGE_LOAD", "RESIZE"],
        description: "OpenCV",
      },
      factory: (p) => makePingDriver("OpenCV", p),
    });
  });

  it("query() returns all registered drivers", () => {
    const results = sdk.query();
    expect(results).toHaveLength(2);
    expect(results.map(r => r.driverId).sort()).toEqual(["opencv", "sqlite3"]);
  });

  it("query(group) marks drivers that satisfy the group", () => {
    const results = sdk.query("database");
    const sqlite = results.find(r => r.driverId === "sqlite3")!;
    const cv = results.find(r => r.driverId === "opencv")!;
    expect(sqlite.satisfiesGroup).toBe(true);
    expect(cv.satisfiesGroup).toBe(false);
  });

  it("canHandle('database') returns true when sqlite3 is registered", () => {
    expect(sdk.canHandle("database")).toBe(true);
  });

  it("canHandle('inference') returns false when no inference driver is registered", () => {
    expect(sdk.canHandle("inference")).toBe(false);
  });

  it("hasCapability() works for individual flags", () => {
    expect(sdk.hasCapability("IMAGE_LOAD")).toBe(true);
    expect(sdk.hasCapability("MODEL_LOAD")).toBe(false);
  });
});

describe("PlatformSDK — checkVersionPolicy delegation", () => {
  it("delegates correctly to DriverRegistry.checkVersionPolicy", () => {
    const sdk = new PlatformSDK(new MockExecutor());
    expect(sdk.checkVersionPolicy({ kind: "minimum", minimum: "3.0.0" }, "3.45.1")).toBe(true);
    expect(sdk.checkVersionPolicy({ kind: "minimum", minimum: "4.0.0" }, "3.45.1")).toBe(false);
    expect(sdk.checkVersionPolicy({ kind: "any" }, "anything")).toBe(true);
  });
});
