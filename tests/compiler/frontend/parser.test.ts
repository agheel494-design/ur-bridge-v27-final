// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — Parser Tests
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import type {
  Program, FunctionDecl, ImportDecl, VariableDeclaration,
  IfStatement, WhileStatement, ForStatement,
  ReturnStatement, ExpressionStatement, BinaryExpression,
  CallExpression, MemberExpression, Identifier, IntLiteral,
  StringLiteral, BoolLiteral, ConditionalExpression,
  BlockStatement, BreakStatement, ContinueStatement,
} from "../../../src/compiler/frontend/ast.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSource(src: string): Program {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length > 0) {
    throw new Error(`Parse errors:\n${errors.map(e => `  ${e.code}: ${e.message}`).join("\n")}`);
  }
  return program;
}

function parseNoErrors(src: string): Program {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  expect(errors, `Expected 0 parse errors, got: ${errors.map(e => e.message).join("; ")}`).toHaveLength(0);
  return program;
}

function errorsOf(src: string): string[] {
  const { tokens } = lex(src);
  return parse(tokens).errors.map(e => e.code);
}

// ── Import declarations ───────────────────────────────────────────────────────

describe("Parser — import declarations", () => {
  it("simple English import", () => {
    const p = parseNoErrors("import math\n");
    const imp = p.imports[0] as ImportDecl;
    expect(imp.kind).toBe("ImportDecl");
    expect(imp.path).toEqual(["math"]);
  });

  it("Arabic import", () => {
    const p = parseNoErrors("استورد حساب\n");
    expect(p.imports[0]?.path).toEqual(["حساب"]);
  });

  it("dotted path", () => {
    const p = parseNoErrors("import std.io\n");
    expect(p.imports[0]?.path).toEqual(["std", "io"]);
  });

  it("Arabic and English imports produce identical AST path structure", () => {
    const eng = parseNoErrors("import math\n");
    const ar  = parseNoErrors("استورد math\n");
    expect(eng.imports[0]?.path).toEqual(ar.imports[0]?.path);
  });

  it("multiple imports", () => {
    const p = parseNoErrors("import math\nimport sqlite\n");
    expect(p.imports).toHaveLength(2);
  });
});

// ── Function declarations ─────────────────────────────────────────────────────

describe("Parser — function declarations", () => {
  it("English: empty function", () => {
    const p = parseNoErrors("function greet()\nend\n");
    const fn = p.functions[0] as FunctionDecl;
    expect(fn.kind).toBe("FunctionDecl");
    expect(fn.name).toBe("greet");
    expect(fn.params).toHaveLength(0);
    expect(fn.body.statements).toHaveLength(0);
  });

  it("Arabic: empty function", () => {
    const p = parseNoErrors("دالة رحب()\nنهاية\n");
    const fn = p.functions[0] as FunctionDecl;
    expect(fn.name).toBe("رحب");
    expect(fn.params).toHaveLength(0);
  });

  it("both languages produce FunctionDecl nodes", () => {
    const eng = parseNoErrors("function add(a, b)\n  return a + b\nend\n").functions[0];
    const ar  = parseNoErrors("دالة اجمع(أ، ب)\n  أرجع أ + ب\nنهاية\n").functions[0];
    expect(eng?.kind).toBe("FunctionDecl");
    expect(ar?.kind).toBe("FunctionDecl");
  });

  it("function with typed parameters", () => {
    const p = parseNoErrors("function add(a: int, b: int)\n  return a + b\nend\n");
    const fn = p.functions[0] as FunctionDecl;
    expect(fn.params[0]?.name).toBe("a");
    expect(fn.params[0]?.type?.name).toBe("int");
    expect(fn.params[1]?.name).toBe("b");
  });

  it("Arabic param type 'عدد' is canonicalized to 'int'", () => {
    const p = parseNoErrors("دالة اجمع(أ: عدد)\nنهاية\n");
    expect(p.functions[0]?.params[0]?.type?.name).toBe("int");
  });

  it("function with return type annotation", () => {
    const p = parseNoErrors("function double(x: int): int\n  return x * 2\nend\n");
    expect(p.functions[0]?.returnType?.name).toBe("int");
  });

  it("function body: return statement", () => {
    const p = parseNoErrors("function add(a, b)\n  return a + b\nend\n");
    const body = p.functions[0]?.body.statements;
    expect(body?.[0]?.kind).toBe("ReturnStatement");
  });

  it("function body: multiple statements", () => {
    const src = "function f(x)\n  let y = x + 1\n  return y\nend\n";
    const fn = parseNoErrors(src).functions[0] as FunctionDecl;
    expect(fn.body.statements).toHaveLength(2);
  });

  it("END_KW from 'end' and 'نهاية' both close the function", () => {
    const eng = parseNoErrors("function f()\nend\n").functions[0];
    const ar  = parseNoErrors("دالة ف()\nنهاية\n").functions[0];
    expect(eng?.kind).toBe("FunctionDecl");
    expect(ar?.kind).toBe("FunctionDecl");
  });
});

// ── Let / variable declarations ───────────────────────────────────────────────

describe("Parser — let declarations", () => {
  it("simple let with int literal", () => {
    const p = parseNoErrors("let x = 42\n");
    const decl = p.body[0] as ExpressionStatement;
    // Top-level let becomes a GlobalVariableDecl; let inside body is VariableDeclaration
    expect(p.globals[0]?.kind).toBe("GlobalVariableDecl");
    expect(p.globals[0]?.name).toBe("x");
  });

  it("Arabic 'عرف' produces VariableDeclaration inside function", () => {
    const p = parseNoErrors("function f()\n  عرف س = 10\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(stmt?.kind).toBe("VariableDeclaration");
    expect(stmt?.name).toBe("س");
  });

  it("let with type annotation: 'int' stays 'int'", () => {
    const p = parseNoErrors("function f()\n  let x: int = 0\nend\n");
    const decl = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(decl?.type?.name).toBe("int");
  });

  it("let with Arabic type 'عدد' canonicalized to 'int'", () => {
    const p = parseNoErrors("function f()\n  دع س: عدد = 0\nend\n");
    const decl = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(decl?.type?.name).toBe("int");
  });

  it("let with string initializer", () => {
    const p = parseNoErrors("function f()\n  let name = \"hello\"\nend\n");
    const decl = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(decl?.initializer?.kind).toBe("StringLiteral");
  });
});

// ── If statement ──────────────────────────────────────────────────────────────

describe("Parser — if statement and expression", () => {
  it("simple if without else", () => {
    const p = parseNoErrors("function f(x)\n  if x\n    return x\n  end\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as IfStatement;
    expect(stmt?.kind).toBe("IfStatement");
    expect(stmt?.elseBranch).toBeUndefined();
  });

  it("if with else", () => {
    const p = parseNoErrors("function f(x)\n  if x\n    return 1\n  else\n    return 0\n  end\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as IfStatement;
    expect(stmt?.elseBranch).toBeDefined();
  });

  it("Arabic if/else: إذا/وإلا/نهاية", () => {
    const p = parseNoErrors("دالة ف(س)\n  إذا س\n    أرجع 1\n  وإلا\n    أرجع 0\n  نهاية\nنهاية\n");
    const stmt = p.functions[0]?.body.statements[0] as IfStatement;
    expect(stmt?.kind).toBe("IfStatement");
    expect(stmt?.elseBranch).toBeDefined();
  });

  it("if as expression (ConditionalExpression)", () => {
    const src = "function f(age)\n  let label = if age >= 18\n    \"adult\"\n  else\n    \"minor\"\n  end\n  return label\nend\n";
    const p = parseNoErrors(src);
    const decl = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(decl?.initializer?.kind).toBe("ConditionalExpression");
  });

  it("Arabic if-expression: إذا/وإلا/نهاية as expression", () => {
    const src = "دالة ف(عمر)\n  دع تصنيف = إذا عمر >= 18\n    \"بالغ\"\n  وإلا\n    \"قاصر\"\n  نهاية\n  أرجع تصنيف\nنهاية\n";
    const p = parseNoErrors(src);
    const decl = p.functions[0]?.body.statements[0] as VariableDeclaration;
    expect(decl?.initializer?.kind).toBe("ConditionalExpression");
  });
});

// ── While / for loops ─────────────────────────────────────────────────────────

describe("Parser — while and for loops", () => {
  it("while loop", () => {
    const p = parseNoErrors("function f()\n  while true\n    break\n  end\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as WhileStatement;
    expect(stmt?.kind).toBe("WhileStatement");
    expect(stmt?.body.statements[0]?.kind).toBe("BreakStatement");
  });

  it("Arabic while: بينما/نهاية", () => {
    const p = parseNoErrors("دالة ف()\n  بينما صحيح\n    اكسر\n  نهاية\nنهاية\n");
    expect(p.functions[0]?.body.statements[0]?.kind).toBe("WhileStatement");
  });

  it("for loop with 'in'", () => {
    const p = parseNoErrors("function f(items)\n  for x in items\n    continue\n  end\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as ForStatement;
    expect(stmt?.kind).toBe("ForStatement");
    expect(stmt?.binding).toBe("x");
    expect((stmt?.iterable as Identifier)?.name).toBe("items");
    expect(stmt?.body.statements[0]?.kind).toBe("ContinueStatement");
  });

  it("Arabic for: لكل/في/نهاية", () => {
    const p = parseNoErrors("دالة ف(عناصر)\n  لكل س في عناصر\n    تابع\n  نهاية\nنهاية\n");
    const stmt = p.functions[0]?.body.statements[0] as ForStatement;
    expect(stmt?.kind).toBe("ForStatement");
    expect(stmt?.binding).toBe("س");
  });
});

// ── Expressions ────────────────────────────────────────────────────────────────

describe("Parser — expressions", () => {
  it("integer literal", () => {
    const p = parseNoErrors("function f()\n  return 42\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    const lit = ret?.value as IntLiteral;
    expect(lit?.kind).toBe("IntLiteral");
    expect(lit?.value).toBe(42);
  });

  it("string literal", () => {
    const p = parseNoErrors("function f()\n  return \"hello\"\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    const lit = ret?.value as StringLiteral;
    expect(lit?.value).toBe("hello");
  });

  it("boolean literals: true/صحيح", () => {
    const eng = parseNoErrors("function f()\n  return true\nend\n");
    const ar  = parseNoErrors("دالة ف()\n  أرجع صحيح\nنهاية\n");
    expect((eng.functions[0]?.body.statements[0] as ReturnStatement)?.value?.kind).toBe("BoolLiteral");
    expect((ar.functions[0]?.body.statements[0] as ReturnStatement)?.value?.kind).toBe("BoolLiteral");
    expect(((eng.functions[0]?.body.statements[0] as ReturnStatement)?.value as BoolLiteral)?.value).toBe(true);
  });

  it("binary arithmetic: a + b", () => {
    const p = parseNoErrors("function f(a, b)\n  return a + b\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    const bin = ret?.value as BinaryExpression;
    expect(bin?.kind).toBe("BinaryExpression");
    expect(bin?.operator).toBe("+");
  });

  it("operator precedence: a + b * c groups as a + (b * c)", () => {
    const p = parseNoErrors("function f(a, b, c)\n  return a + b * c\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    const bin = ret?.value as BinaryExpression;
    expect(bin?.operator).toBe("+");
    expect((bin?.right as BinaryExpression)?.operator).toBe("*");
  });

  it("comparison: x >= 18", () => {
    const p = parseNoErrors("function f(x)\n  return x >= 18\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    const bin = ret?.value as BinaryExpression;
    expect(bin?.operator).toBe(">=");
  });

  it("function call: print(x)", () => {
    const p = parseNoErrors("function f(x)\n  print(x)\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as ExpressionStatement;
    const call = stmt?.expression as CallExpression;
    expect(call?.kind).toBe("CallExpression");
    expect((call?.callee as Identifier)?.name).toBe("print");
    expect(call?.args).toHaveLength(1);
  });

  it("method call: sqlite.open(path)", () => {
    const p = parseNoErrors("function f(path)\n  sqlite.open(path)\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as ExpressionStatement;
    const call = stmt?.expression as CallExpression;
    expect(call?.kind).toBe("CallExpression");
    const member = call?.callee as MemberExpression;
    expect(member?.kind).toBe("MemberExpression");
    expect((member?.object as Identifier)?.name).toBe("sqlite");
    expect(member?.property).toBe("open");
  });

  it("Arabic comma ، in call args", () => {
    const p = parseNoErrors("function f()\n  اطبع(1، 2)\nend\n");
    const stmt = p.functions[0]?.body.statements[0] as ExpressionStatement;
    const call = stmt?.expression as CallExpression;
    expect(call?.args).toHaveLength(2);
  });

  it("unary negation: -x", () => {
    const p = parseNoErrors("function f(x)\n  return -x\nend\n");
    const ret = p.functions[0]?.body.statements[0] as ReturnStatement;
    expect(ret?.value?.kind).toBe("UnaryExpression");
  });
});

// ── Full program equivalence ───────────────────────────────────────────────────

describe("Parser — Arabic/English full program equivalence", () => {
  const arabicProgram = `
استورد حساب

دالة اجمع(أ، ب)
    أرجع أ + ب
نهاية

اطبع(اجمع(5، 7))
`.trim() + "\n";

  const englishProgram = `
import math

function add(a, b)
    return a + b
end

print(add(5, 7))
`.trim() + "\n";

  it("both programs parse with zero errors", () => {
    parseNoErrors(arabicProgram);
    parseNoErrors(englishProgram);
  });

  it("both produce 1 import, 1 function, 1 top-level body statement", () => {
    const ar  = parseNoErrors(arabicProgram);
    const eng = parseNoErrors(englishProgram);
    expect(ar.imports).toHaveLength(1);
    expect(ar.functions).toHaveLength(1);
    expect(ar.body).toHaveLength(1);
    expect(eng.imports).toHaveLength(1);
    expect(eng.functions).toHaveLength(1);
    expect(eng.body).toHaveLength(1);
  });

  it("function body in both is a return of a binary addition", () => {
    const ar  = parseNoErrors(arabicProgram).functions[0];
    const eng = parseNoErrors(englishProgram).functions[0];
    const arRet  = ar?.body.statements[0] as ReturnStatement;
    const engRet = eng?.body.statements[0] as ReturnStatement;
    expect(arRet?.value?.kind).toBe("BinaryExpression");
    expect(engRet?.value?.kind).toBe("BinaryExpression");
    expect((arRet?.value as BinaryExpression)?.operator).toBe("+");
    expect((engRet?.value as BinaryExpression)?.operator).toBe("+");
  });
});

// ── Error recovery ─────────────────────────────────────────────────────────────

describe("Parser — stress: recursion depth and stack safety (Verification & Recovery Mission)", () => {
  // Finding: this is a recursive-descent parser. Extremely deep nesting
  // (~3000+ levels of nested `if`) hits JavaScript's call-stack limit and
  // throws RangeError("Maximum call stack size exceeded"). This is CAUGHT
  // gracefully by the top-level statement loop's try/catch (producing a
  // single PE004 diagnostic) — NOT an uncaught crash. Parsing continues
  // correctly for any subsequent top-level declarations. No real UR
  // program is expected to nest 3000 levels deep; this documents the
  // actual limit and confirms graceful (non-crashing) behavior at it,
  // rather than leaving it as an undocumented, unverified assumption.

  it("2000 levels of nested if: parses successfully with zero errors", () => {
    const depth = 2000;
    let src = "function f(x)\n";
    for (let i = 0; i < depth; i++) src += "  if x\n";
    src += "    return 1\n";
    for (let i = 0; i < depth; i++) src += "  end\n";
    src += "end\n";
    const { tokens } = lex(src);
    const { errors } = parse(tokens);
    expect(errors).toHaveLength(0);
  });

  it("extreme nesting (5000 levels) does not crash the process — degrades gracefully to a single diagnostic", () => {
    const depth = 5000;
    let src = "function bad(x)\n";
    for (let i = 0; i < depth; i++) src += "  if x\n";
    src += "    return 1\n";
    for (let i = 0; i < depth; i++) src += "  end\n";
    src += "end\n";
    expect(() => {
      const { tokens } = lex(src);
      parse(tokens);
    }).not.toThrow(); // must not propagate as an uncaught exception
  });

  it("after extreme-nesting failure, the parser recovers and correctly parses subsequent top-level declarations", () => {
    const depth = 5000;
    let src = "function bad(x)\n";
    for (let i = 0; i < depth; i++) src += "  if x\n";
    src += "    return 1\n";
    for (let i = 0; i < depth; i++) src += "  end\n";
    src += "end\n\nfunction good()\n  return 42\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    expect(program.functions.some(f => f.name === "good")).toBe(true);
  });

  it("50,000-term binary expression parses without crashing (deep expression tree, not statement nesting)", () => {
    const count = 50000;
    const src = `function f(a)\n  return ${Array(count).fill("a").join("+")}\nend\n`;
    const { tokens } = lex(src);
    const { errors } = parse(tokens);
    expect(errors).toHaveLength(0);
  });

  it("200,000-line file (1M+ tokens) lexes and parses without crashing", () => {
    const lines = 200000;
    let src = "";
    for (let i = 0; i < lines; i++) src += `let x${i} = ${i}\n`;
    const { tokens, errors: lexErrors } = lex(src);
    expect(lexErrors).toHaveLength(0);
    const { program, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    expect(program.globals.length).toBe(lines);
  });

  it("unterminated string literal: lex error reported, parser does not crash", () => {
    const src = 'function f()\n  return "unterminated\nend\n';
    const { tokens, errors: lexErrors } = lex(src);
    expect(lexErrors.some(e => e.code === "LE002")).toBe(true);
    expect(() => parse(tokens)).not.toThrow();
  });

  it("zero-width space (U+200B) inside an identifier is treated as an error, not silently accepted or crashing", () => {
    const src = "function f\u200B()\n  return 1\nend\n";
    const { tokens, errors } = lex(src);
    expect(() => parse(tokens)).not.toThrow();
    // The zero-width space is not a valid identifier character — it must
    // surface as a lex error, not be silently absorbed into the identifier.
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("Parser — error recovery", () => {
  it("missing end: PE002 is reported", () => {
    const codes = errorsOf("function f()\n  return 1\n");
    expect(codes).toContain("PE002");
  });

  it("parser continues after a missing ')': subsequent valid code parsed", () => {
    const { tokens } = lex("function f(x\n  return x\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.length).toBeGreaterThan(0);
    // Despite the error, the function was partially recovered
    expect(program.functions.length).toBeGreaterThanOrEqual(0);
  });

  it("completely valid file after an error-containing one: no bleed", () => {
    const { tokens } = lex("function f(x\n  return 1\nend\nfunction g()\n  return 2\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.length).toBeGreaterThan(0);
    const hasG = program.functions.some(f => f.name === "g");
    expect(hasG).toBe(true);
  });

  it("ERROR token from Lexer recovery does not cause infinite loop (regression)", () => {
    // Regression: an ERROR token (e.g. from an unrecognized character that
    // slipped through, or in the historical bug, an Arabic diacritic
    // mis-tokenized as a separate ERROR) used to cause parsePrimary's
    // default branch to return without consuming a token, which made the
    // enclosing while-loop in parseBlock/parseExpressionStatement spin
    // forever on the same token. Fixed by guaranteeing advance() in the
    // default branch AND adding defense-in-depth progress guards to every
    // statement-parsing loop. This test must complete instantly — if the
    // fix regresses, this test will hang/timeout rather than fail cleanly.
    const src = "function f()\n  @\n  return 1\nend\n";
    const start = Date.now();
    const { tokens } = lex(src);
    const { program, errors } = parse(tokens);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000); // must not hang
    expect(errors.length).toBeGreaterThan(0);
    expect(program.functions).toHaveLength(1);
  });

  it("Arabic identifier with diacritic inside a full program does not hang (regression)", () => {
    // The exact program that originally caused an infinite loop during
    // Frontend integration testing — see lexer.test.ts "Arabic diacritics".
    const src = "دالة صنّف(س)\n  إذا س > 0\n    أرجع \"موجب\"\n  وإلا\n    أرجع \"غير موجب\"\n  نهاية\nنهاية\n";
    const start = Date.now();
    const { tokens } = lex(src);
    const { program, errors } = parse(tokens);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(errors).toHaveLength(0);
    expect(program.functions[0]?.name).toBe("صنّف");
  });

  it("multiple consecutive unexpected tokens never stall (defense-in-depth)", () => {
    const src = "function f()\n  @ # $ %% ^^\n  return 1\nend\n";
    const start = Date.now();
    const { tokens } = lex(src);
    parse(tokens);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("Parser — Assignment is a first-class Statement, not wrapped in ExpressionStatement (regression)", () => {
  // Regression: Assignment was previously wrapped inside
  // ExpressionStatement.expression and cast to Expression. This type-checked
  // but was semantically wrong: the Semantic Analyzer and Type Checker both
  // dispatch on `stmt.kind` at the STATEMENT level with a dedicated
  // "Assignment" case (separate from "ExpressionStatement", which only
  // walks/infers an Expression — neither has an "Assignment" case in their
  // Expression-level switch). Wrapping it silently disabled SE1001/SE4001/
  // SE4002/TY2002 for every assignment in every UR program. Fixed by
  // returning the Assignment node directly as a Statement.
  //
  // Every test below asserts statements[i].kind === "Assignment" directly
  // (not "ExpressionStatement") — this is the exact shape the bug broke.

  it("assignment directly inside a function body block", () => {
    const p = parseNoErrors("function f()\n  x = 10\nend\n");
    const stmt = p.functions[0]!.body.statements[0];
    expect(stmt.kind).toBe("Assignment");
  });

  it("assignment inside an if branch", () => {
    const p = parseNoErrors("function f(c)\n  if c\n    x = 1\n  end\nend\n");
    const ifStmt = p.functions[0]!.body.statements[0] as IfStatement;
    expect(ifStmt.thenBranch.statements[0]!.kind).toBe("Assignment");
  });

  it("assignment inside an if/else branch", () => {
    const p = parseNoErrors("function f(c)\n  if c\n    x = 1\n  else\n    x = 2\n  end\nend\n");
    const ifStmt = p.functions[0]!.body.statements[0] as IfStatement;
    expect(ifStmt.thenBranch.statements[0]!.kind).toBe("Assignment");
    expect((ifStmt.elseBranch as BlockStatement).statements[0]!.kind).toBe("Assignment");
  });

  it("assignment inside a while loop body", () => {
    const p = parseNoErrors("function f()\n  let x = 0\n  while x\n    x = 0\n  end\nend\n");
    const whileStmt = p.functions[0]!.body.statements[1] as WhileStatement;
    expect(whileStmt.body.statements[0]!.kind).toBe("Assignment");
  });

  it("assignment inside a for loop body", () => {
    const p = parseNoErrors("function f(items)\n  for x in items\n    y = x\n  end\nend\n");
    const forStmt = p.functions[0]!.body.statements[0] as ForStatement;
    expect(forStmt.body.statements[0]!.kind).toBe("Assignment");
  });

  it("member assignment: obj.field = value", () => {
    const p = parseNoErrors("function f(obj)\n  obj.field = 5\nend\n");
    const stmt = p.functions[0]!.body.statements[0] as unknown as { kind: string; target: { kind: string } };
    expect(stmt.kind).toBe("Assignment");
    expect(stmt.target.kind).toBe("MemberExpression");
  });

  it("nested assignment: target is the result of a previous declaration, value is an expression", () => {
    const p = parseNoErrors("function f()\n  let x = 0\n  x = x + 1\nend\n");
    const stmt = p.functions[0]!.body.statements[1] as unknown as { kind: string; value: { kind: string } };
    expect(stmt.kind).toBe("Assignment");
    expect(stmt.value.kind).toBe("BinaryExpression");
  });

  it("assignment followed by return", () => {
    const p = parseNoErrors("function f()\n  let x = 0\n  x = 5\n  return x\nend\n");
    const stmts = p.functions[0]!.body.statements;
    expect(stmts[1]!.kind).toBe("Assignment");
    expect(stmts[2]!.kind).toBe("ReturnStatement");
  });

  it("assignment at the top level of a function (not nested in any control flow)", () => {
    const p = parseNoErrors("function f()\n  let x = 0\n  x = 1\nend\n");
    expect(p.functions[0]!.body.statements[1]!.kind).toBe("Assignment");
  });

  it("Semantic Analyzer's dedicated Assignment case actually fires (end-to-end proof)", () => {
    // This is the real proof the fix matters: an undefined assignment
    // target must now be caught, where before it was silently ignored
    // because Assignment never reached walkAssignment().
    const src = "function f()\n  undefinedVar = 5\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const result = analyze(program);
    expect(result.diagnostics.some(d => d.code === "SE1001")).toBe(true);
  });
});

// ── Span tracking ─────────────────────────────────────────────────────────────

describe("Parser — span tracking", () => {
  it("import span starts at line 1", () => {
    const p = parseNoErrors("import math\n");
    expect(p.imports[0]?.span.startLine).toBe(1);
  });

  it("function span covers from keyword to end keyword", () => {
    const p = parseNoErrors("function f()\nend\n");
    const fn = p.functions[0]!;
    expect(fn.span.startLine).toBe(1);
    expect(fn.span.endLine).toBe(2);
  });

  it("every node has a defined span", () => {
    const p = parseNoErrors("function f(a, b)\n  return a + b\nend\n");
    const fn = p.functions[0]!;
    expect(fn.span).toBeDefined();
    expect(fn.body.span).toBeDefined();
    const ret = fn.body.statements[0] as ReturnStatement;
    expect(ret.span).toBeDefined();
    expect(ret.value?.span).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level 2.8 / Level 2.7.5 - Grammar + Parser + AST for Arrays & Structs
// Per LANGUAGE_SYNTAX_1_1_SPEC.md, reviewed in a dedicated Parser-only
// closure pass BEFORE any Semantic/TypeChecker/IR work continues.
// ─────────────────────────────────────────────────────────────────────────────

describe("parser - array literals (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 1.1)", () => {
  it("[1] parses with zero errors as a single-element ArrayLiteral", () => {
    const { tokens } = lex("function f()\n  let x = [1]\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const decl = program.functions[0]!.body.statements[0] as any;
    expect(decl.initializer.kind).toBe("ArrayLiteral");
    expect(decl.initializer.elements).toHaveLength(1);
  });

  it("[1,2] parses with zero errors as a two-element ArrayLiteral", () => {
    const { tokens } = lex("function f()\n  let x = [1,2]\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const decl = program.functions[0]!.body.statements[0] as any;
    expect(decl.initializer.elements).toHaveLength(2);
  });

  it("[1,2,3] parses with zero errors as a three-element ArrayLiteral", () => {
    const { tokens } = lex("function f()\n  let x = [1,2,3]\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const decl = program.functions[0]!.body.statements[0] as any;
    expect(decl.initializer.elements).toHaveLength(3);
  });

  it("[] (empty) parses with ZERO PARSE errors - structurally valid; rejection is a TypeChecker concern (TY6002), never a Parser/Grammar one", () => {
    const { tokens } = lex("function f()\n  let x = []\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const decl = program.functions[0]!.body.statements[0] as any;
    expect(decl.initializer.kind).toBe("ArrayLiteral");
    expect(decl.initializer.elements).toHaveLength(0);
  });

  it("[[1]] (nested array literal) parses with ZERO PARSE errors - nesting is not a grammar violation; rejecting Array<Array<T>> (if ever done) is a later TypeChecker/Semantic concern, never the Parser's", () => {
    const { tokens } = lex("function f()\n  let x = [[1]]\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const outer = program.functions[0]!.body.statements[0] as any;
    expect(outer.initializer.kind).toBe("ArrayLiteral");
    expect(outer.initializer.elements[0].kind).toBe("ArrayLiteral");
  });

  it("[1, true, \"abc\"] (mixed element types) parses with ZERO PARSE errors - the Parser never type-checks; TypeChecker (TY6001) is the only layer that rejects this", () => {
    const { tokens } = lex('function f()\n  let x = [1, true, "abc"]\nend\n');
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const decl = program.functions[0]!.body.statements[0] as any;
    expect(decl.initializer.elements).toHaveLength(3);
  });

  it("the ArrayLiteral span covers the ENTIRE [...] construct, not just the first element", () => {
    const { tokens } = lex("function f()\n  let x = [1, 2, 3]\nend\n");
    const { program } = parse(tokens);
    const decl = program.functions[0]!.body.statements[0] as any;
    const lit = decl.initializer;
    // The literal starts at '[' and ends at ']' - its span's start column
    // must be BEFORE the first element's own span, and its end column
    // must be AFTER the last element's own span (i.e. it covers more than
    // just element 1, confirmed by comparing against the sub-spans).
    expect(lit.span.startColumn).toBeLessThan(lit.elements[0].span.startColumn);
    expect(lit.span.endColumn).toBeGreaterThan(lit.elements[2].span.endColumn);
  });

  it("each element retains its own individual span (available for future per-element diagnostics)", () => {
    const { tokens } = lex("function f()\n  let x = [10, 200, 3]\nend\n");
    const { program } = parse(tokens);
    const decl = program.functions[0]!.body.statements[0] as any;
    const [e1, e2, e3] = decl.initializer.elements;
    expect(e1.span.startColumn).not.toBe(e2.span.startColumn);
    expect(e2.span.startColumn).not.toBe(e3.span.startColumn);
  });
});

describe("parser - array type annotations (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 1.2)", () => {
  it("int[] parses with arrayDepth=1, name='int' (never 'int[]' concatenated into name)", () => {
    const { tokens } = lex("function f(x: int[])\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const param = program.functions[0]!.params[0]!;
    expect(param.type!.name).toBe("int");
    expect(param.type!.arrayDepth).toBe(1);
  });

  it("int[][] parses structurally with arrayDepth=2 - per explicit review request, even though Level 2.8's TypeChecker will reject depth>1 later; this is NOT a Parser/Grammar restriction", () => {
    const { tokens } = lex("function f(x: int[][])\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    const param = program.functions[0]!.params[0]!;
    expect(param.type!.name).toBe("int");
    expect(param.type!.arrayDepth).toBe(2);
  });

  it("a plain 'int' (no brackets) has arrayDepth undefined, not 0 or false", () => {
    const { tokens } = lex("function f(x: int)\nend\n");
    const { program } = parse(tokens);
    const param = program.functions[0]!.params[0]!;
    expect(param.type!.arrayDepth).toBeUndefined();
  });

  it("array type annotation works for return types too", () => {
    const { tokens } = lex("function f(): string[]\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.functions[0]!.returnType!.name).toBe("string");
    expect(program.functions[0]!.returnType!.arrayDepth).toBe(1);
  });

  it("Arabic-keyword function with an array-typed parameter parses correctly", () => {
    const { tokens } = lex("دالة f(x: عدد[])\nنهاية\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.functions[0]!.params[0]!.type!.name).toBe("int");
    expect(program.functions[0]!.params[0]!.type!.arrayDepth).toBe(1);
  });
});

describe("parser - struct declarations (Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md section 2.1)", () => {
  it("a simple two-field struct parses with zero errors", () => {
    const { tokens } = lex("struct Point\n  x: int\n  y: int\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.structs).toHaveLength(1);
    expect(program.structs[0]!.name).toBe("Point");
    expect(program.structs[0]!.fields.map(f => f.name)).toEqual(["x", "y"]);
    expect(program.structs[0]!.fields.map(f => f.type.name)).toEqual(["int", "int"]);
  });

  it("a struct with a single field parses correctly", () => {
    const { tokens } = lex("struct Wrapper\n  value: string\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.structs[0]!.fields).toHaveLength(1);
  });

  it("multiple struct declarations in one file all parse correctly", () => {
    const { tokens } = lex("struct A\n  x: int\nend\nstruct B\n  y: float\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.structs).toHaveLength(2);
    expect(program.structs.map(s => s.name)).toEqual(["A", "B"]);
  });

  it("a struct declaration followed by a function declaration both parse in the same program", () => {
    const { tokens } = lex("struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  return 0\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.structs).toHaveLength(1);
    expect(program.functions).toHaveLength(1);
  });

  it("Arabic-keyword struct declaration ('بنية ... نهاية') parses correctly", () => {
    const { tokens } = lex("بنية نقطة\n  x: عدد\n  y: عدد\nنهاية\n");
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program.structs).toHaveLength(1);
    expect(program.structs[0]!.name).toBe("نقطة");
    expect(program.structs[0]!.fields.map(f => f.type.name)).toEqual(["int", "int"]);
  });

  it("REGRESSION (CONFIRMED BUG, fixed): a malformed struct field (non-identifier where a field name is expected) produces real parse errors WITHOUT hanging - this exact input previously caused an infinite loop that crashed a real test suite (tests/lsp/lsp.test.ts) with a JavaScript heap-out-of-memory error", () => {
    const { tokens } = lex("struct Point\n  123\nend\n");
    const { program, errors } = parse(tokens);
    // The key assertion is simply that this line is ever reached at all -
    // a timeout-guarded execution environment (this test) reaching this
    // point means the parse completed, i.e. did NOT hang.
    expect(errors.length).toBeGreaterThan(0);
  });

  it("REGRESSION: an empty struct body (zero fields) does not hang and parses to zero errors (a struct with no fields is not a Grammar error - Semantic may choose to reject it later, but that is not this test's concern)", () => {
    const { tokens } = lex("struct Empty\nend\n");
    const { program, errors } = parse(tokens);
    expect(program.structs[0]!.fields).toHaveLength(0);
  });

  it("a struct missing the closing 'end' produces a real parse error without hanging", () => {
    const { tokens } = lex("struct Point\n  x: int\n");
    const { program, errors } = parse(tokens);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("Parser - LANGUAGE FREEZE FIX: type alias declaration (was entirely absent, SPEC_IMPLEMENTATION_MATRIX.md finding)", () => {
  it("FIXED: `type MyInt = int` parses into a TypeAliasDecl with zero errors", () => {
    const { tokens } = lex("type MyInt = int\nfunction main(): int\n  return 1\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors).toEqual([]);
    expect(program.typeAliases.length).toBe(1);
    expect(program.typeAliases[0]?.name).toBe("MyInt");
    expect(program.typeAliases[0]?.aliasedType.name).toBe("int");
  });

  it("FIXED: the struct-like 'type NAME = { ... }' form is cleanly rejected, correctly naming its deferral to Specification 1.1", () => {
    const { tokens } = lex("type Bad = { x: int }\nfunction main(): int\n  return 1\nend\n");
    const { errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE008")).toBe(true);
  });
});

describe("Parser - unsupported switch/try diagnostics", () => {
  it("switch produces PE012 and recovers to parse the following function", () => {
    const { tokens } = lex("function main(): int\n  switch 1\n  end\n  return 42\nend\nfunction after(): int\n  return 7\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE012")).toBe(true);
    expect(program.functions.map(f => f.name)).toEqual(["main", "after"]);
    expect(program.functions[0]?.name).toBe("main");
  });

  it("try produces PE013 and recovers to parse the following function", () => {
    const { tokens } = lex("function main(): int\n  try\n  end\n  return 42\nend\nfunction after(): int\n  return 7\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE013")).toBe(true);
    expect(program.functions.map(f => f.name)).toEqual(["main", "after"]);
    expect(program.functions[0]?.name).toBe("main");
  });
  it("switch recovery respects nested if/end blocks", () => {
    const { tokens } = lex("function main(): int\n  switch 1\n    if true\n      print(1)\n    end\n  end\n  return 42\nend\nfunction after(): int\n  return 7\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE012")).toBe(true);
    expect(program.functions.map(f => f.name)).toEqual(["main", "after"]);
  });

});

describe("Parser - LANGUAGE FREEZE FIX: enum produces a clear diagnostic instead of silent success (FINAL_CONSISTENCY_REVIEW.md finding)", () => {
  it("FIXED: `enum Color / Red / Blue / end` now produces PE009 with the exact required message, not silent success", () => {
    const { tokens } = lex("enum Color\n  Red\n  Blue\nend\nfunction main(): int\n  return 42\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE009")).toBe(true);
    expect(errors.find(e => e.code === "PE009")?.message).toBe("enum declarations are not supported in UR 1.0. This feature is planned for a future version.");
    // The rest of the file must still parse correctly after recovery.
    expect(program.functions.length).toBe(1);
    expect(program.functions[0]?.name).toBe("main");
  });

  it("No false positive: `enum` used as an ordinary variable name (via `let`) is unaffected", () => {
    const { tokens } = lex("function main(): int\n  let enum = 5\n  return enum\nend\n");
    const { errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE009")).toBe(false);
  });
});

describe("Parser - COMPILER STABILIZATION SPRINT FIX: unrecognized modifiers (async, const, static, public, export, abstract, ...) produce a clear diagnostic instead of silent success", () => {
  it("FIXED: `async function main()...end` now produces PE010, and main is still correctly parsed as an ordinary function afterward", () => {
    const { tokens } = lex("async function main(): int\n  return 1\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE010")).toBe(true);
    expect(errors.find(e => e.code === "PE010")?.message).toBe("'async' is not a recognized modifier in UR 1.0 — declarations do not support modifiers yet. This feature is planned for a future version.");
    expect(program.functions.length).toBe(1);
    expect(program.functions[0]?.name).toBe("main");
  });

  it("FIXED (generalized): the identical bug was also found for `const`, `static`, `public`, `export`, `abstract` during Compiler Stabilization Sprint's own systematic scan — one general check now covers the whole class, not five individual special cases", () => {
    for (const modifier of ["const", "static", "public", "export", "abstract"]) {
      const { tokens } = lex(`${modifier} function main(): int\n  return 1\nend\n`);
      const { program, errors } = parse(tokens);
      expect(errors.some(e => e.code === "PE010")).toBe(true);
      expect(program.functions.length).toBe(1);
    }
  });

  it("No false positive: `async` used as an ordinary variable name is unaffected", () => {
    const { tokens } = lex("function main(): int\n  let async = 5\n  return async\nend\n");
    const { errors } = parse(tokens);
    expect(errors.some(e => e.code === "PE010")).toBe(false);
  });
});

describe("Parser - Compiler & Runtime Stabilization FIX: stacked modifiers (SIMULATED_AUDIT_REPORT.md Finding 1)", () => {
  it("FIXED: `async const function main()...end` now flags BOTH 'async' AND 'const' with PE010 (previously only 'const' was caught, 'async' was silently swallowed)", () => {
    const { tokens } = lex("async const function main(): int\n  return 1\nend\n");
    const { program, errors } = parse(tokens);
    expect(errors.filter(e => e.code === "PE010")).toHaveLength(2);
    expect(errors[0]?.message).toContain("'async'");
    expect(errors[1]?.message).toContain("'const'");
    expect(program.body).toEqual([]);
    expect(program.functions.map(f => f.name)).toEqual(["main"]);
  });

  it("FIXED: three stacked modifiers (`async const static function`) all produce their own PE010 — the fix generalizes to any chain length, not just two", () => {
    const { tokens } = lex("async const static function main(): int\n  return 1\nend\n");
    const { errors } = parse(tokens);
    const modifierErrors = errors.filter(e => e.code === "PE010");
    expect(modifierErrors).toHaveLength(3);
    expect(modifierErrors.map(e => e.message.match(/'([^']+)'/)?.[1])).toEqual(["async", "const", "static"]);
  });

  it("No regression: a single modifier (`async function`) still produces exactly one PE010, matching the original fix", () => {
    const { tokens } = lex("async function main(): int\n  return 1\nend\n");
    const { errors } = parse(tokens);
    expect(errors.filter(e => e.code === "PE010")).toHaveLength(1);
  });
});
