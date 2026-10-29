import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { buildLLVMModule } from "../../../src/backend/llvm/builder.js";
import { printLLVMModule } from "../../../src/backend/llvm/printer.js";
import { validateForLLVM } from "../../../src/backend/llvm/validator.js";
import { validateLLVMModule } from "../../../src/backend/llvm/validator.js";
import type { LLVMModule } from "../../../src/backend/llvm/types.js";

// REBUILT LLVM Backend test suite - covers all historical milestones
// (A: const/add/return, B: load/store/comparison, Control Flow
// Validator, IF, Memory-to-SSA Readiness with the Transitional Entry
// Visibility Rule) in one consolidated file, per the real rebuild
// following the documented architecture decisions.

function compileToLL(src: string): string {
  const { program } = parse(lex(src).tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lowering failed: " + JSON.stringify(ir.diagnostics));
  return printLLVMModule(buildLLVMModule(ir.value));
}

describe("Milestone A: integer literals, return, arithmetic", () => {
  it("let x=5, let y=7, return x+y -> exact target LLVM IR", () => {
    expect(compileToLL("function main(): int\n  let x = 5\n  let y = 7\n  return x + y\nend\n"))
      .toBe("define i64 @main() {\nentry_0:\n  %2 = add i64 5, 7\n  ret i64 %2\n}\n");
  });

  it("bare return with no arithmetic", () => {
    expect(compileToLL("function main(): int\n  return 42\nend\n"))
      .toBe("define i64 @main() {\nentry_0:\n  ret i64 42\n}\n");
  });
});

describe("Milestone B: comparison - the 6 official acceptance cases", () => {
  const cases: [string, string][] = [
    ["5 == 5", "eq"], ["5 != 7", "ne"], ["3 < 4", "slt"],
    ["8 > 2", "sgt"], ["5 <= 5", "sle"], ["7 >= 9", "sge"],
  ];
  for (const [expr, predicate] of cases) {
    it(`${expr} -> icmp ${predicate}`, () => {
      const ll = compileToLL(`function main(): bool\n  return ${expr}\nend\n`);
      expect(ll).toContain(`icmp ${predicate} i64`);
      expect(ll).toContain("define i1 @main()");
    });
  }
});

describe("Milestone IF: if/else where every branch returns directly", () => {
  it("if (5 == 5) return 1 else return 0", () => {
    const ll = compileToLL("function main(): int\n  if 5 == 5\n    return 1\n  else\n    return 0\n  end\nend\n");
    expect(ll).toBe("define i64 @main() {\nentry_0:\n  %2 = icmp eq i64 5, 5\n  br i1 %2, label %then_1, label %else_2\nthen_1:\n  ret i64 1\nelse_2:\n  ret i64 0\n}\n");
  });
});

describe("Memory-to-SSA Readiness: the real motivating case and general multi-block support", () => {
  it("if/else where both branches assign a shared variable, read afterward - real merge, real load, zero phi", () => {
    const ll = compileToLL("function main(): int\n  let x = 0\n  if 5 == 5\n    x = 1\n  else\n    x = 2\n  end\n  return x\nend\n");
    expect(ll).toBe("define i64 @main() {\nentry_0:\n  %3 = icmp eq i64 5, 5\n  %4 = alloca i64\n  store i64 0, ptr %4\n  br i1 %3, label %then_1, label %else_2\nthen_1:\n  store i64 1, ptr %4\n  br label %merge_3\nelse_2:\n  store i64 2, ptr %4\n  br label %merge_3\nmerge_3:\n  %7 = load i64, ptr %4\n  ret i64 %7\n}\n");
    expect(ll).not.toContain("phi");
  });

  it("if WITHOUT else: real merge with a load after", () => {
    const ll = compileToLL("function main(): int\n  let x = 0\n  if 5 == 5\n    x = 1\n  end\n  return x\nend\n");
    expect(ll).toContain("alloca i64");
    expect(ll).toMatch(/merge_\d+:/);
    expect(ll).not.toContain("phi");
  });

  it("NESTED if: all block labels genuinely unique across nesting levels", () => {
    const ll = compileToLL("function main(): int\n  let x = 0\n  if 5 == 5\n    if 3 < 4\n      x = 1\n    else\n      x = 2\n    end\n  else\n    x = 3\n  end\n  return x\nend\n");
    const labels = [...ll.matchAll(/^(\w+):$/gm)].map(m => m[1]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(ll).not.toContain("phi");
  });

  it("validator correctly rejects a real loop (cycle) - explicitly out of scope", () => {
    // Direct IR construction: a block that branches back to an
    // earlier one (a real cycle), which no simple UR program produces
    // without while (itself out of scope) - tested at the validator level directly.
    const fakeIR = {
      moduleName: "t", functions: [{
        qualifiedName: "main", sourceName: "main", params: [], returnType: "i64",
        blocks: [
          { id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 1 }, },
          { id: 1, label: "loop", instructions: [], terminator: { kind: "branch", target: 0 }, },
        ],
        entryBlock: 0, location: {}, locals: [],
      }],
      externs: [],
    };
    const result = validateForLLVM(fakeIR as any);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("cycle"))).toBe(true);
  });
});

describe("Transitional Entry Visibility Rule: mandatory leak-prevention test", () => {
  it("a value defined in 'then' (NOT entry) is NOT visible in 'merge' - the rule must not leak", () => {
    const leakModule: LLVMModule = {
      functions: [{
        name: "main", returnType: "i64", params: [],
        blocks: [
          { label: "entry", instructions: [], terminator: { kind: "br", target: "then" } },
          { label: "then", instructions: [{ kind: "const_i64", id: 5, value: 1n }], terminator: { kind: "br", target: "merge" } },
          { label: "merge", instructions: [], terminator: { kind: "ret", value: { kind: "ref", id: 5 } } },
        ],
      }],
    };
    const result = validateLLVMModule(leakModule);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("%5") && e.includes("dangling"))).toBe(true);
  });

  it("REGRESSION: a value genuinely defined in entry (alloca) IS correctly visible later", () => {
    const validModule: LLVMModule = {
      functions: [{
        name: "main", returnType: "i64", params: [],
        blocks: [
          { label: "entry", instructions: [{ kind: "alloca", id: 0, allocatedType: "i64" }], terminator: { kind: "br", target: "merge" } },
          { label: "merge", instructions: [{ kind: "load", id: 1, type: "i64", pointer: { kind: "ref", id: 0 } }], terminator: { kind: "ret", value: { kind: "ref", id: 1 } } },
        ],
      }],
    };
    expect(validateLLVMModule(validModule)).toEqual({ ok: true, errors: [] });
  });
});
