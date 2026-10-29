import { describe, it, expect } from "vitest";
import { computeBreakDepth, computeContinueDepth, EmitContextStack } from "../../../src/backend/wasm/loop-context.js";

// WASM Loops - Phase 1: Loop Context Model infrastructure.
// DELIBERATELY ISOLATED - not yet wired into any existing while
// encoder (per the approved, staged implementation plan: build and
// test infrastructure first, wire in later, one real step at a time).

describe("Loop Context Model: real depth algorithm, reproducing the CURRENT, already-supported behavior exactly", () => {
  it("break directly inside a loop body (zero IfContexts) -> depth 1, matching the real, existing code's own value", () => {
    expect(computeBreakDepth([{ kind: "loop" }])).toBe(1);
  });

  it("continue directly inside a loop body -> depth 0, matching the real, existing code's own value", () => {
    expect(computeContinueDepth([{ kind: "loop" }])).toBe(0);
  });

  it("break inside one nested if inside a loop (one IfContext) -> depth 2, matching the real, existing code's own value ('if=0, loop=1, block=2')", () => {
    expect(computeBreakDepth([{ kind: "loop" }, { kind: "if" }])).toBe(2);
  });

  it("continue inside one nested if inside a loop -> depth 1, matching the real, existing code's own value", () => {
    expect(computeContinueDepth([{ kind: "loop" }, { kind: "if" }])).toBe(1);
  });

  it("illustrative case beyond current scope (if-inside-if-inside-loop): break -> depth 3, continue -> depth 2 - confirms the formula generalizes, NOT a claim this case is implemented/supported yet", () => {
    const stack = [{ kind: "loop" as const }, { kind: "if" as const }, { kind: "if" as const }];
    expect(computeBreakDepth(stack)).toBe(3);
    expect(computeContinueDepth(stack)).toBe(2);
  });

  it("real error, not silent failure: break/continue with no enclosing loop throws a clear error", () => {
    expect(() => computeBreakDepth([{ kind: "if" }])).toThrow(/no enclosing LoopContext/);
    expect(() => computeContinueDepth([])).toThrow(/no enclosing LoopContext/);
  });
});

describe("EmitContextStack: real LIFO discipline (Invariant 4)", () => {
  it("push then pop returns to the exact prior state", () => {
    const stack = new EmitContextStack();
    stack.push({ kind: "loop" });
    expect(stack.breakDepth()).toBe(1);
    stack.push({ kind: "if" });
    expect(stack.breakDepth()).toBe(2);
    stack.pop();
    expect(stack.breakDepth()).toBe(1); // back to the exact prior state
    stack.pop();
    expect(stack.snapshot()).toEqual([]);
  });

  it("popping an empty stack throws a real error, not silent corruption", () => {
    const stack = new EmitContextStack();
    expect(() => stack.pop()).toThrow(/stack is already empty/);
  });

  it("Invariant 3, demonstrated unambiguously: with the currently-supported one-loop-in-stack shapes, weighted count and raw stack.length happen to coincide numerically for these specific small examples - a genuine, unambiguous divergence only appears with more than one LoopContext in the stack (an illustrative case beyond this phase's own real scope - while-inside-while - included here ONLY to demonstrate the real formula's own design, not as a claim that shape is supported)", () => {
    // Illustrative only (while-inside-while is explicitly out of this
    // phase's own scope): 2 stack entries (both loop), but breakDepth
    // targets the NEAREST (top) loop's own real depth-1 wrapper,
    // completely ignoring the outer loop's own 2 real wrappers - a
    // real, unambiguous divergence from stack.length (2 vs 1).
    const illustrativeStack = [{ kind: "loop" as const }, { kind: "loop" as const }];
    expect(illustrativeStack.length).toBe(2);
    expect(computeBreakDepth(illustrativeStack)).toBe(1); // targets the NEAREST loop only - real divergence from stack.length
  });
});
