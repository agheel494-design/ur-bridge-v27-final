// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Itanium C++ ABI Name Mangler
// Phase 7 — Native Ecosystem Hardening — C++ Bindings
// ─────────────────────────────────────────────────────────────────────────────
//
// Every expected mangled name below was captured from REAL g++ output, not
// derived from memory of the spec. Reproduction steps (g++ 13.3.0 on
// Ubuntu 24.04, x86-64 System V / Itanium C++ ABI):
//
//   1. Write the C++ snippet shown in each describe block's comment to a
//      .cpp file, giving every function/method a body and ensuring it is
//      actually called somewhere (unused inline methods are never emitted,
//      so they produce no symbol at all — this caught a real authoring
//      mistake during ground-truth capture).
//   2. `g++ -c file.cpp -o file.o`
//   3. `nm file.o | grep ' [TW] '` — T/W = defined (strong/weak) symbols.
//      The mangled name is the symbol name after the address+letter.
//
// This gives a verified oracle for the otherwise easy-to-get-subtly-wrong
// substitution-compression rules (`S_`, `S0_`, `S1_`, ...), rather than
// trusting hand-derivation of the spec.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  itaniumMangle,
  mangleFreeFunction,
  type CppType,
  type CppBuiltin,
  type CppFunctionToMangle,
} from "../../../src/ffi/bindgen/cpp/itanium-mangle.js";

const builtin = (name: CppBuiltin): CppType => ({ kind: "builtin", name });
const named = (...path: string[]): CppType => ({ kind: "named", path });
const ptr = (pointee: CppType): CppType => ({ kind: "pointer", pointee });
const ref = (pointee: CppType): CppType => ({ kind: "reference", pointee });
const cnst = (inner: CppType): CppType => ({ kind: "const", inner });

describe("itaniumMangle — free functions (g++-verified)", () => {
  // void foo(int) {}                          -> _Z3fooi
  // void foo(int, double) {}                  -> _Z3fooid
  // int bar() { return 0; }                   -> _Z3barv
  it("single int param", () => {
    expect(mangleFreeFunction("foo", [builtin("int")])).toBe("_Z3fooi");
  });
  it("overload distinguished by param types", () => {
    expect(mangleFreeFunction("foo", [builtin("int"), builtin("double")])).toBe("_Z3fooid");
  });
  it("no params -> 'v'", () => {
    expect(mangleFreeFunction("bar", [])).toBe("_Z3barv");
  });

  // long addLong(long, unsigned long) {}      -> _Z7addLonglm
  // bool flag(bool b) {}                      -> _Z4flagb
  // float fl(float f) {}                      -> _Z2flf
  // unsigned int ui(unsigned int u) {}        -> _Z2uij
  // short sh(short s) {}                      -> _Z2shs
  // unsigned char uc(unsigned char c) {}      -> _Z2uch
  // long long ll(long long x) {}              -> _Z2llx
  it("covers all builtin numeric type codes", () => {
    expect(mangleFreeFunction("addLong", [builtin("long"), builtin("unsigned long")])).toBe("_Z7addLonglm");
    expect(mangleFreeFunction("flag", [builtin("bool")])).toBe("_Z4flagb");
    expect(mangleFreeFunction("fl", [builtin("float")])).toBe("_Z2flf");
    expect(mangleFreeFunction("ui", [builtin("unsigned int")])).toBe("_Z2uij");
    expect(mangleFreeFunction("sh", [builtin("short")])).toBe("_Z2shs");
    expect(mangleFreeFunction("uc", [builtin("unsigned char")])).toBe("_Z2uch");
    expect(mangleFreeFunction("ll", [builtin("long long")])).toBe("_Z2llx");
  });
});

describe("itaniumMangle — namespaces", () => {
  // namespace ns1 { void baz(int) {} }                          -> _ZN3ns13bazEi
  // namespace ns1 { namespace ns2 { void qux(double, const char*) {} } } -> _ZN3ns13ns23quxEdPKc
  it("single-level namespace", () => {
    const fn: CppFunctionToMangle = { namespace: ["ns1"], classPath: [], name: "baz", params: [builtin("int")] };
    expect(itaniumMangle(fn)).toBe("_ZN3ns13bazEi");
  });
  it("nested namespaces with const char* param", () => {
    const fn: CppFunctionToMangle = {
      namespace: ["ns1", "ns2"], classPath: [], name: "qux",
      params: [builtin("double"), ptr(cnst(builtin("char")))],
    };
    expect(itaniumMangle(fn)).toBe("_ZN3ns13ns23quxEdPKc");
  });
});

describe("itaniumMangle — class members, ctors, dtors", () => {
  // class Widget {
  //  public:
  //   Widget() {}              -> _ZN6WidgetC1Ev
  //   Widget(int) {}           -> _ZN6WidgetC1Ei
  //   ~Widget() {}             -> _ZN6WidgetD1Ev
  //   void resize(int,int) {}  -> _ZN6Widget6resizeEii
  //   int area() const {}      -> _ZNK6Widget4areaEv
  //   static int count() {}    -> _ZN6Widget5countEv
  //   void setName(const char*) {} -> _ZN6Widget7setNameEPKc
  // };
  const cls = ["Widget"];

  it("default constructor", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "", memberKind: "ctor", params: [] }))
      .toBe("_ZN6WidgetC1Ev");
  });
  it("parameterized constructor (overload)", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "", memberKind: "ctor", params: [builtin("int")] }))
      .toBe("_ZN6WidgetC1Ei");
  });
  it("destructor", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "", memberKind: "dtor", params: [] }))
      .toBe("_ZN6WidgetD1Ev");
  });
  it("regular method with two int params", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "resize", params: [builtin("int"), builtin("int")] }))
      .toBe("_ZN6Widget6resizeEii");
  });
  it("const-qualified method: K goes right after N, before the prefix", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "area", isConst: true, params: [] }))
      .toBe("_ZNK6Widget4areaEv");
  });
  it("static method: no special marker, just a normal nested-name", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "count", params: [] }))
      .toBe("_ZN6Widget5countEv");
  });
  it("method taking const char*", () => {
    expect(itaniumMangle({ namespace: [], classPath: cls, name: "setName", params: [ptr(cnst(builtin("char")))] }))
      .toBe("_ZN6Widget7setNameEPKc");
  });

  // namespace shapes { class Circle {
  //  public:
  //   Circle(double) {}          -> _ZN6shapes6CircleC1Ed
  //   double radius() const {}   -> _ZNK6shapes6Circle6radiusEv
  //   void scale(double) {}      -> _ZN6shapes6Circle5scaleEd
  // };}
  it("namespaced class constructor and const method", () => {
    const ns = ["shapes"], c = ["Circle"];
    expect(itaniumMangle({ namespace: ns, classPath: c, name: "", memberKind: "ctor", params: [builtin("double")] }))
      .toBe("_ZN6shapes6CircleC1Ed");
    expect(itaniumMangle({ namespace: ns, classPath: c, name: "radius", isConst: true, params: [] }))
      .toBe("_ZNK6shapes6Circle6radiusEv");
    expect(itaniumMangle({ namespace: ns, classPath: c, name: "scale", params: [builtin("double")] }))
      .toBe("_ZN6shapes6Circle5scaleEd");
  });
});

describe("itaniumMangle — pointer / reference / const-qualified class types", () => {
  // void takesRef(Widget&) {}            -> _Z8takesRefR6Widget
  // void takesConstRef(const Widget&) {} -> _Z13takesConstRefRK6Widget
  // void takesPtr(Widget*) {}            -> _Z8takesPtrP6Widget
  // void takesConstPtr(const Widget*) {} -> _Z13takesConstPtrPK6Widget
  it("reference to a class", () => {
    expect(mangleFreeFunction("takesRef", [ref(named("Widget"))])).toBe("_Z8takesRefR6Widget");
  });
  it("const reference to a class", () => {
    expect(mangleFreeFunction("takesConstRef", [ref(cnst(named("Widget")))])).toBe("_Z13takesConstRefRK6Widget");
  });
  it("pointer to a class", () => {
    expect(mangleFreeFunction("takesPtr", [ptr(named("Widget"))])).toBe("_Z8takesPtrP6Widget");
  });
  it("pointer to const class", () => {
    expect(mangleFreeFunction("takesConstPtr", [ptr(cnst(named("Widget")))])).toBe("_Z13takesConstPtrPK6Widget");
  });
});

describe("itaniumMangle — Itanium substitution compression (the easy-to-get-wrong part)", () => {
  // void pairWidgets(Widget&, Widget&) {}        -> _Z11pairWidgetsR6WidgetS0_
  // void pairWidgetPtrs(Widget*, Widget*) {}     -> _Z14pairWidgetPtrsP6WidgetS0_
  it("repeated reference-to-class param: second occurrence backreferences the whole compound type (S0_)", () => {
    expect(mangleFreeFunction("pairWidgets", [ref(named("Widget")), ref(named("Widget"))]))
      .toBe("_Z11pairWidgetsR6WidgetS0_");
  });
  it("repeated pointer-to-class param: same compression", () => {
    expect(mangleFreeFunction("pairWidgetPtrs", [ptr(named("Widget")), ptr(named("Widget"))]))
      .toBe("_Z14pairWidgetPtrsP6WidgetS0_");
  });

  // namespace ns1 { namespace ns2 { class Deep { public: void go() {} }; } }
  // void useNs1Ns2Deep(ns1::ns2::Deep&, ns1::ns2::Deep&) {} -> _Z13useNs1Ns2DeepRN3ns13ns24DeepES2_
  it("repeated namespaced-class reference: nested-name registers 3 entries, compound type a 4th", () => {
    expect(mangleFreeFunction("useNs1Ns2Deep", [ref(named("ns1", "ns2", "Deep")), ref(named("ns1", "ns2", "Deep"))]))
      .toBe("_Z13useNs1Ns2DeepRN3ns13ns24DeepES2_");
  });

  // void twoStrs(const char*, const char*) {}   -> _Z7twoStrsPKcS0_
  // void mixedStrs(const char*, char*) {}       -> _Z9mixedStrsPKcPc
  it("repeated 'const char*' compresses even though char itself is a builtin", () => {
    expect(mangleFreeFunction("twoStrs", [ptr(cnst(builtin("char"))), ptr(cnst(builtin("char")))]))
      .toBe("_Z7twoStrsPKcS0_");
  });
  it("non-matching pointer types do not compress", () => {
    expect(mangleFreeFunction("mixedStrs", [ptr(cnst(builtin("char"))), ptr(builtin("char"))]))
      .toBe("_Z9mixedStrsPKcPc");
  });

  // namespace a { namespace b { class Foo { public: void m(int) {} }; } }
  // namespace a { namespace c { class Bar { public: void m(int) {} }; } }
  // void crossNs(a::b::Foo&, a::c::Bar&) {} -> _Z7crossNsRN1a1b3FooERNS_1c3BarE
  it("partial prefix substitution mid-construction: 'a' backreferences inside a different nested-name", () => {
    expect(mangleFreeFunction("crossNs", [ref(named("a", "b", "Foo")), ref(named("a", "c", "Bar"))]))
      .toBe("_Z7crossNsRN1a1b3FooERNS_1c3BarE");
  });

  // namespace a { namespace b { class Foo {
  //  public: void m(a::b::Foo&, a::b::Foo&, a::b::Foo&) {}
  // };}}
  // -> _ZN1a1b3Foo1mERS1_S2_S2_
  it("the function/method name itself is NOT registered as a substitution prefix — only its class/namespace qualifiers are", () => {
    // This is the subtlest rule in the whole mangler: if "a::b::Foo::m"
    // were (incorrectly) registered as a substitutable prefix alongside
    // "a", "a::b", "a::b::Foo", every index after it would be shifted by
    // one and every assertion below would be off-by-one wrong relative to
    // real g++ output.
    const fn: CppFunctionToMangle = {
      namespace: ["a", "b"], classPath: ["Foo"], name: "m",
      params: [ref(named("a", "b", "Foo")), ref(named("a", "b", "Foo")), ref(named("a", "b", "Foo"))],
    };
    expect(itaniumMangle(fn)).toBe("_ZN1a1b3Foo1mERS1_S2_S2_");
  });
});

describe("itaniumMangle — error handling", () => {
  it("throws for ctor/dtor without a classPath", () => {
    expect(() => itaniumMangle({ namespace: [], classPath: [], name: "", memberKind: "ctor", params: [] }))
      .toThrow();
    expect(() => itaniumMangle({ namespace: [], classPath: [], name: "", memberKind: "dtor", params: [] }))
      .toThrow();
  });
});

describe("itaniumMangle — template instantiation (explicit, monomorphized)", () => {
  const tmpl = (path: string[], args: CppType[]): CppType => ({ kind: "template-instance", path, args });

  // template<typename T> class Box { public: Box(T) {} T get() const; void set(T); T val; };
  // Box<int> bi(5); bi.get(); bi.set(6);     -> ctor _ZN3BoxIiEC1Ei, get _ZNK3BoxIiE3getEv, set _ZN3BoxIiE3setEi
  // Box<double> bd(1.0); bd.get();           -> ctor _ZN3BoxIdEC1Ed, get _ZNK3BoxIdE3getEv
  it("Box<int> constructor", () => {
    expect(itaniumMangle({
      namespace: [], classPath: ["Box"], classTemplateArgs: [builtin("int")],
      name: "", memberKind: "ctor", params: [builtin("int")],
    })).toBe("_ZN3BoxIiEC1Ei");
  });
  it("Box<double> constructor (distinct instantiation, distinct mangled name)", () => {
    expect(itaniumMangle({
      namespace: [], classPath: ["Box"], classTemplateArgs: [builtin("double")],
      name: "", memberKind: "ctor", params: [builtin("double")],
    })).toBe("_ZN3BoxIdEC1Ed");
  });
  it("Box<int>::set(int)", () => {
    expect(itaniumMangle({
      namespace: [], classPath: ["Box"], classTemplateArgs: [builtin("int")],
      name: "set", params: [builtin("int")],
    })).toBe("_ZN3BoxIiE3setEi");
  });
  it("Box<int>::get() const and Box<double>::get() const", () => {
    expect(itaniumMangle({
      namespace: [], classPath: ["Box"], classTemplateArgs: [builtin("int")],
      name: "get", isConst: true, params: [],
    })).toBe("_ZNK3BoxIiE3getEv");
    expect(itaniumMangle({
      namespace: [], classPath: ["Box"], classTemplateArgs: [builtin("double")],
      name: "get", isConst: true, params: [],
    })).toBe("_ZNK3BoxIdE3getEv");
  });

  // namespace ns1 { template<typename T> class Wrap { public: void put(T) {} }; }
  // ns1::Wrap<int> wi; wi.put(1);  -> _ZN3ns14WrapIiE3putEi
  it("namespaced template class method", () => {
    expect(itaniumMangle({
      namespace: ["ns1"], classPath: ["Wrap"], classTemplateArgs: [builtin("int")],
      name: "put", params: [builtin("int")],
    })).toBe("_ZN3ns14WrapIiE3putEi");
  });

  // void pairBoxInt(Box<int>&, Box<int>&) {} -> _Z10pairBoxIntR3BoxIiES1_
  it("repeated identical template instantiation compresses to a backreference", () => {
    expect(mangleFreeFunction("pairBoxInt", [
      ref(tmpl(["Box"], [builtin("int")])),
      ref(tmpl(["Box"], [builtin("int")])),
    ])).toBe("_Z10pairBoxIntR3BoxIiES1_");
  });

  // void mixedBox(Box<int>&, Box<double>&) {} -> _Z8mixedBoxR3BoxIiERS_IdE
  it("different instantiations of the same template reuse only the bare template-name backreference", () => {
    // The subtlest template case: "Box" itself becomes substitutable (S_)
    // after the first Box<int>, so Box<double> reuses "S_" for the name
    // but still spells out fresh template-args "IdE" — it must NOT
    // collapse to a full backreference, since Box<int> != Box<double>.
    expect(mangleFreeFunction("mixedBox", [
      ref(tmpl(["Box"], [builtin("int")])),
      ref(tmpl(["Box"], [builtin("double")])),
    ])).toBe("_Z8mixedBoxR3BoxIiERS_IdE");
  });
});
