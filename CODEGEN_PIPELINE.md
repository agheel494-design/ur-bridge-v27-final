# UR Codegen Pipeline — Phase 2.1–2.3

**Status:** complete **within the scope defined below** — not a claim of
general-purpose compiler completeness. See `IR_SPEC.md` and
`BACKEND_SPEC.md` for the detailed feature matrices this document
summarizes.

---

## 1. The Full Pipeline

```
UR Source
    │
    ▼
Lexer            (src/compiler/frontend/lexer.ts)       — Level 1, frozen
    │
    ▼
Parser           (src/compiler/frontend/parser.ts)      — Level 1, frozen
    │
    ▼
AST              (src/compiler/frontend/ast.ts)         — Level 1, frozen
    │
    ▼
Semantic         (src/compiler/semantic/index.ts)       — Level 1, frozen
    │
    ▼
Type Checker     (src/compiler/typesystem/checker.ts)   — Level 1, frozen
    │
    ▼
IR Lowering      (src/compiler/codegen/lower-to-ir.ts)  — Level 2.2, NEW
    │
    ▼
SSA IR           (src/shared/ir.ts)                     — Level 2.1, NEW
    │
    ▼
C Emission       (src/backend/c/emit-c.ts)              — Level 2.3, NEW
    │
    ▼
gcc              (tools/backend/c-compile.ts)           — Level 2.3, NEW
    │
    ▼
Executable
```

Everything above "IR Lowering" is Level 1 — **frozen**, per the Level 2
execution plan's explicit rule: no Grammar/Lexer/Parser/AST/TypeSystem
changes except confirmed bug fixes. Nothing in Level 2.1–2.3's work
touched any of those files.

---

## 2. Precondition Contract

`lowerToIR()` REQUIRES its input `Program` to have already passed both
`analyze()` (Semantic) and `typeCheck()` (Type Checker) with **zero
error-severity diagnostics**. It does not re-validate correctness — it
assumes a well-formed, well-typed program and focuses purely on IR
construction. This is a deliberate layering decision: Semantic and
TypeChecker remain the single source of truth for "is this program
valid," and Codegen never duplicates or second-guesses that judgment.

---

## 3. Scope of Phase 2.1–2.3 (exact, not aspirational)

**Supported end-to-end (UR Source → real executable, real exit code,
real memory-safety verification):**
- Variable declarations and reassignment (SSA-correct)
- Arithmetic, comparison, and logical operators
- Direct function calls (including nested, including forward references)
- `return` (explicit)
- All 10 supported natural languages (keywords only — `main` identifier
  is never localized, see BACKEND_SPEC.md §3)

**Explicitly NOT supported, confirmed rejected with a clear `CG1001`
diagnostic (never silently miscompiled):**
- `if` / `else`, `while`, `for` — control flow requires branches + phi
  nodes, a separate not-yet-started phase
- `struct`, arrays, maps, tuples
- FFI calls from generated code
- Multi-file linking (`import` parses but is inert — see
  BACKEND_SPEC.md §4 for the exact Parsed/Resolved/Linked/Generated
  status breakdown)

**Structurally unreachable via the real UR 1.0 Parser today** (not a
lowering-pass gap — there is no syntax to produce these AST nodes):
- `SwitchStatement`, `TryCatchStatement` (reserved for a future
  Specification revision; the Parser never constructs them)

---

## 4. Verification Methodology

Every claim in this pipeline's documentation is backed by one or more of:

| Verification | Location |
|---|---|
| Unit tests (IR construction, verifier invariants) | `tests/shared/contracts.test.ts` |
| Unit tests (AST→IR lowering, every construct + every rejection) | `tests/compiler/codegen/lower-to-ir.test.ts` |
| Unit tests (C emission structure) | `tests/backend/c/emit-c.test.ts` |
| Real end-to-end tests (gcc compile + real execution + exit code + zero warnings + AddressSanitizer) | `tests/backend/c/e2e-compile-run.test.ts` |
| Golden tests (byte-for-byte IR/C regression guard, proven to catch injected bugs) | `tests/codegen/golden/golden.test.ts` |
| Performance tests (100/1000-program throughput, IR/C size) | `tests/performance/codegen-throughput.test.ts` |

No claim in `IR_SPEC.md` or `BACKEND_SPEC.md` is asserted without a
corresponding automated test in the list above.

---

## 5. What Comes Next (per approved roadmap — not started)

```
Level 2.4 — Runtime Core
    ↓
Standard Library
    ↓
print() / input() / basic memory model
    ↓
LLVM Backend
    ↓
WASM Backend
    ↓
IDE Integration
    ↓
AI Integration
```

Level 2.4 (Runtime Core) is the next phase. It has not been started, has
no code, and has no design document yet. Per this project's established
practice (mirroring how `UR_LANGUAGE_SPEC_1_0.md` was ratified before any
Lexer code was written), Runtime Core's design questions — memory model,
stack/heap ownership, `print`/`input` builtin wiring, error/panic
semantics — should be resolved and reviewed before implementation begins.
