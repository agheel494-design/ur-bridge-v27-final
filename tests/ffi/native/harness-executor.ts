// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: HarnessExecutor (Linux/gcc, real execution)
// Phase 7 — Native Ecosystem Hardening
// ─────────────────────────────────────────────────────────────────────────────
//
// Concrete IPlatformExecutor for Linux/macOS. Compiles a minimal C harness
// from the call description using the system gcc, runs it against the real
// shared library, and parses its structured stdout back into TypeScript
// NativeCallResult values.
//
// Lives in tests/ (not src/) because it imports from "node:child_process"
// and "node:fs" — those are not in the src/ tsconfig scope. The src/ loader
// and type abstractions remain fully Node-free.
//
// Every native call that touches a real library in this project flows
// through this executor during testing. This is not simulation — every
// call in the harness is a real dlopen()/dlsym()/call on the real binary.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type {
  IPlatformExecutor,
  NativeLibraryHandle,
  NativeCall,
  NativeCallResult,
  NativeArg,
  Platform,
} from "../../../src/ffi/native/types.js";

export class HarnessExecutor implements IPlatformExecutor {
  readonly platform: Platform = "linux";
  private readonly includePaths: string[];

  constructor(includePaths: string[] = []) {
    this.includePaths = includePaths;
  }

  load(libraryPath: string): NativeLibraryHandle {
    if (!existsSync(libraryPath)) {
      throw new Error(`library not found: ${libraryPath}`);
    }
    return { libraryPath, platform: "linux", _token: libraryPath };
  }

  execute(handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    if (calls.length === 0) return [];

    const dir = mkdtempSync(join(tmpdir(), "ur-harness-"));
    const src = join(dir, "h.c");
    const bin = join(dir, "h");

    try {
      writeFileSync(src, buildHarness(calls, handle.libraryPath));

      const includeFlags = this.includePaths.flatMap(p => ["-I", p]);
      const compile = spawnSync(
        "gcc",
        ["-o", bin, src, handle.libraryPath,
          "-Wl,-rpath," + dirname(handle.libraryPath),
          "-ldl", "-Wno-incompatible-pointer-types", "-Wno-int-conversion",
          ...includeFlags],
        { stdio: "pipe" },
      );
      if (compile.status !== 0) {
        const msg = compile.stderr?.toString() ?? "compile error";
        return calls.map(() => ({ kind: "error" as const, message: msg }));
      }

      const run = spawnSync(bin, [], { stdio: "pipe" });
      const stdout = run.stdout?.toString() ?? "";
      const stderr = run.stderr?.toString() ?? "";
      if (run.status !== 0 && stderr.includes("DLOPEN_FAIL")) {
        return calls.map(() => ({ kind: "error" as const, message: `dlopen failed: ${stderr}` }));
      }

      return parseOutput(stdout.trim().split("\n"), calls);
    } finally {
      try { unlinkSync(src); } catch { /* best-effort */ }
      try { unlinkSync(bin); } catch { /* best-effort */ }
      try { spawnSync("rmdir", [dir], { stdio: "ignore" }); } catch { /* best-effort */ }
    }
  }

  unload(_handle: NativeLibraryHandle): void {
    // The harness process exits after each execute() call, so there is no
    // persistent handle to release. This is a no-op.
  }
}

// ── Harness C source generation ───────────────────────────────────────────

function buildHarness(calls: NativeCall[], libraryPath: string): string {
  return [
    `#include <stdio.h>`,
    `#include <stdlib.h>`,
    `#include <string.h>`,
    `#include <stdint.h>`,
    `#include <dlfcn.h>`,
    ``,
    `/* ptr_table: maps call-index to pointer returned by that call, so`,
    `   subsequent calls can pass it as an argument. */`,
    `static void* ptr_table[256];`,
    ``,
    `static void* sym(void* h, const char* name) {`,
    `  void* f = dlsym(h, name);`,
    `  if (!f) { fprintf(stderr, "DLSYM_FAIL:%s\\n", name); exit(2); }`,
    `  return f;`,
    `}`,
    ``,
    `int main(void) {`,
    `  void* lib = dlopen("${libraryPath}", RTLD_NOW);`,
    `  if (!lib) { fprintf(stderr, "DLOPEN_FAIL:%s\\n", dlerror()); return 2; }`,
    ``,
    ...calls.flatMap((c, i) => buildCallBlock(c, i)),
    `  dlclose(lib);`,
    `  return 0;`,
    `}`,
  ].join("\n");
}

function cArgType(a: NativeArg): string {
  switch (a.kind) {
    case "i32":      return "int";
    case "i64":      return "long long";
    case "f64":      return "double";
    case "str":      return "const char*";
    case "null_str": return "const char*";
    case "ptr":      return "void*";
    case "null_ptr": return "void*";
  }
}

function cArgExpr(a: NativeArg): string {
  switch (a.kind) {
    case "i32":      return String(a.value);
    case "i64":      return `(long long)${a.value}LL`;
    case "f64":      return String(a.value);
    case "str":      return `"${a.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    case "null_str": return `(const char*)0`;
    case "ptr":      return `ptr_table[${a.value}]`;  // index into prior results
    case "null_ptr": return `(void*)0`;
  }
}

function buildCallBlock(call: NativeCall, idx: number): string[] {
  const { symbol, args, returnKind } = call;
  const fnArgs = args.length === 0 ? "void" : args.map(cArgType).join(", ");
  const callArgs = args.map(cArgExpr).join(", ");

  switch (returnKind) {
    case "i32": return [
      `  { typedef int (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    printf("I32:%d\\n", f(${callArgs})); }`,
    ];
    case "i64": return [
      `  { typedef long long (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    printf("I64:%lld\\n", f(${callArgs})); }`,
    ];
    case "f64": return [
      `  { typedef double (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    printf("F64:%f\\n", f(${callArgs})); }`,
    ];
    case "str": return [
      `  { typedef const char* (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    const char* r=f(${callArgs}); printf("STR:%s\\n", r?r:"(null)"); }`,
    ];
    case "ptr": return [
      `  { typedef void* (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    void* r=f(${callArgs}); ptr_table[${idx}]=r;`,
      `    printf("PTR:%llu\\n",(unsigned long long)(uintptr_t)r); }`,
    ];
    case "void": return [
      `  { typedef void (*F)(${fnArgs}); F f=(F)sym(lib,"${symbol}");`,
      `    f(${callArgs}); printf("VOID:\\n"); }`,
    ];
    default: return [`  printf("ERR:unknown kind\\n");`];
  }
}

// ── Output parsing ────────────────────────────────────────────────────────

function parseOutput(lines: string[], calls: NativeCall[]): NativeCallResult[] {
  return calls.map((_, i): NativeCallResult => {
    const line = lines[i] ?? "";
    if (line.startsWith("I32:"))  return { kind: "i32",  value: parseInt(line.slice(4), 10) };
    if (line.startsWith("I64:"))  return { kind: "i64",  value: BigInt(line.slice(4)) };
    if (line.startsWith("F64:"))  return { kind: "f64",  value: parseFloat(line.slice(4)) };
    if (line.startsWith("STR:"))  return { kind: "str",  value: line.slice(4) };
    if (line.startsWith("PTR:"))  return { kind: "ptr",  value: BigInt(line.slice(4)) };
    if (line.startsWith("VOID:")) return { kind: "void" };
    return { kind: "error", message: `unexpected output line[${i}]: "${line}"` };
  });
}
