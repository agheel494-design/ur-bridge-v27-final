# MODULE_AUDIT.md

```
Audit Scope
------------
Directories searched:
- src/compiler/module/ (all 5 files: export-checker.ts,
  import-resolver.ts, registry.ts, module-descriptor.ts, index.ts)
- tools/
- scripts/
- tests/

Excluded:
- docs/, examples/, archived/

Search method:
- Symbol references (grep, full scope, all 5 module files)
- Runtime verification (real UR programs through the actual
  end-to-end pipeline, including ModuleRegistry.resolveAll())

Confidence:
- High (usage counts and 4 gap-closing tests below)
```

---

## Critical Self-Correction (disclosed directly, not hidden)

An earlier version of this audit searched only
`export-checker.ts` and concluded 4 of 6 MCODES were unused. This
was a real search-scope error, the same class of mistake found
earlier with BACKEND_CODES: MD1004 (CIRCULAR_IMPORT) and MD1006
(AMBIGUOUS_IMPORT) are referenced in `registry.ts`, a file not
checked in that earlier pass. Corrected here by searching all 5
files in the directory.

## Inventory — Classification (exactly one category per code, per
explicit direction; "Dormant" not used without direct evidence)

| Code | Constant | Classification | Evidence |
|---|---|---|---|
| MD1001 | DUPLICATE_EXPORT | **Used** | `export-checker.ts`, fires on real duplicate exports |
| MD1002 | MISSING_EXPORT | **Not used — requires investigation** | Zero references anywhere in the 5-file scope; no specific comment ties this exact code to an unbuilt feature (only a general comment about "Phase 2" named imports elsewhere in the file, not tied to this constant by name) |
| MD1003 | UNRESOLVED_IMPORT | **Not used — requires investigation** | Zero references; `ImportResolver.resolve()`'s own real "missing" case maps to MD1005 instead, not MD1003 — unclear whether MD1003 is meant for a different, currently-unbuilt case or is simply redundant with MD1005 |
| MD1004 | CIRCULAR_IMPORT | **Used** | `registry.ts`, fires via `ModuleRegistry.resolveAll()` — confirmed live with two real modules importing each other |
| MD1005 | MISSING_MODULE | **Used** | Both `export-checker.ts` and `registry.ts` (via the resolver's own "missing" case) |
| MD1006 | AMBIGUOUS_IMPORT | **Not used — requires investigation** | `registry.ts` maps to this code when the resolver's error `kind` is neither "circular" nor "missing" — but `ImportResolverError.kind`'s own type includes "ambiguous" as a possibility, and NO code path anywhere in `import-resolver.ts` actually produces an "ambiguous" kind. This is not attributable to an unbuilt future feature by any comment found — it is a type-level possibility with no current producer, a distinct situation from MD1002/MD1003. |

**None of the three unused codes are classified as belonging to an
unbuilt future feature with direct evidence** — the earlier draft's
assumption that all unused MCODES were "Phase 2, not yet built" is
corrected here: only a general nearby comment about named imports
supports that framing, and it is not specifically tied to any of
these three constants by name. All three are recorded as **requiring
investigation**, not as confirmed forward-looking code.

## Runtime Evidence

Real UR programs and real multi-module scenarios run through the
actual pipeline:

```
MD1001 - two functions named 'f'                    -> ["MD1001"]
MD1005 - import "nonexistent", empty registry         -> ["MD1005"]
MD1004 - a.ur imports ./b.ur, b.ur imports ./a.ur,
          via the real ModuleRegistry.resolveAll()     -> ["MD1004"]
Regression - x.ur / y.ur, healthy one-way import      -> valid: true, []
```

**Real path-resolution detail discovered while constructing these
fixtures**: `ImportResolver`'s own `toCanonical()` strips a `./`
prefix during normalization — a module must be *registered* under
its bare name (e.g. `"a.ur"`), not a `"./a.ur"`-prefixed one, for a
relative import to resolve to it correctly. An initial attempt at
this test used `"./a.ur"` as the registration key and got MD1005
(missing module) for both the circular AND the healthy case — not a
bug, a real, now-documented API usage detail.

Permanent test added:
`tests/compiler/module/module-audit.test.ts`, 4/4 passing.

## Known Limitations

- MD1002/MD1003/MD1006 could not be behaviorally triggered by any UR
  program or API call attempted in this session — this may mean they
  guard a genuinely unbuilt case, or that they are effectively
  unreachable given the current resolver logic (in MD1006's case,
  confirmed: no code path produces the "ambiguous" kind at all).
  Neither possibility is confirmed over the other here.
- Only one specific reproducer was tried per code — a different
  construction might behave differently for MD1002/MD1003 in
  particular, since no comment definitively rules out a real,
  reachable case existing.

## Backlog

**New item, per explicit direction (if a defect appears, open a Bug,
do not fix it in this session)**: no defect was found — the three
unused codes are not confirmed bugs (no reproducer was found showing
a real case going unhandled that these codes were meant to catch;
only that these specific codes are not currently producible). Logged
as an investigation item, not a bug:

> **MD1002 / MD1003 / MD1006 — Unused Code Investigation**
> Status: Open, not started. Goal: determine, for each of the three,
> whether a real UR/multi-module scenario exists that should trigger
> it but currently doesn't (a real gap), or whether the code is
> genuinely unreachable by design (e.g. MD1006's "ambiguous" kind
> having no producer) and should be either wired up or documented as
> intentionally inert. No code changes without this determination
> first.

## Evidence Summary

```
Evidence Summary
------------------
Verified by runtime:
- MD1001, MD1004, MD1005 all fire correctly on real reproducers
- A healthy two-module program resolves cleanly (valid: true, zero
  diagnostics)
(tests/compiler/module/module-audit.test.ts, 4/4)

Verified by source inspection:
- MD1002, MD1003, MD1006 confirmed to have zero real usage across
  all 5 files in src/compiler/module/ (grep, corrected full scope)
- MD1006 specifically: confirmed no code path produces the
  "ambiguous" ImportResolverError kind anywhere in import-resolver.ts

Not verified:
- Whether MD1002/MD1003/MD1006 represent a real, currently-unhandled
  gap vs. intentionally-unreachable code - open investigation item
  logged in the Backlog above, not resolved in this pass

Out of scope:
- Fixing or wiring up any of the three unused codes - per explicit
  direction, no production changes without opening a separate,
  investigated bug first
```

## Evidence Precedence

Every claim states its own highest supporting evidence level
directly (runtime vs. source inspection) - none blended.

## Exit Criteria — Status

Note on what "status: satisfied" means here: each checkbox reflects
what this session reports having done - a claim, not independent
confirmation.

- [x] Inventory complete
- [x] Audit Scope declared
- [x] Runtime Evidence provided
- [x] Confidence stated
- [x] Known Limitations documented
- [x] Backlog updated (1 new investigation item)
- [x] Evidence Summary complete
- [x] Evidence Precedence applied
- [x] No claim exceeds available evidence

Module Audit: Reported complete within this session, pending
independent verification.
