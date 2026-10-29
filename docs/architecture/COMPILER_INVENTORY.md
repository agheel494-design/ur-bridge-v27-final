# COMPILER_INVENTORY.md — Step 1 of the Compiler Audit

**Audit Scope Declaration (per AUDIT_METHODOLOGY.md): usage searches
in this document cover `src/`, `tools/`, `scripts/`, and `tests/` -
the C Backend section's own earlier `src/`-only search was the exact
error that led to adopting this rule; it has since been corrected in
that section directly.**

**Status: inventory only, per the same methodology proven for
Semantic/Type audits (inventory -> behavior tests -> gaps -> minimal
fixes -> re-verify -> cautious documentation). This step is the
inventory; behavior testing comes next. Self-reported within this
session, not independently verified.**

---

## Pipeline Stages Covered

```
AST (post Semantic + Type, already audited)
      |
      v
IR Lowering (src/compiler/codegen/lower-to-ir.ts) - CODEGEN_CODES (3 codes)
      |
      v
   +--+--+
   |     |
 WASM    C
Backend  Backend
```

## IR Lowering — Already Partially Audited

CODEGEN_CODES (CG1001, CG1002, CG9001) were already examined during
BUG-SA-002's own investigation. CG1001 (missing return) is now
correctly caught earlier at type-checking instead (BUG-SA-002 fix).
CG1002 and CG9001 not yet behaviorally tested in this pass.

## WASM Backend

**Status, split explicitly per Evidence Precedence (not a single
"completed" label for the whole backend):**

- **Happy Path**: Verified, within the scenarios tested (2 real UR
  programs: constant return, real while loop).
- **Invariant Failure Paths, general**: still largely **Not verified**
  — only one specific violation path has been tested (see below);
  other `UNSUPPORTED_CFG_SHAPE` throw sites (wrong block count,
  non-`cond_branch` entry, mismatched merge targets, etc.) remain
  untested.
- **`UNSUPPORTED_CFG_SHAPE`/WASM1002 specifically**: **Reported
  verified within this session (pending independent verification)**
  — the Prerequisite Investigation (`COMPILER_BACKLOG.md`,
  `PREREQUISITE_INVESTIGATION.md`) successfully constructed a valid
  IR fixture passing all WASM1001 checks, and a second fixture
  triggering WASM1002 exclusively (no other diagnostic code present
  in the error), re-confirmed in a separate finalization pass with
  4/4 WASM tests passing and zero production files touched.

```
Audit Scope
------------
Directories searched:
- src/cli/
- tools/

Excluded:
- docs/, examples/, archived/

Search method:
- Symbol references (grep for "wasm")
- Runtime verification (2 real UR programs through the actual pipeline)

Confidence:
- High (for the entry-points finding and the 2 exercised scenarios)
- Not applicable (invariant-violation paths — not tested)
```

## Current Entry Points (an architectural fact, not just an observation)

```
Current entry points

User-facing:
- CLI -> no WASM path (confirmed: src/cli/index.ts has zero
  references to "wasm")

Developer-facing:
- tools/generate-wasm-golden.ts
- tools/run-conformance.ts
```

Unlike the C backend (reachable via the FFI feature from real user
programs), WASM is not currently exposed to end users at all — only
to internal developer tooling.

## Happy Path — Observed, Not Claimed as Universal

**Real test performed**: two real UR programs (a simple constant
return, and a genuine `while` loop) run through the actual
`lex() -> parse() -> lowerToIR() -> emitWasmModule()` pipeline. Both
succeeded, producing valid WASM bytes.

**Corrected wording, per direct feedback**: no invariant violations
were observed from the ordinary UR programs exercised in this audit.
Triggering those checks appears to require deliberately constructed
IR fixtures — this describes what the test showed, not a guarantee
about every possible UR program or a claim that `lowerToIR()`'s own
lowering algorithm is correct by construction (that would require an
actual proof or exhaustive review of the algorithm itself, not two
test runs).

**Explicit scope boundary**: testing the invariant-violation paths
themselves (the 60+ `UNSUPPORTED_CFG_SHAPE` sites) requires
constructing malformed IR fixtures directly, not ordinary UR source
programs — this was NOT attempted in this pass, and is explicitly
out of scope for the UR-program-based testing method that worked for
Semantic/Type/C-backend. No code here is classified as dormant or
dead — the invariant-check sites are confirmed to exist, but their
own real-world triggerability was not tested.

Permanent test added: `tests/backend/wasm/wasm-happy-path-audit.test.ts`
(2/2 passing).

## C Backend Runtime Audit — Completed, Correcting a Real Methodology Error

**Critical self-correction**: the previous claim that BACKEND_CODES
was unused was based on a search that only covered `src/` — it
missed `tools/backend/c-compile.ts`, where `BACKEND_CODES.COMPILE_FAILED`
is actually used 3 times. This was a real search-scope error, not a
genuine finding about the code.

**Real behavioral test performed**: called `compileC()` directly
with genuinely invalid C source. Result:

```
ok: false
code: "BE1001" (COMPILE_FAILED)
message: "gcc failed to compile the generated C source:\n<the
complete, real gcc error output, line by line, unmodified>"
```

**The system works correctly, end to end**: a real GCC invocation
failed, and the complete, real error message reached the returned
diagnostic with nothing lost or swallowed. GCC was confirmed
available in this environment (unrelated to the network restriction
documented elsewhere in this project's own history — that restriction
is specific to `bash_tool`'s own network access, not GCC's own
availability).

**Corrected conclusion**: `BACKEND_CODES` is NOT dead code. The
earlier finding in this same document was wrong, caused by an
incomplete search scope — corrected here directly, not left standing.

Not yet tested in this pass: the `resolveGccPath()` failure path
itself (GCC genuinely missing) — not exercised here since GCC is
available in this environment; and `LINK_FAILED` (BE1002) specifically
was not triggered by this reproducer (only COMPILE_FAILED was).

## C Backend Runtime Audit — Additional Real Findings, Section Now Complete Per Exit Criteria

**GCC-missing path tested live**: simulated via temporarily
neutralizing `process.env.PATH` for the duration of one test only
(restored immediately in a `finally` block). Result: `ok: false`,
`BE1001`, message "gcc is not available in this environment" —
handled cleanly, no crash or unhandled exception. Confirmed via
runtime verification, the highest evidence level, not source
inspection alone.

**LINK_FAILED (BE1002) confirmed via direct source count**: `grep -c
"LINK_FAILED" tools/backend/c-compile.ts` returns 0 — this code is
referenced nowhere in the file. Unlike the earlier, corrected
COMPILE_FAILED finding, this is not a search-scope error (the same
corrected, full scope was used) — every failure path in this file
(GCC missing, Runtime Core source missing, an actual compile/link
failure) uses `COMPILE_FAILED`, since this file's own `gcc` invocation
performs compiling and linking as a single step, with no separate
linking stage that could produce a distinct failure. This is
Potentially Dormant, not confirmed dead — a future change splitting
compile/link into separate steps could activate it.

Permanent regression test added (2nd test in the same file):
confirms the GCC-missing path directly.

## WASM IR Fixtures Audit — Real Attempt Made, Honest Result: Not Yet Reached the Targeted Check

**Real attempt performed**: constructed a hand-built `IRModule` by
hand (4 blocks: entry/then/else/merge, intentionally violating the
Diamond CFG invariant's own exact-3-blocks requirement) and passed
it directly to `emitWasmModule()`. This is genuine IR-fixture
testing, not a UR program — the method previously flagged as needed
for this specific audit.

**Honest result across 4 real, sequential attempts**: each attempt
was rejected by a DIFFERENT, EARLIER check than the one being
targeted (`UNSUPPORTED_CFG_SHAPE`/WASM1002), not by that check
itself:

1. First attempt: rejected under WASM1001 for using `bool` as a
   direct constant type (unsupported at this sub-phase) — before
   reaching any CFG-shape check at all.
2. Second attempt (fixed the type): rejected under WASM1001 for an
   `IRConstant.kind` naming error (`"i64"` used where `"const_int"`
   was required) — a real, useful discovery about the exact type
   shape, not the targeted check.
3. Third attempt (fixed the constant shape): rejected under WASM1001
   for violating the Expression Tree Property (reusing the same
   value id twice as both operands of a comparison).
4. Fourth attempt (fixed the fan-out issue): rejected under WASM1001
   because the merge block's own returned value must be defined
   *inside* the merge block itself (apparently via the Local Slot
   mechanism referenced by `IRFunction.locals`, not by directly
   referencing an id from a different block) — a real, more complex
   requirement than initially assumed for how a merge block's own
   value must be represented.

**Conclusion, corrected per direct feedback**: `UNSUPPORTED_CFG_SHAPE`
(WASM1002) specifically was NOT reached in this session. The four
attempts indicate that constructing a valid IR fixture to reach
WASM1002 requires a deeper understanding of the IR's own structure.
The fourth attempt surfaced `IRFunction.locals`/`IRLocalSlot` as one
requirement that blocked reaching the targeted check — but it cannot
be asserted that this is the only requirement. Other constraints
(SSA discipline, dominance, stack discipline, or further Expression
Tree Property rules not yet encountered) may also apply and were
simply not reached yet, since the fourth attempt never got far enough
to test for them.

**Classification, per Evidence Precedence**:
- Status: Reported verified within this session (pending independent
  verification) — corrected from the earlier "Not verified", since a
  subsequent Prerequisite Investigation successfully constructed and
  ran a fixture triggering this exact code
- Evidence: a hand-built IR fixture, re-confirmed in a separate
  finalization pass, triggers WASM1002 exclusively (no other
  diagnostic code present in the error message)
- Confidence: High for this one specific violation path (a `store`
  inside a merge block, violating MERGE_IMMEDIATE_RETURN_CONTRACT);
  Low that every other way this same code could theoretically fire
  has also been verified — only one violation path was exercised

**Update, per the subsequent Prerequisite Investigation**: the
dedicated session recommended here did happen, and succeeded — see
`PREREQUISITE_INVESTIGATION.md`. The four failed attempts documented
above turned out to be caused by a specific, identified root cause
(a 4-block IR structure dispatches to `validateMergeShape`, not
`validateDiamondShape`, so the earlier attempts never reached any
CFG-shape check at all) — not a fundamentally harder problem than
initially estimated, once that dispatch logic was understood.

**What this attempt DID establish, with real evidence**: the
backend's own error handling is robust and informative across
multiple different real invariant violations — every one of the 4
attempts produced a clear `WasmUnsupportedError` with a specific,
readable message citing the exact rule violated, never a crash,
never a silent failure, never an unhelpful generic error.

No permanent test added from this specific line of attempts, since
none of them successfully exercised the actually-targeted check —
adding a test for "hits WASM1001 for an unrelated reason" would not
usefully document the CFG-shape invariant this audit set out to
verify.

## Updated Recommended Next Step: Prerequisite Investigation, Not a 5th Attempt

Per direct feedback: a random 5th attempt is not recommended. Instead,
logged as a new backlog item:

**Prerequisite Investigation — IR Fixture Construction**

Goal: not to fix WASM, but to document, before any further fixture
attempt:
- The minimal valid structure of `IRFunction`
- How `IRLocalSlot` is actually meant to be constructed and used
- The Expression Tree Property's own full rule set (not just the
  one violation encountered so far)
- Every CFG-acceptance rule enforced before `emitWasmModule()`'s own
  entry point

Only after this investigation should a fixture specifically
targeting `WASM1002` be attempted again — so that attempt is built on
architectural understanding, not further trial and error.

Logged as a formal backlog item: see `COMPILER_BACKLOG.md`.

## Evidence Summary

```
Evidence Summary
------------------
Verified by runtime:
- C backend: genuinely invalid C source -> BE1001, complete real gcc
  error message reached the diagnostic
- C backend: genuinely missing GCC (simulated via temporarily
  neutralized PATH) -> BE1001, "not available" message, no crash
  (tests/tools/c-backend-runtime-audit.test.ts, both cases)
- WASM backend: 2 real UR programs (constant return, real while
  loop) -> valid WASM bytes, zero invariant violations
  (tests/backend/wasm/wasm-happy-path-audit.test.ts)
- WASM backend: 4 hand-built IR fixtures (initial attempt), each a
  real, deliberate invariant violation - all 4 produced clear,
  specific WasmUnsupportedError messages, though none reached
  UNSUPPORTED_CFG_SHAPE at that stage
- WASM backend, Prerequisite Investigation follow-up: a 5th
  hand-built fixture, informed by understanding the real
  block-count-based dispatch (4 blocks -> validateMergeShape, not
  validateDiamondShape), successfully compiled with zero errors
  (passes ALL WASM1001 checks); a 6th fixture (same base, one
  deliberate MERGE_IMMEDIATE_RETURN_CONTRACT violation) triggered
  WASM1002 exclusively - confirmed twice: once during the
  investigation, once during a separate finalization pass
  (tests/backend/wasm/wasm1002-fixture.test.ts, 2/2, run together
  with the pre-existing wasm-happy-path-audit.test.ts, 2/2 - 4/4
  total, zero regression)
- IR Lowering: CG1001 (missing return) re-confirmed now caught
  earlier at type-checking instead (BUG-SA-002's own prior fix)

Verified by source inspection:
- src/cli/index.ts contains zero references to "wasm" (grep)
- src/backend/c/emit-c.ts contains zero throw/Error() statements (grep)
- BACKEND_CODES.COMPILE_FAILED used 3 times in tools/backend/c-compile.ts
  (grep, corrected after an earlier src/-only search missed this)
- BACKEND_CODES.LINK_FAILED used 0 times in tools/backend/c-compile.ts
  (grep -c, full corrected scope - every failure path in this file
  uses COMPILE_FAILED since compile+link happen as one gcc step)
- WASM_CODES.UNSUPPORTED_CFG_SHAPE referenced 60+ times in
  src/backend/wasm/ (grep count)

Not verified:
- Whether every WASM_CODES site is a genuine internal invariant vs.
  a real, reachable user-facing error - only counted and categorized
  by reading, not tested per-site
- CG1002 and CG9001 (the other two CODEGEN_CODES) - not behaviorally
  tested in this pass
- UNSUPPORTED_CFG_SHAPE (WASM1002) for any violation path OTHER than
  the one exercised (a store inside a merge block) - other throw
  sites in validateDiamondShape/validateMergeShape/validateWhileShape
  (wrong block count, non-cond_branch entry, mismatched merge
  targets, etc.) were read but not individually triggered

Out of scope:
- Systematically triggering every other UNSUPPORTED_CFG_SHAPE throw
  site individually (only one violation path was exercised, per
  "Not verified" above)
- CG1002, CG9001 - not attempted in this pass
```
