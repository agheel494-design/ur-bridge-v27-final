# FRI_USER_GUIDE.md — UR's Official Foreign Runtime Interface

Official, complete, user-facing guide to importing and calling external
libraries from UR programs. This is the single authoritative document —
architectural/internal decisions live separately in
`docs/architecture/{FRI_ARCHITECTURE_DECISION,FRI_SECURITY_AND_BEHAVIOR_NOTES,CALL_EXTERNAL_DESIGN_LIMITATIONS}.md`.

Every example below has been run and its output confirmed live before
being written here.

---

## 1. Two ways to call external code

| | `import` + `manifest.json` | `call_external(...)` |
|---|---|---|
| Where the call site looks | `myFn(args)` — reads like a normal UR function | `call_external("runtime", "module", "symbol", args...)` inline |
| Arguments | Real UR expressions (variables, nested calls, anything) | Literal JSON values only (see §5) |
| Best for | A library you'll call more than once | A one-off external call |

**Recommendation: prefer `import` + `manifest.json`** — it has no
argument restrictions and reads more naturally.

## 2. `import` + `manifest.json`

```
my_project/
  main.ur
  ur_packages/
    mathlib/
      manifest.json
```

`ur_packages/mathlib/manifest.json`:
```json
{
  "name": "mathlib",
  "runtime": "python",
  "module": "math",
  "exports": { "sqrtFn": "sqrt" }
}
```

`main.ur`:
```
import mathlib

function main(): int
  return sqrtFn(64)
end
```

Run it — **live, confirmed output**:
```
$ ur run main.ur
8
```

`module` is resolved in this order (first real file found wins):
1. Relative to `manifest.json`'s own directory (recommended — put your
   source file next to the manifest, e.g. `ur_packages/mathlib/mathlib.c`).
2. Relative to the current working directory (the old, still-supported
   style: `"module": "./ur_packages/mathlib/mathlib.c"`).

For compiled runtimes (`c`/`cpp`/`rust`/`go`/`java`/`wasm`), the file
extension may be omitted (`"module": "mathlib"` finds `mathlib.c`
automatically for `runtime: "c"`).

## 3. `call_external(...)`

```
function main(): int
  return call_external("python", "math", "isqrt", 64)
end
```

> **Result type (DR-RB3-03; PM rulings R1-Q1 / R1-Q2).** `call_external` returns `int` only. A float result is
> **rejected** with a typed panic, never truncated. For example, `math.sqrt(64)` is the float `8.0` and panics, so
> the example uses the int-returning `math.isqrt`. A string, array or other non-int result also panics. The panic
> message carries the produced value. Foreign stdout is not a result: it is routed to UR stderr as diagnostics
> (DR-RB3-02).


Same result: `8`. No `manifest.json` needed — everything is inline.

## 4. Runtime support matrix

| `runtime` | Real status | What `module` means |
|---|---|---|
| `python` | **Proven** | A real Python module name (`math`, `os`, `json`, ...) |
| `javascript` | **Proven** | A Node built-in module name, a real Global Object (`Math`/`JSON`/`Date`/...), or a real `.js` file path |
| `typescript` | **Proven** | A real `.ts` file path |
| `c` | **Proven** | A real `.c` source file (extension optional) |
| `cpp` | **Proven** | A real `.cpp`/`.cc`/`.cxx` source file (extension optional) — exported symbols must use `extern "C"` |
| `wasm` | **Proven** | A real, compiled `.wasm` file |
| `rust` | Code path implemented, not runtime-verified (no `rustc` in this project's own dev sandbox) | A real `.rs` **source file** (extension optional) — NOT a crate name |
| `go` | Code path implemented, not runtime-verified (no `go` toolchain in this project's own dev sandbox) | A real `.go` **source file** (extension optional) — NOT a standard-library package name like `fmt` |
| `java` | Code path implemented, not runtime-verified (`javac` absent in this project's own dev sandbox) | A real `.java` source file (extension optional) |

**`csharp`/C# is NOT supported** — deliberately removed from the accepted `runtime` list (was previously announced but never actually implemented; see `docs/architecture/FFI_STATUS.md` for the removal rationale).

**Real, disclosed limitation**: unlike `python`/`javascript`, the
`rust`/`go`/`java` runtimes always compile a real *source file* you
provide — they do not yet support importing that language's own
standard-library packages by name alone (e.g. Go's `fmt`).

## 5. `call_external(...)`'s own real argument rule

`call_external`'s 4th+ arguments must be **literal JSON values written
directly in the call** — numbers, `"strings"`, `[arrays]`,
`{"objects":1}`, `true`/`false`/`null`. **Not** variable references,
**not** nested `call_external(...)` calls.

```
let n = 64
call_external("python", "math", "isqrt", n)        // ✗ rejected (variable argument)
call_external("python", "math", "isqrt", 64)        // ✓ works (returns int 8)
```

**Live, confirmed error for the rejected case**:
```
error: call_external(...) arguments for 'sqrt' are not valid JSON literals (numbers, "strings", [arrays], {"objects":1}, true/false/null) — received: n
```

If you need a variable, **use `import` + `manifest.json` instead** —
it has no such restriction (real UR expressions work normally). See
`docs/architecture/CALL_EXTERNAL_DESIGN_LIMITATIONS.md` for the full
technical reason (this is a deliberate security boundary, not a bug).

## 6. Calling more than one external library at once

```
import mathlib

function main(): int
  return sqrtFn(25) + call_external("javascript", "Math", "abs", -7)
end
```

**Live, confirmed output**: `12` (5 + 7).

Both mechanisms can be freely mixed in the same program, including
different runtimes together in one execution.

## 7. Security — read this before using either mechanism

`call_external` and `import` execute **real, arbitrary code in the
target runtime** — calling `os.system(...)` via FFI is exactly as
dangerous as calling it from a hand-written Python script directly.
**Treat any UR program that imports or calls external code as fully
trusted code**, exactly as you would a script in that other language.

**FRI contract (GATE-026 D3, PM decision Option A):** FRI is **trusted foreign execution**. It provides **no isolation and no sandbox guarantee**, and it is **not a security boundary** between UR and the foreign runtime: foreign code runs with the same rights as the UR process that calls it. The process containment added in R2 (Linux cgroup v2 / Windows Job Object: call timeouts, output limits, termination of the whole foreign process tree, cleanup of per-call temporary directories) is **lifecycle and resource control only**. It does not restrict what foreign code can read, write, execute or reach on the network. Native pointers (`nativeptr`) are rejected at the FRI process boundary before foreign execution begins (GATE-026 D4), and manifest identifiers are validated before any foreign code is generated (GATE-026 D5); both are correctness rules, not isolation.

There is no sandboxing, no allowlist, and none is planned for v1.0 —
see `docs/architecture/FRI_SECURITY_AND_BEHAVIOR_NOTES.md` for the
full official position and `FRI-BACKLOG-002` for the logged, future
opt-in Safe Mode direction.

## 8. Common errors and what they mean

| Error | Real cause |
|---|---|
| `cannot find module 'X' — expected a UR module or manifest.json at ...` | No `ur_packages/X/` directory (or no `index.ur`/`manifest.json` inside it) at that exact path |
| `manifest.json for module 'X' declares runtime 'Y' — only ... are supported` | Typo in `runtime`, or a genuinely unsupported runtime name |
| `could not find module file 'X' — tried: ...` | The named source file doesn't exist at any of the listed real paths tried |
| `external call '...' failed: command not found: spawnSync <tool> ENOENT` | The runtime's own real toolchain (e.g. `rustc`, `go`, `javac`) is not installed on this machine |
| `arguments for '...' are not valid JSON literals` | A `call_external(...)` argument was a variable/expression, not a literal — see §5 |
