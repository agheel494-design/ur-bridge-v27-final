// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: urpm Native Package Integration
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  makeNativePackageDb,
  resolveNativePackage,
  generateLinkerFlags,
  planNativeInstall,
  WELL_KNOWN_LIBRARIES,
} from "../../src/ffi/urpm-native/native-packages.js";
import type {
  InstalledNativePackage, NativePackageManifest,
  NativePlatformTarget,
} from "../../src/ffi/urpm-native/native-packages.js";
import type { AbiModule } from "../../src/ffi/abi/types.js";
import { CURRENT_ABI_VERSION } from "../../src/ffi/abi/types.js";

const LINUX_X64: NativePlatformTarget = { os: "linux", arch: "x64", libc: "glibc" };
const MACOS_ARM64: NativePlatformTarget = { os: "macos", arch: "arm64" };
const WASM: NativePlatformTarget = { os: "wasm", arch: "wasm32" };

function makeAbiModule(name: string): AbiModule {
  return { name, version: CURRENT_ABI_VERSION, functions: [], types: [], constants: [] };
}

function makeInstalled(name: string, version: string): InstalledNativePackage {
  return {
    name,
    version,
    abiVersion: CURRENT_ABI_VERSION,
    abiModule: makeAbiModule(name),
    installPath: `/usr/local/lib/${name}`,
    bindingPath: `bindings/${name}.ur`,
    installedAt: "2026-01-01T00:00:00Z",
    artifacts: [
      {
        filename: `lib${name}.so.1`,
        format: "dynamic",
        platform: LINUX_X64,
        resolvedPath: `/usr/local/lib/lib${name}.so.1`,
      },
    ],
  };
}

function makeManifest(name: string, version: string): NativePackageManifest {
  return {
    name,
    version,
    abiModule: makeAbiModule(name),
    artifacts: [
      {
        platform: LINUX_X64,
        filename: `lib${name}.so.1`,
        format: "dynamic",
        sha256: "abc123",
        downloadUrl: `https://example.com/${name}.so`,
        sizeBytes: 1024 * 1024,
      },
    ],
    headerSources: [`${name}.h`],
    bindingPath: `bindings/${name}.ur`,
    license: "MIT",
    homepage: `https://${name}.org`,
  };
}

describe("urpm Native — Package DB", () => {
  it("creates empty package database", () => {
    const db = makeNativePackageDb();
    expect(db.packages.size).toBe(0);
  });

  it("can add packages to db", () => {
    const db = makeNativePackageDb();
    db.packages.set("sqlite3", makeInstalled("sqlite3", "3.45.0"));
    expect(db.packages.size).toBe(1);
  });
});

describe("urpm Native — Resolution", () => {
  it("resolves installed package", () => {
    const db = makeNativePackageDb();
    db.packages.set("sqlite3", makeInstalled("sqlite3", "3.45.0"));

    const result = resolveNativePackage(db, "sqlite3", makeAbiModule("sqlite3"), LINUX_X64);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.installed.name).toBe("sqlite3");
    }
  });

  it("fails when package not installed", () => {
    const db = makeNativePackageDb();
    const result = resolveNativePackage(db, "opencv", makeAbiModule("opencv"), LINUX_X64);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_installed");
    }
  });

  it("fails when platform artifact not found", () => {
    const db = makeNativePackageDb();
    db.packages.set("mylib", makeInstalled("mylib", "1.0.0")); // only linux/x64
    const result = resolveNativePackage(db, "mylib", makeAbiModule("mylib"), MACOS_ARM64);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("platform_mismatch");
    }
  });

  it("fails on ABI major version incompatibility", () => {
    const db = makeNativePackageDb();
    const installed = makeInstalled("mylib", "1.0.0");
    installed.abiVersion = { major: 2, minor: 0, patch: 0 }; // newer than required
    db.packages.set("mylib", installed);

    const requiredModule: AbiModule = {
      name: "mylib",
      version: { major: 1, minor: 0, patch: 0 }, // requires v1
      functions: [],
      types: [],
      constants: [],
    };

    const result = resolveNativePackage(db, "mylib", requiredModule, LINUX_X64);
    // installed is v2, required is v1 — different major = incompatible
    expect(result.ok).toBe(false);
  });
  it("resolves multiple packages independently", () => {
    const db = makeNativePackageDb();
    db.packages.set("sqlite3", makeInstalled("sqlite3", "3.45.0"));
    db.packages.set("zlib", makeInstalled("zlib", "1.3.0"));

    expect(resolveNativePackage(db, "sqlite3", makeAbiModule("sqlite3"), LINUX_X64).ok).toBe(true);
    expect(resolveNativePackage(db, "zlib", makeAbiModule("zlib"), LINUX_X64).ok).toBe(true);
    expect(resolveNativePackage(db, "missing", makeAbiModule("missing"), LINUX_X64).ok).toBe(false);
  });
});

describe("urpm Native — Linker flags", () => {
  it("generates -L and -l flags for dynamic libs", () => {
    const pkg = makeInstalled("sqlite3", "3.45.0");
    const flags = generateLinkerFlags([pkg], LINUX_X64);
    expect(flags.linkArgs.some(a => a.startsWith("-L"))).toBe(true);
    expect(flags.linkArgs.some(a => a === "-lsqlite3")).toBe(true);
  });

  it("generates rpath for dynamic libs", () => {
    const pkg = makeInstalled("zlib", "1.3.0");
    const flags = generateLinkerFlags([pkg], LINUX_X64);
    expect(flags.rpaths.length).toBeGreaterThan(0);
  });

  it("generates static lib path for static format", () => {
    const pkg = makeInstalled("mylib", "1.0.0");
    // Override artifact to static
    pkg.artifacts[0]!.format = "static";
    pkg.artifacts[0]!.filename = "libmylib.a";
    const flags = generateLinkerFlags([pkg], LINUX_X64);
    expect(flags.staticLibs.length).toBeGreaterThan(0);
    expect(flags.staticLibs[0]).toContain("libmylib");
  });

  it("no flags for wasm-import format", () => {
    const pkg = makeInstalled("mylib", "1.0.0");
    pkg.artifacts[0]!.format = "wasm-import";
    const flags = generateLinkerFlags([pkg], LINUX_X64);
    expect(flags.linkArgs).toHaveLength(0);
    expect(flags.staticLibs).toHaveLength(0);
  });

  it("skips packages without matching platform artifact", () => {
    const pkg = makeInstalled("linux_only", "1.0.0"); // linux/x64 only
    const flags = generateLinkerFlags([pkg], MACOS_ARM64);
    expect(flags.linkArgs).toHaveLength(0);
  });

  it("combines flags from multiple packages", () => {
    const sqlite = makeInstalled("sqlite3", "3.45.0");
    const zlib = makeInstalled("zlib", "1.3.0");
    const flags = generateLinkerFlags([sqlite, zlib], LINUX_X64);
    expect(flags.linkArgs.filter(a => a.startsWith("-l")).length).toBe(2);
  });
});

describe("urpm Native — Install planner", () => {
  it("plans fresh install of new package", () => {
    const db = makeNativePackageDb();
    const manifest = makeManifest("opencv", "4.9.0");
    const plan = planNativeInstall([manifest], db, LINUX_X64);
    expect(plan.toInstall).toHaveLength(1);
    expect(plan.toInstall[0]!.name).toBe("opencv");
    expect(plan.toUpgrade).toHaveLength(0);
  });

  it("plans upgrade when version differs", () => {
    const db = makeNativePackageDb();
    db.packages.set("sqlite3", makeInstalled("sqlite3", "3.44.0"));
    const manifest = makeManifest("sqlite3", "3.45.0");
    const plan = planNativeInstall([manifest], db, LINUX_X64);
    expect(plan.toInstall).toHaveLength(0);
    expect(plan.toUpgrade).toHaveLength(1);
    expect(plan.toUpgrade[0]!.from.version).toBe("3.44.0");
    expect(plan.toUpgrade[0]!.to.version).toBe("3.45.0");
  });

  it("skips already installed same version", () => {
    const db = makeNativePackageDb();
    db.packages.set("zlib", makeInstalled("zlib", "1.3.0"));
    const manifest = makeManifest("zlib", "1.3.0");
    const plan = planNativeInstall([manifest], db, LINUX_X64);
    expect(plan.toInstall).toHaveLength(0);
    expect(plan.toUpgrade).toHaveLength(0);
  });

  it("warns when no artifact for platform", () => {
    const db = makeNativePackageDb();
    const manifest = makeManifest("linux_only", "1.0.0");
    const plan = planNativeInstall([manifest], db, MACOS_ARM64);
    expect(plan.toInstall).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings[0]).toContain("macos");
  });

  it("handles multiple packages in one plan", () => {
    const db = makeNativePackageDb();
    const manifests = ["opencv", "sqlite3", "zlib"].map(n => makeManifest(n, "1.0.0"));
    const plan = planNativeInstall(manifests, db, LINUX_X64);
    expect(plan.toInstall).toHaveLength(3);
  });
});

describe("urpm Native — Well-known libraries", () => {
  it("has opencv entry", () => {
    expect(WELL_KNOWN_LIBRARIES.opencv).toBeDefined();
    expect(WELL_KNOWN_LIBRARIES.opencv.linkName).toBe("opencv_core");
  });

  it("has sqlite3 entry", () => {
    expect(WELL_KNOWN_LIBRARIES.sqlite3).toBeDefined();
    expect(WELL_KNOWN_LIBRARIES.sqlite3.linkName).toBe("sqlite3");
  });

  it("has onnxruntime entry", () => {
    expect(WELL_KNOWN_LIBRARIES.onnxruntime).toBeDefined();
    expect(WELL_KNOWN_LIBRARIES.onnxruntime.linkName).toBe("onnxruntime");
  });

  it("has ros2_rclc entry", () => {
    expect(WELL_KNOWN_LIBRARIES.ros2_rclc).toBeDefined();
    expect(WELL_KNOWN_LIBRARIES.ros2_rclc.name).toBe("ros2_rclc");
  });

  it("has llvm_c entry", () => {
    expect(WELL_KNOWN_LIBRARIES.llvm_c).toBeDefined();
    expect(WELL_KNOWN_LIBRARIES.llvm_c.linkName).toBe("LLVM");
  });

  it("all entries have homepage", () => {
    for (const [, info] of Object.entries(WELL_KNOWN_LIBRARIES)) {
      expect(info.homepage).toMatch(/^https?:\/\//);
    }
  });
});
