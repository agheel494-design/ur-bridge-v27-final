# UR Language — Specification ↔ Implementation Matrix

**Every cell below was verified this session by direct execution
(parse → typecheck → lower → backend) or direct source inspection —
none filled from memory, prior reports, or assumption.**

**Referencing convention (per explicit review)**: every finding cites
**File + Function**, not a bare line number, since line numbers shift
with every commit. A **Current line** is still given as a same-day
convenience pointer, explicitly marked as non-durable.

**Disclosed limitation, not worked around**: this environment has no
`.git` repository (confirmed directly: `git log -1` →
`fatal: not a git repository`), so **no commit hash can be cited for
any finding below** — this is a known, pre-existing limitation of this
project's own working environment throughout every session in this
conversation's history, not something introduced by this document.
Whoever imports this repository into real version control should
attach the commit hash covering this exact state to each reference
below, replacing the "Current line" pointers with durable
File+Function+Commit references.

---

## Reference Key Format

```
File:         <path from repo root>
Function:     <enclosing function/method name>
Current line: <line number AS OF THIS SESSION ONLY — not durable>
Commit:       NOT AVAILABLE (no git repository in this environment)
```

---

## 1. Core Statements

| Feature | Spec | Parser | Semantic | Lowering | Backend | Tests | Root Cause | Priority | Resolution Type |
|---|---|---|---|---|---|---|---|---|---|
| `import` | §5.2 | ✅ | not checked | not checked | not checked | not checked | — | — | — |
| `function` decl | §5.3 | ✅ | ✅ | ✅ | ✅ (C); ✅ 0-arg only (WASM) | extensive | — | — | — |
| `let` | §5.4 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `return` | §5.5 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `if`/`else` (statement) | §5.6 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `if`/`else` (**expression**) | §5.6 (now moved, §11) | ✅ | not checked | ❌ | — | none found | **Lowering missing** — Finding F1 | **Medium (was High)** | **RECONSIDERED: Move to v1.1** — per `UR_LANGUAGE_VERSION_MATRIX.md`, ratified during UR Language Freeze Week. §11 updated to explicitly defer this; no longer an undocumented gap in v1.0. |
| `while` | §5.7 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `break`/`continue` | §3.2 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `for`/`in` | §5.8 (now moved, §11) | ✅ | not reached | ❌ | — | none found | **Lowering missing** — Finding F2 | **Medium (was High)** | **RECONSIDERED: Move to v1.1** — same ratification and reasoning as `if`-expression above. |
| `type` alias decl | §5.11 | ❌ | — | — | — | none found | **Parser missing** — Finding F3 | **Blocker** | **Implement** (§5.11 explicitly describes this grammar; not deferred anywhere) |

## 2. Expressions & Operators

| Feature | Spec | Parser | Semantic | Lowering | Backend | Tests | Root Cause | Priority | Resolution Type |
|---|---|---|---|---|---|---|---|---|---|
| Assignment | §5.9 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `||`/`&&` | §5.9 | ✅ | not checked | not checked | not checked | not checked | — | — | — |
| `==`/`!=`/`<`/`<=`/`>`/`>=` | §5.9 | ✅ | ✅ | ✅ | ✅ (int only) | extensive | — | — | — |
| `+`/`-`/`*` | §5.9 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| `/` (division) | §5.9 | ✅ | not checked | not checked | ❌ WASM (documented) | — | Deliberately deferred | Low | **Document as Limitation** (already is, in `WASM_BACKEND_GUIDE.md`) |
| `%` (modulo) | §5.9 | ✅ | ✅ | ✅ | ✅ C; ❌ WASM | none for C | WASM-specific | Medium | **Document as Limitation** (WASM-specific, already tracked in v28 roadmap M3-adjacent work) |
| Unary `-` | §5.9 | ✅ | ✅ | ✅ | ✅ C; ❌ WASM | none for C | WASM-specific | Medium | **Document as Limitation** (same) |
| Unary `!` | §5.9 | ✅ | ⚠️ | ✅ (reaches IR) | ⚠️ C (works IF explicitly typed); ❌ WASM | none | **Type-inference gap** — Finding F4 | **High** | **RECONSIDERED, see F4 below** — was initially marked Implement; deeper analysis found the real fix requires new bidirectional/contextual type inference (inferring an unannotated parameter's type from its usage), a genuinely larger feature than a freeze-blocking fix warrants. Reclassified to **Document as Limitation**: require explicit type annotations wherever a concrete C/WASM type is needed. |
| Function calls, 0 args | §5.9 | ✅ | ✅ | ✅ | ✅ | extensive | — | — | — |
| Function calls, N args | §5.9 | ✅ | ⚠️ | ✅ (reaches IR) | ⚠️ C (works IF explicitly typed); ❌ WASM | none for the working case | **Same as F4** | **High** | **RECONSIDERED, same as F4 above** — reclassified to **Document as Limitation**: explicit parameter type annotations are required. |
| Array index `[...]` | §5.9 | ✅ | ✅ | ✅ | ✅ (extensive) | extensive | — | — | — |
| Member access `.` | §5.9 | ✅ | ✅ (correct gating) | ✅ | ✅ (struct-only) | 2 Golden Tests | — | — | — |

## 3. Type System

**File references**: general type checker's canonical-name table in
`src/compiler/typesystem/type-env.ts` (current line 83); rejection
path in `src/compiler/typesystem/checker.ts` (current line 386);
FFI/ABI-specific type table in `src/ffi/abi/types.ts`.

**Important correction from the previous version of this matrix**: the
spec's own §6 draws a two-tier distinction this project's code
actually respects, which the earlier version of this document did not
account for — re-classified below accordingly.

| Feature | Spec Tier | Semantic (general typesystem) | Semantic (FFI/ABI module) | Root Cause | Priority | Resolution Type |
|---|---|---|---|---|---|---|
| `int`/`float`/`bool`/`char`/`string` | §6.1 Tier 1 | ✅ | n/a | — | — | — |
| `byte` | §6.1 Tier 1 (**general-purpose**, per spec's own tier framing) | ❌ | ❌ (confirmed absent here too — genuinely missing everywhere, not just relocated) | **Missing from both modules** | **High** | **Implement** (Tier 1 = general-purpose per the spec's own framing; this is not an FFI-only type) |
| `null` | §6.1 Tier 1 | not checked | n/a | — | — | — |
| `i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f32`/`f64` | §6.2 Tier 2 ("required when interoperating with native libraries via UR-Bridge") | ❌ (correctly rejected — FFI-only, per **ADR-1: CLOSED**, see `ADR_1_TIER2_TYPES_DECISION.md`) | ✅ (all 10 correctly present in `src/ffi/abi/types.ts`) | Working as intended — not a defect | — | **Document Limitation** (ADR-1 ratified current behavior as correct; §6.2 and `KNOWN_LIMITATIONS.md` get one clarifying sentence each, no code change) |
| Arabic type-name surface forms | §6.1 | not re-checked this session | — | — | — | — |

## Official Resolution Type Definitions (ratified this round)

| Resolution Type | Meaning |
|---|---|
| **Implement** | المواصفة واضحة والتنفيذ ناقص — code work only, no spec question pending. |
| **Remove from v1.0** | المواصفة الحالية يجب أن تُعدل — the spec itself needs a doc change, not code. |
| **Move to v1.1** | مؤجل رسمياً — already out of v1.0's own intended scope. |
| **Document Limitation** | قيد معروف لا يمنع الإصدار — deterministic, correctly-scoped behavior; only needs stating clearly. |
| **Needs Spec Clarification** | **لا يجوز تعديل الكود قبل حسم المواصفة** — the spec itself does not resolve the intended behavior; a developer must not guess on its behalf. |

**Every finding in this document was re-checked against these
definitions this round** (not just the Tier 2 finding) — only one
genuinely qualifies for the fifth type; every other "Document
Limitation" entry was verified to have fully deterministic, correctly-
scoped behavior with no actual spec question pending (e.g., the WASM-
specific gaps for `/`/`%`/unary `-` have a spec that's already clear
about intended behavior — the WASM Backend simply hasn't implemented
it yet, which is a code gap, not a spec gap).

## Architecture Decision Review — Agenda

**Per explicit recommendation: hold one ADR meeting to resolve every
`Needs Spec Clarification` item below before any `Implement` work
begins on anything in this document.** As of this round, exactly one
item qualifies:

### ADR-1: Are Tier 2 ABI types (`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f32`/`f64`) usable in ordinary, non-FFI UR code?

- **Question to resolve**: does `function add(a: i32, b: i32): i32`
  count as valid UR v1.0 code, or are these 10 names reserved
  exclusively for FFI/ABI declarations (`src/ffi/abi/`)?
- **Current, confirmed behavior**: rejected as `TY1001: unknown type`
  by the general type checker; fully implemented and correct within
  `src/ffi/abi/types.ts`/`layout.ts` specifically.
- **§6.2's exact wording** (the only textual evidence available):
  "They are required when interoperating with native libraries via
  UR-Bridge" — states a requirement for ONE use case, does not state
  an exclusion for others.
- **Decision options**:
  1. **FFI-only** (confirms current behavior is correct) → close this
     row as "working as intended," update `SUPPORTED_PLATFORMS.md`/
     `KNOWN_LIMITATIONS.md` to state the restriction explicitly so it
     stops looking like an oversight.
  2. **Usable everywhere** → re-classify as **Implement**: add all 10
     names to `src/compiler/typesystem/type-env.ts`'s canonical table.
  3. **Something in between** (e.g., usable only in `extern`
     declarations, not ordinary function signatures) → needs its own
     precise rule written into §6 before implementation.
- **Blocks**: any `Implement` work on this specific row until decided.
  Does NOT block any other `Implement` row in this document (e.g.,
  `byte`, `type` alias, `for`, `if`-expression, char literals — all
  independently decided, see below).

### Confirmed, NOT requiring further clarification (per this round's explicit re-confirmation)

**UPDATE (UR Language Freeze Week, subsequent to this section's
original writing)**: ADR-1 has since CLOSED (see
`ADR_1_TIER2_TYPES_DECISION.md`). `byte`, `type` alias, and char
literals were subsequently IMPLEMENTED and tested (see CHANGELOG's
`language-freeze-implement-phase-1` entry). `for` and `if`-expression
were NOT implemented — reconsidered and formally MOVED to v1.1 instead
(see `UR_LANGUAGE_VERSION_MATRIX.md` and this document's own updated
rows above) rather than implemented under time pressure, per explicit
instruction to separate design-freeze from implementation. F4 was
reclassified from `Implement` to `Document as Limitation` after
deeper analysis showed a real fix needs new type-inference capability.
The paragraphs immediately below are preserved as the original,
now-superseded reasoning at the time this section was written:

- **`byte`**: Tier 1, general-purpose per the spec's own §6.1 framing,
  confirmed absent from BOTH the general type checker AND the FFI/ABI
  module — **Implement**, no ambiguity, ready for code work once ADR-1
  itself concludes (to keep all type-system changes in one reviewed
  batch, not because `byte`'s own classification is in doubt).
- **`type` alias, `for`, `if`-expression, char literals**: none appear
  in §11's deferred-to-1.1 list (AT THE TIME OF WRITING — `for` and
  `if`-expression were subsequently added to that list during Freeze
  Week, see above); all are documented in v1.0's own grammar with no
  ambiguity about whether they belong — **Implement**, ready once
  ADR-1 concludes.
- **F4 (`void`-type inference gap)**: not a spec question at all — §6.3
  already commits to type inference being a v1.0 feature; this is a
  confirmed defect in that section's own implementation — **Implement**,
  ready once ADR-1 concludes.

## 4. Literals

| Feature | Spec | Parser | Root Cause | Priority | Resolution Type |
|---|---|---|---|---|---|
| Integer/Float/String literals | §5.9 | ✅ | — | — | — |
| `true`/`false`/`null` | §3.3 | ✅ | — | — | — |
| **Char literals** (`'a'`) | §5.9/§6.1 (type exists, no literal grammar) | ❌ | Same fallback as F3 | **Blocker** | **Implement** (`char` is a documented Tier 1 type per §6.1 with no way to ever construct a value — the spec itself is incomplete here, but the INTENT — a usable `char` type — is clearly in v1.0's own scope, so this should be implemented, with a spec amendment adding the missing literal grammar to §5.9 alongside it) |

## 5. Multilingual / Unicode

| Feature | Verified | Priority | Resolution Type |
|---|---|---|---|
| Arabic keyword surface forms | ✅ | — | — |
| Arabic ↔ English AST identity | ✅ (structurally identical, confirmed by direct execution) | — | — |
| `let`/`var` synonymy (`عرف`/`دع`) | ✅ present, no documented rationale | Medium | **Document as Limitation** (or: document the rationale if one exists but was simply never written down — a decision for the language team, not a code change either way) |
| Arabic comma (`،`) | ✅ per spec table, not independently re-executed this session | — | — |

## 6. Not Checked This Session (flagged, not silently omitted)

`import` resolution semantics, `||`/`&&` through the full pipeline,
`/` on the C Backend specifically, Arabic type-name surface forms,
anything requiring LSP/IDE.

---

## Findings — Full Root-Cause Detail (F1-F5)

### F1 — `if`-expression fails at Lowering

- **File**: `src/compiler/codegen/lower-to-ir.ts`
- **Function**: `lowerExpr()`
- **Current line**: 471 (generic fallback; the function itself starts at line 265)
- **Commit**: NOT AVAILABLE (no git repository)
- **Exact error**: `CG1001: expression kind 'ConditionalExpression' is not supported in this Level 2 phase`
- **Nature**: parses fully; zero semantic implementation.

### F2 — `for` fails at Lowering

- **File**: `src/compiler/codegen/lower-to-ir.ts`
- **Function**: `lowerStatement()`
- **Current line**: 847 (generic fallback; the function itself starts at line 479)
- **Commit**: NOT AVAILABLE
- **Parser side confirmed working**: `src/compiler/frontend/parser.ts`, function `parseForStatement()`, current line 298.
- **Exact error**: `CG1001: statement kind 'ForStatement' is not supported in this Level 2 phase`
- **Nature**: identical pattern to F1 — full grammar support, zero semantic implementation. F1 and F2 share the same *category* of gap (a generic "construct not in Level 2 scope" fallback each function has its own copy of, rather than a named, construct-specific check) — worth its own tracked category, not two unrelated bugs.

### F3 — `type` alias declarations do not parse

- **File**: `src/compiler/frontend/parser.ts`
- **Function**: `parseStatement()`
- **Current line**: 195 (function start); the statement-dispatch `switch` has cases for `LET_KW`/`IF_KW`/`WHILE_KW`/`FOR_KW` but no `case "TYPE_KW"` anywhere in it.
- **Fallback triggered**: same function's default path, current line 527.
- **Commit**: NOT AVAILABLE
- **Exact error**: `PE001: Expected expression, got 'type' (TYPE_KW)`
- **Nature**: the most severe gap found — fails at the earliest possible pipeline stage, despite spec §5.11 describing this construct's grammar explicitly.

### F4 — Type-inference `void` gap (affects unary `!` and multi-argument calls on the C Backend) — RECONSIDERED

**Correction (this round): originally classified `Implement`. Deeper
analysis of what a real fix requires changed this to `Document as
Limitation`** — recorded transparently rather than silently revised.

- **Proximate cause file**: `src/compiler/codegen/lower-to-ir.ts`
- **Function**: `toIRType()`, current line 63 — `if (t.kind === "Unknown") return "void";`, with the function's own comment: *"convention: no return-type annotation → resolveOptionalTypeRef returns T_UNKNOWN"*.
- **Commit**: NOT AVAILABLE
- **Why this is NOT a small fix**: the actual defect is upstream — unannotated parameters/variables are never assigned a concrete type at all (they stay `T_UNKNOWN` permanently; there is no pass that infers a parameter's type from how it's later used, e.g. from being passed to `!` or compared against a `bool`). Implementing that inference is a genuine, new bidirectional/contextual type-inference capability — substantially larger in scope than a freeze-blocking bug fix, and risks exactly the kind of feature-during-freeze work this process exists to prevent.
- **Resolution**: **Document as Limitation.** UR v1.0 requires explicit type annotations on any parameter or variable used in a context needing a concrete backend type (unary `!`, multi-argument calls). This is now stated in `KNOWN_LIMITATIONS.md`. The underlying convention in `toIRType()` is correct and not changed.
- **Confirmed workaround (already verified, not a new feature)**: supplying an explicit type annotation (`let x: bool = ...`, `function add(a: int, b: int)`) avoids the `Unknown` path entirely and produces correct, compiling, executing C — verified directly both times, unaffected by this reclassification.

### F5 — `byte` (Tier 1) missing everywhere; Tier 2 names (i8...f64) correctly exist, but only in the FFI/ABI module — scope ambiguity, not a confirmed defect

**Correction from the original version of this finding**: originally
reported as "width-specific type names entirely unrecognized." Direct
re-inspection this round found this was imprecise — corrected below.

- **`byte`** (§6.1, Tier 1 — general-purpose per the spec's own framing):
  - **File**: `src/compiler/typesystem/type-env.ts` (canonical-name table, current line 83) — absent.
  - **Also confirmed absent from**: `src/ffi/abi/types.ts` (checked directly this round — genuinely missing everywhere, not merely relocated).
  - **Rejection path**: `src/compiler/typesystem/checker.ts`, current line 386, `TCODES.UNKNOWN_TYPE`.
  - **Commit**: NOT AVAILABLE
  - **Classification**: a confirmed defect — **Implement**.
- **`i8`/`i16`/`i32`/`i64`/`u8`/`u16`/`u32`/`u64`/`f32`/`f64`** (§6.2, Tier 2 — "required when interoperating with native libraries via UR-Bridge"):
  - **Confirmed present and correct** in `src/ffi/abi/types.ts` and `src/ffi/abi/layout.ts` — this round's direct check found all 10 names.
  - **Confirmed absent** from the general type checker (`type-env.ts`) — meaning `function main(): i32` (an ordinary, non-FFI declaration) is rejected.
  - **This is a scope ambiguity in the spec itself, not a confirmed implementation defect**: §6.2 does not state whether Tier 2 names are usable in ordinary (non-FFI) UR code. If the spec's intent is "FFI-only," the current behavior is CORRECT and this row should be closed as "working as intended." If the intent is "usable everywhere, FFI included," this is a real gap in the general type checker specifically. **Classification: Needs Spec Clarification** — a fifth resolution type, since none of the four originally proposed cleanly fits an ambiguous spec passage rather than a clear defect.

---

## Prioritized Problem List (per explicit instruction: classify fully before any fix begins)

**Resolution Type key**: `Implement` / `Remove from v1.0 Spec` /
`Move to v1.1` / `Document as Limitation` / `Needs Spec Clarification`
(a fifth type, added this round for genuinely ambiguous spec passages
that don't cleanly fit any of the original four until the ambiguity
itself is resolved).

| Priority | Finding | Resolution Type | Blocks v1.0 Release? |
|---|---|---|---|
| **Blocker** | F3 — `type` alias doesn't parse at all | **Implement** | **Yes** |
| **Blocker** | Char literal syntax entirely absent | **Implement** (+ a spec amendment adding the missing literal grammar) | **Yes** |
| **Medium** | F1 — `if`-expression parses, doesn't lower — **RECONSIDERED** | **Move to v1.1** (ratified, `UR_LANGUAGE_VERSION_MATRIX.md`) | **No** — §11 now explicitly defers this |
| **Medium** | F2 — `for` parses, doesn't lower — **RECONSIDERED** | **Move to v1.1** (ratified, `UR_LANGUAGE_VERSION_MATRIX.md`) | **No** — §11 now explicitly defers this |
| **Medium** | F4 — `void`-type inference gap (unary `!`, N-arg calls on C Backend) — **RECONSIDERED** | **Document as Limitation** | **No** — requires explicit type annotations, now documented; not a defect |
| **High** | F5a — `byte` (Tier 1) missing everywhere | **Implement** | Recommend: **Yes** — Tier 1 is general-purpose per the spec's own framing |
| **Needs a decision first** | F5b — Tier 2 (`i8`...`f64`) unusable outside FFI context | **Needs Spec Clarification** | **Unknown until the ambiguity is resolved** — not yet classifiable as blocking or not |
| **Medium** | WASM-specific gaps already documented (`%`, unary `-`, calls-with-args on WASM specifically) | **Document as Limitation** (already is) | **No** |
| **Medium** | `let`/`var` synonym, no documented rationale | **Document as Limitation** | **No** |
| **Low** | Untested areas (§6 of this document) | — (not yet a finding, just an open item) | **No** |

**Per explicit instruction, no fix has been started for any of the
above.** The one row requiring a decision BEFORE it can even be
classified (F5b) is deliberately left unresolved here — assigning it
a Resolution Type without that decision would be exactly the kind of
premature action this review process exists to prevent.
