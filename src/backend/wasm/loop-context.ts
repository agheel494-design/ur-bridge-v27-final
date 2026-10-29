// ─────────────────────────────────────────────────────────────────────────────
// UR WASM Backend — Loop Context Model
// Design: docs/proposals/WASM_LOOPS_DESIGN_PROPOSAL.md
// ─────────────────────────────────────────────────────────────────────────────
//
// Phase 1 of WASM Loops implementation (per direct instruction: small
// staged steps, a real stop point after each). This file contains
// ONLY the real Loop Context Model infrastructure (the EmitContext
// stack and its own depth-computation algorithm) — it is NOT yet
// wired into any existing `while` encoder. That wiring, and any new
// capability (if-inside-while, while-inside-if), is explicitly
// deferred to later, separate phases, per the approved staged plan.
//
// Real invariants (per the approved Design Proposal's own §"Invariants"):
//   1. Every LoopContext has exactly one real loop label (one real
//      OPCODE_BLOCK+OPCODE_LOOP pair).
//   2. An IfContext never changes WHICH LoopContext break/continue
//      target — only adds +1 to the real computed depth.
//   3. The real number of open WASM structural wrappers is a WEIGHTED
//      sum (IfContext contributes 1 real wrapper; LoopContext
//      contributes 2 - block+loop) — not the raw stack length/index.
//   4. Real LIFO push/pop discipline: push immediately before
//      encoding a construct's own body; pop immediately after its
//      own closing OPCODE_END is emitted.

export type EmitContext =
  | { readonly kind: "loop" }
  | { readonly kind: "if" };

/**
 * Computes the real `br`/`br_if` depth a `break` targets: the OUTER
 * of the nearest enclosing LoopContext's own 2 real wrappers (the
 * block). Walks the stack from its own top (most deeply nested)
 * outward, accumulating +1 for each IfContext passed, per Invariant 2
 * above — an IfContext never changes WHICH loop is targeted, only
 * adds to the real depth needed to reach it.
 */
export function computeBreakDepth(stack: readonly EmitContext[]): number {
  let depth = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.kind === "if") {
      depth += 1;
      continue;
    }
    // stack[i].kind === "loop": break targets the OUTER of its 2
    // real wrappers (the block) - one more than continue needs.
    return depth + 1;
  }
  throw new Error("computeBreakDepth: no enclosing LoopContext found in the stack - real bug if reached, the emitter should never call this without a real enclosing loop (Layer 1/Validator must have already rejected any program where this could happen)");
}

/**
 * Computes the real `br`/`br_if` depth a `continue` targets: the
 * INNER of the nearest enclosing LoopContext's own 2 real wrappers
 * (the loop itself) - directly, one less than break's own target.
 */
export function computeContinueDepth(stack: readonly EmitContext[]): number {
  let depth = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.kind === "if") {
      depth += 1;
      continue;
    }
    // stack[i].kind === "loop": continue targets the INNER of its 2
    // real wrappers (the loop) directly.
    return depth;
  }
  throw new Error("computeContinueDepth: no enclosing LoopContext found in the stack - same real-bug note as computeBreakDepth's own.");
}

/**
 * Real, minimal stack manager - push/pop with genuine LIFO discipline
 * (Invariant 4). A thin wrapper over a real array, kept as its own
 * real class so future callers cannot accidentally mutate the stack
 * out of LIFO order (no public method exists to do so).
 */
export class EmitContextStack {
  private readonly stack: EmitContext[] = [];

  push(context: EmitContext): void {
    this.stack.push(context);
  }

  pop(): void {
    if (this.stack.length === 0) {
      throw new Error("EmitContextStack.pop(): stack is already empty - real bug if reached, every push must have a matching pop.");
    }
    this.stack.pop();
  }

  breakDepth(): number {
    return computeBreakDepth(this.stack);
  }

  continueDepth(): number {
    return computeContinueDepth(this.stack);
  }

  /** Real, read-only snapshot for tests - never used to mutate the stack directly. */
  snapshot(): readonly EmitContext[] {
    return [...this.stack];
  }
}
