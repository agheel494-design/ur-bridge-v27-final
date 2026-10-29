# PARSER_AUDIT.md

```
Audit Scope
------------
Directories searched:
- src/compiler/frontend/
- tools/
- scripts/
- tests/

Excluded:
- docs/, examples/, archived/

Search method:
- Symbol references (grep -c per code, full corrected scope)
- Runtime verification (real UR programs through lex()/parse())

Confidence:
- High (usage counts and the 3 gap-closing tests below)
```

---

## Inventory

11 ParseError codes total (PE001-PE011). All 11 confirmed used at
least once in parser.ts itself - 0 dormant codes in the Parser,
unlike Semantic/Type/URPM which each had at least one.

## Coverage Before This Audit

| Code | Real usage count | Tested before this audit |
|---|---|---|
| PE001 | 9 | Yes |
| PE002 | 9 | Yes |
| PE003 | 9 | Yes |
| PE004 | 2 | Yes |
| PE005 | 4 | No |
| PE006 | 2 | No |
| PE007 | 2 | No |
| PE008 | 2 | Yes |
| PE009 | 2 | Yes |
| PE010 | 2 | Yes |
| PE011 | 2 | Yes |

## Runtime Evidence — Gap-Closing Tests

Three real UR programs run through the actual lex()/parse() pipeline:

```
PE005 - type = int          -> ["PE005"]
PE006 - let = 5              -> ["PE006"]
PE007 - let x: int            -> ["PE007", "PE001"]
```

All three fired correctly. PE007's own second code (PE001) is a
real, observed recovery-cascade - the parser continues after the
missing = and produces a second, related error rather than crashing
or silently stopping; this is expected parser-recovery behavior, not
a bug.

Permanent test added: tests/compiler/frontend/parser-audit-gaps.test.ts,
3/3 passing.

## Known Limitations

- Only each code's OWN trigger condition was tested, not every
  possible surrounding context each code might appear in.
- Parser recovery behavior beyond the one cascade observed was not
  systematically explored.
- Whether the parser's own AST output is otherwise fully correct for
  every valid UR program is a separate question, out of scope here.

## Backlog

No new items - 0 dormant codes, 0 verified bugs found. The 3 coverage
gaps identified are now closed by this audit's own test.

## Evidence Summary

```
Evidence Summary
------------------
Verified by runtime:
- PE005, PE006, PE007 - all three fire correctly on real reproducers
  (tests/compiler/frontend/parser-audit-gaps.test.ts, 3/3)
- PE007's own real recovery-cascade behavior (produces PE001 as a
  second, related error, not a crash)

Verified by source inspection:
- All 11 PE codes counted directly in parser.ts (grep -c), full
  corrected scope (src/, tools/, scripts/, tests/) - 0 dormant

Not verified:
- Parser recovery behavior for other error combinations beyond the
  one cascade observed
- Full AST correctness for valid programs beyond what Semantic/Type
  audits already exercised indirectly

Out of scope:
- Systematic recovery-behavior audit (a separate, deeper undertaking)
```

## Evidence Precedence

Every claim above states its own highest supporting evidence level
directly (runtime vs. source inspection) - none blended.

## Exit Criteria — Status

**Note on what "status: satisfied" means here**: each checkbox below
reflects what this session reports having done - a claim, not
independent confirmation. "Verified by runtime" elsewhere in this
document means a test was run and its output observed within this
session, not that an independent party (a reviewer, CI) has
re-confirmed that output.

- [x] Inventory complete
- [x] Audit Scope declared
- [x] Runtime Evidence provided
- [x] Confidence stated
- [x] Known Limitations documented
- [x] Backlog updated (none needed)
- [x] Evidence Summary complete
- [x] Evidence Precedence applied
- [x] No claim exceeds available evidence

Parser Audit: Reported as complete within this session; pending
independent verification.
