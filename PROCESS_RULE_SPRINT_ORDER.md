# Standing Process Rule: Mandatory Sprint Order

**Status: MANDATORY, project-wide, effective immediately. Adopted
directly in response to the `PE010` incident** (a real fix made
during Compiler Stabilization Sprint's own work went completely
undocumented in `CHANGELOG.md` and was omitted from that sprint's own
report — discovered only when a reviewer asked for an explanation of
an unexplained test-count change, not caught by any process at the
time the fix was made).

---

## The Rule

Every unit of work, without exception, follows this exact order:

```
1. Implementation Diff   (the actual code change)
        ↓
2. Regression Tests      (verify the change directly, confirm nothing else broke)
        ↓
3. API Freeze Check      (see below — mandatory for any Standard Library / URPM-facing surface)
        ↓
4. Documentation Update  (user-facing docs, spec, KNOWN_LIMITATIONS, etc.)
        ↓
5. CHANGELOG Update      (recorded THE MOMENT the fix is made, not after a report is written about it)
        ↓
6. Sprint/Session Report (summarizes 1-5 — never introduces new, undocumented claims of its own)
```

**Never**: `Tests → Report → "we'll remember to update CHANGELOG
later."` That ordering is exactly what allowed `PE010` to exist,
tested and working, for an entire sprint's own report to claim "no
fix was required," without anyone — including the one making the
fix — noticing the contradiction until a reviewer's own question
forced an investigation.

## Step 3: API Freeze Check (added per explicit instruction — prevents costly interface breakage after downstream consumers exist)

Before any Standard Library module (or any other surface URPM,
documentation, or examples will come to depend on) is documented or
changelogged, its public signatures must be explicitly reviewed and
marked as one of:

- **Frozen** — this function/type's signature will not change without
  a major-version bump. Safe for URPM, examples, and documentation to
  depend on.
- **Provisional** — the signature may still change; downstream
  consumers should not treat it as stable yet. Must be labeled as
  provisional everywhere it's documented.

This check exists specifically because changing a Standard Library
function's signature AFTER `URPM`, worked examples, and reference
documentation depend on it is expensive — matching this project's own
long-standing "docs must match code, decide scope before code" ethos,
applied here to library API surfaces specifically.

**Practically**: this step's output is a short, explicit statement in
that module's own documentation ("Frozen as of vX.Y" or "Provisional
— signature may change") — not a separate meeting or document.

## Why Step 5 (CHANGELOG) Comes Before Step 6 (Report), Specifically

A Sprint Report is a SUMMARY of what CHANGELOG already says happened
— never the other way around. If something is true enough to put in a
Sprint Report, it was already true enough to have gone into
CHANGELOG first. Writing the report before the CHANGELOG entry creates
exactly the gap this incident exposed: the report-writing step becomes
the first (and, if skipped, the only) point where the work gets
described in prose — and prose written under sprint-summary pressure
is more likely to default to a template ("no fix required") than
prose written at the moment a specific diagnostic code was chosen and
tested.

## Enforcement

Before any Sprint/Session Report is finalized, its author must be
able to answer, for every claim in the report: "which CHANGELOG entry
does this summarize?" If a claim has no corresponding CHANGELOG
entry, the CHANGELOG entry gets written first — the report is not
finalized around a claim that skipped step 5 (CHANGELOG).

## Retroactive Application

This rule does not require re-auditing every prior sprint in this
project's history for similar gaps — that would itself violate the
"don't chase things without a specific reason to suspect them" 
discipline this project has otherwise followed throughout. It applies
forward, starting with `UR Standard Library v1.0 Foundation Sprint`.
