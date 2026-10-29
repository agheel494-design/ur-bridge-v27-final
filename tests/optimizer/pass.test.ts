// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Pass Framework: Unit Tests
// Level 2.9, OPTIMIZER_SPEC.md §2 (first pipeline item, per the
// review-mandated one-item-per-batch execution rule)
// ─────────────────────────────────────────────────────────────────────────────
//
// Golden Tests and E2E Tests are deliberately NOT part of this file.
// With zero passes registered (the only configuration this batch
// ships), there is no IR transformation to snapshot and no observable
// behavior change to verify by real compilation/execution — both
// become meaningful starting with the first real pass (Constant
// Folding, next in the fixed pipeline order), not for the bare
// framework itself. Unit tests are the correct and sufficient artifact
// for this specific item.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import {
  runPipeline, validateFunction, OptimizerValidationError,
  type OptimizationPass,
} from "../../src/optimizer/pass.js";
import type { IRFunction } from "../../src/shared/ir.js";
import { SYNTHETIC_LOCATION as loc } from "../../src/shared/locations.js";

function lowerOk(src: string): IRFunction {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lowering failed: ${JSON.stringify(ir.diagnostics)}`);
  return ir.value.functions[0]!;
}

describe("optimizer/pass — validateFunction", () => {
  it("a real, valid IRFunction (straight-line) produces zero violations", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });

  it("a real, valid IRFunction with control flow (if/else) produces zero violations", () => {
    const fn = lowerOk("function f(x: int): int\n  if x > 0\n    return 1\n  else\n    return 0\n  end\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });

  it("a real, valid IRFunction with a while loop and local slots produces zero violations", () => {
    const fn = lowerOk("function f(): int\n  let i = 0\n  while i < 10\n    i = i + 1\n  end\n  return i\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });

  it("a real, valid IRFunction with arrays produces zero violations", () => {
    const fn = lowerOk("function f(): int\n  let arr = [1, 2, 3]\n  return arr[0]\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });

  it("a real, valid IRFunction with structs produces zero violations", () => {
    const fn = lowerOk("struct Point\n  x: int\n  y: int\nend\nfunction f(): int\n  let p = Point(1, 2)\n  return p.x\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });

  it("a deliberately corrupted IRFunction (load referencing a nonexistent slot) is detected", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const corrupted: IRFunction = {
      ...fn,
      blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 999, type: "i64", slot: 9999, location: loc }], terminator: { kind: "return", value: { id: 999 }, location: loc } }],
    };
    const violations = validateFunction(corrupted);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("validateFunction never mutates the function it validates (pure read-only check)", () => {
    const fn = lowerOk("function f(): int\n  return 42\nend\n");
    const stringify = (v: unknown) => JSON.stringify(v, (_k, val) => typeof val === "bigint" ? val.toString() : val);
    const before = stringify(fn);
    validateFunction(fn);
    expect(stringify(fn)).toBe(before);
  });
});

describe("optimizer/pass — runPipeline (no-op configuration, zero passes)", () => {
  it("with zero passes, returns the exact same function reference unchanged (true no-op)", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    const result = runPipeline(fn, []);
    expect(result).toBe(fn); // reference equality — genuinely unchanged, not just deep-equal
  });

  it("with zero passes, still validates the input and throws if it were already invalid", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const corrupted: IRFunction = {
      ...fn,
      blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 1, type: "i64", slot: 12345, location: loc }], terminator: { kind: "return", value: { id: 1 }, location: loc } }],
    };
    expect(() => runPipeline(corrupted, [])).toThrow(OptimizerValidationError);
  });

  it("the thrown error's 'stage' is 'before' when the INPUT is already invalid", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const corrupted: IRFunction = {
      ...fn,
      blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 1, type: "i64", slot: 12345, location: loc }], terminator: { kind: "return", value: { id: 1 }, location: loc } }],
    };
    let caught: OptimizerValidationError | undefined;
    try {
      runPipeline(corrupted, []);
    } catch (e) {
      caught = e as OptimizerValidationError;
    }
    expect(caught?.name).toBe("OptimizerValidationError");
    expect(caught?.stage).toBe("before");
  });
});

describe("optimizer/pass — runPipeline (with a test pass, proving the driver's validation boundary works)", () => {
  it("a well-behaved pass (identity) runs successfully and returns valid IR", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    const identityPass: OptimizationPass = { name: "identity", run: (f) => f };
    const result = runPipeline(fn, [identityPass]);
    expect(validateFunction(result)).toEqual([]);
  });

  it("a pass that produces invalid IR is caught by the driver, not silently allowed through", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const breakingPass: OptimizationPass = {
      name: "deliberately-broken-pass",
      run: (f) => ({
        ...f,
        blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 777, type: "i64", slot: 66666, location: loc }], terminator: f.blocks[0]!.terminator }],
      }),
    };
    expect(() => runPipeline(fn, [breakingPass])).toThrow(OptimizerValidationError);
  });

  it("the thrown error's 'stage' is 'after' and 'passName' identifies the exact offending pass", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const breakingPass: OptimizationPass = {
      name: "the-specific-broken-pass-name",
      run: (f) => ({
        ...f,
        blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 777, type: "i64", slot: 66666, location: loc }], terminator: f.blocks[0]!.terminator }],
      }),
    };
    let caught: OptimizerValidationError | undefined;
    try {
      runPipeline(fn, [breakingPass]);
    } catch (e) {
      caught = e as OptimizerValidationError;
    }
    expect(caught?.name).toBe("OptimizerValidationError");
    expect(caught?.stage).toBe("after");
    expect(caught?.passName).toBe("the-specific-broken-pass-name");
  });

  it("multiple passes run in order, and a later pass's failure is correctly attributed to ITSELF, not an earlier innocent pass", () => {
    const fn = lowerOk("function f(): int\n  return 1\nend\n");
    const goodPass: OptimizationPass = { name: "innocent-pass", run: (f) => f };
    const badPass: OptimizationPass = {
      name: "guilty-pass",
      run: (f) => ({
        ...f,
        blocks: [{ id: 0, label: "entry", instructions: [{ kind: "load", id: 555, type: "i64", slot: 44444, location: loc }], terminator: f.blocks[0]!.terminator }],
      }),
    };
    let caught: OptimizerValidationError | undefined;
    try {
      runPipeline(fn, [goodPass, badPass]);
    } catch (e) {
      caught = e as OptimizerValidationError;
    }
    expect(caught?.passName).toBe("guilty-pass");
  });

  it("PASS INDEPENDENCE (section 2.3): a pass receives only the IRFunction the driver passes it — no ambient/shared mutable state exists between two separate runPipeline() calls", () => {
    const fn1 = lowerOk("function f(): int\n  return 1\nend\n");
    const fn2 = lowerOk("function g(): int\n  return 2\nend\n");
    const tracker: string[] = [];
    const recordingPass: OptimizationPass = {
      name: "recorder",
      run: (f) => { tracker.push(f.sourceName); return f; },
    };
    runPipeline(fn1, [recordingPass]);
    runPipeline(fn2, [recordingPass]);
    // The SAME pass instance was reused across two independent pipeline
    // runs and only ever saw the function it was actually given each
    // time - no cross-run state leaked into its behavior.
    expect(tracker).toEqual(["f", "g"]);
  });
});

describe("optimizer/pass - validateFunction with sibling functions (CONFIRMED BUG, fixed)", () => {
  it("CONFIRMED BUG (fixed): a function calling a SIBLING function in the same real module was incorrectly flagged as unresolved when validated alone - found via a real multi-function cross-calling program, never exercised before since every prior test used single-function or purely self-recursive programs", () => {
    const src = "function double(x: int): int\n  return x * 2\nend\nfunction main(): int\n  return double(5)\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const mainFn = ir.value.functions.find(f => f.sourceName === "main")!;
    const doubleFn = ir.value.functions.find(f => f.sourceName === "double")!;

    // Without sibling functions (the old, buggy default): main's call to
    // double() is incorrectly flagged as unresolved.
    const withoutSiblings = validateFunction(mainFn);
    expect(withoutSiblings.some(v => v.message.includes("unresolved"))).toBe(true);

    // With sibling functions supplied (the fix): correctly resolves.
    const withSiblings = validateFunction(mainFn, [doubleFn]);
    expect(withSiblings).toEqual([]);
  });

  it("runPipeline also accepts sibling functions and correctly validates a cross-calling program end-to-end", () => {
    const src = "function fact(n: int): int\n  if n <= 1\n    return 1\n  end\n  return n * fact(n - 1)\nend\nfunction main(): int\n  return fact(5)\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const mainFn = ir.value.functions.find(f => f.sourceName === "main")!;
    const factFn = ir.value.functions.find(f => f.sourceName === "fact")!;

    // main() calls fact() - a sibling - must not throw when siblings are supplied.
    expect(() => runPipeline(mainFn, [], [factFn])).not.toThrow();
  });

  it("validateFunction only reports violations belonging to the function being validated, not its siblings", () => {
    const src = "function helper(x: int): int\n  return x + 1\nend\nfunction main(): int\n  return helper(5)\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const mainFn = ir.value.functions.find(f => f.sourceName === "main")!;
    const helperFn = ir.value.functions.find(f => f.sourceName === "helper")!;
    const violations = validateFunction(mainFn, [helperFn]);
    // Every violation (if any - here there should be none) must belong to 'main', never to 'helper'.
    for (const v of violations) expect(v.functionName).toBe("main");
  });

  it("the default (no siblings supplied) preserves EXACT prior behavior for genuinely single-function validation", () => {
    const fn = lowerOk("function f(): int\n  return 1 + 2\nend\n");
    expect(validateFunction(fn)).toEqual([]);
  });
});
