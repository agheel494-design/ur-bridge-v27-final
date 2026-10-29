# SEMANTIC_ANALYSIS_AUDIT.md

**Audit Scope Declaration (per AUDIT_METHODOLOGY.md): usage searches
in this document were scoped to `src/compiler/semantic/` and direct
pipeline execution (lex/parse/analyze/typeCheck/lowerToIR) - not a
full-project search, since the goal was behavioral tracing of
specific reproducers, not a codebase-wide usage census. This scope
is now stated explicitly per this project's own standing rule.**

**Status: audit only, per explicit direction. No code changes. Based
on direct inspection of src/compiler/semantic/, not assumed.**

---

## Real Inventory: 17 Codes Defined, 12 Actually Used

Every code in diagnostics.ts's own CODES object was checked against
real usage in index.ts (the actual analyzer):

| Code | Rule | Status |
|---|---|---|
| SE1001 UNDEFINED_SYMBOL | Variable used before definition / doesn't exist | Implemented, used (2 sites) |
| SE1002 UNDEFINED_FUNCTION | Call to a function that doesn't exist | Implemented, used |
| SE1003 UNDEFINED_TYPE | Reference to an undefined type name | DEFINED BUT NEVER USED - a real gap |
| SE2001 DUPLICATE_VARIABLE | Variable redeclared in the same scope | Implemented, used (2 sites) |
| SE2002 DUPLICATE_FUNCTION | Function redeclared | Implemented, used (2 sites) |
| SE2003 DUPLICATE_PARAM | Duplicate parameter name in one function | Implemented, used |
| SE2004 DUPLICATE_MODULE | Duplicate module declaration | Implemented, used |
| SE2005 DUPLICATE_STRUCT | Struct redeclared | Implemented, used |
| SE2006 DUPLICATE_FIELD | Duplicate field name in one struct | Implemented, used |
| SE3001 ARITY_MISMATCH | Wrong number of call arguments | Implemented, used (3 sites) |
| SE3002 NOT_A_FUNCTION | Calling something that isn't callable | Implemented, used |
| SE4001 ASSIGN_TO_CONST | Assignment to a const | Implemented, used |
| SE4002 ASSIGN_TO_PARAM | Assignment to a function parameter | Implemented, used |
| SE5001 BREAK_OUTSIDE_LOOP | break outside a loop | Implemented, used |
| SE5002 CONTINUE_OUTSIDE_LOOP | continue outside a loop | Implemented, used |
| SE5003 RETURN_OUTSIDE_FN | return outside a function | DEFINED BUT NEVER USED - a real gap |
| SE6001 INVALID_FIELD_TYPE | Struct field with a non-primitive type | Implemented, used |

## Real Finding: 2 of 17 Defined Codes Are Dead

SE1003 (UNDEFINED_TYPE) and SE5003 (RETURN_OUTSIDE_FN) exist in
diagnostics.ts's own CODES object but are never referenced anywhere
in index.ts. This means:

- Using an undefined type name today does not produce this specific,
  named error - either it's silently accepted, caught by a
  differently-coded path, or caught later (in the type checker, under
  a different code) - not confirmed which, without further, separate
  investigation (out of scope for this pass, which reports the
  inventory, not the runtime behavior for each gap).
- A bare return outside any function - same open question.

## Real Finding: Argument TYPE Checking Lives in the Type Checker, Not Here - By Design, Not a Gap

Argument count mismatch (SE3001, ARITY_MISMATCH) is semantic's own
job. Argument type mismatch (CALL_ARG_TYPE_MISMATCH, TY5002) is
confirmed to live in src/compiler/typesystem/checker.ts instead -
this is a real, intentional division of responsibility (semantic
analysis checks structure/existence; the type checker checks types),
not a missing feature in semantic analysis itself.

## What Was NOT Audited (disclosed scope limit)

- Whether scope resolution itself (confirmed to exist - a real
  lexical scope stack in symbol-table.ts) correctly handles every
  real nesting case - this audit inventoried WHICH rules exist by
  code, not whether each rule's own internal logic is fully correct
  for every input.
- Whether SE1003/SE5003's own absence causes a real, user-visible bug
  today - only confirmed that the specific, named code is never
  emitted; not confirmed what actually happens instead.

## Investigation Completed (Recommended Step 1, Actually Run)

Both scenarios were run through the real lex()/parse()/analyze()/
typeCheck() functions on genuinely constructed UR programs. Real,
observed results:

### SE1003 (UNDEFINED_TYPE) — SAFE today, but reclassified as Dormant Diagnostic, not Dead Code

**Correction, per direct feedback**: concluding "remove as dead code"
was premature. What was actually confirmed is narrower: for the
*current* language surface, `let x: NoSuchType = 5` is caught by the
type checker (TY1001) instead of SE1003. This does NOT establish
that SE1003 will remain unnecessary once future language features
exist that might need a semantic-level type-existence check *before*
the type checker runs (e.g. generics, interfaces, type aliases,
import-based types) — none of which exist yet, so this is
speculation about the future, not a finding about today.

**Corrected classification: Dormant Diagnostic** — confirmed unused
and safely superseded *for the current language surface*, but not
confirmed permanently unnecessary. Do not remove until it becomes
clear, at a later point when those future features are actually
built, that no phase of analysis will ever need it.

### SE5003 (RETURN_OUTSIDE_FN) — REAL GAP, confirmed via direct test

```
return 5
```

(a bare `return` at the top level, no enclosing function at all)

**Zero diagnostics of any kind fire** - not from the parser, not from
semantic analysis. This program is silently accepted as valid today.
This is a real, user-facing gap, not superseded by any other check
(confirmed: nothing else in the pipeline catches this). Recommend:
implement SE5003 for real - this one needs actual code, unlike
SE1003.

## Recommended Next Steps (informed by the real investigation above, not the original inventory alone)

1. ~~Investigate the two dead codes directly~~ — Done, see above.
2. **SE1003**: no action now. Revisit only once future language
   features (generics/interfaces/type aliases/import types) are
   actually built and it becomes clear whether any analysis phase
   needs a semantic-level check ahead of the type checker.
3. **SE5003**: see `SEMANTIC_ANALYSIS_BACKLOG.md` — logged as
   BUG-SA-001, not fixed immediately. Continuing the broader audit
   may surface more findings; fixes are prioritized after the full
   backlog exists, not in discovery order.

