// ─────────────────────────────────────────────────────────────────────────────
// UR — Tests: CFG Visual Validation
// Level 2.6.1.5
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { renderCfgText, renderCfgDot } from "../../src/shared/cfg-debug.js";
import type { IRFunction } from "../../src/shared/ir.js";
import { SYNTHETIC_LOCATION as loc } from "../../src/shared/locations.js";

function makeLoopShapedFn(): IRFunction {
  return {
    qualifiedName: "ur_t_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc,
    locals: [{ id: 0, name: "i", type: "i64" }],
    blocks: [
      { id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 1, location: loc } },
      { id: 1, label: "loop_header", instructions: [{ kind: "load", id: 0, type: "i64", slot: 0, location: loc }],
        terminator: { kind: "cond_branch", condition: { id: 0 }, thenTarget: 2, elseTarget: 3, location: loc } },
      { id: 2, label: "loop_body", instructions: [], terminator: { kind: "branch", target: 1, location: loc } },
      { id: 3, label: "loop_exit", instructions: [], terminator: { kind: "return_void", location: loc } },
    ],
  };
}

describe("cfg-debug — renderCfgText", () => {
  it("lists every block with its label and terminator kind", () => {
    const text = renderCfgText(makeLoopShapedFn());
    expect(text).toContain("BB0 (entry)");
    expect(text).toContain("BB1 (loop_header)");
    expect(text).toContain("BB2 (loop_body)");
    expect(text).toContain("BB3 (loop_exit)");
    expect(text).toContain("terminator: cond_branch");
  });

  it("marks the entry block explicitly", () => {
    const text = renderCfgText(makeLoopShapedFn());
    expect(text).toContain("[entry]");
  });

  it("shows both edges of a cond_branch (then and else targets)", () => {
    const text = renderCfgText(makeLoopShapedFn());
    const lines = text.split("\n");
    const headerIdx = lines.findIndex(l => l.includes("BB1 (loop_header)"));
    expect(lines[headerIdx + 1]).toContain("-> BB2");
    expect(lines[headerIdx + 2]).toContain("-> BB3");
  });

  it("shows the loop-back edge (BB2 -> BB1)", () => {
    const text = renderCfgText(makeLoopShapedFn());
    const lines = text.split("\n");
    const bodyIdx = lines.findIndex(l => l.includes("BB2 (loop_body)"));
    expect(lines[bodyIdx + 1]).toContain("-> BB1");
  });

  it("a block with no successors (return/return_void) lists zero edges", () => {
    const text = renderCfgText(makeLoopShapedFn());
    const lines = text.split("\n");
    const exitIdx = lines.findIndex(l => l.includes("BB3 (loop_exit)"));
    // BB3 is the last block, so the next line (if any) must not be an edge line.
    const nextLine = lines[exitIdx + 1];
    const hasFollowingEdge = nextLine !== undefined && nextLine.includes("->");
    expect(hasFollowingEdge).toBe(false);
  });

  it("a single-block straight-line function renders without any edges", () => {
    const fn: IRFunction = {
      qualifiedName: "ur_t_g", sourceName: "g", params: [], returnType: "i64", entryBlock: 0, location: loc,
      locals: [],
      blocks: [{
        id: 0, label: "entry",
        instructions: [{ kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc }],
        terminator: { kind: "return", value: { id: 0 }, location: loc },
      }],
    };
    const text = renderCfgText(fn);
    expect(text).toContain("1 block");
    expect(text).not.toContain("->");
  });
});

describe("cfg-debug — renderCfgDot", () => {
  it("produces valid-looking DOT syntax (digraph wrapper, node declarations, edges)", () => {
    const dot = renderCfgDot(makeLoopShapedFn());
    expect(dot.startsWith("digraph f {")).toBe(true);
    expect(dot.trim().endsWith("}")).toBe(true);
    expect(dot).toContain("BB0 [label=");
    expect(dot).toContain("BB0 -> BB1;");
  });

  it("marks the entry block with a distinct style", () => {
    const dot = renderCfgDot(makeLoopShapedFn());
    expect(dot).toContain("style=bold");
  });

  it("emits exactly one edge line per successor (2 for the cond_branch block)", () => {
    const dot = renderCfgDot(makeLoopShapedFn());
    const edgesFromHeader = dot.split("\n").filter(l => l.trim().startsWith("BB1 ->"));
    expect(edgesFromHeader).toHaveLength(2);
  });
});
