# WASM_FUNCTION_PARAMETERS_DESIGN_ANSWERS.md

Direct answers to the 6 review questions, each grounded in source
inspection. No code changes.

---

## Q1: Does the design support multiple, different signatures in the same module without breaking current compatibility?

Yes - confirmed technically, not assumed. leb128.ts's own
encodeVector():

```ts
export function encodeVector(elements: readonly Uint8Array[]): Uint8Array {
  return concatBytes(encodeULEB128(elements.length), ...elements);
}
```

This is already fully general - it accepts an array of ANY length.
encodeTypeSection()'s own current call, encodeVector([funcType]),
passes a ONE-element array purely as a current USAGE choice, not a
technical limit of encodeVector itself. Passing
encodeVector([funcType0, funcType1, funcType2, ...]) - one entry per
distinct real signature - works today, with zero changes to
encodeVector/leb128.ts. Compatibility with the current
single-signature module is preserved automatically: a module where
every function happens to share one signature simply produces a Type
Section with one entry, byte-identical to today's output.

## Q2: Type deduplication - new type per function, or reuse identical types?

Reuse identical types - deduplication is included in the design, not
deferred, correcting this document's own earlier draft position. On
review, deduplication is the SAFER default, not merely faster:
with one-type-per-function (no dedup), a module with many
same-signature functions produces a larger Type Section, which is
not a correctness risk, but per-function type assignment without a
real, tested dedup key raises the odds of a copy-paste-style indexing
bug. Real deduplication key: (paramTypes.join(","), returnType) -
string-keyed lookup into a Map<string, number> built once per
module, mirroring struct-memory.ts's own dedup-by-name pattern
already used for struct type declarations in the C Backend's own
emitted output.

## Q3: Local Index Renumbering impact - per element, with direct analysis

Grounded in the exact code read directly from encodeFunctionBody:

```ts
const localIndexBySlotId = new Map(scalarSlots.map((l, i) => [l.id, i] as const));
const arrayIndexScratchCount = arraySlots.length > 0 ? 1 : 0;
const materializedScratchCount = getMaterializedIds(fn).size;
const i64LocalCount = scalarSlots.length + arrayIndexScratchCount + materializedScratchCount;
const arrayBaseLocalIndexBySlotId = new Map(arraySlots.map((l, i) => [l.id, i64LocalCount + i] as const));
const structBaseLocalIndexBySlotId = new Map(structSlots.map((l, i) => [l.id, i64LocalCount + arraySlots.length + i] as const));
```

Real, favorable structural finding: every category AFTER scalars
(array bases, struct bases) is computed RELATIVE TO i64LocalCount,
not as an independent absolute number. This means:

- Arrays: arrayBaseLocalIndexBySlotId's own formula does NOT need to
  change at all - it automatically shifts correctly once
  i64LocalCount itself includes the parameter count. Zero direct
  edit needed.
- Structs: identical finding - structBaseLocalIndexBySlotId's own
  formula also only needs i64LocalCount to already be correct; no
  direct edit to this line.
- Scratch Locals: their own COUNTS are unaffected - only their own
  contribution to i64LocalCount's sum is unaffected; their actual
  starting position shifts automatically for the same reason as
  arrays/structs above.
- Bump Allocator (bumpGlobalIndex): zero impact, confirmed - this is
  a WASM Global index (module-level, one per module), never a WASM
  Local index. Function parameters are purely a per-function Local
  concept; Globals are untouched by this entire design.
- Liveness (src/optimizer/liveness.ts): zero impact, confirmed via
  direct search - grep -rn "liveness" src/backend/wasm/*.ts
  src/backend/c/*.ts returns NOTHING; this file is not imported or
  used by either real Backend today. It has no bearing on this
  design at all.

The one, real, DIRECT edit required: localIndexBySlotId's own
formula changes from scalarSlots.map((l, i) => [l.id, i]) to
scalarSlots.map((l, i) => [l.id, paramCount + i]), and
i64LocalCount's own sum gains one new term:
i64LocalCount = paramCount + scalarSlots.length + arrayIndexScratchCount + materializedScratchCount.

This is a real, structurally favorable finding: because
arrays/structs/scratch locals already derive their own position from
i64LocalCount rather than a hardcoded absolute number, correctly
updating i64LocalCount in ONE place automatically and correctly
shifts every later category.

## Q4: Pipeline Diagram - Before and After

Before:
```
Type Section:     [ () -> i64 ]                          (1 entry, always)
Function Section: [0, 0, 0, ..., 0]                       (every fn -> type 0)
Code Section:      each fn's locals start at index 0
Call Sites:         call <funcIndex>                      (zero args pushed, always)
```

After:
```
Type Section:     [ () -> i64, (i64) -> i64, (i64,i64) -> i64, ... ]
                   (one entry per DISTINCT real signature, deduplicated per Q2)
Function Section: [typeIdx_fn0, typeIdx_fn1, ...]          (each fn -> its own real type)
Code Section:      each fn's locals start at index paramCount
Call Sites:         <arg0 expr>, <arg1 expr>, ..., call <funcIndex>
                   (each argument's value pushed, in order, before the call opcode)
```

Everything else in the pipeline (Lowering, Canonical IR, Validation's
own CFG-shape logic, Materialization, Memory Allocation/Bump
Allocator) is unchanged in shape.

## Q5: Every File That Will Change, With Reason

| File | Reason |
|---|---|
| src/backend/wasm/emit-wasm.ts | encodeTypeSection(): per-function, deduplicated types. encodeFunctionSection(): per-function type-index references. encodeFunctionBody(): i64LocalCount/localIndexBySlotId formulas updated per Q3 (one direct edit each). encodeExprRaw's own call case: push argument values before call. validateBlockInstructions's own call case: remove the inst.args.length > 0 rejection for real UR function targets. validateScope's own top-level param-count check: remove the fn.params.length > 0 rejection for primitive-only parameter lists. |
| tests/backend/wasm/emit-wasm.test.ts | Existing tests asserting fn.params.length > 0 is rejected need correcting (not removing), mirroring the "was REJECTS, now ACCEPTS" pattern already used twice in this file. |
| A new test file (tests/backend/wasm/function-params.test.ts) | Real, new tests: multi-signature modules, real WebAssembly execution with real arguments, the risk table's own regression markers. |

No changes needed to lower-to-ir.ts, src/shared/ir.ts, the C
Backend, or struct-layout-calculator.ts.

## Q6: Risk Estimate and Rollback Plan

Risk estimate: MODERATE, not LOW - despite the favorable Q3 finding,
the Type/Function Section changes are genuinely new surface area
(this Backend has never emitted more than one WASM type), and WASM's
own validator is strict enough that a real mismatch fails LOUDLY at
WebAssembly.instantiate() - a real, built-in safety net this Backend
gets for free. This means the most dangerous failure mode (silently
wrong local-index arithmetic producing a wrong numeric answer, not a
hard instantiation failure) is the one this document's own Q3
analysis and the risk table already target directly with dedicated
tests.

Rollback plan: this entire body of work continues to live on
feature/struct-ir-lowering (never committed to develop/main). If
Phase 3 work reveals a problem requiring rollback:
1. git revert (or simply do not merge) the specific commit(s)
   implementing this design - the branch's own commit history is
   already granular (one commit per phase/fix), so a revert can
   target exactly the parameter-support commits without touching
   Phase 1/Phase 2's own, already-verified struct work.
2. Because Lowering/Canonical IR need zero changes, a rollback of the
   WASM-encoding-side commits does not affect the C Backend or any
   already-passing struct test at any other pipeline stage.
3. The real regression-detection mechanism is the existing, full test
   suite re-run (191+ WASM tests, all struct Phase 1/2 tests) - a
   rollback decision is triggered by ANY of those failing, not a
   separate, new criterion invented for this phase.
