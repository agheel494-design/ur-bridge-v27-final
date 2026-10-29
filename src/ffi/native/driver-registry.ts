// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: Driver Registry
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// A central registry for all native drivers. Any library (SQLite3, OpenCV,
// ONNX, ROS2, zlib, OpenSSL, …) registers itself here. The Generic Loader
// discovers available drivers without knowing library-specific details.
//
// Design requirements (Phase 7.5 directive):
//   - Driver Interface is already defined in types.ts (INativeDriver<T>).
//   - DriverRegistry is the Phase 7.5 addition — registration, discovery,
//     metadata, capability flags, and version requirements.
//   - No library-specific logic lives inside DriverRegistry itself.
//   - Adding a new driver never requires modifying DriverRegistry.
// ─────────────────────────────────────────────────────────────────────────────

import type { INativeDriver } from "./types.js";

// ── Capability flags ──────────────────────────────────────────────────────────
//
// Each driver declares the capabilities it provides. The generic layer can
// use these to gate features or report what a loaded driver supports.

export type CapabilityFlag =
  // Database
  | "CONNECTION_LIFECYCLE"
  | "PREPARED_STATEMENTS"
  | "PARAMETER_BINDING"
  | "RESULT_COLUMNS"
  | "TRANSACTIONS"
  | "UTF8_ROUNDTRIP"
  | "ERROR_REPORTING"
  | "MUTATION_INTROSPECTION"
  // Vision
  | "MAT_LIFECYCLE"
  | "IMAGE_LOAD"
  | "IMAGE_SAVE"
  | "RESIZE"
  | "COLOR_CONVERSION"
  | "BLUR"
  | "THRESHOLD"
  | "EDGE_DETECTION"
  // Inference
  | "MODEL_LOAD"
  | "SESSION_CREATE"
  | "TENSOR_INPUT"
  | "TENSOR_OUTPUT"
  | "CPU_EXECUTION"
  | "GPU_EXECUTION"
  // Robotics
  | "NODE"
  | "PUBLISHER"
  | "SUBSCRIBER"
  | "TIMER"
  | "SERVICE"
  // General
  | "COMPRESS"
  | "DECOMPRESS"
  | "GZIP"
  | "CRC32"
  | "SHA256"
  | "AES"
  | "RSA"
  | "HMAC"
  | "RAND"
  | "HTTP_GET"
  | "HTTP_POST"
  | "HTTPS"
  | "WEBSOCKET";

// ── Version policy ─────────────────────────────────────────────────────────────

export type VersionPolicy =
  | { kind: "exact";   version: string }
  | { kind: "minimum"; minimum: string }
  | { kind: "range";   minimum: string; maximum: string }
  | { kind: "any" };

// ── Driver metadata ────────────────────────────────────────────────────────────

export type DriverMetadata = {
  /** Short unique identifier for the driver, e.g. "sqlite3", "opencv". */
  readonly id: string;
  /** Human-readable name, e.g. "SQLite3", "OpenCV". */
  readonly name: string;
  /** Version policy the driver enforces at load time. */
  readonly versionPolicy: VersionPolicy;
  /** Capabilities this driver exposes. */
  readonly capabilities: ReadonlyArray<CapabilityFlag>;
  /** Human-readable description. */
  readonly description: string;
  /** Docs URL or reference (optional). */
  readonly docs?: string;
};

// ── Driver registration entry ──────────────────────────────────────────────────

export type DriverRegistration<T> = {
  readonly metadata: DriverMetadata;
  /** Factory function that creates the driver instance for a given library path. */
  readonly factory: (libraryPath: string) => INativeDriver<T>;
};

// ── Unified driver error ───────────────────────────────────────────────────────

export type NativeDriverError =
  | { kind: "NOT_FOUND";       driverId: string }
  | { kind: "ALREADY_REGISTERED"; driverId: string }
  | { kind: "LOAD_FAILED";     driverId: string; reason: string }
  | { kind: "ABI_MISMATCH";    driverId: string; expected: string; actual: string }
  | { kind: "CAPABILITY_MISSING"; driverId: string; required: CapabilityFlag };

// ── DriverRegistry ────────────────────────────────────────────────────────────

/**
 * Central registry for all native drivers.
 *
 * Usage pattern:
 *   1. Each driver module calls `DriverRegistry.register(...)` at load time.
 *   2. The Generic Loader (NativeFfiLoader) calls `DriverRegistry.get(id)` to
 *      retrieve the factory, then delegates to the driver's `bind()` method.
 *   3. `DriverRegistry.list()` returns all registered drivers for tooling.
 *
 * Thread safety: JavaScript is single-threaded. No locking needed.
 */
export class DriverRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static readonly entries = new Map<string, DriverRegistration<any>>();

  /**
   * Register a driver. Throws if a driver with the same id is already registered
   * and `allowOverride` is not true. Passing `allowOverride: true` allows tests
   * and tooling to replace stubs without restarting the process.
   */
  static register<T>(
    registration: DriverRegistration<T>,
    options: { allowOverride?: boolean } = {},
  ): void {
    const { id } = registration.metadata;
    if (DriverRegistry.entries.has(id) && !options.allowOverride) {
      throw new Error(
        `DriverRegistry: driver "${id}" is already registered. ` +
        `Pass { allowOverride: true } to replace it.`,
      );
    }
    DriverRegistry.entries.set(id, registration);
  }

  /**
   * Retrieve a registered driver by id.
   * Returns `undefined` if not found — callers decide how to handle the absence.
   */
  static get<T>(id: string): DriverRegistration<T> | undefined {
    return DriverRegistry.entries.get(id) as DriverRegistration<T> | undefined;
  }

  /** Returns true if a driver with the given id is registered. */
  static has(id: string): boolean {
    return DriverRegistry.entries.has(id);
  }

  /** Unregister a driver. No-op if not found. Used in tests and teardown. */
  static unregister(id: string): boolean {
    return DriverRegistry.entries.delete(id);
  }

  /** List all registered drivers' metadata (read-only snapshot). */
  static list(): ReadonlyArray<DriverMetadata> {
    return [...DriverRegistry.entries.values()].map(e => e.metadata);
  }

  /** Check if a driver exposes a required capability. */
  static hasCapability(id: string, cap: CapabilityFlag): boolean {
    const entry = DriverRegistry.entries.get(id);
    return entry?.metadata.capabilities.includes(cap) ?? false;
  }

  /**
   * Check if a driver satisfies a version requirement.
   * Returns true if the runtime version satisfies the policy.
   */
  static checkVersionPolicy(policy: VersionPolicy, runtimeVersion: string): boolean {
    if (policy.kind === "any") return true;

    const parse = (v: string): [number, number, number] | undefined => {
      const m = v.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!m) return undefined;
      return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    };

    const rt = parse(runtimeVersion);
    if (!rt) return false;

    if (policy.kind === "exact") {
      const ex = parse(policy.version);
      if (!ex) return false;
      return rt[0] === ex[0] && rt[1] === ex[1] && rt[2] === ex[2];
    }

    if (policy.kind === "minimum") {
      const min = parse(policy.minimum);
      if (!min) return false;
      if (rt[0] !== min[0]) return rt[0] > min[0];
      if (rt[1] !== min[1]) return rt[1] > min[1];
      return rt[2] >= min[2];
    }

    if (policy.kind === "range") {
      const min = parse(policy.minimum);
      const max = parse(policy.maximum);
      if (!min || !max) return false;
      const aboveMin = (rt[0] > min[0]) || (rt[0] === min[0] && rt[1] > min[1]) || (rt[0] === min[0] && rt[1] === min[1] && rt[2] >= min[2]);
      const belowMax = (rt[0] < max[0]) || (rt[0] === max[0] && rt[1] < max[1]) || (rt[0] === max[0] && rt[1] === max[1] && rt[2] <= max[2]);
      return aboveMin && belowMax;
    }

    return false;
  }

  /** Clear all registrations. For use in tests only. */
  static _resetForTests(): void {
    DriverRegistry.entries.clear();
  }

  /** Total number of registered drivers. */
  static get size(): number {
    return DriverRegistry.entries.size;
  }
}
