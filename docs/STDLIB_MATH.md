# UR Standard Library — `std.math`

**Status: v1.0 Foundation Sprint — the first, deliberately minimal
Standard Library module. Source: `stdlib/std_math.ur`. Verified
directly (not assumed) against both backends. API freeze status
(added retroactively when `PROCESS_RULE_SPRINT_ORDER.md`'s Step 3 was
introduced): see `STDLIB_API_FREEZE_CHECK.md` — all 4 functions are
**Frozen**.**

---

## Functions

| Function | Signature | Behavior |
|---|---|---|
| `abs` | `abs(x: int): int` | Absolute value. |
| `min` | `min(a: int, b: int): int` | Smaller of two values. |
| `max` | `max(a: int, b: int): int` | Larger of two values. |
| `clamp` | `clamp(x: int, lo: int, hi: int): int` | Constrains `x` to `[lo, hi]`. |

## Usage

```
function main(): int
  return clamp(abs(0 - 15), 0, 10)
end
```
Result: `10`

## Backend Support (verified directly, not assumed)

- **C Backend: fully supported.** Every function above compiles and
  runs correctly.
- **WASM Backend: NOT supported yet.** Every function here takes
  parameters, and the WASM Backend does not yet support function
  calls with arguments (see `WASM_BACKEND_GUIDE.md` and
  `UR_LANGUAGE_VERSION_MATRIX.md`, tracked as v1.1 scope). This is
  confirmed by a permanent regression test
  (`tests/stdlib/std_math.test.ts`) that will start failing — as a
  signal to update this doc — the day WASM support for call arguments
  actually lands.

## Why the Standard Library Doesn't Yet Include More

Per this Sprint's own deliberately small scope, and per what the
current compiler can actually support (verified directly this round,
not assumed):

- **`std.core`** (`print`/`println`/`panic`/`assert`): only `print`
  exists as a callable builtin (confirmed:
  `src/compiler/semantic/builtins-registry.ts` registers `print` and
  `input`, but NOT `panic` — `panic` is used internally by the
  compiler for bounds-check traps only, not callable from UR source).
  `println` doesn't exist as a distinct builtin either. `assert` would
  need `panic`, which isn't callable. **None of these are ready.**
- **`std.string`**: zero string-manipulation operations exist anywhere
  in the Lowering or Type Checker (confirmed by direct source search).
  **Not achievable without new compiler capabilities — out of
  Maintenance scope for v1.0, and not yet designed for v1.1 either.**
- **`std.array`**: `.length` doesn't work for arrays (member access
  `.` only resolves for structs, confirmed directly: `'a' is not a
  known struct variable`). `push`/`pop` need a dynamically-resizable
  array, which doesn't exist (`KNOWN_LIMITATIONS.md`: "No dynamic
  array length"). **Not achievable.**
- **`std.io`**: `print`/`input` themselves work (confirmed directly,
  including `print` with a string argument) — but `write`/`writeLine`
  would need string concatenation to add a newline, which was not
  verified to work this round, and `readLine` needs more than bare
  `input()` provides (line-boundary semantics weren't checked). **Not
  attempted this round rather than shipped partially verified.**

None of the above are "coming soon" promises — they're accurately
scoped-out for this specific Sprint, pending either new compiler
capability (v1.1+) or further verification work not done this round.
