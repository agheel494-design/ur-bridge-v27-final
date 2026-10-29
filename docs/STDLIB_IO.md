# UR Standard Library — `std.io`

**Status: v1.0 Foundation Sprint, second module. Source:
`stdlib/std_io.ur`. API freeze status: see
`STDLIB_API_FREEZE_CHECK.md` — `write`/`writeLine` are Frozen,
`readLine` is Provisional.**

---

## Functions

| Function | Signature | Behavior | Freeze Status |
|---|---|---|---|
| `write` | `write(s: string): int` | Prints `s` with no trailing newline. | Frozen |
| `writeLine` | `writeLine(s: string): int` | Prints `s` followed by a newline. | Frozen |
| `readLine` | `readLine(): string` | Reads a line of input. | **Provisional** — see note below |

## Usage

```
function main(): int
  writeLine("Enter your name:")
  let name = readLine()
  write("Hello, ")
  writeLine(name)
  return 0
end
```

## Implementation Note: Why `writeLine` Uses Two `print()` Calls

String concatenation (`s + "\n"`) was directly tested and confirmed
to fail — the generated C does not compile. `writeLine` instead calls
`print(s)` then `print("\n")` separately, which was directly
confirmed to work. This is a genuine current compiler limitation
(string concatenation doesn't exist), not a stylistic choice — see
`KNOWN_LIMITATIONS.md`.

## Provisional Status of `readLine`

`readLine` delegates entirely to the existing `input()` builtin. This
Sprint verified only that the wrapper function itself compiles and
runs without error — **not** the exact line-boundary or end-of-input
behavior of `input()` itself, which was not independently tested.
Treat `readLine`'s precise behavior as subject to change until this is
verified and its status is updated in `STDLIB_API_FREEZE_CHECK.md`.

## Backend Support

Identical situation to `std.math`: **C Backend only.** The WASM
Backend does not yet support function calls with arguments (confirmed
directly; tracked as v1.1 scope). A permanent test
(`tests/stdlib/std_io.test.ts`) asserts this rejection explicitly.

## Return Type Note

Every function above returns `int` (always `0` for `write`/
`writeLine`) because UR v1.0 has no usable `void` return type —
confirmed directly: `function f(): void ... end` is rejected with
`TY1001: unknown type 'void'`. This is a compiler limitation, not a
Standard Library design choice.
