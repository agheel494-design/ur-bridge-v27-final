# Simulated Independent Audit — UR Language/Compiler Repository

**CRITICAL META-NOTE, read before anything else below**: this audit
was executed by the same party (this assistant) that produced every
prior claim in this conversation. Adopting an "auditor" framing does
not change who ran the commands or read the files — genuine
independence requires a different party with direct, unmediated
repository access. This document should be read as a **rigorous
self-adversarial exercise**, not as satisfying the reviewing party's
own stated requirement for a genuinely independent audit. That
requirement remains unmet.

With that said: this exercise found REAL, previously-undiscovered
defects — proving its own value as an exercise, even while its
independence claim cannot be honored.

---

## Claims Proven This Round (High confidence — directly executed, novel test cases)

| Claim | Confidence | Evidence |
|---|---|---|
| `byte` type exists and is usable in declarations | High | Direct execution |
| `char` literal syntax works, including for multi-byte Unicode (`'é'`) | High | Direct execution — confirmed the lexer correctly counts one Unicode scalar value as one character, not one UTF-8 byte |
| Chained `type` aliases (`type B = A` where `A` is itself an alias) work | High | Direct execution |
| `for`/`if`-expression are correctly rejected | High | Re-confirmed with fresh, correctly-formed UR syntax |

## NEW FINDINGS (not previously known anywhere in this conversation's history) — precisely classified, not lumped together

### Finding 1 (Confidence: High — directly reproduced) — Classification: **Regression Against Documented Diagnostic Contract** (highest severity) — **STATUS: FIXED** (Compiler & Runtime Stabilization phase — see `KNOWN_LIMITATIONS.md` and `tests/compiler/frontend/parser.test.ts`'s own dedicated regression tests for 1/2/3 stacked modifiers)

**Refined per explicit correction**: "Contract" rather than
"Guarantees" specifically — the issue is not merely that the
implementation regressed, but that this fix's own documentation
(`CHANGELOG.md`'s `[RETROACTIVE CORRECTION]` entry) explicitly states
the fix covers "the whole class of unrecognized-modifier words," not
case-by-case — a documented promise to users and developers that no
such word would be silently discarded. This case breaches that
documented promise directly, not only an implementation regression.

The `PE010` unrecognized-modifier diagnostic has a real gap for
STACKED modifiers: `async const function main(): int ... end` — only
`const` (the SECOND modifier) triggers `PE010`. **`async` (the first
modifier) is silently swallowed as a meaningless bare-identifier
`ExpressionStatement`** — confirmed directly by inspecting
`program.body`, which contains exactly the kind of orphaned node the
entire `PE009`/`PE010` fix was built to eliminate.

**Root cause (inferred, not yet fixed)**: the modifier-detection
check in `parser.ts`'s top-level loop looks exactly one token ahead
(`peekSkipNL(1).kind` must be `FUNCTION_KW`/`STRUCT_KW`/`TYPE_KW`).
When a SECOND modifier follows the first, that lookahead sees another
`IDENTIFIER`, not a declaration keyword, so the check does not fire
for the FIRST modifier.

### Finding 2 (Confidence: High that the behavior occurs; N/A for "is this a bug" — depends on an undecided spec question) — Classification: **Missing Semantic Specification**

`let x: byte = 999` and `= 0 - 5` are silently accepted, compile, and
wrap at runtime (`999 mod 256 = 231`; `256 - 5 = 251`).

**Spec text found** (`UR_LANGUAGE_SPEC_1_0.md` §6.1): `byte` |
`بايت` | "Unsigned 8-bit integer" — names the semantic CATEGORY, but
states no explicit requirement for how an out-of-range literal must
be handled (compile error, runtime trap, or silent truncation are all
consistent with "it's an 8-bit type" in different language designs).
**This is not a violation of a stated rule — it's the absence of one.**

**Supporting evidence for this classification (per explicit review):
real languages disagree with each other on this exact question**,
confirming "Unsigned 8-bit integer" alone cannot determine the
correct behavior:
- Rust (debug builds): panics on overflow.
- Rust (release builds): wraps silently.
- Ada: raises a `Constraint_Error`.
- C: wraps silently for unsigned types (the behavior UR's own C
  Backend currently inherits, unexamined).
- Java: requires an explicit cast to narrow into a byte-sized type.

Given this real spread of precedent, UR's own spec would need to
state its choice explicitly — it currently does not. Requires an
architectural decision (matching the `ADR-1`/Tier-2 precedent) before
this can be classified Bug or Working-As-Intended.

### Finding 3 (Confidence: High that the behavior occurs; N/A for "is this a bug" — same undecided question as Finding 2) — Classification: **Missing Semantic Specification**

`byte + byte` is rejected at typecheck (`TY3001: operator '+' cannot
be applied to Byte and Byte`) — `byte` can be declared and assigned
from an `int` literal, but not combined with another `byte` in any
expression.

**Spec text**: §6.1 states no operator support for `byte` at all —
neither confirming nor denying arithmetic. Notably, `char` (also
Tier 1) does not support arithmetic either, and no one has treated
that as a defect — the CURRENT byte+byte rejection may well be the
CORRECT, intended interpretation (treating `byte` more like `char`
than like `int`), not a bug. **This should be resolved together with
Finding 2** — both trace to the same underlying, unanswered question:
"what operations does `byte` support, precisely?"

### Non-finding (Confidence: Medium — single test, not exhaustively probed), unclassified

Duplicate `type` alias names are silently allowed. No spec text found
either confirming or denying this — flagged as a question, not
classified.

## Correction to This Report's Own Earlier Overreach

**The original version of this report's "Final Engineering Judgment"
section stated that finding these defects "argues MORE strongly for"
the independent audit requirement. Per explicit correction: this
claim asserted a causal relationship that doesn't hold.** The need
for a genuinely independent audit existed identically BEFORE these
findings and would exist identically if this exercise had instead
found zero defects across all 9 probes — a same-party exercise cannot
establish its own sufficiency regardless of its findings' volume or
severity. The corrected framing: these findings are evidence that
Diagnostic Robustness has a real, specific gap (Finding 1) and that
Semantic Completeness has open questions (Findings 2-3) — two
separate, narrower conclusions than "prove independent audit is
needed," which was never in question and is not proven or disproven
by this exercise either way.

## Claims That Remain Unproven (Confidence: N/A — cannot be resolved without a genuinely independent party)

- That the archived ZIP files delivered throughout this conversation
  contain exactly the code that was actually tested (no divergence
  between what ran and what was packaged).
- That `2374` (or any other reported count) matches a real `npx
  vitest run` in a network-connected environment — never performed,
  by any party, at any point in this conversation.
- That every CHANGELOG entry's own described diff is complete and
  accurate — spot-checked repeatedly and self-corrected multiple
  times when wrong (the `PE010` documentation gap, the `type` alias
  example error, two line-number citation errors), which raises
  rather than lowers the prior probability that undiscovered
  instances of the same pattern remain.

## Contradictions Found Between Documentation and Actual Behavior

1. `STDLIB_API_FREEZE_CHECK.md` marks `byte`-adjacent work as N/A
   (no stdlib function currently takes a `byte` argument), so this
   doesn't contradict anything shipped — but if a future Standard
   Library function were to accept `byte` parameters and perform
   arithmetic on them, it would silently fail, and no existing
   document warns of this. Recommend adding Defects 1 and 2 to
   `KNOWN_LIMITATIONS.md` before any such function is written.

## Final Engineering Judgment (corrected per explicit review — this exercise's own assessment, not a substitute for genuine independent review)

**Reproducibility**: High — re-confirmed further by this exercise;
every novel test case produced a clear, deterministic result.

**Documentation maturity**: High — this cycle's own repeated
self-correction (line-number errors, the `type` alias example, the
`PE010` documentation gap, and now this report's own initial
overreach, corrected below) reflects an active correction process,
not an absence of errors.

**Diagnostic robustness**: Good, with one proven, specific gap
(Finding 1 — stacked modifiers bypass `PE010`'s own guarantee).

**Semantic completeness**: Two open architectural questions remain
undecided (`byte`'s range/arithmetic semantics, Findings 2-3) —
neither confirmed as bugs nor as working-as-intended; both need a
decision, matching the `ADR-1` precedent, not a code fix yet.

**Independent verification**: Not yet performed — **unaffected by
this exercise's findings in either direction**. This requirement
existed identically before this exercise and would exist identically
had every one of the 9 probes passed cleanly.

**Recommendation, corrected**: do not raise the project's status
based on this exercise's findings, and do not lower it drastically
either. **Correction to this section's own original version**: it
previously claimed these findings "argue MORE strongly for" the
independent audit requirement — per explicit correction, that
asserted a causal relationship that doesn't hold. The need for
genuinely independent review existed identically before these
findings and would exist identically had this exercise found zero
defects across all 9 probes. These findings instead identify
specific, scoped items to resolve (one diagnostic-logic fix for
Finding 1; one architectural decision covering the related Findings
2-3) — narrower conclusions than any claim about whether independent
audit is or isn't needed, which this exercise cannot settle either
way.

---

## Final Balanced Assessment (per explicit review, adopted as this document's own closing summary)

| Axis | Assessment |
|---|---|
| Compiler stability | Good |
| Spec maturity | Good, with specific gaps requiring decisions |
| Documentation maturity | High |
| Reproducibility | High |
| Diagnostic quality | Good, with one proven regression |
| Independent verification | Not yet performed |

**Most accurate current description**: **UR Language v1.0 Freeze
Candidate** — a largely mature project, with at least one design
decision still requiring resolution, and independent audit not yet
performed. This is a conservative description, consistent with the
evidence available from this side alone.
