# UR Language v1.0 — Branch Policy (Maintenance Only) — DOCUMENTED

**Status: this policy is DOCUMENTED and ready to apply, pending the
same independent verification noted in `TAG_ur-language-v1.0.md` —
no actual branch exists in this environment (no `.git` repository),
so "in effect" here means "the rule this project intends to enforce
once real version control exists," not a completed branch-protection
action. This document is the standing rule for anyone touching any
file within v1.0's own scope, once the freeze itself is independently
confirmed.**

---

## What Is Permitted

1. **Confirmed, documented bug fixes** — must have a corresponding
   Issue file (`issues/*.md`) describing the exact reproduction, root
   cause, and fix, matching this project's own established discipline
   throughout the WASM Backend's own history.
2. **Diagnostics corrections** — clarifying or fixing an error
   message's wording, adding a missing diagnostic for a case that
   previously failed silently (matching the exact, narrow precedent
   set by the `enum` fix this cycle: `PE009` did not change what is
   valid UR 1.0 syntax, it only made an already-invalid construct fail
   loudly instead of silently).
3. **Documentation corrections** — fixing a doc that doesn't match
   actual code behavior (matching this project's own long-standing
   "docs must match code" discipline).

## What Is NOT Permitted, Under Any Circumstance

1. **New syntax.** No new grammar production, no new keyword, no new
   token kind.
2. **New semantics for existing syntax.** E.g., making `for` or
   `if`-expression suddenly lower successfully would be a v1.1 feature
   landing inside v1.0 — forbidden regardless of how small the change
   looks.
3. **New type-system capabilities.** E.g., implementing contextual
   type inference to close the `void`-gap documented in
   `KNOWN_LIMITATIONS.md` — that is v1.1-scoped work, not a v1.0 bug
   fix, even though it originated from a v1.0-era finding.
4. **Refactoring, performance optimization, or code cleanup** without
   a specific bug driving it — matching the identical discipline
   already applied to the WASM Backend's own RC2 freeze.

## Review Requirement

Any change proposed under "What Is Permitted" above must, before
merging:
- Cite the specific Issue file it resolves (for bug fixes) or state
  explicitly that no behavior change occurred beyond the diagnostic
  message itself (for diagnostics corrections).
- Pass the complete existing regression suite unchanged in count,
  plus any new test the fix itself adds.
- Be independently reviewable against this exact policy — a reviewer
  should be able to confirm "this is a Maintenance change" without
  needing to trust the submitter's own characterization of it.

## Escalation

Any contributor who believes a "bug fix" actually requires new syntax
or semantics to properly resolve must stop and file it as a v1.1
proposal instead — matching exactly how this cycle's own `for`/
`if`-expression findings were handled (discovered as apparent "bugs,"
correctly re-classified as version-scope decisions once their true
size became clear, and formally moved to v1.1 rather than forced into
v1.0 under time pressure).
