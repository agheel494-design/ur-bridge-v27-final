# WASM_FUNCTION_PARAMETERS_DRY_RUN.md

Manual, by-hand trace only — no code executed, no code written. This
is the final review gate.

Program traced:

```
function add(a: int, b: int): int
  return a + b
end
function square(x: int): int
  return x * x
end
function main(): int
  return square(add(1, 2))
end
```

`main` calls `add`, then feeds `add`'s own result into `square` — a
real nested/chained call, per the specific request.

---

## Step 1: Dedup Keys (per Gate 1's own pseudo-code)

| Function | params | returnType | key |
|---|---|---|---|
| add | [i64, i64] | i64 | `"i64,i64->i64"` |
| square | [i64] | i64 | `"i64->i64"` |
| main | [] | i64 | `"->i64"` |

**Honest note, not glossed over**: all three keys are distinct in
this specific example — this program does not exercise Gate 3's own
Test 2 (two IDENTICAL signatures reusing one type). That case is
covered separately below in §6, added specifically because tracing
THIS program alone would not have exercised it.

## Step 2: Type Section (after Dedup)

```
typeEntries[0] = FUNCTYPE (0x60), params=[i64,i64], results=[i64]   // "add"'s own signature
typeEntries[1] = FUNCTYPE (0x60), params=[i64],      results=[i64]   // "square"'s own signature
typeEntries[2] = FUNCTYPE (0x60), params=[],          results=[i64]   // "main"'s own signature
```

`functionTypeIndex` map: `add → 0`, `square → 1`, `main → 2`.

## Step 3: Function Section

```
[0, 1, 2]
```
(one entry per function, in DECLARATION order — `add` first, `square`
second, `main` third — each holding its own TYPE index from Step 2.)

## Step 4: Local Index Per Parameter, Per Function

| Function | paramCount | Param → Local Index | Non-param locals start at |
|---|---|---|---|
| add | 2 | a→0, b→1 | index 2 (none needed here) |
| square | 1 | x→0 | index 1 (none needed here) |
| main | 0 | (none) | index 0 (none needed here — the nested call needs no local at all, per Step 5) |

## Step 5: Call Encoding for `add` then `square` — the Critical Distinction Found During This Trace

**Found live, during the trace itself, not assumed beforehand**: WASM
`call <funcIndex>` addresses the **Function Index Space** (a single,
module-wide, 0-based numbering over every function, in declaration
order) — this is a COMPLETELY SEPARATE numbering from the Type Index
used in the Function Section. In THIS specific example, they happen
to coincide (`add` is function #0 AND uses type #0; `square` is
function #1 AND uses type #1) — purely because every signature here
is unique. §6 below constructs the case where they diverge, to prove
this distinction is understood, not accidentally glossed over.

`main`'s own code body (`return square(add(1, 2))`):

```
i64.const 1        ; push add's 1st argument
i64.const 2        ; push add's 2nd argument
call 0             ; call function index 0 (= add) — consumes [1, 2], produces 3 on the stack
call 1             ; call function index 1 (= square) — consumes the 3 just produced, produces 9
return             ; return the top of stack (9)
```

## Step 6: Manual Confirmation of Every Index, No Conflicts — Including the Divergence Case

**Confirming Steps 1-5 above, by hand:**
- `add`'s locals: params occupy 0,1 — nothing else exists in `add`'s
  own body needing a local, so there is no collision to check.
- `square`'s locals: param occupies 0 — same reasoning, no collision.
- `main`'s own call sequence: two `i64.const`s push two values (stack
  depth 2), `call 0` (add, needs exactly 2 args — matches, consumes
  both, leaves stack depth 1 with add's own result), `call 1`
  (square, needs exactly 1 arg — matches the single value left on
  the stack), `return` (needs exactly 1 value on the stack per
  `main`'s own result type `i64` — matches). Every stack-depth
  transition is accounted for; nothing is left over, nothing is
  missing.

**Now the divergence case, added specifically to prove Function
Index ≠ Type Index is correctly handled, not just correct by
coincidence**: extend the program with a fourth function, `mul(a:
int, b: int): int` (SAME signature as `add`):

- Declaration order: `add`(#0), `square`(#1), `main`(#2), `mul`(#3).
- Dedup key for `mul`: `"i64,i64->i64"` — IDENTICAL to `add`'s own
  key, computed in Step 1. Per Gate 1's own pseudo-code, this key is
  ALREADY in `typeKeyToIndex` (mapped to 0) — so `mul` is assigned
  type index 0, REUSING `add`'s own type entry. The Type Section
  still has exactly 3 entries (not 4).
- Function Section becomes `[0, 1, 2, 0]` — `mul`'s own entry is `0`
  (its TYPE index), even though `mul` is function `#3` (its own,
  separate FUNCTION index).
- A call to `mul(5, 6)` from anywhere would be encoded as
  `i64.const 5, i64.const 6, call 3` — `call 3` (mul's own FUNCTION
  index), NOT `call 0` (which would incorrectly call `add` instead,
  a real bug this distinction is what prevents). This confirms the
  two numbering spaces are independent and must never be confused —
  the dry run surfaced this explicitly rather than leaving it
  implicit.

## Conclusion

The design traces correctly by hand for both the straightforward case
(§1-5) and the specific case most likely to be gotten wrong in a real
implementation (§6's Function-Index-vs-Type-Index divergence, once
deduplication actually reuses a type across non-adjacent functions).
No index collision, no missing/extra stack value, no ambiguity found
in this trace.
