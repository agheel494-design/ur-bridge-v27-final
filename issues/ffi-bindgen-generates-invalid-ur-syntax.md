# Issue: FFI Bindgen Generates Text That Is NOT Valid UR v1.0 Syntax

**Status: FIXED. `emitUrBindings()` (`src/ffi/bindgen/emitter.ts`)
rewritten to target real UR v1.0 syntax exclusively. Closure condition
met: 4 end-to-end tests (`tests/ffi/integration.test.ts`) generate a
real binding and run it through the actual UR lexer → parser → type
checker, asserting zero errors — all pass. A real identifier-collision
bug (C's common `type` field/param name vs. UR's reserved `type`
keyword) was found and fixed during this exact closure testing.**

## Finding

`src/ffi/bindgen/emitter.ts`'s `emitUrBindings()` produces text meant
to look like UR source code, for a given parsed/converted C header.
This text uses syntax that does not exist anywhere in
`UR_LANGUAGE_SPEC_1_0.md` and fails to parse with the real UR
lexer/parser.

## Reproduction

Using the exact SQLite3 header case from
`tests/ffi/integration.test.ts`:

```typescript
import { parseCHeader } from "../../src/ffi/bindgen/c-header-parser.js";
import { convertCHeaderToAbi } from "../../src/ffi/bindgen/converter.js";
import { emitUrBindings } from "../../src/ffi/bindgen/emitter.js";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";

const h = parseCHeader(`
typedef struct sqlite3 sqlite3;
int sqlite3_open(const char *filename, sqlite3 **ppDb);
int sqlite3_close(sqlite3 *db);
`);
const { module } = convertCHeaderToAbi(h, { moduleName: "sqlite3", filterPrefix: "sqlite3_" });
const code = emitUrBindings(module, { modulePath: "extern/sqlite3" });

const { tokens } = lex(code);
const { errors } = parse(tokens);
console.log(errors.length); // 43
```

**Result: 43 parse errors**, confirmed directly.

## Generated Text (for reference)

```
module extern/sqlite3;

extern "C" __ffi {
    fn sqlite3_open(filename: CStr, ppDb: *?mut *?mut sqlite3) -> i32;
    fn sqlite3_close(db: *?mut sqlite3) -> i32;
}

pub fn sqlite3_open(filename: CStr, ppDb: *?mut *?mut sqlite3) -> i32 {
    unsafe { __ffi::sqlite3_open(filename, ppDb) }
}
pub fn sqlite3_close(db: *?mut sqlite3) -> i32 {
    unsafe { __ffi::sqlite3_close(db) }
}
```

Uses: `fn` (real UR uses `function`), a `module` statement (doesn't
exist in v1.0), `pub` visibility modifier (doesn't exist), Rust-style
pointer/mutability syntax `*?mut` (doesn't exist), an `unsafe { }`
block (doesn't exist), and `__ffi::` namespace-qualified calls
(doesn't exist). None of these appear anywhere in
`UR_LANGUAGE_SPEC_1_0.md` or `UR_LANGUAGE_VERSION_MATRIX.md`.

## Why This Was Invisible Until Now

`tests/ffi/bindgen.test.ts`'s own test, named "emits valid UR binding
code," only checks `expect(code).toContain(...)` for specific
substrings (e.g. `"fn sqlite3_open("`) — it never actually parses the
output with the real UR parser. The test's own name overstates what
it verifies; passing this test does not mean the output is valid UR.

## Two Resolution Paths (neither implemented — documented for a future decision)

**(a) Extend the real UR language** to support `fn`/`module`/`pub`/
`unsafe`/`*?mut` as a deliberate v28 design decision — a substantial
scope of its own, needing the same CFG-design discipline as any prior
UR syntax addition (see `UR_LANGUAGE_V1_0_FINAL_SPECIFICATION.md`'s
own precedent for how control-flow features were handled).

**(b) Rewrite `emitUrBindings()`** to emit valid UR v1.0 syntax
(`function`, no `module` statement, no `unsafe`/`*?mut`) so generated
bindings are usable with the language as it exists today.

**Recommended**: (b), as the faster, lower-risk path to a genuine
"call a real C function from UR" milestone — matching this project's
own repeated preference for minimal, scoped fixes over broad
redesigns. (a) remains a legitimate, separate future decision if the
aspirational syntax turns out to be intentional, pre-existing design
work rather than an oversight — this was not determined this round.

## Test Suite Correction Needed (not performed this round — flagged)

`tests/ffi/bindgen.test.ts`'s "emits valid UR binding code" test
should be renamed or supplemented with an actual parse-through-the-
real-UR-parser assertion, so a similar gap can't go unnoticed again.
