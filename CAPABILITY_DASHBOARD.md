# CAPABILITY_DASHBOARD.md

**The single, official measure of UR's real progress — replaces
counting commits/tags/tests as the primary signal.** Every row below
is either (a) confirmed live via a real test run in this project's
own actual history, or (b) explicitly marked as not yet confirmed.
No row is marked ✅ on the basis of a document or a plan alone.

| Domain | Status | Real evidence |
|---|---|---|
| Standalone terminal programs | ✅ | `examples/calculator.ur`, `examples/game_tictactoe.ur`, `examples/rpn_evaluator.ur` — all 3 compiled via real `gcc` and run as genuinely standalone binaries, correct output confirmed |
| Recursion | ✅ | `factorial(5)=120`, confirmed via real execution |
| Structs (construct, field access, pass as parameter) | ✅ | Confirmed via `tests/examples/language-fundamentals.test.ts` |
| Structs (return from a function) | ❌ | Confirmed NOT supported — real, architectural limit (Struct construction is a `let`-only special form, not a general expression) |
| Arrays (local, indexed access, within one function) | ✅ | `examples/rpn_evaluator.ur`'s own stack |
| Arrays (as a function parameter) | ❌ | Confirmed NOT supported |
| Multi-file projects | ❌ | Not attempted; `import` keyword exists in the Lexer but has not been tested end-to-end with a real multi-file program in this session |
| File I/O | ❌ | No such Builtin exists in `BUILTINS_REGISTRY` today |
| Networking | ❌ | No such Builtin exists; no Runtime C function exists |
| Databases | ❌ | Not attempted, no real path exists today |
| Generics | ❌ | No such concept exists in the Parser/TypeSystem |
| Concurrency | ❌ | No such concept exists anywhere in the compiler |
| Full IDE | ⏳ | `src/ide/` exists in the codebase; not evaluated this session |
| Package Manager | ⏳ | `src/urpm/` exists in the codebase; not evaluated this session |

## What this dashboard does NOT claim

- It does not claim these are the only capabilities that matter —
  only the ones directly discussed and, where marked ✅, directly
  confirmed live.
- ⏳ means "exists in the codebase but not evaluated this session" —
  not "in progress" in a planning sense, and not "confirmed working."
- This file should be updated only when a row's own real status
  changes, confirmed the same way the ✅ rows above were — a real
  compile+run, not a design document.
