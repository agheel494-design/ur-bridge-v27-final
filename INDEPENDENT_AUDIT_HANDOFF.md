# Independent Repository Audit — Handoff Package

**Status: prepared FOR the independent auditor, not BY them. Nothing
in this document constitutes the audit itself — it exists to make
that audit faster and more thorough by pointing to exact files,
exact commands, and exact claims to check, rather than requiring the
auditor to reconstruct this conversation's own history from scratch.**

**Prerequisite the auditor must confirm first, independently**: this
must be run by someone who did NOT write any of the code, tests, or
prior reports referenced below — per the reviewing party's own
explicit requirement that developer and auditor be different parties.

---

## 1. Documentation ↔ Actual Files Match

| Claim | File to check | What to verify |
|---|---|---|
| `byte`, char literals, `type` alias are implemented | `src/compiler/typesystem/types.ts`, `src/compiler/frontend/lexer.ts`, `src/compiler/frontend/ast.ts`, `src/compiler/frontend/parser.ts` | Search for `T_BYTE`, `CHAR_LIT`, `TypeAliasDecl` — confirm they exist and are wired into the type checker/lowering, not just declared. |
| `enum` produces `PE009`, not silent acceptance | `src/compiler/frontend/parser.ts` | Search for `PE009` — confirm the check exists in the top-level dispatch loop, not just in a comment. |
| The `async`/`const`/etc. modifier fix (`PE010`) exists | `src/compiler/frontend/parser.ts` | Search for `PE010` — this was the fix found to be UNDOCUMENTED until directly investigated; confirming it exists is itself a test of whether this handoff package's own claims hold up. |
| Tier 2 ABI types are FFI-only (ADR-1) | `src/compiler/typesystem/type-env.ts` (should NOT list `i8`/`i32`/etc.), `src/ffi/abi/types.ts` (SHOULD list them) | Confirm the split is real, not just documented. |
| `for`/`if`-expression are rejected, not implemented | `src/compiler/codegen/lower-to-ir.ts` | Search for `ForStatement` and `ConditionalExpression` — confirm both hit the generic `CG1001` rejection path, with no implementation elsewhere. |

## 2. Clean-Clone Test Re-Run

```bash
git clone <repository-url> ur-audit-clone
cd ur-audit-clone
npm install
npx tsc --noEmit -p tsconfig.json    # expect: 0 errors
npx vitest run                        # expect: matches the count below
```

**Note on this environment's own history**: every test count in this
conversation (including `2374/2374`) was produced using a disclosed,
non-real Vitest-compatible substitute
(`RC2_VALIDATION_REPORT.md`/`EXTERNAL_VERIFICATION_PROCEDURE.md`
explain why: this sandboxed environment cannot reach the npm
registry). **A real `npx vitest run` in the auditor's own,
network-connected environment has never actually been performed for
this codebase, at any point in this entire conversation.** This is
arguably the single most important gap this audit closes — not just
confirming the number, but confirming it FOR THE FIRST TIME with the
real tool.

## 3. Do the Reported Numbers Match a Real Run?

Specifically check:
- Does `npx vitest run` report `2374` total tests (or explain any
  difference)?
- Does `tests/conformance-suite.test.ts` show `11` passing?
- Run it twice, exactly as `REPRODUCIBILITY_CHECK.md` describes, and
  confirm the same reproducibility this document claims — with the
  REAL tool this time, not the substitute.

## 4. Does Every Documented Fix Actually Exist in Code?

Cross-reference every entry in `CHANGELOG.md` from
`language-freeze-implement-phase-1` onward against the actual diff it
claims. Since this environment has no `.git` history, "the diff"
means: does the described function/check/file actually exist, with
the described behavior, confirmed by writing a throwaway `.ur` test
case and running it through the pipeline directly? This is exactly
the same methodology used throughout this conversation — the audit's
job is to redo it independently, not trust the prior results.

## 5. Is Everything Deferred to v1.1 Actually Absent from v1.0?

| Deferred item | Confirm absent by |
|---|---|
| `for` | `function main(): int\n  for i in 1 to 3\n    return i\n  end\nend\n` should FAIL at Lowering (`CG1001`), not run. |
| `if`-expression | `function main(): int\n  let x = if 1 == 1\n    1\n  else\n    0\n  end\n  return x\nend\n` should FAIL at Lowering (`CG1001: 'ConditionalExpression'...`), not run. (Confirmed directly while preparing this document: this exact snippet reaches Lowering and is rejected there, as expected — an earlier draft of this row used invalid brace syntax that failed at Parse instead, which would have been a misleading check; corrected before handoff.) |
| Named-type annotations | `struct P\n  x: int\nend\nfunction main(): int\n  let p: P = P(1)\n  return p.x\nend\n` should FAIL at typecheck (`TY2002`), not run. |
| Contextual type inference | `function main(): int\n  let x = 5\n  if !x\n    return 1\n  end\n  return 0\nend\n` (unannotated `x` defaults to `Int`) should FAIL at typecheck (`TY3002: operator '!' cannot be applied to Int`), confirmed directly while preparing this document — NOT run correctly. |

## What This Package Cannot Do

Prepare questions and locations — it cannot answer them. Every row
above requires the auditor's own direct execution against the actual
repository, by design. If any row's actual result differs from this
document's own expectation, that is itself a finding to report, not
a hint to search harder for a way to make it match.

## Status Transition This Audit Enables

If every check above passes independently: `Freeze Candidate` →
`Verified Release Candidate`, per the reviewing party's own proposed
terminology. If any check fails: the specific failing item returns to
active work, scoped exactly as narrowly as the failure itself — not a
reason to distrust every other, independently-unrelated claim.
