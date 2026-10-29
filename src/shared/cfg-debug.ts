// ─────────────────────────────────────────────────────────────────────────────
// UR — CFG Visual Validation (debugging/inspection tool)
// Level 2.6.1.5 — per explicit review request
// ─────────────────────────────────────────────────────────────────────────────
//
// NOT used by production compilation. A pure inspection utility that
// renders an IRFunction's control-flow graph structure — either as plain
// text ("BB0 -> BB1 -> BB2" style) or as Graphviz DOT — to make CFG bugs
// visible during development instead of only being caught by
// checkModuleInvariants() after the fact. This is explicitly NOT a
// drawing/rendering feature; it emits structural text only.
//
// Usage (developer-facing, e.g. from a debug script or test):
//   import { renderCfgText, renderCfgDot } from "src/shared/cfg-debug.js";
//   console.log(renderCfgText(irFunction));
// ─────────────────────────────────────────────────────────────────────────────

import type { IRFunction, IRBasicBlock } from "./ir.js";

function successorsOf(block: IRBasicBlock): number[] {
  switch (block.terminator.kind) {
    case "branch": return [block.terminator.target];
    case "cond_branch": return [block.terminator.thenTarget, block.terminator.elseTarget];
    case "return":
    case "return_void":
      return [];
  }
}

/**
 * Renders a function's CFG as plain, human-readable text:
 *
 *   BB0 (entry)
 *     -> BB1
 *   BB1 (loop_header)
 *     -> BB2 (then)
 *     -> BB4 (else)
 *   ...
 *
 * Includes each block's instruction count and terminator kind for a
 * quick structural sanity check without needing a debugger.
 */
export function renderCfgText(fn: IRFunction): string {
  const lines: string[] = [`CFG for ${fn.sourceName} (${fn.blocks.length} block${fn.blocks.length === 1 ? "" : "s"}):`];
  for (const block of fn.blocks) {
    const isEntry = block.id === fn.entryBlock ? " [entry]" : "";
    lines.push(`  BB${block.id} (${block.label})${isEntry} — ${block.instructions.length} instruction(s), terminator: ${block.terminator.kind}`);
    for (const succ of successorsOf(block)) {
      lines.push(`    -> BB${succ}`);
    }
  }
  return lines.join("\n");
}

/**
 * Renders a function's CFG as Graphviz DOT — pipe the output through
 * `dot -Tpng` (or any Graphviz renderer) for an actual visual diagram, or
 * just read the DOT text directly (it is itself a structured, readable
 * edge list). This function only emits DOT syntax; it does not invoke
 * any renderer or produce an image itself.
 */
export function renderCfgDot(fn: IRFunction): string {
  const lines: string[] = [`digraph ${fn.sourceName} {`];
  for (const block of fn.blocks) {
    const label = `BB${block.id}\\n(${block.label})\\n${block.instructions.length} instr, ${block.terminator.kind}`;
    const shape = block.id === fn.entryBlock ? "box, style=bold" : "box";
    lines.push(`  BB${block.id} [label="${label}", shape=${shape}];`);
  }
  for (const block of fn.blocks) {
    for (const succ of successorsOf(block)) {
      lines.push(`  BB${block.id} -> BB${succ};`);
    }
  }
  lines.push(`}`);
  return lines.join("\n");
}
