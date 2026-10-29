// ─────────────────────────────────────────────────────────────────────────────
// UR Language — Integration Tests: Full Frontend Pipeline
// UR Source → Lexer → Parser → AST → Semantic Analyzer
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests drive the complete chain for the first time. They are the
// "Phase 9: Integration Tests" from the approved merge plan, and the
// first concrete proof that the frontend can process a real UR program
// end-to-end without simulation.

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";

// ── Full pipeline helper ──────────────────────────────────────────────────────

type PipelineResult = ReturnType<typeof analyze> & { lexErrors: number; parseErrors: number };

function pipeline(src: string): PipelineResult {
  const { tokens, errors: lexErrors } = lex(src);
  const { program, errors: parseErrors } = parse(tokens);
  const semanticResult = analyze(program);
  return {
    ...semanticResult,
    lexErrors: lexErrors.length,
    parseErrors: parseErrors.length,
  };
}

// ── English programs ──────────────────────────────────────────────────────────

describe("Integration — English programs through full pipeline", () => {
  it("minimal valid program: function with return", () => {
    const result = pipeline(`
function add(a, b)
  return a + b
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
    expect(result.diagnostics.filter(e => e.severity === "error")).toHaveLength(0);
  });

  it("import + function call: zero errors", () => {
    const result = pipeline(`
import math

function main()
  let result = math.sqrt(16)
  return result
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("if/else with return in each branch", () => {
    const result = pipeline(`
function classify(x)
  if x > 0
    return "positive"
  else
    return "non-positive"
  end
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("while loop with break", () => {
    const result = pipeline(`
function find(items)
  let i = 0
  while true
    break
  end
  return i
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("for loop over iterable", () => {
    const result = pipeline(`
function process(items)
  for item in items
    print(item)
  end
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("if as expression (ConditionalExpression)", () => {
    const result = pipeline(`
function label(age)
  let tag = if age >= 18
    "adult"
  else
    "minor"
  end
  return tag
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("nested function calls", () => {
    const result = pipeline(`
function main()
  print(add(1, multiply(2, 3)))
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("method call: module.function(arg)", () => {
    const result = pipeline(`
import sqlite

function run()
  let db = sqlite.open(":memory:")
  return db
end
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });
});

// ── Arabic programs ───────────────────────────────────────────────────────────

describe("Integration — Arabic programs through full pipeline", () => {
  it("minimal valid Arabic program", () => {
    const result = pipeline(`
دالة اجمع(أ، ب)
  أرجع أ + ب
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
    expect(result.diagnostics.filter(e => e.severity === "error")).toHaveLength(0);
  });

  it("Arabic import + function", () => {
    const result = pipeline(`
استورد حساب

دالة رئيسية()
  عرف نتيجة = حساب.جذر(16)
  أرجع نتيجة
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("Arabic if/else: إذا/وإلا/نهاية", () => {
    const result = pipeline(`
دالة صنّف(س)
  إذا س > 0
    أرجع "موجب"
  وإلا
    أرجع "غير موجب"
  نهاية
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("Arabic while: بينما/اكسر/نهاية", () => {
    const result = pipeline(`
دالة ف()
  بينما صحيح
    اكسر
  نهاية
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("Arabic for: لكل/في/نهاية", () => {
    const result = pipeline(`
دالة معالجة(عناصر)
  لكل عنصر في عناصر
    اطبع(عنصر)
  نهاية
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it("Arabic if-expression (تعبير شرطي)", () => {
    const result = pipeline(`
دالة تصنيف(عمر)
  دع تصنيف = إذا عمر >= 18
    "بالغ"
  وإلا
    "قاصر"
  نهاية
  أرجع تصنيف
نهاية
`.trim() + "\n");
    expect(result.lexErrors).toBe(0);
    expect(result.parseErrors).toBe(0);
  });
});

// ── Arabic / English equivalence ──────────────────────────────────────────────

describe("Integration — Arabic and English produce equivalent pipeline results", () => {
  it("both produce zero lex/parse/semantic errors", () => {
    const english = pipeline(`
import math

function add(a, b)
  return a + b
end

print(add(5, 7))
`.trim() + "\n");

    const arabic = pipeline(`
استورد حساب

دالة اجمع(أ، ب)
  أرجع أ + ب
نهاية

اطبع(اجمع(5، 7))
`.trim() + "\n");

    expect(english.lexErrors).toBe(0);
    expect(english.parseErrors).toBe(0);
    expect(arabic.lexErrors).toBe(0);
    expect(arabic.parseErrors).toBe(0);
  });

  it("function structure: both produce one function with one return statement", () => {
    const { tokens: t1, errors: e1 } = lex("function add(a, b)\n  return a + b\nend\n");
    const { tokens: t2, errors: e2 } = lex("دالة اجمع(أ، ب)\n  أرجع أ + ب\nنهاية\n");
    const { program: p1 } = parse(t1);
    const { program: p2 } = parse(t2);
    expect(p1.functions).toHaveLength(1);
    expect(p2.functions).toHaveLength(1);
    expect(p1.functions[0]!.body.statements).toHaveLength(1);
    expect(p2.functions[0]!.body.statements).toHaveLength(1);
    expect(p1.functions[0]!.body.statements[0]!.kind).toBe("ReturnStatement");
    expect(p2.functions[0]!.body.statements[0]!.kind).toBe("ReturnStatement");
  });
});

// ── Semantic error detection ───────────────────────────────────────────────────

describe("Integration — type annotation casing regression (resolveTypeRef)", () => {
  it("REGRESSION (exact case from engineering review): 'دالة رئيسية()\\n  متغير س : int = 5\\nنهاية' passes Lexer→Parser→AST→Semantic→TypeChecker with zero diagnostics", () => {
    const src = "دالة رئيسية()\n  عرف س: int = 5\nنهاية\n";
    const { tokens, errors: lexErrors } = lex(src);
    expect(lexErrors).toHaveLength(0);

    const { program, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);

    const semanticResult = analyze(program);
    expect(semanticResult.diagnostics).toHaveLength(0);

    const typeResult = typeCheck(program);
    expect(typeResult.diagnostics).toHaveLength(0);
  });
  it("REGRESSION: 'a: int' (UR 1.0 lowercase canonical type) resolves correctly, not TY1001", () => {
    // Found during TypeSystem integration: resolveTypeRef only recognized
    // capitalized primitive names ("Int", "Float", ...), but ast.ts's
    // CANONICAL_TYPE table (matching UR_LANGUAGE_SPEC_1_0.md §6.1) produces
    // lowercase ("int", "float", ...). Every typed UR 1.0 program failed
    // type-checking with "unknown type" before the fix in type-env.ts.
    const src = "function add(a: int, b: int): int\n  return a + b\nend\n";
    const { tokens } = lex(src);
    const { program, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    
    const result = typeCheck(program);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("REGRESSION: Arabic type names ('عدد' -> 'int') also resolve correctly through TypeSystem", () => {
    const src = "دالة اجمع(أ: عدد، ب: عدد): عدد\n  أرجع أ + ب\nنهاية\n";
    const { tokens } = lex(src);
    const { program, errors: parseErrors } = parse(tokens);
    expect(parseErrors).toHaveLength(0);
    
    const result = typeCheck(program);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("Integration — Semantic Analyzer catches errors", () => {
  it("detects break outside loop", () => {
    const result = pipeline(`
function f()
  break
end
`.trim() + "\n");
    expect(result.parseErrors).toBe(0);
    const errors = result.diagnostics.filter(e => e.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("detects continue outside loop", () => {
    const result = pipeline(`
function f()
  continue
end
`.trim() + "\n");
    expect(result.parseErrors).toBe(0);
    const errors = result.diagnostics.filter(e => e.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
  });
});
