# UR Functions & Calls — ABI Specification (Level 2.7)

**Status:** RATIFIED (Frozen with Level 2.7 ABI) — approved after an
independent engineering review round (four requested revisions applied:
separation of ABI guarantees from empirical validation, an explicit ABI
Stability section, a Feature Summary Table, and a Compatibility section).
This document, together with the permanent regression tests in
`tests/compiler/codegen/lower-to-ir.test.ts`, `tests/backend/c/
e2e-compile-run.test.ts`, and `tests/codegen/golden/`, is the frozen
Functions & Calls ABI as of Level 2.7's closure.

**Purpose:** this document does not introduce new behavior. It formally
records what the current function-call model actually does, based on
direct code inspection (`src/compiler/codegen/lower-to-ir.ts`,
`src/backend/c/emit-c.ts`, `src/shared/symbols.ts`) and a 12-scenario
empirical audit (recursion, mutual recursion, nested calls, forward
references, many parameters, void functions — all real `gcc` compiles +
real execution + AddressSanitizer, zero defects found). Level 2.7's job
is to make this existing, working model an explicit, frozen contract —
not to build new capability.

---

## 1. Symbol Naming (Qualified Names)

Every UR function gets a **qualified C symbol name**, computed once by
`qualifiedName()` (`src/shared/symbols.ts`):

```
ur_<sanitized-module>_<function-name>
```

- `<sanitized-module>` is the module name with every non-ASCII-
  alphanumeric-or-underscore character replaced by `_` (explicit
  character-range check, no regex — see the Regex Audit, `CHANGELOG.md`).
- `<function-name>` is the UR source name **verbatim, including non-ASCII
  characters** (e.g. Arabic function names produce a qualified name like
  `ur_main_اجمع`). This is a **documented portability caveat**, not a
  defect — see `BACKEND_SPEC.md` §5 (already recorded at Phase 2.3):
  verified to work on gcc 13.3.0 under `-std=c99 -Wall -Wextra` with zero
  warnings, but relies on a GCC extension rather than a C99 standard
  guarantee. A future symbol-mangling scheme decoupling the qualified
  name from the source spelling remains deferred, unscheduled work.

**Guaranteed:** two functions with the same source name in different
modules never collide (module name is part of the qualified name).
**Not guaranteed / not yet designed:** function overloading (same name,
different parameter types, same module) — UR 1.0 has no overloading at
the language level, so this has never been exercised and is explicitly
out of this ABI's scope.

---

## 2. Calling Convention

**UR uses the host C compiler's own standard calling convention,
unmodified.** There is no UR-specific calling convention layer — every
UR function becomes an ordinary C function (see `emitFunction`/
`emitPrototype` in `emit-c.ts`), and the C compiler (gcc, in this phase)
owns every detail of register/stack parameter passing, return-value
placement, and stack-frame layout. UR does not know or care which
parameters go in registers vs. on the stack — that is entirely the C
ABI's (and ultimately the platform's) responsibility.

### 2.1 Parameter passing

- Parameters are passed **by value**, in **source declaration order**,
  with **no limit enforced by this compiler** — the empirical audit
  verified 8 parameters compile and execute correctly; the real limit is
  whatever the host C compiler/platform ABI imposes (typically far more
  than 8), not anything UR-specific.
- Each parameter's `IRType` maps to a fixed C type (`i64→int64_t,
  f64→double, bool→bool, string→const char*` — `BACKEND_SPEC.md` §2,
  unchanged).
- **Guaranteed:** parameter order is preserved exactly from UR source to
  the emitted C function signature.
- **Not part of this ABI:** how the C compiler physically passes those
  parameters (registers, stack, calling-convention attributes) — that is
  the C compiler's contract, not UR's.

### 2.2 Return values

- A function returns **at most one value**, by value, mapped through the
  same `IRType → C type` table.
- `void`-returning UR functions (no return-type annotation) become C
  `void` functions — verified via the audit's "void-returning mutual
  side-effect-only recursion" scenario.
- **Not part of this ABI yet:** multiple return values, returning
  aggregates (structs/arrays — do not exist in the IR yet; explicitly
  Level 2.8's scope), or returning by reference/pointer.

---

## 3. Recursion

### 3.1 ABI Guarantees

- **Direct recursion** (a function calling itself) is supported.
- **Mutual recursion** (two or more functions calling each other in a
  cycle) is supported.
- **Forward references** (a function calling another function declared
  *later* in the same file, including a later function that is itself
  recursive) resolve correctly, regardless of declaration order.
- Recursion composes with `if`/`else` and `while` (Level 2.6) in both
  directions — a recursive function may contain a loop internally, and a
  recursive call may appear inside a branch or after a loop.
- **No UR-level maximum recursion depth is guaranteed or enforced.**
  Stack depth/overflow behavior is entirely delegated to the host C call
  stack — this compiler does not implement, limit, or check recursion
  depth itself. This absence of a guarantee is itself part of the
  contract: callers must not assume any specific safe depth beyond what
  the underlying platform's C stack provides.

### 3.2 Empirical Validation (evidence for the guarantees above — not itself part of the contract)

- Direct recursion tested with factorial (depth 5) and a 1000-deep
  recursive summation — both produced exactly correct results with zero
  AddressSanitizer findings.
- Mutual recursion tested with an `isEven`/`isOdd` pair.
- Recursion-with-loop composition tested in both directions (loop inside
  a recursive function; recursive call inside a loop's controlling
  `if`).
- Forward-referenced recursive functions tested directly.
- The 1000-deep test succeeding is a fact about the current platform's
  default C stack size, not a guarantee this document makes about any
  other platform or configuration.

### 3.3 How Recursion Is Implemented (internal detail, not ABI)

Recursion is not a distinct feature — it is an ordinary function call
whose target happens to be the currently-lowering function (or an
ancestor in a mutual cycle). Each recursive call becomes an ordinary C
function call; the C compiler and OS own the entire stack-management
question. This implementation strategy could change in a future phase
(e.g. an explicit stack-depth guard) without being an ABI break, as long
as §3.1's guarantees continue to hold.

---

## 4. Nested / Composed Calls

### 4.1 ABI Guarantees

- Function calls may appear as **arguments to other calls**, nested to
  any depth.
- Function calls may appear as the **condition of a `while` loop**.
- A function call's result may be used to update a loop-carried
  (slot-promoted) variable, including in combination with `break`.
- Function calls may appear **inside `if`/`else` branches**, including
  branches that also reassign a slot-promoted variable.
- Function calls may appear in **long chains across many distinct
  functions**.
- None of the above require any special interaction — a function call
  is a function call regardless of where it textually appears; this
  composability follows directly from `CallExpression` lowering
  (Level 2.1/2.2) and `if`/`while` lowering (Level 2.6) reducing to the
  same shared primitives (SSA values, `call` instructions, blocks/
  terminators), not from any construct-specific glue code.

### 4.2 Empirical Validation

- Nested call arguments tested to 8 levels (`add1(add1(add1(...)))`).
- `while` condition as a function call tested directly (`while
  notDone(i)`).
- Loop-carried variable updated via a call result, combined with
  `break`, tested directly.
- Function call inside an `if`/`else` branch that also reassigns a
  slot-promoted variable tested directly (after correcting an unrelated
  test-authoring bug — a genuinely-infinite recursion in the first
  draft, which AddressSanitizer correctly caught as a real stack
  overflow, itself confirming the safety net works as intended).
- Long call chains tested to depth 20 across distinct functions.

---

## 5. What Is ABI vs. Internal Implementation Detail

| Aspect | ABI (guaranteed, would break callers if changed) | Internal detail (may change freely) |
|---|---|---|
| Qualified name scheme (`ur_<module>_<name>`) | ✅ ABI | |
| Parameter order preservation | ✅ ABI | |
| `IRType → C type` mapping | ✅ ABI (shared with Runtime Core's own ABI, `RUNTIME_SPEC.md` §4.4) | |
| At-most-one return value, by value | ✅ ABI | |
| SSA value id numbering within a function | | Internal — never observable outside `IRFunction` |
| Local slot id numbering | | Internal |
| Block id numbering/ordering | | Internal (Level 2.6, frozen at the CFG level, but numeric ids themselves are not a contract) |
| C variable names (`vN`, `slot_<name>`) | | Internal — `emit-c.ts` may rename these freely |
| Recursion depth limit | | **Not UR's contract at all** — delegated entirely to the host C stack |
| Function overloading | | **Does not exist** — not applicable |

### 5.1 ABI Stability

Exactly three changes constitute a breaking ABI change for this
specification:

1. **Changing the qualified-name scheme** (`ur_<module>_<name>` or its
   sanitization rule).
2. **Changing parameter order** (or dropping/reordering parameters for
   an existing function signature).
3. **Changing a function's return type mapping** (which `IRType` a given
   UR return-type annotation maps to).

Changing any of the following is **explicitly NOT a breaking ABI
change** — these are free to evolve as the compiler grows, per the
established Level 2.1–2.6 freeze pattern of separating durable contracts
from implementation details:

- SSA value ids, Local Slot ids, or Basic Block ids/numbering.
- The internal CFG shape produced for a given construct (e.g. how many
  blocks `if`/`while` lowers to).
- Anything in `checkModuleInvariants()`'s internal bookkeeping.

### 5.2 Feature Summary Table

| Feature | ABI | Implementation | Status |
|---|---|---|---|
| Direct recursion | Yes | Current (ordinary call, host C stack) | Stable |
| Mutual recursion | Yes | Current | Stable |
| Forward reference | Yes | Current (signature table built upfront) | Stable |
| Recursion + `if`/`while` composition | Yes | Current | Stable |
| Nested call arguments | Yes | Current | Stable |
| Call as loop condition | Yes | Current | Stable |
| Call result updating a loop-carried slot | Yes | Current | Stable |
| Long call chains | Yes | Current | Stable |
| Parameter passing (by value, source order) | Yes | Current (host C calling convention) | Stable |
| Single return value, by value | Yes | Current | Stable |
| `void` functions | Yes | Current | Stable |
| Recursion depth guarantee | No | N/A | Delegated to host C stack — not UR's contract |
| Function overloading | No | N/A | Out of scope — does not exist at the language level |
| Tail-call optimization | No | N/A | Out of scope — not implemented, not requested |
| Multiple/aggregate return values | No | N/A | Out of scope — Level 2.8 territory |
| Portable (non-GCC-extension) symbol mangling | No | N/A | Deferred, unscheduled (see `BACKEND_SPEC.md` §5) |

---

## 6. Explicitly Out of Scope for This ABI (deferred to later phases)

- Multiple/aggregate return values — Level 2.8 (Arrays/Structs) territory.
- Any UR-level stack-depth guard or tail-call optimization — not
  designed, not requested by the approved plan.
- Function pointers / first-class functions — no such UR 1.0 syntax
  exists.
- A portable (non-GCC-extension-dependent) symbol-mangling scheme for
  non-ASCII function names — remains the same deferred item recorded at
  `BACKEND_SPEC.md` §5 since Phase 2.3.

---

## 7. Summary of Empirical Findings (basis for this document)

12 scenarios tested via real `gcc` compilation, real execution, and
AddressSanitizer — 10 passed on the first attempt; the 2 that initially
"failed" were both confirmed to be errors in the **test program itself**
(a genuinely-infinite recursive test caught correctly by ASan's
stack-overflow detector; an attempt to reassign a function parameter
correctly rejected by Semantic's pre-existing, frozen `SE4002` rule) —
**zero real defects found in the existing function-call model.**

This is the basis for the review's own conclusion: Level 2.7 does not
need to *build* a function-call model — it needs to *document and freeze*
the one that already works, then convert this document's claims into
permanent Golden/E2E/ASan regression tests (Phase 2.7's next step, per
the approved sequencing — not part of this document).

---

## 8. Compatibility

This specification is valid in conjunction with, and assumes unchanged:

- **Level 2.6's CFG model** (`FREEZE_LOG.md` tag `v27-level2-6-control-flow`)
  — the `if`/`while`/`break`/`continue` composition claims in §4 depend
  on the CFG/BasicBlock/Branch/Loop models frozen at that tag.
- **Runtime ABI v1** (`FREEZE_LOG.md` tag `v27-level2-4-runtime-core`,
  `RUNTIME_SPEC.md` §4.4's `UR_RUNTIME_ABI_VERSION`) — the `IRType → C
  type` mapping this document's §5 table references is shared with, and
  must stay consistent with, that ABI.
- **The current Builtins Registry** (`v27-level2-5-stdlib` tag) —
  `print`/`input`/`free` resolve via the Builtins Registry before falling
  through to ordinary user-function resolution; this document's function-
  call claims apply to ordinary (non-builtin) calls, which are the vast
  majority of the empirical audit's scenarios.

**If any of the three frozen tags above are ever revised, this document
must be re-reviewed** — a change to the CFG model, the Runtime ABI
version, or the Builtins Registry's resolution order could invalidate a
claim made here, even if this document's own file is never directly
edited.
