# MODULE_UNUSED_CODES_INVESTIGATION.md

**No production code was modified during this investigation.
Investigation only, per explicit instruction. No diagnostics
changed, no code deleted, no bugs opened (none found).**

```
Audit Scope
------------
Directories searched:
- src/compiler/module/ (all 5 files)
- src/compiler/frontend/ (parser.ts - to test named-import syntax
  support directly)
- tools/, scripts/, tests/
- docs/ (all .md files, including LANGUAGE_SYNTAX_1_1_SPEC.md)

Search method:
- Symbol references (grep, full scope)
- Runtime verification (real UR programs through lex()/parse(),
  and through checkExports()/ModuleRegistry.resolveAll())
- Documentation search (official language spec + all architecture
  docs, for a documented future-feature reference)

Confidence:
- High for MD1002/MD1003 (direct parser-level evidence)
- Medium-High for MD1006 (source-level evidence; no live UR program
  could be constructed to test the runtime path directly, since
  producing it requires modifying the resolver's own internal
  error-kind value, which is out of scope - no code changes)
```

---

## MD1002 (MISSING_EXPORT)

**Q1 - Runtime execution path that could trigger it?** No path
found. `checkExports()` (the only function referencing this
constant... actually: zero references to `MCODES.MISSING_EXPORT`
anywhere — the constant itself is defined but never read from
anywhere in the 5-file module scope).

**Q2 - Indirect call (dispatch/registry/reflection)?** No. Searched
for `Object.values(MCODES)`, `Object.keys(MCODES)`, `MCODES[...]`
(bracket/dynamic access) across `src/`, `tools/`, `scripts/` — zero
results. No dispatch table or reflection-based access exists.

**Q3 - Documented future feature?** Not confirmed with independent
documentation. The only related text is a general comment in
`export-checker.ts` (lines 44-45) stating "all top-level declarations
are implicitly exported... Explicit `export` keyword support is
deferred to Phase 2" — this comment is NOT tied to the
`MISSING_EXPORT` constant specifically by name, and no reference to
this feature or "Phase 2" was found anywhere in
`LANGUAGE_SYNTAX_1_1_SPEC.md` (the official language spec) or any
other architecture document searched. This is an internal code
comment, not an independently-documented roadmap item.

**Q4 - Genuinely unreachable?** **Yes, with direct runtime evidence.**
`MISSING_EXPORT`'s own real-world purpose (per its name) would be:
flagging that a specifically-named import (`import { x } from
"mod"`) references a name `mod` doesn't export. Direct test: this
import syntax was fed to the real parser.

```
Source: import { fn } from "./mod.ur"
Result: Parser errors: ["PE001","PE001","PE001"]
```

The named-import syntax this code would need to check is rejected at
the PARSER level, before any module-resolution logic runs at all. No
UR program expressible in the current grammar can reach this check.

**Conclusion: Unreachable** — direct parser-level evidence (not
merely absence of a test), independent of any comment or claim about
future plans.

## MD1003 (UNRESOLVED_IMPORT)

**Q1 - Runtime execution path?** No path found — zero references to
`MCODES.UNRESOLVED_IMPORT` anywhere in the 5-file scope.

**Q2 - Indirect call?** No — same dispatch/reflection search as
MD1002, zero results.

**Q3 - Documented future feature?** Same finding as MD1002 — no
independent documentation ties this constant to a specific roadmap
item by name.

**Q4 - Genuinely unreachable?** **Yes, same direct evidence as
MD1002.** This code's own likely purpose (an import resolves to a
path, but a specifically-named symbol within it can't be found) also
depends on the named-import syntax (`import { x } from ...`), which
is rejected at the parser level (see MD1002's own test above — same
reproducer, same result). Additionally confirmed by source
inspection: `ImportResolver.resolve()`'s own real "missing" case
(a module path that doesn't resolve at all) maps to `MD1005`
instead, not `MD1003` — so even the module-path-level "missing"
case, which doesn't require named imports, does not produce this
code either.

**Conclusion: Unreachable** — direct parser-level evidence.

## MD1006 (AMBIGUOUS_IMPORT)

**Q1 - Runtime execution path?** Partially different from MD1002/MD1003.
`registry.ts` line 81 DOES reference this constant, in a real,
executing code path:
```
code: e.kind === "circular" ? "MD1004" : e.kind === "missing" ? "MD1005" : "MD1006"
```
This line runs for every resolution error. Whether it can ever
actually select the `"MD1006"` branch depends entirely on whether
`e.kind` can ever be a value other than `"circular"` or `"missing"`.

**Q2 - Indirect call?** No separate dispatch/registry pattern beyond
the ternary above.

**Q3 - Documented future feature?** No independent documentation
found tying "ambiguous import" to a specific roadmap item, same
search as above (LANGUAGE_SYNTAX_1_1_SPEC.md and all architecture
docs checked, zero results).

**Q4 - Genuinely unreachable?** **Source inspection strongly
suggests yes, but with a documented remaining gap in this
investigation's own evidence.** `ImportResolverError`'s own `kind`
type is defined as `"missing" | "circular" | "ambiguous"` — but a
direct search of every `return`/throw site in
`import-resolver.ts` (the only file that could produce this type)
found exactly two producers: one for `"missing"` (in `resolve()`)
and one for `"circular"` (in `resolve()`, when a module is already
in `this.resolving`). **No code path anywhere in this file assigns
`kind: "ambiguous"`.** Confirmed via direct `grep -n '"ambiguous"'
src/compiler/module/import-resolver.ts` — the only match is the
type definition itself (line 16), not a value construction.

**What this investigation could NOT do, disclosed honestly**:
construct a live UR program or API call that reaches
`registry.ts`'s own line 81 with `e.kind` set to anything other than
`"missing"`/`"circular"`, to runtime-confirm the MD1006 branch is
truly dead — because no code anywhere produces that third value, and
constructing one artificially would require modifying
`import-resolver.ts` itself (a production file), which this
investigation was explicitly not permitted to do.

**Conclusion: Unreachable** (source-inspection evidence: the only
type of value that would select this branch is never produced
anywhere in the codebase) — **with the above caveat disclosed
explicitly, since a live runtime reproduction of "the branch is
truly dead" was not possible without touching production code.**

## Summary Table

| Code | Runtime reachable | Source reachable | Future feature | Conclusion |
|---|---|---|---|---|
| MD1002 | No — confirmed via direct parser test (named-import syntax rejected: PE001) | No — zero references to the constant anywhere | Not confirmed (no independent doc; only an unrelated nearby comment) | **Unreachable** |
| MD1003 | No — same parser-level evidence as MD1002, plus the module-level "missing" case maps to MD1005 instead | No — zero references to the constant anywhere | Not confirmed | **Unreachable** |
| MD1006 | No producer found for the required input (`kind: "ambiguous"`) anywhere in import-resolver.ts | Yes — the dispatch line itself exists and executes for every resolution error, just never selects this branch | Not confirmed | **Unreachable** (see disclosed caveat above regarding live reproduction) |

## Closure

Per the stated closure criteria: all three of MD1002, MD1003, MD1006
now have one of the three required, evidence-backed classifications
(all three: **Unreachable**) — none remain in "Needs Investigation."

**This investigation is reported complete within this session,
pending independent verification** (per this project's own standing
rule) — the MD1006 caveat above should be weighed accordingly by any
reviewer: its "Unreachable" classification rests on comprehensive
source inspection (every producer site in the one relevant file was
checked directly), not on a live runtime reproduction, since
reproducing it live would have required a production-code change
outside this investigation's own permitted scope.

No bug opened — no defect was found (a defect would require a real,
currently-reachable case going unhandled; these three codes were
never confirmed reachable in the first place, so there is nothing
observed to be "wrong," only unused/unreachable code paths).
