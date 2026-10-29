// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Real Native C++ Exception Mapping (end-to-end, no simulation)
// Phase 7 — Native Ecosystem Hardening — Exception Mapping
// ─────────────────────────────────────────────────────────────────────────────
//
// Capstone test for exception mapping. Drives the ACTUAL pipeline
// (parseCppHeader -> buildBindingPlan -> emitExceptionSafeTrampolines),
// compiles the generated trampoline together with a genuinely throwing
// C++ method (fixtures/parser.cpp) using real g++, loads it with
// dlopen(), and — per the Phase 7 exception-mapping directive's
// requirement for "مقارنة النتائج مع التنفيذ المباشر في C++" — directly
// compares every trampoline result against calling Parser::parseStrict()
// without going through any trampoline at all, in the same process.
//
// This proves three things simultaneously, with zero simulation:
//   1. No C++ exception crosses the FFI boundary (the harness would
//      crash/terminate if one did, since `extern "C"` functions are not
//      required to support exception propagation across the boundary).
//   2. The exception -> UR error code mapping is correct (including
//      catch-order correctness: invalid_argument and out_of_range are
//      NOT misclassified as the generic logic_error).
//   3. The success path's return value through the trampoline EXACTLY
//      matches calling the real method directly.
//
// Requires a working g++ in PATH; skips gracefully (not a failure) if
// unavailable, matching cpp-real-native-e2e.test.ts. The toolchain-
// independent unit tests in cpp-exceptions.test.ts remain the primary,
// always-on correctness gate for catch-order and code-generation shape.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCppHeader } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";
import { buildBindingPlan } from "../../../src/ffi/bindgen/cpp/cpp-converter.js";
import { emitExceptionSafeTrampolines } from "../../../src/ffi/bindgen/cpp/cpp-exceptions.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));

function hasGxx(): boolean {
  return spawnSync("g++", ["--version"], { stdio: "ignore" }).status === 0;
}

function buildHarnessSource(trampolineName: string): string {
  return `
#include "parser.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <stdexcept>

int main() {
  void* handle = dlopen("./libparser_e2e.so", RTLD_NOW);
  if (!handle) { fprintf(stderr, "DLOPEN_FAIL:%s\\n", dlerror()); return 2; }
  auto trampoline = reinterpret_cast<int(*)(const void*, int, int*, char*, int)>(
    dlsym(handle, "${trampolineName}"));
  if (!trampoline) { fprintf(stderr, "DLSYM_FAIL\\n"); return 2; }

  Parser direct; // a REAL, directly-constructed C++ object — not via the trampoline
  int failures = 0;
  auto check = [&](bool cond, const char* what) {
    if (!cond) { fprintf(stderr, "ASSERT_FAIL:%s\\n", what); failures++; }
    else printf("PASS:%s\\n", what);
  };

  {
    int directResult = direct.parseStrict(5);
    int outResult; char errBuf[256] = {0};
    int code = trampoline(&direct, 5, &outResult, errBuf, sizeof(errBuf));
    check(code == 0, "success.code_is_UR_OK");
    check(outResult == directResult, "success.trampoline_matches_direct_cpp");
    check(outResult == 10, "success.value_is_10");
  }
  {
    bool directThrew = false;
    try { direct.parseStrict(-1); } catch (const std::invalid_argument&) { directThrew = true; }
    check(directThrew, "direct_cpp.negative_throws_invalid_argument");

    int outResult; char errBuf[256] = {0};
    int code = trampoline(&direct, -1, &outResult, errBuf, sizeof(errBuf));
    check(code == 1, "trampoline.negative_maps_to_UR_INVALID_ARGUMENT");
    check(strcmp(errBuf, "value must be non-negative") == 0, "trampoline.error_message_preserved_exactly");
  }
  {
    bool directThrew = false;
    try { direct.parseStrict(5000); } catch (const std::out_of_range&) { directThrew = true; }
    check(directThrew, "direct_cpp.large_throws_out_of_range");

    int outResult; char errBuf[256] = {0};
    int code = trampoline(&direct, 5000, &outResult, errBuf, sizeof(errBuf));
    check(code == 2, "trampoline.large_maps_to_UR_OUT_OF_RANGE_not_misclassified_as_logic_error");
  }

  dlclose(handle);
  return failures == 0 ? 0 : 1;
}
`;
}

const gxxAvailable = hasGxx();

(process.platform === "win32" ? describe.skip : describe)("Real native C++ exception mapping (end-to-end, requires g++)", () => {
  if (!gxxAvailable) {
    it.skip("SKIPPED: g++ not found in PATH — cpp-exceptions.test.ts unit tests remain the primary gate", () => {
      console.warn("[cpp-exception-mapping-e2e] g++ not found — skipping real compile+link+run proof.");
      expect(true).toBe(true);
    });
    return;
  }

  it("generated trampoline never lets a C++ exception cross the FFI boundary, and matches direct C++ execution exactly", () => {
    const headerSrc = readFileSync(join(FIXTURES_DIR, "parser.h"), "utf-8");
    const parsed = parseCppHeader(headerSrc);
    expect(parsed.errors).toHaveLength(0);

    const plan = buildBindingPlan(parsed);
    const file = emitExceptionSafeTrampolines(plan, ["parser.h"]);
    expect(file.trampolines).toHaveLength(1);
    const trampolineName = file.trampolines[0]!.trampolineName;

    const dir = mkdtempSync(join(tmpdir(), "ur-bridge-cpp-exc-e2e-"));
    try {
      copyFileSync(join(FIXTURES_DIR, "parser.h"), join(dir, "parser.h"));
      copyFileSync(join(FIXTURES_DIR, "parser.cpp"), join(dir, "parser.cpp"));
      writeFileSync(join(dir, "trampolines.cpp"), file.source);
      writeFileSync(join(dir, "harness.cpp"), buildHarnessSource(trampolineName));

      const compileLib = spawnSync(
        "g++", ["-shared", "-fPIC", "-o", "libparser_e2e.so", "parser.cpp", "trampolines.cpp"], { cwd: dir },
      );
      if (compileLib.status !== 0) {
        throw new Error(`library compile failed:\n${compileLib.stderr?.toString()}`);
      }

      // The harness links parser.cpp DIRECTLY (real, ordinary C++
      // linkage) so it can call Parser::parseStrict() with no trampoline
      // involved at all, for the side-by-side comparison.
      const compileHarness = spawnSync(
        "g++", ["-o", "harness", "harness.cpp", "parser.cpp", "-ldl"], { cwd: dir },
      );
      if (compileHarness.status !== 0) {
        throw new Error(`harness compile failed:\n${compileHarness.stderr?.toString()}`);
      }

      const run = spawnSync("./harness", [], { cwd: dir });
      const stdout = run.stdout?.toString() ?? "";
      const stderr = run.stderr?.toString() ?? "";

      if (stderr !== "" || run.status !== 0) {
        throw new Error(`harness reported a failure (exit ${run.status}):\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }

      const passLines = stdout.split("\n").filter((l) => l.startsWith("PASS:"));
      expect(passLines.length).toBe(8);
      expect(stdout).toContain("PASS:success.trampoline_matches_direct_cpp");
      expect(stdout).toContain("PASS:trampoline.negative_maps_to_UR_INVALID_ARGUMENT");
      expect(stdout).toContain("PASS:trampoline.error_message_preserved_exactly");
      expect(stdout).toContain("PASS:trampoline.large_maps_to_UR_OUT_OF_RANGE_not_misclassified_as_logic_error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

