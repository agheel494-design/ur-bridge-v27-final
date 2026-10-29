# BRANCH SPECIFICATION: develop-v28

**This is a branch SPECIFICATION, not a completed Git operation — no
`.git` repository exists in this environment. This document specifies
exactly what the `develop-v28` branch should contain and how work on
it should proceed, ready for whoever has real Git access to create it
(branched from `release/v1.0` at the `v1.0.0-rc1` tag).**

---

## Purpose

The exclusive home for all future development: every deferred v1.1
feature, and every new capability (AI, Networking, Robotics, Packages,
and anything else) not already shipped as of `v1.0.0-rc1`.

## Scope — What Belongs Here

1. **Everything in `UR_LANGUAGE_VERSION_MATRIX.md`'s own v1.1 column**:
   `for`/`in` loops, `if`-expression, named-type annotations,
   contextual/bidirectional type inference, enum declarations.
2. **Standard Library expansion**: `std.core` (println/panic/assert —
   blocked today on `panic` not being a callable builtin, per
   `docs/STDLIB_MATH.md`'s own documented reasoning), `std.string`,
   `std.array` (length/push/pop — blocked today on no dynamic arrays),
   `std.collections`, `std.time`, `std.random`.
3. **URPM** (package manager) — explicitly deferred until Standard
   Library interfaces stabilize, per this project's own established
   "don't build tooling on an unstable API" reasoning (see
   `UR_BRIDGE_V28_MASTER_ROADMAP.md`'s own Vision section).
4. **WASM Backend M1-M7** (per `UR_BRIDGE_V28_MASTER_ROADMAP.md`):
   Conditional Allocation, Runtime Integration (3.1C), `unop`,
   call-arguments support, and everything else already tracked there.
5. **Genuinely new categories** (AI, Networking, Robotics, Web) — none
   of which have ANY existing implementation as of `v1.0.0-rc1`
   (confirmed throughout `KNOWN_LIMITATIONS.md`'s own history) — these
   start from zero design work here, not a code change to something
   half-built.

## Process Requirements (unchanged from `release/v1.0` and v1.0's own
## history — this branch does not relax engineering discipline, only
## widens scope)

Every item in `CONTRIBUTING.md`'s own Mandatory Process Order still
applies: Implementation → Regression Tests → API Freeze Check (for any
Standard Library/URPM surface) → Documentation → CHANGELOG → Report.
Every RCA-requiring bug still needs one before a fix, matching the
`STAGE3_WASM_RCA_VALIDATION_FINAL.md` precedent. Every new feature
still needs an explicit version-scope decision recorded in
`UR_LANGUAGE_VERSION_MATRIX.md` before implementation begins — matching
the discipline that prevented `for`/`if`-expression from being rushed
into v1.0 under time pressure during the original Language Freeze
Week.

## What Does NOT Carry Over Automatically

`release/v1.0`'s own Maintenance-only restriction does not apply
here — this is explicitly where new syntax/semantics/types are
permitted. But the INDEPENDENT VALIDATION requirement (a different
party re-confirming results, not the same one who wrote the code)
still applies before anything on this branch is itself considered
verified — matching the two-party model `CONTRIBUTING.md` and
`RELEASE_PROCESS.md` already establish as standing project policy, not
something specific to the v1.0 cycle alone.

## First Recommended Item

Per this project's own recently-demonstrated pattern (the WASM SSA fix
cycle): pick ONE deferred item, run it through the full Evidence → RCA
(if applicable) → Design → Implementation → Linux Validation →
Independent Validation → Closure cycle, rather than starting many
items in parallel. `for`/`in` loops or `if`-expression are the most
natural first candidates — both already have their own CFG-design
prerequisite named explicitly in `UR_LANGUAGE_V1_0_FINAL_SPECIFICATION.md`'s
§11 ("draw the CFG, ratify an Invariant, hand-verify" — the same
discipline every prior control-flow feature in this project went
through).
