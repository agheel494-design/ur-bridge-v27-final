# Using UR-Bridge Today

**Update (v1.0 Final Sprint): a real CLI now exists — see
`INSTALLATION_GUIDE.md`'s own CLI section. Most users should use `ur
init`, `ur run <file.ur>`, and `ur build <file.ur>` directly; this
guide's own content below (invoking the compiler pipeline
programmatically via direct Node/TypeScript imports) remains accurate
and is kept for advanced use — embedding the compiler in another tool,
scripting a custom build step, or working on UR-Bridge itself — not
because it's the only way to run a UR program anymore.**

---

## The Compiler Pipeline

UR-Bridge compiles source through four stages, each a real, directly
importable function (verified against the current source, not
paraphrased):

```typescript
import { lex } from "./src/compiler/frontend/lexer.js";
import { parse } from "./src/compiler/frontend/parser.js";
import { lowerToIR } from "./src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "./src/backend/wasm/emit-wasm.js";
// or, for the C Backend instead of WASM:
// import { emitC } from "./src/backend/c/emit-c.js";

const source = `
function main(): int
  return 42
end
`;

// 1. Lex
const { tokens } = lex(source, "example.ur");

// 2. Parse
const { program, errors } = parse(tokens, "example.ur");
if (errors.length > 0) {
  console.error("Parse errors:", errors);
  process.exit(1);
}

// 3. Lower to IR
const ir = lowerToIR(program, "example.ur", "example");
if (!ir.ok) {
  console.error("Lowering failed:", ir.diagnostics);
  process.exit(1);
}

// 4a. Emit WASM
const wasmBytes = emitWasmModule(ir.value);
// wasmBytes is a Uint8Array — write it to a .wasm file, or run it
// directly:
const { instance } = await WebAssembly.instantiate(wasmBytes);
const result = (instance.exports.main as () => bigint)();
console.log("Result:", result);

// 4b. OR emit C instead
// const cSource = emitC(ir.value);
// (compile cSource with any C compiler, linking against this
//  project's own Runtime — see WASM_BACKEND_GUIDE.md for the WASM
//  path's own specifics, since the two backends are not identical
//  in supported features as of this writing)
```

## Running This

Save the snippet above (adjusted for your own program) as a `.mts`
file and run it with `tsx` (already a transitive dependency of this
project's own tooling) or compile it with `tsc` first:

```bash
npx tsx my-script.mts
```

## Writing UR Source Files

UR source is plain text, typically saved with a `.ur` extension by
convention (matching every Golden Test case in this project's own
`tests/*/golden/*/program.ur` files) — there is no requirement enforced
by the lexer/parser on file extension, since `lex()`/`parse()` take
raw source text directly, not a file path.

## What This Guide Does Not Cover

- The CLI itself (`ur init`/`run`/`build`/`version`/`help`) — now a
  real, separate tool, see `INSTALLATION_GUIDE.md`'s own CLI section
  and `src/cli/index.ts`.
- The full UR language surface — see `USAGE_EXAMPLES.md` for worked
  examples of what is and is not currently supported by the WASM
  Backend specifically.
- Backend-specific capabilities and limitations — see
  `WASM_BACKEND_GUIDE.md`.
