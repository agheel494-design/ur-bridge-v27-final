# COMPILER_BACKLOG.md

## Builtin Function Names Not Translated (e.g. Arabic "اطبع" for print) — Open, Discovered During Phase 0-A Testing, Unrelated to Import Work

**Status: Open. Discovered live while testing Phase 0-A's own CLI
import wiring in Arabic** — confirmed real, not a side effect of the
import work itself: `دالة main(): عدد\n  اطبع(99)\n... end` (with zero
import involved) fails with `SE1002: undefined function 'اطبع'`.
`print` itself works correctly in English-keyword programs. This
means Builtin function names (print, and likely others) are NOT
covered by the same keyword-localization table
(`src/compiler/localization/`) that translates `دالة`→`function`,
`أرجع`→`return`, etc. — a real, disclosed gap in Arabic-language
Builtin support, logged here as its own item since it is unrelated
to Phase 0-A's own import-resolution work (confirmed by reproducing
it with zero `import` statement involved).

## Struct: Passing an EXISTING Struct Variable to Another Function — RESOLVED


**Status: RESOLVED. This was a real Bug against an OFFICIAL, already-
ratified v1.0 language requirement** - confirmed via direct source
inspection: LANGUAGE_SYNTAX_1_1_SPEC.md section 2.5 ("Parameter
passing: BY VALUE") states explicitly: "A struct parameter is passed
by value (a full copy)... No new parameter-passing mode is introduced
for structs." Fixed this round.

**Real fix**: IRValueRef extended additively with an optional
structSlot field (a value ref can now represent "the whole struct at
this slot," not only a plain scalar SSA id - every existing id-only
usage is unaffected). lowerExpr's own Identifier case now checks
structVarSlot BEFORE the ordinary resolveVar() lookup, returning a
structSlot reference for an existing struct variable. IRParam extended
additively with an optional structLayout, so a struct-typed parameter
emits a real C by-value struct parameter (struct Point p_p) instead
of the prior void-typed placeholder - the C Backend copies it into
the function's own internal working slot (slot_p = p_p;, a single
real C struct assignment, which C itself lowers to a full field copy
- no manual per-field copy code needed). Call-site argument
generation checks for structSlot and passes the slot's own name
directly, letting C's own native by-value struct-copy semantics
handle the actual copy at the call boundary.

**Confirmed live, real C generated, real gcc compilation, real
execution**: useIt(p) (passing an existing struct variable to a
different function) now compiles to a real
ur_t_useIt(struct ur_struct_Point p_p) C function, called as
ur_t_useIt(slot_p) from the caller - gcc succeeds, real execution
produces the correct result (7). The permanent regression-marker
test that previously documented this exact failure was corrected
(not removed) to assert the real, new success.

**Regression**: full re-run, 407 tests across localization/struct/
typesystem/codegen/backend files plus all Bridge tests - zero
unexplained failures.

## Import Usage (Cross-Module Function Calls) — Decision Made, PARTIALLY Fixed

**Status: Decision resolved — a later, official directive classified
this as Release Blocker 1, superseding the "Needs Maintainer
Decision" classification below (kept for its own historical record).
Real, partial fix made and tested this session.**

**Real fix**: `analyze()` (Semantic Analyzer) now accepts an optional
`externalFunctionNames` parameter; `ModuleRegistry.getExportedNames()`
added. Function calls across module boundaries now resolve correctly
at Semantic Analysis — confirmed live, end-to-end, for both plain
functions AND (after a further fix) struct-typed parameters. See
`docs/architecture/FINAL_DIRECTIVE_STATUS.md` for the full, current
breakdown of what is and is not yet fixed (Type Checker, IR, Backend
wiring all remain open).

---

### Historical record (prior classification, before the directive resolved it)

**Original status: Open. Classification: Needs Maintainer Decision — corrected
per direct feedback from an earlier draft that asserted "Future
Work" as final. Neither Bug nor Future Work is asserted here as
settled; the evidence establishes the incompleteness itself clearly,
but not which label applies without an official specification or
maintainer statement.**

**Real finding, confirmed via direct source search**: `ModuleRegistry`
(the only real import-resolution mechanism found in this codebase)
and `analyze()`/`typeCheck()` (Semantic Analysis/Type Checking) have
no code connecting them anywhere found in this search — `import`
statements resolve correctly (confirmed live, for all 10 languages,
and confirmed language-agnostic via two live cross-language tests —
a Japanese program resolving both an English- and an Arabic-authored
library) — but calling a function from an imported module fails with
`SE1002: "undefined function"`.

**Corrected, per direct feedback**: "no connecting code found" is the
strongest available explanation from this session's own search, not
proof that no such connection exists anywhere or under any
condition (e.g. a separate linking stage not located, a feature
flag, or a different intended integration point not searched for).
This finding needs developer confirmation before being treated as
the confirmed root cause.

**Why "Needs Maintainer Decision" rather than asserting a label**:
the architectural similarity to the already-logged SWITCH/TRY-CATCH
finding (complete AST/Semantic/TypeChecker support, zero Parser
entry point) is a real, relevant observation offered as context —
but is a similarity in shape, not proof of the same classification.
Without an official specification or maintainer statement saying
cross-module usage is deferred, choosing "Bug" or "Future Work"
would be an inference presented as a finding.

**Superseded**: the directive resolved this — see the real, partial
fix noted above.

## Future Work (NOT part of UR 1.0 adoption) — FRI/FFI Public UR-Language Interface

**Status: Open. Per independent review finding and explicit
direction: FRI/FFI is NOT part of UR 1.0 as a usable language
feature — confirmed via direct inspection, zero FFI-access keyword
exists anywhere in the Lexer/Parser/canonical keyword table. The
existing `src/ffi/` toolkit (Native Bridge/Runtime Bridge drivers,
ABI, binding generator) is real, substantial, and tested at the
TypeScript level, but no UR `.ur` program can invoke it today. See
`docs/architecture/FFI_STATUS.md`'s own "Addendum" section for the
full finding.**

**If/when this becomes in-scope work** (not started here, per
explicit direction not to add any new language feature or public
interface at this stage):
1. Decide the actual syntax (`call_external`, an `extern`-style
   declaration, or something else) — a real language-design decision,
   not made here.
2. Confirm `emitUrBindings()`'s own generated output actually
   compiles through the real Lexer/Parser (not yet tested).
3. Design and implement the actual runtime connection from a
   generated/hand-written UR binding to the real native call —
   currently absent entirely.
4. Add real, live tests (not just string-content checks) proving a
   UR program can call a real native function end-to-end.

## Future Work (NOT part of UR 1.0 adoption) — Full-System Translation Beyond Lexer-Level Keywords

**Status: Open. Explicitly deferred, per direct instruction — this
is a scope decision, not an oversight. Do not begin any of this
without a separate, explicit go-ahead; it opens a genuinely new
project (full i18n across multiple systems), not an extension of the
completed keyword-localization work.**

Confirmed, per this session's own real, live test
(`tests/compiler/localization/comprehensive-reference-program.test.ts`,
11/11 passing, `run-logs-languages/05-final-confirmation-clean-rerun.log`):
all 10 languages are functionally equivalent through Lexer → Parser
→ Semantic → TypeChecker → Canonical IR — this is the highest level
currently proven, and is what UR 1.0's own language-equivalence claim
rests on.

**Explicitly NOT covered by that claim, logged here as separate,
future work, each requiring its own dedicated scoping/design session
before any implementation begins:**

1. **Diagnostic/error message translation** — every diagnostic
   across Lexer/Parser/Semantic/TypeChecker/Codegen is a hardcoded
   English string today (see `TEN_LANGUAGES_SCOPE.md`). Translating
   these would require a real i18n lookup system, not present at all
   currently.
2. **Warning name translation** — same gap, not yet designed.
3. **Compiler-tool message translation** (CLI output, build tool
   messages).
4. **Runtime message translation** — no runtime-level localization
   exists.
5. **Package Manager (urpm) message translation** — no localization
   layer exists there either.
6. **IDE-integration message translation** (LSP diagnostics,
   completions, hovers, etc.) — untouched by any localization work
   so far.
7. **REPL message translation** — same, untouched.
8. **Backend (WASM/C codegen) and Runtime execution-level functional
   equivalence across all 10 languages** — this session's own test
   stops at Canonical IR (the highest currently, uniformly-supported
   stage across all 10 languages, per `UR_1.0_LANGUAGE_COVERAGE.md`'s
   own findings — FOR/NULL are rejected at IR/Codegen for ALL
   languages equally, so this is a real UR 1.0 limitation, not a
   per-language gap). Proving Backend/Runtime-level equivalence would
   require either extending the reference program to avoid
   IR-unsupported features entirely through to real execution, or
   waiting for those Codegen gaps to close first.

**None of the above blocks UR 1.0's own current language-equivalence
claim, which is scoped precisely to Lexer→Parser→Semantic→TypeChecker→
Canonical IR — stated explicitly, not implied more broadly.**

## Classification: Bugs vs. Not-Implemented Features (from UR_1.0_LANGUAGE_COVERAGE.md's own findings)

**Status: Open. Classification only — none of these are fixed here,
per explicit direction not to modify the compiler. This
classification itself is Reported, pending independent verification
(a fresh clone/build/test run by an actual separate party), same as
every other finding in this project.**

### Classified as Bug (a real defect against the language's own
### apparent intent — not a documented, planned limitation)

1. **STRUCT type not recognized by Type Checker — RESOLVED.** A
   `struct` declaration processes with zero errors through Lexer,
   Parser, AST, and Semantic Analysis — but using that struct's own
   name as a variable or parameter type previously failed at Type
   Checker with `TY1001: "unknown type '<Name>'"`, regardless of
   syntax. This was classified as a Bug, not a missing feature,
   because struct *declaration* was fully supported and clearly
   intended to be *usable* — the declaration exists specifically to
   be used as a type. A declared-but-unusable type was inconsistent
   with the feature's own evident purpose.

   **Update, confirmed in a later session**: this Bug persisted even
   for a struct correctly exported from an imported module (the
   export-checker/Semantic-level fix described in the "Import System"
   item above did not touch Type Checker at all) — confirmed live,
   the exact same `TY1001` error occurred for a correctly-imported
   struct used as a parameter type, even after that fix.

   **REAL FIX, this round**: root cause found and fixed —
   `TypeChecker`'s own `structTypes` map (built correctly during
   hoisting, confirmed by reading the code directly) was never
   consulted by `resolveOptionalTypeRef`/`resolveTypeRefBase` in
   `src/compiler/typesystem/type-env.ts` before declaring a type
   unknown. Fixed by adding an optional `knownStructs` parameter to
   both functions (backward-compatible — defaults to none, zero
   change to any call site that doesn't pass it), and updating
   `checker.ts`'s own call sites to pass `this.structTypes` through.
   For cross-module usage, `typeCheck()`'s own free function and
   `TypeChecker.check()` now also accept an optional
   `externalStructTypes` parameter, merged into `structTypes` (local
   declarations take precedence on a name collision) — mirroring the
   same pattern already used for `analyze()`'s own
   `externalFunctionNames` fix. `ModuleRegistry.getExportedTypes()`
   added to supply this from real, resolved imports.

   **Confirmed live, all 10 languages**: struct declaration,
   construction (`Point(1, 2)`), field access (`p.x`), and returning
   a struct from a function all produce zero Semantic AND zero
   TypeChecker errors, for every one of the 10 languages — real test:
   `tests/compiler/localization/import-system-status.test.ts`
   ("Blocker 4" describe block, 10 tests + 1 disclosed gap, 11/11).
   Two pre-existing tests in `tests/compiler/stage-classes-structs.test.ts`
   that had explicitly asserted the OLD failure (`TY1001`) were
   corrected — per the standing rule against removing a test instead
   of fixing the root cause — to assert the real, new success
   instead.

   **What remains NOT fixed, disclosed directly**: the same
   struct-construction-and-field-access program still fails at
   Canonical IR (`CG1002: "call to unresolved function 'Point'"`,
   `CG1001: "'p' is not a known struct variable"`) — this is the
   pre-existing, documented Level 2 Codegen scope boundary (see
   `UR_1.0_LANGUAGE_COVERAGE.md`), confirmed to be unchanged by this
   round's own fix, not a new regression. Backend/Runtime were not
   investigated at all for struct support.

### Classified as Not Implemented (Codegen/IR scope boundary,
### explicitly stated by the code itself — a real, documented
### limitation of the current phase, not an unintended defect)

2. **FOR statement rejected at IR/Codegen.** Fully supported through
   Lexer/Parser/AST/Semantic/TypeChecker; rejected at IR with
   `CG1001`, whose own message explicitly states the current phase's
   scope ("Level 2 phase ... no for/switch/try-catch"). This reads as
   an intentional, staged rollout boundary, not an accidental defect.
3. **NULL literal rejected at IR/Codegen.** Same classification and
   same reasoning — `CG1001` explicitly names the current phase's own
   supported expression kinds, excluding `NullLiteral`.
4. **SWITCH/TRY-CATCH have no Parser entry point**, despite complete
   AST + Semantic + Type Checker support. Classified as Not
   Implemented (Parser-specific gap) rather than a Bug, since no
   syntax exists yet for a user to even attempt using these — there
   is no "broken behavior" a user could trigger, only an absent
   entry point for machinery that is otherwise ready.

**Next action**: none — this item exists to record the classification
itself, requested explicitly, for the independent reviewer's own use.
No fix is proposed or attempted here.

**Status: a running backlog of confirmed findings from the Compiler
Audit (see COMPILER_INVENTORY.md). Findings are logged here as they
are identified. Work is prioritized after evidence exists, not in
discovery order.**

---

## TASK: External Verification of WASM1002

**Status**: Open, not started.

**Goal**: obtain actual independent confirmation of the results
reported in this file and in `PREREQUISITE_INVESTIGATION.md` /
`COMPILER_INVENTORY.md` — this is a separate task from the work
already done, not a continuation of it.

**Closure criteria**:
1. Re-run the tests (`tests/backend/wasm/wasm1002-fixture.test.ts`,
   `tests/backend/wasm/wasm-happy-path-audit.test.ts`) via an
   external CI system, or by a reviewer who did not perform the
   original implementation.
2. Compare the results against this report.
3. Only if the results match, promote WASM1002's own status to
   `Independently Verified` — in `COMPILER_INVENTORY.md`,
   `COMPILER_BACKLOG.md`, and anywhere else it is referenced. Until
   this closure criteria is met, the status remains `Reported
   verified within this session (pending independent verification)`
   everywhere, with no exceptions.

## Prerequisite Investigation — IR Fixture Construction

**Status**: Reported complete within this session; pending
independent verification. See `PREREQUISITE_INVESTIGATION.md` for the
full documentation and both fixtures (passing and WASM1002-targeting).

## Additional Self Re-confirmation

- Clean environment re-run completed.
- Fresh fixture reconstructed independently.
- Backend source unchanged.
- Existing results reproduced.

**Finalization verification performed** (separate session, per
explicit task): re-ran Fixture #5 and Fixture #6 directly, confirmed
precisely:
- Fixture #5 passes with zero errors of any kind.
- Fixture #6 fails EXCLUSIVELY with WASM1002 — the error message
  contains no other diagnostic code (WASM1001/1003/1004 checked for
  and confirmed absent from the message).
- Both `tests/backend/wasm/wasm-happy-path-audit.test.ts` (pre-existing,
  2/2) and `tests/backend/wasm/wasm1002-fixture.test.ts` (2/2) pass
  together — 4/4, zero regression.
- Zero production files modified during this finalization
  (`git diff --stat -- src/backend/ src/compiler/codegen/` empty).

**Goal**: NOT to fix WASM or add a feature - to document, before any
further hand-built IR fixture is attempted:

- The minimal valid structure of IRFunction
- How IRLocalSlot is actually meant to be constructed and used
- The Expression Tree Property's own full rule set (only one
  violation of it was encountered so far - reusing a value id twice
  as both operands of a comparison; the full rule set is unknown)
- Every CFG-acceptance rule enforced before emitWasmModule()'s own
  entry point

**Why this is logged instead of a 5th quick attempt**: four real,
sequential attempts to hand-build an IRModule fixture targeting
UNSUPPORTED_CFG_SHAPE (WASM1002) each failed at a different, earlier
check (WASM1001, for four different reasons) - see
COMPILER_INVENTORY.md's own WASM section for the full sequence. This
demonstrates, with real evidence, that constructing a valid fixture
requires understanding beyond what reading the type signatures alone
provided. A 5th attempt without this investigation would likely
repeat the same trial-and-error pattern.

**Classification of WASM1002's own status**:
- Status: Not verified
- Evidence: four runtime attempts reached earlier invariant checks
  (WASM1001) before the target invariant
- Confidence: High that additional IR-construction knowledge is
  required; Low that the exact, complete prerequisite set has been
  identified (only one blocking requirement - the Local Slot
  mechanism - was actually encountered; others may exist and were
  simply never reached)

**Definition of Done** for this investigation (per explicit
direction, to make clear when this phase ends and WASM1002
Verification begins):

- [ ] The minimal valid structure of `IRFunction` is documented
- [ ] A fixture is built that passes every `WASM1001` check
      (constant types, `IRConstant.kind` shapes, Expression Tree
      Property, Local Slot usage) — a genuinely valid, well-formed
      function, not a shortcut
- [ ] That fixture reaches the point where `UNSUPPORTED_CFG_SHAPE`
      (WASM1002) can be directly targeted by deliberately violating
      only the CFG-shape rule, with every other rule already satisfied
- [ ] No changes are made to any backend code during this
      investigation — this phase is exploration/documentation only;
      any fix, if one turns out to be needed, is separate follow-up
      work after Verification, not part of this item

**Next action**: once this investigation is complete, attempt a
fixture specifically targeting WASM1002 again, built on documented
architectural understanding rather than further trial and error.

## FRI-BACKLOG-001 — Auto-registration for Python/Rust/JavaScript Drivers

Status: Deferred until v1.1 / after Release Candidate acceptance.
Reason: Behavioral change, not bug fix - would alter driver discovery/loading order, FRI behavior, and CLI behavior.
Scope: python-driver.ts, rust-bridge.ts, js-bridge.ts do not call DriverRegistry.register(), unlike opencv/onnx/ros2 drivers.

## FRI-FEATURE-001 — Language-level FRI/FFI support

Status: Not Implemented
Scope: Parser, Semantic, IR, Runtime, Backends
Priority: After RC acceptance
Classification: Feature (not a Bug) - the feature itself does not exist yet, confirmed via direct inspection of Parser/Semantic/IR (zero FFI-access keyword anywhere). Official docs (UR_LANGUAGE_SPEC_1_0.md line 47) accurately state this is not a usable feature of UR 1.0 - no doc/implementation mismatch.

## FRI-BACKLOG-002 — Opt-in Safe Mode / Sandbox / Allow-List for call_external and Manifest-based FFI

Status: Not Implemented (v1.1+ candidate)
Reason: v1.0's own FFI is open-by-default (calls any real external function, same trust model as any real FFI in any language) - this is a deliberate design decision, not a defect, confirmed and accepted directly by a real Windows independent review.
Scope: a future, OPT-IN restriction mechanism (CLI flag and/or manifest-level setting) limiting which runtimes/modules/functions a UR program may call via call_external/import - would need careful design to avoid a false sense of security (name-based allow/deny lists are trivially bypassable via aliases/wrappers).

## FRI-BACKLOG-003 — Auto-registration for the Go Driver (separate from FRI-BACKLOG-001)

Status: Deferred (no target version set). Recorded 2026-10-18 by PM decision P0 D-A4.
Reason: FRI-BACKLOG-001 covers python-driver.ts, rust-bridge.ts and js-bridge.ts only; it never covered Go, and Go is not added to it. Registering go-driver.ts with DriverRegistry would be the same kind of behavioural change (driver discovery/loading order, FRI behaviour, CLI behaviour), so it is not done now.
Scope: src/ffi/drivers/go/go-driver.ts does not call DriverRegistry.register(), unlike the opencv/onnx/ros2 drivers.
Runtime status: the Go driver's run path is NOT runtime-proven (docs/architecture/FFI_STATUS.md: "Code path implemented, NOT runtime-proven").
Effect on tests: tests/platform/architecture-rules.test.ts lists go-driver.ts as an exemption tied to this item. The exemption only records the deferral; it is NOT evidence that the Go driver is sound, safe or ready.
