// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Call Graph Cycle Detection
// WASM_BACKEND_SPEC.md §2 (3.1A.3 scope) — per explicit review question
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURAL DECISION (per explicit review question: "should this be
// shared/call-graph.ts for future LLVM/Native backends too?"):
//
// KEPT WASM-SCOPED (src/backend/wasm/, not shared/). Reasoning:
//
//   Recursion rejection here is a TEMPORARY 3.1A.3 SCOPE LIMITATION,
//   not a permanent WASM property and not a general backend concern.
//   WASM itself supports recursion natively (a `call` to any function,
//   including the current one, is a perfectly ordinary WASM
//   instruction — nothing about the WASM instruction set forbids it).
//   This rejection exists ONLY because THIS bootstrapping sub-phase
//   (3.1A.3) has not yet decided how to handle the stack-depth/growth
//   questions recursion raises for WASM specifically, and explicitly
//   defers that decision (WASM_BACKEND_SPEC.md, per review).
//
//   The C Backend (frozen since Level 2.1) already supports recursion
//   fully and correctly (`FUNCTIONS_ABI_SPEC.md` — recursion depth is
//   explicitly "not UR's contract," delegated to the host C stack) —
//   it has NEVER needed this check and never will, since C's own call
//   stack handles recursion natively with no UR-level restriction.
//   A future LLVM backend would very likely make the same choice C
//   did (native call stack, no artificial restriction) once it's
//   unblocked. Making this a `shared/` module would imply every
//   backend needs this check, which is false — only this specific,
//   temporary WASM bootstrapping phase does.
//
//   If a genuinely cross-backend need for call-graph analysis ever
//   arises (e.g., a future Optimizer pass wanting call-graph-based
//   reasoning), THAT would be its own, separately-reviewed decision
//   to extract a shared utility — not assumed now, per this project's
//   standing YAGNI discipline (avoid building shared infrastructure
//   before a second real consumer exists, matching how the Dataflow
//   Framework itself was only generalized once DCE needed it, not
//   speculatively beforehand).
//
// This file exists as its own module (rather than being inlined into
// emit-wasm.ts) purely for readability/testability — extraction, not
// generalization.
//
// TODO(Level 3.x, per review): once recursion support and a full WASM
// runtime (stack-depth/growth handling) are implemented:
//   1. Remove this recursion prohibition — it is a temporary 3.1A.3
//      bootstrapping limitation, not a permanent design decision.
//   2. Re-evaluate whether this analysis should become backend-
//      independent (shared/) at that point, if another backend has by
//      then developed a genuine, concrete need for call-graph
//      analysis — not before, per the YAGNI reasoning above.

import type { IRFunction, IRInstruction } from "../../shared/ir.js";
import { WASM_CODES, WasmUnsupportedError } from "./wasm-diagnostics.js";

/**
 * Detects recursion (direct self-calls or longer mutual-recursion
 * cycles) across a module's call graph — explicitly OUT of scope for
 * 3.1A.3 (per review), rejected with a clear diagnostic rather than
 * silently accepted or crashing during emission. Standard three-color
 * DFS cycle detection, run once across all functions.
 */
export function detectRecursion(functions: readonly IRFunction[]): void {
  const byName = new Map(functions.map(f => [f.qualifiedName, f] as const));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(functions.map(f => [f.qualifiedName, WHITE] as const));

  function calleesOf(fn: IRFunction): string[] {
    return fn.blocks.flatMap(b => b.instructions).filter((i): i is Extract<IRInstruction, { kind: "call" }> => i.kind === "call").map(i => i.callee);
  }

  function visit(name: string, path: string[]): void {
    color.set(name, GRAY);
    const fn = byName.get(name);
    if (fn) {
      for (const callee of calleesOf(fn)) {
        if (!byName.has(callee)) continue; // external call — not part of this module's recursion graph
        const calleeColor = color.get(callee);
        if (calleeColor === GRAY) {
          const cycle = [...path, name, callee].join(" -> ");
          throw new WasmUnsupportedError({
            code: WASM_CODES.UNSUPPORTED_CFG_SHAPE,
            functionName: name,
            message: `recursion detected (${cycle}) — direct and mutual recursion are explicitly out of scope for sub-phase 3.1A.3 (direct, non-recursive calls only); recursion support (and the stack-depth/growth questions it raises for WASM) is a later, separately-reviewed decision`,
          });
        }
        if (calleeColor === WHITE) {
          visit(callee, [...path, name]);
        }
      }
    }
    color.set(name, BLACK);
  }

  for (const fn of functions) {
    if (color.get(fn.qualifiedName) === WHITE) visit(fn.qualifiedName, []);
  }
}
