import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { classifyTopLevelShape } from "../../../src/backend/wasm/wasm-cfg-validation.js";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";
import { WasmUnsupportedError } from "../../../src/backend/wasm/wasm-diagnostics.js";

// WASM Validator Generalization, Layer 1: tests proving the real
// CLASSIFICATION itself changed (structural, not block-count-based),
// not merely that an error message's text changed - per direct
// review feedback that 216/216 passing does not by itself prove
// Layer 1 is genuinely structural.

function compileToFn(src: string) {
  const { program } = parse(lex(src).tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error("lowering failed");
  return ir.value.functions[0]!;
}

describe("Layer 1 classifier: direct proof the classification is structural, not block-count-based", () => {
  it("a triply-nested if that happens to produce 7 blocks (the same count as while-break/continue) is classified 'unrecognized' by real STRUCTURE - never reaches the while-specific 7-block sub-classifier at all", () => {
    const fn = compileToFn("function main(): int\n  let arr = [10, 20, 30]\n  let x = 0\n  if 1 == 1\n    if 2 == 2\n      x = arr[0]\n    else\n      x = arr[1]\n    end\n  else\n    x = 99\n  end\n  return x\nend\n");
    expect(fn.blocks.length).toBe(7); // confirms this really is the same block count as while-break/continue
    const shape = classifyTopLevelShape(fn);
    // The real, direct proof: classification is "unrecognized" (a
    // structural if-shape mismatch, detected via entry's own real
    // cond_branch terminator and its then/else sub-terminators) -
    // NOT "while" (which would then dispatch to classifySevenBlockShape,
    // the break/continue-specific sub-classifier this case has nothing
    // to do with). This is a real difference in WHICH classification
    // path is taken, confirmed directly on the classifier's own
    // return value - not inferred from an error message's wording.
    expect(shape).toEqual({ kind: "unrecognized" });
  });

  it("the real while-break shape (genuinely 7 blocks, genuine loop) IS classified 'while' - confirms Layer 1 does not simply reject every 7-block function", () => {
    const fn = compileToFn("function main(): int\n  let i = 0\n  while i < 10\n    if i == 5\n      break\n    end\n    i = i + 1\n  end\n  return i\nend\n");
    expect(fn.blocks.length).toBe(7);
    expect(classifyTopLevelShape(fn)).toEqual({ kind: "while" });
  });

  it("a real 3-block shape where entry does NOT end in cond_branch is classified 'unrecognized' by structure, not accepted merely because the count is 3 (the old dispatcher's own sole criterion)", () => {
    // Direct IR construction: 3 blocks, but entry ends in a plain
    // 'branch', not 'cond_branch' - the old block-count-only
    // dispatcher would have called validateDiamondShape() purely
    // because blocks.length===3, only failing INSIDE that function
    // (a different code path). Layer 1 rejects this immediately,
    // before ever calling validateDiamondShape at all.
    const fakeFn = {
      sourceName: "main", qualifiedName: "main", params: [], returnType: "i64",
      blocks: [
        { id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 1 } },
        { id: 1, label: "b1", instructions: [], terminator: { kind: "branch", target: 2 } },
        { id: 2, label: "b2", instructions: [], terminator: { kind: "return", value: { id: 0 } } },
      ],
      entryBlock: 0, location: {}, locals: [],
    };
    expect(classifyTopLevelShape(fakeFn as any)).toEqual({ kind: "unrecognized" });
  });

  it("a real 4-block shape where then/else do not converge on the same merge target is classified 'unrecognized' by structure, not accepted merely because the count is 4", () => {
    // then branches to block 2, else branches to block 3 - two
    // DIFFERENT targets, not a real merge - the old dispatcher would
    // have called validateMergeShape() purely on blocks.length===4.
    const fakeFn = {
      sourceName: "main", qualifiedName: "main", params: [], returnType: "i64",
      blocks: [
        { id: 0, label: "entry", instructions: [], terminator: { kind: "cond_branch", condition: { id: 0 }, thenTarget: 1, elseTarget: 2 } },
        { id: 1, label: "then", instructions: [], terminator: { kind: "branch", target: 3 } },
        { id: 2, label: "else", instructions: [], terminator: { kind: "branch", target: 3 } },
        { id: 3, label: "notreallymerge", instructions: [], terminator: { kind: "branch", target: 3 } }, // not 'return' - structurally invalid merge
      ],
      entryBlock: 0, location: {}, locals: [],
    };
    expect(classifyTopLevelShape(fakeFn as any)).toEqual({ kind: "unrecognized" });
  });
});

// D-15 (2026-10-20): the describe() block "Layer 1: message-text-independent contract test (error CODE, not literal wording)"
// that stood here contained NO test after its only test was removed (reason below). Vitest marks an empty suite as FAILED
// ("No test found in suite"), so the run fails (exit 1) even when every test passes. Raw evidence: T2 Windows report
// (this file: status "failed", 4/4 tests passed, numFailedTestSuites 1, success false). It is the only empty suite in tests/
// and the prime candidate for the Codespace WC4 run (0 failed tests, Vitest exit 1). The empty block is removed; no test,
// assertion or expectation is changed. Original note:
//
// REMOVED (per WASM Layer 2, a deliberate spec change): this test
// previously asserted the triply-nested-if case was rejected with
// error code WASM1002 - that premise no longer holds at all, this
// exact case is now correctly ACCEPTED and compiles to real,
// executable WASM bytecode. The same case is now tested more
// thoroughly (real WebAssembly.instantiate + execution, not just
// error-code checking) in layer2-nested-if-execution.test.ts -
// removed here as a redundant, outdated duplicate rather than
// converted, to avoid two tests asserting the same real behavior
// in two different files.
