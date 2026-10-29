# UR Language v1.0 — Final Consistency Review

**Status: VERIFICATION REPORT. Zero code changes. This is the last
check before UR Language v1.0's Final Specification can be signed
off, per explicit instruction: confirm no feature is (a) in the spec
but not the implementation, (b) in the implementation but not the
spec, or (c) documented in an example that doesn't actually compile.**

---

## 1. §3 ("What Is IN v1.0") — Every Claim Re-Verified by Direct Execution

All 11 claims tested fresh, end-to-end (parse → typecheck → lower →
C Backend → run), not assumed from prior sessions:

| Claim | Result |
|---|---|
| Variables | ✅ MATCH (5) |
| Functions, 0-arg | ✅ MATCH (9) |
| Functions, N-arg (explicit types) | ✅ MATCH (5) |
| `if`/`else` statement | ✅ MATCH (1) |
| `while`/`break`/`continue` | ✅ MATCH (5) |
| Arrays | ✅ MATCH (2) |
| Structs (constructor inference) | ✅ MATCH (7) |
| `type` alias (declaration) | ✅ MATCH (1) |
| `byte` | ✅ MATCH (200) |
| Char literals | ✅ MATCH (1) |
| Tier 2 rejected in ordinary code (ADR-1) | ✅ confirmed (`TY1001`) |

**Result: PASS.** No drift between §3's claims and actual behavior.

## 2. §4 ("Moved to v1.1") — Confirmed Still Correctly Rejected

| Item | Result |
|---|---|
| `for`/`in` | ✅ still rejected (Lowering) |
| `if`-expression | ✅ still rejected (Lowering) |
| Named-type annotation (struct) | ✅ still rejected (`TY2002`) — **note**: an earlier pass of this review incorrectly flagged this as a false failure, due to a bug in the review's OWN verification script (it checked parse/lower but skipped typecheck); caught and corrected within this same review before being reported, not left in |
| Named-type annotation (alias) | ✅ still rejected (`TY1001`) — same script-bug correction as above |

**Result: PASS**, after self-correcting one methodology error in this
review's own tooling.

## 3. NEW FINDING (severity: real, not cosmetic): `enum` is silently accepted as meaningless code, not rejected

**This was not previously tested by any prior session.** §4/§11 list
`enum` as "deferred to 1.1," implying an attempt to use it would be
rejected (matching `for`'s own clean rejection). Direct testing found
otherwise:

```
enum Color
  Red
  Blue
end
function main(): int
  return 1
end
```

- **`enum` is not a reserved keyword in the Lexer at all** — it
  tokenizes as a plain `IDENTIFIER`.
- The Parser accordingly parses `enum`, `Color`, `Red`, `Blue` each as
  their own, separate, meaningless top-level `ExpressionStatement`
  (a bare identifier reference, value discarded).
- **Zero diagnostics at any stage** — parse, typecheck, and Lowering
  all succeed. The generated C compiles and RUNS successfully (exit
  code confirmed).
- **The user's `enum` declaration is silently discarded in its
  entirety**, with no indication anything was wrong — worse than a
  clean rejection, since the program appears to succeed while not
  doing anything resembling what the user wrote.

**This is a real inconsistency between what §4/§11 imply (enum
attempts are rejected, matching `for`) and actual behavior (enum
attempts are silently swallowed).** Recommend: either (a) reserve
`enum` as a keyword now and have it cleanly rejected with a clear
"deferred to 1.1" message, matching `for`'s own precedent — a small,
contained fix — or (b) explicitly document in `KNOWN_LIMITATIONS.md`
that `enum` is not a reserved word and using it produces silent,
unrelated behavior, not a clear error, until 1.1. **Not fixed in this
review** — flagged for a decision, per this review's own scope (found
issues, not fix them inline).

## 4. NEW FINDING (severity: documentation gap, not a defect): `byte`, char literals, and `type` alias are implemented but absent from user-facing docs

`docs/USAGE_EXAMPLES.md` and `docs/WASM_BACKEND_GUIDE.md` contain zero
mentions of any of the three features implemented this cycle. A user
reading only the `docs/` directory would not learn these exist.

**Recommend**: add one example each to `USAGE_EXAMPLES.md` before
declaring v1.0's documentation complete — **not done in this review**,
flagged for a decision alongside Finding 3.

## 5. §11 / Error Codes — Re-Verified

- §11's struct/enum split (this cycle's own correction) re-confirmed
  accurate: structs work, enum does not (though see Finding 3 above
  for HOW it doesn't work).
- Error code tables (§10.1/§10.2) re-checked against actual usage —
  `LE005`/`PE008` both confirmed present and correctly described.

## 6. `docs/USAGE_EXAMPLES.md`'s 6 Existing Examples — Re-Verified

All 6 re-executed fresh via the WASM Backend pipeline (not just C):
identical, correct results for every one (14, 1, 55, 78, 150, 8) — no
drift.

---

## Overall Verdict

**UPDATE (per reviewer's "Conditionally Approved" decision): both
findings have since been resolved.**

1. **Finding 3 (`enum` silent acceptance) — FIXED.** `enum` now
   produces a clear `PE009` diagnostic (`"enum declarations are not
   supported in UR 1.0. This feature is planned for a future
   version."`) instead of silently parsing as meaningless expression
   statements. Confirmed: the rest of the file still parses correctly
   after recovery; no false positive for `enum` used as an ordinary
   variable name. Permanent regression tests added.
2. **Finding 4 (missing examples) — FIXED.** `docs/USAGE_EXAMPLES.md`
   now includes `byte`, char literal, and `type` alias examples. **A
   real error was caught and corrected during this exact fix**: the
   first draft of the `type` alias example incorrectly used the alias
   name (`Age`) as an explicit type annotation, which does NOT work
   (confirmed: `TY1001: unknown type 'Age'`) — corrected to use `int`
   directly, with the limitation stated explicitly in the example's
   own note, rather than leaving an example that doesn't actually
   compile.

**Original findings below, preserved for the historical record:**

**Two real findings, neither a spec-vs-implementation contradiction
in the sense originally feared (no feature claimed working that
isn't, no feature silently added that isn't documented as a
capability) — but both genuinely need a decision before sign-off:**

1. `enum`'s silent-acceptance behavior (Finding 3) — a real quality
   issue, small fix available.
2. Missing user-facing examples for 3 already-correct features
   (Finding 4) — a documentation completeness gap, not a correctness
   one.

**Recommended status, per the reviewer's own three-tier framing**:
not yet "signed off" — **one more short cycle** (fix or document
Finding 3; add 3 examples for Finding 4) closes both gaps with
minimal, contained work, after which this specific consistency
concern should be fully resolved.
