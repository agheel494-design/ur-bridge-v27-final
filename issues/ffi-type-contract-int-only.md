# FFI Type Contract is currently Int-only

**Status**: DOCUMENTED — a real, current language boundary, not a bug.
Baseline: c9495fb8f7f14872a4b906058b0669815a7d1409. Zero production
changes accompany this document.

## Summary

`FFI` (`manifest.json`-declared external functions) currently supports
only `int` for both argument and return types. `float`, `bool`,
`string`, `Array`, and `Struct` are all rejected at compile time by
`TypeChecker` (`TY2002`/`TY5002`) before any FFI call is ever attempted
— `int` is assumed unconditionally for every FFI-declared export,
regardless of the real, intended type.

## Real evidence

- Live-tested: an `Array<Int>` argument to a real FFI-exported
  function is rejected with `TY5002: cannot pass Array<Int> as Int`.
- Live-tested: a `Point` (struct) argument is rejected identically:
  `TY5002: cannot pass Point as Int`.
- Live-tested: `bool`/`float`/`string` arguments and return values are
  all rejected the same way (`TY5002` for arguments, `TY2002` for
  return-value assignment) — `int` is the only type `TypeChecker`
  accepts for any FFI boundary.
- Every prior real, passing FFI test in this project (Phase 3R,
  Recursion Audit, Module Boundary Audit, Error Boundary Audit) used
  `int -> int` exclusively — not because other types were verified
  and found working, but because no other type had been exercised
  through FFI before this audit.

## Precision, per direct instruction — what this is NOT

This is **not** "FFI serialization broken for compound values." The
real, existing serialization code (`args.map(a => typeof a ===
"bigint" ? Number(a) : a)`, a real, shallow-only bigint-to-number
conversion) does carry a real latent gap for values with nested
`bigint`s (e.g. an array of ints) — but this code path is **never
reached** through the current language, since `TypeChecker` rejects
any non-`int` FFI argument before serialization is ever attempted.

This is also a different defect class than the Phase 3R pattern
(`resultStructSlot`, `arraySlot`/`structSlot`): in 3R, the Lowerer
produced real, correct IR metadata that the Interpreter simply failed
to consume — a real, executable Producer/Consumer mismatch. Here:

```
Language Type System
        ↓
FFI argument
        ↓
TypeChecker
        ↓
early rejection
        ✕
FFI serialization (never reached)
```

There is no broken runtime boundary to fix here without first
expanding the Capability Contract itself (i.e., deciding that FFI
should support these types at all, and designing the real ABI/
serialization for each).

## What is now part of the baseline

> **FFI Contract — PROVEN WITH EXPLICIT LIMIT**
> FFI currently supports `Int` arguments/returns only. Compound
> values and other primitive types are rejected at compile time.
> Runtime serialization behavior for rejected types remains
> untested/unreachable.

## What is NOT decided here

No fix is proposed or scheduled. If FFI type support is ever expanded
in the future, that is a real, separate, independent design decision
(a real FFI Type ABI/serialization design) — not a small patch to
`callFunction`'s own existing serialization code.
