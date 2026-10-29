# Windows Validation Package — Running Instructions

**Prepared for the independent Windows validation team, per the
`Cross-Platform Validation Freeze` directive. The Linux team performs
no further code changes until this validation's report is received.**

---

## Package Contents

- Full source tree (this archive).
- `CHANGELOG.md` — see the `[RETROACTIVE CORRECTION — stage4-wasm-fix]`
  entry specifically for this fix's own history.
- `KNOWN_LIMITATIONS.md` — updated to reflect the fix.
- `STAGE4_WASM_FIX_REPORT.md` — the Linux-side final report.
- `issues/wasm-loop-local-let-affecting-outer-state.md` — full defect
  history: reproduction, RCA, patch design, fix.
- `issues/wasm-ssa-minimal-reproducer.ur` — the minimal reproducer,
  now a permanent file (previously only existed as a `/tmp` scratch
  file during investigation).
- `examples/fibonacci.ur` — the full, 10-iteration example that
  originally surfaced this defect.
- `tests/backend/wasm/emit-wasm.test.ts` — contains the 3 new
  regression tests (`describe("WASM Backend - STAGE 4 FIX...")`).

## Setup

```bash
git clone <repository-url>
cd ur-bridge-v27-final
npm install
```

**Known limitation, disclosed**: this project's own Linux development
environment cannot reach the npm registry (documented extensively in
`RC2_VALIDATION_REPORT.md`) — every test count reported by the Linux
team used a disclosed substitute, never a real `npx vitest run`. **A
genuine `npm install` + `npx vitest run` on Windows, in a real,
network-connected environment, has never been performed for this
codebase, by any party, at any point.** This is the single most
important thing this validation confirms for the first time.

## Steps to Run

```bash
# 1. Build check
npx tsc --noEmit -p tsconfig.json
# Expected: 0 errors

# 2. Full test suite
npx vitest run
# Expected: all tests pass (Linux-reported count: 2385 — confirm
# whether Windows reports the same count; a difference is not
# automatically a failure, but must be reported and investigated,
# per the standing "any difference is a finding, not an assumed bug" rule)

# 3. WASM-specific tests
npx vitest run tests/backend/wasm/emit-wasm.test.ts
# Expected: all pass, including the 3 "STAGE 4 FIX" tests

# 4. WASM Golden Tests
npx vitest run tests/backend/wasm/golden/golden.test.ts
# Expected: 25/25 pass

# 5. Conformance Suite (standalone, single command)
npm run conformance
# Expected: 11/11 pass, exit code 0

# 6. The minimal reproducer specifically — run this snippet directly
# (create a small script or adapt the pattern in docs/USING_UR_BRIDGE_TODAY.md):
```
```typescript
import { readFileSync } from "fs";
import { lex } from "./src/compiler/frontend/lexer.js";
import { parse } from "./src/compiler/frontend/parser.js";
import { lowerToIR } from "./src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "./src/backend/wasm/emit-wasm.js";

const src = readFileSync("issues/wasm-ssa-minimal-reproducer.ur", "utf-8");
const { tokens } = lex(src);
const { program } = parse(tokens);
const ir = lowerToIR(program, "min.ur", "min");
const bytes = emitWasmModule(ir.value!);
const { instance } = await WebAssembly.instantiate(bytes);
console.log((instance.exports.main as () => bigint)().toString());
// Expected: 1
```

```bash
# 7. fibonacci.ur specifically — same pattern, reading examples/fibonacci.ur
# Expected: 55
```

## What to Report

For each step above: PASS/FAIL, and the exact output if it differs
from the "Expected" line. Per the standing directive: **any
difference between Windows and Linux results is a finding to
investigate, not an assumed defect** — report it as observed, without
speculating on cause; the Linux team's own root-cause process handles
that after receiving the report.
