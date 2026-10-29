# UR-Bridge v28 — Master Roadmap

**Status: PLANNING DOCUMENT ONLY. No code written, no file inside the
RC2 scope touched, no test or Golden File modified. Grounded entirely
in this project's own documented history (`ROADMAP_LOCK.md`,
`WASM_BACKEND_SPEC.md`, `issues/*.md`, `DESIGN_3_1B_6.md`) — every
item below traces to a real, already-established fact, not a new
invention.**

---

## 1. Vision

v27 established a working, verified WASM Backend for a narrow but
real subset of UR: integer arithmetic, control flow, local variables,
function calls, and arrays with bounds-checked memory. v28's vision is
to close the most consequential gaps that stand between "a narrow
Backend" and "a Backend that can compile realistic UR programs" —
without repeating the mistake of scope-creeping past what can be
rigorously designed, implemented, and independently verified within
one release cycle. v28 explicitly does NOT aim to reach full language
parity in one release; it aims to ship the next coherent, load-bearing
slice.

## 2. Goals of v28

1. Close the one already-designed, already-scoped gap in the current
   array model: Conditional Allocation (3.1B.6).
2. Deliver Runtime Integration (3.1C): WASM imports, Builtins
   (`print`/`input`/`free`), Host Functions, Memory Interface — the
   next milestone this project's own `ROADMAP_LOCK.md` already names.
3. Close the two smallest, already-identified Feature Matrix gaps that
   don't require new design work: `unop` (`neg`/`not`) and function
   calls with arguments — both currently rejected with a precise,
   already-documented `WASM1001` message, both structurally close to
   already-shipped mechanisms.
4. Begin (not necessarily finish) the Backend Validation Suite (3.3):
   systematic C-Backend-vs-WASM-Backend differential testing, already
   named in `ROADMAP_LOCK.md` as "scheduled after 3.1A-C close."
5. Formally close the two remaining tracked issues that predate v28
   (`triple-evaluation...` is now FIXED as of RC2; the two still-OPEN
   issues — `level-2.8-single-element-array...` is now also FIXED —
   confirm no open issues remain blocking v28's own start; if any new
   issue surfaces during v28 work, handle it per this project's
   standing per-issue discipline, not silently).

## 3. Milestones

| # | Milestone | Depends On | Priority |
|---|---|---|---|
| M1 | 3.1B.6 — Conditional Allocation | RC2 formally Frozen | Critical |
| M2 | 3.1C — Runtime Integration (Imports, Builtins, Host Functions, Memory Interface) | M1 closed | Critical |
| M3 | `unop` (`neg`/`not`) support | None (independent of M1/M2) | High |
| M4 | Function calls with arguments | M3 (per the existing WASM1001 message's own noted conflation — see §9) | High |
| M5 | Float support (`const`/`binop`) | M2 (Builtins like `print` need float formatting to be useful) | Medium |
| M6 | 3.3 — Backend Validation Suite (begin) | M2 closed | Medium |
| M7 | IDE Tooling groundwork (LSP skeleton) | M2 closed | Low |

## 4. Feature List by Priority

### Critical
- **Conditional Allocation (M1)** — already has a design document
  (`DESIGN_3_1B_6.md`) and test plan (`TEST_PLAN_3_1B_6.md`) from prior
  planning work. Technical requirement: resolve the open design
  question already flagged (one-allocation-per-loop vs.
  fresh-per-iteration semantics) via CFG-drawing before any code.
- **Runtime Integration (M2)** — WASM imports for host functions,
  `print`/`input`/`free` Builtins (via the existing, frozen Builtins
  Registry IR shape — `ROADMAP_LOCK.md` confirms this shape is
  "unchanged"), and the Memory Interface needed for `print` to read
  string data out of WASM linear memory.

### High
- **`unop` (`neg`/`not`) (M3)** — technical requirement: two new WASM
  opcodes (`i64.sub` from a zero constant for `neg`, `i32.eqz`-style
  negation for `not` on `bool`), threaded through `encodeExpr()`'s
  existing `binop` dispatch pattern. Low design risk — no new CFG
  shape, no new Memory Model concern.
- **Function calls with arguments (M4)** — technical requirement:
  WASM's own `call` instruction already supports arguments natively:
  the gap is purely in this Backend's own `inst.args.length > 0` guard
  (`emit-wasm.ts`), plus threading argument-passing through the
  existing local-variable-parameter mechanism. The existing code
  comment (`emit-wasm.ts`, near the `call` handling) already flags
  that this diagnostic will need to be split into two once this lands
  (arguments-not-supported vs. Builtins-not-supported) — that split is
  part of this milestone's own scope.

### Medium
- **Float support (M5)** — technical requirement: WASM's parallel
  `f64.*` instruction set (already noted in `WASM_BACKEND_SPEC.md` as
  "trivial to add once integers are proven... mirroring i32/i64.*
  almost exactly"). Needs its own Memory Model note if floats are ever
  stored in arrays (out of scope for M5 itself — scalar floats only).
- **Backend Validation Suite, begin (M6)** — technical requirement:
  a differential test harness comparing C Backend and WASM Backend
  output (stdout, exit code, panic/bounds-check behavior) on the same
  UR programs. Should reuse the existing `assertBackendCorrectness`-
  style helper already used throughout `emit-wasm.test.ts`, generalized
  into its own dedicated suite.

### Low
- **IDE Tooling groundwork (M7)** — `ROADMAP_LOCK.md` already marks
  this "🔜 NEXT" after Runtime Integration, scoped to `src/lsp/` + a VS
  Code extension. v28 should only begin the skeleton, not a full LSP
  implementation.

## 5. Dependencies Between Milestones

```
RC2 Frozen
    │
    ▼
M1 (3.1B.6) ──────────► M2 (3.1C) ──────┬──► M6 (Validation Suite)
                                          │
M3 (unop) ──► M4 (call args)             └──► M7 (IDE groundwork)
    │
    └──────────────────► M5 (floats, needs M2 for print-formatting to matter)
```

M3/M4 have no dependency on M1/M2 and could, in principle, proceed in
parallel — but per this project's own "one item per batch" discipline
(`WASM_BACKEND_SPEC.md`'s own stated review process), they should still
be implemented and reviewed strictly one at a time, not concurrently,
even if planning treats them as parallel-eligible.

## 6. Exit Criteria (per milestone, matching this project's own established pattern)

Every milestone is considered complete only when ALL of the following
hold — the same bar every 3.1A/3.1B sub-phase was held to:

- CFG drawn and reviewed before any code (for milestones introducing a
  new shape or new Memory Model concern: M1, M2).
- An Invariant ratified and documented, or an explicit statement that
  none is needed (matching 3.1B.3/3.1B.5's own precedent).
- A named Contract with non-empty test coverage.
- Golden Test case(s) added, with regression-detection proven by
  deliberate corruption + revert (matching every prior batch).
- Full regression suite passes, 0 failures.
- Documentation (`WASM_BACKEND_SPEC.md` and/or
  `WASM_MEMORY_MODEL_SPEC.md`) updated to match the shipped behavior,
  not aspirational planning (per the correction already applied to
  the Feature Matrix during RC2's own final directive work).
- Independent review completed (internal, given this project's
  current single-reviewer constraint — matching the standard already
  applied throughout v27).

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| M1's open design question (loop-allocation semantics) is decided hastily, reintroducing a variant of RC2's own critical bug | Explicit requirement: M1's implementation must directly test the "read an early value after later writes" pattern that exposed the original bug, for every new shape M1 introduces — not just confirm observable output looks right (already stated in `DESIGN_3_1B_6.md` §4). |
| M2 (Runtime Integration) is the largest-scoped milestone in v28 and could balloon | Explicitly split M2 into its own sub-phases at design time (mirroring 3.1B's own 3.1B.1→3.1B.5 breakdown) — do not attempt WASM imports, Builtins, Host Functions, and the Memory Interface as one undifferentiated batch. |
| M4 (calls with arguments) touches the same `emit-wasm.ts` call-handling code that M3 (`unop`) also touches | Sequence M3 before M4 (already reflected in §5's dependency graph) to avoid two concurrent, overlapping changes to the same code region. |
| Float support (M5) motivates someone to also add float arrays, expanding Memory Model scope silently | Explicitly state in M5's own design doc (once written) that float arrays are OUT OF SCOPE for M5 — scalar floats only, matching this roadmap's own §4 note. |
| This environment's npm-registry limitation (documented throughout RC2's validation history) recurs for v28's own external verification | No mitigation available from this side — flag early in each milestone's own final report, exactly as RC2's reports already do, rather than rediscovering the same limitation each time. |

## 8. Out of Scope for v28

Explicitly deferred to v29 or later, matching gaps already named
throughout this project's own documentation, not newly invented:

- GC / `free` for arrays (arrays remain bump-allocated, never freed,
  matching the Memory Model's own already-ratified design).
- Dynamic array length / runtime resize.
- Nested arrays / arrays of arrays.
- Structs combined with arrays (structs already exist per
  `tests/codegen/golden/20-struct-construction-access` and
  `21-struct-copy-semantics` — their interaction with the WASM
  Backend's own array model is a new question, not addressed by v28).
- LLVM Backend (blocked on environment per
  `LLVM_ENVIRONMENT_REQUIREMENTS.md` — v28 does not attempt to work
  around this).
- Full LSP/IDE feature completeness (M7 is groundwork only).
- The two still-latent, low-priority items noted in
  `TECHNICAL_DEBT_OPCODE_DUPLICATION.md`'s own history and any future
  equivalent — v28 does not chase every minor cleanup opportunity
  unless it blocks a milestone's own exit criteria.

## 9. v29 Definition (to keep v28 from scope-creeping)

v29's own working name and scope, stated now specifically so v28 does
NOT quietly absorb it:

**v29 = GC/`free` for arrays, dynamic array length, nested
arrays/arrays-of-arrays, and struct-array interaction.** Any of these
four items appearing as a "small addition" during v28's own work
should be redirected to a v29 planning document, not implemented
inline — matching this project's own repeated historical pattern
(3.1B.4's own conditional-allocation surprise, deliberately rejected
and deferred rather than absorbed on the spot).

## 10. Time Estimates

Given this project's own historical pace (3.1B.1 through 3.1B.5 plus
the RC2 critical-fix cycle spanned roughly 5-6 independently-reviewed
batches), rough, non-committal estimates per milestone, each assuming
the same design-first, one-item-at-a-time discipline:

| Milestone | Estimate (in review cycles, not calendar time) |
|---|---|
| M1 (3.1B.6) | 2-3 cycles (design, implementation, independent review) |
| M2 (3.1C) | 5-8 cycles (largest scope; likely needs its own internal sub-phase breakdown) |
| M3 (unop) | 1-2 cycles |
| M4 (call args) | 2-3 cycles |
| M5 (floats) | 2-3 cycles |
| M6 (Validation Suite, begin) | 2-3 cycles to reach a usable first version |
| M7 (IDE groundwork) | 1-2 cycles for a skeleton only |

**These are cycle counts, not calendar estimates** — this project has
no established cycles-per-week rate to convert from, and this roadmap
does not invent one.

---

## Summary

v28's spine is M1 → M2, both already partially planned
(`DESIGN_3_1B_6.md` for M1; M2 already named in `ROADMAP_LOCK.md`).
M3-M7 fill out the release without expanding into v29's explicitly
out-of-scope territory. Next step, per explicit instruction: review
this roadmap, then proceed to 3.1C's own design document, fully
aligned with M2's scope as stated here.
