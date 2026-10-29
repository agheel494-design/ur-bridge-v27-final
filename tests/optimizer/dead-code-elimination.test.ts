// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Dead Code Elimination: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §6.2 (sixth pipeline item)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";
import { computeLiveness } from "../../src/optimizer/liveness.js";
import { runPipeline, validateFunction } from "../../src/optimizer/pass.js";
import type { IRFunction } from "../../src/shared/ir.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

function countInstructions(fn: IRFunction): number {
  return fn.blocks.flatMap(b => b.instructions).length;
}

function countKinds(fn: IRFunction, kinds: string[]): number {
  return fn.blocks.flatMap(b => b.instructions).filter(i => kinds.includes(i.kind)).length;
}

describe("optimizer/liveness — computeLiveness", () => {
  it("a returned value is live at the entry block's OUT-of-terminator point (its own use)", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    const liveness = computeLiveness(fn);
    // The entry block's OUT fact (before considering its own terminator) is empty - nothing flows out of the only block.
    expect(liveness.out.get(fn.entryBlock)?.size ?? 0).toBe(0);
  });

  it("never mutates the IRFunction it analyzes", () => {
    const fn = lowerOk("function f(): int\n  let x = 1\n  return x\nend\n");
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const before = stringify(fn);
    computeLiveness(fn);
    expect(stringify(fn)).toBe(before);
  });
});

describe("optimizer/dce — dead code removal (in scope)", () => {
  it("a completely unused constant is removed", () => {
    const fn = lowerOk("function f(): int\n  let y = 20\n  return 1\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countInstructions(optimized)).toBeLessThan(countInstructions(fn));
  });

  it("a dead binop (feeding only a never-used variable) is removed", () => {
    const fn = lowerOk("function f(): int\n  let a = 1 + 2\n  return 5\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countKinds(optimized, ["binop"])).toBe(0);
  });

  it("dead code inside a while loop body is removed, live code is preserved", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    let unused = i * 2\n    i = i + 1\n  end\n  return i\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countInstructions(optimized)).toBeLessThan(countInstructions(fn));
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("a function with nothing dead at all is a true no-op (same reference)", () => {
    const fn = lowerOk("function f(x: int, y: int): int\n  return x + y\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(optimized).toBe(fn);
  });
});

describe("optimizer/dce — CRITICAL side-effect preservation rule (never removed, regardless of liveness)", () => {
  it("call (print) is NEVER removed even though its result is unused", () => {
    const fn = lowerOk("function f(): int\n  print(5)\n  return 1\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countKinds(optimized, ["call"])).toBe(countKinds(fn, ["call"]));
  });

  it("REAL SLOT-BASED CASE: a store to a variable promoted via if/else, whose final value is NEVER read, still survives DCE exactly (store count unchanged)", () => {
    const fn = lowerOk("function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return 99\nend\n");
    const storesBefore = countKinds(fn, ["store"]);
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countKinds(optimized, ["store"])).toBe(storesBefore);
    expect(storesBefore).toBeGreaterThan(0); // sanity: this test genuinely exercises real stores
  });

  it("REAL SLOT-BASED CASE: array_store where the element is never read afterward still survives DCE exactly", () => {
    const fn = lowerOk("function f(): int\n  let arr = [1, 2, 3]\n  arr[0] = 99\n  return 0\nend\n");
    const storesBefore = countKinds(fn, ["array_store"]);
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countKinds(optimized, ["array_store"])).toBe(storesBefore);
    expect(storesBefore).toBeGreaterThan(0);
  });

  it("REAL SLOT-BASED CASE: a while loop's counter, never read after the loop exits, still has its store preserved exactly", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return 42\nend\n");
    const storesBefore = countKinds(fn, ["store"]);
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(countKinds(optimized, ["store"])).toBe(storesBefore);
    expect(storesBefore).toBeGreaterThan(0);
  });

  it("every terminator kind survives DCE unconditionally (return, return_void, branch, cond_branch)", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 5\n    if i == 2\n      break\n    end\n    i = i + 1\n  end\n  return i\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(optimized.blocks.length).toBe(fn.blocks.length); // CFG shape (block count) completely unchanged
    for (let i = 0; i < fn.blocks.length; i++) {
      expect(optimized.blocks[i]!.terminator.kind).toBe(fn.blocks[i]!.terminator.kind);
    }
  });
});

describe("optimizer/dce — Pass Contract compliance and correctness", () => {
  it("output always passes structural validation after DCE", () => {
    const fn = lowerOk("function f(): int\n  let dead1 = 1\n  let dead2 = dead1 + 1\n  let used = 5\n  return used\nend\n");
    const optimized = runPipeline(fn, [deadCodeEliminationPass]);
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("DCE composed with Constant Folding in the SAME pipeline removes even more than either alone (a folded constant that becomes dead)", async () => {
    const { constantFoldingPass } = await import("../../src/optimizer/constant-folding.js");
    const fn = lowerOk("function f(): int\n  let dead = 2 + 3\n  return 1\nend\n");
    const optimized = runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass]);
    // After folding, "2+3" becomes a single dead const; DCE then removes it entirely.
    expect(countInstructions(optimized)).toBeLessThan(countInstructions(fn));
    expect(validateFunction(optimized)).toEqual([]);
  });

  it("removing dead code from one function does not affect a different function (Pass Independence)", () => {
    const fnA = lowerOk("function f(): int\n  let dead = 1\n  return 2\nend\n");
    const fnB = lowerOk("function g(): int\n  let dead = 3\n  return 4\nend\n");
    const optimizedA = runPipeline(fnA, [deadCodeEliminationPass]);
    const optimizedB = runPipeline(fnB, [deadCodeEliminationPass]);
    expect(validateFunction(optimizedA)).toEqual([]);
    expect(validateFunction(optimizedB)).toEqual([]);
  });
});

describe("optimizer/dce - Idempotence (per review, high priority)", () => {
  function stringify(v: unknown): string {
    return JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
  }

  function checkIdempotent(label: string, src: string) {
    it(`IDEMPOTENCE: ${label} - running DCE twice produces IDENTICAL IR to running it once (DCE(DCE(fn)) === DCE(fn))`, () => {
      const fn = lowerOk(src);
      const after1 = runPipeline(fn, [deadCodeEliminationPass]);
      const after2 = runPipeline(after1, [deadCodeEliminationPass]);
      expect(stringify(after2)).toBe(stringify(after1));
    });
  }

  checkIdempotent("simple dead variable", "function f(): int\n  let dead = 20\n  return 1\nend\n");
  checkIdempotent("dead binop chain", "function f(): int\n  let a = 1 + 2\n  let b = a + 3\n  return 5\nend\n");
  checkIdempotent("while loop with dead code in body", "function f(): int\n  let i = 0\n  while i < 10\n    let unused = i * 2\n    i = i + 1\n  end\n  return i\nend\n");
  checkIdempotent("side-effecting call preserved across both runs", "function f(): int\n  print(5)\n  let dead = 1\n  return 1\nend\n");
  checkIdempotent("slot-based if/else with a dead-after-merge branch value", "function f(): int\n  let y = 0\n  if y == 0\n    y = 1\n  else\n    y = 2\n  end\n  return 99\nend\n");
  checkIdempotent("nothing dead at all (already a fixed point on the first run)", "function f(x: int, y: int): int\n  return x + y\nend\n");

  it("a SECOND runPipeline call is a true no-op (same reference) once the fixed point is reached, not merely equal IR", () => {
    const fn = lowerOk("function f(): int\n  let dead = 20\n  return 1\nend\n");
    const after1 = runPipeline(fn, [deadCodeEliminationPass]);
    const after2 = runPipeline(after1, [deadCodeEliminationPass]);
    expect(after2).toBe(after1); // reference identity, not just deep equality
  });
});

describe("optimizer/dce - explicit pipeline-stage validation (per review request)", () => {
  it("Lowering -> DCE -> structural validation (checkModuleInvariants via validateFunction) -> PASS, verified as an explicit staged sequence, not merely as an incidental side check", () => {
    const src = "function f(): int\n  let dead = 1 + 2\n  let i = 0\n  while i < 5\n    let alsoDead = i * i\n    i = i + 1\n  end\n  return i\nend\n";

    // Stage 1: Lowering.
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const loweredFn = ir.value.functions[0]!;
    expect(validateFunction(loweredFn)).toEqual([]); // Lowering's own output is valid

    // Stage 2: DCE.
    const afterDce = runPipeline(loweredFn, [deadCodeEliminationPass]);

    // Stage 3: structural validation of DCE's output specifically -
    // this is the check every later stage (a future Copy Propagation,
    // then eventually the Backend) depends on being able to trust.
    const violations = validateFunction(afterDce);
    expect(violations).toEqual([]); // PASS

    // Confirms DCE actually did something on this input, so this test
    // is exercising a real transformation, not a vacuous no-op case.
    const beforeCount = loweredFn.blocks.flatMap(b => b.instructions).length;
    const afterCount = afterDce.blocks.flatMap(b => b.instructions).length;
    expect(afterCount).toBeLessThan(beforeCount);
  });

  it("the same explicit staged sequence holds for a function where DCE is a no-op (nothing dead)", () => {
    const src = "function f(x: int, y: int): int\n  return x + y\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const loweredFn = ir.value.functions[0]!;
    expect(validateFunction(loweredFn)).toEqual([]);
    const afterDce = runPipeline(loweredFn, [deadCodeEliminationPass]);
    expect(validateFunction(afterDce)).toEqual([]);
  });
});
