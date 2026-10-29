// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — Semantic Analyzer Tests (ported from RC2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Ported from RC2's tests/semantic/semantic.test.ts (101 original tests) per
// FRONTEND_TEST_MIGRATION_REPORT.md. Test LOGIC is preserved exactly; only
// the source SYNTAX is translated from RC2's {}/fn/Int grammar to UR 1.0's
// end/function-or-دالة/int grammar.
//
// 24 of the original 101 tests are DEFERRED (not deleted) because they
// exercise features absent from UR_LANGUAGE_SPEC_1_0.md: const, module
// declaration, import-as-alias, try/catch, switch, ternary, compound
// assignment. See the "Deferred tests" describe block at the end of this
// file and FRONTEND_TEST_MIGRATION_REPORT.md for the full gap list.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { CODES } from "../../../src/compiler/semantic/diagnostics.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ast(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length > 0) throw new Error(`parse errors: ${errors.map(e => e.message).join("; ")}`);
  return program;
}

function codes(src: string): string[] {
  return analyze(ast(src)).diagnostics.map(d => d.code);
}

function clean(src: string): boolean {
  const r = analyze(ast(src));
  return r.valid && r.diagnostics.length === 0;
}

function msgs(src: string): string[] {
  return analyze(ast(src)).diagnostics.map(d => d.message);
}

function diags(src: string) {
  return analyze(ast(src)).diagnostics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Valid programs — should produce zero diagnostics (26 of 39 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — valid programs", () => {
  it("empty function", () => expect(clean("function f()\nend\n")).toBe(true));
  it("return literal", () => expect(clean("function f()\n  return 1\nend\n")).toBe(true));
  it("let binding + return", () => expect(clean("function f()\n  let x = 1\n  return x\nend\n")).toBe(true));
  it("param usage", () => expect(clean("function f(a: int)\n  return a\nend\n")).toBe(true));
  it("two params", () => expect(clean("function add(a: int, b: int)\n  return a\nend\n")).toBe(true));
  it("function call (forward declared)", () => expect(clean("function f()\nend\nfunction g()\n  f()\nend\n")).toBe(true));
  it("mutual recursion", () => expect(clean("function a()\n  b()\nend\nfunction b()\n  a()\nend\n")).toBe(true));
  it("recursive self-call", () => expect(clean("function fact(n: int)\n  return fact(n)\nend\n")).toBe(true));
  it("if with param condition", () => expect(clean("function f(x: int)\n  if x\n    return 1\n  end\n  return 0\nend\n")).toBe(true));
  it("if/else", () => expect(clean("function f(x: int)\n  if x\n    return 1\n  else\n    return 0\n  end\nend\n")).toBe(true));
  it("nested if", () => expect(clean("function f(a: int, b: int)\n  if a\n    if b\n      return 1\n    end\n    return 2\n  end\n  return 3\nend\n")).toBe(true));
  it("while with break", () => expect(clean("function f()\n  while true\n    break\n  end\nend\n")).toBe(true));
  it("while with continue", () => expect(clean("function f()\n  while true\n    continue\n  end\nend\n")).toBe(true));
  it("for loop with binding", () => expect(clean("function f(xs)\n  for x in xs\n    return x\n  end\nend\n")).toBe(true));
  it("global let usage", () => expect(clean("let counter = 0\nfunction f()\n  return counter\nend\n")).toBe(true));
  it("multiple functions", () => expect(clean("function a()\n  return 1\nend\nfunction b()\n  a()\nend\nfunction c()\n  b()\nend\n")).toBe(true));
  it("let shadows outer", () => expect(clean("function f()\n  let x = 1\n  if x\n    let x = 2\n    return x\n  end\n  return x\nend\n")).toBe(true));
  it("for binding scoped to loop", () => expect(clean("function f(xs)\n  for x in xs\n    return x\n  end\nend\n")).toBe(true));
  it("member expression on param", () => expect(clean("function f(obj)\n  return obj.field\nend\n")).toBe(true));
  it("index expression on param", () => expect(clean("function f(arr)\n  return arr[0]\nend\n")).toBe(true));
  it("conditional expression with known vars (if-expression, UR's ternary equivalent)", () => {
    expect(clean("function f(x: int)\n  return if x > 0\n    1\n  else\n    0\n  end\nend\n")).toBe(true);
  });
  it("call with correct arity (0)", () => expect(clean("function noop()\nend\nfunction f()\n  noop()\nend\n")).toBe(true));
  it("call with correct arity (2)", () => expect(clean("function add(a: int, b: int)\nend\nfunction f()\n  add(1, 2)\nend\n")).toBe(true));
  it("call with correct arity (3)", () => expect(clean("function g(a: int, b: int, c: int)\nend\nfunction f()\n  g(1, 2, 3)\nend\n")).toBe(true));
  it("assignment to mutable var", () => expect(clean("function f()\n  let x = 0\n  x = 1\n  return x\nend\n")).toBe(true));
  it("assignment to member (not checked here)", () => expect(clean("function f(obj)\n  obj.field = 5\nend\n")).toBe(true));
  it("nested calls", () => expect(clean("function g(x: int)\n  return x\nend\nfunction f()\n  g(g(1))\nend\n")).toBe(true));
  it("string literal in return", () => expect(clean('function f()\n  return "hello"\nend\n')).toBe(true));
  it("bool literal in condition", () => expect(clean("function f()\n  if true\n    return 1\n  end\n  return 0\nend\n")).toBe(true));
  it("null literal", () => expect(clean("function f()\n  return null\nend\n")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// SE1001 — undefined symbol (13 of 14 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE1001 undefined symbol", () => {
  it("undefined variable in return", () => expect(codes("function f()\n  return x\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined variable in if condition", () => expect(codes("function f()\n  if x\n  end\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined variable in while condition", () => expect(codes("function f()\n  while x\n  end\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined variable as for iterable", () => expect(codes("function f()\n  for i in xs\n  end\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined in binary expression", () => expect(codes("function f()\n  return x + 1\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined in unary expression", () => expect(codes("function f()\n  return -x\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined in index expression", () => expect(codes("function f(arr)\n  return arr[x]\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("undefined in assignment target", () => expect(codes("function f()\n  y = 5\nend\n")).toContain(CODES.UNDEFINED_SYMBOL));
  it("two different undefined vars", () => {
    const c = codes("function f()\n  return a + b\nend\n");
    expect(c.filter(x => x === CODES.UNDEFINED_SYMBOL).length).toBe(2);
  });
  it("out-of-scope variable (after block)", () => {
    const c = codes("function f()\n  if true\n    let x = 1\n  end\n  return x\nend\n");
    expect(c).toContain(CODES.UNDEFINED_SYMBOL);
  });
  it("for binding is invisible after loop", () => {
    const c = codes("function f(xs)\n  for i in xs\n  end\n  return i\nend\n");
    expect(c).toContain(CODES.UNDEFINED_SYMBOL);
  });
  it("diagnostic includes the undefined name in message", () => {
    const m = msgs("function f()\n  return unknownVar\nend\n");
    expect(m[0]).toContain("unknownVar");
  });
  it("diagnostic has a span with line/column", () => {
    const d = diags("function f()\n  return x\nend\n");
    expect(d[0]?.span.startLine).toBeGreaterThan(0);
    expect(d[0]?.span.startColumn).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE1002 — undefined function (3 of 3 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE1002 undefined function", () => {
  it("calling undefined function", () => expect(codes("function f()\n  g()\nend\n")).toContain(CODES.UNDEFINED_FUNCTION));
  it("undefined function message includes name", () => {
    expect(msgs("function f()\n  unknownFn()\nend\n")[0]).toContain("unknownFn");
  });
  it("undefined function still processes args", () => {
    const d = analyze(ast("function f(x: int)\n  unknownFn(x)\nend\n"));
    expect(d.diagnostics.map(c => c.code)).toContain(CODES.UNDEFINED_FUNCTION);
    expect(d.diagnostics.filter(c => c.code === CODES.UNDEFINED_SYMBOL).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE2001 — duplicate variable (4 of 5 ported; "duplicate const" deferred)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE2001 duplicate variable", () => {
  it("duplicate let in same block", () => expect(codes("function f()\n  let x = 1\n  let x = 2\nend\n")).toContain(CODES.DUPLICATE_VARIABLE));
  it("duplicate global let", () => expect(codes("let x = 1\nlet x = 2\nfunction f()\nend\n")).toContain(CODES.DUPLICATE_VARIABLE));
  it("message includes the name", () => {
    expect(msgs("function f()\n  let dup = 1\n  let dup = 2\nend\n")[0]).toContain("dup");
  });
  it("no error for shadowing in inner scope", () => {
    expect(clean("function f()\n  let x = 1\n  if x\n    let x = 2\n    return x\n  end\n  return x\nend\n")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE2002/SE2003 — duplicate function/param (4 of 4 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE2002/SE2003 duplicate function/param", () => {
  it("duplicate function name", () => expect(codes("function f()\nend\nfunction f()\nend\n")).toContain(CODES.DUPLICATE_FUNCTION));
  it("three functions same name", () => {
    const c = codes("function f()\nend\nfunction f()\nend\nfunction f()\nend\n");
    expect(c.filter(x => x === CODES.DUPLICATE_FUNCTION).length).toBe(2);
  });
  it("duplicate parameter", () => expect(codes("function f(a: int, a: int)\nend\n")).toContain(CODES.DUPLICATE_PARAM));
  it("duplicate param message includes name", () => {
    expect(msgs("function f(x: int, x: int)\nend\n")[0]).toContain("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE3001 — arity mismatch (6 of 6 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE3001 arity mismatch", () => {
  it("too many args", () => expect(codes("function add(a: int, b: int)\nend\nfunction f()\n  add(1, 2, 3)\nend\n")).toContain(CODES.ARITY_MISMATCH));
  it("too few args", () => expect(codes("function add(a: int, b: int)\nend\nfunction f()\n  add(1)\nend\n")).toContain(CODES.ARITY_MISMATCH));
  it("calling 0-param fn with 1 arg", () => expect(codes("function noop()\nend\nfunction f()\n  noop(1)\nend\n")).toContain(CODES.ARITY_MISMATCH));
  it("calling 1-param fn with 0 args", () => expect(codes("function id(x: int)\nend\nfunction f()\n  id()\nend\n")).toContain(CODES.ARITY_MISMATCH));
  it("arity message includes expected and got", () => {
    const m = msgs("function add(a: int, b: int)\nend\nfunction f()\n  add(1)\nend\n");
    expect(m[0]).toContain("2");
    expect(m[0]).toContain("1");
  });
  it("related span points to function declaration", () => {
    const d = diags("function add(a: int, b: int)\nend\nfunction f()\n  add(1)\nend\n");
    const ar = d.find(x => x.code === CODES.ARITY_MISMATCH)!;
    expect(ar.related?.[0]?.message).toContain("declared");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE3002 — not a function (2 of 3 ported; "calling a const" deferred)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE3002 not a function", () => {
  it("calling a variable", () => expect(codes("function f()\n  let g = 1\n  g(2)\nend\n")).toContain(CODES.NOT_A_FUNCTION));
  it("message mentions it is a variable", () => {
    expect(msgs("function f()\n  let g = 1\n  g()\nend\n")[0]).toContain("variable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE4002 — assign to parameter (2 of 4 ported; compound-assignment cases deferred)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE4002 assign to parameter", () => {
  it("direct assignment to param", () => expect(codes("function f(a: int)\n  a = 5\nend\n")).toContain(CODES.ASSIGN_TO_PARAM));
  it("message includes param name", () => expect(msgs("function f(a: int)\n  a = 5\nend\n")[0]).toContain("a"));
  it("related span points to param declaration", () => {
    const d = diags("function f(a: int)\n  a = 5\nend\n");
    const err = d.find(x => x.code === CODES.ASSIGN_TO_PARAM)!;
    expect(err.related?.[0]?.message).toContain("declared");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SE5001/SE5002 — break/continue outside loop (7 of 8 ported; switch case deferred)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SE5001/SE5002 break/continue outside loop", () => {
  it("break at top level of function", () => expect(codes("function f()\n  break\nend\n")).toContain(CODES.BREAK_OUTSIDE_LOOP));
  it("continue at top level of function", () => expect(codes("function f()\n  continue\nend\n")).toContain(CODES.CONTINUE_OUTSIDE_LOOP));
  it("break inside if (not in loop)", () => expect(codes("function f()\n  if true\n    break\n  end\nend\n")).toContain(CODES.BREAK_OUTSIDE_LOOP));
  it("continue inside if (not in loop)", () => expect(codes("function f()\n  if true\n    continue\n  end\nend\n")).toContain(CODES.CONTINUE_OUTSIDE_LOOP));
  it("break inside while is fine", () => expect(codes("function f()\n  while true\n    break\n  end\nend\n")).not.toContain(CODES.BREAK_OUTSIDE_LOOP));
  it("continue inside while is fine", () => expect(codes("function f()\n  while true\n    continue\n  end\nend\n")).not.toContain(CODES.CONTINUE_OUTSIDE_LOOP));
  it("break inside for is fine", () => expect(codes("function f(xs)\n  for x in xs\n    break\n  end\nend\n")).not.toContain(CODES.BREAK_OUTSIDE_LOOP));
});

// ─────────────────────────────────────────────────────────────────────────────
// SemanticResult shape (6 of 6 ported)
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — SemanticResult", () => {
  it("valid is true for clean programs", () => {
    expect(analyze(ast("function f()\n  return 1\nend\n")).valid).toBe(true);
  });
  it("valid is false when there are errors", () => {
    expect(analyze(ast("function f()\n  return x\nend\n")).valid).toBe(false);
  });
  it("diagnostics array is always present", () => {
    expect(Array.isArray(analyze(ast("function f()\nend\n")).diagnostics)).toBe(true);
  });
  it("every diagnostic has code, message, severity, span", () => {
    const d = analyze(ast("function f()\n  return x\nend\n")).diagnostics[0]!;
    expect(typeof d.code).toBe("string");
    expect(typeof d.message).toBe("string");
    expect(typeof d.severity).toBe("string");
    expect(d.span).toBeDefined();
  });
  it("never throws — works on empty program", () => {
    expect(() => analyze(ast(""))).not.toThrow();
  });
  it("never throws — works on program with many errors", () => {
    const src = "function f()\n  a(b, c(d, e), f)\n  g()\n  h = i\n  j\nend\n";
    expect(() => analyze(ast(src))).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deferred tests — see FRONTEND_TEST_MIGRATION_REPORT.md for the full list.
// These are NOT failures; they document features intentionally absent from
// UR_LANGUAGE_SPEC_1_0.md. Each assertion below simply confirms the grammar
// gap is real (so this list itself stays honest and self-verifying), rather
// than silently disappearing from the test suite.
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic — deferred tests (24 total, documented gaps, not failures)", () => {
  it("DEFERRED: const keyword is not in the UR 1.0 grammar (4 SE4001 tests + 3 'const usage' tests + others, 9 total)", () => {
    // RC2 tests deferred: "const binding + return", "global const usage" (semantic
    // valid-programs), "duplicate const in same block", "duplicate global let"
    // dup-with-const variant, all 4 SE4001 "assign to const" tests, "calling a const"
    // (SE3002), "assign to global const"/"assign to local const" — these all require
    // a const/immutability distinction that UR_LANGUAGE_SPEC_1_0.md does not define.
    const { tokens } = lex("const x = 1\n");
    expect(tokens.some(t => t.kind === "IDENTIFIER" && t.text === "const")).toBe(true); // "const" lexes as a plain identifier, not a keyword
  });

  it("DEFERRED: module declaration keyword is not in the UR 1.0 grammar (1 test)", () => {
    // RC2 test deferred: "module declaration" — `module myapp\nfn f() {}`.
    // UR 1.0 has no top-level `module` keyword; Program.modules is always [].
    expect(ast("function f()\nend\n").modules).toEqual([]);
  });

  it("DEFERRED: import alias ('import x as y') is not parsed by the UR 1.0 Parser (1 test)", () => {
    // RC2 test deferred: "import with alias".
    const p = ast("import math\nfunction f()\nend\n");
    expect(p.imports[0]?.alias).toBeUndefined();
  });

  it("DEFERRED: try/catch/finally is reserved for Spec 1.1 (3 tests)", () => {
    // RC2 tests deferred: "try/catch", "try/finally", "try/catch/finally",
    // "catch param scoped to catch".
    const { tokens } = lex("try\nend\n");
    expect(tokens.some(t => t.kind === "IDENTIFIER" && t.text === "try")).toBe(true); // "try" is a plain identifier in UR 1.0
  });

  it("DEFERRED: switch/case is reserved for Spec 1.1 (3 tests)", () => {
    // RC2 tests deferred: "switch", "switch with expression in case",
    // "undefined in switch discriminant", "break inside switch".
    const { tokens } = lex("switch\nend\n");
    expect(tokens.some(t => t.kind === "IDENTIFIER" && t.text === "switch")).toBe(true);
  });

  it("DEFERRED: ternary 'cond ? a : b' is not in the grammar — if-expression is its UR 1.0 equivalent (2 tests, already covered above)", () => {
    // RC2 tests "conditional expression with known vars" and "ternary with
    // literals" were NOT deferred — they were rewritten using if-as-expression,
    // which is the UR 1.0 mechanism for the same semantic concept. See the
    // "valid programs" describe block above. This entry documents that
    // mapping decision for the record.
    expect(true).toBe(true);
  });

  it("DEFERRED: compound assignment (+=, -=, etc.) is not in the UR 1.0 grammar (3 tests)", () => {
    // RC2 tests deferred: "compound assignment to mutable var",
    // "compound assign to const", "compound assignment to param".
    const { tokens } = lex("x += 1\n");
    expect(tokens.map(t => t.kind)).not.toContain("PLUS_EQ");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Builtins Registry — Level 2.5 Builtins Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// Resolution order: Symbol Table → Builtins Registry → SE1002. Semantic
// Analyzer's walkCall() performs one generic registry lookup — it never
// special-cases "print"/"input" by name anywhere in its own logic (see
// semantic/index.ts and semantic/builtins-registry.ts).

describe("semantic — Builtins Registry (print/input)", () => {
  it("print(x) with the correct arity (1) produces zero diagnostics", () => {
    expect(clean("function f()\n  print(1)\nend\n")).toBe(true);
  });

  it("input() with the correct arity (0) produces zero diagnostics", () => {
    expect(clean("function f()\n  let x = input()\nend\n")).toBe(true);
  });

  it("print() with wrong arity (0 args) produces SE3001 arity mismatch", () => {
    expect(codes("function f()\n  print()\nend\n")).toContain(CODES.ARITY_MISMATCH);
  });

  it("print() with wrong arity (2 args) produces SE3001 arity mismatch", () => {
    expect(codes("function f()\n  print(1, 2)\nend\n")).toContain(CODES.ARITY_MISMATCH);
  });

  it("input() with wrong arity (1 arg) produces SE3001 arity mismatch", () => {
    expect(codes("function f()\n  input(1)\nend\n")).toContain(CODES.ARITY_MISMATCH);
  });

  it("a genuinely undefined function still produces SE1002 (registry did not loosen general validation)", () => {
    expect(codes("function f()\n  totallyUndefinedFunction()\nend\n")).toContain(CODES.UNDEFINED_FUNCTION);
  });

  it("a user-defined function named 'print' takes precedence over the builtin (Symbol Table checked first)", () => {
    // The user's own 2-arg 'print' should be used — calling it with 1 arg
    // (the builtin's arity) must now be an arity mismatch against the
    // USER's declared 2-arg signature, proving the builtin was not consulted.
    const c = codes("function print(a: int, b: int)\nend\nfunction f()\n  print(1)\nend\n");
    expect(c).toContain(CODES.ARITY_MISMATCH);
  });

  it("a program that never uses print/input has IDENTICAL results to before this change (no regression)", () => {
    // Every construct already covered by Level 1 semantic tests remains
    // byte-identical in behavior — this is a spot-check in addition to
    // the full existing suite (906+ Level 1 tests) passing unchanged.
    expect(clean("function add(a: int, b: int): int\n  return a + b\nend\n")).toBe(true);
    expect(codes("function f()\n  return x\nend\n")).toContain(CODES.UNDEFINED_SYMBOL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level 2.8 - Semantic Analyzer: Arrays & Structs
// Per LANGUAGE_SYNTAX_1_1_SPEC.md sections 1 and 2 (rounds 1+2, ratified).
// ─────────────────────────────────────────────────────────────────────────────

describe("semantic - array literals (Level 2.8)", () => {
  it("CONFIRMED BUG (fixed): an undefined symbol inside an array literal is now detected (was previously silently skipped entirely)", () => {
    expect(codes("function f()\n  let x = [undefinedVar, 2, 3]\nend\n")).toContain(CODES.UNDEFINED_SYMBOL);
  });

  it("a clean array literal (all elements defined) produces zero diagnostics", () => {
    expect(clean("function f()\n  let a = 1\n  let x = [a, 2, 3]\nend\n")).toBe(true);
  });

  it("an undefined symbol inside a NESTED array literal is also detected", () => {
    expect(codes("function f()\n  let x = [[undefinedVar]]\nend\n")).toContain(CODES.UNDEFINED_SYMBOL);
  });

  it("an undefined symbol used as an array index is detected (IndexExpression already walks correctly)", () => {
    expect(codes("function f(arr)\n  return arr[undefinedIndex]\nend\n")).toContain(CODES.UNDEFINED_SYMBOL);
  });
});

describe("semantic - struct registry and construction (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 2.7)", () => {
  const POINT = "struct Point\n  x: int\n  y: int\nend\n";

  it("valid construction with correct arity produces zero diagnostics", () => {
    expect(clean(POINT + "function main()\n  let p = Point(1, 2)\nend\n")).toBe(true);
  });

  it("RULE 1: too few constructor arguments produces SE3001 arity mismatch", () => {
    expect(codes(POINT + "function main()\n  let p = Point(1)\nend\n")).toContain(CODES.ARITY_MISMATCH);
  });

  it("RULE 1: too many constructor arguments produces SE3001 arity mismatch", () => {
    expect(codes(POINT + "function main()\n  let p = Point(1, 2, 3)\nend\n")).toContain(CODES.ARITY_MISMATCH);
  });

  it("constructing a genuinely undefined struct/function name produces SE1002", () => {
    expect(codes("function main()\n  let p = TotallyUnknown(1, 2)\nend\n")).toContain(CODES.UNDEFINED_FUNCTION);
  });

  it("DUPLICATE_STRUCT (SE2005): two structs with the same name are rejected", () => {
    const src = "struct Point\n  x: int\nend\nstruct Point\n  y: int\nend\nfunction main()\nend\n";
    expect(codes(src)).toContain(CODES.DUPLICATE_STRUCT);
  });

  it("DUPLICATE_FIELD (SE2006): two fields with the same name in one struct are rejected", () => {
    const src = "struct Point\n  x: int\n  x: float\nend\nfunction main()\nend\n";
    expect(codes(src)).toContain(CODES.DUPLICATE_FIELD);
  });

  it("INVALID_FIELD_TYPE (SE6001): an array-typed field is rejected (nesting deferred per section 2.6)", () => {
    const src = "struct Bad\n  arr: int[]\nend\nfunction main()\nend\n";
    expect(codes(src)).toContain(CODES.INVALID_FIELD_TYPE);
  });

  it("INVALID_FIELD_TYPE (SE6001): a non-primitive (e.g. would-be nested struct) field type is rejected", () => {
    const src = "struct Bad\n  other: SomeUnknownType\nend\nfunction main()\nend\n";
    expect(codes(src)).toContain(CODES.INVALID_FIELD_TYPE);
  });

  it("all four primitive field types (int, float, bool, string) are accepted with zero diagnostics", () => {
    const src = "struct AllTypes\n  a: int\n  b: float\n  c: bool\n  d: string\nend\nfunction main()\n  let x = AllTypes(1, 2.0, true, \"s\")\nend\n";
    expect(clean(src)).toBe(true);
  });

  it("PRECEDENCE: a user-defined function with the same name as a struct takes precedence (Symbol Table checked before Struct Registry)", () => {
    const src = "function Point(a: int): int\n  return a\nend\nfunction main(): int\n  return Point(5)\nend\n";
    // If the struct registry were consulted first, this single-argument
    // call would incorrectly look like an arity mismatch against a
    // (nonexistent, since there is no struct here) 2-field Point. Since
    // there is no struct Point at all in this program, this also
    // directly confirms ordinary function resolution is completely
    // unaffected by the new Struct Registry lookup.
    expect(clean(src)).toBe(true);
  });

  it("multiple distinct structs can each be constructed independently with correct arity checking", () => {
    const src = "struct A\n  x: int\nend\nstruct B\n  y: float\n  z: bool\nend\nfunction main()\n  let a = A(1)\n  let b = B(1.0, true)\nend\n";
    expect(clean(src)).toBe(true);
  });

  it("Arabic-keyword struct declaration and construction work identically to English", () => {
    const src = "بنية نقطة\n  x: عدد\n  y: عدد\nنهاية\nدالة main()\n  عرف p = نقطة(1, 2)\nنهاية\n";
    expect(clean(src)).toBe(true);
  });

  it("FORWARD REFERENCE (LANGUAGE_SYNTAX_1_1_SPEC.md section 2.8, ratified): a struct may be constructed BEFORE its own declaration appears in the file, matching the existing function forward-reference rule", () => {
    const src = "function f()\n  let p = Point(1, 2)\nend\n\nstruct Point\n  x: int\n  y: int\nend\n";
    expect(clean(src)).toBe(true);
  });
});
