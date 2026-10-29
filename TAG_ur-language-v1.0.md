# TAG SPECIFICATION: ur-language-v1.0

## Canonical Status Statement (the permanent, citable reference for this project's current state)

> **UR Language v1.0 is a Freeze Candidate: its specification,
> documentation, and review methodology have reached a mature state,
> while final release approval remains contingent on an independent
> audit that reproduces the reported results directly from the
> source repository.**

> **لغة UR الإصدار 1.0 هي مرشحة للتجميد (Freeze Candidate): بلغت
> المواصفة والتوثيق ومنهجية المراجعة مستوى ناضجًا، إلا أن اعتماد
> الإصدار النهائي يبقى مشروطًا بتدقيق مستقل يعيد تنفيذ جميع الفحوص
> مباشرةً على المستودع المصدري.**

This statement deliberately separates three distinct things, per the
reasoning that produced it: what has matured (specification,
documentation, review methodology); what current results indicate
(reproducibility, within the environment testing was actually
performed in); and what remains outstanding (independent
verification — the one remaining condition before this status can
change to a formally approved release).

**This is a tag SPECIFICATION, not a completed Git operation — no
`.git` repository exists in this environment (confirmed directly: `git
log -1` → `fatal: not a git repository`), so no tag has actually been
created. This document specifies exactly what the tag `ur-language-
v1.0` should point to and record, ready for whoever has real Git
access to execute the actual `git tag` command against the matching
commit.**

**The repository is prepared for UR Language v1.0 freeze, pending
independent verification of the archived source** — this document
does not itself constitute that verification, and the freeze is not
final until a reviewer with direct file access confirms the claims
below against the actual code.

This is a permanent reference point for the LANGUAGE specification
and its implementation — distinct from any WASM Backend RC/tag
(`v27-wasm-3.1b-rc2`, etc.), which tracks the Backend's own,
separately-frozen state. Once real Git access exists, do not delete,
move, or reuse this tag name.

- **Tag name:** `ur-language-v1.0`
- **Date:** per this conversation's own final approval turn.
- **Approval status:** the reviewing party stated `Approved for UR
  Language v1.0 Freeze` based on the claims reported to them —
  **explicitly not yet an independent verification of the archived
  source files themselves**, per that same reviewer's own standing
  caveat repeated at every stage of this process. This tag
  specification should not be read as claiming that independent
  verification has occurred.
- **Marks:** `UR_LANGUAGE_SPEC_1_0.md`, `UR_LANGUAGE_VERSION_MATRIX.md`,
  `UR_LANGUAGE_V1_0_FINAL_SPECIFICATION.md`, and every source file
  touched during UR Language Freeze Week's implementation phase
  (`byte`, char literals, `type` alias declarations, the `enum`
  diagnostic fix) — the complete, current state of the LANGUAGE
  design and its v1.0-scoped implementation.
- **Test count when this specification was prepared:** 2347/2347, 0 TypeScript errors.

## Known, Accepted Limitations (per this specification's own state) (per the approving review's own two notes — not blockers)

1. `for`/`in` and `if`-expression are formally deferred to v1.1 (§11
   of `UR_LANGUAGE_SPEC_1_0.md`, `UR_LANGUAGE_VERSION_MATRIX.md`).
2. Contextual/bidirectional type inference (named-type annotations,
   the `void`-gap for unannotated parameters/variables) remains
   limited as documented in `KNOWN_LIMITATIONS.md` and
   `issues/named-type-annotations-not-resolved.md`.

## Standing Rule From This Point Forward

**UR Language v1.0 is now Maintenance-only.** No file covered by this
tag's scope may be modified for any reason other than:
- A confirmed, documented bug fix (tracked by an Issue file), or
- A diagnostics correction (matching the exact, narrow precedent this
  freeze cycle itself set with the `enum` fix — a clearer error
  message, never new accepted syntax or semantics).

**No new feature may be added to v1.0 under any circumstance.** Every
deferred item (`for`, `if`-expression, named-type annotations,
contextual inference, and anything else discovered later) belongs
exclusively to the v1.1 milestone — see `MILESTONE_UR_LANGUAGE_V1_1.md`.

## Note on Tooling

Identical to every prior tag in this project's history: no `.git`
repository exists in this environment (confirmed directly: `git log
-1` → `fatal: not a git repository`), so this document serves as the
tag record in place of an actual `git tag` command. Whoever imports
this codebase into real version control should create the literal tag
`ur-language-v1.0` at the commit matching this archive's exact
contents.
