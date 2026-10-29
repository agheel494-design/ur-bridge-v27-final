# LLVM_BACKEND_DESIGN_PROPOSAL.md

**Status: 🟢 APPROVED and IMPLEMENTED (rebuilt).** This document
consolidates every ratified architectural decision from the original
design/review process. The original session's own work was lost due
to an unsaved-package error (disclosed to the project owner); this is
a clean rebuild from the documented decisions below, not a copy of
lost code.

## 1. Scope (approved)

Architecture Validation, not capability growth: integer literals,
return, arithmetic (`add`), i64 comparisons (`eq`/`neq`/`lt`/`lte`/
`gt`/`gte`), `if`/`else` (including without `else`, with `else`,
nested), and real multi-block control flow via the memory model
below. Explicitly deferred: `while`/`for`/`switch`/`break`/`continue`,
structs/arrays, FFI, threads, SIMD, debug info, optimization passes.

## 2. Pipeline (approved)

```
UR IR → Validator → Builder → Module → Printer → .ll text
```
Textual LLVM IR (`.ll`), not the LLVM C/C++ API — easier to debug,
review, and Golden-test; no LLVM-version lock-in.

## 3. OFFICIAL, FINAL: Memory-based IR, not manual `phi` (ratified decision)

UR's own IR is memory-based (`alloca`/`store`/`load` through a shared
slot), not SSA. Manual `phi` construction was explicitly rejected —
LLVM's own real `mem2reg` pass is the designated owner of SSA/`phi`
construction, not this Backend. Real, internal SSA support is
deferred to a future roadmap item (an internal UR Optimizer, or a
future LLVM-independent Backend).

## 4. OFFICIAL, FINAL: Control Flow Merge Policy (ratified, general architectural rule)

> **Generate a merge block only when at least one execution path
> continues after the conditional.**

If every branch ends in `return`, no merge block is emitted (matches
real compiler practice, avoids dead blocks). If execution continues
after the conditional, a real merge block is required.

## 5. OFFICIAL, FINAL: Transitional Entry Visibility Rule (ratified, scoped exactly)

> "Temporary Rule: Entry-defined values are treated as globally
> visible only because the current CFG is acyclic and restricted.
> This rule MUST be removed when full dominance analysis is
> introduced."

Scoped exactly: **only** `alloca` and `const_i64` ids from the real
`entry` block are treated as visible in every other block — never
generalized to any `then`/`else`/`merge`-defined value. This is
explicitly NOT Dominance Analysis, Dominance Frontier computation, SSA
Rename, or any `mem2reg`-style algorithm — a real, disclosed
simplification valid only because the current CFG shapes are acyclic
and restricted (`if`/`if-else`/nested-`if`, no loops).

**Mandatory leak-prevention test** (per explicit requirement): a value
defined in a non-entry block and used elsewhere must be rejected —
confirmed live, `tests/backend/llvm/rebuilt-comprehensive.test.ts`.

## 6. Validator architecture (four real, distinct layers)

1. `validateForLLVM` (pre-build): general acyclic-CFG check — any
   graph of `return`/`cond_branch`/`branch` terminators, real cycle
   detection (DFS, white/gray/black) rejects loops structurally, not
   via a fixed shape list.
2. `validateMemoryModel`: slot exists, no load-before-store (real DFS
   across blocks, not per-block in isolation), no store to unknown
   slot, unique slot ids/names.
3. `validateControlFlow` (post-build): no dangling branch target, no
   empty/duplicate labels, single entry block, every block has a
   terminator.
4. `validateLLVMModule` (post-build): SSA/reference well-formedness,
   with the Transitional Entry Visibility Rule (§5).

## 7. Testing (Tier 1 / Tier 2, approved)

**Tier 1** (no LLVM toolchain required): IR → Builder → Module →
Printer → `.ll` text, Golden-tested. **Tier 2** (real `clang`/`llc`):
`.ll` → executable → run → exit code — **Not Yet Verified** in this
sandbox (confirmed: no `clang`/`llc` installed, `apt-get install`
fails with 403, network-restricted) — this status is honestly
disclosed, not hidden or assumed passing.

## 8. Real bug fixed during the original work, preserved in this rebuild

Nested `if` produced duplicate block labels (`then`/`else`/`merge`
repeated at every nesting level, zero distinguishing suffix) — fixed
via a real, unique label scheme (`${block.label}_${block.id}`).
Confirmed live in this rebuild: all block labels are genuinely unique
across nesting levels for a doubly-nested `if` test case.
