// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm Native Package Integration
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
// Extends urpm with native library support: install, resolve, ABI version check.

import type { AbiModule, AbiVersion } from "../abi/types.js";
import { checkAbiCompatibility, abiVersionToString, isAbiBackwardCompatible } from "../abi/versioning.js";

// ── Native Package Manifest ────────────────────────────────────────────────

export type NativeLibFormat = "static" | "dynamic" | "wasm-import";

export type NativePlatformTarget = {
  os: "linux" | "macos" | "windows" | "wasm";
  arch: "x64" | "arm64" | "wasm32";
  libc?: "glibc" | "musl";
};

export type NativeLibArtifact = {
  platform: NativePlatformTarget;
  filename: string;        // e.g. "libopencv_core.so.4.9"
  format: NativeLibFormat;
  sha256: string;
  downloadUrl: string;
  sizeBytes: number;
};

export type NativePackageManifest = {
  name: string;            // e.g. "opencv"
  version: string;         // semver
  abiModule: AbiModule;    // frozen ABI descriptor
  artifacts: NativeLibArtifact[];
  headerSources: string[]; // original .h files (for regeneration)
  bindingPath: string;     // path to generated .ur binding file
  license: string;
  homepage: string;
};

// ── Package Registry ───────────────────────────────────────────────────────

export type NativeRegistryEntry = {
  name: string;
  versions: NativePackageVersion[];
  latest: string;
};

export type NativePackageVersion = {
  version: string;
  abiVersion: AbiVersion;
  manifestUrl: string;
};

// ── Installed Package Database ─────────────────────────────────────────────

export type InstalledNativePackage = {
  name: string;
  version: string;
  abiVersion: AbiVersion;
  abiModule: AbiModule;     // full ABI snapshot at install time, needed for upgrade compatibility checks
  installPath: string;
  artifacts: InstalledArtifact[];
  bindingPath: string;
  installedAt: string; // ISO date
};

export type InstalledArtifact = {
  filename: string;
  format: NativeLibFormat;
  platform: NativePlatformTarget;
  resolvedPath: string;
};

export type NativePackageDb = {
  packages: Map<string, InstalledNativePackage>;
};

export function makeNativePackageDb(): NativePackageDb {
  return { packages: new Map() };
}

// ── ABI Compatibility Resolution ───────────────────────────────────────────

export type NativeResolutionResult =
  | { ok: true;  installed: InstalledNativePackage }
  | { ok: false; error: NativeResolutionError };

export type NativeResolutionError =
  | { kind: "not_installed";     name: string }
  | { kind: "abi_incompatible";  name: string; required: AbiVersion; installed: AbiVersion; breakages: string[] }
  | { kind: "version_too_old";   name: string; required: string; installed: string }
  | { kind: "platform_mismatch"; name: string; required: NativePlatformTarget };

export function resolveNativePackage(
  db: NativePackageDb,
  name: string,
  requiredAbi: AbiModule,
  platform: NativePlatformTarget
): NativeResolutionResult {
  const installed = db.packages.get(name);
  if (!installed) return { ok: false, error: { kind: "not_installed", name } };

  // Check ABI backward compatibility
  if (!isAbiBackwardCompatible(requiredAbi.version, installed.abiVersion)) {
    return {
      ok: false,
      error: {
        kind: "abi_incompatible",
        name,
        required: requiredAbi.version,
        installed: installed.abiVersion,
        breakages: [`installed ABI ${abiVersionToString(installed.abiVersion)} is older than required ${abiVersionToString(requiredAbi.version)}`],
      },
    };
  }

  // Check platform artifact exists
  const artifact = installed.artifacts.find(
    a =>
      a.platform.os === platform.os &&
      a.platform.arch === platform.arch
  );

  if (!artifact) {
    return { ok: false, error: { kind: "platform_mismatch", name, required: platform } };
  }

  return { ok: true, installed };
}

// ── Linker flags generator ─────────────────────────────────────────────────

export type LinkerFlags = {
  linkArgs: string[];    // e.g. ["-lopencv_core", "-L/usr/lib"]
  rpaths: string[];      // runtime library paths
  staticLibs: string[];  // .a files to link directly
};

export function generateLinkerFlags(
  packages: InstalledNativePackage[],
  platform: NativePlatformTarget
): LinkerFlags {
  const linkArgs: string[] = [];
  const rpaths: string[] = [];
  const staticLibs: string[] = [];

  for (const pkg of packages) {
    const artifact = pkg.artifacts.find(
      a => a.platform.os === platform.os && a.platform.arch === platform.arch
    );
    if (!artifact) continue;

    const dir = artifact.resolvedPath.split("/").slice(0, -1).join("/");

    switch (artifact.format) {
      case "dynamic":
        linkArgs.push(`-L${dir}`);
        // strip "lib" prefix and extension to get -l name
        const libName = artifact.filename
          .replace(/^lib/, "")
          .replace(/\.(so|dylib|dll).*$/, "");
        linkArgs.push(`-l${libName}`);
        rpaths.push(dir);
        break;
      case "static":
        staticLibs.push(artifact.resolvedPath);
        break;
      case "wasm-import":
        // WASM imports are handled at module instantiation time
        break;
    }
  }

  return { linkArgs, rpaths, staticLibs };
}

// ── urpm install plan ──────────────────────────────────────────────────────

export type NativeInstallPlan = {
  toInstall: NativePackageManifest[];
  toUpgrade: Array<{ from: InstalledNativePackage; to: NativePackageManifest }>;
  toRemove: InstalledNativePackage[];
  warnings: string[];
};

export function planNativeInstall(
  requested: NativePackageManifest[],
  db: NativePackageDb,
  platform: NativePlatformTarget
): NativeInstallPlan {
  const toInstall: NativePackageManifest[] = [];
  const toUpgrade: Array<{ from: InstalledNativePackage; to: NativePackageManifest }> = [];
  const warnings: string[] = [];

  for (const pkg of requested) {
    const existing = db.packages.get(pkg.name);
    if (!existing) {
      // Check platform artifact available
      const hasArtifact = pkg.artifacts.some(
        a => a.platform.os === platform.os && a.platform.arch === platform.arch
      );
      if (!hasArtifact) {
        warnings.push(`${pkg.name}@${pkg.version}: no artifact for ${platform.os}/${platform.arch}`);
        continue;
      }
      toInstall.push(pkg);
    } else {
      // Check if upgrade needed
      if (existing.version !== pkg.version) {
        // Verify ABI compatibility of upgrade: does the NEW module preserve
        // every symbol the OLD module published?
        const compat = checkAbiCompatibility(existing.abiModule, pkg.abiModule);
        if (!compat.compatible) {
          warnings.push(
            `${pkg.name}: upgrade from ${existing.version} → ${pkg.version} has ${compat.breaking.length} ABI breaking change(s) — manual review required`
          );
        }
        toUpgrade.push({ from: existing, to: pkg });
      }
    }
  }

  return { toInstall, toUpgrade, toRemove: [], warnings };
}

// ── Pre-built bindings for common libraries ────────────────────────────────

export type WellKnownLibrary =
  | "opencv"
  | "sqlite3"
  | "onnxruntime"
  | "ros2_rclc"
  | "llvm_c";

export type WellKnownLibraryInfo = {
  name: string;
  headerPattern: string;  // glob
  linkName: string;
  description: string;
  homepage: string;
};

export const WELL_KNOWN_LIBRARIES: Record<WellKnownLibrary, WellKnownLibraryInfo> = {
  opencv: {
    name: "opencv",
    headerPattern: "opencv2/**/*.hpp",
    linkName: "opencv_core",
    description: "OpenCV computer vision library",
    homepage: "https://opencv.org",
  },
  sqlite3: {
    name: "sqlite3",
    headerPattern: "sqlite3.h",
    linkName: "sqlite3",
    description: "SQLite embedded database",
    homepage: "https://sqlite.org",
  },
  onnxruntime: {
    name: "onnxruntime",
    headerPattern: "onnxruntime_c_api.h",
    linkName: "onnxruntime",
    description: "ONNX Runtime inference engine",
    homepage: "https://onnxruntime.ai",
  },
  ros2_rclc: {
    name: "ros2_rclc",
    headerPattern: "rclc/**/*.h",
    linkName: "rclc",
    description: "ROS2 C client library",
    homepage: "https://ros.org",
  },
  llvm_c: {
    name: "llvm_c",
    headerPattern: "llvm-c/**/*.h",
    linkName: "LLVM",
    description: "LLVM C API",
    homepage: "https://llvm.org",
  },
};
