# DR-RB3-01 — WASM backend: V1.0 scope as implemented (post-hoc record)

**Status:** APPROVED, Option A; **AMENDED** (PM, Gate 3 decision). **Nature:** a post-hoc record. No single prior decision artifact ratifies
the expanded scope. The only partial artifacts are `docs/architecture/WASM_FUNCTION_PARAMETERS_*` (function
parameters) and the sub-phase notes inside `tests/backend/wasm/emit-wasm.test.ts`.

## Facts
`docs/WASM_BACKEND_GUIDE.md` ("RC2") lists unary operators, function calls with arguments and conditional array
allocation as **rejected**. On C4, the emitter **accepts** them. RB3-B1: 17 `emit-wasm` and 1 `std_math` assertions
still expect rejection.

**Behavioural evidence.** The same IR was run on the C backend and on the WASM backend (`tools/backend/differential-runner.ts`):

| Construct | C | WASM |
|---|---|---|
| unary minus `-a + 10` (a=7) | 3 | 3 |
| value reuse `let a = 2+3; return a+a` | 10 | 10 |
| fan-out 3 `a+a+a` | 15 | 15 |
| array allocated in one `if` branch | 10 | 10 |
| array read inside `if/else` | 3 | 3 |
| `print()` after an `if/else` merge | 5, prints 5 | 5, prints 5 |
| function with arguments `add(20,22)` | 42 | 42 |
| nested array literal `[[1,2],[3,4]]` | 5 | 5 |
| array allocated **inside a `while` body** | 3 | **rejected** (WASM1002): still out of scope |

Differential suite: 18/18 differential cases agree. Canary 41 (array-parameter bug): C=11, WASM=11 (the bug is fixed).

**Nested / multi-dimensional arrays:** `KNOWN_LIMITATIONS.md` [V1.0-DOC-DRIFT-MULTIARRAY-003] already states that they
are a supported, in-contract V1.0 capability on the Interpreter, C and WASM.

## Decision requested
**(A) Ratify**, as the V1.0 WASM contract, the constructs verified above (C == WASM). Keep as rejections: loop-body
allocation (WASM1002), floats, and host builtins (`input`/`free`) as currently listed. Then:
- update `WASM_BACKEND_GUIDE.md`;
- in RB3-TEST-REALIGNMENT, flip the affected assertions to "accepted, and equal to C", rather than deleting them;
- keep every still-rejected construct as a rejection test.

**(B) Re-restrict** the emitter to the RC2 list. That is a product code change and needs its own gate.

The team recommends (A) on the evidence above. The PM decides.

## Amendment (PM-approved, Gate 3)
The original "still rejected" list wrongly included **floats** and the host builtins **`input`/`free`**. That line was
copied from the stale RC2 guide without verification; this was a team drafting error.

**Evidence:**
- differential fixtures `27-const-float`, `29-arithmetic-f64` and `35-float-precision-0.1-plus-0.2` pass on WASM against
  an independent oracle;
- `34-string-input-print-free` passes;
- `free(input())` emits and runs with the same result as C.

**Amended V1.0 WASM contract:** a construct is accepted when a differential test proves the same behaviour as C.
Still rejected:
- allocation inside a loop body (WASM1002, 3.1B.6);
- the `wasm-only-reject` fixtures 42 (bool value gap), 43 (nativeptr multi-use) and 44 (array-load reuse).

No implementation is restricted to match an old document.
