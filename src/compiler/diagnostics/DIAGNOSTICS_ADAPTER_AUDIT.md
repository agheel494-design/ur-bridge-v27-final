# DIAGNOSTICS_ADAPTER_AUDIT.md — Conversion Coverage & Lossless Audit

**Status: results of real, directly-run tests for all four conversion
paths (LexError, ParseError, SemanticDiagnostic, TypeDiagnostic), not
assumed from code review alone.**

---

## Four Independent Real Conversion Tests — All Run, All Passed

| # | Source | Real trigger | Real output code | Result |
|---|---|---|---|---|
| 1 | LexError | let x = "unterminated (real unterminated string) | LE002 | Converted correctly |
| 2 | ParseError | function main(): int / print(1 / end (real missing paren) | PE003 | Converted correctly |
| 3 | SemanticDiagnostic | print(undefined_var) (real undefined symbol) | SE1001 | Converted correctly |
| 4 | TypeDiagnostic | let x: int = "text" (real type mismatch) | TY2002 | Converted correctly |

Each was run through the real lex()/parse()/analyze()/typeCheck()
functions on a genuinely broken UR program - not synthetic/mocked
data - then passed through the real adapter function.

Representative raw output (#1):

```
Original: {"code":"LE002","message":"Unterminated string literal","span":{"file":"test.ur","startLine":1,"startCol":9,"endLine":1,"endCol":22}}
Converted: {"severity":"error","code":"LE002","message":"Unterminated string literal","file":"test.ur","line":1,"column":9,"length":14}
```

## Field-by-Field Lossless Audit

| Source | Field | Result |
|---|---|---|
| LexError | code | Preserved exactly |
| LexError | message | Preserved exactly |
| LexError | span.file | Preserved (-> file) |
| LexError | span.startLine | Preserved (-> line) |
| LexError | span.startCol | Preserved (-> column) |
| LexError | span.endLine/endCol | Collapsed into a single length (only valid when startLine === endLine) - a real, disclosed loss for any error spanning multiple lines |
| LexError | severity | Not present in the source at all - the adapter fills in a fixed "error", since LexError has no severity field to preserve or lose |
| ParseError | code, message | Preserved exactly |
| ParseError | span.startLine/startColumn | Preserved (-> line/column) |
| ParseError | span.endLine/endColumn | Same multi-line collapse limitation as LexError |
| ParseError | file | Not present in the source at all (SourceSpan has no file field) - supplied by the caller as a separate argument |
| ParseError | severity | Same as LexError - fixed "error", not present in the source |
| SemanticDiagnostic | severity, code, message | Preserved exactly |
| SemanticDiagnostic | span | Same multi-line collapse limitation |
| SemanticDiagnostic | related[].message | Preserved exactly |
| SemanticDiagnostic | related[].severity | Always overwritten to "note" - the source's own related array has no severity field to begin with, so this is not a loss of real data, but the adapter is asserting a severity that was never actually present in the source |
| SemanticDiagnostic | related[].span | **Cannot be represented - not a loss by the adapter, but a gap in reporter.ts's own target contract.** Confirmed via direct test with a real related entry containing its own span - the converted output's related array has no span field at all. reporter.ts's own related type is Array<{severity, message}> - it was never designed to carry a span in the first place. A "previously declared here" note's exact location cannot currently be shown, only its message text - because there is nowhere in the target shape to put it. |
| TypeDiagnostic | All fields | Same pattern and same losses as SemanticDiagnostic (identical shape) |

## Summary: Is the Adapter Lossless?

**Corrected framing, per direct feedback**: the accurate statement is
not "the adapter is not lossless" — that attributes the gap to the
adapter's own implementation, when the real cause is upstream. The
accurate statement is:

> Current Reporter Diagnostic model cannot represent related spans.
> Therefore the adapter necessarily loses this information.

This is a **Known Limitation of `reporter.ts`'s own existing
contract**, not a defect in the adapter. The adapter did not choose
to drop `related[].span` — there was never a field in the target
type to carry it. The code works exactly as designed; the contract
it targets is what lacks the capacity.

The same applies to the second, smaller loss (multi-line span end
positions collapsing into a single `length`) — `reporter.ts`'s own
`Diagnostic` type has `line`/`column`/`length`, not a full
start/end range.

## Outstanding Architectural Issue (not fixed here, not fixed by this adapter)

**Reporter Diagnostic model cannot represent related spans.**

This is recorded as an open architectural question for a future
review of `reporter.ts`'s own contract — not resolved in this work
package, and not something this adapter attempts to work around.
Extending `reporter.ts`'s own `related` type to include an optional
span would resolve it, but that is a decision about `reporter.ts`
itself, out of scope here.

## Status: Diagnostics Adapter v1.0 — Frozen

| Item | Status |
|---|---|
| Adapter architecture | Done |
| Frontend untouched (lexer/parser/semantic/typesystem) | Confirmed |
| Four real conversion paths | Confirmed, tested independently |
| Regression coverage | Confirmed (known_loss_of_related_span.test.ts) |
| Known limitations documented | Done |
| Outstanding architectural issue | Reporter Diagnostic model cannot represent related spans - open, not addressed here |

No further feature is added to this adapter. `related[].span` is not
fixed here. `reporter.ts` is not touched.

**Diagnostics Adapter v1.0 is frozen. It should not be modified
unless:**
- **A verified defect is discovered in the adapter itself, or**
- **The Reporter contract is redesigned.**

The outstanding architectural issue above is left open for whenever
`reporter.ts`'s own contract is reviewed in the future - a separate
decision, not this one.
