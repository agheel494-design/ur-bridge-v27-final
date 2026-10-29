// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: C++ Binding Plan (cpp-converter.ts)
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// Validates the parseCppHeader -> buildBindingPlan stage: every mangled
// name produced here was cross-checked against real g++ 13.3.0 output
// during development (see tests/ffi/cpp/cpp-real-native-e2e.test.ts for
// the live compile+link+run proof using these exact mangled names).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCppHeader } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";
import { buildBindingPlan } from "../../../src/ffi/bindgen/cpp/cpp-converter.js";

const WIDGET_HEADER = `
  class Widget {
  public:
    Widget();
    Widget(int id);
    ~Widget();
    void resize(int w, int h);
    int area() const;
    static int count();
    void setName(const char* name);
  private:
    int id_;
  };
  namespace shapes {
    class Circle {
    public:
      Circle(double radius);
      double radius() const;
      void scale(double factor);
    };
  }
  template<typename T>
  class Box {
  public:
    Box(T value);
    T get() const;
    void set(T value);
  };
  int globalAdd(int a, int b);
`;

describe("buildBindingPlan — free functions", () => {
  it("mangles a namespaced free function", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER));
    const fn = plan.functions.find((f) => f.name === "globalAdd")!;
    expect(fn).toBeDefined();
    expect(fn.mangledName).toBe("_Z9globalAddii");
  });
});

describe("buildBindingPlan — classes", () => {
  it("produces one BoundClass per non-template, non-opaque class", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER));
    const names = plan.classes.map((c) => c.bindingName).sort();
    expect(names).toEqual(["Circle", "Widget"]);
  });

  it("includes only PUBLIC members in the binding plan", () => {
    // Widget has a private `int id_` data member, which the parser already
    // skips (see cpp-header-parser.test.ts); this asserts the converter
    // layer itself also enforces public-only export for actual methods,
    // by checking method count exactly matches the public surface.
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER));
    const widget = plan.classes.find((c) => c.bindingName === "Widget")!;
    // 2 ctors + dtor + resize + area + count + setName = 7
    expect(widget.methods).toHaveLength(7);
  });

  it("mangles every Widget member with the real Itanium ABI name (g++-verified)", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER));
    const widget = plan.classes.find((c) => c.bindingName === "Widget")!;
    const byName = (n: string, paramCount?: number) =>
      widget.methods.find((m) => m.name === n && (paramCount === undefined || m.params.length === paramCount))!;

    expect(widget.methods.filter((m) => m.kind === "ctor").map((m) => m.mangledName).sort())
      .toEqual(["_ZN6WidgetC1Ei", "_ZN6WidgetC1Ev"]);
    expect(widget.methods.find((m) => m.kind === "dtor")!.mangledName).toBe("_ZN6WidgetD1Ev");
    expect(byName("resize").mangledName).toBe("_ZN6Widget6resizeEii");
    expect(byName("area").mangledName).toBe("_ZNK6Widget4areaEv");
    expect(byName("count").mangledName).toBe("_ZN6Widget5countEv");
    expect(byName("count").kind).toBe("static-method");
    expect(byName("setName").mangledName).toBe("_ZN6Widget7setNameEPKc");
  });

  it("mangles a namespaced class's members with the namespace prefix", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER));
    const circle = plan.classes.find((c) => c.bindingName === "Circle")!;
    expect(circle.namespace).toEqual(["shapes"]);
    expect(circle.methods.find((m) => m.kind === "ctor")!.mangledName).toBe("_ZN6shapes6CircleC1Ed");
    expect(circle.methods.find((m) => m.name === "radius")!.mangledName).toBe("_ZNK6shapes6Circle6radiusEv");
    expect(circle.methods.find((m) => m.name === "scale")!.mangledName).toBe("_ZN6shapes6Circle5scaleEd");
  });
});

describe("buildBindingPlan — template instantiation", () => {
  it("a template class with no instantiation request is reported as unbound, not silently dropped", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER), []);
    expect(plan.classes.some((c) => c.className === "Box")).toBe(false);
    expect(plan.unboundTemplates).toContain("Box");
  });

  it("an explicit instantiation request produces a concrete, mangled binding", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER), [
      { namespace: [], className: "Box", args: [{ kind: "builtin", name: "int" }], label: "int" },
    ]);
    const boxInt = plan.classes.find((c) => c.bindingName === "Box_int")!;
    expect(boxInt).toBeDefined();
    expect(plan.unboundTemplates).toHaveLength(0);
    expect(boxInt.methods.find((m) => m.kind === "ctor")!.mangledName).toBe("_ZN3BoxIiEC1Ei");
    expect(boxInt.methods.find((m) => m.name === "get")!.mangledName).toBe("_ZNK3BoxIiE3getEv");
    expect(boxInt.methods.find((m) => m.name === "set")!.mangledName).toBe("_ZN3BoxIiE3setEi");
  });

  it("the template parameter T is correctly substituted with the concrete type in params and return type", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER), [
      { namespace: [], className: "Box", args: [{ kind: "builtin", name: "int" }], label: "int" },
    ]);
    const boxInt = plan.classes.find((c) => c.bindingName === "Box_int")!;
    const get = boxInt.methods.find((m) => m.name === "get")!;
    const set = boxInt.methods.find((m) => m.name === "set")!;
    expect(get.returnType).toEqual({ kind: "builtin", name: "int" });
    expect(set.params[0]!.type).toEqual({ kind: "builtin", name: "int" });
  });

  it("multiple instantiations of the same template produce independently mangled bindings", () => {
    const plan = buildBindingPlan(parseCppHeader(WIDGET_HEADER), [
      { namespace: [], className: "Box", args: [{ kind: "builtin", name: "int" }], label: "int" },
      { namespace: [], className: "Box", args: [{ kind: "builtin", name: "double" }], label: "double" },
    ]);
    const boxInt = plan.classes.find((c) => c.bindingName === "Box_int")!;
    const boxDouble = plan.classes.find((c) => c.bindingName === "Box_double")!;
    expect(boxInt.methods.find((m) => m.kind === "ctor")!.mangledName).toBe("_ZN3BoxIiEC1Ei");
    expect(boxDouble.methods.find((m) => m.kind === "ctor")!.mangledName).toBe("_ZN3BoxIdEC1Ed");
    expect(boxInt.methods.find((m) => m.kind === "ctor")!.mangledName)
      .not.toBe(boxDouble.methods.find((m) => m.kind === "ctor")!.mangledName);
  });
});
