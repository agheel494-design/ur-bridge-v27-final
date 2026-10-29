// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Comprehensive C++ Exception Mapping Coverage Matrix (e2e)
// Phase 7 — Native Ecosystem Hardening — Exception Mapping
// ─────────────────────────────────────────────────────────────────────────────
//
// Full pipeline, exercised for real, end to end:
//
//   C++ header (fixtures/exception-lab.h)
//     -> parseCppHeader            (Header Parser)
//     -> buildBindingPlan          (Binding Plan)
//     -> emitExceptionSafeTrampolines (Exception Trampoline Generator)
//     -> g++ compilation           (real toolchain, real .so)
//     -> dlopen()                  (Dynamic Loading)
//     -> dlsym() + call            ("UR Runtime" stand-in: calls resolved
//                                    purely by the pipeline's own mangled
//                                    names, exactly as UR's generated
//                                    runtime code would)
//     -> UR error code + message   (Exception Mapping -> UR Diagnostics)
//
// Required coverage matrix (7 cases): std::runtime_error, std::logic_error
// (thrown as its base type, not a derived one), std::invalid_argument,
// std::out_of_range, std::exception (thrown as the root type), a custom
// user-defined exception deriving from std::exception, and a genuinely
// unknown thrown value (`throw 42;`, not derived from std::exception at
// all).
//
// For EVERY case this test performs two calls and asserts they agree:
//   (a) calling the real C++ method directly (ordinary C++ linkage, no
//       trampoline, no dlsym) — establishes ground truth.
//   (b) calling it through the dlsym-resolved generated trampoline.
// And separately asserts the success path (trigger=0) also agrees between
// (a) and (b), so a passing run demonstrates: no exception ever crosses
// the FFI boundary, the error code is correct, the message is preserved
// exactly (where extractable), catch order is correct, and the success
// path's return value is unaffected by the exception-handling machinery.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCppHeader } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";
import { buildBindingPlan } from "../../../src/ffi/bindgen/cpp/cpp-converter.js";
import { emitExceptionSafeTrampolines, type EmittedTrampoline } from "../../../src/ffi/bindgen/cpp/cpp-exceptions.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));

function hasGxx(): boolean {
  return spawnSync("g++", ["--version"], { stdio: "ignore" }).status === 0;
}

type Case = {
  method: string;       // C++ method name
  urCode: number;       // expected UR error code
  expectedMsg: string | null; // exact expected message, or null if not asserted (implementation-defined)
};

const CASES: Case[] = [
  { method: "throwsRuntimeError",     urCode: 4, expectedMsg: "runtime_error occurred" },
  { method: "throwsLogicErrorBase",   urCode: 3, expectedMsg: "logic_error occurred" },
  { method: "throwsInvalidArgument",  urCode: 1, expectedMsg: "invalid_argument occurred" },
  { method: "throwsOutOfRange",       urCode: 2, expectedMsg: "out_of_range occurred" },
  { method: "throwsExceptionBase",    urCode: 5, expectedMsg: null }, // libstdc++'s std::exception::what() text is implementation-defined
  { method: "throwsCustomException",  urCode: 5, expectedMsg: "custom exception occurred" },
  { method: "throwsUnknownValue",     urCode: 6, expectedMsg: "unknown non-standard value thrown across FFI boundary" },
];

function buildHarnessSource(trampolines: EmittedTrampoline[]): string {
  const byMethod = new Map(trampolines.map((t) => [t.trampolineName.replace(/^ExceptionLab_/, ""), t.trampolineName]));

  const caseBlocks = CASES.map((c) => {
    const trampolineName = byMethod.get(c.method);
    if (!trampolineName) throw new Error(`no trampoline generated for ${c.method}`);
    const msgCheck = c.expectedMsg !== null
      ? `check(strcmp(errBuf, "${c.expectedMsg}") == 0, "${c.method}.message_preserved_exactly");`
      : `check(strlen(errBuf) > 0, "${c.method}.message_nonempty");`;
    return `
  {
    // success path (trigger=0): direct C++ vs trampoline must agree
    int directOk = direct.${c.method}(0);
    int outOk; char errBufOk[256] = {0};
    int codeOk = ${trampolineName}(&direct, 0, &outOk, errBufOk, sizeof(errBufOk));
    check(codeOk == 0, "${c.method}.success_code_is_UR_OK");
    check(outOk == directOk, "${c.method}.success_matches_direct_cpp");

    // throwing path (trigger=1): direct C++ must throw; trampoline must
    // catch it and report the expected UR code, never escaping.
    bool directThrew = false;
    try { direct.${c.method}(1); } catch (...) { directThrew = true; }
    check(directThrew, "${c.method}.direct_cpp_throws");

    int outErr; char errBuf[256] = {0};
    int code = ${trampolineName}(&direct, 1, &outErr, errBuf, sizeof(errBuf));
    check(code == ${c.urCode}, "${c.method}.trampoline_maps_to_expected_UR_code");
    ${msgCheck}
  }`;
  }).join("\n");

  return `
#include "exception-lab.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <cstdlib>

template<typename Fn>
Fn resolve(void* handle, const char* name) {
  void* sym = dlsym(handle, name);
  if (!sym) { fprintf(stderr, "DLSYM_FAIL:%s\\n", name); exit(2); }
  return reinterpret_cast<Fn>(sym);
}

int main() {
  void* handle = dlopen("./libexceptionlab_e2e.so", RTLD_NOW);
  if (!handle) { fprintf(stderr, "DLOPEN_FAIL:%s\\n", dlerror()); return 2; }

${trampolines.map((t) =>
  `  auto ${t.trampolineName} = resolve<int(*)(void*, int, int*, char*, int)>(handle, "${t.trampolineName}");`
).join("\n")}

  ExceptionLab direct;
  int failures = 0;
  auto check = [&](bool cond, const char* what) {
    if (!cond) { fprintf(stderr, "ASSERT_FAIL:%s\\n", what); failures++; }
    else printf("PASS:%s\\n", what);
  };
${caseBlocks}

  dlclose(handle);
  return failures == 0 ? 0 : 1;
}
`;
}

const gxxAvailable = hasGxx();

(process.platform === "win32" ? describe.skip : describe)("Comprehensive C++ exception mapping coverage matrix (end-to-end, requires g++)", () => {
  if (!gxxAvailable) {
    it.skip("SKIPPED: g++ not found in PATH — cpp-exceptions.test.ts unit tests remain the primary gate", () => {
      console.warn("[cpp-exception-mapping-full-matrix-e2e] g++ not found — skipping real compile+link+run proof.");
      expect(true).toBe(true);
    });
    return;
  }

  it("all 7 exception cases map correctly through the full real pipeline, with zero FFI-boundary leaks", () => {
    const headerSrc = readFileSync(join(FIXTURES_DIR, "exception-lab.h"), "utf-8");
    const parsed = parseCppHeader(headerSrc);
    expect(parsed.errors).toHaveLength(0);

    const plan = buildBindingPlan(parsed);
    const lab = plan.classes.find((c) => c.className === "ExceptionLab")!;
    expect(lab).toBeDefined();
    expect(lab.methods).toHaveLength(7);

    const file = emitExceptionSafeTrampolines(plan, ["exception-lab.h"]);
    expect(file.trampolines).toHaveLength(7);

    const dir = mkdtempSync(join(tmpdir(), "ur-bridge-cpp-exc-matrix-e2e-"));
    try {
      copyFileSync(join(FIXTURES_DIR, "exception-lab.h"), join(dir, "exception-lab.h"));
      copyFileSync(join(FIXTURES_DIR, "exception-lab.cpp"), join(dir, "exception-lab.cpp"));
      writeFileSync(join(dir, "trampolines.cpp"), file.source);
      writeFileSync(join(dir, "harness.cpp"), buildHarnessSource(file.trampolines));

      const compileLib = spawnSync(
        "g++", ["-shared", "-fPIC", "-o", "libexceptionlab_e2e.so", "exception-lab.cpp", "trampolines.cpp"], { cwd: dir },
      );
      if (compileLib.status !== 0) {
        throw new Error(`library compile failed:\n${compileLib.stderr?.toString()}`);
      }

      const compileHarness = spawnSync(
        "g++", ["-o", "harness", "harness.cpp", "exception-lab.cpp", "-ldl"], { cwd: dir },
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
      // 4 assertions per case (success_code, success_matches, direct_throws, trampoline_maps) + 1 message check = 5 * 7 = 35
      expect(passLines.length).toBe(35);

      for (const c of CASES) {
        expect(stdout).toContain(`PASS:${c.method}.success_code_is_UR_OK`);
        expect(stdout).toContain(`PASS:${c.method}.success_matches_direct_cpp`);
        expect(stdout).toContain(`PASS:${c.method}.direct_cpp_throws`);
        expect(stdout).toContain(`PASS:${c.method}.trampoline_maps_to_expected_UR_code`);
      }
      // The two specific must-not-misclassify regressions called out by
      // the directive: invalid_argument/out_of_range must NOT be
      // reported as the generic logic_error code (3).
      expect(stdout).toContain("PASS:throwsInvalidArgument.trampoline_maps_to_expected_UR_code");
      expect(stdout).toContain("PASS:throwsOutOfRange.trampoline_maps_to_expected_UR_code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

