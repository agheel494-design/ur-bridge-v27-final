# WASM_LAYER1_SCOPE.md

**What Layer 1 (`classifyTopLevelShape`, `wasm-cfg-validation.ts`)
recognizes — explicit, exhaustive list. Per direct review request,
this document exists so "Layer 1 is general" is never assumed beyond
what is actually true.**

## Recognized (accepted, dispatched to real Layer 2 validation)

1. **straight-line**: exactly one block, `return` terminator.
2. **if-else-return**: entry ends in `cond_branch`; both targets are
   distinct real blocks; both terminate directly via `return`.
3. **if-else-merge**: entry ends in `cond_branch`; both targets
   terminate via `branch` to the SAME third block; that block
   terminates via `return`.
4. **while-basic**: entry ends in plain `branch` to a real loop header
   that itself ends in `cond_branch`; 4 blocks total.
5. **while (break/continue)**: the existing 7-block loop pattern,
   distinguished from case 4 by having break/continue exit paths;
   recognized by the existing `classifySevenBlockShape` sub-classifier.

## Explicitly NOT recognized (rejected as "unrecognized", regardless of block count)

- **Nested control flow at ANY level**: an `if` inside a `while`, a
  `while` inside an `if`, an `if` inside an `if`, a `while` inside a
  `while` — Layer 1 does NOT recurse into a branch's own body. This
  is the real, deliberate scope boundary for this Milestone — Nested
  Control Flow is the next, separate Milestone.
- **`switch`/`match`, `try`/`catch`, `break`/`continue` outside a real
  `while` body** — no such IR shape is produced by the current
  compiler, so these are moot today, but would also not be recognized
  if they existed.
- **Any CFG shape with more than 2 real branches from a single
  decision point** (e.g. a 3-way branch) — not expressible in the
  current IR, moot today.

## Confirmed, direct evidence (not assumed)

`tests/backend/wasm/layer1-structural-proof.test.ts` directly asserts
`classifyTopLevelShape`'s own return value for 4 real cases,
proving classification is structural (not block-count alone):
- A 3-block shape with the right count but wrong structure (entry
  doesn't end in `cond_branch`) → `unrecognized`, not accepted merely
  for having "3 blocks".
- A 4-block shape with the right count but wrong structure (then/else
  don't converge on the same target) → `unrecognized`.
- A genuine 7-block nested-if (same count as while-break/continue) →
  `unrecognized`, confirmed to NEVER reach the while-specific
  sub-classifier at all.
- A genuine 7-block while-break → `while`, confirming Layer 1 does
  not simply reject every 7-block function.
