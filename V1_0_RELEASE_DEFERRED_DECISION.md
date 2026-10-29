# V1_0_RELEASE_DEFERRED_DECISION.md

**Status: OFFICIAL. UR Language v1.0 general release is DEFERRED.**

This is not a statement about the language's own quality — the
compiler, runtime, and diagnostics are confirmed stable. It reflects a
single, explicit management decision: user experience must be
excellent from day one, not "good enough to ship." Announcing v1.0
and then losing developer trust would cost far more than waiting.

**Refinement (this update): deferring v1.0 does NOT mean freezing all
development.** Two parallel tracks:

## Track A — Mandatory Before Release (blocks v1.0)

This is what actually gates the release:

- Successful installation on Windows
- Successful IDE launch
- Successful CLI operation
- Successful `run`
- Successful `build`
- A successful new-user test on a genuinely clean machine
- Fixing anything an independent field tester finds

**v1.0 will not be announced until Track A succeeds 100% on a real,
clean Windows machine, tested by an independent party.**

## Track B — Parallel Research and Design (does not block v1.0)

A separate effort can begin design and research work now, WITHOUT
merging any of it into the release:

- Advanced IDE interface design
- Python import layer design
- Package system design
- Debugger design
- Package Registry design

**None of this is merged until Track A is fully closed.**

**UPDATE (resolved, per explicit Priority 0 directive)**: a real git
repository now exists (`main`/`develop`/`feature/*`/`hotfix/*`, an
initial baseline commit, and an example `feature/python-import-design`
branch demonstrating the Track B mechanism) — see
`CONTRIBUTING.md`'s own "Git Branching Policy" section for the full,
current policy. **Honest, remaining gap**: creating the actual
private GitHub repository and enabling real, server-side branch
protection (making "no direct commits to main" and "review required"
technically unbypassable, not just followed policy) requires GitHub
network/account access this development environment does not have
(confirmed directly — `api.github.com` is unreachable from here).
This is a real, outstanding step for someone with that access; the
local repository and its branching structure are ready for it.

---

## Priority 1 — Platform Stability (blocks everything else; this is Track A above)

**No new features are added until all of the following are
confirmed:**

- CLI stability
- IDE stability
- Successful installation on Windows
- Successful first run on a genuinely clean machine
- Successful build
- Successful updates

This is the current, active priority. Nothing in Priorities 2-4 below
starts until this is confirmed — including IDE feature work and
language-interop work, both of which are real, valuable future
directions but are explicitly NOT to be started yet.

## Priority 2 — IDE Development (after Priority 1; design/research is Track B now, merge blocked until Track A closes)

The IDE is the language's primary interface going forward and should
move toward VS Code-level ease of use:

- One-button Run
- One-button Build
- Debugger
- Integrated terminal
- File Explorer
- Project tabs
- Autocomplete
- Hover information
- Go to Definition
- Rename Symbol
- Live diagnostics
- Code formatter
- User settings
- An extension manager (future)

## Priority 3 — Interop With Other Languages (after Priority 1; design/research is Track B now, merge blocked until Track A closes)

Considered one of UR's potentially strongest features. Order:

1. **Python** - e.g. from python import math / from python import
   numpy / from python import pandas
2. **JavaScript / Node.js**
3. **C**
4. **Rust**
5. **.NET**

**Explicit strategic recommendation for after v1.0 stabilizes**:
Python library interop (NumPy, Pandas, TensorFlow, etc.) should be the
single highest priority of this group - it lets UR draw directly on
Python's existing, massive ecosystem instead of rebuilding equivalent
functionality from scratch, giving the language real value very
early.

## Priority 4 — Ecosystem (after Priority 1)

- Package Manager
- Registry
- Documentation
- Website
- Examples
- Community

## Priority 5 — Quality Policy (applies at every stage, starting now)

No pull request is merged unless it:

- Passes all tests
- Causes no regression
- Is fully documented
- Has been reviewed by at least two engineers

---

## Release Policy — v1.0 Will Not Be Announced Until

- Installation works on Windows on the first attempt
- The IDE works immediately
- A first program runs in under one minute
- No manual configuration is required from the user
- All examples work
- Documentation is complete
- Field testing has passed with multiple independent users

## What Is Currently Confirmed vs. Still Needed

**Confirmed** (per this project's own prior stabilization and
field-test rounds): compiler stability, runtime stability, diagnostics
quality, a real CLI, a real minimal IDE backend, a gcc-free
interpreter execution path for the core language, and a hardened,
independently-verifiable installer build process (a real build stamp
and an automated pre-packaging safeguard).

**Still needed, and blocking**: an actual field test, on a genuinely
clean Windows machine, of a freshly-built installer produced by the
now-hardened installer/windows/build-installer.mjs - by an
independent party with real Windows access, which this development
environment does not have. This is the one remaining, concrete gate on
the Release Policy checklist above that cannot be closed from here.

## Final Administrative Decision (as announced)

"We will not release v1.0 until the field test succeeds 100% on a
clean Windows machine. In return: we will not stop research and
development — but any new feature stays on independent branches and
does not enter the first release until stability is complete. This
way progress never stops, and we don't risk the first release's
stability."

## Closing Note (as given)

The goal is not only to release the first Arabic-friendly programming
language, but to release a language a developer trusts from the first
minute. Quality matters more than release speed. Every new feature
should make UR simpler, faster, and more reliable - never more
complex.
