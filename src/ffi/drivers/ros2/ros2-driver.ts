// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: ROS2 (rclc)
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// ROS2 driver implementing INativeDriver<Ros2Api>.
// Wraps the rclc C API — the C-compatible subset of the ROS2 client library.
// Using rclc avoids the C++ ABI complexity of rclcpp while still providing
// Node, Publisher, Subscriber, Timer, and Service primitives.
//
// Capability coverage:
//   NODE        — rclc_node_init_default
//   PUBLISHER   — rclc_publisher_init_default
//   SUBSCRIBER  — rclc_subscription_init_default
//   TIMER       — rclc_timer_init_default
//   SERVICE     — rclc_service_init_default
//
// ABI note:
//   rclc exposes a pure C API. No name-mangling adapter needed. All symbols
//   are directly callable via dlopen/dlsym in the same way as SQLite3.
//   Requires ROS2 Humble (or later) to be installed in the environment.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
} from "../../native/types.js";

import { DriverRegistry } from "../../native/driver-registry.js";

// ── ROS2 return codes ──────────────────────────────────────────────────────────

export const RCL_RET_OK    = 0;
export const RCL_RET_ERROR = 1;

// ── Opaque handles ─────────────────────────────────────────────────────────────

export type RclContextHandle     = bigint;
export type RclNodeHandle        = bigint;
export type RclPublisherHandle   = bigint;
export type RclSubscriptionHandle = bigint;
export type RclTimerHandle       = bigint;
export type RclServiceHandle     = bigint;
export type RclcExecutorHandle   = bigint;

// ── Typed ROS2 API ─────────────────────────────────────────────────────────────

export type Ros2Version = {
  major: number;
  minor: number;
  patch: number;
};

export type NodeOptions = {
  namespace: string;
};

export type Ros2Api = {
  // Version
  version(): Ros2Version;

  // Lifecycle
  init(): RclContextHandle;
  shutdown(context: RclContextHandle): number;

  // Node
  createNode(context: RclContextHandle, name: string, options?: NodeOptions): RclNodeHandle;
  destroyNode(node: RclNodeHandle): number;

  // Publisher
  createPublisher(node: RclNodeHandle, topicName: string, qosDepth: number): RclPublisherHandle;
  publish(publisher: RclPublisherHandle, message: string): number;
  destroyPublisher(publisher: RclPublisherHandle): number;

  // Subscriber
  createSubscription(node: RclNodeHandle, topicName: string, qosDepth: number): RclSubscriptionHandle;
  takeMessage(subscription: RclSubscriptionHandle): string | null;
  destroySubscription(subscription: RclSubscriptionHandle): number;

  // Timer
  createTimer(node: RclNodeHandle, periodMs: number): RclTimerHandle;
  timerIsReady(timer: RclTimerHandle): boolean;
  timerCallOrSkip(timer: RclTimerHandle): boolean;
  destroyTimer(timer: RclTimerHandle): number;

  // Service
  createService(node: RclNodeHandle, serviceName: string): RclServiceHandle;
  serviceTakeRequest(service: RclServiceHandle): string | null;
  serviceSendResponse(service: RclServiceHandle, response: string): number;
  destroyService(service: RclServiceHandle): number;

  // Executor (minimal spin)
  createExecutor(context: RclContextHandle, maxHandles: number): RclcExecutorHandle;
  addTimer(executor: RclcExecutorHandle, timer: RclTimerHandle): number;
  addSubscription(executor: RclcExecutorHandle, subscription: RclSubscriptionHandle): number;
  spinSome(executor: RclcExecutorHandle, timeoutMs: number): number;
  destroyExecutor(executor: RclcExecutorHandle): number;
};

// ── Helper: extract typed result values ───────────────────────────────────────

function i32(r: NativeCallResult | undefined, ctx: string): number {
  if (!r || r.kind !== "i32") throw new Error(`${ctx}: expected i32, got ${r?.kind}`);
  return r.value;
}
function ptr(r: NativeCallResult | undefined, ctx: string): bigint {
  if (!r || r.kind !== "ptr") throw new Error(`${ctx}: expected ptr, got ${r?.kind}`);
  return r.value;
}
function str(r: NativeCallResult | undefined, ctx: string): string {
  if (!r || r.kind !== "str") throw new Error(`${ctx}: expected str, got ${r?.kind}`);
  return r.value;
}

// ── Ros2Driver ────────────────────────────────────────────────────────────────

export class Ros2Driver implements INativeDriver<Ros2Api> {
  readonly descriptor: NativeLibraryDescriptor;

  constructor(libraryPath = "/opt/ros/humble/lib/librclc.so") {
    this.descriptor = {
      name: "ROS2 (rclc)",
      libraryPath,
      versionSymbol: "__ur_rcl_version_string",
      versionExtractor: (r) => (r.kind === "str" ? r.value : ""),
    };
  }

  bind(executor: { execute(calls: NativeCall[]): NativeCallResult[] }): Ros2Api {
    const exec = (calls: NativeCall[]) => executor.execute(calls);
    const one = (call: NativeCall) => exec([call])[0];

    return {
      version: () => {
        const results = exec([
          { symbol: "__ur_rcl_version_major", args: [], returnKind: "i32" },
          { symbol: "__ur_rcl_version_minor", args: [], returnKind: "i32" },
          { symbol: "__ur_rcl_version_patch", args: [], returnKind: "i32" },
        ]);
        return {
          major: i32(results[0], "version.major"),
          minor: i32(results[1], "version.minor"),
          patch: i32(results[2], "version.patch"),
        };
      },

      init: () =>
        ptr(
          one({ symbol: "__ur_rcl_init", args: [], returnKind: "ptr" }),
          "init",
        ),

      shutdown: (context) =>
        i32(
          one({ symbol: "__ur_rcl_shutdown", args: [{ kind: "ptr", value: context }], returnKind: "i32" }),
          "shutdown",
        ),

      createNode: (context, name, options) => {
        const ns = options?.namespace ?? "";
        return ptr(
          one({ symbol: "__ur_rclc_node_init", args: [{ kind: "ptr", value: context }, { kind: "str", value: name }, { kind: "str", value: ns }], returnKind: "ptr" }),
          "createNode",
        );
      },

      destroyNode: (node) =>
        i32(
          one({ symbol: "__ur_rcl_node_fini", args: [{ kind: "ptr", value: node }], returnKind: "i32" }),
          "destroyNode",
        ),

      createPublisher: (node, topicName, qosDepth) =>
        ptr(
          one({ symbol: "__ur_rclc_publisher_init", args: [{ kind: "ptr", value: node }, { kind: "str", value: topicName }, { kind: "i32", value: qosDepth }], returnKind: "ptr" }),
          "createPublisher",
        ),

      publish: (publisher, message) =>
        i32(
          one({ symbol: "__ur_rcl_publish", args: [{ kind: "ptr", value: publisher }, { kind: "str", value: message }], returnKind: "i32" }),
          "publish",
        ),

      destroyPublisher: (publisher) =>
        i32(
          one({ symbol: "__ur_rcl_publisher_fini", args: [{ kind: "ptr", value: publisher }], returnKind: "i32" }),
          "destroyPublisher",
        ),

      createSubscription: (node, topicName, qosDepth) =>
        ptr(
          one({ symbol: "__ur_rclc_subscription_init", args: [{ kind: "ptr", value: node }, { kind: "str", value: topicName }, { kind: "i32", value: qosDepth }], returnKind: "ptr" }),
          "createSubscription",
        ),

      takeMessage: (subscription) => {
        const r = one({ symbol: "__ur_rcl_take", args: [{ kind: "ptr", value: subscription }], returnKind: "str" });
        if (!r || r.kind === "error" || r.kind === "void") return null;
        if (r.kind === "str") return r.value || null;
        return null;
      },

      destroySubscription: (subscription) =>
        i32(
          one({ symbol: "__ur_rcl_subscription_fini", args: [{ kind: "ptr", value: subscription }], returnKind: "i32" }),
          "destroySubscription",
        ),

      createTimer: (node, periodMs) =>
        ptr(
          one({ symbol: "__ur_rclc_timer_init", args: [{ kind: "ptr", value: node }, { kind: "i32", value: periodMs }], returnKind: "ptr" }),
          "createTimer",
        ),

      timerIsReady: (timer) => {
        const rc = i32(
          one({ symbol: "__ur_rcl_timer_is_ready", args: [{ kind: "ptr", value: timer }], returnKind: "i32" }),
          "timerIsReady",
        );
        return rc !== 0;
      },

      timerCallOrSkip: (timer) => {
        const rc = i32(
          one({ symbol: "__ur_rcl_timer_call", args: [{ kind: "ptr", value: timer }], returnKind: "i32" }),
          "timerCallOrSkip",
        );
        return rc === RCL_RET_OK;
      },

      destroyTimer: (timer) =>
        i32(
          one({ symbol: "__ur_rcl_timer_fini", args: [{ kind: "ptr", value: timer }], returnKind: "i32" }),
          "destroyTimer",
        ),

      createService: (node, serviceName) =>
        ptr(
          one({ symbol: "__ur_rclc_service_init", args: [{ kind: "ptr", value: node }, { kind: "str", value: serviceName }], returnKind: "ptr" }),
          "createService",
        ),

      serviceTakeRequest: (service) => {
        const r = one({ symbol: "__ur_rcl_take_request", args: [{ kind: "ptr", value: service }], returnKind: "str" });
        if (!r || r.kind === "error" || r.kind === "void") return null;
        if (r.kind === "str") return r.value || null;
        return null;
      },

      serviceSendResponse: (service, response) =>
        i32(
          one({ symbol: "__ur_rcl_send_response", args: [{ kind: "ptr", value: service }, { kind: "str", value: response }], returnKind: "i32" }),
          "serviceSendResponse",
        ),

      destroyService: (service) =>
        i32(
          one({ symbol: "__ur_rcl_service_fini", args: [{ kind: "ptr", value: service }], returnKind: "i32" }),
          "destroyService",
        ),

      createExecutor: (context, maxHandles) =>
        ptr(
          one({ symbol: "__ur_rclc_executor_init", args: [{ kind: "ptr", value: context }, { kind: "i32", value: maxHandles }], returnKind: "ptr" }),
          "createExecutor",
        ),

      addTimer: (executor, timer) =>
        i32(
          one({ symbol: "__ur_rclc_executor_add_timer", args: [{ kind: "ptr", value: executor }, { kind: "ptr", value: timer }], returnKind: "i32" }),
          "addTimer",
        ),

      addSubscription: (executor, subscription) =>
        i32(
          one({ symbol: "__ur_rclc_executor_add_subscription", args: [{ kind: "ptr", value: executor }, { kind: "ptr", value: subscription }], returnKind: "i32" }),
          "addSubscription",
        ),

      spinSome: (executor, timeoutMs) =>
        i32(
          one({ symbol: "__ur_rclc_executor_spin_some", args: [{ kind: "ptr", value: executor }, { kind: "i32", value: timeoutMs }], returnKind: "i32" }),
          "spinSome",
        ),

      destroyExecutor: (executor) =>
        i32(
          one({ symbol: "__ur_rclc_executor_fini", args: [{ kind: "ptr", value: executor }], returnKind: "i32" }),
          "destroyExecutor",
        ),
    };
  }
}

// ── Auto-register in the Driver Registry ──────────────────────────────────────

DriverRegistry.register<Ros2Api>({
  metadata: {
    id: "ros2",
    name: "ROS2 (rclc)",
    versionPolicy: { kind: "minimum", minimum: "3.0.0" },
    capabilities: ["NODE", "PUBLISHER", "SUBSCRIBER", "TIMER", "SERVICE"],
    description:
      "ROS2 robotics driver via rclc C API. Covers node lifecycle, " +
      "publisher, subscriber, timer, and service primitives. " +
      "Requires ROS2 Humble or later.",
    docs: "https://docs.ros.org/en/humble/",
  },
  factory: (libraryPath) => new Ros2Driver(libraryPath),
});
