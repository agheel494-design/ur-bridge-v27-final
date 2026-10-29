# ADR-1 — DECIDED: Tier 2 ABI Types Are FFI/ABI-Only, Not General UR Types

**Status: CLOSED. This decision is now the final reference — do not
reopen without a new ADR.**

## Question

Are `i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f32`/`f64` usable in
ordinary, non-FFI UR code (e.g. `function add(a: i32, b: i32): i32`),
or reserved exclusively for FFI/ABI declarations?

## Decision

**FFI/ABI-only.** `function add(a: i32, b: i32): i32` is **not** valid
general UR v1.0 code. These 10 names remain exactly where they already
are — `src/ffi/abi/types.ts`/`layout.ts` — and are **not** added to
the general type checker's canonical table.

## Reasoning

1. §6.2 itself names this tier "**ABI-precise types**" and defines
   every entry by its 1:1 ABI mapping, not by any general-purpose
   description — the section's own framing is FFI-first, not
   general-purpose-first.
2. §6.1 (Tier 1) already provides a complete, general-purpose type
   vocabulary (`int`, `float`, `bool`, `char`, `string`, `byte`,
   `null`) covering ordinary programming needs. Adding Tier 2
   everywhere would create redundant near-duplicates (`int` vs `i64`)
   with no expressive benefit for ordinary code, while already serving
   a real, distinct purpose for FFI precision.
3. Minimal-change principle: this decision requires **zero code
   change** — it ratifies the existing, already-shipped behavior as
   correct, rather than requiring new work to make Tier 2 "usable
   everywhere."

## Consequence for the Implementation Matrix

`SPEC_IMPLEMENTATION_MATRIX.md`'s Tier 2 row is reclassified from
**"Needs Spec Clarification"** to **"Document Limitation"** — no code
change; `UR_LANGUAGE_SPEC_1_0.md` §6.2 gets one clarifying sentence
stating the restriction explicitly, and `KNOWN_LIMITATIONS.md` gets a
matching entry, so this no longer looks like an oversight to a future
reader.

## What Remains Open

Nothing — this was the only item in this document's own ADR agenda.
All other `Implement`-classified findings in
`SPEC_IMPLEMENTATION_MATRIX.md` proceed to implementation now.
