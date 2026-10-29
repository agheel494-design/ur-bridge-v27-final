# PATCH_DESIGN_WASM_SSA.md

**Status: design document only, per explicit Stage 3.5 instruction.
No code included or implemented. Every claim below is grounded in
direct evidence already gathered in `STAGE3_WASM_RCA_VALIDATION_FINAL.md`
and the live execution trace preceding it — nothing new is asserted
without a traceable basis.**

---

## Scope

**File**: `src/backend/wasm/emit-wasm.ts`

**Functions affected**:
- `encodeStatements()` (current lines 1416-1456) — the loop that
  processes `block.instructions`.
- `encodeExpr()` (current lines 1336-1413) — specifically its `load`
  case (lines 1381-1388) and its recursive handling inside `binop`
  (lines 1362-1372).

**Exact lines requiring change** (identified, not yet modified):
- `encodeStatements()`'s main loop (line 1418: `for (const inst of
  block.instructions)`) currently branches only on `inst.kind ===
  "store"` (line 1419) or `inst.kind === "array_store"` (line 1428).
  Every OTHER instruction kind that appears as a top-level entry in
  `block.instructions` — confirmed directly from the IR dump in this
  investigation: `const`, `load`, `binop` all appear as top-level
  entries, not only as nested references — is silently skipped by
  this loop. This is the precise location the fix must extend.
- `encodeExpr()`'s existing scratch-local materialization pattern for
  array indices (lines 1399-1409, and the identical pattern in
  `encodeStatements()`'s `array_store` branch, lines 1445-1452) is the
  established precedent this patch generalizes — not a new mechanism
  invented for this fix.

**Explicitly out of scope for this patch**:
- Any change to Lowering (`src/compiler/codegen/lower-to-ir.ts`) —
  confirmed correct in Stage 3, not touched.
- Any change to the C Backend — unaffected, not touched.
- Any change to array-specific encoding — the existing array-index
  fix is a separate, already-shipped mechanism; this patch generalizes
  the same PRINCIPLE to scalar `store` values, not the array code
  itself.

## Root Cause (per `STAGE3_WASM_RCA_VALIDATION_FINAL.md`'s Confirmed verdict)

`encodeExpr()` treats every SSA value reference as "recompute this
formula from scratch, from its operands, at the current bytecode
position" rather than "the value this id had when it was originally
computed." Combined with `encodeStatements()`'s loop only processing
`store`/`array_store` instructions (silently skipping `const`/`load`/
`binop`/`call`/`array_load` at their own top-level position in
`block.instructions`), an SSA value defined BEFORE an intervening
`store` to one of its dependencies, but referenced AFTER that store
(in a later `store`'s own value expression), gets its formula
re-emitted at the LATER position — reading the ALREADY-MUTATED WASM
local instead of the value that existed at its true definition point.

## Current Behavior (described, not modified)

For the minimal reproducer's `loop_body` block:
```
id6 = load slot0        (top-level instruction — currently SKIPPED by encodeStatements' loop)
id7 = load slot1        (top-level instruction — currently SKIPPED)
id8 = add(id6, id7)     (top-level instruction — currently SKIPPED)
id9 = load slot1        (top-level instruction — currently SKIPPED)
store slot0, id9         → encodeExpr(id9) called HERE, lazily
store slot1, id8         → encodeExpr(id8) called HERE, lazily, AFTER slot0 was already mutated
```
Result: `2` (incorrect; should be `1`).

## Desired Behavior (described, not implemented)

Every top-level instruction in `block.instructions` that PRODUCES a
value referenced by a LATER instruction (`const`, `load`, `binop`,
`call`, `array_load`) should be materialized — computed exactly once,
at its OWN position in the instruction stream, into a dedicated
scratch WASM local — before any subsequent instruction (including an
intervening `store`) is encoded. Any LATER reference to that same id
(via `encodeExpr`) should read the materialized scratch local (a
cheap `local.get`) instead of recursively recomputing the formula.

This exactly generalizes the array-index precedent (materialize once,
reuse via `local.get`) from array-index expressions specifically to
every value-producing SSA instruction in a block.

Result after fix (expected, not yet verified since no code exists
yet): `1`, matching the C Backend.

## Patch Strategy — One Candidate Implementation Strategy (not a decided fact)

**Per explicit review**: the strategy below is ONE candidate
implementation, not "the" implementation. It follows directly from
the confirmed root cause, but implementation may reveal a cleaner
alternative (e.g., reordering generation instead of adding scratch
locals, or a different SSA-value-preservation mechanism). This
document does not bind the implementer to this exact approach if a
better one emerges during Stage 4.

1. Extend `encodeStatements()`'s loop to handle `const`/`load`/
   `binop`/`call`/`array_load` as top-level instructions, not only
   `store`/`array_store`.
2. For each such instruction, when encountered in iteration order:
   compute its bytecode (reusing `encodeExpr()`'s own existing
   per-kind logic) and immediately emit a `local.set` into a NEW
   scratch local dedicated to that instruction's own id (one scratch
   local per materialized id, or a reusable pool — an implementation
   decision for Stage 4, not decided here).
3. Modify `encodeExpr()` so that when it is asked to encode an id that
   has ALREADY been materialized this way (per step 2), it emits a
   `local.get` to that id's scratch local instead of recursively
   re-deriving the formula from `instructionsById`.
4. `store`/`array_store`'s own existing handling (lines 1419-1427,
   1428-1453) is otherwise unchanged — they already correctly call
   `encodeExpr(inst.value.id, ...)`; after this patch, that call
   would resolve to a cheap `local.get` (per step 3) rather than a
   full recursive re-derivation, for any id already materialized.

**Note on scope of change**: this is a larger structural change than
the prior array-index fix (which only touched 2 specific call sites).
This patch touches the GENERAL instruction-processing loop in
`encodeStatements()` and the GENERAL resolution logic in
`encodeExpr()` — affecting every function this Backend compiles, not
only ones matching the bug's own specific trigger pattern. This is
intentional (a narrower, pattern-matching-only fix would risk missing
other input shapes with the same root cause not yet discovered) but
must be flagged as a wider-blast-radius change than the array-index
precedent.

## Risks (Regression Risk Assessment)

1. **Correctness risk if scratch-local allocation collides across
   nested/looping blocks** — the array-index fix's own scratch local
   is a single, function-wide slot (`getIndexScratchLocalIndex`);
   extending this pattern to EVERY value-producing instruction likely
   needs either many scratch locals (one per live id) or a more
   careful liveness-based reuse scheme. An under-provisioned scheme
   could reintroduce a DIFFERENT instance of the same class of bug
   (two DIFFERENT ids sharing one scratch local across an interfering
   region).
2. **Performance/binary-size risk** — materializing every intermediate
   value into its own local, rather than inlining pure expressions
   lazily, increases the number of WASM locals and `local.set`/
   `local.get` pairs emitted. The existing performance baselines
   (`COMPILER_STABILIZATION_SPRINT_REPORT.md`'s own recorded figures —
   avg IR instructions, avg C/WASM output size) should be re-measured
   after this fix to confirm no unacceptable regression.
3. **Behavior-change risk for currently-passing WASM Golden Tests** —
   since this patch changes the GENERAL instruction-processing loop,
   every existing WASM Golden Test's own expected byte sequences are
   likely to change (more locals, different opcode sequences), even
   for programs that were already correct. This is an EXPECTED,
   not-a-regression change (matching this project's own precedent when
   the triple-evaluation fix similarly changed byte output for
   previously-correct programs) — but every Golden Test must be
   re-verified for RESULT correctness before its recorded bytes are
   regenerated, not just regenerated blindly.
4. **Risk of incomplete coverage** — this patch is designed against
   the ONE confirmed trigger pattern (two outer variables updated via
   a shared loop-local value). Other, not-yet-discovered input shapes
   with the same root cause (lazy re-evaluation across an intervening
   mutation) may exist and would need their own minimal reproducers
   added to the regression suite once found — Stage 4's own testing
   should not assume this one pattern is exhaustive.

## Regression Tests Required (per explicit Stage 3.5 requirement)

1. **The exact minimal reproducer** used throughout this investigation
   (2-iteration `a`/`b`/`temp` swap) — must return `1` on WASM after
   the fix, matching C.
2. **The full `examples/fibonacci.ur`** (10 iterations) — must return
   `55` on WASM after the fix, matching C. `docs/EXAMPLES.md` should
   then be updated to remove the "C-Backend-only" restriction for this
   example.
3. **Every one of the 4 narrowing-table cases** from
   `issues/wasm-loop-local-let-affecting-outer-state.md` — re-verify
   all 4 still produce correct, C-matching results after the fix (the
   3 that already passed must continue to pass; the 1 that failed
   must now pass).
4. **Full WASM Golden Test suite** (`tests/backend/wasm/golden/`, 25
   cases) — every case's RESULT must remain correct; recorded bytes
   are expected to change (per Risk 3 above) and must be regenerated
   only after confirming results, matching this project's own
   established Golden Test update discipline.
5. **Full Conformance Suite** (`conformance/`, 11 cases) — all must
   continue passing; `010_for_deferred_to_1_1` and
   `011_enum_diagnostic` are unrelated to this fix and serve as a
   sanity check that the patch didn't have unintended side effects
   elsewhere.
6. **A NEW, permanent regression test** specifically encoding the
   minimal reproducer's exact pattern, added to
   `tests/backend/wasm/emit-wasm.test.ts` (matching this project's own
   standing practice of a dedicated test per fixed defect) — asserting
   the CORRECT result (`1`), replacing the current absence of any test
   for this pattern (confirmed in `issues/wasm-loop-local-let-affecting-outer-state.md`:
   "neither the 25 existing WASM Golden Tests nor the 11 Conformance
   Suite cases happen to exercise this exact pattern").
7. **Full existing regression suite** (2382 tests as of this
   document) — must remain at 100% pass; any newly-failing test
   indicates this patch's own blast radius (per Risk 3) introduced an
   unintended behavior change requiring its own investigation before
   the patch can be considered complete.
8. **NEW, per explicit review request — nested loop + temporary SSA
   values**: a case with a `while` loop nested inside another `while`
   loop, where the inner loop's own loop-local `let` value is used to
   update two variables from an OUTER scope (matching the confirmed
   bug's own trigger shape, but nested one level deeper). This
   specific case has NOT been constructed or tested yet — its purpose
   is to catch a regression in the more GENERAL mechanism this patch
   introduces (since the fix touches the general instruction-
   processing loop, not just the one confirmed flat-loop pattern),
   reducing the risk of an undiscovered issue surfacing later in
   nested-scope code.

## Explicit Statement of Confidence

This design is grounded directly in the Stage 3 Confirmed verdict and
the live execution trace evidence — not a new hypothesis. However, per
Risk 4 above, this design does not claim to be the ONLY possible fix,
nor does it claim the one confirmed trigger pattern is the only
manifestation of this root cause. Stage 4's own implementation should
treat this document as a starting design, subject to revision if
implementation reveals a detail not anticipated here (e.g., a
liveness-analysis complexity not yet visible without writing the
actual code).
