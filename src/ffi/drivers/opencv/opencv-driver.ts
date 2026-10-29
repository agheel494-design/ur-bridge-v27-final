// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: OpenCV
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// OpenCV driver implementing INativeDriver<OpenCvApi>.
// Follows the exact same pattern as Sqlite3Driver so the Generic Loader
// and DriverRegistry can handle it without any OpenCV-specific knowledge.
//
// Capability coverage:
//   MAT_LIFECYCLE   — cv::Mat create / clone / release
//   IMAGE_LOAD      — cv::imread
//   IMAGE_SAVE      — cv::imwrite
//   RESIZE          — cv::resize
//   COLOR_CONVERSION— cv::cvtColor
//   BLUR            — cv::GaussianBlur
//   THRESHOLD       — cv::threshold
//   EDGE_DETECTION  — cv::Canny
//
// Library mapping:
//   libopencv_core    — Mat, basic ops
//   libopencv_imgproc — processing ops (resize, cvtColor, blur, threshold, Canny)
//   libopencv_imgcodecs — imread, imwrite
//
// ABI note:
//   OpenCV uses a C++ API. The driver calls a thin C adapter that wraps the
//   C++ calls and exposes a C-compatible flat interface. This follows the same
//   pattern as the C++ bindings already established in Phase 7.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
} from "../../native/types.js";

import { DriverRegistry } from "../../native/driver-registry.js";

// ── Color conversion codes (mirror of opencv2/imgproc/types.hpp) ──────────────

export const CV_BGR2GRAY  = 6;
export const CV_GRAY2BGR  = 8;
export const CV_BGR2HSV   = 40;
export const CV_HSV2BGR   = 54;
export const CV_BGR2RGB   = 4;
export const CV_BGR2YUV   = 82;

// ── Threshold types ────────────────────────────────────────────────────────────

export const THRESH_BINARY     = 0;
export const THRESH_BINARY_INV = 1;
export const THRESH_TRUNC      = 2;
export const THRESH_TOZERO     = 3;
export const THRESH_OTSU       = 8;

// ── Typed OpenCV API ───────────────────────────────────────────────────────────

export type MatHandle = bigint;  // Opaque pointer to cv::Mat on the heap

export type OpenCvVersion = {
  major: number;
  minor: number;
  patch: number;
  fullString: string;
};

export type MatInfo = {
  rows: number;
  cols: number;
  channels: number;
  depth: number;    // CV_8U=0, CV_32F=5, etc.
  elemSize: number; // bytes per element
};

export type ResizeResult = {
  handle: MatHandle;
  rows: number;
  cols: number;
};

export type ThresholdResult = {
  handle: MatHandle;
  threshold: number;  // effective threshold (may differ from input when OTSU is used)
};

export type OpenCvApi = {
  // Version
  version(): OpenCvVersion;

  // Mat lifecycle
  matCreate(rows: number, cols: number, type: number): MatHandle;
  matClone(src: MatHandle): MatHandle;
  matRelease(mat: MatHandle): void;
  matInfo(mat: MatHandle): MatInfo;

  // Image I/O
  imread(path: string, flags: number): MatHandle;
  imwrite(path: string, mat: MatHandle): boolean;

  // Processing
  resize(src: MatHandle, dstRows: number, dstCols: number): ResizeResult;
  cvtColor(src: MatHandle, code: number): MatHandle;
  gaussianBlur(src: MatHandle, kernelSize: number, sigmaX: number): MatHandle;
  threshold(src: MatHandle, thresh: number, maxVal: number, type: number): ThresholdResult;
  canny(src: MatHandle, threshold1: number, threshold2: number): MatHandle;
};

// ── Helper: extract typed result values ───────────────────────────────────────

function i32(r: NativeCallResult | undefined, ctx: string): number {
  if (!r || r.kind !== "i32") throw new Error(`${ctx}: expected i32, got ${r?.kind}`);
  return r.value;
}
function i64(r: NativeCallResult | undefined, ctx: string): bigint {
  if (!r || r.kind !== "i64") throw new Error(`${ctx}: expected i64, got ${r?.kind}`);
  return r.value;
}
function f64(r: NativeCallResult | undefined, ctx: string): number {
  if (!r || r.kind !== "f64") throw new Error(`${ctx}: expected f64, got ${r?.kind}`);
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

// ── OpenCvDriver ──────────────────────────────────────────────────────────────

export class OpenCvDriver implements INativeDriver<OpenCvApi> {
  readonly descriptor: NativeLibraryDescriptor;

  constructor(libraryPath = "/usr/lib/x86_64-linux-gnu/libopencv_core.so") {
    this.descriptor = {
      name: "OpenCV",
      libraryPath,
      // Version extracted via a C adapter that calls cv::getVersionString()
      versionSymbol: "__ur_opencv_version_string",
      versionExtractor: (r) => (r.kind === "str" ? r.value : ""),
    };
  }

  bind(executor: { execute(calls: NativeCall[]): NativeCallResult[] }): OpenCvApi {
    const exec = (calls: NativeCall[]) => executor.execute(calls);
    const one = (call: NativeCall) => exec([call])[0];

    return {
      version: () => {
        const vStr = str(
          one({ symbol: "__ur_opencv_version_string", args: [], returnKind: "str" }),
          "version",
        );
        // Parse "4.6.0" format
        const parts = vStr.split(".").map(Number);
        return {
          major: parts[0] ?? 0,
          minor: parts[1] ?? 0,
          patch: parts[2] ?? 0,
          fullString: vStr,
        };
      },

      matCreate: (rows, cols, type) =>
        ptr(
          one({ symbol: "__ur_mat_create", args: [{ kind: "i32", value: rows }, { kind: "i32", value: cols }, { kind: "i32", value: type }], returnKind: "ptr" }),
          "matCreate",
        ),

      matClone: (src) =>
        ptr(
          one({ symbol: "__ur_mat_clone", args: [{ kind: "ptr", value: src }], returnKind: "ptr" }),
          "matClone",
        ),

      matRelease: (mat) => {
        exec([{ symbol: "__ur_mat_release", args: [{ kind: "ptr", value: mat }], returnKind: "void" }]);
      },

      matInfo: (mat) => {
        const results = exec([
          { symbol: "__ur_mat_rows",      args: [{ kind: "ptr", value: mat }], returnKind: "i32" },
          { symbol: "__ur_mat_cols",      args: [{ kind: "ptr", value: mat }], returnKind: "i32" },
          { symbol: "__ur_mat_channels",  args: [{ kind: "ptr", value: mat }], returnKind: "i32" },
          { symbol: "__ur_mat_depth",     args: [{ kind: "ptr", value: mat }], returnKind: "i32" },
          { symbol: "__ur_mat_elem_size", args: [{ kind: "ptr", value: mat }], returnKind: "i32" },
        ]);
        return {
          rows:     i32(results[0], "matInfo.rows"),
          cols:     i32(results[1], "matInfo.cols"),
          channels: i32(results[2], "matInfo.channels"),
          depth:    i32(results[3], "matInfo.depth"),
          elemSize: i32(results[4], "matInfo.elemSize"),
        };
      },

      imread: (path, flags) =>
        ptr(
          one({ symbol: "__ur_imread", args: [{ kind: "str", value: path }, { kind: "i32", value: flags }], returnKind: "ptr" }),
          "imread",
        ),

      imwrite: (path, mat) => {
        const rc = i32(
          one({ symbol: "__ur_imwrite", args: [{ kind: "str", value: path }, { kind: "ptr", value: mat }], returnKind: "i32" }),
          "imwrite",
        );
        return rc !== 0;
      },

      resize: (src, dstRows, dstCols) => {
        const results = exec([
          { symbol: "__ur_resize", args: [{ kind: "ptr", value: src }, { kind: "i32", value: dstRows }, { kind: "i32", value: dstCols }], returnKind: "ptr" },
        ]);
        const handle = ptr(results[0], "resize");
        return { handle, rows: dstRows, cols: dstCols };
      },

      cvtColor: (src, code) =>
        ptr(
          one({ symbol: "__ur_cvt_color", args: [{ kind: "ptr", value: src }, { kind: "i32", value: code }], returnKind: "ptr" }),
          "cvtColor",
        ),

      gaussianBlur: (src, kernelSize, sigmaX) =>
        ptr(
          one({ symbol: "__ur_gaussian_blur", args: [{ kind: "ptr", value: src }, { kind: "i32", value: kernelSize }, { kind: "f64", value: sigmaX }], returnKind: "ptr" }),
          "gaussianBlur",
        ),

      threshold: (src, thresh, maxVal, type) => {
        const results = exec([
          { symbol: "__ur_threshold",    args: [{ kind: "ptr", value: src }, { kind: "f64", value: thresh }, { kind: "f64", value: maxVal }, { kind: "i32", value: type }], returnKind: "ptr" },
          { symbol: "__ur_last_thresh",  args: [], returnKind: "f64" },
        ]);
        return {
          handle:    ptr(results[0], "threshold.handle"),
          threshold: f64(results[1], "threshold.effective"),
        };
      },

      canny: (src, threshold1, threshold2) =>
        ptr(
          one({ symbol: "__ur_canny", args: [{ kind: "ptr", value: src }, { kind: "f64", value: threshold1 }, { kind: "f64", value: threshold2 }], returnKind: "ptr" }),
          "canny",
        ),
    };
  }
}

// ── Auto-register in the Driver Registry ──────────────────────────────────────

DriverRegistry.register<OpenCvApi>({
  metadata: {
    id: "opencv",
    name: "OpenCV",
    versionPolicy: { kind: "minimum", minimum: "4.0.0" },
    capabilities: [
      "MAT_LIFECYCLE",
      "IMAGE_LOAD",
      "IMAGE_SAVE",
      "RESIZE",
      "COLOR_CONVERSION",
      "BLUR",
      "THRESHOLD",
      "EDGE_DETECTION",
    ],
    description:
      "Computer vision driver. cv::Mat lifecycle, image I/O (imread/imwrite), " +
      "resize, color conversion, Gaussian blur, threshold, and Canny edge detection.",
    docs: "https://docs.opencv.org/4.x/",
  },
  factory: (libraryPath) => new OpenCvDriver(libraryPath),
});
