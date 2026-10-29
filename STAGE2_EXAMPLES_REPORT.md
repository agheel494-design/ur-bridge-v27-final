# Sequential Roadmap — Stage 2 Report: Examples

**Written LAST, per `PROCESS_RULE_SPRINT_ORDER.md`'s mandate —
summarizes the `stage2-examples` CHANGELOG entry, written first.**

---

## Task (per the sequential roadmap)

"إنشاء مجلد examples/ يحتوي على أمثلة رسمية تعمل مباشرة، مع اختبار
كل مثال."

## Delivered

7 examples in `examples/`, each with a passing test in
`tests/examples.test.ts`: `fibonacci`, `array_sum`, `struct_point`,
`factorial_recursive`, `std_math_usage`, `byte_pixel`, `type_alias`.

## Significant Finding During Verification (not part of the original task, surfaced by doing it thoroughly)

While going beyond the minimum requirement to check WASM support for
each example, found that **`fibonacci.ur` produces a wrong result on
WASM** (`512` instead of `55`) — a real, previously-undiscovered
Backend defect, narrowed to a precise trigger (a loop-local variable
updating two outer variables per iteration) and filed as
`issues/wasm-loop-local-let-affecting-outer-state.md`. Not fixed —
reported, matching this project's standing discipline.

## 8-Step Sequence Followed

| Step | Status |
|---|---|
| 1. Implementation | 7 `.ur` files in `examples/` |
| 2. Tests | `tests/examples.test.ts`, 8/8; full regression 2382/2382 |
| 3. Conformance Suite | 11/11, unaffected |
| 4. API Freeze Check | N/A — examples aren't a library/API surface |
| 5. Documentation | `docs/EXAMPLES.md` |
| 6. CHANGELOG | `stage2-examples` entry, written before this report |
| 7. Stage report | This document |
| 8. Review/merge | Pending |

## Known Limitations (per the same standard set for Stage 1)

- No `std.io` example (deferred, reasoned in `docs/EXAMPLES.md`).
- `std_math_usage.ur` inlines rather than imports (`import` mechanism
  doesn't exist yet).
- 7 examples are illustrative, not exhaustive — `SPEC_IMPLEMENTATION_MATRIX.md`
  and the Conformance Suite remain the systematic references.
- The WASM defect found this round is NOT fixed — `fibonacci.ur`
  remains C-Backend-only until it is.

## Recommendation

Stage 2 is complete by its own stated criteria. The WASM defect found
during this stage is a separate, higher-priority item — recommend it
be triaged before or alongside Stage 3 (Standard Library), not
necessarily blocking Stage 3's own start, since the defect is scoped
and doesn't affect the C Backend or any already-shipped Standard
Library function.
