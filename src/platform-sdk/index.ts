// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Platform SDK
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// The Platform SDK is the only layer a UR program (or the UR Runtime) ever
// calls. It sits above the Driver Registry and the Generic Loader. A UR
// program says "I need a database driver" — the Platform SDK finds a
// registered driver that declares the DATABASE capability group, loads it,
// and hands back a typed API. The program never sees SQLite, OpenCV, or any
// library name.
//
//   UR Source
//       │
//   UR Runtime / Code Generator
//       │
//   Platform SDK   ← THIS FILE
//       │
//   Driver Registry  (src/ffi/native/driver-registry.ts)
//       │
//   Generic Loader   (src/ffi/native/loader.ts)
//       │
//   Native Drivers   (src/ffi/drivers/*)
//       │
//   Real Native Libraries
//
// Dependency rule: Platform SDK imports from driver-registry and loader.
//                  It NEVER imports from a specific driver (sqlite3, opencv…).
//                  Architecture tests enforce this invariant statically.
// ─────────────────────────────────────────────────────────────────────────────

import type { IPlatformExecutor, INativeDriver, DiagnosticLogger } from "../ffi/native/types.js";
import type { CapabilityFlag, DriverMetadata, VersionPolicy } from "../ffi/native/driver-registry.js";
import { DriverRegistry } from "../ffi/native/driver-registry.js";
import { NativeFfiLoader } from "../ffi/native/loader.js";

// ── Capability groups ─────────────────────────────────────────────────────────
//
// UR programs reason in terms of capability groups, not library names.
// A capability group is a human-scale label for a cluster of related
// CapabilityFlags. Multiple drivers may satisfy the same group.

export type CapabilityGroup =
  | "database"       // CONNECTION_LIFECYCLE + PREPARED_STATEMENTS + TRANSACTIONS
  | "vision"         // MAT_LIFECYCLE + IMAGE_LOAD + RESIZE
  | "inference"      // MODEL_LOAD + SESSION_CREATE + TENSOR_INPUT + CPU_EXECUTION
  | "robotics"       // NODE + PUBLISHER + SUBSCRIBER
  | "compression"    // COMPRESS + DECOMPRESS
  | "networking"     // HTTP_GET + HTTP_POST
  | "cryptography";  // SHA256 + AES

/** Minimum capability flags required per group. */
const GROUP_REQUIREMENTS: Record<CapabilityGroup, CapabilityFlag[]> = {
  database:    ["CONNECTION_LIFECYCLE", "PREPARED_STATEMENTS", "TRANSACTIONS"],
  vision:      ["MAT_LIFECYCLE", "IMAGE_LOAD", "RESIZE"],
  inference:   ["MODEL_LOAD", "SESSION_CREATE", "TENSOR_INPUT"],
  robotics:    ["NODE", "PUBLISHER", "SUBSCRIBER"],
  compression: ["COMPRESS", "DECOMPRESS"],
  networking:  ["HTTP_GET"],
  cryptography:["SHA256"],
};

// ── Platform SDK result types ─────────────────────────────────────────────────

export type PlatformBindResult<T> =
  | { ok: true;  api: T;         driverId: string; driverName: string }
  | { ok: false; reason: string; driverId?: string };

export type PlatformQueryResult = {
  driverId: string;
  metadata: DriverMetadata;
  satisfiesGroup: boolean;
};

// ── NativeResourceManager ─────────────────────────────────────────────────────
//
// Centralized resource tracker. Drivers call allocate()/release() on every
// opaque handle they create. The Platform SDK tracks live handles, detects
// leaks on teardown, and reports statistics.

export type ResourceKind =
  | "database_connection"
  | "prepared_statement"
  | "mat_handle"
  | "session_handle"
  | "ros2_node"
  | "generic";

export type ResourceEntry = {
  handle: bigint;
  kind: ResourceKind;
  driverId: string;
  allocatedAt: number; // Date.now()
  tag?: string;        // optional debug label
};

export class NativeResourceManager {
  private readonly resources = new Map<bigint, ResourceEntry>();
  private totalAllocated = 0;
  private totalReleased = 0;

  allocate(handle: bigint, kind: ResourceKind, driverId: string, tag?: string): void {
    if (this.resources.has(handle)) return; // idempotent
    this.resources.set(handle, { handle, kind, driverId, allocatedAt: Date.now(), tag });
    this.totalAllocated++;
  }

  release(handle: bigint): boolean {
    const had = this.resources.delete(handle);
    if (had) this.totalReleased++;
    return had;
  }

  isLive(handle: bigint): boolean {
    return this.resources.has(handle);
  }

  /** Returns all currently live resources (potential leaks if called at teardown). */
  liveResources(): ReadonlyArray<ResourceEntry> {
    return [...this.resources.values()];
  }

  stats(): { totalAllocated: number; totalReleased: number; currentlyLive: number } {
    return {
      totalAllocated: this.totalAllocated,
      totalReleased: this.totalReleased,
      currentlyLive: this.resources.size,
    };
  }

  /** Check for leaks. Returns entries that are still live. */
  detectLeaks(): ReadonlyArray<ResourceEntry> {
    return this.liveResources();
  }

  /** Release all tracked resources (best-effort teardown). */
  releaseAll(): void {
    for (const entry of this.resources.values()) {
      this.resources.delete(entry.handle);
      this.totalReleased++;
    }
  }
}

// ── Unified native error hierarchy ────────────────────────────────────────────
//
// Every native error surfaces through this hierarchy regardless of which
// library caused it. UR programs catch `NativeError`, not `SqliteError`.

export type NativeErrorKind =
  | "DRIVER_NOT_FOUND"
  | "DRIVER_LOAD_FAILED"
  | "ABI_MISMATCH"
  | "CAPABILITY_MISSING"
  | "DATABASE_ERROR"
  | "VISION_ERROR"
  | "INFERENCE_ERROR"
  | "ROBOTICS_ERROR"
  | "COMPRESSION_ERROR"
  | "NETWORKING_ERROR"
  | "UNKNOWN_NATIVE_ERROR";

export type NativeError = {
  kind: NativeErrorKind;
  message: string;
  driverId?: string;
  originalError?: unknown;
};

export function makeNativeError(
  kind: NativeErrorKind,
  message: string,
  opts?: { driverId?: string; originalError?: unknown },
): NativeError {
  return { kind, message, ...opts };
}

// ── PlatformSDK ───────────────────────────────────────────────────────────────
//
// The main entry point. Constructed once per application lifetime.
// Dependencies are injected — the SDK never instantiates drivers directly.

export class PlatformSDK {
  private readonly loader: NativeFfiLoader;
  readonly resources: NativeResourceManager;

  /**
   * @param executor  The platform executor (injected — enables testing without a real .so).
   * @param logger    Optional diagnostic logger.
   * @param resources Optional pre-created resource manager (injected for testing).
   */
  constructor(
    executor: IPlatformExecutor,
    logger?: DiagnosticLogger,
    resources?: NativeResourceManager,
  ) {
    this.loader = new NativeFfiLoader(executor, logger);
    this.resources = resources ?? new NativeResourceManager();
  }

  // ── Driver resolution by capability group ───────────────────────────────────

  /**
   * Finds the first registered driver that satisfies all required capabilities
   * for the given group and binds it.
   *
   * The caller never specifies a library name — the SDK picks the right driver.
   */
  bindByCapability<T>(group: CapabilityGroup, libraryPath: string): PlatformBindResult<T> {
    const required = GROUP_REQUIREMENTS[group];
    const candidates = DriverRegistry.list().filter((meta) =>
      required.every((cap) => meta.capabilities.includes(cap))
    );

    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `No registered driver satisfies capability group "${group}" ` +
          `(requires: ${required.join(", ")}). ` +
          `Register a driver that declares these capabilities before calling bindByCapability().`,
      };
    }

    // Use the first matching candidate (future: priority ordering)
    const meta = candidates[0]!;
    const registration = DriverRegistry.get<T>(meta.id);
    if (!registration) {
      return { ok: false, reason: `Driver "${meta.id}" listed but not retrievable`, driverId: meta.id };
    }

    const driver = registration.factory(libraryPath);
    const result = this.loader.bind(driver);
    if (!result.ok) {
      return { ok: false, reason: result.reason, driverId: meta.id };
    }

    return { ok: true, api: result.api, driverId: meta.id, driverName: meta.name };
  }

  /**
   * Binds a driver by its exact registered id and library path.
   * Use `bindByCapability` when possible to avoid coupling to a specific driver.
   */
  bindById<T>(driverId: string, libraryPath: string): PlatformBindResult<T> {
    const registration = DriverRegistry.get<T>(driverId);
    if (!registration) {
      return { ok: false, reason: `Driver "${driverId}" is not registered`, driverId };
    }
    const driver = registration.factory(libraryPath);
    const result = this.loader.bind(driver);
    if (!result.ok) {
      return { ok: false, reason: result.reason, driverId };
    }
    return { ok: true, api: result.api, driverId, driverName: registration.metadata.name };
  }

  /**
   * Binds a pre-constructed driver instance directly.
   * Used by tests and advanced callers that need to inject a specific driver.
   */
  bindDriver<T>(driver: INativeDriver<T>): PlatformBindResult<T> {
    const result = this.loader.bind(driver);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }
    return { ok: true, api: result.api, driverId: "(direct)", driverName: driver.descriptor.name };
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  /** List all registered drivers and whether each satisfies a given capability group. */
  query(group?: CapabilityGroup): PlatformQueryResult[] {
    const required = group ? GROUP_REQUIREMENTS[group] : [];
    return DriverRegistry.list().map((meta) => ({
      driverId: meta.id,
      metadata: meta,
      satisfiesGroup: required.every((cap) => meta.capabilities.includes(cap)),
    }));
  }

  /** Check if any registered driver satisfies the given capability group. */
  canHandle(group: CapabilityGroup): boolean {
    const required = GROUP_REQUIREMENTS[group];
    return DriverRegistry.list().some((meta) =>
      required.every((cap) => meta.capabilities.includes(cap))
    );
  }

  /** Check if a specific capability flag is available from any registered driver. */
  hasCapability(cap: CapabilityFlag): boolean {
    return DriverRegistry.list().some((meta) => meta.capabilities.includes(cap));
  }

  // ── Version policy ──────────────────────────────────────────────────────────

  /**
   * Check whether a runtime version satisfies a driver's version policy.
   * Delegates to DriverRegistry.checkVersionPolicy for the actual comparison.
   */
  checkVersionPolicy(policy: VersionPolicy, runtimeVersion: string): boolean {
    return DriverRegistry.checkVersionPolicy(policy, runtimeVersion);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Release all loaded native libraries. Call at application shutdown. */
  shutdown(): void {
    this.loader.unloadAll();
  }

  /** Returns the set of currently loaded library paths. */
  get loadedLibraries(): ReadonlySet<string> {
    return this.loader.loadedLibraries;
  }

  /**
   * Returns a snapshot of the current resource statistics.
   * Non-zero `currentlyLive` at shutdown indicates a potential leak.
   */
  resourceStats() {
    return this.resources.stats();
  }
}
