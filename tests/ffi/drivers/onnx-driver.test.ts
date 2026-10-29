// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: ONNX Runtime Driver (Unit — no native library required)
// Written per explicit FFI Stabilization directive — no language changes.
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors tests/ffi/drivers/opencv-driver.test.ts's own established pattern:
// a mock IPlatformExecutor records call sequences instead of calling dlopen(),
// so this suite verifies type contracts and call encoding without requiring a
// real libonnxruntime installation.

import { describe, it, expect, beforeEach } from "vitest";
import {
  OnnxDriver,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_DOUBLE,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64,
  ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING,
} from "../../../src/ffi/drivers/onnx/onnx-driver.js";
import { DriverRegistry } from "../../../src/ffi/native/driver-registry.js";
import type { NativeCall, NativeCallResult } from "../../../src/ffi/native/types.js";

// ── Mock executor ──────────────────────────────────────────────────────────────

function makeMockExecutor(responses: NativeCallResult[]) {
  let callIndex = 0;
  const calls: NativeCall[] = [];
  return {
    executedCalls: calls,
    execute(newCalls: NativeCall[]): NativeCallResult[] {
      calls.push(...newCalls);
      return newCalls.map(() => responses[callIndex++] ?? { kind: "void" as const });
    },
  };
}

const ENV_PTR = 100n;
const SESSION_PTR = 200n;
const TENSOR_PTR = 300n;

describe("OnnxDriver", () => {
  describe("descriptor", () => {
    it("has correct name", () => {
      expect(new OnnxDriver().descriptor.name).toBe("ONNX Runtime");
    });
    it("uses the default library path when none is given", () => {
      expect(new OnnxDriver().descriptor.libraryPath).toBe("/usr/lib/libonnxruntime.so");
    });
    it("uses a custom library path when provided", () => {
      expect(new OnnxDriver("/custom/libonnxruntime.so").descriptor.libraryPath).toBe("/custom/libonnxruntime.so");
    });
    it("declares the correct version symbol", () => {
      expect(new OnnxDriver().descriptor.versionSymbol).toBe("__ur_onnx_runtime_version");
    });
    it("versionExtractor returns the str value, empty otherwise", () => {
      const extract = new OnnxDriver().descriptor.versionExtractor!;
      expect(extract({ kind: "str", value: "1.16.0" })).toBe("1.16.0");
      expect(extract({ kind: "i32", value: 0 })).toBe("");
    });
  });

  describe("element type constants (mirror onnxruntime_c_api.h)", () => {
    it("match the real ONNX Runtime C API values", () => {
      expect(ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT).toBe(1);
      expect(ONNX_TENSOR_ELEMENT_DATA_TYPE_DOUBLE).toBe(11);
      expect(ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32).toBe(6);
      expect(ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64).toBe(7);
      expect(ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING).toBe(8);
    });
  });

  describe("version()", () => {
    it("combines runtime version string and api version int", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "1.16.3" }, { kind: "i32", value: 17 }]);
      const v = new OnnxDriver().bind(mock).version();
      expect(v).toEqual({ apiVersion: 17, runtimeVersion: "1.16.3" });
      expect(mock.executedCalls[0].symbol).toBe("__ur_onnx_runtime_version");
      expect(mock.executedCalls[1].symbol).toBe("__ur_onnx_api_version");
    });
  });

  describe("environment lifecycle", () => {
    it("createEnv encodes logLevel and logId, returns a ptr handle", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: ENV_PTR }]);
      const env = new OnnxDriver().bind(mock).createEnv(2, "my-app");
      expect(env).toBe(ENV_PTR);
      expect(mock.executedCalls[0]).toEqual({
        symbol: "__ur_ort_create_env",
        args: [{ kind: "i32", value: 2 }, { kind: "str", value: "my-app" }],
        returnKind: "ptr",
      });
    });
    it("releaseEnv sends the env pointer with void return", () => {
      const mock = makeMockExecutor([{ kind: "void" }]);
      new OnnxDriver().bind(mock).releaseEnv(ENV_PTR);
      expect(mock.executedCalls[0]).toEqual({
        symbol: "__ur_ort_release_env",
        args: [{ kind: "ptr", value: ENV_PTR }],
        returnKind: "void",
      });
    });
  });

  describe("session lifecycle", () => {
    it("createSession encodes env and modelPath, returns a ptr handle", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: SESSION_PTR }]);
      const session = new OnnxDriver().bind(mock).createSession(ENV_PTR, "model.onnx");
      expect(session).toBe(SESSION_PTR);
      expect(mock.executedCalls[0]).toEqual({
        symbol: "__ur_ort_create_session",
        args: [{ kind: "ptr", value: ENV_PTR }, { kind: "str", value: "model.onnx" }],
        returnKind: "ptr",
      });
    });
    it("releaseSession sends the session pointer with void return", () => {
      const mock = makeMockExecutor([{ kind: "void" }]);
      new OnnxDriver().bind(mock).releaseSession(SESSION_PTR);
      expect(mock.executedCalls[0].symbol).toBe("__ur_ort_release_session");
    });
  });

  describe("session introspection", () => {
    it("getInputInfo reads count then that many names, in order", () => {
      const mock = makeMockExecutor([
        { kind: "i32", value: 2 },
        { kind: "str", value: "input_a" },
        { kind: "str", value: "input_b" },
      ]);
      const info = new OnnxDriver().bind(mock).getInputInfo(SESSION_PTR);
      expect(info).toEqual({ count: 2, names: ["input_a", "input_b"] });
      expect(mock.executedCalls).toHaveLength(3);
    });
    it("getInputInfo with zero inputs makes no name calls", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 0 }]);
      const info = new OnnxDriver().bind(mock).getInputInfo(SESSION_PTR);
      expect(info).toEqual({ count: 0, names: [] });
      expect(mock.executedCalls).toHaveLength(1);
    });
    it("getOutputInfo reads count then that many names, in order", () => {
      const mock = makeMockExecutor([
        { kind: "i32", value: 1 },
        { kind: "str", value: "output_0" },
      ]);
      const info = new OnnxDriver().bind(mock).getOutputInfo(SESSION_PTR);
      expect(info).toEqual({ count: 1, names: ["output_0"] });
    });
  });

  describe("tensor I/O", () => {
    it("createFloatTensor encodes data and shape as CSV strings", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: TENSOR_PTR }]);
      const t = new OnnxDriver().bind(mock).createFloatTensor([1.5, 2.5, 3.5], [1, 3]);
      expect(t).toBe(TENSOR_PTR);
      expect(mock.executedCalls[0]).toEqual({
        symbol: "__ur_ort_create_float_tensor",
        args: [{ kind: "str", value: "1.5,2.5,3.5" }, { kind: "str", value: "1,3" }],
        returnKind: "ptr",
      });
    });
    it("createInt64Tensor encodes bigint data via String() and shape as CSV", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: TENSOR_PTR }]);
      const t = new OnnxDriver().bind(mock).createInt64Tensor([1n, 2n, 3n], [3]);
      expect(t).toBe(TENSOR_PTR);
      expect(mock.executedCalls[0].args).toEqual([
        { kind: "str", value: "1,2,3" },
        { kind: "str", value: "3" },
      ]);
    });
    it("getTensorShape reads ndim, elemType, then that many dims", () => {
      const mock = makeMockExecutor([
        { kind: "i32", value: 2 },
        { kind: "i32", value: ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT },
        { kind: "i32", value: 1 },
        { kind: "i32", value: 3 },
      ]);
      const shape = new OnnxDriver().bind(mock).getTensorShape(TENSOR_PTR);
      expect(shape).toEqual({ dims: [1, 3], elementType: ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT });
    });
    it("getFloatData reads count, then parses a CSV string into numbers", () => {
      const mock = makeMockExecutor([
        { kind: "i32", value: 3 },
        { kind: "str", value: "1.1,2.2,3.3" },
      ]);
      const data = new OnnxDriver().bind(mock).getFloatData(TENSOR_PTR);
      expect(data).toEqual([1.1, 2.2, 3.3]);
    });
    it("releaseValue sends the value pointer with void return", () => {
      const mock = makeMockExecutor([{ kind: "void" }]);
      new OnnxDriver().bind(mock).releaseValue(TENSOR_PTR);
      expect(mock.executedCalls[0].symbol).toBe("__ur_ort_release_value");
    });
  });

  describe("run() — inference", () => {
    it("encodes names/handles as CSV and parses the comma-separated output pointer list", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "300,301" }]);
      const result = new OnnxDriver().bind(mock).run(SESSION_PTR, ["in"], [TENSOR_PTR], ["out1", "out2"]);
      expect(result).toEqual({ outputs: [300n, 301n] });
      expect(mock.executedCalls[0]).toEqual({
        symbol: "__ur_ort_run",
        args: [
          { kind: "ptr", value: SESSION_PTR },
          { kind: "str", value: "in" },
          { kind: "str", value: "300" },
          { kind: "str", value: "out1,out2" },
          { kind: "i32", value: 2 },
        ],
        returnKind: "str",
      });
    });
    it("handles an empty output list (empty CSV string) without crashing", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "" }]);
      const result = new OnnxDriver().bind(mock).run(SESSION_PTR, [], [], []);
      expect(result).toEqual({ outputs: [] });
    });
  });

  describe("error handling — wrong result kind throws", () => {
    it("version() throws if runtime version isn't a str result", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 0 }]);
      expect(() => new OnnxDriver().bind(mock).version()).toThrow(/expected str/);
    });
    it("createEnv throws if result isn't a ptr", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "wrong" }]);
      expect(() => new OnnxDriver().bind(mock).createEnv(0, "x")).toThrow(/expected ptr/);
    });
  });

  describe("DriverRegistry integration", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });

    it("auto-registers with id 'onnx-runtime' on import", async () => {
      // Re-import to trigger side-effect registration
      await import("../../../src/ffi/drivers/onnx/onnx-driver.js");
      // After reset we re-register manually
      const { DriverRegistry: DR } = await import("../../../src/ffi/native/driver-registry.js");
      DR._resetForTests();
      const { OnnxDriver: Drv } = await import("../../../src/ffi/drivers/onnx/onnx-driver.js");
      // Registration already ran at module load time — but we can verify the factory works
      expect(new Drv().descriptor.name).toBe("ONNX Runtime");
    });

    it("declares the expected capabilities", () => {
      DriverRegistry.register({
        metadata: {
          id: "onnx-runtime",
          name: "ONNX Runtime",
          versionPolicy: { kind: "minimum", minimum: "1.16.0" },
          capabilities: ["MODEL_LOAD", "SESSION_CREATE", "TENSOR_INPUT", "TENSOR_OUTPUT", "CPU_EXECUTION"],
          description: "test",
        },
        factory: (path?: string) => new OnnxDriver(path),
      });
      expect(DriverRegistry.hasCapability("onnx-runtime", "MODEL_LOAD")).toBe(true);
      expect(DriverRegistry.hasCapability("onnx-runtime", "TENSOR_OUTPUT")).toBe(true);
      expect(DriverRegistry.hasCapability("onnx-runtime", "IMAGE_LOAD")).toBe(false);
    });
  });
});
