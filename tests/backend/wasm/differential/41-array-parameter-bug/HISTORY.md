# 41-array-parameter-bug: history (RB3-TEST-REALIGNMENT, DR-RB3-01)

| When | Kind | Pinned values |
|---|---|---|
| Before RB-3 | `canary-wrong` | WASM = 1 (the known array-parameter bug), C = 11 |
| RB3-B1 measurement (C4 and reference `c6a26225`) | — | WASM = 11, C = 11. The bug is fixed in both trees |
| RB3-TEST-REALIGNMENT (DR-RB3-01 approved, Option A) | `differential` | C and WASM must agree: 1 + 10 = 11 |

The canary is kept as evidence that the earlier reference carried the old, wrong WASM behaviour. It was converted
to a differential case only after the correct contract was documented and approved (DR-RB3-01).
