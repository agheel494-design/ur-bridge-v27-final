# CONTROL_FLOW_MERGE_POLICY.md

**Status: Official, final architectural rule** — binding for the LLVM
Backend and any future backend that lowers branching control flow.

## The rule

> **Generate a merge block only when at least one execution path
> continues after the conditional.**

## Why

Matches real compiler practice, avoids emitting a genuinely
unreachable block, and makes future `phi`-node support architecturally
natural: `if` (real branching need) → `merge` (only when actually
needed) → `phi` (only ever attached to a real merge block).

## Confirmed real precedent (LLVM Backend, rebuilt)

Confirmed live in this rebuild: `if`/`else` where both branches
`return` directly produces zero merge block; `if`/`else` where
execution continues (a shared variable read after) produces a real
`merge` block with a real `load`.
