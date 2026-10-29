# Issue Classification Report

**Every issue below was freshly re-reproduced (or re-confirmed fixed)
during this exact review, not assumed from prior documentation.**

---

## 1. `CRITICAL-array-reallocated-every-loop-iteration.md`

**Classification: FIXED**

**Fresh re-verification**: the exact reproduction (`arr[i] = i + 100`
across 3 loop iterations, reading `arr[0]` afterward) returns `100`
(correct), confirmed by direct re-execution during this review — not
reproducible.

**Engineering reason**: `allocatedArraySlots` changed from a per-CFG-
block-fresh `Set` to a single `Set` shared across all blocks in the
same function-level encoder. Verified by direct code inspection
(exactly one declaration per multi-block encoder function) and by
deliberate re-introduction of the bug (confirmed 3 Golden Tests + 4
behavioral tests fail when reverted).

## 2. `level-2.8-single-element-array-c-backend-bug.md`

**Classification: OPEN (deferred — out of scope for the WASM Backend)**

**Fresh re-verification**: `let arr = [99]; return arr[0]` still fails
to compile via the C Backend, confirmed by direct re-execution during
this review.

**Engineering reason**: root cause is `IRLocalSlot.length`'s inherent
ambiguity between "ordinary scalar" and "genuine one-element array" —
a Level 2.8 (Lowering/C Backend) concern, not a WASM Backend defect.
Fixing it requires changing frozen Level 2.8 code, which is explicitly
out of scope for any 3.1B batch per this project's standing freeze
discipline for already-closed levels.

**Impact on this release**: none — no 3.1B test constructs a
single-element array (all use 2+ elements specifically to avoid this
known, unrelated trigger).

## 3. `cross-block-reference-never-reassigned-variable-bug.md`

**Classification: OPEN (deferred — general, cross-cutting, needs its
own dedicated review)**

**Fresh re-verification**: a purely scalar reproduction (`let k = 5`,
never reassigned, referenced inside a `while` loop body) still throws
`"no definition found for id %0"`, confirmed by direct re-execution
during this review.

**Engineering reason**: `encodeStatements()`/`encodeExpr()` build their
`instructionsById` map from only the current CFG block's own
instructions — a reference to an id defined in a different block
(arising when Lowering's environment-rebinding resolves a
never-reassigned variable to a `const` defined elsewhere) fails to
resolve. This predates 3.1B entirely (exists since 3.1A.6's `while`
support) and affects every multi-block shape (Merge, While, Diamond),
not a single sub-phase — a fix has a large enough blast radius to
deserve its own dedicated, independently-reviewed batch, not a patch
bundled into freeze-preparation work.

**Impact on this release**: none confirmed — every realistic "dynamic
index inside a loop" scenario (3.1B.5's own actual deliverable)
necessarily reassigns its index variable (e.g. `i = i + 1`), which
produces a local `load`, never triggering this cross-block reference
pattern. No shipped 3.1B test hits this trigger.

## 4. `triple-evaluation-of-array-index-expression.md`

**Classification: OPEN (deferred — latent, not currently active)**

**Fresh re-verification**: `arr[f()]`'s compiled bytecode still calls
`f()` exactly 3 times (confirmed by direct byte-level count during
this review, not estimated).

**Engineering reason**: `encodeBoundsCheck()` inserts the index
expression's bytecode twice (once per comparison), and callers
separately insert the same bytecode a third time for the address
computation. This is invisible today only because every callable
function has a pure, deterministic `return <const>` body (3.1A.3's own
scope) — no side-effecting operation exists yet to make repeated
evaluation observable.

**Impact on this release**: none currently — becomes a real concern
only once 3.1C introduces any side-effecting builtin. Recorded now so
it is not forgotten before that point.

---

## Summary Table

| Issue | Classification | Blocks Current Release? |
|---|---|---|
| CRITICAL array-reallocated | **FIXED** | N/A (resolved) |
| Level 2.8 single-element array | **OPEN** (Level 2.8 scope) | No |
| Cross-block reference | **OPEN** (general, cross-cutting) | No |
| Triple evaluation | **OPEN** (latent, 3.1C-relevant) | No |

**No issue is classified `Deferred` or `Won't Fix`** — all three
remaining OPEN issues are genuinely intended to be fixed eventually,
just outside this release's own scope; none has been deliberately
declined.
