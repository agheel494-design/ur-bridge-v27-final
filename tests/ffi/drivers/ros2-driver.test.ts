// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: ROS2 (rclc) Driver (Unit — no native library required)
// Written per explicit FFI Stabilization directive — no language changes.
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors tests/ffi/drivers/opencv-driver.test.ts's own established pattern:
// a mock IPlatformExecutor records call sequences instead of calling dlopen(),
// so this suite verifies type contracts and call encoding without requiring a
// real ROS2/rclc installation.

import { describe, it, expect, beforeEach } from "vitest";
import { Ros2Driver, RCL_RET_OK, RCL_RET_ERROR } from "../../../src/ffi/drivers/ros2/ros2-driver.js";
import { DriverRegistry } from "../../../src/ffi/native/driver-registry.js";
import type { NativeCall, NativeCallResult } from "../../../src/ffi/native/types.js";

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

const CTX = 1n, NODE = 2n, PUB = 3n, SUB = 4n, TIMER = 5n, SVC = 6n, EXEC = 7n;

describe("Ros2Driver", () => {
  describe("descriptor", () => {
    it("has correct name", () => {
      expect(new Ros2Driver().descriptor.name).toBe("ROS2 (rclc)");
    });
    it("uses the default library path when none is given", () => {
      expect(new Ros2Driver().descriptor.libraryPath).toBe("/opt/ros/humble/lib/librclc.so");
    });
    it("uses a custom library path when provided", () => {
      expect(new Ros2Driver("/custom/librclc.so").descriptor.libraryPath).toBe("/custom/librclc.so");
    });
    it("declares the correct version symbol", () => {
      expect(new Ros2Driver().descriptor.versionSymbol).toBe("__ur_rcl_version_string");
    });
    it("versionExtractor returns str value, empty otherwise", () => {
      const extract = new Ros2Driver().descriptor.versionExtractor!;
      expect(extract({ kind: "str", value: "3.1.0" })).toBe("3.1.0");
      expect(extract({ kind: "i32", value: 0 })).toBe("");
    });
  });

  describe("return code constants", () => {
    it("match rcl's own conventions", () => {
      expect(RCL_RET_OK).toBe(0);
      expect(RCL_RET_ERROR).toBe(1);
    });
  });

  describe("version()", () => {
    it("combines 3 separate i32 calls into major/minor/patch", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 3 }, { kind: "i32", value: 1 }, { kind: "i32", value: 4 }]);
      const v = new Ros2Driver().bind(mock).version();
      expect(v).toEqual({ major: 3, minor: 1, patch: 4 });
      expect(mock.executedCalls.map(c => c.symbol)).toEqual([
        "__ur_rcl_version_major", "__ur_rcl_version_minor", "__ur_rcl_version_patch",
      ]);
    });
  });

  describe("lifecycle", () => {
    it("init returns a context ptr with no args", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: CTX }]);
      expect(new Ros2Driver().bind(mock).init()).toBe(CTX);
      expect(mock.executedCalls[0]).toEqual({ symbol: "__ur_rcl_init", args: [], returnKind: "ptr" });
    });
    it("shutdown sends the context ptr, returns i32", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).shutdown(CTX)).toBe(RCL_RET_OK);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: CTX }]);
    });
  });

  describe("node", () => {
    it("createNode with no options uses empty-string namespace", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: NODE }]);
      const node = new Ros2Driver().bind(mock).createNode(CTX, "my_node");
      expect(node).toBe(NODE);
      expect(mock.executedCalls[0].args).toEqual([
        { kind: "ptr", value: CTX }, { kind: "str", value: "my_node" }, { kind: "str", value: "" },
      ]);
    });
    it("createNode with options passes the given namespace", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: NODE }]);
      new Ros2Driver().bind(mock).createNode(CTX, "my_node", { namespace: "/ns" });
      expect(mock.executedCalls[0].args[2]).toEqual({ kind: "str", value: "/ns" });
    });
    it("destroyNode sends the node ptr, returns i32", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroyNode(NODE)).toBe(RCL_RET_OK);
    });
  });

  describe("publisher", () => {
    it("createPublisher encodes node/topic/qosDepth", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: PUB }]);
      const pub = new Ros2Driver().bind(mock).createPublisher(NODE, "/topic", 10);
      expect(pub).toBe(PUB);
      expect(mock.executedCalls[0].args).toEqual([
        { kind: "ptr", value: NODE }, { kind: "str", value: "/topic" }, { kind: "i32", value: 10 },
      ]);
    });
    it("publish encodes publisher and message string", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).publish(PUB, "hello")).toBe(RCL_RET_OK);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: PUB }, { kind: "str", value: "hello" }]);
    });
    it("destroyPublisher sends the publisher ptr", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroyPublisher(PUB)).toBe(RCL_RET_OK);
    });
  });

  describe("subscriber", () => {
    it("createSubscription encodes node/topic/qosDepth", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: SUB }]);
      const sub = new Ros2Driver().bind(mock).createSubscription(NODE, "/topic", 5);
      expect(sub).toBe(SUB);
    });
    it("takeMessage returns the str value when a message is available", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "msg-data" }]);
      expect(new Ros2Driver().bind(mock).takeMessage(SUB)).toBe("msg-data");
    });
    it("takeMessage returns null for an empty string result", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "" }]);
      expect(new Ros2Driver().bind(mock).takeMessage(SUB)).toBeNull();
    });
    it("takeMessage returns null for a void result (no message available)", () => {
      const mock = makeMockExecutor([{ kind: "void" }]);
      expect(new Ros2Driver().bind(mock).takeMessage(SUB)).toBeNull();
    });
    it("takeMessage returns null for an error result", () => {
      const mock = makeMockExecutor([{ kind: "error", message: "no data" }]);
      expect(new Ros2Driver().bind(mock).takeMessage(SUB)).toBeNull();
    });
    it("destroySubscription sends the subscription ptr", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroySubscription(SUB)).toBe(RCL_RET_OK);
    });
  });

  describe("timer", () => {
    it("createTimer encodes node and periodMs", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: TIMER }]);
      const t = new Ros2Driver().bind(mock).createTimer(NODE, 1000);
      expect(t).toBe(TIMER);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: NODE }, { kind: "i32", value: 1000 }]);
    });
    it("timerIsReady converts nonzero i32 to true", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 1 }]);
      expect(new Ros2Driver().bind(mock).timerIsReady(TIMER)).toBe(true);
    });
    it("timerIsReady converts zero i32 to false", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: 0 }]);
      expect(new Ros2Driver().bind(mock).timerIsReady(TIMER)).toBe(false);
    });
    it("timerCallOrSkip returns true only for RCL_RET_OK specifically", () => {
      const mockOk = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mockOk).timerCallOrSkip(TIMER)).toBe(true);
      const mockErr = makeMockExecutor([{ kind: "i32", value: RCL_RET_ERROR }]);
      expect(new Ros2Driver().bind(mockErr).timerCallOrSkip(TIMER)).toBe(false);
    });
    it("destroyTimer sends the timer ptr", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroyTimer(TIMER)).toBe(RCL_RET_OK);
    });
  });

  describe("service", () => {
    it("createService encodes node and serviceName", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: SVC }]);
      const s = new Ros2Driver().bind(mock).createService(NODE, "/svc");
      expect(s).toBe(SVC);
    });
    it("serviceTakeRequest returns str value or null (empty/void/error)", () => {
      expect(new Ros2Driver().bind(makeMockExecutor([{ kind: "str", value: "req" }])).serviceTakeRequest(SVC)).toBe("req");
      expect(new Ros2Driver().bind(makeMockExecutor([{ kind: "void" }])).serviceTakeRequest(SVC)).toBeNull();
    });
    it("serviceSendResponse encodes service and response string", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).serviceSendResponse(SVC, "resp")).toBe(RCL_RET_OK);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: SVC }, { kind: "str", value: "resp" }]);
    });
    it("destroyService sends the service ptr", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroyService(SVC)).toBe(RCL_RET_OK);
    });
  });

  describe("executor", () => {
    it("createExecutor encodes context and maxHandles", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: EXEC }]);
      const e = new Ros2Driver().bind(mock).createExecutor(CTX, 4);
      expect(e).toBe(EXEC);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: CTX }, { kind: "i32", value: 4 }]);
    });
    it("addTimer encodes executor and timer ptrs", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).addTimer(EXEC, TIMER)).toBe(RCL_RET_OK);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: EXEC }, { kind: "ptr", value: TIMER }]);
    });
    it("addSubscription encodes executor and subscription ptrs", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).addSubscription(EXEC, SUB)).toBe(RCL_RET_OK);
    });
    it("spinSome encodes executor and timeoutMs", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).spinSome(EXEC, 100)).toBe(RCL_RET_OK);
      expect(mock.executedCalls[0].args).toEqual([{ kind: "ptr", value: EXEC }, { kind: "i32", value: 100 }]);
    });
    it("destroyExecutor sends the executor ptr", () => {
      const mock = makeMockExecutor([{ kind: "i32", value: RCL_RET_OK }]);
      expect(new Ros2Driver().bind(mock).destroyExecutor(EXEC)).toBe(RCL_RET_OK);
    });
  });

  describe("error handling — wrong result kind throws", () => {
    it("init throws if result isn't a ptr", () => {
      const mock = makeMockExecutor([{ kind: "str", value: "wrong" }]);
      expect(() => new Ros2Driver().bind(mock).init()).toThrow(/expected ptr/);
    });
    it("shutdown throws if result isn't an i32", () => {
      const mock = makeMockExecutor([{ kind: "ptr", value: 0n }]);
      expect(() => new Ros2Driver().bind(mock).shutdown(CTX)).toThrow(/expected i32/);
    });
  });

  describe("DriverRegistry integration", () => {
    beforeEach(() => { DriverRegistry._resetForTests(); });

    it("auto-registers with id 'ros2' on import", async () => {
      await import("../../../src/ffi/drivers/ros2/ros2-driver.js");
      const { DriverRegistry: DR } = await import("../../../src/ffi/native/driver-registry.js");
      DR._resetForTests();
      const { Ros2Driver: Drv } = await import("../../../src/ffi/drivers/ros2/ros2-driver.js");
      expect(new Drv().descriptor.name).toBe("ROS2 (rclc)");
    });

    it("declares the expected capabilities", () => {
      DriverRegistry.register({
        metadata: {
          id: "ros2",
          name: "ROS2 (rclc)",
          versionPolicy: { kind: "minimum", minimum: "3.0.0" },
          capabilities: ["NODE", "PUBLISHER", "SUBSCRIBER", "TIMER", "SERVICE"],
          description: "test",
        },
        factory: (path?: string) => new Ros2Driver(path),
      });
      expect(DriverRegistry.hasCapability("ros2", "NODE")).toBe(true);
      expect(DriverRegistry.hasCapability("ros2", "SERVICE")).toBe(true);
      expect(DriverRegistry.hasCapability("ros2", "MODEL_LOAD")).toBe(false);
    });
  });
});
