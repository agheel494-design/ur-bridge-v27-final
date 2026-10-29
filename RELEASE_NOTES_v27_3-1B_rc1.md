# UR-Bridge v27 — WASM Backend 3.1B RC1 — Release Notes

**⚠️ SUPERSEDED by RC2 (`RELEASE_NOTES_v27_3-1B_rc2.md`). RC1's code
state contained a critical, since-fixed memory-corruption bug — see
`issues/CRITICAL-array-reallocated-every-loop-iteration.md`. Do not
build on RC1. Preserved for the historical record only.**

**Release date:** 2026-07-10
**Tests:** 2327/2327 passing
**TypeScript errors:** 0
**Gate Review:** `GATE_REVIEW_3_1B.md` — **APPROVED**

---

## Status

**Level 3.1B (through 3.1B.5) is FROZEN as of this Release Candidate.**
No new features, no refactoring, no performance optimizations against
any file in this baseline until a future gate review explicitly lifts
the freeze — matching the identical standing discipline already
applied to Level 3.1A, the IR, the Runtime ABI, and Level 2.9's
Optimizer.

## What This Baseline Contains

**Level 3.1A** (previously frozen, see `LEVEL_3_1A_CLOSURE_REVIEW.md`):
constants, arithmetic, direct zero-argument function calls, `if`/`else`
(return-only and Merge), Local Variables, `while`, `break`, `continue`.

**Level 3.1B** (newly frozen by this Release Candidate):
- **3.1B.1 — Linear Memory Foundation**: `memory` section, a simple
  bump allocator via one WASM Global, the Array Header layout
  (`length` + elements, 8-byte fields throughout), `array_load`/
  `array_store` lowering.
- **3.1B.2 — Bounds Checking**: mandatory `if (out of bounds)
  unreachable` on every array access, using the compile-time-known
  array length.
- **3.1B.3 — Dynamic Index**: confirmed the same address formula and
  encoding path handle any expression as an index (`const`, `binop`,
  `call`, and combinations), not just literals.
- **3.1B.4 — Arrays Inside Control Flow (constant index)**: array
  access inside `if`/`else` (the Merge shape) and `while` (the plain
  loop shape), with the array allocated once in `entry`.
- **3.1B.5 — Dynamic Index Inside a Loop**: the loop's own mutated
  variable (or any expression) may now be used as an array index
  inside a `while` loop body, with bounds checking correctly
  re-evaluating on every iteration.

## Explicitly Out of Scope for This Baseline (deferred, not silently missing)

- Conditional/repeated array allocation (3.1B.6, not yet started).
- Array access inside the return-only Diamond shape, `while`+`break`,
  or `while`+`continue`.
- Nested control flow (`if` inside `while`, etc.) combined with arrays.
- Garbage collection, `free`, runtime memory growth, dynamic array
  length, nested arrays/arrays-of-arrays.
- Function parameters/arguments (predates all of 3.1A/3.1B).

## Known, Tracked, Deliberately Unresolved Issues

None of the following block this freeze — each is independently
tracked in `issues/` and explicitly out of scope for every batch that
discovered it:

1. **Single-element array produces invalid C** (Level 2.8, C Backend)
   — `issues/level-2.8-single-element-array-c-backend-bug.md`.
2. **Cross-block reference to a never-reassigned variable crashes the
   encoder** (general, predates 3.1B, affects scalars too) —
   `issues/cross-block-reference-never-reassigned-variable-bug.md`.
3. **Large array + `while` loop combination fails past a specific size
   threshold** (confirmed unrelated to dynamic index; root cause not
   yet identified) — same file as #2.

## Test Coverage Summary

- **2327/2327** tests passing, 0 TypeScript errors (confirmed fresh
  during the Gate Review, not carried over from a prior claim).
- **24 Golden Test cases**, all passing, with regression-detection
  proven by direct deliberate corruption + revert for every batch
  from 3.1A.4 onward (except 3.1A.2's two cases, an honestly-flagged
  historical gap).
- **16 named, permanent Contracts**, every one with real, non-empty
  test coverage (verified directly during the Gate Review).

## Freeze Policy

Per `GATE_REVIEW_3_1B.md`'s explicit recommendation: this baseline is
now a stable reference point. Any change to a file within 3.1B.1
through 3.1B.5's scope requires either (a) a confirmed, documented bug
fix, following this project's standing minimal-change discipline, or
(b) a new gate review explicitly lifting the freeze for a specific,
justified reason. Development of 3.1B.6 and beyond proceeds as a
clean next phase, never as an amendment to this frozen baseline.
