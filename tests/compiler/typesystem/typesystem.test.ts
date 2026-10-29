// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — Type System Tests (ported from RC2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Ported from RC2's tests/typesystem/typesystem.test.ts (165 original tests)
// per FRONTEND_TEST_MIGRATION_REPORT.md.
//
// 94 of the 165 tests below are KEPT VERBATIM (zero syntax change) because
// they call typeToString/typesEqual/isAssignable/binaryOpResultType/
// resolveTypeRef/TypeEnv directly with hand-constructed type objects and
// never touch the Parser. The Type Checker tests (parser-dependent) are
// rewritten to UR 1.0 syntax (function/end instead of fn/{}). Tests
// exercising generics (Array<Int>), ternary, const, or try/catch are
// deferred — see the "Deferred tests" block at the end and
// FRONTEND_TEST_MIGRATION_REPORT.md.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { TCODES } from "../../../src/compiler/typesystem/type-diagnostics.js";
import {
  T_INT, T_FLOAT, T_BOOL, T_CHAR, T_STRING, T_UNKNOWN, T_ERROR,
  tArray, tMap, tSet, tTuple, tOptional, tFunction,
  typeToString, typesEqual, isError, isUnknown, isNumeric,
} from "../../../src/compiler/typesystem/types.js";
import {
  isAssignable,
  binaryOpResultType, unaryOpResultType,
} from "../../../src/compiler/typesystem/compatibility.js";
import { resolveTypeRef, TypeEnv } from "../../../src/compiler/typesystem/type-env.js";
import type { TypeRef } from "../../../src/compiler/frontend/ast.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ast(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length > 0) throw new Error(`parse errors: ${errors.map(e => e.message).join("; ")}`);
  return program;
}

function codes(src: string): string[] {
  return typeCheck(ast(src)).diagnostics.map(d => d.code);
}

function clean(src: string): boolean {
  const r = typeCheck(ast(src));
  return r.valid && r.diagnostics.length === 0;
}

function msgs(src: string): string[] {
  return typeCheck(ast(src)).diagnostics.map(d => d.message);
}

function mkRef(name: string, args: TypeRef[] = []): TypeRef {
  const span = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 };
  return { kind: "TypeRef", name, typeArgs: args, span };
}

// ─────────────────────────────────────────────────────────────────────────────
// Type representation — kept verbatim, no parser dependency (15 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("types — display (typeToString)", () => {
  it("Int", () => expect(typeToString(T_INT)).toBe("Int"));
  it("Float", () => expect(typeToString(T_FLOAT)).toBe("Float"));
  it("Bool", () => expect(typeToString(T_BOOL)).toBe("Bool"));
  it("Char", () => expect(typeToString(T_CHAR)).toBe("Char"));
  it("String", () => expect(typeToString(T_STRING)).toBe("String"));
  it("Unknown", () => expect(typeToString(T_UNKNOWN)).toBe("Unknown"));
  it("Error sentinel", () => expect(typeToString(T_ERROR)).toBe("<error>"));
  it("Array<Int>", () => expect(typeToString(tArray(T_INT))).toBe("Array<Int>"));
  it("Array<Array<Bool>>", () => expect(typeToString(tArray(tArray(T_BOOL)))).toBe("Array<Array<Bool>>"));
  it("Map<String, Int>", () => expect(typeToString(tMap(T_STRING, T_INT))).toBe("Map<String, Int>"));
  it("Set<Float>", () => expect(typeToString(tSet(T_FLOAT))).toBe("Set<Float>"));
  it("Tuple<Int, Bool>", () => expect(typeToString(tTuple([T_INT, T_BOOL]))).toBe("Tuple<Int, Bool>"));
  it("Tuple<> (empty)", () => expect(typeToString(tTuple([]))).toBe("Tuple<>"));
  it("Optional<Int>", () => expect(typeToString(tOptional(T_INT))).toBe("Optional<Int>"));
  it("fn(Int, Float) -> Bool", () => expect(typeToString(tFunction([T_INT, T_FLOAT], T_BOOL))).toBe("fn(Int, Float) -> Bool"));
});

describe("types — structural equality (typesEqual)", () => {
  it("Int == Int", () => expect(typesEqual(T_INT, T_INT)).toBe(true));
  it("Int != Float", () => expect(typesEqual(T_INT, T_FLOAT)).toBe(false));
  it("Bool != String", () => expect(typesEqual(T_BOOL, T_STRING)).toBe(false));
  it("Array<Int> == Array<Int>", () => expect(typesEqual(tArray(T_INT), tArray(T_INT))).toBe(true));
  it("Array<Int> != Array<Float>", () => expect(typesEqual(tArray(T_INT), tArray(T_FLOAT))).toBe(false));
  it("Map<String,Int> == Map<String,Int>", () => expect(typesEqual(tMap(T_STRING, T_INT), tMap(T_STRING, T_INT))).toBe(true));
  it("Map<String,Int> != Map<Int,String>", () => expect(typesEqual(tMap(T_STRING, T_INT), tMap(T_INT, T_STRING))).toBe(false));
  it("Optional<Int> == Optional<Int>", () => expect(typesEqual(tOptional(T_INT), tOptional(T_INT))).toBe(true));
  it("Optional<Int> != Optional<Bool>", () => expect(typesEqual(tOptional(T_INT), tOptional(T_BOOL))).toBe(false));
  it("Tuple<Int,Bool> == Tuple<Int,Bool>", () => expect(typesEqual(tTuple([T_INT, T_BOOL]), tTuple([T_INT, T_BOOL]))).toBe(true));
  it("Tuple<Int,Bool> != Tuple<Bool,Int>", () => expect(typesEqual(tTuple([T_INT, T_BOOL]), tTuple([T_BOOL, T_INT]))).toBe(false));
  it("fn(Int)->Bool == fn(Int)->Bool", () => expect(typesEqual(tFunction([T_INT], T_BOOL), tFunction([T_INT], T_BOOL))).toBe(true));
});

describe("types — predicates", () => {
  it("isError on T_ERROR", () => expect(isError(T_ERROR)).toBe(true));
  it("isError on T_INT", () => expect(isError(T_INT)).toBe(false));
  it("isUnknown on T_UNKNOWN", () => expect(isUnknown(T_UNKNOWN)).toBe(true));
  it("isUnknown on T_BOOL", () => expect(isUnknown(T_BOOL)).toBe(false));
  it("isNumeric on Int", () => expect(isNumeric(T_INT)).toBe(true));
  it("isNumeric on Float", () => expect(isNumeric(T_FLOAT)).toBe(true));
  it("isNumeric on Bool", () => expect(isNumeric(T_BOOL)).toBe(false));
  it("isNumeric on String", () => expect(isNumeric(T_STRING)).toBe(false));
});

// ─────────────────────────────────────────────────────────────────────────────
// Type compatibility — kept verbatim, no parser dependency (44 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("compatibility — isAssignable", () => {
  it("Int → Int", () => expect(isAssignable(T_INT, T_INT)).toBe(true));
  it("Int → Float (numeric widening)", () => expect(isAssignable(T_INT, T_FLOAT)).toBe(true));
  it("Float → Int (no widening)", () => expect(isAssignable(T_FLOAT, T_INT)).toBe(false));
  it("Bool → Bool", () => expect(isAssignable(T_BOOL, T_BOOL)).toBe(true));
  it("Bool → Int (false)", () => expect(isAssignable(T_BOOL, T_INT)).toBe(false));
  it("String → String", () => expect(isAssignable(T_STRING, T_STRING)).toBe(true));
  it("Int → Optional<Int>", () => expect(isAssignable(T_INT, tOptional(T_INT))).toBe(true));
  it("Int → Optional<Float>", () => expect(isAssignable(T_INT, tOptional(T_FLOAT))).toBe(true));
  it("Float → Optional<Int> (false)", () => expect(isAssignable(T_FLOAT, tOptional(T_INT))).toBe(false));
  it("Error → anything (suppress cascade)", () => expect(isAssignable(T_ERROR, T_INT)).toBe(true));
  it("anything → Error (suppress cascade)", () => expect(isAssignable(T_INT, T_ERROR)).toBe(true));
  it("Unknown → anything", () => expect(isAssignable(T_UNKNOWN, T_INT)).toBe(true));
  it("anything → Unknown", () => expect(isAssignable(T_INT, T_UNKNOWN)).toBe(true));
  it("Array<Int> → Array<Int>", () => expect(isAssignable(tArray(T_INT), tArray(T_INT))).toBe(true));
  it("Array<Int> → Array<Float> (false)", () => expect(isAssignable(tArray(T_INT), tArray(T_FLOAT))).toBe(false));
});

describe("compatibility — binary operators", () => {
  it("Int + Int = Int", () => expect(typesEqual(binaryOpResultType("+", T_INT, T_INT), T_INT)).toBe(true));
  it("Int + Float = Float", () => expect(typesEqual(binaryOpResultType("+", T_INT, T_FLOAT), T_FLOAT)).toBe(true));
  it("Float + Float = Float", () => expect(typesEqual(binaryOpResultType("+", T_FLOAT, T_FLOAT), T_FLOAT)).toBe(true));
  it("String + String = Error (Compiler & Runtime Stabilization FIX: was incorrectly accepted, but the C Backend cannot actually concatenate strings — it emitted invalid pointer arithmetic; fixed to reject clearly at the type level, see compatibility.ts's own comment)", () => expect(binaryOpResultType("+", T_STRING, T_STRING).kind).toBe("Error"));
  it("Bool + Int = Error", () => expect(binaryOpResultType("+", T_BOOL, T_INT).kind).toBe("Error"));
  it("Int - Int = Int", () => expect(typesEqual(binaryOpResultType("-", T_INT, T_INT), T_INT)).toBe(true));
  it("Int * Float = Float", () => expect(typesEqual(binaryOpResultType("*", T_INT, T_FLOAT), T_FLOAT)).toBe(true));
  it("Int / Int = Int", () => expect(typesEqual(binaryOpResultType("/", T_INT, T_INT), T_INT)).toBe(true));
  it("Int / Float = Float", () => expect(typesEqual(binaryOpResultType("/", T_INT, T_FLOAT), T_FLOAT)).toBe(true));
  it("Int ** Int = Float", () => expect(typesEqual(binaryOpResultType("**", T_INT, T_INT), T_FLOAT)).toBe(true));
  it("Int < Int = Bool", () => expect(typesEqual(binaryOpResultType("<", T_INT, T_INT), T_BOOL)).toBe(true));
  it("String <= String = Bool", () => expect(typesEqual(binaryOpResultType("<=", T_STRING, T_STRING), T_BOOL)).toBe(true));
  it("Bool < Bool = Error", () => expect(binaryOpResultType("<", T_BOOL, T_BOOL).kind).toBe("Error"));
  it("Int == Int = Bool", () => expect(typesEqual(binaryOpResultType("==", T_INT, T_INT), T_BOOL)).toBe(true));
  it("Bool == Bool = Bool", () => expect(typesEqual(binaryOpResultType("==", T_BOOL, T_BOOL), T_BOOL)).toBe(true));
  it("Bool && Bool = Bool", () => expect(typesEqual(binaryOpResultType("&&", T_BOOL, T_BOOL), T_BOOL)).toBe(true));
  it("Bool || Bool = Bool", () => expect(typesEqual(binaryOpResultType("||", T_BOOL, T_BOOL), T_BOOL)).toBe(true));
  it("Int && Bool = Error", () => expect(binaryOpResultType("&&", T_INT, T_BOOL).kind).toBe("Error"));
  it("Int & Int = Int", () => expect(typesEqual(binaryOpResultType("&", T_INT, T_INT), T_INT)).toBe(true));
  it("Bool & Bool = Error", () => expect(binaryOpResultType("&", T_BOOL, T_BOOL).kind).toBe("Error"));
  it("Int << Int = Int", () => expect(typesEqual(binaryOpResultType("<<", T_INT, T_INT), T_INT)).toBe(true));
});

describe("compatibility — unary operators", () => {
  it("-Int = Int", () => expect(typesEqual(unaryOpResultType("-", T_INT), T_INT)).toBe(true));
  it("-Float = Float", () => expect(typesEqual(unaryOpResultType("-", T_FLOAT), T_FLOAT)).toBe(true));
  it("-Bool = Error", () => expect(unaryOpResultType("-", T_BOOL).kind).toBe("Error"));
  it("+Int = Int", () => expect(typesEqual(unaryOpResultType("+", T_INT), T_INT)).toBe(true));
  it("!Bool = Bool", () => expect(typesEqual(unaryOpResultType("!", T_BOOL), T_BOOL)).toBe(true));
  it("!Int = Error", () => expect(unaryOpResultType("!", T_INT).kind).toBe("Error"));
  it("~Int = Int", () => expect(typesEqual(unaryOpResultType("~", T_INT), T_INT)).toBe(true));
  it("~Bool = Error", () => expect(unaryOpResultType("~", T_BOOL).kind).toBe("Error"));
  it("Error propagates through unary", () => expect(unaryOpResultType("-", T_ERROR).kind).toBe("Error"));
  it("Unknown propagates through unary", () => expect(unaryOpResultType("-", T_UNKNOWN).kind).toBe("Unknown"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Type resolution — kept verbatim, builds TypeRef directly (12 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("type resolution (resolveTypeRef)", () => {
  it("resolves Int", () => expect(resolveTypeRef(mkRef("Int")).kind).toBe("Primitive"));
  it("resolves Float", () => expect(resolveTypeRef(mkRef("Float")).kind).toBe("Primitive"));
  it("resolves Bool", () => expect(resolveTypeRef(mkRef("Bool")).kind).toBe("Primitive"));
  it("resolves Char", () => expect(resolveTypeRef(mkRef("Char")).kind).toBe("Primitive"));
  it("resolves String", () => expect(resolveTypeRef(mkRef("String")).kind).toBe("Primitive"));
  it("resolves lowercase 'int' (UR 1.0 canonical form)", () => expect(resolveTypeRef(mkRef("int")).kind).toBe("Primitive"));
  it("resolves Array<Int>", () => {
    const t = resolveTypeRef(mkRef("Array", [mkRef("Int")]));
    expect(t.kind).toBe("Array");
    if (t.kind === "Array") expect(t.element).toEqual(T_INT);
  });
  it("resolves Map<String, Int>", () => {
    const t = resolveTypeRef(mkRef("Map", [mkRef("String"), mkRef("Int")]));
    expect(t.kind).toBe("Map");
    if (t.kind === "Map") {
      expect(t.key).toEqual(T_STRING);
      expect(t.value).toEqual(T_INT);
    }
  });
  it("resolves Set<Bool>", () => {
    const t = resolveTypeRef(mkRef("Set", [mkRef("Bool")]));
    expect(t.kind).toBe("Set");
  });
  it("resolves Optional<Float>", () => {
    const t = resolveTypeRef(mkRef("Optional", [mkRef("Float")]));
    expect(t.kind).toBe("Optional");
    if (t.kind === "Optional") expect(t.inner).toEqual(T_FLOAT);
  });
  it("resolves unknown type → calls onUnknown callback", () => {
    let called = "";
    resolveTypeRef(mkRef("Bogus"), name => { called = name; });
    expect(called).toBe("Bogus");
  });
  it("resolves unknown type → returns T_ERROR", () => {
    const t = resolveTypeRef(mkRef("UnknownName"), () => {});
    expect(t.kind).toBe("Error");
  });
});

describe("TypeEnv — bindings", () => {
  it("set and get a binding", () => {
    const env = new TypeEnv();
    env.set("x", T_INT);
    expect(env.get("x")).toEqual(T_INT);
  });
  it("returns undefined for unknown name", () => {
    const env = new TypeEnv();
    expect(env.get("y")).toBeUndefined();
  });
  it("child scope inherits from parent", () => {
    const parent = new TypeEnv();
    parent.set("x", T_INT);
    const child = parent.child();
    expect(child.get("x")).toEqual(T_INT);
  });
  it("child scope can shadow parent binding", () => {
    const parent = new TypeEnv();
    parent.set("x", T_INT);
    const child = parent.child();
    child.set("x", T_BOOL);
    expect(child.get("x")).toEqual(T_BOOL);
    expect(parent.get("x")).toEqual(T_INT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type checker — valid programs (16 of 28 ported to UR 1.0 syntax)
// ─────────────────────────────────────────────────────────────────────────────

describe("type checker — valid programs", () => {
  it("function returning int literal", () => expect(clean("function f(): int\n  return 1\nend\n")).toBe(true));
  it("function returning float literal", () => expect(clean("function f(): float\n  return 3.14\nend\n")).toBe(true));
  it("function returning bool literal", () => expect(clean("function f(): bool\n  return true\nend\n")).toBe(true));
  it("function returning string literal", () => expect(clean('function f(): string\n  return "hello"\nend\n')).toBe(true));
  it("int + int inferred", () => expect(clean("function f(): int\n  return 1 + 2\nend\n")).toBe(true));
  it("int widens to float return", () => expect(clean("function f(): float\n  return 1\nend\n")).toBe(true));
  it("let infers from initializer", () => expect(clean("function f(): int\n  let x = 1\n  return x\nend\n")).toBe(true));
  it("let with explicit int annotation", () => expect(clean("function f(): int\n  let x: int = 1\n  return x\nend\n")).toBe(true));
  it("param passed through", () => expect(clean("function f(a: int): int\n  return a\nend\n")).toBe(true));
  it("two int params added", () => expect(clean("function f(a: int, b: int): int\n  return a + b\nend\n")).toBe(true));
  it("bool condition in if", () => expect(clean("function f(b: bool): int\n  if b\n    return 1\n  end\n  return 0\nend\n")).toBe(true));
  it("string comparison (== ) produces bool", () => expect(clean('function f(): bool\n  return "a" == "b"\nend\n')).toBe(true));
  it("int < int produces bool", () => expect(clean("function f(): bool\n  return 1 < 2\nend\n")).toBe(true));
  it("int == int produces bool", () => expect(clean("function f(): bool\n  return 1 == 1\nend\n")).toBe(true));
  it("if-expression with int branches (UR 1.0's ternary equivalent)", () => {
    expect(clean("function f(b: bool): int\n  return if b\n    1\n  else\n    2\n  end\nend\n")).toBe(true);
  });
  it("assignment updates type in env", () => expect(clean("function f(): int\n  let x: int = 1\n  x = 2\n  return x\nend\n")).toBe(true));
  it("call with correct int arg", () => expect(clean("function g(a: int): int\n  return a\nend\nfunction f(): int\n  return g(1)\nend\n")).toBe(true));
  it("call with float arg where int expected (widening false)", () => {
    // float is NOT assignable to int — this should fail
    expect(clean("function g(a: int): int\n  return a\nend\nfunction f(): int\n  return g(1.5)\nend\n")).toBe(false);
  });
  it("while loop body checked", () => expect(clean("function f()\n  while true\n    break\n  end\nend\n")).toBe(true));
  it("for loop body checked", () => expect(clean("function f(xs)\n  for x in xs\n    return x\n  end\nend\n")).toBe(true));
  it("empty function is valid", () => expect(clean("function f()\nend\n")).toBe(true));
  it("multiple functions all clean", () => expect(clean("function a(): int\n  return 1\nend\nfunction b(): int\n  return a()\nend\n")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// Type checker — errors (35 of 33 ported + casing regression check)
// ─────────────────────────────────────────────────────────────────────────────

describe("type checker — TY2003 return type mismatch", () => {
  it("int returned from string fn", () => expect(codes("function f(): string\n  return 1\nend\n")).toContain(TCODES.RETURN_TYPE_MISMATCH));
  it("float returned from int fn", () => expect(codes("function f(): int\n  return 1.5\nend\n")).toContain(TCODES.RETURN_TYPE_MISMATCH));
  it("bool returned from int fn", () => expect(codes("function f(): int\n  return true\nend\n")).toContain(TCODES.RETURN_TYPE_MISMATCH));
  it("string returned from bool fn", () => expect(codes('function f(): bool\n  return "hi"\nend\n')).toContain(TCODES.RETURN_TYPE_MISMATCH));
  it("message includes actual and expected types", () => {
    const m = msgs("function f(): string\n  return 1\nend\n");
    expect(m[0]).toContain("Int");
    expect(m[0]).toContain("String");
  });
});

describe("type checker — TY2004 condition not bool", () => {
  it("int condition in if", () => expect(codes("function f()\n  if 1\n  end\nend\n")).toContain(TCODES.CONDITION_NOT_BOOL));
  it("string condition in if", () => expect(codes('function f()\n  if "x"\n  end\nend\n')).toContain(TCODES.CONDITION_NOT_BOOL));
  it("float condition in while", () => expect(codes("function f()\n  while 1.0\n  end\nend\n")).toContain(TCODES.CONDITION_NOT_BOOL));
  it("message mentions Bool", () => expect(msgs("function f()\n  if 1\n  end\nend\n")[0]).toContain("Bool"));
  it("bool condition is fine", () => expect(codes("function f(b: bool)\n  if b\n  end\nend\n")).not.toContain(TCODES.CONDITION_NOT_BOOL));
});

describe("type checker — TY3001/TY3002 operator errors", () => {
  it("bool + int", () => expect(codes("function f()\n  return true + 1\nend\n")).toContain(TCODES.OPERATOR_TYPE_ERROR));
  it("string * int", () => expect(codes('function f()\n  return "a" * 2\nend\n')).toContain(TCODES.OPERATOR_TYPE_ERROR));
  it("string + string (Compiler & Runtime Stabilization FIX — was incorrectly accepted, silently miscompiled by the C Backend into invalid pointer arithmetic; now correctly rejected at the type level)", () => expect(codes('function f()\n  return "a" + "b"\nend\n')).toContain(TCODES.OPERATOR_TYPE_ERROR));
  it("bool < bool", () => expect(codes("function f(): bool\n  return true < false\nend\n")).toContain(TCODES.OPERATOR_TYPE_ERROR));
  it("int && bool", () => expect(codes("function f(): bool\n  return 1 && true\nend\n")).toContain(TCODES.OPERATOR_TYPE_ERROR));
  it("!int", () => expect(codes("function f()\n  return !1\nend\n")).toContain(TCODES.UNARY_TYPE_ERROR));
  it("-string", () => expect(codes('function f()\n  return -"x"\nend\n')).toContain(TCODES.UNARY_TYPE_ERROR));
  it("message includes operator", () => {
    const m = msgs("function f()\n  return true + 1\nend\n");
    expect(m[0]).toContain("+");
  });
});

describe("type checker — TY2002 assignment type mismatch", () => {
  it("assign string to int var", () => expect(codes('function f()\n  let x: int = 1\n  x = "hi"\nend\n')).toContain(TCODES.ASSIGN_TYPE_MISMATCH));
  it("assign bool to float var", () => expect(codes("function f()\n  let x: float = 1.0\n  x = true\nend\n")).toContain(TCODES.ASSIGN_TYPE_MISMATCH));
  it("int initializer to int var is fine", () => expect(codes("function f()\n  let x: int = 42\nend\n")).not.toContain(TCODES.ASSIGN_TYPE_MISMATCH));
});

describe("type checker — TY5002 call argument type mismatch", () => {
  it("bool for int param", () => expect(codes("function g(a: int)\nend\nfunction f()\n  g(true)\nend\n")).toContain(TCODES.CALL_ARG_TYPE_MISMATCH));
  it("string for int param", () => expect(codes('function g(a: int)\nend\nfunction f()\n  g("hi")\nend\n')).toContain(TCODES.CALL_ARG_TYPE_MISMATCH));
  it("float for bool param", () => expect(codes("function g(a: bool)\nend\nfunction f()\n  g(1.5)\nend\n")).toContain(TCODES.CALL_ARG_TYPE_MISMATCH));
  it("int for int param is fine", () => expect(codes("function g(a: int)\nend\nfunction f()\n  g(1)\nend\n")).not.toContain(TCODES.CALL_ARG_TYPE_MISMATCH));
  it("int for float param is fine (widening)", () => expect(codes("function g(a: float)\nend\nfunction f()\n  g(1)\nend\n")).not.toContain(TCODES.CALL_ARG_TYPE_MISMATCH));
});

describe("type checker — TY1001 unknown type name", () => {
  it("unknown return type", () => expect(codes("function f(): Bogus\nend\n")).toContain(TCODES.UNKNOWN_TYPE));
  it("unknown param type", () => expect(codes("function f(a: Bogus)\nend\n")).toContain(TCODES.UNKNOWN_TYPE));
  it("unknown var annotation", () => expect(codes("function f()\n  let x: Bogus = 1\nend\n")).toContain(TCODES.UNKNOWN_TYPE));
  it("message contains the unknown name", () => expect(msgs("function f(): Bogus\nend\n")[0]).toContain("Bogus"));
  it("all UR 1.0 tier-1 type names resolve without TY1001 (REGRESSION: lowercase casing)", () => {
    // Regression: see FRONTEND_TEST_MIGRATION_REPORT.md "Casing mismatch
    // between ast.ts canonical names and TypeSystem's internal
    // PrimitiveKind" and the fix in type-env.ts resolveTypeRef().
    for (const name of ["int", "float", "bool", "string"]) {
      expect(codes(`function f(a: ${name})\nend\n`)).not.toContain(TCODES.UNKNOWN_TYPE);
    }
  });

  it("REGRESSION: int -> Int at the single translation point (type-env.ts LOWERCASE_PRIMITIVE)", () => {
    expect(resolveTypeRef(mkRef("int")).kind).toBe("Primitive");
    expect(resolveTypeRef(mkRef("int"))).toEqual(T_INT);
  });
  it("REGRESSION: float -> Float at the single translation point", () => {
    expect(resolveTypeRef(mkRef("float"))).toEqual(T_FLOAT);
  });
  it("REGRESSION: bool -> Bool at the single translation point", () => {
    expect(resolveTypeRef(mkRef("bool"))).toEqual(T_BOOL);
  });
  it("REGRESSION: char -> Char at the single translation point", () => {
    expect(resolveTypeRef(mkRef("char"))).toEqual(T_CHAR);
  });
  it("REGRESSION: string -> String at the single translation point", () => {
    expect(resolveTypeRef(mkRef("string"))).toEqual(T_STRING);
  });
  it("REGRESSION: uppercase forms (RC2-native) still resolve, proving both call sites in resolveTypeRef remain correct", () => {
    expect(resolveTypeRef(mkRef("Int"))).toEqual(T_INT);
    expect(resolveTypeRef(mkRef("Float"))).toEqual(T_FLOAT);
    expect(resolveTypeRef(mkRef("Bool"))).toEqual(T_BOOL);
    expect(resolveTypeRef(mkRef("Char"))).toEqual(T_CHAR);
    expect(resolveTypeRef(mkRef("String"))).toEqual(T_STRING);
  });
});

describe("type checker — error does not cascade", () => {
  it("one bad init produces ≤2 diagnostics", () => {
    expect(codes('function f(): int\n  let x: int = "oops"\n  return x\nend\n').length).toBeLessThanOrEqual(2);
  });
  it("ErrorType in expression prevents downstream op errors", () => {
    const c = codes('function f(): int\n  let x: int = "bad"\n  return x + 1\nend\n');
    expect(c.filter(x => x === TCODES.OPERATOR_TYPE_ERROR).length).toBe(0);
  });
});

describe("type checker — TypeCheckResult shape", () => {
  it("valid is true for clean programs", () => {
    expect(typeCheck(ast("function f(): int\n  return 1\nend\n")).valid).toBe(true);
  });
  it("valid is false when there are type errors", () => {
    expect(typeCheck(ast("function f(): string\n  return 1\nend\n")).valid).toBe(false);
  });
  it("diagnostics always an array", () => {
    expect(Array.isArray(typeCheck(ast("function f()\nend\n")).diagnostics)).toBe(true);
  });
  it("diagnostics have code, message, severity, span", () => {
    const d = typeCheck(ast("function f(): string\n  return 1\nend\n")).diagnostics[0]!;
    expect(typeof d.code).toBe("string");
    expect(typeof d.message).toBe("string");
    expect(d.severity).toBe("error");
    expect(d.span.startLine).toBeGreaterThan(0);
  });
  it("never throws on empty program", () => {
    expect(() => typeCheck(ast(""))).not.toThrow();
  });
  it("never throws on program with many errors", () => {
    expect(() => typeCheck(ast('function f(): int\n  return true + "a"\nend\n'))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deferred tests — see FRONTEND_TEST_MIGRATION_REPORT.md (14 total)
// ─────────────────────────────────────────────────────────────────────────────

describe("type checker — deferred tests (14 total, documented gaps, not failures)", () => {
  it("DEFERRED: generic type syntax 'Array<Int>'/'Map<K,V>' is not parsed by UR 1.0 (8 tests)", () => {
    // RC2 tests deferred: "Int → Optional<Int> return", "for loop with
    // Array<Int>", "Array<Int> element access", "Map<String,Int> value
    // access", "known type names don't trigger TY1001" (Array<Int> case),
    // plus 3 more — UR 1.0's parseTypeRef() parses a single identifier
    // only; no `<...>` type-argument syntax exists in the grammar yet.
    const { program, errors } = parse(lex("function f(a: Array)\nend\n").tokens);
    expect(errors).toHaveLength(0);
    expect(program.functions[0]?.params[0]?.type?.typeArgs).toBeUndefined();
  });

  it("DEFERRED: ternary 'cond ? a : b' — if-expression is its UR 1.0 equivalent (1 test, rewritten not deferred)", () => {
    // RC2 test "ternary with Int branches" was rewritten using if-as-
    // expression above ("if-expression with int branches"), not deferred.
    // This entry documents that mapping decision for the record.
    expect(true).toBe(true);
  });

  it("DEFERRED: const keyword is not in the UR 1.0 grammar (2 tests)", () => {
    // RC2 tests deferred: "global const usage", "assign String to global Int" (uses const).
    const { tokens } = lex("const x = 1\n");
    expect(tokens.some(t => t.kind === "IDENTIFIER" && t.text === "const")).toBe(true);
  });

  it("DEFERRED: try/catch is reserved for Spec 1.1 (1 test)", () => {
    // RC2 test deferred: "try/catch body checked".
    const { tokens } = lex("try\nend\n");
    expect(tokens.some(t => t.kind === "IDENTIFIER" && t.text === "try")).toBe(true);
  });

  it("Tier-2 ABI types (i8..u64, f32/f64) remain rejected in general UR code, per ADR_1_TIER2_TYPES_DECISION.md (CLOSED: FFI/ABI-only, not general-purpose)", () => {
    // This assertion is now RATIFIED policy, not a temporary gap: ADR-1
    // decided Tier 2 names are reserved exclusively for src/ffi/abi/
    // declarations. This is intentionally different from `byte` below,
    // which IS a general-purpose Tier 1 type per §6.1 and was fixed.
    expect(codes("function f(a: i32)\nend\n")).toContain(TCODES.UNKNOWN_TYPE);
  });

  it("NOTE (was DEFERRED, now FIXED): `byte` is now a recognized Tier 1 general-purpose type, per SPEC_IMPLEMENTATION_MATRIX.md's `byte` finding and its Implement resolution", () => {
    expect(codes("function f(a: byte)\nend\n")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level 2.8 - Type Checker: struct construction argument types, field access
// Per explicit review priority: "Point("abc", 5)" must be rejected HERE,
// not left for IR/Backend to discover.
// ─────────────────────────────────────────────────────────────────────────────

describe("typechecker - struct construction argument types (Level 2.8)", () => {
  const POINT = "struct Point\n  x: int\n  y: int\nend\n";

  it("REVIEWER'S EXACT EXAMPLE: Point(\"abc\", 5) is rejected - a string cannot be passed for an int field", () => {
    const diags = codes(POINT + 'function main()\n  let p = Point("abc", 5)\nend\n');
    expect(diags).toContain(TCODES.CALL_ARG_TYPE_MISMATCH);
  });

  it("a valid construction (Point(1, 2)) produces zero type diagnostics", () => {
    expect(clean(POINT + "function main()\n  let p = Point(1, 2)\nend\n")).toBe(true);
  });

  it("int->float widening is accepted for a float field, matching existing numeric coercion rules", () => {
    const src = "struct P2\n  x: int\n  y: float\nend\nfunction main()\n  let p = P2(1, 2)\nend\n";
    expect(clean(src)).toBe(true);
  });

  it("the error message names both the field and the two types involved", () => {
    const m = msgs(POINT + 'function main()\n  let p = Point("abc", 5)\nend\n');
    expect(m.some(msg => msg.includes("\'x\'") && msg.includes("String") && msg.includes("Int"))).toBe(true);
  });

  it("a type mismatch in the SECOND constructor argument is also detected", () => {
    const diags = codes(POINT + 'function main()\n  let p = Point(1, "abc")\nend\n');
    expect(diags).toContain(TCODES.CALL_ARG_TYPE_MISMATCH);
  });

  it("bool cannot be passed for an int field", () => {
    const diags = codes(POINT + "function main()\n  let p = Point(true, 2)\nend\n");
    expect(diags).toContain(TCODES.CALL_ARG_TYPE_MISMATCH);
  });

  it("an ordinary function call (unrelated to any struct) is completely unaffected by the new struct-construction check", () => {
    expect(clean("function add(a: int, b: int): int\n  return a + b\nend\nfunction main(): int\n  return add(1, 2)\nend\n")).toBe(true);
  });
});

describe("typechecker - struct field access types (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 2.2)", () => {
  const POINT = "struct Point\n  x: int\n  y: int\nend\n";

  it("p.x resolves to the field's declared type (int), usable in an int-returning function", () => {
    expect(clean(POINT + "function main(): int\n  let p = Point(1, 2)\n  return p.x\nend\n")).toBe(true);
  });

  it("p.x (int) cannot be returned from a string-returning function", () => {
    const diags = codes(POINT + "function main(): string\n  let p = Point(1, 2)\n  return p.x\nend\n");
    expect(diags).toContain(TCODES.RETURN_TYPE_MISMATCH);
  });

  it("accessing a field that does not exist on the struct produces a clear diagnostic", () => {
    const diags = codes(POINT + "function main()\n  let p = Point(1, 2)\n  let z = p.z\nend\n");
    expect(diags.length).toBeGreaterThan(0);
  });

  it("a field of a different primitive type (float) resolves correctly and independently from an int field", () => {
    const src = "struct Circle\n  radius: float\n  segments: int\nend\nfunction main(): float\n  let c = Circle(1.5, 8)\n  return c.radius\nend\n";
    expect(clean(src)).toBe(true);
  });
});

describe("typechecker - forward struct reference (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 2.8)", () => {
  it("a struct constructed before its own declaration in the file type-checks correctly (struct types are hoisted, matching function hoisting)", () => {
    const src = "function f(): int\n  let p = Point(1, 2)\n  return p.x\nend\n\nstruct Point\n  x: int\n  y: int\nend\n";
    expect(clean(src)).toBe(true);
  });
});
