# UR-Bridge — Usage Examples

**Every example below was directly executed and verified before being
written here — the shown output is the actual, real output, not
illustrative.**

---

## 1. Basic Arithmetic

```
function main(): int
  return 2 + 3 * 4
end
```
Result: `14`

## 2. Conditionals

```
function main(): int
  let x = 10
  if x > 5
    return 1
  else
    return 0
  end
end
```
Result: `1`

## 3. Loops — Summing 1 to 10

```
function main(): int
  let total = 0
  let i = 1
  while i <= 10
    total = total + i
    i = i + 1
  end
  return total
end
```
Result: `55`

## 4. Arrays — Basic Access

```
function main(): int
  let scores = [85, 92, 78, 95]
  return scores[2]
end
```
Result: `78` (zero-indexed — element 2 is the third value)

## 5. Arrays — Summing With a Dynamic Index in a Loop

```
function main(): int
  let arr = [10, 20, 30, 40, 50]
  let i = 0
  let sum = 0
  while i < 5
    sum = sum + arr[i]
    i = i + 1
  end
  return sum
end
```
Result: `150`

## 6. Function Calls

```
function square(): int
  return 7
end

function main(): int
  return square() + 1
end
```
Result: `8`

**Note**: as documented in `WASM_BACKEND_GUIDE.md`, only zero-argument
calls are supported today — `square()` above takes no parameters. A
call like `square(7)` is not yet supported by the WASM Backend.

## 7. Bounds Checking — Out-of-Bounds Access Traps

```
function main(): int
  let arr = [1, 2, 3]
  return arr[10]
end
```
This does NOT return a value — it traps at runtime with a WASM
`unreachable` instruction (surfaces as a `WebAssembly.RuntimeError` in
JavaScript hosts), confirmed directly. Bounds checking is mandatory
and cannot be disabled.

## 8. `byte` — an 8-Bit General-Purpose Integer

```
function main(): byte
  let level: byte = 250
  return level
end
```
Result: `250`

**Note**: integer literals are assignable to `byte` directly (e.g.
`250` above), matching the same rule that lets an `int` literal widen
to `float`.

## 9. Char Literals

```
function main(): int
  let initial: char = 'K'
  return 1
end
```
Result: `1` (this example demonstrates the syntax compiling correctly;
`char` values are represented as 1-character strings internally and
are not yet returnable from a WASM-compiled `main` — see
`WASM_BACKEND_GUIDE.md`'s own scope).

A char literal must contain exactly one character — `''` (empty) and
`'ab'` (multi-character) are both rejected with a clear diagnostic.

## 10. `type` Aliases

```
type Age = int

function main(): int
  let a: int = 30
  return a
end
```
Result: `30`

**Important, verified limitation**: as of UR v1.0, the alias NAME
itself (`Age`) **cannot yet be used as an explicit type annotation** —
`let a: Age = 30` fails with `TY1001: unknown type 'Age'` (confirmed
directly). Only the alias DECLARATION itself is supported in v1.0;
using the alias's name as an annotation elsewhere is planned for v1.1
— see `issues/named-type-annotations-not-resolved.md` and
`KNOWN_LIMITATIONS.md`. The example above uses `int` directly in the
annotation, which is the only form that currently works.

## Running These Yourself

Every example above uses only the exact pipeline shown in
`USING_UR_BRIDGE_TODAY.md` — copy any snippet's UR source into that
guide's own `source` variable to run it directly.
