# UR Language — Official Examples

**Status: Stage 2 of the sequential development roadmap. Every
example below is directly tested (`tests/examples.test.ts`) and
verified to compile and run correctly on the C Backend.**

---

## Examples, Organized by Category

**Only categories with genuinely working, verified examples are
listed.** Per explicit policy: no example or documentation is created
for unsupported features — categories like AI, Robotics, Networking,
Web, Packages, and file I/O beyond `print`/`input` are not listed
below because they are not achievable with the current compiler (see
`KNOWN_LIMITATIONS.md` for the specific, confirmed reasons: no string
operations, no dynamic arrays, no networking/file primitives, no
package manager yet).

### Basics
| File | Demonstrates | Result | Backends |
|---|---|---|---|
| `basics_rectangle_area.ur` | Variable declarations, arithmetic — no functions/loops | `60` | **C and WASM** |
| `byte_pixel.ur` | The `byte` type | `255` | C and WASM |
| `type_alias.ur` | `type` alias declaration | `30` | C and WASM |

### Functions
| File | Demonstrates | Result | Backends |
|---|---|---|---|
| `factorial_recursive.ur` | Recursive calls, typed parameters | `120` | C only¹ |
| `std_math_usage.ur` | Using the `std.math` Standard Library module | `100` | C only¹ |

### Loops
| File | Demonstrates | Result | Backends |
|---|---|---|---|
| `fibonacci.ur` | `while` loops, iterative computation | `55` | **C and WASM** (fixed in Stage 4 — see `KNOWN_LIMITATIONS.md`) |
| `array_sum.ur` | Loop + array accumulation | `108` | **C and WASM** |

### Arrays
| File | Demonstrates | Result | Backends |
|---|---|---|---|
| `array_sum.ur` | Array literals, indexing (also listed under Loops) | `108` | C and WASM |

### Structs
| File | Demonstrates | Result | Backends |
|---|---|---|---|
| `struct_point.ur` | Struct construction (via inference) + field access | `4` | C only¹ |

¹ Uses function calls with arguments, which the WASM Backend does not
yet support — see `WASM_BACKEND_GUIDE.md`.

## Running an Example Yourself

Examples are `.ur` source files, not standalone executables — compile
and run one via the same pipeline documented in
`docs/USING_UR_BRIDGE_TODAY.md`:

```typescript
import { readFileSync } from "fs";
import { lex } from "./src/compiler/frontend/lexer.js";
import { parse } from "./src/compiler/frontend/parser.js";
import { lowerToIR } from "./src/compiler/codegen/lower-to-ir.js";
import { emitC } from "./src/backend/c/emit-c.js";
import { compileC, runExecutable } from "./tools/backend/c-compile.js";

const src = readFileSync("examples/fibonacci.ur", "utf-8");
const { tokens } = lex(src);
const { program } = parse(tokens);
const ir = lowerToIR(program, "fibonacci.ur", "fibonacci");
const compiled = compileC(emitC(ir.value!), "a.out", { captureWarnings: true });
console.log(runExecutable(compiled.value!).exitCode); // 55
```

## Why WASM Isn't Shown Above

`struct_point.ur`, `factorial_recursive.ur`, and `std_math_usage.ur`
all use function calls with arguments, which the WASM Backend does
not yet support (see `WASM_BACKEND_GUIDE.md`) — these three are
correctly C-Backend-only.

`array_sum.ur`, `type_alias.ur`, and `byte_pixel.ur` were directly
verified to also produce the correct result on WASM (`108`, `30`,
`255` respectively) during this stage's own review.

**`fibonacci.ur` was found to produce an INCORRECT result on WASM
during this stage's own review (`512` instead of `55`) — this was a
real, previously-undiscovered WASM Backend defect (see
`issues/wasm-loop-local-let-affecting-outer-state.md`), since FIXED
(Stage 4). `fibonacci.ur` now produces the correct `55` on WASM too,
confirmed directly and covered by a permanent regression test
(`tests/backend/wasm/emit-wasm.test.ts`).**

## Known Limitations of This Example Set

- **No `std.io` example** — every `std.io` function
  (`write`/`writeLine`/`readLine`) either needs runtime I/O (not
  meaningfully testable in an automated suite the way `readLine`
  works) or would look identical to `std_math_usage.ur`'s own pattern
  (inlining a Standard Library module's source) without adding new
  demonstration value. Deferred, not omitted by oversight.
- **`std_math_usage.ur` inlines `stdlib/std_math.ur`'s source
  verbatim** rather than importing it — UR v1.0 has no `import`
  mechanism wired to the Standard Library yet. Confirmed byte-for-byte
  identical to the real module's source (not a reimplementation) via
  direct comparison during this stage's own review.
- **Not exhaustive** — 8 examples cover a representative slice of
  confirmed-working v1.0 features, not every combination. See
  `docs/CONFORMANCE_SUITE.md` for the language's own official,
  systematic behavior reference; examples/ is for illustration, not
  specification.
- **Categories deliberately NOT included** (per explicit Item 2
  policy): AI, Robotics, Networking, Web, Packages, file I/O beyond
  bare `print`/`input` — none are achievable with the current
  compiler. No placeholder or aspirational example exists for any of
  these; they will be added only once the underlying capability is
  genuinely implemented and verified.
