import { describe, it, expect } from "vitest";
import { emitWasmModule } from "../../../src/backend/wasm/emit-wasm.js";

// Prerequisite Investigation completion (COMPILER_BACKLOG.md).
// A hand-built IR fixture that passes every WASM1001 check (valid
// Merge/3.1A.5 shape), plus a second fixture that deliberately
// violates the MERGE_IMMEDIATE_RETURN_CONTRACT to target WASM1002
// (UNSUPPORTED_CFG_SHAPE) directly. See PREREQUISITE_INVESTIGATION.md
// for the full construction rationale.

const loc = { file: "fixture.ur", line: 1, column: 1 };

function buildValidMergeFixture(extraMergeInstructions: any[] = []) {
  return {
    moduleName: "test",
    externs: [],
    functions: [{
      qualifiedName: "test::f",
      sourceName: "f",
      params: [],
      returnType: "i64" as const,
      entryBlock: 0,
      location: loc,
      locals: [{ id: 100, name: "result", type: "i64" as const }],
      blocks: [
        { id: 0, label: "entry", instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 2n }, location: loc },
            { kind: "binop", id: 2, type: "bool", op: "eq", left: { id: 0 }, right: { id: 1 }, location: loc },
          ],
          terminator: { kind: "cond_branch", condition: { id: 2 }, thenTarget: 1, elseTarget: 2, location: loc } },
        { id: 1, label: "then", instructions: [
            { kind: "const", id: 3, type: "i64", value: { kind: "const_int", value: 10n }, location: loc },
            { kind: "store", slot: 100, value: { id: 3 }, location: loc },
          ],
          terminator: { kind: "branch", target: 3, location: loc } },
        { id: 2, label: "else", instructions: [
            { kind: "const", id: 4, type: "i64", value: { kind: "const_int", value: 20n }, location: loc },
            { kind: "store", slot: 100, value: { id: 4 }, location: loc },
          ],
          terminator: { kind: "branch", target: 3, location: loc } },
        { id: 3, label: "merge", instructions: [
            { kind: "load", id: 5, type: "i64", slot: 100, location: loc },
            ...extraMergeInstructions,
          ],
          terminator: { kind: "return", value: { id: 5 }, location: loc } },
      ],
    }],
  };
}

describe("WASM IR Fixtures: Prerequisite Investigation completion", () => {
  it("a correctly-constructed Merge (3.1A.5) fixture passes ALL WASM1001 checks and compiles", () => {
    const bytes = emitWasmModule(buildValidMergeFixture() as any);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("WASM1002 (UNSUPPORTED_CFG_SHAPE) IS reachable: a store inside the merge block violates MERGE_IMMEDIATE_RETURN_CONTRACT and is correctly rejected, EXCLUSIVELY under WASM1002 - no other diagnostic code present in the same message", () => {
    const extraStore = [
      { kind: "const", id: 6, type: "i64", value: { kind: "const_int", value: 30n }, location: loc },
      { kind: "store", slot: 100, value: { id: 6 }, location: loc },
    ];
    let caught: Error | undefined;
    try {
      emitWasmModule(buildValidMergeFixture(extraStore) as any);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/WASM1002/);
    // Exclusivity check, per explicit direction: the failure must be
    // ONLY WASM1002 - no other diagnostic code present in the same
    // message. Using .includes() directly rather than .not.toMatch(),
    // since this project's own local test-runner mock does not
    // support .not.toMatch() - discovered by actually running this
    // test, not assumed.
    expect(caught!.message.includes("WASM1001")).toBe(false);
    expect(caught!.message.includes("WASM1003")).toBe(false);
    expect(caught!.message.includes("WASM1004")).toBe(false);
  });
});
