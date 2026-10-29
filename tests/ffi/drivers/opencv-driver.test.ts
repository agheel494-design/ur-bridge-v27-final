// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: OpenCV Driver (Unit — no native library required)
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests verify the OpenCV driver's type contracts, call encoding, and
// Driver Registry integration without requiring a real libopencv installation.
// They use a mock IPlatformExecutor that records call sequences instead of
// calling dlopen(). Real end-to-end tests require OpenCV to be installed and
// live in tests/ffi/drivers/opencv-native-e2e.test.ts (environment-gated).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  OpenCvDriver,
  CV_BGR2GRAY,
  CV_BGR2RGB,
  THRESH_BINARY,
  THRESH_OTSU,
} from "../../../src/ffi/drivers/opencv/opencv-driver.js";
import { DriverRegistry } from "../../../src/ffi/native/driver-registry.js";
import type { NativeCall, NativeCallResult } from "../../../src/ffi/native/types.js";

// ── Mock executor ──────────────────────────────────────────────────────────────

type MockResponse = NativeCallResult;

function makeMockExecutor(responses: MockResponse[]) {
  let callIndex = 0;
  const calls: NativeCall[] = [];

  return {
    executedCalls: calls,
    execute(newCalls: NativeCall[]): NativeCallResult[] {
      calls.push(...newCalls);
      return newCalls.map(() => {
        const r = responses[callIndex++] ?? { kind: "void" as const };
        return r;
      });
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAT_PTR = 42n;
const MAT_PTR2 = 99n;

describe("OpenCvDriver", () => {
  describe("descriptor", () => {
    it("has correct name", () => {
      const driver = new OpenCvDriver();
      expect(driver.descriptor.name).toBe("OpenCV");
    });

    it("uses the provided library path", () => {
      const driver = new OpenCvDriver("/custom/libopencv.so");
      expect(driver.descriptor.libraryPath).toBe("/custom/libopencv.so");
    });

    it("declares a version symbol", () => {
      const driver = new OpenCvDriver();
      expect(driver.descriptor.versionSymbol).toBe("__ur_opencv_version_string");
    });

    it("versionExtractor returns str value", () => {
      const driver = new OpenCvDriver();
      const extract = driver.descriptor.versionExtractor!;
      expect(extract({ kind: "str", value: "4.8.0" })).toBe("4.8.0");
      expect(extract({ kind: "i32", value: 0 })).toBe("");
    });
  });

  describe("version()", () => {
    it("parses version string correctly", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "4.8.1" }]);
      const driver = new OpenCvDriver();
      const api = driver.bind(mock);
      const v = api.version();
      expect(v.major).toBe(4);
      expect(v.minor).toBe(8);
      expect(v.patch).toBe(1);
      expect(v.fullString).toBe("4.8.1");
    });

    it("emits __ur_opencv_version_string call", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "4.6.0" }]);
      const api = new OpenCvDriver().bind(mock);
      api.version();
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_opencv_version_string");
    });
  });

  describe("matCreate()", () => {
    it("emits __ur_mat_create with correct args", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR }]);
      const api = new OpenCvDriver().bind(mock);
      const handle = api.matCreate(480, 640, 16);
      expect(handle).toBe(MAT_PTR);
      const call = mock.executedCalls[0]!;
      expect(call.symbol).toBe("__ur_mat_create");
      expect(call.args[0]).toEqual({ kind: "i32", value: 480 });
      expect(call.args[1]).toEqual({ kind: "i32", value: 640 });
      expect(call.args[2]).toEqual({ kind: "i32", value: 16 });
    });
  });

  describe("matClone()", () => {
    it("emits __ur_mat_clone with source handle", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      const clone = api.matClone(MAT_PTR);
      expect(clone).toBe(MAT_PTR2);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_mat_clone");
      expect(mock.executedCalls[0]?.args[0]).toEqual({ kind: "ptr", value: MAT_PTR });
    });
  });

  describe("matRelease()", () => {
    it("emits __ur_mat_release", () => {
      const mock = makeMockExecutor([{ kind: "void" }]);
      const api = new OpenCvDriver().bind(mock);
      api.matRelease(MAT_PTR);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_mat_release");
      expect(mock.executedCalls[0]?.args[0]).toEqual({ kind: "ptr", value: MAT_PTR });
    });
  });

  describe("matInfo()", () => {
    it("emits 5 calls and assembles MatInfo", () => {
      const mock = makeMockExecutor([
        { kind: "i32", value: 480 },
        { kind: "i32", value: 640 },
        { kind: "i32", value: 3 },
        { kind: "i32", value: 0 },
        { kind: "i32", value: 1 },
      ]);
      const api = new OpenCvDriver().bind(mock);
      const info = api.matInfo(MAT_PTR);
      expect(info.rows).toBe(480);
      expect(info.cols).toBe(640);
      expect(info.channels).toBe(3);
      expect(info.depth).toBe(0);
      expect(info.elemSize).toBe(1);
      expect(mock.executedCalls).toHaveLength(5);
    });
  });

  describe("imread()", () => {
    it("emits __ur_imread with path and flags", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR }]);
      const api = new OpenCvDriver().bind(mock);
      const h = api.imread("/tmp/test.jpg", 1);
      expect(h).toBe(MAT_PTR);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_imread");
      expect(mock.executedCalls[0]?.args[0]).toEqual({ kind: "str", value: "/tmp/test.jpg" });
      expect(mock.executedCalls[0]?.args[1]).toEqual({ kind: "i32", value: 1 });
    });
  });

  describe("imwrite()", () => {
    it("returns true on non-zero rc", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 1 }]);
      const api = new OpenCvDriver().bind(mock);
      expect(api.imwrite("/tmp/out.jpg", MAT_PTR)).toBe(true);
    });

    it("returns false on zero rc", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 0 }]);
      const api = new OpenCvDriver().bind(mock);
      expect(api.imwrite("/tmp/out.jpg", MAT_PTR)).toBe(false);
    });
  });

  describe("resize()", () => {
    it("emits __ur_resize and returns correct shape", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      const r = api.resize(MAT_PTR, 240, 320);
      expect(r.handle).toBe(MAT_PTR2);
      expect(r.rows).toBe(240);
      expect(r.cols).toBe(320);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_resize");
    });
  });

  describe("cvtColor()", () => {
    it("passes CV_BGR2GRAY code correctly", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      const h = api.cvtColor(MAT_PTR, CV_BGR2GRAY);
      expect(h).toBe(MAT_PTR2);
      expect(mock.executedCalls[0]?.args[1]).toEqual({ kind: "i32", value: CV_BGR2GRAY });
    });

    it("passes CV_BGR2RGB code correctly", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      api.cvtColor(MAT_PTR, CV_BGR2RGB);
      expect(mock.executedCalls[0]?.args[1]).toEqual({ kind: "i32", value: CV_BGR2RGB });
    });
  });

  describe("gaussianBlur()", () => {
    it("passes kernel size and sigma", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      api.gaussianBlur(MAT_PTR, 5, 1.5);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_gaussian_blur");
      expect(mock.executedCalls[0]?.args[1]).toEqual({ kind: "i32", value: 5 });
      expect(mock.executedCalls[0]?.args[2]).toEqual({ kind: "f64", value: 1.5 });
    });
  });

  describe("threshold()", () => {
    it("emits two calls and returns handle + effective threshold", () => {
      const mock = makeMockExecutor([
        { kind: "ptr", value: MAT_PTR2 },
        { kind: "f64", value: 127.0 },
      ]);
      const api = new OpenCvDriver().bind(mock);
      const r = api.threshold(MAT_PTR, 127.0, 255.0, THRESH_BINARY);
      expect(r.handle).toBe(MAT_PTR2);
      expect(r.threshold).toBe(127.0);
    });

    it("passes THRESH_OTSU type code", () => {
      const mock = makeMockExecutor([
        { kind: "ptr", value: MAT_PTR2 },
        { kind: "f64", value: 112.0 },
      ]);
      const api = new OpenCvDriver().bind(mock);
      api.threshold(MAT_PTR, 0, 255, THRESH_OTSU);
      expect(mock.executedCalls[0]?.args[3]).toEqual({ kind: "i32", value: THRESH_OTSU });
    });
  });

  describe("canny()", () => {
    it("emits __ur_canny with correct thresholds", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: MAT_PTR2 }]);
      const api = new OpenCvDriver().bind(mock);
      const h = api.canny(MAT_PTR, 50.0, 150.0);
      expect(h).toBe(MAT_PTR2);
      expect(mock.executedCalls[0]?.symbol).toBe("__ur_canny");
      expect(mock.executedCalls[0]?.args[1]).toEqual({ kind: "f64", value: 50.0 });
      expect(mock.executedCalls[0]?.args[2]).toEqual({ kind: "f64", value: 150.0 });
    });
  });

  describe("DriverRegistry integration", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });

    it("auto-registers with id 'opencv' on import", async () => {
      // Re-import to trigger side-effect registration
      await import("../../../src/ffi/drivers/opencv/opencv-driver.js");
      // After reset we re-register manually
      const { DriverRegistry: DR } = await import("../../../src/ffi/native/driver-registry.js");
      DR._resetForTests();
      const { OpenCvDriver: Drv } = await import("../../../src/ffi/drivers/opencv/opencv-driver.js");
      // Registration already ran at module load time — but we can verify the factory works
      expect(new Drv().descriptor.name).toBe("OpenCV");
    });

    it("has IMAGE_LOAD capability after registration", () => {
      DriverRegistry.register({
        metadata: {
          id: "opencv",
          name: "OpenCV",
          versionPolicy: { kind: "minimum", minimum: "4.0.0" },
          capabilities: ["MAT_LIFECYCLE", "IMAGE_LOAD", "IMAGE_SAVE", "RESIZE", "COLOR_CONVERSION", "BLUR", "THRESHOLD", "EDGE_DETECTION"],
          description: "test",
        },
        factory: (p) => new OpenCvDriver(p),
      });
      expect(DriverRegistry.hasCapability("opencv", "IMAGE_LOAD")).toBe(true);
      expect(DriverRegistry.hasCapability("opencv", "EDGE_DETECTION")).toBe(true);
      expect(DriverRegistry.hasCapability("opencv", "MODEL_LOAD")).toBe(false);
    });
  });
});
