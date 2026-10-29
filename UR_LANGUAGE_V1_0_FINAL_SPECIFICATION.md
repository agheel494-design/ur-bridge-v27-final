# UR Language v1.0 — Final Specification (Freeze Week Sign-Off)

## Canonical Status Statement (superseding this document's own original "Design Frozen" framing below — see `TAG_ur-language-v1.0.md` for the same statement)

> **UR Language v1.0 is a Freeze Candidate: its specification,
> documentation, and review methodology have reached a mature state,
> while final release approval remains contingent on an independent
> audit that reproduces the reported results directly from the
> source repository.**

> **لغة UR الإصدار 1.0 هي مرشحة للتجميد (Freeze Candidate): بلغت
> المواصفة والتوثيق ومنهجية المراجعة مستوى ناضجًا، إلا أن اعتماد
> الإصدار النهائي يبقى مشروطًا بتدقيق مستقل يعيد تنفيذ جميع الفحوص
> مباشرةً على المستودع المصدري.**

**Status: DESIGN FREEZE. This document closes "UR Language Freeze
Week." No code was written to produce it. Implementation may only
resume after this document is reviewed and accepted — and even then,
strictly as matching-the-spec work, not further design decisions made
mid-implementation.**

---

## 1. What Was Reviewed This Week

- **Keywords**: full canonical token table (`UR_LANGUAGE_SPEC_1_0.md`
  §3) — no duplicate-function keywords found beyond the already-known,
  documented `let`/`var` and `عرف`/`دع` synonymy (unchanged this week;
  a naming-consistency question, not a defect).
- **Type system**: full Tier 1/Tier 2 review (§6) — resulted in ADR-1's
  closure and `byte`'s implementation. `null`/Arabic type-name surface
  forms remain unverified by direct execution (carried forward as an
  open verification item, not a version-assignment question).
- **Grammar**: full §5 production review — resulted in identifying and
  resolving the `for`/`if`-expression/`type`-alias/char-literal
  discrepancies between documented grammar and actual implementation.
- **Diagnostics**: every LE/PE error code audited for collisions
  (found and fixed two real ones — `LE004`, `PE006` — during this
  cycle's own implementation work) and now fully listed in §10 with
  accurate descriptions matching actual usage.

## 2. Authoritative References From This Point Forward

- **`UR_LANGUAGE_SPEC_1_0.md`** — the base specification, now updated
  (§10's error codes corrected and completed; §11's deferred list
  corrected — struct/enum split, `for`/`if`-expression/named-type-
  annotations/unannotated-inference added).
- **`UR_LANGUAGE_VERSION_MATRIX.md`** — the single, official
  feature × version table. Supersedes any informal or partial version
  claim made in any earlier document in this project's history.
- **`SPEC_IMPLEMENTATION_MATRIX.md`** — the underlying verification
  evidence (file/function-level citations) every version-matrix
  decision traces back to.
- **`ADR_1_TIER2_TYPES_DECISION.md`** — the one architectural decision
  this cycle required; closed, not to be reopened without a new ADR.

## 3. What Is IN v1.0 (confirmed implemented and tested, per §2's evidence)

Variables, functions (0-arg calls; N-arg calls work on the C Backend
with explicit parameter types), `if`/`else` (statement form only),
`while`/`break`/`continue`, arrays, structs (via constructor-call
inference; NOT via explicit named-type annotation — see §5 below),
`type` aliases (alias form only), `byte`, char literals, Tier 2 ABI
types (FFI/ABI declarations only).

## 4. What Is Explicitly MOVED to v1.1 (not silent gaps — ratified decisions, §11 updated accordingly)

- `for`/`in` loops (grammar recognized, Lowering intentionally still
  rejects it).
- `if` used as an expression (same treatment).
- Named-type annotations (`let p: Point`, `let x: MyInt`) — inference
  from a constructor call remains valid v1.0 code.
- Unannotated-parameter/variable type inference for contexts needing a
  concrete backend type (unary `!`, multi-argument calls) — v1.0
  requires explicit annotations in these cases.
- Enum declarations.

## 5. What Is OUT of Scope Through v2.0 (unchanged from §11's own long-standing list, re-confirmed this week, not newly decided)

Generics, Classes/Inheritance/Interfaces, Async/await, pattern
matching, closures, `try`/`catch`, operator overloading, macros,
tuples — none exist in any UR-language-specific document; all
confirmed architectural, not scoped for v1.x at all.

## 6. Open, Non-Blocking Verification Items (carried forward, not version-assigned because they aren't yet confirmed as real findings)

`import` resolution semantics beyond parsing, `||`/`&&` through the
full pipeline, `/` on the C Backend specifically, Arabic type-name
surface forms, `null` literal handling — none of these have been
directly executed and confirmed one way or the other. Recommended as
the FIRST task for whoever resumes verification work, before any new
feature implementation.

## 7. Standing Rule From This Point Forward

Per explicit instruction: implementation work (WASM support for
existing gaps, the 1.1 items above, etc.) may only proceed as
**matching this specification** — no further architectural decisions
made inline during coding. Any NEW discrepancy found during
implementation gets logged as its own issue and brought back to a
design review, not resolved unilaterally mid-fix (exactly the
discipline that already avoided scope creep on `byte`/char-literal/
type-alias this cycle, now made the standing rule rather than an
ad-hoc practice).

## 8. Sign-Off

This document, together with `UR_LANGUAGE_VERSION_MATRIX.md`, is
presented as ready for review and acceptance. Once accepted:

> **UR Language v1.0 — Design Frozen.**

Implementation of the v1.1-assigned items (`for`, `if`-expression,
named-type annotations, contextual inference) begins only after this
sign-off, each as its own dedicated design-first cycle (CFG drawn,
Invariant ratified, hand-verified — matching every prior control-flow
feature's own precedent) — not resumed casually the day after this
document is accepted.
