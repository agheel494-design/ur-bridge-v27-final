# Issue: Named-Type Annotations (Structs, Type Aliases) Cannot Be Used Explicitly — Only Inferred

**Status: OPEN — discovered as a side effect of implementing the
`type` alias fix (SPEC_IMPLEMENTATION_MATRIX.md). NOT part of that
fix's own scope; documented separately per this project's standing
"one issue at a time" discipline.**

## Finding

`let p: Point = Point(1, 2)` (an EXPLICIT struct type annotation)
fails with `TY1001: unknown type 'Point'` — even though `Point` is a
properly declared struct and `let p = Point(1, 2)` (relying on
inference from the constructor call, no annotation) works correctly.

Confirmed this affects structs specifically (the most established,
heavily-tested named-type feature in this codebase) — not something
newly introduced by the type-alias work. Type aliases (`type MyInt =
int`) share the same limitation for the identical reason: any name
that isn't one of the fixed primitive-type keywords is treated as
"unknown" by `resolveTypeRef()` unless it matches a generic-type-
parameter naming convention.

## Root Cause

`src/compiler/typesystem/type-env.ts`'s `resolveTypeRef()` only
recognizes: the primitive canonical names, `Array`/`Map`/`Set`/`Tuple`/
`Optional`, and single-uppercase-letter/`T`-prefixed generic parameter
names. It has no mechanism to consult the struct-type registry
(`this.structTypes` in `checker.ts`) or a type-alias registry — both
of those only exist as separate, ad-hoc lookups used in specific
contexts (e.g., struct CONSTRUCTION via a call expression), never
wired into the general type-annotation resolution path.

## Why This Was Not Fixed As Part of the `type` Alias Work

The `type` alias finding's own scope (per SPEC_IMPLEMENTATION_MATRIX.md)
was specifically "declarations do not parse at all" — fixed by adding
parser support and basic semantic acceptance of the declaration
itself. Making the alias NAME subsequently usable as an annotation
requires wiring `resolveTypeRef()` (or its callers) to consult a
registry — a change with a broader blast radius (affecting every type-
annotation resolution site, and ideally fixing the identical, pre-
existing struct limitation at the same time, not just aliases) than
this one finding's own minimal fix warranted. Fixing it now, inline,
would have risked exactly the kind of scope creep this project's
review process has repeatedly guarded against.

## Fix Direction (not started)

Thread a combined `Map<string, URType>` (structs + type aliases,
built once per `check()` call) into `resolveTypeRef()`'s own
resolution path, consulted before falling through to the generic-
parameter check and the unknown-type error. Should fix both structs-
as-annotations and type-aliases-as-annotations in one coherent change,
since they share the identical root cause.

## Scope

Does not block the `type` alias declaration fix itself (which is
complete and tested for its own, narrower scope). Recommended as its
own follow-up item, not bundled into this round's work.

## Additional confirmed scope (Classes/Structs bug hunt, Compiler & Runtime Stabilization phase)

Confirmed directly: this same limitation also affects **function
parameter and return type annotations**, not only `let` declarations —
`function f(p: Point): Point` fails with the identical `TY1001:
unknown type 'Point'`, for the identical root cause (`resolveTypeRef()`
doesn't resolve struct names, regardless of which syntactic position
the annotation appears in). This means a struct value cannot currently
be passed to or returned from a function AT ALL via an explicit
signature — only used locally within a single function body (`let p =
Point(...)`, field read/write, copy-on-assignment all confirmed
working correctly). Per explicit review decision: this is the SAME
already-tracked, already-deferred issue, not a new one — no new
classification or fix cycle started. `let p: Point = ...` and
`function f(p: Point): Point` should be fixed together, sharing the
"Fix Direction" already described above.
