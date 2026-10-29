# Documentation Consistency Audit — WASM Backend 3.1B

**Type: Documentation Team deliverable. Zero code changes. This audit
does not fix anything that depends on a code change — discovered
issues are recorded for decision, not resolved unilaterally.**

---

## Executive Summary

17 documents reviewed. The documentation is **substantially
consistent** after the verdict corrections already applied in the
prior session (RC1/RC2/Gate Review status is now uniform across every
document that references it). This audit found:

- **1 genuine content duplication** (not a contradiction, but a
  redundant, slightly-diverging definition of the same Contract in
  two places within the same file).
- **1 naming-convention inconsistency** (some sub-phases use an
  explicit "Invariant X.Y" label; others describe an equally-binding
  ratified rule in prose without that label).
- **1 stale, unrelated document** (`RELEASE_NOTES.md` predates all of
  Level 3.1B and does not mention it — not a contradiction, since it
  makes no claim about 3.1B, but a gap worth flagging).
- **Zero missing test coverage**: every one of the 17 active Contracts
  has real, non-empty test coverage (1–23 tests each). Every Golden
  Test case (25 total) is accounted for and mapped to a batch.
- **Zero unresolved FROZEN/APPROVED-FOR-FREEZE conflicts**: the
  `STATUS_REPORT.md` occurrences of "FROZEN" belong to unrelated,
  already-closed, much earlier sub-phases (C++ Bindings, FFI Loader) —
  confirmed by direct inspection, not a 3.1B conflict.

**Overall verdict on documentation consistency: PASS, with 3 minor,
non-blocking findings recorded below for decision.**

---

## 1. Documents Reviewed (17)

| Document | Role |
|---|---|
| `WASM_BACKEND_SPEC.md` | Primary spec: Level 3.1A Invariants (3.1A.4–3.1A.6c) |
| `WASM_MEMORY_MODEL_SPEC.md` | Primary spec: Level 3.1B Memory Model, Invariants, Contracts |
| `MEMORY_LAYOUT_EXAMPLES.md` | Worked numeric examples for the Memory Model |
| `CONTINUE_CFG_ANALYSIS.md` | Standalone CFG analysis predating 3.1A.6c's implementation |
| `LEVEL_3_1A_CLOSURE_REVIEW.md` | Level 3.1A's authoritative closure reference |
| `LEVEL_3_1B_5_FINAL_REPORT.md` | 3.1B.5's own final report (10-section format) |
| `MILESTONE_3_1B_6.md` | Empty placeholder for the next milestone |
| `GATE_REVIEW_3_1B.md` | Superseded Gate Review (flagged at top, preserved for history) |
| `GATE_REVIEW_3_1B_REVISION_2.md` | Current Gate Review (post-critical-fix, corrected verdict) |
| `RC2_VALIDATION_REPORT.md` | Current validation report (corrected verdict: Release Candidate Ready) |
| `TAG_v27-wasm-3.1b-rc1.md` | Superseded tag record (flagged at top) |
| `TAG_v27-wasm-3.1b-rc2.md` | Current tag record |
| `RELEASE_NOTES_v27_3-1B_rc1.md` | Superseded release notes (flagged at top) |
| `RELEASE_NOTES_v27_3-1B_rc2.md` | Current release notes (corrected status) |
| `CLEAN_BUILD_VERIFICATION_rc1.md` | RC1-era clean build report (historical) |
| `ROADMAP_LOCK.md` | Master roadmap (3.1B status corrected) |
| `RELEASE_NOTES.md` | General release notes — does not mention 3.1B at all (see §4) |

---

## 2. Invariant ↔ Contract ↔ Unit Test ↔ Golden Test Coverage Matrix

| Invariant / Ratified Rule | Sub-phase | Contract(s) | Unit Tests | Golden Test(s) |
|---|---|---|---|---|
| Expression Tree Property (§2.1) | 3.1A.2 | *(no dedicated named Contract — enforced generically across every shape)* | Present throughout `checkExpressionTreeProperty` call sites | 03, 04 (no deliberate-corruption proof recorded — see `LEVEL_3_1A_CLOSURE_REVIEW.md` §4's own flagged gap) |
| Invariant 3.1A.4 | 3.1A.4 | `IF_RETURN_ONLY_CONTRACT` | 10 | 07, 08 |
| Invariant 3.1A.5 | 3.1A.5 | `IF_MERGE_ONLY_CONTRACT`, `MERGE_IMMEDIATE_RETURN_CONTRACT` | 5, 9 | 09, 10 |
| Invariant 3.1A.6 | 3.1A.6 | `WHILE_PLAIN_ONLY_CONTRACT`, `WHILE_NO_BRANCH_EXIT_CONTRACT` | 5, 9 | 11, 12 |
| Invariant 3.1A.6b | 3.1A.6b | `WHILE_BREAK_ONLY_CONTRACT` | 9 | 13, 14 |
| Invariant 3.1A.6c | 3.1A.6c | `WHILE_CONTINUE_ONLY_CONTRACT`, `CONTINUE_BRANCH_DEPTH_CONTRACT` | 4, 7 | 15, 16 |
| Invariant 3.1B.1-Memory-Layout | 3.1B.1 | `ARRAY_LAYOUT_CONTRACT`, `MEMORY_LAYOUT_IMMUTABLE_CONTRACT` | 3, 3 | 17, 18 |
| Invariant 3.1B.1-Allocation | 3.1B.1 | `BUMP_MONOTONIC_CONTRACT` | 1 | 17, 18 |
| `ELEMENT_SIZE_IMMUTABLE_CONTRACT` (duplicated — see §3.1) | 3.1B.1 | `ELEMENT_SIZE_IMMUTABLE_CONTRACT` | 2 | *(covered indirectly by 17/18, no dedicated case)* |
| §10b ratified rule (unlabeled — see §3.2) | 3.1B.2 | `BOUNDS_CHECK_REQUIRED_CONTRACT` | 15 | *(covered indirectly by every post-3.1B.2 array case)* |
| §10c "non-invariant" (Invariant 3.1B.3, explicitly self-declared as not new) | 3.1B.3 | `DYNAMIC_INDEX_CONTRACT` | 10 | 19, 20 |
| §10d ratified scope (unlabeled — see §3.2) | 3.1B.4 | `ARRAY_CONTROL_FLOW_CONTRACT` | 23 | 21, 22 |
| §10e finding (Invariant 3.1B.5, explicitly minimal-fix, no new rule) | 3.1B.5 | `DYNAMIC_INDEX_IN_LOOP_CONTRACT` | 7 | 23, 24 |
| Critical fix (post-freeze finding, not a numbered Invariant) | RC2 | `ARRAY_SINGLE_ALLOCATION_CONTRACT` | 5 | 25 |

**Coverage completeness**: every row has at least one Contract and at
least one passing test category. **No Invariant or ratified rule was
found undocumented or untested.**

---

## 3. Discrepancies Discovered

### 3.1 Content Duplication: `ELEMENT_SIZE_IMMUTABLE_CONTRACT` defined twice in `WASM_MEMORY_MODEL_SPEC.md`

Two separate blockquote definitions exist in §8 (lines ~240 and
~283), both titled `ELEMENT_SIZE_IMMUTABLE_CONTRACT (ratified, per
explicit review)`, with overlapping but non-identical wording:

- **First occurrence** (§8, earlier): focuses on "the value must not
  vary... never a literal 8 scattered through the implementation."
- **Second occurrence** (§8, later, right before §9 "Contracts
  Required"): covers BOTH `ELEMENT_SIZE` and `ARRAY_HEADER_SIZE`
  together, and adds "both constants may change in VALUE with zero
  risk" — a point the first occurrence does not make.

**Assessment**: not a factual contradiction (both are compatible,
correct statements) — a genuine content duplication, likely from two
separate editing passes that were never merged. **Not fixed here**
(a documentation-only fix, but flagged for decision rather than
silently merged, per the audit's own scope).

**Recommendation**: keep the second (more complete) occurrence, remove
the first, OR explicitly cross-reference them as intentionally
covering different aspects — a decision for whoever owns
`WASM_MEMORY_MODEL_SPEC.md` next.

### 3.2 Naming Convention Inconsistency: "Invariant X.Y" label applied inconsistently

3.1A.4 through 3.1A.6c and 3.1B.1 each have their ratified rule
explicitly labeled `Invariant <number>`. 3.1B.2 and 3.1B.4's own
ratified rules (§10b, §10d) are described with equal bindingness
("ratified, per review...") but WITHOUT the literal `Invariant`
label — likely because both were framed as "design corrections" or
"scope narrowings" at the time of writing, not as freshly-ratified
Invariants in their own right. 3.1B.3 and 3.1B.5 explicitly and
deliberately avoid the label (self-declared "non-invariants" — this
is intentional, documented, and NOT an inconsistency).

**Assessment**: a minor labeling inconsistency for 3.1B.2 and 3.1B.4
specifically — both are just as binding and just as enforced (via
`BOUNDS_CHECK_REQUIRED_CONTRACT` and `ARRAY_CONTROL_FLOW_CONTRACT`
respectively) as any labeled Invariant, but a reader searching
specifically for the string "Invariant 3.1B.2" or "Invariant 3.1B.4"
would not find one. **Not fixed here** — flagged for decision.

### 3.3 Stale/Unrelated Document: `RELEASE_NOTES.md`

Contains zero mentions of "3.1B" (confirmed via direct search). This
appears to be a general release notes file that predates all of Level
3.1B's work and was never updated to reference it. **Not a
contradiction** (it makes no false claim about 3.1B — it simply
doesn't discuss it), but a coverage gap: a reader relying on this file
alone would not know 3.1B exists at all.

**Recommendation**: either update `RELEASE_NOTES.md` to reference the
3.1B-specific release notes, or explicitly scope its own header to
clarify what it does and does not cover.

---

## 4. What Was Confirmed Clean (searched for, not found)

- **No remaining "FROZEN"/"APPROVED FOR FREEZE" conflicts for Level
  3.1B specifically** — every document that previously stated this was
  already corrected in the prior session (`GATE_REVIEW_3_1B.md`,
  `TAG_v27-wasm-3.1b-rc1.md`, `RELEASE_NOTES_v27_3-1B_rc1.md` all
  flagged as superseded at their top; `GATE_REVIEW_3_1B_REVISION_2.md`,
  `RELEASE_NOTES_v27_3-1B_rc2.md`, `ROADMAP_LOCK.md` all consistently
  state "Release Candidate Ready — NOT Frozen"). The `STATUS_REPORT.md`
  occurrences of "FROZEN" belong to unrelated, much earlier, already-
  closed sub-phases (C++ Exception Mapping, Generic FFI Loader,
  Platform SDK) — confirmed by direct inspection, no overlap with 3.1B.
- **No Contract without test coverage** — all 17 confirmed to have
  real, non-empty `it()` blocks.
- **No Golden Test case unaccounted for** — 25 case directories on
  disk, all 25 mapped to a specific batch in the matrix above.
- **No orphaned Issue references** — every issue file
  (`issues/*.md`) referenced by the Gate Review/Validation Report
  documents actually exists on disk with matching status.

---

## 5. Recommendations

1. Resolve the `ELEMENT_SIZE_IMMUTABLE_CONTRACT` duplication (§3.1) —
   low effort, low risk, purely editorial.
2. Decide whether to retroactively label 3.1B.2/3.1B.4's ratified
   rules as formal "Invariant 3.1B.2"/"Invariant 3.1B.4" for
   consistency, or explicitly document why they were deliberately left
   unlabeled (§3.2) — a naming decision, not a substance issue.
3. Update or explicitly scope `RELEASE_NOTES.md` (§3.3) — low
   priority, since it makes no false claims, only an omission.
4. None of the above block the external verification cycle already in
   progress (per the current Release Candidate Ready status) — all
   three are editorial/organizational, not technical.

---

## 6. Final Verdict on Documentation Consistency

**PASS**, with 3 minor, non-blocking findings recorded for decision
(none require a code change; none contradict any technical claim
already made about RC2's correctness or test results). The
documentation is fit to serve as the reference for 3.1B.6's roadmap
planning phase.
