# AUDIT_METHODOLOGY.md

**Status: standing rules for how any audit/inventory work in this
project is conducted and reported. Adopted after a real error (an
inventory pass searched only src/, missed tools/, and wrongly
concluded BACKEND_CODES was dead code) demonstrated the exact failure
mode this rule exists to prevent.**

---

## Audit Scope Declaration

Every inventory report must explicitly state the directories included
in the search (e.g. src/, tools/, scripts/, tests/) before presenting
conclusions about unused/dead/dormant code.

A conclusion like "X is unused" must be phrased as "Within
<directories searched>, no usages of X were found" - not as an
unscoped, project-wide claim - unless the search genuinely covered
every source directory in the project and that full coverage is
itself stated.

This applies retroactively: any existing audit document making an
unscoped "unused"/"dead code" claim should be corrected to state its
actual search scope when next revised, per this project's own
Documentation Follows Reality principle.

## Evidence Precedence

When evidence of different kinds could conflict, precedence is:

1. Runtime verification (a test actually run, output observed directly)
2. Independent tests / CI (run by a party other than whoever made the claim)
3. Source inspection (reading code, grep, static analysis)
4. Reasoned inference (a conclusion drawn from the above, not directly observed)

Every conclusion in an audit report must state the highest level of
evidence that actually supports it — not blend levels together as if
they carried equal weight. A claim backed only by source inspection
must not be phrased as if it had been runtime-verified, even if the
author is confident the code would behave that way if run.

## Standard Closing Template

Every audit document should close with a block in this shape:

```
Evidence Summary
------------------
Verified by runtime:
- <e.g. specific test names/results actually executed>

Verified by source inspection:
- <e.g. specific grep/read findings, not run>

Not verified:
- <claims made but not backed by either of the above>

Out of scope:
- <explicitly not attempted, and why>
```

This lets a reader see immediately what was proven by execution,
what was inferred from reading code, and what was never examined at
all — without needing this project's own conversational history to
tell the difference.

## Audit Exit Criteria

No audit is considered complete unless all of the following are
satisfied:

- Inventory complete
- Audit Scope explicitly declared
- Runtime Evidence provided, or an explicit statement of why it is
  unavailable
- Confidence stated
- Known Limitations documented
- Backlog updated where relevant
- Evidence Summary complete
- Evidence Precedence applied
- No claim exceeds the level of evidence actually available for it

This gives every audit an objective stopping point, and prevents
quality drifting between one audit report and the next.

## "Complete" Means Reported, Not Independently Confirmed

Satisfying the Exit Criteria above means an audit report claims to
have done all of it — not that an independent party has re-run the
tests, reviewed the actual commit/diff, or otherwise confirmed the
claim. Every audit's own closing statement must say so explicitly:
"Reported as complete within this session; pending independent
verification" — not an unqualified "Complete." This mirrors the same
standard already applied to BUG-SA-001/BUG-SA-002's own status
("Fixed, pending independent verification") — applied here to every
audit as a whole, not only to individual bug fixes.

## Standard Header Template

Every audit document should open with a block in this shape:

```
Audit Scope
------------
Directories searched:
- <list>

Excluded:
- <list, if any>

Search method:
- <e.g. Symbol references / Runtime verification / Manual inspection>

Confidence:
- High / Medium / Low
```

## Claims Must Describe What Was Observed, Not What Is Believed True for All Cases

A finding like "X is correct by construction" or "Y never happens"
overstates what a finite number of exercised test scenarios can
establish. Prefer: "No violations were observed in the scenarios
exercised in this audit" over an unconditional claim - unless the
claim is backed by an actual proof or exhaustive review of the
relevant algorithm, not a handful of test runs.
