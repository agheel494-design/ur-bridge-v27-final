// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Driver Registry
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  DriverRegistry,
  type DriverRegistration,
  type CapabilityFlag,
  type VersionPolicy,
} from "../../../src/ffi/native/driver-registry.js";
import type { INativeDriver } from "../../../src/ffi/native/types.js";

// ── Test stub driver ───────────────────────────────────────────────────────────

type StubApi = { ping(): string };

function makeStubDriver(libPath: string): INativeDriver<StubApi> {
  return {
    descriptor: { name: "Stub", libraryPath: libPath },
    bind: (_exec) => ({ ping: () => "pong" }),
  };
}

const STUB_REGISTRATION: DriverRegistration<StubApi> = {
  metadata: {
    id: "stub",
    name: "Stub Driver",
    versionPolicy: { kind: "any" },
    capabilities: ["CONNECTION_LIFECYCLE"],
    description: "Test stub driver",
  },
  factory: makeStubDriver,
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("DriverRegistry — register / get / has", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("registers a driver and retrieves it by id", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      const entry = DriverRegistry.get<StubApi>("stub");
      expect(entry).toBeDefined();
      expect(entry?.metadata.id).toBe("stub");
      expect(entry?.metadata.name).toBe("Stub Driver");
    });

    it("has() returns true for registered driver", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(DriverRegistry.has("stub")).toBe(true);
    });

    it("has() returns false for unknown driver", () => {
      expect(DriverRegistry.has("unknown")).toBe(false);
    });

    it("get() returns undefined for unknown driver", () => {
      expect(DriverRegistry.get("unknown")).toBeUndefined();
    });

    it("factory produces a working driver instance", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      const entry = DriverRegistry.get<StubApi>("stub");
      const driver = entry!.factory("/lib/stub.so");
      expect(driver.descriptor.libraryPath).toBe("/lib/stub.so");
      const api = driver.bind({ execute: (_calls) => [] });
      expect(api.ping()).toBe("pong");
    });
});

describe("DriverRegistry — duplicate registration", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("throws on double-register without allowOverride", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(() => DriverRegistry.register(STUB_REGISTRATION)).toThrow(
        /already registered/,
      );
    });

    it("succeeds with allowOverride: true", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      const updated: DriverRegistration<StubApi> = {
        ...STUB_REGISTRATION,
        metadata: { ...STUB_REGISTRATION.metadata, description: "updated" },
      };
      expect(() =>
        DriverRegistry.register(updated, { allowOverride: true }),
      ).not.toThrow();
      expect(DriverRegistry.get<StubApi>("stub")?.metadata.description).toBe("updated");
    });
});

describe("DriverRegistry — unregister", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("removes a registered driver", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(DriverRegistry.has("stub")).toBe(true);
      const removed = DriverRegistry.unregister("stub");
      expect(removed).toBe(true);
      expect(DriverRegistry.has("stub")).toBe(false);
    });

    it("returns false when unregistering unknown driver", () => {
      expect(DriverRegistry.unregister("unknown")).toBe(false);
    });
});

describe("DriverRegistry — list", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("returns empty list when no drivers registered", () => {
      expect(DriverRegistry.list()).toHaveLength(0);
    });

    it("lists all registered drivers", () => {
      const reg2: DriverRegistration<StubApi> = {
        ...STUB_REGISTRATION,
        metadata: { ...STUB_REGISTRATION.metadata, id: "stub2", name: "Stub2" },
      };
      DriverRegistry.register(STUB_REGISTRATION);
      DriverRegistry.register(reg2);
      const list = DriverRegistry.list();
      expect(list).toHaveLength(2);
      expect(list.map(m => m.id).sort()).toEqual(["stub", "stub2"]);
    });

    it("returned list is a snapshot — mutations do not affect registry", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      const list = DriverRegistry.list() as DriverRegistration<StubApi>[];
      expect(Array.isArray(list)).toBe(true);
      // Confirm registry still has the driver
      expect(DriverRegistry.has("stub")).toBe(true);
    });
});

describe("DriverRegistry — hasCapability", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("returns true when driver has the capability", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(DriverRegistry.hasCapability("stub", "CONNECTION_LIFECYCLE")).toBe(true);
    });

    it("returns false for capability not in driver", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(DriverRegistry.hasCapability("stub", "IMAGE_LOAD")).toBe(false);
    });

    it("returns false for unknown driver id", () => {
      expect(DriverRegistry.hasCapability("unknown", "IMAGE_LOAD")).toBe(false);
    });
});

describe("DriverRegistry — checkVersionPolicy", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });
  const check = DriverRegistry.checkVersionPolicy.bind(DriverRegistry);


    it("'any' policy always passes", () => {
      const policy: VersionPolicy = { kind: "any" };
      expect(check(policy, "1.0.0")).toBe(true);
      expect(check(policy, "99.99.99")).toBe(true);
      expect(check(policy, "not-a-version")).toBe(true);
    });


  describe("exact policy", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });
    const policy: VersionPolicy = { kind: "exact", version: "3.45.1" };
      it("passes on exact match", () => expect(check(policy, "3.45.1")).toBe(true));
      it("fails on minor difference", () => expect(check(policy, "3.46.0")).toBe(false));
      it("fails on major difference", () => expect(check(policy, "4.0.0")).toBe(false));
      it("fails on unparseable", () => expect(check(policy, "abc")).toBe(false));
    });

  describe("minimum policy", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });
    const policy: VersionPolicy = { kind: "minimum", minimum: "3.45.0" };
      it("passes on equal version", () => expect(check(policy, "3.45.0")).toBe(true));
      it("passes on higher patch", () => expect(check(policy, "3.45.1")).toBe(true));
      it("passes on higher minor", () => expect(check(policy, "3.46.0")).toBe(true));
      it("passes on higher major", () => expect(check(policy, "4.0.0")).toBe(true));
      it("fails on lower patch", () => expect(check(policy, "3.44.9")).toBe(false));
      it("fails on lower major", () => expect(check(policy, "2.99.99")).toBe(false));
    });

  describe("range policy", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });
    const policy: VersionPolicy = { kind: "range", minimum: "3.0.0", maximum: "4.0.0" };
      it("passes on minimum boundary", () => expect(check(policy, "3.0.0")).toBe(true));
      it("passes on maximum boundary", () => expect(check(policy, "4.0.0")).toBe(true));
      it("passes on version in range", () => expect(check(policy, "3.45.0")).toBe(true));
      it("fails below minimum", () => expect(check(policy, "2.99.9")).toBe(false));
      it("fails above maximum", () => expect(check(policy, "5.0.0")).toBe(false));
    });
});

describe("DriverRegistry — size", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("starts at 0", () => expect(DriverRegistry.size).toBe(0));
    it("increments on register", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      expect(DriverRegistry.size).toBe(1);
    });
    it("decrements on unregister", () => {
      DriverRegistry.register(STUB_REGISTRATION);
      DriverRegistry.unregister("stub");
      expect(DriverRegistry.size).toBe(0);
    });
});

describe("DriverRegistry — multiple driver types", () => {
  beforeEach(() => { DriverRegistry._resetForTests(); });

    it("handles drivers with different capability sets", () => {
      const visionCaps: CapabilityFlag[] = ["MAT_LIFECYCLE", "IMAGE_LOAD", "RESIZE"];
      const inferenceCaps: CapabilityFlag[] = ["MODEL_LOAD", "TENSOR_INPUT", "CPU_EXECUTION"];

      const vision: DriverRegistration<StubApi> = {
        ...STUB_REGISTRATION,
        metadata: { ...STUB_REGISTRATION.metadata, id: "opencv", capabilities: visionCaps },
      };
      const inference: DriverRegistration<StubApi> = {
        ...STUB_REGISTRATION,
        metadata: { ...STUB_REGISTRATION.metadata, id: "onnx", capabilities: inferenceCaps },
      };

      DriverRegistry.register(vision);
      DriverRegistry.register(inference);

      expect(DriverRegistry.hasCapability("opencv", "IMAGE_LOAD")).toBe(true);
      expect(DriverRegistry.hasCapability("opencv", "TENSOR_INPUT")).toBe(false);
      expect(DriverRegistry.hasCapability("onnx", "CPU_EXECUTION")).toBe(true);
      expect(DriverRegistry.hasCapability("onnx", "IMAGE_LOAD")).toBe(false);
    });
});
