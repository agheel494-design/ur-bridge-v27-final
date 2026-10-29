# ANSWERS_ROUND_2.md — Acceptance Criteria, Import Completeness, Cross-Language Import, Bug vs Future Work Classification

Every answer backed by real, live evidence performed this session,
or an explicit statement that no evidence exists to answer a
non-technical question.

---

## Q1: Is the reference program's success across all 10 languages part of the OFFICIAL acceptance criteria for v1.0?

Cannot be answered from the codebase - this is an organizational
decision, not a technical fact. Searched directly for any official
"acceptance criteria" or "release criteria" document for UR 1.0 -
none exists anywhere in this project. This question requires an
explicit decision from whoever owns the release process, not
something derivable from source inspection or test results.

## Q2: Is the import system in UR 1.0 complete - can modules/libraries be imported AND their functions actually used?

No - the RESULT is confirmed: import resolution works, but calling a
function from an imported module fails with SE1002.

**Corrected, per direct feedback**: the root-cause explanation below
is the strongest available explanation from a direct code search,
not proof that it is the only possible cause. Searched directly for
any code path connecting ModuleRegistry (the only real
import-resolution mechanism found) to analyze()/typeCheck() (the
Semantic Analyzer/Type Checker) - no such connection was found
anywhere in the codebase searched. This is consistent with, but does
not rule out, other explanations (e.g. a separate linking stage not
yet located, a feature flag, or a different intended integration
point not searched for). **This explanation requires confirmation
from the maintainers before being treated as the confirmed root
cause** - stated as the strongest available finding from this
session's own search, not as a proven, exclusive cause.

## Q3: Is cross-language import (e.g. a Japanese program importing an English- or Arabic-authored library) supported and intentional in this version, or deferred?

**Import RESOLUTION specifically**: confirmed, by direct, live test,
that module-name resolution does not depend on the keyword language
- a Japanese program successfully resolves a library written in
English, and separately, one written in Arabic (`valid: true`, zero
diagnostics, for both combinations, tested live this session).

**Corrected, per direct feedback**: this result must be scoped
precisely to resolution — it does NOT mean cross-language import is
"supported" in the sense a user would expect. Since import *usage*
(Q2) fails for same-language imports already, it necessarily fails
identically for cross-language ones too - there is no additional,
cross-language-specific finding here beyond "resolution is
language-agnostic." Cross-language import cannot be called supported
as a whole while the underlying usage gap remains.

## Q4: Is the import-usage gap a Bug or Future Work?

**Corrected classification, per direct feedback: Needs Maintainer
Decision — neither Bug nor Future Work asserted as final.**

The evidence available establishes clearly that the feature is
incomplete for an end user (import resolves, usage fails) — that
part is not in question. What the evidence does NOT establish is
*why*, in the sense needed to classify it: no official specification
or maintainer statement was found saying cross-module function
usage is deferred to a later version. Without that, choosing between
"Bug" and "Future Work" would be an inference presented as a
finding, not something the evidence itself settles.

The architectural comparison to the already-logged SWITCH/TRY-CATCH
finding (offered previously as reasoning toward "Future Work") is a
real, relevant observation — but is a similarity in shape, not
proof of the same classification. It is offered here as
context for the maintainers' own decision, not as a substitute for
one.

**Recorded in `docs/architecture/COMPILER_BACKLOG.md` as: status
Open, classification Needs Maintainer Decision** — not fixed, not
started, and not labeled Bug or Future Work until an explicit
maintainer statement or specification resolves it.
