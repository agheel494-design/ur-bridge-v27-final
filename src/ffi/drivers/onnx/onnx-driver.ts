// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: ONNX Runtime
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// ONNX Runtime driver implementing INativeDriver<OnnxApi>.
// Wraps the ONNX Runtime C API (onnxruntime_c_api.h) via a thin C adapter
// that flattens the OrtApi vtable into discrete callable symbols — the same
// pattern used for C++ bindings in Phase 7.
//
// Capability coverage:
//   MODEL_LOAD      — OrtCreateSession from an .onnx file
//   SESSION_CREATE  — OrtCreateEnv + OrtCreateSession
//   TENSOR_INPUT    — OrtCreateTensorWithDataAsOrtValue
//   TENSOR_OUTPUT   — OrtGetTensorMutableData
//   CPU_EXECUTION   — OrtSessionOptionsAppendExecutionProvider_CPU
//
// ABI note:
//   ONNX Runtime uses a versioned C API through OrtGetApiBase(). The adapter
//   retrieves the latest API pointer once and caches it. All subsequent calls
//   go through the cached api pointer, not through OrtGetApiBase() each time.
//   The OrtGetApiBase symbol is confirmed present via `nm libonnxruntime.so`.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
} from "../../native/types.js";

import { DriverRegistry } from "../../native/driver-registry.js";

// ── ONNX Runtime element types (mirror of onnxruntime_c_api.h) ───────────────

export const ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT  = 1;
export const ONNX_TENSOR_ELEMENT_DATA_TYPE_DOUBLE = 11;
export const ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32  = 6;
export const ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64  = 7;
export const ONNX_TENSOR_ELEMENT_DATA_TYPE_STRING = 8;

// ── Opaque handles ─────────────────────────────────────────────────────────────

export type OrtEnvHandle     = bigint;
export type OrtSessionHandle = bigint;
export type OrtValueHandle   = bigint;

// ── Typed ONNX API ─────────────────────────────────────────────────────────────

export type OnnxVersion = {
  apiVersion: number;
  runtimeVersion: string;
};

export type SessionInputInfo = {
  count: number;
  names: string[];
};

export type SessionOutputInfo = {
  count: number;
  names: string[];
};

export type TensorShape = {
  dims: number[];
  elementType: number;
};

export type RunResult = {
  outputs: OrtValueHandle[];
};

export type OnnxApi = {
  // Environment lifecycle
  createEnv(logLevel: number, logId: string): OrtEnvHandle;
  releaseEnv(env: OrtEnvHandle): void;

  // Session lifecycle
  createSession(env: OrtEnvHandle, modelPath: string): OrtSessionHandle;
  releaseSession(session: OrtSessionHandle): void;

  // Session introspection
  getInputInfo(session: OrtSessionHandle): SessionInputInfo;
  getOutputInfo(session: OrtSessionHandle): SessionOutputInfo;

  // Tensor I/O
  createFloatTensor(data: number[], shape: number[]): OrtValueHandle;
  createInt64Tensor(data: bigint[], shape: number[]): OrtValueHandle;
  getTensorShape(value: OrtValueHandle): TensorShape;
  getFloatData(value: OrtValueHandle): number[];
  releaseValue(value: OrtValueHandle): void;

  // Inference
  run(
    session: OrtSessionHandle,
    inputNames: string[],
    inputs: OrtValueHandle[],
    outputNames: string[],
  ): RunResult;

  // Version
  version(): OnnxVersion;
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

// ── OnnxDriver ────────────────────────────────────────────────────────────────

export class OnnxDriver implements INativeDriver<OnnxApi> {
  readonly descriptor: NativeLibraryDescriptor;

  constructor(libraryPath = "/usr/lib/libonnxruntime.so") {
    this.descriptor = {
      name: "ONNX Runtime",
      libraryPath,
      versionSymbol: "__ur_onnx_runtime_version",
      versionExtractor: (r) => (r.kind === "str" ? r.value : ""),
    };
  }

  bind(executor: { execute(calls: NativeCall[]): NativeCallResult[] }): OnnxApi {
    const exec = (calls: NativeCall[]) => executor.execute(calls);
    const one = (call: NativeCall) => exec([call])[0];

    return {
      version: () => {
        const vStr = str(
          one({ symbol: "__ur_onnx_runtime_version", args: [], returnKind: "str" }),
          "version",
        );
        const apiVer = i32(
          one({ symbol: "__ur_onnx_api_version", args: [], returnKind: "i32" }),
          "apiVersion",
        );
        return { apiVersion: apiVer, runtimeVersion: vStr };
      },

      createEnv: (logLevel, logId) =>
        ptr(
          one({ symbol: "__ur_ort_create_env", args: [{ kind: "i32", value: logLevel }, { kind: "str", value: logId }], returnKind: "ptr" }),
          "createEnv",
        ),

      releaseEnv: (env) => {
        exec([{ symbol: "__ur_ort_release_env", args: [{ kind: "ptr", value: env }], returnKind: "void" }]);
      },

      createSession: (env, modelPath) =>
        ptr(
          one({ symbol: "__ur_ort_create_session", args: [{ kind: "ptr", value: env }, { kind: "str", value: modelPath }], returnKind: "ptr" }),
          "createSession",
        ),

      releaseSession: (session) => {
        exec([{ symbol: "__ur_ort_release_session", args: [{ kind: "ptr", value: session }], returnKind: "void" }]);
      },

      getInputInfo: (session) => {
        const count = i32(
          one({ symbol: "__ur_ort_input_count", args: [{ kind: "ptr", value: session }], returnKind: "i32" }),
          "getInputInfo.count",
        );
        const names: string[] = [];
        for (let i = 0; i < count; i++) {
          names.push(str(
            one({ symbol: "__ur_ort_input_name", args: [{ kind: "ptr", value: session }, { kind: "i32", value: i }], returnKind: "str" }),
            `getInputInfo.name[${i}]`,
          ));
        }
        return { count, names };
      },

      getOutputInfo: (session) => {
        const count = i32(
          one({ symbol: "__ur_ort_output_count", args: [{ kind: "ptr", value: session }], returnKind: "i32" }),
          "getOutputInfo.count",
        );
        const names: string[] = [];
        for (let i = 0; i < count; i++) {
          names.push(str(
            one({ symbol: "__ur_ort_output_name", args: [{ kind: "ptr", value: session }, { kind: "i32", value: i }], returnKind: "str" }),
            `getOutputInfo.name[${i}]`,
          ));
        }
        return { count, names };
      },

      createFloatTensor: (data, shape) => {
        // Encode as comma-separated string; the adapter parses it
        const dataStr = data.join(",");
        const shapeStr = shape.join(",");
        return ptr(
          one({ symbol: "__ur_ort_create_float_tensor", args: [{ kind: "str", value: dataStr }, { kind: "str", value: shapeStr }], returnKind: "ptr" }),
          "createFloatTensor",
        );
      },

      createInt64Tensor: (data, shape) => {
        const dataStr = data.map(String).join(",");
        const shapeStr = shape.join(",");
        return ptr(
          one({ symbol: "__ur_ort_create_int64_tensor", args: [{ kind: "str", value: dataStr }, { kind: "str", value: shapeStr }], returnKind: "ptr" }),
          "createInt64Tensor",
        );
      },

      getTensorShape: (value) => {
        const ndim = i32(
          one({ symbol: "__ur_ort_tensor_ndim", args: [{ kind: "ptr", value: value }], returnKind: "i32" }),
          "getTensorShape.ndim",
        );
        const elemType = i32(
          one({ symbol: "__ur_ort_tensor_elem_type", args: [{ kind: "ptr", value: value }], returnKind: "i32" }),
          "getTensorShape.elemType",
        );
        const dims: number[] = [];
        for (let i = 0; i < ndim; i++) {
          dims.push(i32(
            one({ symbol: "__ur_ort_tensor_dim", args: [{ kind: "ptr", value: value }, { kind: "i32", value: i }], returnKind: "i32" }),
            `getTensorShape.dim[${i}]`,
          ));
        }
        return { dims, elementType: elemType };
      },

      getFloatData: (value) => {
        const count = i32(
          one({ symbol: "__ur_ort_tensor_float_count", args: [{ kind: "ptr", value: value }], returnKind: "i32" }),
          "getFloatData.count",
        );
        const csvStr = str(
          one({ symbol: "__ur_ort_tensor_float_csv", args: [{ kind: "ptr", value: value }, { kind: "i32", value: count }], returnKind: "str" }),
          "getFloatData.csv",
        );
        return csvStr.split(",").map(Number);
      },

      releaseValue: (value) => {
        exec([{ symbol: "__ur_ort_release_value", args: [{ kind: "ptr", value: value }], returnKind: "void" }]);
      },

      run: (session, inputNames, inputs, outputNames) => {
        const inputNamesStr = inputNames.join(",");
        const outputNamesStr = outputNames.join(",");

        // Pass each input handle as a separate str-encoded pointer
        const inputHandlesStr = inputs.map(String).join(",");

        const results = exec([
          {
            symbol: "__ur_ort_run",
            args: [
              { kind: "ptr", value: session },
              { kind: "str", value: inputNamesStr },
              { kind: "str", value: inputHandlesStr },
              { kind: "str", value: outputNamesStr },
              { kind: "i32", value: outputNames.length },
            ],
            returnKind: "str",
          },
        ]);

        // Result is a comma-separated list of output pointer addresses
        const ptrCsv = str(results[0], "run.outputs");
        const outputPtrs = ptrCsv
          ? ptrCsv.split(",").filter(Boolean).map(BigInt)
          : [];

        return { outputs: outputPtrs };
      },
    };
  }
}

// ── Auto-register in the Driver Registry ──────────────────────────────────────

DriverRegistry.register<OnnxApi>({
  metadata: {
    id: "onnx-runtime",
    name: "ONNX Runtime",
    versionPolicy: { kind: "minimum", minimum: "1.16.0" },
    capabilities: [
      "MODEL_LOAD",
      "SESSION_CREATE",
      "TENSOR_INPUT",
      "TENSOR_OUTPUT",
      "CPU_EXECUTION",
    ],
    description:
      "ONNX Runtime driver for ML inference. Covers model loading, " +
      "session creation, tensor I/O, and CPU execution provider. " +
      "GPU execution is deferred to a future phase.",
    docs: "https://onnxruntime.ai/docs/api/c/",
  },
  factory: (libraryPath) => new OnnxDriver(libraryPath),
});
