# UR Standard Library — API Freeze Check

**Status: mandatory record per `PROCESS_RULE_SPRINT_ORDER.md`'s Step
3. Every public Standard Library function is marked below as either
Frozen (safe for URPM/examples/docs to depend on) or Provisional (may
still change). This file is the single reference for that status —
individual module docs point back here rather than restating it.**

---

| Module | Function | Signature | Status | Reasoning |
|---|---|---|---|---|
| `std.math` | `abs` | `abs(x: int): int` | **Frozen** | Behavior fully specified (absolute value), directly tested on all sign cases. |
| `std.math` | `min` | `min(a: int, b: int): int` | **Frozen** | Same — fully specified, directly tested. |
| `std.math` | `max` | `max(a: int, b: int): int` | **Frozen** | Same. |
| `std.math` | `clamp` | `clamp(x: int, lo: int, hi: int): int` | **Frozen** | Same — tested above, below, and within range. |
| `std.io` | `write` | `write(s: string): int` | **Frozen** | Directly delegates to the already-established `print` builtin's own behavior; no new semantics introduced. |
| `std.io` | `writeLine` | `writeLine(s: string): int` | **Frozen** | Behavior fully specified (two `print()` calls) and directly tested; the underlying `print` builtin's own behavior is already established elsewhere in this project. |
| `std.io` | `readLine` | `readLine(): string` | **Provisional** | Delegates entirely to the `input()` builtin, whose own precise semantics (line-boundary behavior, end-of-input behavior) were NOT independently verified this round — only that the wrapper itself compiles and runs without error. Do not treat `readLine`'s exact behavior as stable until `input()`'s own semantics are directly tested and documented. |

## Consequence for URPM / Documentation / Examples

- Safe to build on: `abs`, `min`, `max`, `clamp`, `write`, `writeLine`.
- **Not yet safe to build on**: `readLine` — any example or package
  depending on its exact behavior should note this Provisional status
  explicitly, or wait for it to be verified and re-marked Frozen.

## Return Type Note (applies to all functions above)

Every function returns `int` even where the return value is
meaningless (`write`/`writeLine` always return `0`) — this is a
current compiler limitation, not a Standard Library design choice: UR
v1.0 does not yet have a `void`-equivalent "no meaningful return"
convention distinct from `int`. This is a candidate for
`UR_LANGUAGE_VERSION_MATRIX.md`'s own v1.1+ consideration, not
something this Foundation Sprint's own stdlib work should decide
unilaterally.
