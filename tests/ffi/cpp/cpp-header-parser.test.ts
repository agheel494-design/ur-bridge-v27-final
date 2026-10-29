// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: C++ Header Parser
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { parseCppHeader, type CppClassDecl, type CppFunctionDecl } from "../../../src/ffi/bindgen/cpp/cpp-header-parser.js";

function classOf(decls: ReturnType<typeof parseCppHeader>["decls"], name: string): CppClassDecl {
  const d = decls.find((d) => d.declKind === "class" && d.name === name);
  if (!d || d.declKind !== "class") throw new Error(`class ${name} not found`);
  return d;
}

describe("parseCppHeader — namespaces", () => {
  it("parses a single-level namespace", () => {
    const r = parseCppHeader(`namespace ns1 { void baz(int x); }`);
    expect(r.errors).toHaveLength(0);
    expect(r.decls).toHaveLength(1);
    const fn = r.decls[0] as CppFunctionDecl;
    expect(fn.declKind).toBe("function");
    expect(fn.namespace).toEqual(["ns1"]);
    expect(fn.name).toBe("baz");
  });

  it("parses nested namespaces", () => {
    const r = parseCppHeader(`namespace ns1 { namespace ns2 { void qux(); } }`);
    expect(r.errors).toHaveLength(0);
    const fn = r.decls[0] as CppFunctionDecl;
    expect(fn.namespace).toEqual(["ns1", "ns2"]);
  });

  it("parses multiple declarations across reopened namespaces", () => {
    const r = parseCppHeader(`
      namespace shapes { void a(); }
      namespace shapes { void b(); }
    `);
    expect(r.errors).toHaveLength(0);
    expect(r.decls).toHaveLength(2);
    expect((r.decls[0] as CppFunctionDecl).namespace).toEqual(["shapes"]);
    expect((r.decls[1] as CppFunctionDecl).namespace).toEqual(["shapes"]);
  });
});

describe("parseCppHeader — basic classes", () => {
  const header = `
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
      const char* name_;
    };
  `;

  it("parses with zero errors", () => {
    expect(parseCppHeader(header).errors).toHaveLength(0);
  });

  it("captures the class name and method count", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    expect(cls.isOpaque).toBe(false);
    // 2 ctors + dtor + resize + area + count + setName = 7
    expect(cls.methods).toHaveLength(7);
  });

  it("recognizes both constructor overloads", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    const ctors = cls.methods.filter((m) => m.memberKind === "ctor");
    expect(ctors).toHaveLength(2);
    expect(ctors[0]?.params).toHaveLength(0);
    expect(ctors[1]?.params).toHaveLength(1);
  });

  it("recognizes the destructor", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    const dtors = cls.methods.filter((m) => m.memberKind === "dtor");
    expect(dtors).toHaveLength(1);
  });

  it("recognizes a const-qualified method", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    const area = cls.methods.find((m) => m.name === "area")!;
    expect(area.isConst).toBe(true);
    expect(area.returnType).toEqual({ kind: "builtin", name: "int" });
  });

  it("recognizes a static method", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    const count = cls.methods.find((m) => m.name === "count")!;
    expect(count.isStatic).toBe(true);
  });

  it("parses a 'const char*' parameter as pointer-to-const-char", () => {
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    const setName = cls.methods.find((m) => m.name === "setName")!;
    expect(setName.params[0]!.type).toEqual({
      kind: "pointer", pointee: { kind: "const", inner: { kind: "builtin", name: "char" } },
    });
  });

  it("silently skips private data members instead of erroring", () => {
    // id_ and name_ are plain data members, not methods — opaque-handle
    // FFI bindings never expose raw field layout, so the parser must not
    // choke on (or cascade errors from) declarations with no parens.
    const cls = classOf(parseCppHeader(header).decls, "Widget");
    expect(cls.methods.some((m) => m.name === "id_" || m.name === "name_")).toBe(false);
  });

  it("treats a forward declaration as an opaque class with no methods", () => {
    const r = parseCppHeader(`class Handle;`);
    expect(r.errors).toHaveLength(0);
    const cls = classOf(r.decls, "Handle");
    expect(cls.isOpaque).toBe(true);
    expect(cls.methods).toHaveLength(0);
  });

  it("struct members default to public access; class members default to private", () => {
    const r = parseCppHeader(`
      struct Point { int getX(); };
      class Secret { int getY(); };
    `);
    expect(r.errors).toHaveLength(0);
    const point = classOf(r.decls, "Point");
    const secret = classOf(r.decls, "Secret");
    expect(point.methods.find((m) => m.name === "getX")?.access).toBe("public");
    expect(secret.methods.find((m) => m.name === "getY")?.access).toBe("private");
  });
});

describe("parseCppHeader — namespaced classes", () => {
  it("parses a class inside a namespace with its own ctor/methods", () => {
    const r = parseCppHeader(`
      namespace shapes {
        class Circle {
        public:
          Circle(double radius);
          double radius() const;
          void scale(double factor);
        };
      }
    `);
    expect(r.errors).toHaveLength(0);
    const cls = classOf(r.decls, "Circle");
    expect(cls.namespace).toEqual(["shapes"]);
    expect(cls.methods).toHaveLength(3);
  });
});

describe("parseCppHeader — function overloading", () => {
  it("parses two free functions with the same name and different params", () => {
    const r = parseCppHeader(`
      void foo(int x);
      void foo(int x, double y);
    `);
    expect(r.errors).toHaveLength(0);
    expect(r.decls).toHaveLength(2);
    expect((r.decls[0] as CppFunctionDecl).params).toHaveLength(1);
    expect((r.decls[1] as CppFunctionDecl).params).toHaveLength(2);
  });
});

describe("parseCppHeader — simple template classes", () => {
  it("parses a single-type-parameter template class declaration", () => {
    const r = parseCppHeader(`
      template<typename T>
      class Box {
      public:
        Box(T value);
        T get() const;
        void set(T value);
      };
    `);
    expect(r.errors).toHaveLength(0);
    const cls = classOf(r.decls, "Box");
    expect(cls.isTemplate).toBe(true);
    expect(cls.templateParams).toEqual(["T"]);
    expect(cls.methods).toHaveLength(3);
    // The template parameter is parsed as a placeholder named type; the
    // converter substitutes it with a concrete type at instantiation time.
    expect(cls.methods.find((m) => m.name === "get")?.returnType).toEqual({ kind: "named", path: ["T"] });
  });

  it("parses a namespaced template class", () => {
    const r = parseCppHeader(`
      namespace ns1 { template<typename T> class Wrap { public: void put(T v); }; }
    `);
    expect(r.errors).toHaveLength(0);
    const cls = classOf(r.decls, "Wrap");
    expect(cls.namespace).toEqual(["ns1"]);
    expect(cls.isTemplate).toBe(true);
  });

  it("parses a type using an already-instantiated template as a parameter, e.g. Box<int>&", () => {
    const r = parseCppHeader(`void pairBoxInt(Box<int>& a, Box<int>& b);`);
    expect(r.errors).toHaveLength(0);
    const fn = r.decls[0] as CppFunctionDecl;
    expect(fn.params[0]!.type).toEqual({
      kind: "reference",
      pointee: { kind: "template-instance", path: ["Box"], args: [{ kind: "builtin", name: "int" }] },
    });
  });
});

describe("parseCppHeader — pointer/reference/const types", () => {
  it("distinguishes Widget&, const Widget&, Widget*, const Widget*", () => {
    const r = parseCppHeader(`
      void takesRef(Widget& w);
      void takesConstRef(const Widget& w);
      void takesPtr(Widget* w);
      void takesConstPtr(const Widget* w);
    `);
    expect(r.errors).toHaveLength(0);
    const [ref, constRef, ptr, constPtr] = r.decls as CppFunctionDecl[];
    expect(ref!.params[0]!.type).toEqual({ kind: "reference", pointee: { kind: "named", path: ["Widget"] } });
    expect(constRef!.params[0]!.type).toEqual({ kind: "reference", pointee: { kind: "const", inner: { kind: "named", path: ["Widget"] } } });
    expect(ptr!.params[0]!.type).toEqual({ kind: "pointer", pointee: { kind: "named", path: ["Widget"] } });
    expect(constPtr!.params[0]!.type).toEqual({ kind: "pointer", pointee: { kind: "const", inner: { kind: "named", path: ["Widget"] } } });
  });
});

describe("parseCppHeader — error recovery", () => {
  it("reports an error and recovers to parse subsequent declarations", () => {
    const r = parseCppHeader(`
      void broken(int x int y);
      void wellFormed(int z);
    `);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.decls.some((d) => d.declKind === "function" && d.name === "wellFormed")).toBe(true);
  });

  it("reports an error for a mismatched destructor name", () => {
    const r = parseCppHeader(`class Foo { public: ~Bar(); };`);
    expect(r.errors.some((e) => e.message.includes("does not match class"))).toBe(true);
  });
});
