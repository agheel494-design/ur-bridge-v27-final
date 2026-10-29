# Documentation Fixes — Exact Diffs

**No `git` repository exists in this environment (confirmed:
`fatal: not a git repository`), so no commit hash or automated `git
diff` can be produced. The exact before/after text for all 4 fixes
below is reproduced verbatim, exactly as applied, for direct review.**

---

## Fix 1: `WASM_BACKEND_SPEC.md` — Feature Matrix corrected

**File**: `WASM_BACKEND_SPEC.md`
**Section**: `## 0. Backend Feature Matrix`

### Before

```markdown
## 0. Backend Feature Matrix (ratified — prevents any future dispute about sub-phase scope)

| IR feature | 3.1A | 3.1B | 3.1C |
|---|---|---|---|
| `const` (int) | ✅ | ✅ | ✅ |
| `const` (float) | ❌ | ✅ | ✅ |
| `binop` (int arithmetic/comparison) | ✅ | ✅ | ✅ |
| `binop` (float) | ❌ | ✅ | ✅ |
| `unop` (`neg`/`not`) | ✅ | ✅ | ✅ |
| Local variables (`IRLocalSlot`, scalar) | ✅ | ✅ | ✅ |
| `if`/`else` | ✅ | ✅ | ✅ |
| `while`/`break`/`continue` | ✅ | ✅ | ✅ |
| `function` declaration/`call` (intra-module) | ✅ | ✅ | ✅ |
| `return`/`return_void` | ✅ | ✅ | ✅ |
| Arrays (`array_load`/`array_store`) | ❌ | ✅ | ✅ |
```

### After

```markdown
## 0. Backend Feature Matrix (ratified — prevents any future dispute about sub-phase scope)

**Corrected per direct verification (not aspirational planning): the
`✅`/`❌` marks below reflect ACTUAL, CONFIRMED Backend behavior as of
RC2, checked directly against the shipped code, not a forward-looking
plan for when each feature might eventually land. Float support
(`const`/`binop`) and `unop` (`neg`/`not`) were never implemented in
any 3.1A or 3.1B batch — confirmed directly: `return 3.5` and `return
-x` are both rejected today with `WASM1001` ("floats are a later
sub-phase" / "instruction kind 'unop' is not supported yet"). The
prior version of this table incorrectly marked both as `✅` for 3.1B,
which was never true — corrected here, not implemented, per this
project's standing discipline against adding features during a
freeze-preparation cycle.**

| IR feature | 3.1A | 3.1B (RC2, actual) | 3.1C (planned, not yet built) |
|---|---|---|---|
| `const` (int) | ✅ | ✅ | ✅ |
| `const` (float) | ❌ | ❌ *(not yet built — no target sub-phase assigned)* | *(planned)* |
| `binop` (int arithmetic/comparison) | ✅ | ✅ | ✅ |
| `binop` (float) | ❌ | ❌ *(not yet built — no target sub-phase assigned)* | *(planned)* |
| `unop` (`neg`/`not`) | ❌ *(not yet built — no target sub-phase assigned)* | ❌ *(not yet built)* | *(planned)* |
| Local variables (`IRLocalSlot`, scalar) | ✅ | ✅ | ✅ |
| `if`/`else` | ✅ | ✅ | ✅ |
| `while`/`break`/`continue` | ✅ | ✅ | ✅ |
| `function` declaration/`call` (intra-module) | ✅ | ✅ | ✅ |
| `return`/`return_void` | ✅ | ✅ | ✅ |
| Arrays (`array_load`/`array_store`) | ❌ | ✅ | ✅ |
```

### Evidence supporting this change (re-executable, independent of Vitest)

```typescript
// return 3.5  ->  WasmUnsupportedError: [WASM1001] main: only integer
//                 constants are supported yet (found 'const_float' ...)
// return -x    ->  WasmUnsupportedError: [WASM1001] main: instruction
//                 kind 'unop' is not supported yet (...)
```

---

## Fix 2: `WASM_MEMORY_MODEL_SPEC.md` — stale header corrected

**File**: `WASM_MEMORY_MODEL_SPEC.md`
**Section**: Document title/status header (opening lines)

### Before

```markdown
# WASM Memory Model — Design Specification (Level 3.1B, pre-implementation)

**Status: DESIGN ONLY. No implementation code exists yet, per explicit
review instruction ("لا تبدأوا التنفيذ بعد").** This document must be
ratified before any 3.1B.1 code is written — matching the exact
discipline that governed every 3.1A sub-phase (CFG/design first, direct
hand-built-module verification second, spec third, code fourth).
```

### After

```markdown
# WASM Memory Model — Specification (Level 3.1B — IMPLEMENTED, RC2)

**Status: IMPLEMENTED AND TESTED (corrected from a stale "DESIGN ONLY"
header — this document originated as a pre-implementation design
proposal for 3.1B.1, per explicit review instruction ("لا تبدأوا
التنفيذ بعد"), but every section below now describes RATIFIED,
SHIPPED, TESTED behavior through 3.1B.5 and the RC2 critical fix — not
a pending proposal.** The original design-first discipline this
document records (CFG/design first, direct hand-built-module
verification second, spec third, code fourth) is preserved as the
historical record of HOW each piece was built, not as a claim that the
building has not yet happened.
```

---

## Fix 3: `TAG_v27-wasm-3.1b-rc2.md` — internal contradiction ("frozen") corrected

**File**: `TAG_v27-wasm-3.1b-rc2.md`
**Section**: "Marks" bullet point

### Before

```markdown
- **Marks:** Level 3.1B (3.1B.1 through 3.1B.5), frozen per
  `GATE_REVIEW_3_1B_REVISION_2.md` (decision: **APPROVED**), with the
  critical array-reallocation bug fixed, tested, and verified.
```

### After

```markdown
- **Marks:** Level 3.1B (3.1B.1 through 3.1B.5) — **Release Candidate
  Ready** (per `GATE_REVIEW_3_1B_REVISION_2.md`'s corrected decision:
  the critical array-reallocation bug is fixed, tested, and verified,
  but formal freeze remains pending a genuine network-enabled
  verification run — NOT YET FORMALLY FROZEN).
```

### Also corrected in the same file (Standing Rule section, same contradiction pattern)

**Before**:
```markdown
## Standing rule from this point forward

Identical to `v27-wasm-3.1b-rc1`'s own rule: no commit against any
file covered by this tag's scope, for any reason other than fixing a
bug tracked by an existing or newly-opened Issue file, until a future
Gate Review explicitly lifts this freeze.
```

**After**:
```markdown
## Standing rule from this point forward

Identical in effect to `v27-wasm-3.1b-rc1`'s own rule, applied now to
this Release-Candidate-Ready state rather than to an actual freeze: no
commit against any file covered by this tag's scope, for any reason
other than fixing a bug tracked by an existing or newly-opened Issue
file, until the external verification cycle completes and a formal
Gate Review declares `APPROVED FOR FREEZE`.
```

---

## Fix 4: `ROADMAP_LOCK.md` — internal contradiction ("frozen as a baseline") corrected

**File**: `ROADMAP_LOCK.md`
**Section**: Level 3.1B status block

### Before

```
  │             (ALL CLOSED, gate-reviewed, frozen as a baseline. Standing discipline (identical to
  │              3.1A/IR/Runtime ABI/Level 2.9 Optimizer): no new features on 3.1B.1-3.1B.5 except to
  │              fix a confirmed, documented bug. 3.1B.6+ proceeds as a clean next phase.)
```

**(Note: this text appeared two lines below a line that already
correctly states `NOT YET FORMALLY FROZEN` for the same scope — a
direct, in-document contradiction.)**

### After

```
  │             (ALL CLOSED and gate-reviewed individually — but the overall 3.1B baseline
  │              they compose remains Release Candidate Ready, NOT frozen, per above, pending
  │              external verification. Standing discipline already applied regardless (identical
  │              to 3.1A/IR/Runtime ABI/Level 2.9 Optimizer): no new features on 3.1B.1-3.1B.5 except to
  │              fix a confirmed, documented bug. 3.1B.6+ proceeds as a clean next phase.)
```

---

## How to Independently Verify These Diffs

Since no git history exists, the only way to independently confirm
these are the actual current contents is to open each file directly
and compare against the "After" blocks above — every "After" block is
the exact, current, live content of its file as of this report.
