# UR-Bridge — Roadmap Lock

## Phase Closure Status

```
Phase                         Status        Tests     TypeCheck scope
──────────────────────────────────────────────────────────────────────────────
Compiler Core (SSA/CFG/PHI)   ✅ CLOSED     688/688   src/compiler/ ¹
WASM Backend                  ✅ CLOSED     —         src/compiler/backend/ ¹
Optimizer Pipeline            ✅ CLOSED     —         src/compiler/optimizer/ ¹
CLI Toolchain (ur)            ✅ CLOSED     87        src/cli/ ¹
Lexer (Phase 1.1)             ✅ CLOSED     89        src/frontend/lexer/
Parser (Phase 1.2)            ✅ CLOSED     203       src/frontend/parser/
AST Validator                 ✅ CLOSED     18        src/frontend/validator/
Semantic Analyzer (Phase 1.3) ✅ CLOSED     101       src/semantic/
Type System (Phase 1.4)       ✅ CLOSED     165       src/typesystem/ ✅ 0 errors
Module System (Phase 1.5)     ✅ CLOSED     101       src/module/ ✅ 0 errors
urpm (Phase 2)                ✅ CLOSED     140+      src/urpm/ ✅ 0 errors
Incremental Compilation       ✅ CLOSED     106+      src/compiler/incremental/ ✅ 0 errors
LSP Server (Phase 4)          ✅ CLOSED     131/131   src/lsp/ ✅ 0 errors
Compiler Stabilization        ✅ CLOSED     —         tests/stress/ tests/regression/
Stable ABI + FFI              ✅ CLOSED     132/132   src/ffi/ ✅ 0 errors
Hardening Pass                ✅ CLOSED     677/677   full project ✅ 0 errors
Phase 7 — C++ Bindings +
  Exception Mapping (RC1)      ✅ CLOSED     755/755   full project ✅ 0 errors
Phase 7 — SQLite3 Integration
  + Generic FFI Loader         ✅ CLOSED     817/817   full project ✅ 0 errors
Phase 7.5 — Platform SDK        ✅ CLOSED     906/906   full project ✅ 0 errors
Frontend Restored from RC2      ✅ CLOSED     1066/1066 full project ✅ 0 errors
Frontend Level 1 — Full Test
  Migration Complete            ✅ CLOSED     1405/1405 full project ✅ 0 errors
Frontend Level 1 — Natural
  Language Support (10 langs)   ✅ CLOSED     1541/1541 full project ✅ 0 errors (Regex Audit closed)
Level 2.1 SSA IR                ✅ CLOSED (scoped) 1666/1666 full project ✅ 0 errors
Level 2.2 AST→IR Lowering        ✅ CLOSED (scoped) 1666/1666 full project ✅ 0 errors
Level 2.3 C Backend (initial)    ✅ CLOSED (scoped) 1666/1666 full project ✅ 0 errors
Level 2.4 Runtime Core           ✅ CLOSED (scoped) 1690/1690 full project ✅ 0 errors
Level 2.5 Standard Library         ✅ CLOSED — INDEPENDENTLY REVIEWED (GO) 1729/1729 ✅ 0 errors
Level 2.6.1  CFG type foundation   ✅ GO (reviewed) 1779/1779 ✅ 0 errors
Level 2.6.1.5 CFG Visual Validation ✅ GO (reviewed)
Level 2.6.2  if/else               ✅ GO (reviewed) — merge always created, unreachable-block-free, slots used minimally
Level 2.6.3  while                  ✅ GO (reviewed) 1807/1807 ✅ 0 errors
Level 2.6.4  break/continue          ✅ GO (reviewed) — 5/5 watch-points verified with real evidence
Level 2.6.5  CFG Verifier coverage   ✅ GO (reviewed) — honest self-loop finding documented
Level 2.6    FULLY CLOSED           ✅ GO — INDEPENDENTLY REVIEWED (10/10 architecture) 1807/1807 ✅ 0 errors
  (CFG/BasicBlock/Branch/Loop/Verifier models now frozen — see FREEZE_LOG.md tag v27-level2-6-control-flow)
Level 2.7     Functions ABI          ✅ CLOSED — GO (reviewed) 1835/1835 ✅ 0 errors
  (12-scenario audit found zero defects; ABI documented+frozen — see FREEZE_LOG.md tag v27-level2-7-functions-abi)
Level 2.8     Aggregates (Arrays+Structs) ✅ CLOSED — GO (reviewed) 1958/1958 ✅ 0 errors
  (Flattened Field Slots for structs — zero new IR types; see FREEZE_LOG.md tag v27-level2-8-aggregates
   ⚠️ WATCH-POINT: Flattened Field Slots re-evaluated when nested structs are ever introduced)
Level 2.9     Optimizer Infrastructure ✅ CLOSED — GO, STABLE (reviewed) 2118/2118 ✅ 0 errors
  (Pass Framework+Dominator+CFA+Dataflow+ConstFold+DCE+Validator; Copy Propagation formally REMOVED per audit
   see FREEZE_LOG.md tag v27-level2-9-optimizer — Stability Directive: no micro-opts, no new passes, bug-fixes only)
Level 3      Backend Diversification (restructured per review decision)
  ├── 3.0 LLVM Backend              🚫 BLOCKED (Environment) — see LLVM_ENVIRONMENT_REQUIREMENTS.md
  │     Reason: LLVM toolchain (clang/llc/opt/llvm-as) unavailable; no network access to install it.
  │     Do NOT write speculative/unverified LLVM IR code while this status holds.
  ├── 3.1 WASM Backend               🟢 ACTIVE — see WASM_BACKEND_SPEC.md
  │     Sub-phases (one at a time, independently reviewed, per established discipline):
  │       3.1A: ❄️ FROZEN — see LEVEL_3_1A_CLOSURE_REVIEW.md (the authoritative reference)
  │             3.1A.1 return-const -> 3.1A.2 arithmetic -> 3.1A.3 calls -> 3.1A.4 if/else ->
  │             3.1A.5 Local Variables -> 3.1A.6 while -> 3.1A.6b break -> 3.1A.6c continue
  │             (ALL CLOSED. Order corrected twice during development — both times by drawing
  │              CFGs before writing code, per LEVEL_3_1A_CLOSURE_REVIEW.md section 6.)
  │             Standing discipline (identical to the IR/Runtime ABI/Level 2.9 Optimizer):
  │             no new features added to any 3.1A sub-phase except to fix a confirmed,
  │             documented bug. Development proceeds to 3.1B as a clean next phase.
  │       3.1B: 🟡 RELEASE CANDIDATE READY (RC2 — RC1 superseded, contained a critical since-fixed
  │             bug) — NOT YET FORMALLY FROZEN. See RC2_VALIDATION_REPORT.md: every executable
  │             validation step passed with no defects found, but dependency installation (npm
  │             install) could not complete in this environment (network-restricted; cause not
  │             proven). Formal freeze requires one final network-enabled validation run
  │             (fresh clone -> npm install -> clean build -> full tests -> Golden Tests)
  │             completing successfully. See also
  │             GATE_REVIEW_3_1B_REVISION_2.md (APPROVED) and RELEASE_NOTES_v27_3-1B_rc2.md
  │             3.1B.1 Linear Memory Foundation -> 3.1B.2 Bounds Checking -> 3.1B.3 Dynamic Index ->
  │             3.1B.4 Arrays Inside Control Flow (constant index) -> 3.1B.5 Dynamic Index Inside a Loop
  │             (ALL CLOSED and gate-reviewed individually — but the overall 3.1B baseline
  │              they compose remains Release Candidate Ready, NOT frozen, per above, pending
  │              external verification. Standing discipline already applied regardless (identical
  │              to 3.1A/IR/Runtime ABI/Level 2.9 Optimizer): no new features on 3.1B.1-3.1B.5 except to
  │              fix a confirmed, documented bug. 3.1B.6+ proceeds as a clean next phase.)
  │             Open, tracked, deliberately unresolved issues (see issues/): Level 2.8 single-element
  │             array C Backend bug; cross-block reference to a never-reassigned variable; large array
  │             + while loop threshold bug. None block this freeze; none fixed inline in this baseline.
  │       3.1C: 🟡 PARTIAL — print(int) capability CLOSED/PROVEN (see "3.1C — print(int)
  │             Partial Closure" below); input, free, and the string/runtime-ABI import
  │             boundary remain NOT IMPLEMENTED / NOT DESIGNED. 3.1C as a whole stays OPEN.
  │             Runtime integration (WASM imports), Builtins (print/input/free)
  │     Verification: Node's native WebAssembly.validate()/instantiate() — confirmed viable by direct testing
  │     (hand-encoded modules, including a real loop/locals pattern, both validated and executed correctly).
  ├── 3.2 Runtime Integration         ⏸️ Folded into 3.1C above — not a separate top-level phase
  ├── 3.3 Backend Validation Suite    ⏸️ NOT STARTED — compares C Backend vs. WASM Backend output
  │     (stdout, exit code, panic/bounds-check behavior) on the same programs; scheduled after 3.1A-C close.
  └── 3.4 LLVM Backend (resumed)      🚫 BLOCKED — resumes only once LLVM_ENVIRONMENT_REQUIREMENTS.md's
        unblocking criteria (section 3) are independently verified in a future environment.
  (print/input/free builtins, via independent Builtins Registry — IR shape frozen, unchanged)
  (corrected from a 35-test undercount caused by a pre-existing
   corrupted test file that failed to load — see CHANGELOG.md)
IDE Tooling                   🔜 NEXT       —         src/lsp/ + VS Code extension
```

¹ Pre-existing test-file lint issues — not a Type System concern.
  Logged as "Compiler Test Suite Stabilization".

---

## V29-D2 — FROZEN

**V29-D2: 🔒 FROZEN.** `D1 (Approved/Design Baseline) → D2-RD (Re-Discovery) → Implementation → Micro-Review (Finding-41) → Evidence Review → Independent Review (fresh fixtures + raw bytecode inspection) → Freeze` — the full Gate sequence, none skipped.

**The precise, frozen capability — worded exactly, not to be loosened:**
> Runtime-Length Array Parameters in WASM: `function first(arr: int[]): int / return arr[0] / end` — the array is passed by reference (i32 base address, confirmed directly from the raw WASM Type section's own bytes), its real length is read from the existing runtime header (confirmed via bytecode-level `i64.load` counting, not inferred from correct output alone), bounds-checked against that runtime length, with `array_load`/`array_store` both working and alias semantics preserved (a mutation through the parameter is visible to the caller, matching the language's own pre-existing reference semantics for arrays).

**Explicitly NOT included in this Freeze** — stated to protect the Freeze's own precision, not merely as a formality:
```
Array return types           — not a D2 capability (still a Corrected Finding only, from Re-Discovery)
Nested arrays                 — untouched, D4's own future scope
Struct-array interaction      — untouched, D5's own future scope
GC / free(array)               — untouched, D3's own future scope
C Backend array-parameter support — contract-only, implementation deferred
Stale-SSA array bug            — NOT fixed; the official canary remains pinned WASM=99/C=5
```

**The one discovered-necessary fix, kept distinct from the four planned ones**: `getIndexScratchLocalIndex()` and its two sibling recompute functions were missing `fn.params.length` in their own scratch-local-position formula — required for Test 2 (array parameter load) to work at all, since without it the array-index scratch local collides with a real parameter's own WASM local index.

**Finding-41 (`41-array-parameter-bug`), closed with the precise wording ratified**:
> V29-D2-FINDING-41: RESOLVED AS INCIDENTAL EFFECT OF REQUIRED D2 LOCAL-INDEX CORRECTION

Not "D2 fixed array+parameter bugs generally" — the fix is the same local-index correction Test 2 already required; this fixture happened to share the identical root cause (a scalar parameter combined with array access), independent of whether the array itself is a parameter.

**Independent Review, using fresh fixtures throughout, never reusing the implementer's own test programs, with real bytecode inspection where it mattered**: the array parameter's own WASM type confirmed `i32` by manually parsing the raw Type section bytes (not inferred); confirmed exactly one `global.set` (bump-pointer-advance) exists in a two-index-access module, proving the parameter never triggers a second allocation; confirmed exactly two `i64.load` instructions for one parameter `array_load` (one for the runtime length-read, one for the element), matching prediction precisely; Finding-41's own causal mechanism independently recomputed from the official fixture's own real IR, not merely trusted from the implementer's own report; the fan-out finding independently reproduced as still-unfixed.

**A genuine new finding, surfaced by the Independent Review's own rigor, logged but not blocking**: an initial fresh alias test (a two-element swap through a parameter) gave an unexpected result — investigated rather than dismissed, and traced conclusively to a **pre-existing, D2-independent** bug (reproduced identically on a plain literal array with zero parameter involvement), likely the same root cause as the already-documented Critical SSA array bug. Logged to the Findings Ledger below, not folded into D2's own evidence or scope.

---

## Findings Ledger — v29-D2 Additions

```
V29-D2-FINDING-41            🟢 RESOLVED (incidental effect of the required local-index correction)
V29-D2-FINDING-NEW-01        🟡 OPEN — value %-1 has fan-out 2 (used 2 times); the arraySlot
                              sentinel is not represented correctly by Expression Tree fan-out
                              validation when the same array-slot argument participates in
                              multiple call expressions in one function. Did not block any of
                              the six official D2 acceptance tests. Not fixed — fixing it now
                              would have been scope expansion beyond D2's own authorization.
V29-D2-REVIEW-FINDING-01     🟡 OPEN — a captured local value (`let t = arr[i]`) followed by a
                              later store to the same array (`arr[j] = ...`) can read a stale/
                              incorrect value on subsequent use. Reproduced on a plain literal
                              array, zero function parameters or D2 code involved — independent
                              of D2. Likely the same root cause as the already-documented
                              Critical WASM SSA array bug, or a closely related manifestation
                              of it. Not investigated further; not fixed.
```

**Standing Findings, still unchanged, still not fixed, carried forward from before v29:**
```
Critical WASM SSA array bug   🔴 OPEN — official canary re-confirmed this round: WASM=99, C=5
Array + parameter bug         🟢 CLOSED — see Finding-41 above (this WAS that Finding)
Bool-value gap                🔴 OPEN — still blocks M3B; untouched by D2
NativePtr multi-use            🔴 OUT OF SCOPE
array_load reuse               🔴 OUT OF SCOPE
```

---

## Official Status

```
V29-D1   🟢 APPROVED / DESIGN BASELINE
V29-D2   🔒 CLOSED / PASS / FROZEN
V29-D3   🔴 NOT OPENED
V29-D4   🔴 NOT OPENED
V29-D5   🔴 NOT OPENED
```
Per this track's own established discipline, D3 is not opened automatically — it requires its own separate Design Gate, exactly as D2 itself did.

---

## v29 — Discovery Record

**v29 Discovery: 🔵 COMPLETE (no Design Gate opened by this record).** Per `UR_BRIDGE_V28_MASTER_ROADMAP.md` §9's own already-ratified scope (array GC/`free`, dynamic array length, nested arrays, struct-array interaction), a baseline inventory was conducted before any design work.

**The single most consequential finding**: the C Backend represents arrays as fixed-size C stack arrays (`int64_t arr[3];`) with **no `malloc` anywhere** — a major asymmetry with the WASM Backend's own bump-allocator model, and with string's own real `malloc`/`free` pair (present in *both* backends). Any `free(array)` design must first answer whether/how the C Backend's own arrays become heap-allocated at all — not assumed as "just add a free function," per explicit instruction.

**Confirmed directly, not assumed, AT THE TIME OF THIS v29 DISCOVERY ENTRY**: nested arrays failed cleanly at Lowering (`CG1001`, a deliberate, named rejection — a clean removal target, not a bug); struct-array interaction fails to even *parse* (no stub exists at any layer); the WASM bounds check (3.1B.2, already closed) uses a **compile-time-constant** length, not a runtime header read — meaning dynamic length requires changing an already-ratified, tested mechanism, not an additive change. **[V1.0-DOC-DRIFT-MULTIARRAY-003 correction]: nested arrays' own Lowering rejection was since resolved by the real v29-D4/D5 WASM-backend-internal engineering work (evidenced in emit-c.ts/emit-wasm.ts) — this remains a real, unchanged WASM backend milestone (v28/v29 are this backend's own internal labels, not UR language versions), and separately, nested arrays are not excluded by UR_LANGUAGE_SPEC_1_0.md's own real §11 "deferred to 1.1" list — the capability is real, working, and in-contract for UR v1.0 today. struct-array interaction and dynamic array length remain real, accurate, unresolved as described above.**

**Dependency finding**: GC/free and dynamic length are not independent — a memory model answering "how is an array's live extent known and reclaimed" is the load-bearing decision the other two items depend on for their own safety story. All four v29 items were assessed as needing their own Design Gate — none small enough for one undifferentiated batch (mirroring this project's own historical M2-scope-creep concern).

**Findings reconfirmed unchanged**: Critical WASM SSA array bug, array+parameter bug, bool-value gap — all re-tested with fresh values, none fixed, none touched.

**No code touched. No Design Gate opened.** Full detail in `V29_DISCOVERY.md`.

---

## V2-M7 — CLOSED (Layers A + B + C)

**M7: 🟢 CLOSED**, per the Final Consolidation Review across all three layers.

| Layer | Status |
|---|---|
| Layer A — LSP Transport | 🟢 CLOSED |
| Layer B — VS Code Extension | 🟢 CLOSED |
| Layer C — TextMate Grammar | 🟢 CLOSED |
| Real VS Code Extension Host | ⚪ UNVERIFIED |
| Real Oniguruma | ⚪ UNVERIFIED |
| Visual Rendering | ⚪ UNVERIFIED |

**Layer B's own closure basis**: the Final Consolidation Review found no scope gap independent of Layer A/C — `extension.ts`'s own `LanguageClientOptions.documentSelector` scopes a generic `LanguageClient` to the `"ur"` language; every standard LSP capability (diagnostics, completion, hover, definition, references) is routed automatically through the same protocol connection once this is correctly configured, requiring no separate per-capability client-side implementation. The one remaining gap — real VS Code Extension Host execution — is the identical, disclosed environmental constraint shared across all three layers, not a Layer-B-specific scope deficiency.

**The exact, precise closure statement for this record — never to be loosened into a broader claim:**
> M7 is CLOSED based on independently reviewed implementation and evidence for Layers A, B, and C. Real VS Code Extension Host execution, real Oniguruma behavior, and visual rendering remain UNVERIFIED due to environment constraints.

**A stale record corrected as part of this closure** (found during the Final Consolidation Review): the earlier `Layer A + Layer B (B-1)` closure record's own status table still listed `Layer C: 🔴 NOT AUTHORIZED`, accurate only at the time that table was first written — corrected below, in place, with a note explaining why, rather than silently rewritten.

**No new work opened under M7's own name at this closure.** `src/ide/`'s own separate Monaco tokenizer was not touched or "fixed"; no `C-3`; no new dependency (`vscode-oniguruma` or otherwise); no attempt to fabricate a VS Code test environment; no cosmetic refinement beyond what `C-2.1` already closed. M7 is considered complete on the evidence available, not pending further polish.

---

## V2-M7 Layer C — CLOSED (C-1 + C-2 + C-2.1)

**Layer C: 🟢 CLOSED.** All three constituent Gates closed, plus a Final Consolidation Review confirming the full A-H Design Gate scope was actually delivered before this closure was recorded — not merely that "some grammar exists and passes tests."

| Component | Status |
|---|---|
| C-1 — Grammar Extraction & Contract | 🟢 CLOSED |
| C-2 — Generated TextMate Grammar | 🟢 CLOSED |
| C-2.1 — Scope Taxonomy + Identifier Micro-Fix | 🟢 CLOSED |
| Layer C Final Review | 🟢 PASS |

**Micro-Fix C-2.1 (Scope Taxonomy + Identifier Pattern) — closure detail**: the Layer C Final Review found two genuine, honest gaps relative to the *original* Design Gate's own §B/§E — all 164 reserved words had been collapsed into one scope (`keyword.control.ur`) instead of the three the design specified, and no identifier-highlighting pattern existed at all. Per this track's own standing discipline (a Gate's own approved scope is not silently redefined as optional after implementation), a narrow Micro-Fix was authorized rather than treating either gap as an acceptable simplification.

**Fixed by deriving from data already present, not inventing anything new**: the C-1 contract's own `canonical` field (already present per-entry, confirmed directly: all 17 real `CanonicalKeyword` values present) was grouped into the three scope buckets the *original* Design Gate already specified — `CANONICAL_TO_SCOPE` is a 16-entry canonical→category mapping (matching the original design exactly), not a new per-word list. An identifier pattern (`variable.other.ur`) was added, built from the same cited Unicode ranges already established in C-2, correctly distinguishing identifier-start (excludes digits/most combining marks) from identifier-continue (includes them) per `lexer.ts`'s own real `isIdentStart`/`isIdentContinue` distinction.

**Independent Review — 26 fresh checks across 4 points, including a disclosed self-correction**: all 17 canonicals independently re-derived and matched (several verified via their own Arabic surface words, not just English); a full identifier-boundary matrix (digit-start rejection, combining-mark-start rejection, combining-mark-continue acceptance) — one test initially failed (Devanagari U+093E), investigated against the *real* `lex()` function directly rather than assumption, and found to be the reviewer's own wrong expectation, not an implementation defect (the real Lexer itself produces a genuine `IDENTIFIER` token for this exact input) — disclosed and corrected, not silently fixed; pattern-precedence tests confirming the identifier rule has a real, structural effect and does not leak into strings/comments; and two false-green attack variants — the required exhaustiveness-detection case (a reclassification to an *unmapped* canonical correctly halts generation), plus an additional, self-initiated variant (reclassification to a *different but already-mapped* canonical) that precisely surfaced the real boundary between C-1's own responsibility (word→canonical correctness, already independently proven exhaustively) and C-2/C-2.1's own responsibility (canonical→scope propagation) — reported as a scoping clarification, not a defect in either Gate.

**Exhaustiveness check, tested directly, not merely described**: appending a fabricated, unmapped canonical to a contract copy causes the generator to throw and stop, naming the exact unmapped value — confirmed independently by the reviewer as well as the implementer.

---

## What Layer C Actually Proves — the Precise, Standing Record

```
Real Localization (ALL_LANGUAGES, 10 languages)
  → C-1 Contract (174 surface-word entries, all aliases, independently re-extracted, 0 collisions)
  → C-2/C-2.1 Generator (canonical->scope derived from the contract's own real field,
     no hand-written keyword or category list)
  → TextMate Grammar (3 keyword scopes + 1 contextual scope + identifiers + lexical rules)
  → Manifest contribution ("grammars")
  → Independent verification (99 total tests across C-1/C-2/C-2.1's own Independent Reviews:
     Unicode boundary correctness across 5 scripts, canonical->scope correctness across all
     17 concepts, pattern precedence, 2 false-green attack variants, 3-way staleness,
     byte-for-byte artifact reproduction)
```

**The precise closure statement for this record, worded exactly as required — never to be loosened into a broader claim:**
> Layer C grammar generation and integration are proven through independent verification; real Oniguruma, VS Code Extension Host execution, and visual rendering remain UNVERIFIED due to environment constraints.

Not: *"VS Code highlighting is proven."* `vscode-oniguruma` and `vscode-languageclient`/`@types/vscode` remain network-blocked to install in this environment (the same disclosed constraint carried consistently across Layers A, B, and C) — JS `RegExp` was used throughout as an explicitly-disclosed stand-in for logic verification, never presented as equivalent to the real engine.

---

## V2-M7 Layer C, Gate C-2 (Generated VS Code Grammar) — Closure Record

**C-2: 🟢 CLOSED / PASS** (Discovery → Design Approved → Implementation → Evidence → Independent Review, all passed)

**What C-2 produced**: `tools/grammar/generate-grammar.ts` (the generator, consuming *only* the C-1 contract JSON — never re-importing `ALL_LANGUAGES`), `tools/grammar/check-grammar-staleness.ts` (SHA-256 content-hash staleness detection), `tools/grammar/verify-grammar.ts` (35-test verification suite), `extensions/vscode/syntaxes/ur.tmLanguage.json` (the generated grammar), and one addition (`"grammars"`) to `extensions/vscode/package.json`.

**The decisive technical finding this Gate was built around**: JS `\b` fails completely on non-Latin scripts (`/\bدالة\b/.test("دالة")` → `false`, even for the isolated word) — fixed via a lookaround-based boundary construction against the same identifier-continue Unicode character class C-1's own contract already cites from `lexer.ts`, not `\b`.

**`IN` — an explicit, separate, documented design decision** (per your own instruction that this not be decided silently): recorded at the top of `generate-grammar.ts` itself — `IN`'s own surface words are highlighted under a distinct scope (`keyword.other.contextual.ur`), generated via a wholly separate code path from the 164 genuinely reserved keywords, never merged with `keyword.control.ur`.

**Independent Review, exceeding the minimum requested scope in two places:**
- Unicode boundary testing covered all 5 required scripts (Arabic, Cyrillic, Japanese, Chinese, Latin) with 14 fresh tests, including keywords fused with adjacent Unicode identifiers (no space) and keywords embedded inside longer identifiers — not merely isolated-word success.
- The false-green attack was independently reproduced across **four different scripts** (Russian, Japanese, Chinese, Hindi), not a repeat of the implementer's own Arabic attack.
- The staleness mechanism's own hash was confirmed, from source, to be computed over the contract's full raw file content (not a separately spoofable metadata field), and tested with a genuinely different corruption than the implementer's own test.
- **The extra artifact-integrity audit**: the grammar file was regenerated for real, from the real current contract, and diffed byte-for-byte against the previously-committed artifact — **identical**, proving the on-disk artifact genuinely is what the generator currently produces, not a stale or hand-adjusted file merely resembling generated output.

**Scope discipline**: `src/compiler/localization/`, `lexer.ts`, `parser.ts`, Layer A, `src/ide/`, and the C-1 contract itself all confirmed byte-identical throughout, independently, by both the implementer and the reviewer, across the entire Gate.

**The precise, standing distinction, recorded exactly as required — never to be blurred:**
> UR TextMate grammar generation and integration contract is proven; actual Oniguruma/VS Code rendering remains unverified.

Not: *"UR syntax highlighting works in VS Code."* JS `RegExp` was used throughout as an explicitly disclosed stand-in for the real Oniguruma engine (itself network-blocked to install in this environment, same constraint as `vitest`/`vscode-languageclient`) — real Oniguruma behavior and real VS Code rendering remain `UNVERIFIED`, not claimed.

**The one-way generation-integrity architecture, now proven end-to-end, not merely designed:**
```
Real Localization (ALL_LANGUAGES)
  → C-1 Contract (174 entries, independently re-extracted, 0 collisions)
  → C-2 Generator (no hand-written keywords, reads only the contract)
  → TextMate Grammar (ur.tmLanguage.json)
  → Manifest contribution ("grammars")
  → Independent verification (35 tests, 5-script Unicode boundary, 4-script false-green attack)
  → Artifact reproduced byte-for-byte from the generator
```
This closes the "second source of truth" risk architecturally — proven via a real regenerate-and-diff, not asserted by convention alone.

---

## V2-M7 Layer C, Gate C-1 (Grammar Extraction & Contract) — Closure Record

**C-1: 🟢 CLOSED / PASS** (Discovery → Design Approved → Implementation → Evidence → Independent Review, all passed)

**What C-1 produced**: `tools/grammar/extract-keyword-contract.ts`, `generate-contract.ts`, `verify-contract.ts`, `keyword-contract.generated.json` — a single, generatable data contract sourced directly from the real, already-tested Language Mapper (`src/compiler/localization/`), covering all 10 shipped languages (`ar, en, fr, es, de, ja, ru, zh, pt, hi`), all 174 surface-keyword entries with every alias, and the universal lexical rules (identifiers, comments, strings, numbers, operators, punctuation) cited precisely against `lexer.ts`.

**Independent Review, using freshly-written logic, not a re-run of the implementer's own code:**
- Independent re-extraction: 174/174 exact match, 0 missing, 0 fabricated.
- Independent, from-scratch collision detection (not calling the real `detectCrossLanguageCollisions()`): 0 collisions.
- Multilingual union matching directly proven on `de.ur`'s own real, genuinely mixed-language content (`"import"` from English alongside `"funktion"`/`"zurueckgeben"`/`"ende"` from German, all four recognized simultaneously within one file) — decisive evidence for a union-based, not per-file-language-assumed, grammar design.
- `IN` confirmed correctly documented as contextual (`CANONICAL_TO_TOKEN.IN = "IDENTIFIER"`), not silently treated as an unconditional keyword.
- Every lexical-rule claim (Arabic comma U+060C, `//`/`/* */` comments, dual string delimiters, INT/FLOAT distinction, the full operator set) independently re-verified against `lexer.ts` directly.
- 14 fresh negative-control words, across five scripts, all correctly not matched — no overmatching.
- A real false-green attack (deliberately stripping all German entries from a contract copy) correctly produced a real, detected drop in matches — proving the test infrastructure has genuine sensitivity to contract defects, not fixed to always pass.

**Scope discipline**: `src/compiler/localization/`, `lexer.ts`, `parser.ts`, Layer A, and Layer B all confirmed byte-identical throughout, independently, by both the implementer and the reviewer. No new language added. No keyword data changed. No `.tmLanguage.json` grammar file was written — C-1 is extraction and contract only.

**Not claimed**: that VS Code renders any syntax highlighting — no real grammar file or VS Code rendering was produced or tested in C-1.

---

## V2-M7 — Layer A + Layer B (B-1) — Closure Record

**Layer A: 🟢 CLOSED** (per its own Independent Review and Micro-Fix A-1 sequence — LSP transport, Content-Length/JSON-RPC framing, lifecycle including the post-`shutdown` guard, malformed-message handling, `stdout`/`stderr` separation, real child-process E2E all independently proven).

**Layer B — Micro-Fix B-1 (Build Configuration + Server Path): 🟢 CLOSED / PASS**

**What B-1 fixed:**
- **B-001 (missing `tsconfig.json`)**: added, with `rootDir: "src"`, `outDir: "out"` — a real `tsc -p ./` run (repeated independently in final review) produces exactly four errors, all and only attributable to the missing `vscode`/`vscode-languageclient`/`@types/node` packages, zero attributable to build layout.
- **B-002 (server path / build layout mismatch)**: resolved by design, not a path patch — `run-server.ts` imports the main project's `src/lsp/transport.ts`, itself never compiled to `.js` anywhere in this repository (the whole project runs via `tsx`). Ahead-of-time-compiling `run-server.ts` would have produced a `.js` file whose own relative import could never resolve, regardless of path depth. The correct fix: compile only the client (`src/extension.ts` → `out/extension.js`, matching `package.json`'s own `"main"` exactly, unchanged) via `tsc`; launch the server via `tsx` directly (`command`+`args`, not `module`+`fork`), matching this project's own established runtime convention.
- The stale comment describing a since-abandoned path scheme was removed.

**The `tsx`-resolution finding, recorded with the exact precision required — not overstated, not dismissed:**
> Absolute `tsx` path removes `PATH` dependency for resolving `tsx` itself, but the executable's own shebang introduces an indirect `PATH` dependency through `/usr/bin/env node`.

Confirmed precisely, not asserted: `command`/`args` in `extension.ts` use `context.asAbsolutePath(...)` (never the bare string `"tsx"`) — verified directly from source. Deliberately breaking `PATH` reproduced the exact, real failure (exit 127, `env: 'node': No such file or directory`), confirming the indirect dependency is genuine. A normal, realistic `PATH` (as any real VS Code Extension Host has, Node being a de facto prerequisite for VS Code itself) was independently confirmed to launch correctly. **This is a known, low-risk residual property of the current `tsx`-based launch design — not a defect requiring a fix.** `process.execPath`-based invocation (bypassing the shebang/`env` layer entirely) is recorded as a possible future refinement, explicitly not authorized or required now.

**Layer B status table:**

| Item | Status |
|---|---|
| B-001 Build configuration | 🟢 CLOSED |
| B-002 Build/output layout | 🟢 CLOSED |
| Server launch architecture (`tsx`, not ahead-of-time compilation) | 🟢 VERIFIED |
| Absolute `tsx` path resolution | 🟢 VERIFIED (with the indirect shebang/`env`/`node` dependency precisely recorded, not glossed over) |
| CWD independence | 🟢 VERIFIED |
| Layer A integrity | 🟢 VERIFIED — confirmed byte-identical throughout |
| Main project integrity | 🟢 VERIFIED — confirmed byte-identical throughout |
| Full `tsc` compilation (of `extension.ts` into a real `out/extension.js`) | 🟡 ENVIRONMENT-BLOCKED — `vscode`/`vscode-languageclient`/`@types/*` unavailable, network-blocked (403), same disclosed constraint as V2-M6's own `vitest` gap |
| Real VS Code Extension Host E2E | 🟡 UNVERIFIED — no real Extension Host available in this environment; **not claimed as proven, not conflated with the real-process E2E that *was* proven for Layer A/B's own server-launch path** |
| Layer C (Syntax Grammar) | 🟢 CLOSED — *(historical note: this row originally read "NOT AUTHORIZED" at the time this table was first written, before Layer C was opened; corrected here for accuracy per the M7 Final Consolidation Review's own finding — see the M7 closure record above this one)* |

**No Micro-Fix B-2 opened.** `process.execPath` is not adopted now — an available future refinement, not a defect.

**Explicitly not claimed by this record**: "VS Code Extension Host E2E proven." The precise, standing distinction: `extensions/vscode/server/run-server.ts`'s own real-process launch (Layer A's own transport, and Layer B's own server-spawn mechanism) is genuinely proven; a real VS Code window activating `extension.ts` via a real `vscode-languageclient` remains unverified, pending an environment with real network access to install the missing packages.

---

## V2-M6 — Backend Validation Suite — Closure

**Closure date:** 2026-08-30 (per Design Gate → Implementation Authorization → Evidence → Independent Review sequence)

**Scope closed:** a new, reusable C↔WASM differential testing infrastructure (`tools/backend/differential-runner.ts`, `tests/backend/wasm/differential/`), covering 19 fixtures across three kinds (`differential`, `wasm-only-reject`, `canary-wrong`), each compared against an independent Oracle (`EXPECTED_VALUES.md`) computed *before* any fixture existed — not against `tools/generate-wasm-golden.ts`, which was explicitly not used or extended.

**Closure criteria:**

- [x] Fresh, independently-authored fixtures for every critical category (integer arithmetic, float arithmetic, function calls, multi-use, string chain, conditional allocation) — independently re-proven, not merely re-running the implementer's own 19 fixtures
- [x] Oracle independence confirmed — expected values computed by hand before either backend was run, both in the original implementation and again independently in review
- [x] Three separate false-green adversarial attacks — a wrong-oracle substitution, a missing-lookup-entry (`NaN`) case, and a maliciously-substituted canary "fix" — all correctly caught as failures, none produced a false pass
- [x] Stage distinction (`VALIDATE`/`INSTANTIATE`/`EXECUTE` tracked independently, not collapsed into a bare `PASS`/`FAIL`) proven directly from the real `runOnWasmBackend()` function, using a real, valid WASM module paired with a genuinely incomplete host stub — `VALIDATE: PASS`, `INSTANTIATE: FAIL`, `firstFailedPhase: "INSTANTIATE"` confirmed exactly as the direct V2-MU lesson required
- [x] Both canaries (Critical WASM SSA array bug, array+parameter bug) independently re-confirmed with fresh variable names and values — the known-wrong patterns generalize correctly, neither was fixed directly or indirectly
- [x] The one documented per-fixture exception (Fixture 34's own C-side value comparison, skipped due to `runExecutable`'s lack of a piped-stdin mechanism) independently confirmed, by direct code inspection, to be a hard-coded exact match against exactly one fixture name — not a general pattern that could silently extend to other fixtures
- [x] Full regression: existing 25-fixture golden corpus independently re-run, unaffected; Conformance Suite unchanged (10/11, same pre-existing failure)
- [x] Frozen Baselines, `ir-builder.ts`, `tools/backend/c-compile.ts`, `tools/generate-wasm-golden.ts`, and the pre-existing `tests/backend/wasm/golden/golden.test.ts` confirmed byte-identical, independently, at both the start and the end of the review
- [x] No existing Finding was fixed, directly or indirectly, under this Gate's own authorization
- [x] Independent Review completed without permanent modification to `src`/`tests`/`tools`

**V2-M6 is CLOSED. ✅** The precise, honest closure statement, recorded verbatim rather than as a looser paraphrase, since the distinction matters for this project's own record:

> V2-M6 was independently validated through direct execution of the production harness and adversarial review; the Vitest CLI was not executable in the environment because dependency/network access returned 403.

**This explicitly does not claim**: *"the Vitest suite passed."* `vitest` was not installed in this environment and network access to install it was blocked (`npm ls vitest` empty; `npx vitest --version` → 403), confirmed independently by both the implementer and the reviewer. Both relied on direct invocation of the real harness functions (`buildIR`, `runOnCBackend`, `runOnWasmBackend`, `makeHostStub`) — the same functions the real `differential.test.ts` file itself calls — rather than a `vitest run`. A real `vitest` execution, in an environment with network access, remains a genuine, outstanding step, not yet performed by anyone in this track.

**Closing M6 does not close, fix, or reopen anything else:**

| Item | Status |
|---|---|
| `V2-M3B` (`not(bool)`), Bool-value gap, Critical WASM SSA array bug, Array+parameter bug, `NativePtr` multi-use, `array_load` reuse | 🔴/🟡 **UNCHANGED** — all remain exactly as they were, now additionally pinned as regression-guarded canaries/rejections in the new Suite, but none fixed |
| `M7` (IDE Tooling — VS Code extension) | Now the designated next candidate, per the manager's own stated order — **Discovery/Design only**, no Implementation authorized by this record |

---

## V2-MU — General Multi-Use / Local Materialization — Closure

**Closure date:** 2026-08-30 (per V2 General Value Multi-Use Discovery → Design Gate → Implementation → Evidence → Independent Review sequence)

**Background:** `WASM_BACKEND_SPEC.md` §2.1 itself labeled the Expression Tree Property (fan-out ≤ 1) a *"TEMPORARY PHASE CONSTRAINT — NOT a permanent WASM Backend property"*, naming its own expected relaxation point, with a live Migration Test already sitting in `tests/backend/wasm/emit-wasm.test.ts` waiting to flip from rejection to acceptance. The root cause, confirmed by direct investigation of `src/compiler/codegen/ir-builder.ts`: a variable is promoted to a real WASM local only when reassigned inside a branch construct (`promoteToSlot()`, exactly two call sites) — a plain multi-use variable, never reassigned, was left as a pure SSA alias with no backing storage, which the WASM Backend's own fan-out check then correctly rejected.

**Scope closed:** the WASM Backend (`emit-wasm.ts`, `wasm-cfg-validation.ts`) now materializes any `const`/`load`/`binop`/`unop`/`call` instruction (of type `i64`, `f64`, or `string`) with fan-out > 1 into a real, dedicated scratch WASM local — computed once at its own point of definition, `local.set`, with every subsequent reference reading via `local.get` rather than re-deriving (or, for a `call`, re-*invoking*) the original expression. Function parameters (already backed by a real local) are exempted from the fan-out check directly, needing no new scratch local. `ir-builder.ts`/`promoteToSlot()` were deliberately not touched — this closure is entirely a WASM-Backend-side change (the Design Gate's own "Option B").

**Closure criteria:**

- [x] The mandatory, first-run side-effect test (`let s = input(); print(s); free(s)`) confirmed `input()` invoked exactly once at three independent levels (IR call count, WASM `OPCODE_CALL` byte count, real host-invocation count) — independently re-confirmed by the reviewer with a fresh fixture
- [x] **The mechanism confirmed directly from the emitted WASM bytecode itself, not inferred from correct output alone** — a real, independent disassembly of the golden test's own bytecode showed `CALL[ur_input_string] → local.set → local.get → CALL[ur_print_string] → local.get → CALL[ur_free]`, and of the ratified Migration Test showed `i64.add → local.set → local.get → local.get → i64.add` — in both cases, the side-effecting or expensive expression computed exactly once
- [x] The ratified Migration Test (`let a = 2 + 3; return a + a`) independently confirmed to flip from `REJECTED` to `ACCEPTED`, with real execution producing the correct result
- [x] The mechanism confirmed to be a narrow, real exemption rather than a blanket fan-out bypass — a genuinely different, deliberately out-of-scope fan-out-2 case (`array_load` result reuse) independently re-confirmed still correctly rejected
- [x] Scalar `i64`, function parameters (no duplicate materialization), `f64` (IEEE-754 precision preserved, including the `0.1+0.2` case), multi-use within `if`/Diamond/Diamond+Merge, and multi-use within a V2-M1 Conditional Allocation branch — all independently proven
- [x] `NativePtr` multi-use confirmed to remain correctly rejected — no WASM support was added for it, honoring the explicit prohibition
- [x] The Critical WASM SSA array bug used as an explicit canary, confirmed to remain **exactly as wrong as before** (not fixed, not worsened) — independently re-confirmed with a fresh fixture
- [x] Full regression (every prior closed sub-phase and Gate) independently re-run, unaffected; Conformance Suite unchanged (10/11, same pre-existing failure)
- [x] Frozen Baselines (13 files) **and `src/compiler/codegen/ir-builder.ts`** confirmed byte-identical, independently, at both the start and the end of the review — `promoteToSlot()`'s own semantics were never touched
- [x] Independent Review completed without permanent modification to `src`/`tests`

**A real bug was caught and fixed during this Gate's own first test, before it could ship**: the declared size of the i64 scratch-local group was initially counting materialized ids of every type (including the new string/float ranges), colliding with the correctly-computed string scratch index — caught by real `WebAssembly.instantiate()` failure (`local.set[0] expected type i64, found call of type i32`), not by `validate()` alone, which reported the module as structurally sound regardless. Fixed by filtering the count to i64-range ids only.

**V2-MU is CLOSED. ✅** This closes the one barrier that had kept `V2-M2` at partial closure — see that Gate's own updated record immediately below.

**New Finding, discovered during this Gate's own Test 3, not fixed**: a genuinely separate, pre-existing bug where a function combining an array local and a parameter silently drops the parameter's own value, even with the parameter used only once — confirmed pre-existing via `git stash` isolation, unrelated to multi-use, independently re-confirmed by the reviewer with a fresh fixture. Tracked separately (`FINDING_ARRAY_PARAM_INTERACTION_BUG.md`), not folded into this Gate's own patch.

**Standing Findings, re-confirmed unaffected, none touched by this Gate:**
```
Bool-value gap                🔴 OPEN / NOT AUTHORIZED
Critical WASM SSA array bug   🔴 OPEN / NOT AUTHORIZED (used as this Gate's own canary — confirmed unchanged)
Array + parameter bug         🔴 OPEN / NOT AUTHORIZED (new, discovered this round)
NativePtr multi-use           🔴 OUT OF SCOPE — correctly still rejected, no support added
array_load reuse              🔴 OUT OF SCOPE — correctly still rejected, no support added
```

---

## V2-M2 — String ABI — Closure

**Closure date:** 2026-08-30 (superseding the prior Partial Closure record, following V2-MU's own closure immediately above)

**What changed since the Partial Closure record**: the one barrier that prevented full closure — the natural, combined chain `let s = input(); print(s); free(s)`, requiring the same value reused across three statements — is now genuinely resolved by V2-MU. The golden test for this exact chain was independently proven twice: once via real execution (host-invocation counts, printed value correctness) and once via a direct disassembly of the emitted WASM bytecode itself, confirming `input()` is invoked exactly once and its result correctly flows through a real WASM local to both `print` and `free`.

**V2-M2 (String ABI) is now fully CLOSED. ✅**

| Item | Status |
|---|---|
| `input()` | 🟢 CLOSED |
| `print(string)` | 🟢 CLOSED |
| `free(string)`, documented WASM no-op | 🟢 CLOSED — **explicitly**: this remains an intentional, documented no-op for the WASM Backend (the bump allocator has no reclamation mechanism; real memory reclamation remains explicitly v29 scope per `UR_BRIDGE_V28_MASTER_ROADMAP.md` §9). Closing V2-M2 does **not** mean real memory reclamation was implemented. |
| Double-evaluation encoder defect | 🟢 CLOSED (fixed earlier, independently verified) |
| `input → print → free` via one shared value | 🟢 CLOSED — proven end-to-end and at the WASM bytecode level, via V2-MU |

**Original partial-closure record preserved below for its own historical detail** (individual vertical-slice evidence); this section records the supersession, not a rewrite of that evidence.

---

## V2-M5 — Float Support (`const`/`binop`) — Closure

**Closure date:** 2026-08-30 (per M5 Dependency Discovery → Implementation → Evidence → Independent Review sequence — the second milestone in this track, after M3, confirmed opened on a genuine, textually-grounded roadmap dependency rather than an invented Gate)

**Scope closed:** `const_float`; `f64` `add`/`sub`/`mul`, mirroring the already-proven `i64` pattern exactly (per `UR_BRIDGE_V28_MASTER_ROADMAP.md`'s own stated technical requirement — "mirroring i32/i64.* almost exactly"). Proven across the full range the Independent Review specifically demanded, not just the simplest case: `f64` parameters, `f64` returns, multiple `f64` parameters in one function, `f64`-returning functions called from `int`-returning ones, `int`- and `f64`-typed functions coexisting in the same module, and nested `f64` expressions — all independently re-verified with fresh fixtures.

**Closure criteria:**

- [x] `const_float`/`f64` `add`/`sub`/`mul` independently re-proven, real execution, fresh fixtures
- [x] `buildFunctionTypes`'s own broader claim (not just the simple return-value case) independently tested comprehensively — parameters, multiple parameters, nested calls, mixed `int`/`f64` modules — 7/7, all fresh fixtures the implementer had not used
- [x] Decimal precision independently reconfirmed, including a new nested case (`(1.1+2.2-0.3)*2.0` → `6.000000000000001`) — genuine IEEE-754 behavior preserved, not smoothed into a misleadingly clean `6.0`, confirmed via explicit tolerance comparison rather than exact-equality (which would have hidden a real precision difference had one existed)
- [x] `i64`'s own existing behavior independently re-confirmed unaffected — fresh fixtures throughout (multiple params, nested arithmetic, arrays, V2-M1's own Conditional Allocation, V2-M3A's own `neg`, P1-3C's own `print(int)`)
- [x] `f64` `div`/`mod` and float comparisons confirmed still correctly out of scope, not implemented
- [x] **Float arrays — the precise characterization requested, independently corroborated from the validator's own code, not just from observed behavior**: `wasm-cfg-validation.ts`'s own `array_store` check never inspects the stored value's own type at all — confirming there is no validator boundary anywhere in this codebase designed to reject a float array element. The rejection floats currently receive is an incidental side effect of the underlying WASM engine's own compile-time type check (the emitter unconditionally encodes `array_store` via `i64.store`) — not a designed guard. Recorded here precisely as a standing characterization, not silently treated as equivalent to the other, genuinely-designed rejections in this Gate.
- [x] `print(float)` confirmed correctly out of scope (a Runtime Integration/M2 concern, not touched)
- [x] Multi-use/fan-out and bool-value Findings confirmed untouched, independently, with fresh fixtures — neither worked around nor extended
- [x] Full regression independently re-run, unaffected; Conformance Suite unchanged (10/11, same pre-existing failure)
- [x] Frozen Baselines (13 files) confirmed byte-identical, independently, at both the start and the end of the review
- [x] Independent Review completed without permanent modification to `src`/`tests`

**V2-M5 (Float Core: `const_float`, `f64` `add`/`sub`/`mul`, locals/parameters/returns of any arity or nesting) is CLOSED. ✅** Explicitly **not** closed by this record: `f64` `div`/`mod`, float comparisons, float arrays, `print(float)`, or any other Runtime Integration/String-ABI-adjacent capability — each remains out of this Gate's own scope, governed by its own future decision.

| Item | Status |
|---|---|
| `const_float` | 🟢 CLOSED |
| `f64` `add`/`sub`/`mul` | 🟢 CLOSED |
| `f64` locals/params/returns (any arity, nesting, mixed with `int`) | 🟢 CLOSED |
| `f64` `div`/`mod`, float comparisons | ⚪ Out of scope — not implemented |
| Float arrays | ⚪ Out of scope — correctly rejected as an incidental type-mismatch byproduct, not a designed boundary; standing characterization, not a defect requiring a fix |
| `print(float)` | ⚪ Out of scope — belongs to Runtime Integration (M2) |

**Standing Findings, unaffected, not opened by this Gate:**
```
Bool-value gap                🔴 OPEN / NOT AUTHORIZED
Multi-use / fan-out            🔴 OPEN / NOT AUTHORIZED
WASM stale-SSA array bug       🔴 OPEN / NOT AUTHORIZED
Scalar Diamond bug             🔴 OPEN / NOT AUTHORIZED
```

---

## V2-M4 — Verified Existing Capability (Not an Implementation Gate)

**Record date:** 2026-08-30 — logged as a documentation/reclassification step, per explicit instruction that this is *not* an Implementation Gate.

**Governance nuance, recorded precisely, per explicit correction:** `V2-M3A`'s own closure (`neg(int)`) does **not** mean `V2-M3` overall is closed (`V2-M3B`, `not(bool)`, remains `🟡 BLOCKED` — see the section above). `UR_BRIDGE_V28_MASTER_ROADMAP.md`'s own dependency table lists M4's dependency simply as `"M3"`, without specifying whether this means the milestone in full or a specific sub-part. This record does **not** resolve that ambiguity by declaring `M3` satisfied in general. It relies on a narrower, more precise basis instead: the roadmap's own §9 states the *reason* for M4's dependency on M3 explicitly — *"M4 (calls with arguments) touches the same `emit-wasm.ts` call-handling code that M3 (`unop`) also touches... sequence M3 before M4 ... to avoid two concurrent, overlapping changes to the same code region."* This is a **sequencing/merge-conflict concern**, not a functional dependency on M3's own output. `V2-M3A`'s own edits to that shared code region are complete, independently reviewed, and frozen — the specific concern the dependency exists to address is resolved, regardless of `V2-M3B`'s own separate, still-open status.

**What was verified, live, this round (twice — once in the original Gap Report, once again after V2-M3A's own patch, to confirm nothing in the shared code region disturbed it):**
```
double(21) → 42   PASS
add(3, 4)  → 7    PASS
```
Real `WebAssembly.instantiate()` execution, both before any V2-M1/M2/M3 work began and again after V2-M3A's own changes landed — identical, correct results both times.

**V2-M4 (function calls with arguments) is a VERIFIED EXISTING CAPABILITY. ✅** No code was written or modified to produce this closure — it already existed, predating this entire v28 track's own tracked Gates, and is recorded here only so the roadmap's own documented state matches the code's own actual, already-proven state — closing the gap between "what the code can already do" and "what the roadmap says is done," per the explicit governance concern this record exists to address.

**Explicitly not implied by this record:** that `V2-M3` overall is closed, that `V2-M2` is any more closed than its own existing `🟡 PARTIAL` record states, or that `M5`/`M6`/`M7` are now available — each remains governed by its own, separately-stated dependency, unaffected by this record.

---

## V2-M3A — `neg(int)` Closure / V2-M3B — `not(bool)` Blocked

**Closure date:** 2026-08-30 (per Gate V2-M3 Discovery/Design → Implementation → Evidence → Independent Review sequence, continuing the UR v2.8 completion track — `V2-M3` was the only milestone in `UR_BRIDGE_V28_MASTER_ROADMAP.md`'s own dependency table with a stated dependency of `"None"`, independent of M1/M2)

**Scope closed:** `neg` on `int` (`i64`) only — proven end-to-end (UR source → IR → WASM → real execution → observable result, matching the C Backend, including a nested-negation case). `not` on `bool` was implemented but could not be proven end-to-end — blocked by a separate, pre-existing gap (below), not by any defect in the `unop` implementation itself.

**Closure criteria for `neg(int)`:**

- [x] Positive cases (`neg(17)`, `neg(0)`, `neg(neg(17))`, `neg(neg(neg(9)))`) independently re-proven with fresh fixtures, including a nested case the implementer's own report did not test
- [x] C ↔ WASM behavioral equivalence independently re-confirmed, with truncation computed explicitly (not eyeballed) — WASM's own direct function return is full-precision/signed; C's own process exit code is the same value truncated to 0–255, exactly as this track's own SQLite3 work already established
- [x] `neg` on `bool` (negative control) confirmed already correctly rejected at type-checking, never reaching the WASM Backend
- [x] The new `unop`-operand `useCounts` registration this Gate added is itself independently confirmed correctly wired into the multi-use/fan-out check (a `unop` operand reused, e.g. `-(n) + n`, is correctly rejected) — not merely present but inert
- [x] The pre-existing multi-use/fan-out Finding independently re-confirmed unaffected, from a fresh fixture, isolated against the true original baseline via `git stash`
- [x] Full existing WASM regression (arithmetic, V2-M1 Conditional Allocation, P1-3C `print(int)`) independently re-run, unaffected
- [x] Frozen Baselines (13 files, including `src/shared/ir.ts`, `types.ts`, `type-env.ts`, `checker.ts`, `compatibility.ts`, `interpret.ts`, `cli/index.ts`, `builtins.ts`, `runtime-table.ts`, `runtime/ur_runtime.c`, `src/backend/c/emit-c.ts`, `lower-to-ir-helpers.ts`, the WASM test file) confirmed byte-identical, independently, at both the start and the end of the review
- [x] Independent Review completed without permanent modification to `src/`/`tests/`

**Correction to the record, made by the Independent Review, entered here as the official account rather than the original Evidence Report's own wording:** the original test for `neg(float)`'s own rejection (`let x: float = -(7.25)`) did not actually exercise this Gate's own new, `unop`-specific rejection code — it triggered a *different*, pre-existing, unrelated `const_float` check (predating V2-M3 entirely), because the float *literal* itself is rejected before validation ever reaches the `unop` instruction. The Independent Review confirmed the Gate's own new code is **not dead** — it is genuinely reachable and correct, demonstrated via a `float` **parameter** instead of a literal (`function negate(x: float): float / return -(x) / end`), which correctly produces the Gate's own intended diagnostic naming the `f64` boundary specifically. **Both rejection paths are safe and behaviorally correct** — this was a precision issue in the original evidence's own specific test choice, not an implementation defect, and does not change the closure verdict below.

**V2-M3A (`neg(int)`) is CLOSED. ✅ V2-M3B (`not(bool)`) remains explicitly NOT closed:**

| Item | Status |
|---|---|
| `neg(int)` | 🟢 CLOSED |
| `not(bool)` | 🟡 BLOCKED BY PRE-EXISTING BOOL-VALUE GAP — implemented, not provable end-to-end |
| `neg(float)` | 🟡 Correctly, safely rejected — implementation deferred to M5, not this Gate's scope |
| `~` (bitwise complement) | ⚪ Confirmed out of scope — does not even parse in current UR syntax |
| Multi-use/fan-out limitation | 🔴 Separate, standing Finding — untouched, not opened by this Gate |
| Bool-value support (no literal, no comparison-as-value) | 🔴 New, separate, standing Finding — untouched, not opened by this Gate |

Neither the multi-use Finding nor the bool-value Finding was authorized for a fix under this Gate. Whether either becomes its own future Gate is a separate decision, pending its own Roadmap Discovery — not decided here.

---

## V2-M2 — String ABI — Partial Closure (Proven Vertical Capabilities) — HISTORICAL RECORD, SUPERSEDED BY FULL CLOSURE ABOVE

**Closure date:** 2026-08-30 (per Gate V2-M2 Discovery/Design → Implementation → encoder-bug root-cause → fix → Independent Review sequence, continuing the UR v2.8 completion track)

**Scope closed:** `input()`, `print(string)`, and `free(string)` (as a documented, intentional WASM no-op — real memory reclamation remains explicitly v29 scope per `UR_BRIDGE_V28_MASTER_ROADMAP.md` §9), each independently proven end-to-end via real `WebAssembly.instantiate()` execution with a real JS host runtime — not `validate()`/`instantiate()` alone. A genuine, pre-existing WASM emitter defect (`encodeStatements` double-emitting `OPCODE_CALL` for a call instruction whose result was also consumed as an argument elsewhere in the same block — silently masked since P1-3C by every prior test using only pure, side-effect-free calls) was found, root-caused with concrete byte-level and execution-count evidence, fixed with a narrowly-scoped change, and independently re-verified with fresh fixtures.

**Closure criteria:**

- [x] `input()` independently re-proven: real stdin → real host write into WASM linear memory → real WASM read-back → correct value, via a reviewer-authored fixture with content never used by the implementer
- [x] `print(string)` independently re-proven, same real chain
- [x] `free(string)`, single-use, independently re-proven — call count exactly 1, no crash, and the no-op verified (not merely asserted) by capturing the bump-pointer Global's value at `free()`'s own entry and exit specifically
- [x] The double-evaluation encoder defect: root-caused at three independent levels (IR instruction count, WASM bytecode `OPCODE_CALL` count, real host-invocation count), fixed with a single, narrowly-scoped helper function and one conditional check, and independently re-verified with a *different* fixture (a new helper function, a new value) than any the implementer used — confirming the fix generalizes, not merely patches one specific test case
- [x] The already-closed `print(helper())` pattern from P1-3C (which silently hid this exact bug for the entire prior track) re-verified, independently, to now genuinely invoke `helper()` exactly once at the bytecode level — not merely producing a coincidentally-correct result
- [x] The separate multi-use/fan-out limitation confirmed, independently, to remain correctly, fully enforced — the fix did not open any backdoor around it
- [x] Full regression (arithmetic, arrays, V2-M1's own Conditional Allocation, Conformance Suite) independently re-run, unaffected
- [x] Frozen Baselines (`ir.ts`, `types.ts`, `type-env.ts`, `interpret.ts`, `cli/index.ts`, `builtins.ts`, `runtime-table.ts`, `runtime/ur_runtime.c`, `wasm-cfg-validation.ts`, the WASM test file) confirmed byte-identical, independently, at both the start and the end of the review
- [x] Independent Review completed without modifying `src/` or `tests/`, using exclusively fresh, reviewer-authored fixtures throughout

**V2-M2's proven capabilities are CLOSED. ✅ Full V2-M2 remains explicitly NOT closed:**

| Item | Status |
|---|---|
| `input()` | 🟢 CLOSED / PROVEN |
| `print(string)` | 🟢 CLOSED / PROVEN |
| `free(string)`, documented WASM no-op | 🟢 CLOSED / PROVEN |
| Double-evaluation encoder defect | 🟢 CLOSED — fixed and independently verified |
| `let s = input(); print(s); free(s)` (the natural, combined chain via one shared value) | 🔴 BLOCKED — a separate, still-open Finding (below), not a defect in the String ABI itself |
| General multi-use locals in the WASM Backend | 🔴 OUT OF SCOPE for V2-M2 — its own future Gate, pending a Roadmap Discovery |
| **Full V2-M2 closure** | 🟡 **NOT CLAIMED** — explicitly partial |

**Standing Finding, tracked separately, not authorized for a fix under any current Gate:**

```
🔴 WASM Backend — General Multi-Use / Fan-Out ≤ 1 Limitation
```
Confirmed general (reproduced with a plain `i64` value, zero strings involved), pre-existing (present in the original, unmodified emitter), and architecturally significant — the error's own message names it as "deferred to sub-phase 3.1A.6 (Local Variables)." Whether this becomes its own Gate is explicitly **not decided here** — it requires its own Roadmap Discovery first, given its potential relevance to the project's own "language ease" priority (a UR programmer reusing a variable is entirely ordinary; the current WASM Backend rejecting it is a real gap between the language's own intended ergonomics and one Backend's current capability, not a cosmetic issue).

---

## V2-M1 — Conditional Allocation — Scenario 1 Closure

**Closure date:** 2026-08-30 (per Gate V2-M1 short Discovery/Design → Implementation → Evidence → Independent Review sequence, part of the UR v2.8 completion track defined in `UR_BRIDGE_V28_MASTER_ROADMAP.md`)

**Scope closed:** an array allocated inside exactly one branch of `if`/`else`, with every reference to it confined entirely to that same branch (`TEST_PLAN_3_1B_6.md`'s own "Scenario 1") — for both CFG shapes a UR `if`/`else` can lower to (Diamond, Invariant 3.1A.4; Diamond+Merge, Invariant 3.1A.5). Two pre-existing gaps in the Diamond shape's own array/struct/entry-statement handling, discovered during this Gate's own testing (not anticipated in `DESIGN_3_1B_6.md`), were fixed as a necessary precondition for Scenario 1 to be usable at all.

**Closure criteria:**

- [x] Both CFG shapes independently re-verified with fresh fixtures by an independent reviewer
- [x] The two Diamond-shape fixes confirmed necessary (via a live before/after array-read test) and non-regressive (11/11 representative regression, independently re-run)
- [x] Frozen Baselines (`ir.ts`, `types.ts`, `type-env.ts`, `interpret.ts`, `cli/index.ts`, `builtins.ts`, `runtime-table.ts`, `runtime/ur_runtime.c`, and the WASM test file) confirmed byte-identical, independently, by hash, at both the start and the end of the review
- [x] The Independent Review's own investigation of an apparent "Scenario 2 already works" result did not stop at the surface finding — it inspected the actual IR, found the two array declarations receive different slot IDs even under an identical source-level name, and correctly concluded genuine same-slot Scenario 2 is not constructible via current UR syntax at all — the original claim (Scenario 2 not implemented) stands, unrevised

**V2-M1 Scenario 1 is CLOSED / PROVEN, for both CFG shapes. ✅** This is explicitly **not** a claim that Conditional Allocation is complete in every form:

| Item | Status |
|---|---|
| Scenario 1 (single-branch allocation, confined use) | 🟢 PASS — independently proven, both CFG shapes |
| Scenario 2 (both branches allocate to the same slot, read after merge) | ⏸️ DEFERRED — not implemented; independently confirmed not even constructible via current UR syntax |
| While-loop-allocated arrays | ⏸️ DEFERRED — `DESIGN_3_1B_6.md`'s own §6 open design question remains fully open |

**Two standalone, unauthorized-for-fix findings surfaced during this Gate's own testing, neither caused by V2-M1's own patch (both independently confirmed pre-existing via `git stash` isolation against the original, unmodified code):**

- 🔴 **Critical WASM SSA/Array Materialization Bug** — `let`-captured value after a write, followed by a second write to the same array slot, returns the *later* write's value instead of the value at the point of capture (WASM: wrong; C Backend: correct, for the identical program). See `CRITICAL_FINDING_WASM_SSA_ARRAY_BUG.md`. **OPEN / NOT AUTHORIZED FOR FIX.**
- 🔴 **Scalar-in-Diamond-Shape Rejection** — a plain scalar variable declared in `entry` and returned directly from a Diamond-shape branch is rejected, independent of any array involvement. Discovered during this Gate's own Independent Review. **OPEN / NOT AUTHORIZED FOR FIX.**

Neither finding is folded into V2-M1's own closure, and neither is scoped or authorized as a new Gate by this closure record — both await their own future Discovery, per explicit instruction.

---

## Native Pointer ABI — Closure

**Closure date:** 2026-08-30 (per Native Pointer ABI Design Gate → Gates A–D Implementation → Independent Review sequence)

**Background:** the ONNX Runtime Discovery (following SQLite3's own Native Integration closure) found a real, present, `dlopen`-able library with genuine plain-C symbols — but both returned/accepted pointers, not the plain scalars SQLite3's own reference slice used. Neither `IRType` nor UR's own `TypeSystem` had any pointer representation at all. A dedicated Design Gate scoped a deliberately narrow `NativePtr` addition — an opaque, FFI-boundary-only handle, with no arithmetic, no dereference, no casts — before any ONNX-specific work proceeded.

**Scope closed:** `NativePtr`/`"ptr"` added to `src/compiler/typesystem/types.ts` and `src/shared/ir.ts` (both previously untouched by this entire Native Integration track), threaded through `type-env.ts`, `checker.ts` (one narrow null-sentinel rule for `signatures.ur`'s placeholder-body convention), `lower-to-ir-helpers.ts`, and `interpret.ts`'s `"native"` runtime branch (extended to support a `ptr`-returning call and exactly one `ptr`-typed parameter — no more).

**Closure criteria:**

- [x] Full chain independently re-verified: `nativeptr` → Lexer/Parser → Semantic/TypeChecker → IR (`"ptr"`) → Native ABI → a real foreign pointer from a real external library → passed to a second, independent native function → a correct, distinguishable computed result (`777`, chosen by the independent reviewer specifically to rule out a coincidental pass) — **WITHDRAWN by GATE-026 D4 (see correction below): no retained evidence supports this cross-call result, and the current architecture runs every FRI call in a separate process.**
- [x] Both required negative controls (nonexistent library; unauthorized call shape — more than one `ptr` argument) correctly rejected, independently reproduced
- [x] SQLite3's own already-closed scalar reference slice re-verified unaffected
- [x] WASM regression (6 cases, including the P1-3C `print(int)` capability with its captured value checked, not just "didn't crash") — clean
- [x] Broad compiler regression — 14 of 14 real example programs in `examples/`, not a hand-picked subset, given `IRType`'s wide blast radius
- [x] Frozen Baselines (`src/shared/builtins.ts`, `src/shared/runtime-table.ts`, `runtime/ur_runtime.c`, `src/backend/wasm/wasm-cfg-validation.ts`, `src/backend/wasm/emit-wasm.ts`) confirmed byte-identical, independently
- [x] The one real, disclosed design ambiguity — whether `NativePtr` is source-location-restricted to `signatures.ur` or a general, if inert, language type — resolved empirically, precisely, and independently: it **is** a general declaration-surface type, but **no value of it can be constructed anywhere except as a native call's return** (no `let`-initializer coercion, no literal syntax beyond the narrow `return 0` sentinel case) — the FFI-only intent is achieved by absence of constructors, not a location check. Recorded here explicitly, not left ambiguous.
- [x] Independent Review completed without modifying `ir.ts`, `types.ts`, `interpret.ts`, or any other file

**GATE-026 D4 correction (supersedes the claim below):** UR can hold a `nativeptr` value returned by a native call and use it inside UR, but **`nativeptr` values are rejected at the FRI process boundary before foreign execution begins** (`FRI_UNSUPPORTED_ARGUMENT`): every FRI call runs in a separate process, so a pointer cannot be passed to a subsequent foreign call. FRI is trusted foreign execution; it provides **no isolation guarantee**. The 2026-08-30 "777" cross-call evidence is not retained in the repository and is not reproducible on the current architecture (RCA: `GATE-026-D4-RCA-777.md`).

> Superseded 2026-08-30 claim, retained for the record only — **withdrawn**: **Native Pointer ABI is CLOSED. ✅** The precise, evidence-backed claim: **"UR now has an independently-proven Native Pointer ABI, and can hold and pass native pointers from external libraries safely, within defined bounds."** This is explicitly **not** a claim that any specific library (ONNX, OpenCV, ROS2) is supported:

| Capability | Status |
|---|---|
| SQLite3 scalar Native FFI | 🟢 CLOSED |
| Native Pointer ABI | 🔴 **WITHDRAWN** (GATE-026 D4): `nativeptr` may be held inside UR; passing it to any FRI call is rejected before foreign execution |
| ONNX Runtime library loading (`dlopen`/`dlsym` against the real library) | 🟢 PROVEN |
| ONNX pointer/function-table integration (reading `OrtApiBase`'s own struct, calling a real API function through it) | 🟡 OPEN — a materially different, separate problem (external C struct layout, function-pointer-through-a-vtable), not attempted |
| OpenCV | ⚪ HOLD (no usable native entry point found in this environment) |
| ROS2 | ⚪ HOLD (not present in this environment) |
| Windows Native Pointer ABI | ⚪ NOT YET PROVEN (this closure is Linux-only, exactly as SQLite3's own was) |

Completing ONNX's own real API integration, or extending to OpenCV/ROS2/Windows, each requires its own separate Discovery and Gate — none is unlocked automatically by this closure.

---

## Native Integration — Architecture Gap Resolved / SQLite3 Reference Vertical Slice Closure

**Closure date:** 2026-08-30 (per Native Integration Discovery → SQLite3 Real-UR Invocation Spike → Architecture Design Gate → Implementation → Independent Review sequence)

**Background:** the "Advanced C++ Bindings, Rust FFI Bridge, urpm Build-From-Source, Real Native Integration" sub-phase (line 485 of this document) required, per its own stated closure criterion, proving a UR program can import, build, bind, and run a real native library — for SQLite3, OpenCV, ONNX Runtime, and ROS2. A live Spike confirmed the pre-existing gap: `interpret.ts`'s `"c"`-runtime manifest mechanism had no facility to link against any pre-compiled shared library, and `src/ffi/native/`'s own real `dlopen`/`dlsym` capability existed only in a test-only harness (`tests/ffi/native/harness-executor.ts`), never reaching `ur run`.

**Scope closed:** a new `"native"` manifest runtime was added to `src/cli/index.ts`/`src/interpreter/interpret.ts` (Frozen `src/shared/ir.ts` untouched), porting the already-proven `dlopen`/`dlsym`-generated-C-shim technique into production, for **SQLite3 on Linux only**.

**Closure criteria:**

- [x] Real UR program, real `manifest.json` (`runtime: "native"`), real `libsqlite3.so.0`, real `sqlite3_libversion_number()` symbol — genuine value (`3045001`) returned to UR and observed via `print()`, not inferred from exit code alone
- [x] A related, initially-misdiagnosed finding (exit code `137` appearing to be a process kill) resolved and closed: confirmed to be ordinary POSIX exit-code truncation (`3045001 mod 256 = 137`), reproduced identically via the already-approved `"c"` runtime, unrelated to this feature
- [x] Negative controls: nonexistent library → explicit `DLOPEN_FAIL` panic; nonexistent symbol → explicit `DLSYM_FAIL` panic — no silent success
- [x] Regression: `cmath` (C), `sq` (Python, genuinely tested), `ur_stdlib_string` (JavaScript), TypeScript — all unchanged
- [x] Frozen Baselines (`src/shared/ir.ts`, `src/shared/builtins.ts`, `src/shared/runtime-table.ts`, `runtime/ur_runtime.c`, `src/backend/wasm/wasm-cfg-validation.ts`) — confirmed byte-identical, both by the implementer and independently by a reviewer using freshly-authored, non-reused fixtures
- [x] Independent Review completed without modifying `src/` or `tests/`

**`IRFunction.external.runtime`'s TypeScript type in `src/shared/ir.ts` does not yet list `"native"`** — logged as **Technical Debt, Low Priority** (a static-analysis-only gap; `tsx`-based execution, which is how this CLI actually runs, is unaffected). Not treated as a defect, not used to justify touching this Frozen file without its own separate authorization.

**Native Integration is CLOSED / GREEN for the SQLite3 Linux reference vertical slice ONLY. ✅** This is explicitly **not** a declaration that "Native FFI" broadly is supported:

| Target | Status |
|---|---|
| SQLite3 (Linux) | 🟢 GREEN / CLOSED |
| OpenCV | ⚪ NOT STARTED |
| ONNX Runtime | ⚪ NOT STARTED |
| ROS2 | ⚪ NOT STARTED |
| Windows Native FFI | ⚪ NOT STARTED |
| Rust FFI | ⚪ OUT OF SCOPE (not attempted this round) |
| `urpm` build-from-source | ⚪ NOT STARTED |

Each of the above requires its own Gate and its own independent evidence before any claim of support — none is unlocked automatically by this closure.

---

## 3.1C — `print(int)` Partial Closure

**Closure date:** 2026-08-30 (per P1-3C Discovery/Design → Implementation → Independent Review → Closure Evidence sequence)

**Scope closed:** the `print(int)` vertical capability only — `UR print(int) → IR extern → WASM Import Section → WebAssembly.instantiate() → JS Host Runtime → observable stdout`.

**Closure criteria:**

- [x] WASM Import Section (binary section id 2) actually emitted, confirmed via `WebAssembly.validate()`
- [x] `print(int)` genuinely invokes a real JS host function, confirmed by captured output (not inferred from validity alone)
- [x] Multiple imports in one module work
- [x] Local function calls and imported calls coexist correctly in the same module (function/type index-shift math confirmed correct)
- [x] Behavioral equivalence with the C Backend — stdout content and exit code both compared, for the first time in this project's history (previously only exit code was compared, per `WASM_BACKEND_SPEC.md` §8)
- [x] Undefined/unsupported external calls (`input()`, `free()`) still correctly rejected with `WASM1004`, proving the widened acceptance check is scoped, not universal
- [x] `src/shared/ir.ts`, `src/shared/builtins.ts`, `src/shared/runtime-table.ts`, `runtime/ur_runtime.c`, `src/backend/wasm/wasm-cfg-validation.ts` — all confirmed byte-identical to pre-implementation state (MD5)
- [x] A stale pre-existing test assertion (`print(5)` must be rejected — correct before this closure, false after) found via Independent Review and corrected: split into a positive case (print(int) now succeeds) and a negative control (`free(input())` still correctly rejected), preserving the test's original verification purpose rather than deleting it
- [x] 85 real test cases programmatically extracted from `tests/backend/wasm/emit-wasm.test.ts` (not hand-picked) — 85/85 passing against the patched emitter
- [ ] **NOT closed**: full `vitest run tests/backend/wasm` across all 12 test files — blocked by this environment's inability to install `vitest` (`403 Forbidden`, no network access), disclosed at every stage rather than reported as done. 3 of 12 files independently spot-checked; 1 of 12 confirmed structurally out-of-scope by inspection; 8 of 12 not re-run.

**`print(int)` is CLOSED / PROVEN. ✅** `input`, `free`, and the string/runtime-ABI import-boundary design remain explicitly **NOT IMPLEMENTED / NOT DESIGNED** — not silently folded into this closure. **3.1C as a whole is NOT closed** and remains 🟡 OPEN/PARTIAL pending those items and the full 12-file regression follow-up (to be run when a `vitest`-capable environment is available, as a verification step — not as a re-opening of the already-proven `print(int)` capability, unless it surfaces a genuine regression).

---

## LSP Server Phase 4 — Formal Closure

**Closure date:** 2026-06-17

**Closure criteria:**

- [x] `src/lsp/protocol.ts`              — LSP 3.17 types (Position, Range, Diagnostic, Completion, Hover, Tokens, Rename)
- [x] `src/lsp/position-mapper.ts`       — bidirectional offset↔Position, UTF-16 aware, CRLF safe
- [x] `src/lsp/text-document-manager.ts` — open/close/incremental edit lifecycle
- [x] `src/lsp/workspace-manager.ts`     — file registry, exclusion patterns
- [x] `src/lsp/uri-resolver.ts`          — file:// URI ↔ filesystem path
- [x] `src/lsp/diagnostic-engine.ts`     — compiler diagnostic → LSP Diagnostic
- [x] `src/lsp/symbol-table.ts`          — declarations, references, cross-file, builtins
- [x] `src/lsp/hover-provider.ts`        — Hover (symbols + builtins + keywords)
- [x] `src/lsp/navigation-providers.ts`  — Go To Definition + Find References
- [x] `src/lsp/completion-engine.ts`     — context-aware completion (general/type/import)
- [x] `src/lsp/advanced-providers.ts`    — Rename Symbol + Signature Help
- [x] `src/lsp/highlight-provider.ts`    — Semantic Tokens + Workspace Symbols
- [x] `src/lsp/incremental-bridge.ts`    — connected to IncrementalPipeline (workspace snapshot model)
- [x] `src/lsp/lsp-server.ts`            — LspServer orchestrator + ServerCapabilities
- [x] `src/lsp/index.ts`                 — public API
- [x] 131 / 131 tests passing
- [x] 0 TypeScript errors (strict mode)
- [x] Incremental cache validated: build #2 with identical content = 100% cache hit
- [x] Workspace snapshot model confirmed correct

**LSP Server Phase 4 is officially CLOSED. ✅**

---

## Incremental Compilation Phase 3 — Formal Closure (reproduced)

- [x] 106+ tests in `tests/incremental/incremental.test.ts`
- [x] ≥ 80% build-time reduction on unchanged rebuild (achieved 100%)
- [x] 0 TypeScript errors in `src/compiler/incremental/`

**Incremental Compilation Phase 3 is officially CLOSED. ✅**

---

## Sequencing (strict order — do not skip)

```
Phase 1.5  Module System + Import Resolver   src/module/                  ✅ DONE
Phase 2    urpm                              src/urpm/                    ✅ DONE
Phase 3    Incremental Compilation           src/compiler/incremental/    ✅ DONE
Phase 4    LSP Server                        src/lsp/                     ✅ DONE
Phase 5    Compiler Stabilization            tests/stress/ regression/
Phase 6    Stable ABI + FFI                  src/ffi/
Phase 7    IDE Tooling                       VS Code extension
Phase 8    Registry / Package Ecosystem
Phase 9    Backend Expansion (x86-64, ARM64, LLVM)
Phase 10   Standard Library                  stdlib/
Phase 11   Formal Specification              /spec
```

---

## RC2 Exit Criteria

| Criterion              | Status    | Threshold |
|------------------------|-----------|-----------| 
| Frontend (1.1–1.5)     | ✅ DONE   | all phases complete |
| Type System            | ✅ DONE   | all built-in types, generics working |
| urpm                   | ✅ DONE   | install/remove/update/search/publish/verify/lock |
| Incremental Build      | ✅ DONE   | > 80% build-time reduction |
| LSP Server             | ✅ DONE   | Hover · Definition · References · Completion · Rename · Diagnostics · Semantic Tokens |
| Compiler Stabilization | ✅ DONE   | 1000+ fuzz, regression infra, crash resistance |
| Stable ABI + FFI       | ✅ DONE   | C/C++ interop, binding generator |
| Hardening Pass         | ✅ DONE   | 0 TS errors, 677/677 tests, 2 bugs fixed + regression-tested |
| Documentation          | 🔜 NEXT   | Language + Compiler specs |
| Coverage               | pending   | ≥ 95% (frontend/semantic/typesystem scope) |
| Stability Tests        | pending   | ≥ 5000 compiler + ≥ 5000 parser |
| Differential Tests     | pending   | ≥ 500 programs |
| Critical Bugs          | ✅        | zero |

---

## ❌ Permanently forbidden (do not implement before RC2 exit)

NeuralState · DNS · Explainability Runtime · Safety Contracts ·
Federated Learning Runtime · Probabilistic SSA · AI-Native Compiler
Extensions · Tensor Core

**Priority: Stability > Correctness > Tooling > Ecosystem > Future AI Features**

───────────────────────────────────────────────────────────────────────────────
## Phase 5 — Compiler Stabilization (CLOSED)

**Closure date:** 2026-06-18

### Architecture fixes applied (not test workarounds)

**Fix 1 — Topological Sort Direction (DependencyTracker)**

Prior:  `inDegree[X]` = number of files that import X (backward)
        Queue started from importers (files nothing imports)
        `importedBy` propagation → leaf deps never reached → false cycles

Fixed:  `inDegree[X]` = `|X.imports|` (number of deps X has)
        Queue starts from leaf dependencies (files that import nothing)
        Propagates through `importedBy` → correct build order: deps first
        Linear chain `a→b→c`: order = `[c, b, a]` ✅

**Fix 2 — Cache Lookup Semantics (Pipeline)**

Prior:  `if (cached && !toRecompile.has(path))` → hard override
        `toRecompile` bypassed cache completely
        Content-addressed caching was "disabled optimization"
        Restore-to-original always recompiled (never hit cache)

Fixed:  Cache lookup by hash is authoritative (Phase 3 Execution)
        `toRecompile` is a planning hint only (Phase 2 Build Plan)
        If `cache.get(fp, kind)` hits → serve from cache, regardless of plan
        Restore-to-original now hits cache (correct content-addressed behavior)

**Consequence of Fix 2 — Cascading Invalidation Refined**

Old model: changing `dep.ur` → all importers RECOMPILE (toRecompile hard override)
New model: changing `dep.ur` → importers are PLANNED for recompile, but
           their content hash is unchanged → cache hits → no actual recompilation

This is correct: if `mod0.ur` imports `mod9.ur` and mod9 changes, mod0's
source text is identical → same hash → same compiled artifact → cache serves it.
Only mod9 (whose hash actually changed) recompiles.

> ⚠️ **CORRECTED in Phase 6.5 (Hardening) — see below.** The reasoning above
> is wrong: "mod0's source text is identical → same compiled artifact" does
> NOT hold for any real compiler, because mod0's compiled output (types,
> resolved symbols, codegen) can depend on mod9's *semantic content*, not
> just on whether mod0's own bytes changed. This was a content-addressed-by-
> own-hash-only design that silently served stale artifacts for importers
> whenever a dependency changed without the importer's own text changing.
> The fix is detailed under Phase 6.5.

### Stability gates (all pass)

```
✅ Zero crashes           — 2000 fuzz runs
✅ Deterministic builds   — 50 instances, 0 mismatches
✅ avgRecompile < 20%     — actual: 1.0%
✅ cacheHitRate > 70%     — actual: 100% (content-addressed)
✅ Structural speedup     — 0% recompilation on stable builds
✅ Cache capacity safe    — 10k ops, 0 violations
```

**Phase 5 — Compiler Stabilization: ✅ CLOSED**

───────────────────────────────────────────────────────────────────────────────
## Phase 6 — Stable ABI + FFI — ✅ CLOSED (v27)

```
src/ffi/
  abi/            Stable type layouts, calling conventions, versioning + compat checker
  bindgen/        C header parser → AbiModule converter → UR/TypeScript emitter
  runtime/        Memory marshaling, Unicode string encode/decode, callback registry, safety checks
  urpm-native/    Native package resolution, ABI compatibility gating, linker flag generation
```

**Test results: 132/132 (100%)** — layout correctness across x64/ARM64/WASM32, ABI
breaking-change detection, real SQLite3-style and OpenCV-style header pipelines,
Unicode round-trips (including Arabic), signed/unsigned struct marshaling, and
urpm install/upgrade/link planning.

**TypeScript:** 0 errors (strict mode, full project).

Enables (once real bindings are generated against actual headers): OpenCV · SQLite ·
ONNX Runtime · ROS2 · LLVM · Python C-API.

───────────────────────────────────────────────────────────────────────────────
## Phase 6.5 — Hardening Pass (CLOSED)

**Closure date:** 2026-06-19

Scope per Hardening directive: no new features, fix any bug found in tests
or real use, write a regression test for every fix, keep 0 TypeScript
errors, keep all tests green.

**Audit result:** 0 TypeScript errors confirmed. Full suite run (677 tests
across 18 files, including 2 new regression files) — 2 real bugs found and
fixed, 1 flaky test hardened.

### Bug 1 — Dependency-only changes served a stale cached artifact (real, silent-corruption class)

`IncrementalPipeline.build()` looked up the build cache by a file's *own*
content hash before honoring `DependencyTracker`'s `toRecompile` set.
`DependencyTracker` correctly added transitive importers of a changed file
to `toRecompile`, but if an importer's own source text was byte-identical
to the previous build, its content hash was unchanged, so the cache lookup
hit and the pipeline served the OLD artifact — compiled against the
dependency's *previous* content — instead of recompiling. This is exactly
the "Fix 2" design from Phase 5 (see correction note above): caching solely
by a file's own hash cannot detect that one of its dependencies changed.

Two stress-test files had encoded this bug as expected behavior
("only leaf recompiles, importers from cache"); those assertions were
corrected to assert the right invariant (leaf change → leaf **and** all
transitive importers recompile).

**Fix:** the pipeline now computes which files entered `toRecompile` purely
via dependency propagation (not because their own content changed) and
forces those files to bypass the cache lookup entirely. Files whose own
content changed already miss the cache naturally (hash differs); newly
added files remain cache-eligible, preserving the legitimate
"restored-to-identical-prior-content" case.

**Regression test:** `tests/regression/dependency-cache-staleness.test.ts`

### Bug 2 — `hashContent` silently truncated to a 32-char digest

Documented and intended as a 64-hex-char digest, the implementation only
emitted 4 × 8-char segments (32 chars), and the two dropped segments were
derived from values already fully consumed by the kept ones — i.e. no
entropy was lost from the *output*, but the digest was half its documented
length, widening the collision surface for the build cache and dependency
fingerprinting (both keyed on this hash).

**Fix:** `hashContent` now mixes content through 8 independent FNV-1a lanes
(distinct prime/offset seeds) with a Murmur-style avalanche finalizer per
lane, emitting a genuine 64 hex characters, while staying pure JS (no
`node:crypto` — must run identically in Node, browsers, and WASM hosts) and
O(n).

**Regression test:** `tests/regression/fingerprint-hash-length.test.ts`

### Hardened (not a product bug) — flaky LSP latency test

`tests/stability/performance-baseline.test.ts` asserted
`workspace symbols search < 5ms` from a single `Date.now()`-bracketed
sample, which intermittently failed under sandbox scheduler/GC jitter.
Changed to median-of-7 samples, matching the `median()`-based pattern
already used elsewhere in the same file. Verified stable across repeated
full-suite runs after the change.

### Test infrastructure note

This sandbox has no network access to install `vitest` from the registry.
The pre-existing `run-tests.ts` (a minimal vitest-compatible runner built
on `tsx`) was extended with `toBeCloseTo`, `toHaveLength`, and `toMatch`
matchers, and its `toEqual` was corrected to match real vitest/Jest
semantics (a key with value `undefined` is treated as equivalent to an
absent key). These are test-harness fixes only; `npm test` continues to
invoke real `vitest run` per `package.json`.

**Phase 6.5 — Hardening Pass: ✅ CLOSED**

───────────────────────────────────────────────────────────────────────────────
## Phase 7 — Native Ecosystem Hardening

### Sub-phase: C++ Bindings + Exception Mapping (RC1) — ✅ CLOSED, FROZEN

**Closure date:** 2026-06-20

**Agreed scope** (per engineering directive, recorded verbatim as the
scope boundary for this RC): full namespace support, basic classes,
function overloading, simple template instantiation (basic types and
common templates), constructors/destructors as needed, continuous
verification against g++/clang for every new case, a regression test for
every discovered bug, and explicit documentation of what's in/out of
scope — deliberately not covering SFINAE, Concepts, multiple inheritance,
or RTTI in this RC.

**Pipeline (frozen as the official interface — see CPP_BINDING_PIPELINE.md):**

```
C++ Header → Header Parser → Declaration Model → Binding Plan
  → Itanium Mangler → ABI Validation → Binding Generator /
  Exception Trampoline → g++ Compilation → Dynamic Loading
  → UR Runtime → Exception Mapping → UR Diagnostics
```

**Modules delivered:**
- `src/ffi/bindgen/cpp/itanium-mangle.ts` — real Itanium C++ ABI mangler,
  g++ 13.3.0-verified (33/33 tests). See CPP_MANGLE_SPEC.md.
- `src/ffi/bindgen/cpp/cpp-header-parser.ts` — namespace/class/ctor/dtor/
  method/template parser (21/21 tests). See CPP_SUPPORTED_FEATURES.md.
- `src/ffi/bindgen/cpp/cpp-converter.ts` — Binding Plan: parsed decls +
  explicit template instantiation requests → mangled, public-only
  bindings (9/9 tests). See CPP_BINDING_GENERATOR.md.
- `src/ffi/bindgen/cpp/cpp-exceptions.ts` — exception-safe `extern "C"`
  trampoline generator, full standard exception hierarchy + `catch(...)`
  safety net (12/12 unit tests). See CPP_EXCEPTION_MAPPING.md.

**Verification standard met — no simulation anywhere in the closing proof:**
- `tests/ffi/cpp/cpp-real-native-e2e.test.ts` — full pipeline driven for
  real: real header parsed, real binding plan built (incl. a `Box<int>`
  template instantiation), real `g++`-compiled `.so`, every constructor/
  destructor/const-method/static-method/template-method called purely via
  `dlopen()`+`dlsym()` using the pipeline's own predicted mangled names,
  with computed numeric results verified correct.
- `tests/ffi/cpp/cpp-exception-mapping-e2e.test.ts` and
  `tests/ffi/cpp/cpp-exception-mapping-full-matrix-e2e.test.ts` — all 7
  required exception cases (`std::runtime_error`, `std::logic_error`
  thrown as its base type, `std::invalid_argument`, `std::out_of_range`,
  `std::exception` thrown as its base type, a custom exception deriving
  from `std::exception`, and a genuinely unknown thrown value not derived
  from `std::exception` at all) verified through real g++ compilation,
  with a direct side-by-side comparison against calling the real C++
  method with no trampoline involved, for both the success and throwing
  paths.

**Test totals at closure: 755/755 passing, 0 TypeScript errors (`src/`
scope).** Both real-g++ end-to-end test files skip gracefully (not fail)
in environments without a C++ toolchain in `PATH`; the toolchain-
independent unit tests remain the always-on primary gate.

**Regression ledger:** see CPP_MANGLE_SPEC.md (3 mangler bugs),
CPP_BINDING_GENERATOR.md / cpp-header-parser tests (1 parser bug: private
data members originally cascaded parse errors instead of being skipped),
and CPP_EXCEPTION_MAPPING.md (1 design gap: the original exception
cascade had no `catch(...)` safety net for non-`std::exception`-derived
throws, fixed by adding `UR_UNKNOWN_THROWN_VALUE`).

**Frozen as of this closure:** the Binding Plan API (`BoundClass`,
`BoundMethod`, `BoundFunction` shapes), the Itanium mangler's public
function signatures, and the Exception Mapping API (`UrErrorCode` values,
catch-clause order, trampoline calling convention). Any behavior change
to these requires a new regression test demonstrating the change before
merging — this is not a process suggestion, it's the closure condition
for this sub-phase remaining valid.

### Sub-phase: SQLite3 Integration + Generic Native FFI Loader — ✅ CLOSED

**Closure date:** 2026-06-23

**Scope:** Generic Native FFI Loader infrastructure + SQLite3 as the first real production library driver, including the urpm `cmdCreateProject` scaffold command. End-to-end from UR Source is explicitly deferred (UR Frontend not in this project slice).

**New infrastructure delivered:**
- `src/ffi/native/types.ts` — core types: `NativeArg`, `NativeCallResult`, `NativeCall`, `IPlatformExecutor`, `INativeDriver`, platform-portable contracts
- `src/ffi/native/loader.ts` — `NativeFfiLoader`: library cache, ABI version verification, diagnostic logging, `bind()` for typed drivers, `unloadAll()` reverse-order teardown
- `src/ffi/native/platform-executors.ts` — `LinuxExecutorStub`, `MacOsExecutorStub`, `WindowsExecutorStub`, `WasmExecutorStub` + `detectPlatform()`
- `tests/ffi/native/harness-executor.ts` — real gcc-compiled C harness executor (in tests/ because it uses Node APIs)
- `tests/ffi/native/sqlite3-driver.ts` — `Sqlite3Driver` implementing `INativeDriver<Sqlite3Api>`; typed API for all 27 SQLite3 functions
- `tests/ffi/native/fixtures/sqlite3.h` — stable SQLite3 3.45.1 public C API header
- `tests/ffi/native/fixtures/sqlite3_adapter.c` — C adapter flattening `**ppDb`/`**ppStmt` double-pointer out-params
- `src/urpm/commands.ts` — `cmdCreateProject()` scaffold: database / vision / inference / robotics templates
- `SQLITE_INTEGRATION.md` — full design, architecture, test coverage, limitations

**Root-cause bug fixed during this sub-phase:**
`parseTypeRef()` in `src/ffi/bindgen/c-header-parser.ts` was a single-token parser — `long long`, `unsigned long`, `const void*`, etc. were silently dropped or caused parse errors. Rewritten as a proper C type-specifier-collection loop (15 regression tests covering every valid combination + 3 invalid ones, plus the full 27-function SQLite3 header parse test). `builtinRegistry()` in `converter.ts` extended to cover all new canonical type names.

**CRUD verification ladder (13 end-to-end tests, 0 simulation):** version/ABI check, open, CREATE TABLE, INSERT (parameter binding), SELECT (column types/values), UPDATE/DELETE (changes()), error paths (invalid SQL, NOT NULL violation, readonly open), NULL values, UTF-8 round-trip (Arabic/Japanese/emoji), transactions/ROLLBACK, resource cleanup. All verified with real gcc compilation against real libsqlite3.so.0 (3.45.1).

**Test totals at closure: 817/817 passing, 0 TypeScript errors (src/ scope).**

**Frozen APIs (as of this closure):**
- `NativeArg` / `NativeCallResult` / `NativeCall` shape
- `IPlatformExecutor` interface
- `INativeDriver<T>` interface
- `NativeFfiLoader` public methods (load, bind, execute, unload, unloadAll)
- `checkVersionCompatibility` version policy (major mismatch → error, minor → warn)
- `cmdCreateProject` command signature

### Sub-phase: Advanced C++ Bindings, Rust FFI Bridge, urpm Build-From-Source, Real Native Integration — 🔜 NEXT

```
- C++ bindings: inheritance (single, then multiple), RTTI evaluation,
  broader template coverage within the agreed "common templates" scope
- Rust FFI bridge: repr(C) struct/enum mapping, String/&str and slice
  conversion, Result<T,E> error mapping, ownership/lifetime documentation
  (codegen-level only — no Rust toolchain available in the current
  sandbox to compile-verify generated Rust the way g++ verifies C++)
- urpm build-from-source: detect and drive CMake/Meson/Make/Ninja,
  build-output caching and reuse
- Real native integration: SQLite3 (real .so present in-sandbox, header
  authored from the stable public C API), ROS2/OpenCV/ONNX Runtime
  (environment-dependent — see STATUS_REPORT.md for what's available in
  the current sandbox vs. what requires network/package access)
```

**Closure criterion for this sub-phase (per engineering directive):** not
closed until a UR user can import a real C++ library, have urpm build it
automatically, have bindings generated automatically, run the library
from inside UR, and have end-to-end tests pass against the real library —
for SQLite3, OpenCV, ONNX Runtime, and ROS2 specifically.

**ممنوع حالياً (دون تغيير):** AI Native Features · NeuralState · DNS · DLL ·
Explainability Runtime · Safety Contracts · Swarm Intelligence · Robotics/Autonomous/
Trading Libraries — مؤجلة لما بعد RC1.

───────────────────────────────────────────────────────────────────────────────
## Frontend Successfully Restored from RC2 — ✅ CLOSED

**Closure date:** 2026-06-28

**Decision:** Lexer and Parser written fresh against `UR_LANGUAGE_SPEC_1_0.md`
(Option د/D — rejected both reusing RC2's incompatible-syntax Parser as-is,
and building a syntax-translation shim, since either path would have meant
maintaining two parsers). AST frozen as a ~90%-RC2-compatible contract;
Semantic Analyzer, Type System, and Module System restored from RC2 with
zero logic changes.

**Test total: 1066/1066, 0 TypeScript errors.** 160 new tests (92 Lexer +
50 Parser + 18 full-pipeline Integration, Arabic and English).

See STATUS_REPORT.md SECTION 2E and CHANGELOG.md for full detail, including
the two regression bugs found and fixed during integration (Arabic
diacritic tokenization; a resulting Parser infinite-loop vulnerability,
now closed with defense-in-depth progress guards).

**This unblocks the long-standing closure criterion below** — a real UR
program can now be lexed, parsed, and semantically checked. The next
concrete milestone is connecting this Frontend to `src/compiler/incremental/`
and `src/ffi/` to run a real UR program's SQLite3 calls end-to-end,
with zero simulation, exactly as originally specified:

```
UR Source → Frontend → Semantic → Type System → Module System
   → Code Generation → FFI → SQLite3 (real) → Results
```

───────────────────────────────────────────────────────────────────────────────
## Tier-2 Primitive Types — 🔜 DEFERRED (independent, scoped item) — CORRECTED: `byte` was subsequently implemented, separately from Tier-2
───────────────────────────────────────────────────────────────────────────────

**Status update (per Item 3 documentation unification)**: this
section originally listed `byte` alongside the genuine Tier-2 ABI
types (`i8`...`f64`) as jointly deferred. **`byte` was subsequently
implemented** (Tier 1, general-purpose, per `UR_LANGUAGE_SPEC_1_0.md`
§6.1's own framing) — `PrimitiveKind` now includes `"Byte"`,
`type-env.ts`'s `LOWERCASE_PRIMITIVE` table includes it, and
`isAssignable` in `compatibility.ts` includes an `Int → Byte` rule.
Confirmed directly, tested (`tests/backend/wasm/emit-wasm.test.ts`'s
"byte" describe block; `examples/byte_pixel.ur`), and documented
(`STDLIB_API_FREEZE_CHECK.md` marks it Frozen).

**The genuine Tier-2 ABI types (`i8, i16, i32, i64, u8, u16, u32, u64,
f32, f64`) remain correctly, deliberately deferred** — but the
reasoning has since been formalized as `ADR_1_TIER2_TYPES_DECISION.md`:
these are FFI/ABI-only by design (already fully implemented in
`src/ffi/abi/`), not intended as general-purpose UR types at all. This
is a closed architectural decision, not an open TypeSystem-extension
item the way it was originally framed below (historical text
preserved for the record; the "why deferred" reasoning below no
longer reflects the current, ratified decision for these 10 names —
see ADR-1 for the current, authoritative reasoning).

**Status (historical, for the remaining Tier-2 names only):** explicitly deferred, not started. Not a bug, not blocking Level 1
closure.

**What's deferred:** `i8, i16, i32, i64, u8, u16, u32, u64, f32, f64, null` (NOT `byte`, corrected above — separately re-verified directly this round: `null` still correctly produces `TY1001`, genuinely still deferred, no staleness)
have no corresponding `PrimitiveKind` in `src/compiler/typesystem/types.ts`.
Any UR program annotating a value with one of these currently reports
`TY1001 unknown type name`, even though `UR_LANGUAGE_SPEC_1_0.md` §6.2
defines them as valid ABI-precise types.

**Why deferred rather than fixed now (historical reasoning — see ADR-1 for the current, authoritative decision):** adding these requires extending
`PrimitiveKind` itself (now `"Int" | "Float" | "Bool" | "Char" |
"String" | "Byte"` — updated from the original text's own stale list,
which predated the `byte` fix), plus new `isAssignable`/`binaryOpResultType` compatibility
rules for cross-width integer/float operations. This is a genuine
TypeSystem extension, not a casing/normalization fix — extending it now,
before Level 1 (Lexer/Parser/AST/Semantic/TypeSystem/Module) is fully
closed and reviewed, was explicitly rejected per engineering review.
**Superseded by ADR-1**: this is no longer merely "deferred pending
review" — it is a closed decision that these 10 names are FFI-only,
permanently, not a temporary TypeSystem gap awaiting extension.

**Explicitly NOT touched during this deferral (for the remaining Tier-2 names — `byte` WAS touched, see above):**
- `src/compiler/typesystem/types.ts` — `PrimitiveKind` unchanged for these 10 names (Byte was added)
- `src/compiler/typesystem/compatibility.ts` — unchanged for these 10 names (an Int→Byte rule was added)
- `src/compiler/typesystem/type-env.ts` — the `LOWERCASE_PRIMITIVE`
  translation point added for tier-1 casing is NOT extended to these
  10 tier-2 names; they still correctly fall through to `TY1001`

**Regression coverage:** `tests/compiler/typesystem/typesystem.test.ts`
— the original "DEFERRED: tier-2 ABI types" test was split into two
during the `byte` fix: one test confirming `i32` (and the rest of
genuine Tier-2) still correctly produces `TY1001`; a separate test
confirming `byte` now succeeds. Both enforced directly, not just
documented.

**Prerequisite for un-deferring:** Level 1 (Lexer, Parser, AST, Semantic,
TypeSystem, Module System) fully closed and reviewed. Tier-2 support is
its own scoped follow-up phase, to be sequenced alongside or after
Code Generation, since its only real consumer is the FFI/ABI boundary.

───────────────────────────────────────────────────────────────────────────────
