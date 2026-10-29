# STRUCT_TEST_PLAN.md

Real test plan, one independent Regression test per scenario, per
explicit direction. No implementation code is written by this
document - it defines what Phase 2 must make pass before Blocker 4
can close, following STRUCT_ABI_SPEC.md and STRUCT_MEMORY_LAYOUT.md.

Each test below states: the real UR source it compiles, which real
pipeline stages it must pass through with zero errors, and which
Backend(s) it targets. All tests use the existing, real test
infrastructure already in this project
(`tests/compiler/localization/`, `run-tests.ts`) - no new test
runner invented.

---

## Test File Organization

```
tests/compiler/struct-ir/
  empty-struct.test.ts
  single-field-struct.test.ts
  multi-field-struct.test.ts
  nested-struct.test.ts
  struct-parameter-passing.test.ts
  struct-return.test.ts
  struct-field-mutation.test.ts
  struct-read-after-write.test.ts
  struct-cross-module-import.test.ts
  struct-all-ten-languages.test.ts
```

Ten independent files, matching the ten scenarios requested exactly
- not combined into fewer files, so a single scenario's regression
does not obscure another's pass/fail status.

## Scenario 1: Empty Struct

```
struct Empty
end
function main(): int
  let e = Empty()
  return 0
end
```
Pipeline: Lexer → Parser → Semantic → TypeChecker → IR → C Backend →
WASM Backend → Runtime (compile + execute, assert exit/return value
0). Real edge case per `STRUCT_MEMORY_LAYOUT.md`: size = 0, alignment
= 1 (no fields to derive alignment from) - the layout algorithm must
not divide by zero or produce a negative/undefined offset for this
case; the test explicitly asserts `structLayout.size === 0` and
`structLayout.alignment === 1` at the IR level, not just "it compiles."

## Scenario 2: Single-Field Struct

```
struct Box
  value: int
end
function main(): int
  let b = Box(42)
  return b.value
end
```
Full pipeline, all stages, both Backends, Runtime execution asserts
the program's own real output equals 42.

## Scenario 3: Multi-Field Struct

```
struct Point
  x: int
  y: bool
  z: int
end
```
Uses the exact worked example from `STRUCT_MEMORY_LAYOUT.md` §4 -
the test asserts the real, computed offsets (`x@0, y@8, z@16`) and
real total size (24) match that document's own worked example
exactly, not just "compiles with no error." Full pipeline + Runtime,
asserting each field's own read-back value is correct after
construction.

## Scenario 4: Nested Struct

```
struct Inner
  v: int
end
struct Outer
  a: int
  inner: Inner
  b: int
end
function main(): int
  let o = Outer(1, Inner(2), 3)
  return o.inner.v
end
```
Full pipeline + Runtime, asserting the chained field access
(`o.inner.v`) returns 2, and asserting the real, computed layout
matches `STRUCT_MEMORY_LAYOUT.md` §7's inline-embedding rule (no
separate allocation for `Inner`).

## Scenario 5: Struct Passed as a Function Parameter

```
struct Point
  x: int
  y: int
end
function getX(p: Point): int
  return p.x
end
function main(): int
  let pt = Point(10, 20)
  return getX(pt)
end
```
Full pipeline + Runtime, asserting the returned value is 10 - this is
the exact scenario that previously failed with `CG1001`, now the
primary regression marker that it stays fixed. Per
`STRUCT_ABI_SPEC.md` §2, asserts the callee receives a pointer to the
SAME memory as the caller's own `pt` (no redundant copy at the ABI
level) - verified via a real test that mutates a field on the
parameter and confirms whether the caller's own copy is/isn't
affected, resolving the value-semantics nuance `STRUCT_ABI_SPEC.md`
§5 explicitly flagged as needing TypeChecker/Semantic attention (this
test is what makes that nuance concrete and checkable, not just
theoretical).

## Scenario 6: Struct Returned from a Function

```
struct Point
  x: int
  y: int
end
function makePoint(): Point
  return Point(5, 6)
end
function main(): int
  let p = makePoint()
  return p.x + p.y
end
```
Full pipeline + Runtime, asserting the result is 11 - the exact
scenario that previously failed with `CG1002`. Asserts the hidden-
output-parameter convention (`STRUCT_ABI_SPEC.md` §7) via a real C
codegen inspection: the generated C function for `makePoint` has
`void` as its return type and a real, additional pointer parameter,
not merely "the program produces the right number at runtime" (a
codegen-shape assertion, not only a behavioral one).

## Scenario 7: Struct Field Mutation

```
struct Counter
  value: int
end
function main(): int
  let c = Counter(0)
  c.value = c.value + 1
  c.value = c.value + 1
  return c.value
end
```
Full pipeline + Runtime, asserting result is 2. This is a REAL, NEW
capability - confirmed via direct search in the prior design work
that no `field_store`-equivalent exists at all in today's codebase
(today's struct fields can only be read, never reassigned after
construction) - this test is the first, primary proof that mutation
genuinely works, not a re-test of something already working.

## Scenario 8: Read-After-Write

```
struct Pair
  a: int
  b: int
end
function main(): int
  let p = Pair(1, 2)
  p.a = 100
  let readBack = p.a
  p.b = readBack + 1
  return p.a + p.b
end
```
Full pipeline + Runtime, asserting result is 201 (100 + 101) -
specifically exercises write-then-read-then-write-derived-from-read
in sequence, a real ordering-dependent case distinct from Scenario 7
(which only ever increments, never reads an intermediate value back
into a local before a further write).

## Scenario 9: Struct Used After Import

```
// ur_packages/geo/index.ur
struct Point
  x: int
  y: int
end

// main.ur
import geo
function useImportedPoint(p: Point): int
  return p.x + p.y
end
function main(): int
  return useImportedPoint(Point(3, 4))
end
```
Full pipeline (via `ModuleRegistry`, reusing the already-built-and-
tested `externalStructTypes`/`getExportedTypes` mechanism from the
prior TypeChecker fix) + Runtime, asserting result is 7. This is the
scenario that must ALSO succeed at IR/Backend, not just
Semantic/TypeChecker (which already pass, per the prior round's own
fix) - the real, remaining gap this whole Blocker is about.

## Scenario 10: All Ten Languages

Reusing the exact, already-proven pattern from
`tests/compiler/localization/comprehensive-reference-program.test.ts`
and `import-system-status.test.ts`'s own "Blocker 4" describe block:
auto-generate Scenario 3's own program (multi-field struct,
construction, field access, mutation) from each of the 10 languages'
own keyword tables, and assert:
- Zero Lexer/Parser/Semantic/TypeChecker errors (already proven in
  the prior round - re-confirmed here, not re-designed).
- **NEW**: `ir.ok === true` for all 10 (currently `false` for all 10
  - this is the real, primary target of Blocker 4's remaining work).
- **NEW**: successful C Backend compilation (a real `gcc`/`cc`
  invocation, following this project's own existing pattern of
  compiling real, small C programs on the fly - see
  `tests/ffi/native/harness-executor.ts` for the precedent) and
  Runtime execution producing the correct result, for all 10
  languages identically.
- **NEW**: successful WASM Backend compilation, for all 10 languages
  identically (subject to the already-disclosed, narrower WASM gating
  from `STRUCT_IR_DESIGN_V2.md` §2 - if WASM's own struct support
  lands with real, explicit limitations, this test asserts exactly
  those limitations consistently across all 10 languages, not "WASM
  happens to work for some languages and not others" — the pass/fail
  boundary must be a real, uniform, documented one, never an
  accidental per-language difference).

## Definition of "Done" for Blocker 4 (Binding, Per Direct Request)

Blocker 4 is closed if and only if ALL of the following hold
simultaneously — any single missing item means Blocker 4 remains
OPEN:

1. **All 10 tests in this plan pass** (Scenarios 1–10 above), with
   real, attached execution logs — not asserted from memory.
2. **Full project Regression passes** — every existing test file in
   this project's own suite, re-run clean, not just the new struct
   tests in isolation.
3. **No existing program's output changes.** Every currently-passing
   test's own asserted values/behavior remain byte-identical to
   before this work began — this is checked by literally re-running
   the full pre-existing suite, not inferred from "the diff looks
   additive."
4. **C Backend succeeds** — real `gcc`/`cc` compilation of the
   generated C code for every scenario above, not just IR-level
   success.
5. **WASM Backend succeeds** — real WASM module generation for every
   scenario above (subject to the already-disclosed narrower WASM
   gating carried over from arrays — see
   `STRUCT_IR_DESIGN_V2.md` §2 — but within whatever that real,
   documented boundary is, WASM must genuinely succeed, not silently
   skip).
6. **Real execution succeeds, not just compilation.** Every scenario
   must be run to completion (a real process executing the compiled
   C binary; a real WASM runtime executing the compiled module) and
   produce the scenario's own stated correct result — a scenario that
   merely compiles without being executed does not count as passing.

No shortcuts, no temporary fixes, no `TODO` comments left in shipped
code, and no Regression test skipped or weakened to make this
checklist appear satisfied — consistent with this project's own
standing rules against exactly these things.

## What "Done" Meant for This Test Plan (superseded by the binding definition above — kept for historical record only)

Per explicit direction ("each case must have an independent
Regression test"): all 10 files above exist, are committed, and pass,
with real, attached execution logs - before Blocker 4 is reported as
closed. No test in this plan may be skipped, marked pending, or
replaced with a weaker assertion without an explicit, separate
decision to narrow scope - consistent with this project's own
standing rule against removing a test instead of fixing the
underlying gap.
