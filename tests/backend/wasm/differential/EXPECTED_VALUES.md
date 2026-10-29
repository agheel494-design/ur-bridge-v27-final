# V2-M6 — Independent Expected Values (Oracle)

**Written before any fixture was constructed or any backend was run — per the Oracle-first ordering mandated in the Implementation Authorization. `tools/generate-wasm-golden.ts` is not used and is not the source of any value here.**

**Governance rule (Condition 1, carried forward)**: any future regeneration of an *existing* golden snapshot in the separate `tests/backend/wasm/golden/` corpus that changes a previously-passing case's own expected value requires an explicit, named justification (which Gate, why correct) in the same commit — never a silent re-run treated as automatic truth.

---

| # | Fixture | Kind | Independent Expected Value |
|---|---|---|---|
| 26 | const-int | differential | `42` |
| 27 | const-float | differential | `3.5` |
| 28 | arithmetic-i64 | differential | `(7*6) - 2 = 40` |
| 29 | arithmetic-f64 | differential | `1.25 + 2.5 - 0.75 = 3.0` |
| 30 | unary-neg | differential | `-(17) = -17` |
| 31 | function-call-with-args | differential | `add(9, 13) = 22` |
| 32 | local-single-use | differential | `let x = 8; return x + 1 = 9` |
| 33 | local-multi-use (Migration Test) | differential | `let a = 2+3; return a+a = 10` |
| 34 | string-input-print-free | differential | printed value == exact scripted stdin line `"oracle test line"`; `free()` no-op; `main()` returns `0`; `input()`/`free()` each invoked exactly once |
| 35 | float-precision (0.1+0.2) | differential | `0.30000000000000004` (real IEEE-754 double — deliberately **not** `0.3`) |
| 36 | conditional-allocation-diamond | differential | `if 1==1: arr=[10,20,30]; return arr[1] = 20` |
| 37 | conditional-allocation-merge | differential | `if 1==2: else: arr=[40,50,60]; result=arr[2]; return result = 60` |
| 38 | side-effect-single-use | differential | observed value `555`; side-effecting call fires exactly `1` time |
| 39 | side-effect-multi-use | differential | `let v = counter(); return v + v`, `counter()` returns `7` → `14`; side-effecting call fires exactly `1` time on **each** backend |
| 40 | critical-ssa-array-bug | canary-wrong | WASM: `99` (the known-wrong value, pinned); C: `5` (correct) — divergence itself is the expected state |
| 41 | array-parameter-bug | canary-wrong | Exact pattern from `FINDING_ARRAY_PARAM_INTERACTION_BUG.md`: `f(x:int){let arr=[1,2,3]; return arr[0]+x}`, `f(10)` → WASM: `1` (the known-wrong value, pinned — the parameter's own value is silently dropped); C: `11` (correct) |
| 42 | bool-value-gap | wasm-only-reject | C: succeeds; WASM: `WasmUnsupportedError`, message contains `"const_bool"` |
| 43 | nativeptr-multiuse | wasm-only-reject | WASM: `WasmUnsupportedError`, message contains `"is neither"`; not applicable to the C Backend as a general concept (`NativePtr` is Native-FFI-only) |
| 44 | array-load-reuse | wasm-only-reject | C: succeeds (`14`); WASM: `WasmUnsupportedError`, fan-out message |

---

**Reviewed before use**: every value above was computed independently (hand arithmetic, or — for cases 34/38-44 — the already-established, previously independently-reviewed behavior from this track's own prior Gate Evidence Reports and standalone Finding documents, not re-derived from scratch where a prior independent review already exists) before any fixture's own `program.ur` was written.
