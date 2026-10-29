// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Real Native C++ Integration (end-to-end, no simulation)
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the capstone test for the whole C++ bindgen pipeline. Unlike
// itanium-mangle.test.ts and cpp-header-parser.test.ts (which test each
// stage in isolation against fixed expected values), this test:
//
//   1. Parses a REAL header (fixtures/widget.h) with the actual
//      parseCppHeader().
//   2. Runs it through the actual buildBindingPlan() (including an
//      explicit Box<int> template instantiation request).
//   3. Takes the mangled names buildBindingPlan() PRODUCES (not
//      hardcoded expected strings) and writes a small C++ harness that
//      dlopen()s a library compiled from fixtures/widget.cpp and
//      dlsym()s every method by that mangled name.
//   4. Compiles fixtures/widget.cpp into a real .so and the harness into
//      a real executable with g++, runs it, and asserts the real
//      computed results (e.g. resize(6,7) then area() == 42) are correct.
//
// If step 4's mangled names were wrong, or the calling-convention model
// (this-pointer-first for non-static members, raw malloc'd memory for
// placement) were wrong, dlsym would fail to resolve or the call would
// silently corrupt memory / produce wrong numbers. A clean pass here is a
// genuine, unfaked correctness proof — not a simulation.
//
// Requires a working g++ in PATH. Many CI/dev environments won't have a
// C++ toolchain available; this test detects that and reports a clear
// skip notice instead of failing, so `npm test` stays portable. The fast,
// toolchain-independent unit tests in itanium-mangle.test.ts and
// cpp-header-parser.test.ts remain the primary correctness gate.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCppHeader } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";
import { buildBindingPlan, type BoundClass } from "../../../src/ffi/bindgen/cpp/cpp-converter.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));

function hasGxx(): boolean {
  const r = spawnSync("g++", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function findMethod(cls: BoundClass, predicate: (m: BoundClass["methods"][number]) => boolean) {
  const m = cls.methods.find(predicate);
  if (!m) throw new Error(`method not found on ${cls.bindingName}`);
  return m;
}

function buildHarnessSource(widget: BoundClass, circle: BoundClass, boxInt: BoundClass): string {
  const ctor0 = findMethod(widget, (m) => m.kind === "ctor" && m.params.length === 0).mangledName;
  const ctorId = findMethod(widget, (m) => m.kind === "ctor" && m.params.length === 1).mangledName;
  const dtor = findMethod(widget, (m) => m.kind === "dtor").mangledName;
  const resize = findMethod(widget, (m) => m.name === "resize").mangledName;
  const area = findMethod(widget, (m) => m.name === "area").mangledName;
  const count = findMethod(widget, (m) => m.name === "count").mangledName;
  const setName = findMethod(widget, (m) => m.name === "setName").mangledName;
  const getName = findMethod(widget, (m) => m.name === "getName").mangledName;

  const circleCtor = findMethod(circle, (m) => m.kind === "ctor").mangledName;
  const radius = findMethod(circle, (m) => m.name === "radius").mangledName;
  const scale = findMethod(circle, (m) => m.name === "scale").mangledName;

  const boxCtor = findMethod(boxInt, (m) => m.kind === "ctor").mangledName;
  const boxGet = findMethod(boxInt, (m) => m.name === "get").mangledName;
  const boxSet = findMethod(boxInt, (m) => m.name === "set").mangledName;

  // The mangled names above were produced by the TypeScript pipeline at
  // test run time — they are interpolated as plain string literals here,
  // not re-derived or hand-typed.
  return `
#include "widget.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>

template<typename Fn>
Fn resolve(void* handle, const char* mangledName) {
  void* sym = dlsym(handle, mangledName);
  if (!sym) { fprintf(stderr, "RESOLVE_FAIL:%s\\n", mangledName); exit(2); }
  return reinterpret_cast<Fn>(sym);
}

int main() {
  void* handle = dlopen("./libwidget_e2e.so", RTLD_NOW);
  if (!handle) { fprintf(stderr, "DLOPEN_FAIL:%s\\n", dlerror()); return 2; }
  int failures = 0;
  auto check = [&](bool cond, const char* what) {
    if (!cond) { fprintf(stderr, "ASSERT_FAIL:%s\\n", what); failures++; }
    else printf("PASS:%s\\n", what);
  };

  {
    auto ctor0_  = resolve<void(*)(void*)>(handle, "${ctor0}");
    auto ctorId_ = resolve<void(*)(void*, int)>(handle, "${ctorId}");
    auto dtor_   = resolve<void(*)(void*)>(handle, "${dtor}");
    auto resize_ = resolve<void(*)(void*, int, int)>(handle, "${resize}");
    auto area_   = resolve<int(*)(const void*)>(handle, "${area}");
    auto count_  = resolve<int(*)()>(handle, "${count}");
    auto setName_= resolve<void(*)(void*, const char*)>(handle, "${setName}");
    auto getName_= resolve<const char*(*)(const void*)>(handle, "${getName}");

    void* mem = malloc(sizeof(Widget));
    ctor0_(mem);
    resize_(mem, 6, 7);
    check(area_(mem) == 42, "Widget.resize(6,7).area()==42");
    setName_(mem, "ur-bridge");
    check(strcmp(getName_(mem), "ur-bridge") == 0, "Widget.setName/getName roundtrip");
    dtor_(mem);
    free(mem);
    check(count_() == 42, "Widget::count()==42");

    void* mem2 = malloc(sizeof(Widget));
    ctorId_(mem2, 99);
    dtor_(mem2);
    free(mem2);
    check(true, "Widget(int) overload ctor/dtor via distinct mangled symbol");
  }
  {
    auto ctor_   = resolve<void(*)(void*, double)>(handle, "${circleCtor}");
    auto radius_ = resolve<double(*)(const void*)>(handle, "${radius}");
    auto scale_  = resolve<void(*)(void*, double)>(handle, "${scale}");
    void* mem = malloc(sizeof(shapes::Circle));
    ctor_(mem, 2.0);
    scale_(mem, 3.0);
    check(radius_(mem) == 6.0, "shapes::Circle.ctor(2).scale(3).radius()==6");
    free(mem);
  }
  {
    auto ctor_ = resolve<void(*)(void*, int)>(handle, "${boxCtor}");
    auto get_  = resolve<int(*)(const void*)>(handle, "${boxGet}");
    auto set_  = resolve<void(*)(void*, int)>(handle, "${boxSet}");
    void* mem = malloc(sizeof(Box<int>));
    ctor_(mem, 10);
    check(get_(mem) == 10, "Box<int>.ctor(10).get()==10");
    set_(mem, 25);
    check(get_(mem) == 25, "Box<int>.set(25).get()==25");
    free(mem);
  }

  dlclose(handle);
  return failures == 0 ? 0 : 1;
}
`;
}

const gxxAvailable = hasGxx();

(process.platform === "win32" ? describe.skip : describe)("Real native C++ integration (end-to-end, requires g++)", () => {
  if (!gxxAvailable) {
    it.skip("SKIPPED: g++ not found in PATH — toolchain-independent unit tests in itanium-mangle.test.ts and cpp-header-parser.test.ts remain the primary gate", () => {
      console.warn("[cpp-real-native-e2e] g++ not found — skipping real compile+link+run proof.");
      expect(true).toBe(true);
    });
    return;
  }

  it("parses the real header, mangles via the real pipeline, compiles+links+runs real C++, and gets correct results purely via dlsym-by-mangled-name", () => {
    const headerSrc = readFileSync(join(FIXTURES_DIR, "widget.h"), "utf-8");
    const parsed = parseCppHeader(headerSrc);
    expect(parsed.errors).toHaveLength(0);

    const plan = buildBindingPlan(parsed, [
      { namespace: [], className: "Box", args: [{ kind: "builtin", name: "int" }], label: "int" },
    ]);
    expect(plan.unboundTemplates).toHaveLength(0);

    const widget = plan.classes.find((c) => c.className === "Widget")!;
    const circle = plan.classes.find((c) => c.className === "Circle")!;
    const boxInt = plan.classes.find((c) => c.bindingName === "Box_int")!;
    expect(widget).toBeDefined();
    expect(circle).toBeDefined();
    expect(boxInt).toBeDefined();

    const harnessSrc = buildHarnessSource(widget, circle, boxInt);

    const dir = mkdtempSync(join(tmpdir(), "ur-bridge-cpp-e2e-"));
    try {
      copyFileSync(join(FIXTURES_DIR, "widget.h"), join(dir, "widget.h"));
      copyFileSync(join(FIXTURES_DIR, "widget.cpp"), join(dir, "widget.cpp"));
      writeFileSync(join(dir, "harness.cpp"), harnessSrc);

      const compileLib = spawnSync("g++", ["-shared", "-fPIC", "-o", "libwidget_e2e.so", "widget.cpp"], { cwd: dir });
      if (compileLib.status !== 0) {
        throw new Error(`library compile failed:\n${compileLib.stderr?.toString()}`);
      }

      const compileHarness = spawnSync("g++", ["-o", "harness", "harness.cpp", "-ldl"], { cwd: dir });
      if (compileHarness.status !== 0) {
        throw new Error(`harness compile failed:\n${compileHarness.stderr?.toString()}`);
      }

      const run = spawnSync("./harness", [], { cwd: dir });
      const stdout = run.stdout?.toString() ?? "";
      const stderr = run.stderr?.toString() ?? "";

      if (stderr !== "" || run.status !== 0) {
        throw new Error(`harness reported a failure (exit ${run.status}):\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }

      // Every individual real assertion the C++ harness performed.
      const passLines = stdout.split("\n").filter((l) => l.startsWith("PASS:"));
      expect(passLines.length).toBe(7);
      expect(stdout).toContain("PASS:Widget.resize(6,7).area()==42");
      expect(stdout).toContain("PASS:Widget.setName/getName roundtrip");
      expect(stdout).toContain("PASS:Widget::count()==42");
      expect(stdout).toContain("PASS:Widget(int) overload ctor/dtor via distinct mangled symbol");
      expect(stdout).toContain("PASS:shapes::Circle.ctor(2).scale(3).radius()==6");
      expect(stdout).toContain("PASS:Box<int>.ctor(10).get()==10");
      expect(stdout).toContain("PASS:Box<int>.set(25).get()==25");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

