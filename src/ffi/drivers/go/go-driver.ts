// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: Go (real shared-library FFI, not subprocess-per-call)
// ─────────────────────────────────────────────────────────────────────────────
//
// REAL, DISCLOSED LIMITATION (per direct instruction: no code claimed to
// work without proof): this driver was written against the exact same
// real interface (INativeDriver, NativeFfiLoader, IPlatformExecutor) the
// Python/Rust drivers use, and its own compile step uses real, standard
// `go build -buildmode=c-shared` (Go's own, real, documented mechanism
// for producing a C-ABI-compatible shared library other languages can
// dlopen) - not invented here. HOWEVER: this project's own development
// sandbox has no `go` toolchain installed (confirmed directly: `go
// version` -> command not found; `apt-get install golang` also failed,
// 403 Forbidden, network-restricted). This driver's own compile step and
// every downstream call therefore COULD NOT be executed even once in
// this sandbox. This is disclosed here explicitly, not hidden - this is
// real, written-against-the-real-interface code, NOT yet a
// runtime-verified driver. See docs/architecture/FFI_STATUS.md for the
// same honest status stated in one place.
//
// Real architectural difference from the simpler call_external/Manifest
// "go" runtime (src/interpreter/interpret.ts): that mechanism spawns a
// real `go run` subprocess PER CALL (real, but with real subprocess
// startup cost every time). THIS driver compiles the Go source ONCE
// (via go build -buildmode=c-shared) into a real shared library, then
// loads it via the existing, already-tested dlopen infrastructure - all
// subsequent calls are real, direct C-ABI calls, no subprocess spawned
// per call, matching the Python/Rust drivers' own real architecture.

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  INativeDriver,
  NativeLibraryDescriptor,
  NativeCallResult,
  NativeCall,
} from "../../native/types.js";

export type GoApi = {
  /**
   * Calls a real, exported Go function (declared with `//export FuncName`
   * in the real Go source given to compileGoSharedLibrary) with a single
   * int64 argument, returning its own real int64 result - the same
   * minimal, real, single-argument-single-result contract the C driver's
   * own first real implementation started with.
   */
  callInt64Function(funcName: string, arg: bigint): bigint;
};

/**
 * Real compilation step: writes the given real Go source to a real .go
 * file, then invokes the real `go build -buildmode=c-shared` command
 * (Go's own, standard, documented way to produce a real C-ABI shared
 * library) to produce a real .so/.dll/.dylib the existing dlopen
 * infrastructure can load. Throws a real, specific error (naming the
 * real reason) if `go` itself is not installed - never silently
 * returns a fake/placeholder result.
 */
export function compileGoSharedLibrary(goSource: string, exportedFuncNames: readonly string[]): { libraryPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "ur-go-driver-"));
  const goFilePath = join(dir, "lib.go");
  const platformExt = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
  const libPath = join(dir, `lib.${platformExt}`);

  // Real, minimal wrapper requirements for `-buildmode=c-shared`: the
  // Go source must be `package main`, must `import "C"`, must mark each
  // exported function with a real `//export Name` comment immediately
  // above it, and must have a real (even if empty) `func main() {}`.
  writeFileSync(goFilePath, goSource);

  for (const name of exportedFuncNames) {
    if (!goSource.includes(`//export ${name}`)) {
      throw new Error(`Go driver: claimed export '${name}' has no matching '//export ${name}' annotation in the given Go source - go build would silently not export it`);
    }
  }

  const result = spawnSync("go", ["build", "-buildmode=c-shared", "-o", libPath, goFilePath], { encoding: "utf-8" });
  if (result.error) {
    throw new Error(`Go driver: could not compile shared library - go toolchain not found: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Go driver: go build failed:\n${result.stderr}`);
  }
  if (!existsSync(libPath)) {
    throw new Error(`Go driver: go build reported success but produced no library file at ${libPath}`);
  }
  return { libraryPath: libPath };
}

export class GoDriver implements INativeDriver<GoApi> {
  readonly descriptor: NativeLibraryDescriptor;

  /**
   * @param goSource Real, complete Go source (package main, import "C",
   *   //export-annotated functions, empty func main(){}) to compile.
   * @param exportedFuncNames The real names marked with //export in goSource.
   */
  constructor(goSource: string, exportedFuncNames: readonly string[]) {
    const { libraryPath } = compileGoSharedLibrary(goSource, exportedFuncNames);
    this.descriptor = {
      name: "Go (compiled shared library)",
      libraryPath,
    };
  }

  bind(loader: { execute(calls: NativeCall[]): NativeCallResult[] }): GoApi {
    return {
      callInt64Function(funcName: string, arg: bigint): bigint {
        const results = loader.execute([
          { symbol: funcName, args: [{ kind: "i64", value: arg }], returnKind: "i64" },
        ]);
        const result = results[0];
        if (!result) {
          throw new Error(`Go driver: call to '${funcName}' produced no result`);
        }
        if (result.kind === "error") {
          throw new Error(`Go driver: call to '${funcName}' failed: ${result.message}`);
        }
        if (result.kind !== "i64") {
          throw new Error(`Go driver: call to '${funcName}' returned unexpected kind '${result.kind}', expected 'i64'`);
        }
        return result.value;
      },
    };
  }
}
