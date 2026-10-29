// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: C++ Exception Mapping (cpp-exceptions.ts)
// Phase 7 — Native Ecosystem Hardening — Exception Mapping
// ─────────────────────────────────────────────────────────────────────────────
//
// Fast, toolchain-independent tests of the generated trampoline source
// (catch-clause order, signatures, error-code mapping). The deeper,
// real-compile-and-run proof — including a direct comparison against
// calling the real C++ method without going through the trampoline — is
// in cpp-exception-mapping-e2e.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCppHeader } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";
import { buildBindingPlan } from "../../../src/ffi/bindgen/cpp/cpp-converter.js";
import {
  emitExceptionSafeTrampolines,
  renderCppType,
  STANDARD_EXCEPTION_MAPPINGS,
} from "../../../src/ffi/bindgen/cpp/cpp-exceptions.js";

describe("STANDARD_EXCEPTION_MAPPINGS — catch order", () => {
  it("orders std::invalid_argument and std::out_of_range BEFORE their base std::logic_error", () => {
    const order = STANDARD_EXCEPTION_MAPPINGS.map((m) => m.cppType);
    const logicIdx = order.indexOf("std::logic_error");
    const invalidIdx = order.indexOf("std::invalid_argument");
    const rangeIdx = order.indexOf("std::out_of_range");
    expect(invalidIdx).toBeLessThan(logicIdx);
    expect(rangeIdx).toBeLessThan(logicIdx);
  });

  it("orders std::logic_error and std::runtime_error BEFORE the root std::exception", () => {
    const order = STANDARD_EXCEPTION_MAPPINGS.map((m) => m.cppType);
    const exceptionIdx = order.indexOf("std::exception");
    expect(order.indexOf("std::logic_error")).toBeLessThan(exceptionIdx);
    expect(order.indexOf("std::runtime_error")).toBeLessThan(exceptionIdx);
  });

  it("std::exception (the catch-all) is last", () => {
    const order = STANDARD_EXCEPTION_MAPPINGS.map((m) => m.cppType);
    expect(order[order.length - 1]).toBe("std::exception");
  });
});

describe("renderCppType — C++ source syntax (distinct from Itanium mangling)", () => {
  it("renders builtins, pointers, references, and const qualifiers as valid C++ syntax", () => {
    expect(renderCppType({ kind: "builtin", name: "int" })).toBe("int");
    expect(renderCppType({ kind: "pointer", pointee: { kind: "const", inner: { kind: "builtin", name: "char" } } }))
      .toBe("const char*");
    expect(renderCppType({ kind: "reference", pointee: { kind: "named", path: ["Widget"] } })).toBe("Widget&");
    expect(renderCppType({ kind: "template-instance", path: ["Box"], args: [{ kind: "builtin", name: "int" }] }))
      .toBe("Box<int>");
  });
});

describe("emitExceptionSafeTrampolines — generated source structure", () => {
  const plan = buildBindingPlan(parseCppHeader(`
    class Parser {
    public:
      int parseStrict(int value) const;
    };
  `));
  const file = emitExceptionSafeTrampolines(plan, ["parser.h"]);

  it("emits exactly one trampoline per public method", () => {
    expect(file.trampolines).toHaveLength(1);
    expect(file.trampolines[0]!.targetMangledName).toBe("_ZNK6Parser11parseStrictEi");
  });

  it("includes every standard exception's catch clause in the correct order in the generated source", () => {
    const src = file.source;
    const order = ["std::invalid_argument", "std::out_of_range", "std::logic_error", "std::runtime_error", "std::exception"]
      .map((t) => src.indexOf(`catch (const ${t}&`));
    expect(order.every((i) => i !== -1)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
  });

  it("emits a final catch(...) safety net AFTER std::exception, for throws that don't derive from it at all", () => {
    const src = file.source;
    const exceptionIdx = src.indexOf("catch (const std::exception&");
    const catchAllIdx = src.indexOf("catch (...)");
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(exceptionIdx);
    expect(src).toContain("return UR_UNKNOWN_THROWN_VALUE;");
  });

  it("never returns directly from inside a try block without a catch cascade present", () => {
    // Sanity check that the success path and every catch clause exist
    // together in one function body (regex-light structural check).
    expect(file.source).toContain("return UR_OK;");
    expect(file.source).toContain("return UR_INVALID_ARGUMENT;");
    expect(file.source).toContain("return UR_UNKNOWN_EXCEPTION;");
  });

  it("includes the caller-specified header include", () => {
    expect(file.source).toContain('#include "parser.h"');
  });

  it("const methods cast `self` to a const pointer", () => {
    expect(file.trampolines[0]!.source).toContain("static_cast<const Parser*>(self)");
  });
});

describe("emitExceptionSafeTrampolines — overload disambiguation", () => {
  it("gives distinct trampoline names to overloaded methods", () => {
    const plan = buildBindingPlan(parseCppHeader(`
      class Widget {
      public:
        Widget();
        Widget(int id);
      };
    `));
    const file = emitExceptionSafeTrampolines(plan);
    const names = file.trampolines.map((t) => t.trampolineName);
    expect(new Set(names).size).toBe(names.length); // all unique
    expect(names).toContain("Widget_ctor");
    expect(names).toContain("Widget_ctor_1");
  });
});

describe("emitExceptionSafeTrampolines — destructors are not exception-wrapped", () => {
  it("destructor trampoline has no try/catch (dtors are implicitly noexcept)", () => {
    const plan = buildBindingPlan(parseCppHeader(`class Widget { public: Widget(); ~Widget(); };`));
    const file = emitExceptionSafeTrampolines(plan);
    const dtor = file.trampolines.find((t) => t.trampolineName === "Widget_dtor")!;
    expect(dtor.source).not.toContain("try");
    expect(dtor.source).not.toContain("catch");
    expect(dtor.source).toContain("~Widget()");
  });
});
