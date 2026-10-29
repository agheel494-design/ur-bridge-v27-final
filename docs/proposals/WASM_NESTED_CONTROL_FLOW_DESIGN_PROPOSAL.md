# WASM_NESTED_CONTROL_FLOW_DESIGN_PROPOSAL.md

**Status: DESIGN PROPOSAL — NOT APPROVED, NOT IMPLEMENTED.** Written
after real analysis revealed this is a larger task than initially
scoped — disclosed here before any rushed implementation, per this
project's own established discipline.

## 0. Real finding that changes this task's own scope

Analysis of `validateMergeShape`/`validateDiamondShape`
(`wasm-cfg-validation.ts`) confirms they assume an **exact, fixed
block structure** — `validateMergeShape` checks `fn.blocks.length !==
4` and indexes blocks directly by their known role (entry/then/else/
merge). **This means real Nested Control Flow support requires
changes in TWO places, not one**:

1. **Layer 1** (the classifier) — needs to recognize nested shapes
   structurally. This part alone is real, scoped, and I have a
   working, tested design for it (§1 below).
2. **Layer 2 / the actual WASM emitter** (`emit-wasm.ts`, the real
   instruction-encoding logic, not just validation) — currently
   assumes the same fixed shapes when generating real WASM bytecode
   (block/loop/br_if encoding). **This has NOT been analyzed or
   designed yet** — extending it to emit correct WASM bytecode for
   arbitrarily-nested control flow is real, substantial work
   (WASM's own structured control flow — nested `block`/`loop`/`br`/
   `br_if` — must be generated correctly for each nesting
   combination), not yet scoped in this document.

**This document proposes Layer 1 only, as a first, real, testable
step — matching this project's own "one construct at a time" pattern.
Layer 2 (real code generation for nested shapes) is explicitly a
separate, later Design Proposal, not attempted here.**

## 1. Layer 1 design (real, scoped, ready)

A recursive region classifier, using only Reachability/CFG Traversal
(no Dominance Analysis):

```typescript
type RegionExit = { kind: "return" } | { kind: "continue"; target: number };
type RegionResult = { ok: true; exit: RegionExit } | { ok: false };

function classifyStructuredRegion(blockId, blockById): RegionResult {
  block = blockById.get(blockId);
  if (!block) return { ok: false };
  if (block.terminator.kind === "return") return { ok: true, exit: { kind: "return" } };
  if (block.terminator.kind === "branch") return { ok: true, exit: { kind: "continue", target: block.terminator.target } };
  if (block.terminator.kind === "cond_branch") {
    thenResult = classifyStructuredRegion(thenTarget, blockById);
    elseResult = classifyStructuredRegion(elseTarget, blockById);
    if (!thenResult.ok || !elseResult.ok) return { ok: false };
    // unify: both return -> return; both continue to same target -> that continue;
    // one return + one continue -> the continue (the returning path never reaches it);
    // continue to DIFFERENT targets -> ok:false (ambiguous merge, not supported)
    ...
  }
  return { ok: false }; // other terminator kinds (while-related) not handled by this region classifier
}
```

**What this recognizes** (real, tested against the specific case that
motivated this Milestone): nested `if`/`if-else` at any depth, where
every path either returns directly or converges on a single, shared
continuation block. Confirmed live (isolated classifier test, not
yet wired to the Builder): the exact triply-nested-if-with-merge case
from `layer1-structural-proof.test.ts` classifies correctly as a
valid nested structure with a real continuation target.

**What this does NOT recognize** (explicit, disclosed limits for this
proposal): `if` nested inside a `while` body, `while` nested inside an
`if` branch, sequential (non-nested) `if` statements in a row, a merge
target that is itself not a direct `return` (i.e., more structured
code after the merge). These are real, separate extensions, not
covered here.

## 2. Explicit ask

This document requests approval for **Layer 1 only**: land the
recursive region classifier as a real, tested addition (proving
nested `if`/`if-else` detection works), while `emit-wasm.ts`'s own
real bytecode generation for these cases remains explicitly
unsupported (Layer 1 accepting a shape it cannot yet build would be a
worse outcome than rejecting it — so Layer 1's own acceptance must be
gated on Layer 2 actually being ready, OR Layer 1 stays informational/
tested-only until Layer 2 exists).

**Recommended, safer sequencing**: implement and merge Layer 1's
classifier as a real, tested unit (proving the detection logic is
correct) WITHOUT yet wiring it into `validateScope`'s own real
accept/reject decision — so no function that previously failed
correctly now silently reaches an emitter that cannot handle it. Wire
Layer 1 into the real accept path only once Layer 2's own real
bytecode generation for nested shapes is designed and implemented, in
a separate, later commit.

**No implementation of Layer 2 (emit-wasm.ts changes) is proposed in
this document.** Awaiting explicit direction on whether to proceed
with Layer 1 alone (classifier-only, not yet wired to accept nested
programs) as this Milestone's own real, safe scope.
