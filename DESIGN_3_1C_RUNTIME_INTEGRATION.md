# Level 3.1C Design Document — Runtime Integration

**Status: IMPLEMENTED AND VERIFIED; DOCUMENTATION CLOSURE IN PROGRESS.
Level 3.1C Runtime Integration has been implemented incrementally through
the defined sub-phases, preserving the staged discipline established for
the WASM backend. The implementation and verification evidence now covers
the runtime import mechanism, required host-import behavior, the shared
string/array memory contract, UR-produced and host-returned string
interoperability, local and extern call resolution, and the Local WASM
String ABI. Full regression verification completed with 0 failures for
the recorded run; skipped tests remain skipped and are not counted as
verified behavior. This document is being updated to reflect the shipped
implementation and its verified scope before Level 3.1C is formally
declared CLOSED.**

---

## 1. Grounding: What Already Exists (verified directly against the shipped IR, not assumed)

Before designing anything new, the actual existing `Extern`/Builtins
shape was inspected directly:

- `ExternSymbol` (in `src/shared/ir.ts`) already has `name`,
  `returnType`, `parameterTypes`, `callingConvention`, `kind`
  (`"runtime" | "ffi" | "system" | "future"`), and `lifecycleRole`
  (`"init" | "shutdown" | "none"`).
- The C Backend already consumes 9 real externs successfully (verified
  directly from Golden Test output during RC2 work):
  `ur_runtime_init`, `ur_runtime_shutdown` (the two lifecycle-role
  externs, auto-invoked), `ur_print_int`, `ur_print_float`,
  `ur_print_bool`, `ur_print_string`, `ur_input_string`, `ur_free`,
  `ur_panic` (ordinary externs, `lifecycleRole: "none"`).
- **Critically: the SAME `call` IR instruction is already used for
  BOTH regular UR function calls and extern calls.** The distinction
  is validated once, backend-agnostically, by `shared/ir.ts`'s own
  invariant checker (`targetIsLocalFn`/`targetIsExtern`, confirmed
  directly at lines ~493-495) — BEFORE either backend runs. The C
  Backend's own emission code doesn't need to re-distinguish them at
  all (confirmed directly: `emit-c.ts` has no local/extern branch for
  ordinary `call` emission), since C syntax for calling a local
  function and calling an extern function is identical (`name(args)`)
  — it only special-cases the two `lifecycleRole`-tagged externs
  (`init`/`shutdown`) for their auto-invocation. **This means 3.1C
  does NOT need any new IR shape** — the Extern mechanism is already
  frozen, already validated generically, and already exercised by 9
  real functions on the C Backend. 3.1C's own job is narrower than it
  might first appear: unlike C, WASM's `call` opcode needs a NUMERIC
  function index, and imported vs. local functions occupy DIFFERENT
  index ranges — so the WASM Backend, unlike the C Backend, DOES need
  its own explicit local/extern resolution step at emission time
  (§3.1C.4 below), even though the IR itself required no change.

## 2. Critical Dependency Not Captured in the v28 Roadmap's Dependency Graph (correction)

`UR_BRIDGE_V28_MASTER_ROADMAP.md` §5 shows M3 (`unop`) → M4 (call
args) as independent of M2 (3.1C). This is accurate for M2's own
*mechanism* (WASM imports can be designed and implemented without call
arguments existing at all) — but **M2 is not practically USABLE
without M4**: every real Builtin except the two lifecycle-role ones
(`ur_runtime_init`/`shutdown`, which are auto-invoked with no
UR-level call site at all) takes at least one argument
(`print(x)`, `free(s)`). **Correction to record**: M2 can be
*implemented* independently of M4, but a usable end-to-end `print`
call requires both M2 and M4 to have landed. This should be reflected
as a soft dependency in any future revision of the v28 roadmap's
dependency graph — noted here, not silently absorbed into 3.1C's own
scope creep.

## 3. Sub-Phase Breakdown (mirroring 3.1B.1 → 3.1B.5's own discipline)

### 3.1C.1 — WASM Import Mechanism (foundation)

**Goal**: emit a WASM `import` section entry for each extern the
module actually references (not all 9 unconditionally — matching this
project's own "don't over-allocate" discipline already applied to the
Memory section).

**Technical requirement**: WASM's function index space places
imported functions BEFORE locally-defined ones — every existing
`functionIndexByName` map in `emit-wasm.ts` (already used for local
`call` resolution) needs its indices shifted by the import count, or a
second map introduced for imports specifically. This is the single
most WASM-specific detail 3.1C.1 must get right — a CFG or Memory
Model concern in the same sense 3.1B.1 had one? No — this is a purely
mechanical index-space concern, closer to 3.1B.1's own bump-allocator
index bookkeeping than to a new CFG shape.

**Explicitly out of scope for 3.1C.1**: passing real string/float data
across the WASM/host boundary (that's 3.1C.3, the Memory Interface) —
3.1C.1 only needs to prove the IMPORT MECHANISM itself works, ideally
with a trivial no-argument, no-return extern first (matching this
project's own "prove the simplest case first" pattern from 3.1A.3's
own zero-argument-calls-first approach).

### 3.1C.2 — Host Functions (the JS/runtime side)

**Goal**: define what a host environment must provide to satisfy the
imports 3.1C.1 emits — e.g., a JS object passed to
`WebAssembly.instantiate(bytes, { ur_runtime: { ur_print_int: (n) =>
... } })`.

**Design question, not yet answered**: does this project's own test
harness (the same `WebAssembly.instantiate()` pattern used throughout
every WASM Golden Test) provide these host functions itself, or does
3.1C.2 need its own dedicated runtime shim file (mirroring
`tools/backend/c-compile.ts`'s role for the C Backend)? Likely the
latter, given the C Backend's own precedent — but this is 3.1C.2's own
first design question, not decided here.

### 3.1C.3 — Memory Interface (string data across the boundary)

**Goal**: `ur_print_string`/`ur_input_string`/`ur_free` all take or
return UR's `string` type — which needs a defined representation in
WASM linear memory (length-prefixed bytes, matching the array header's
own `[length, ...elements]` pattern already ratified in
`WASM_MEMORY_MODEL_SPEC.md`, for consistency) and a defined protocol
for the host side to read/write that representation.

**Explicitly out of scope for 3.1C.3**: any change to the Array Memory
Model's own address formula or header layout — strings should get
their OWN, separate representation, not be silently folded into the
existing array model (matching this project's own discipline of never
silently expanding an already-ratified Memory Model without its own
review).

### 3.1C.4 — Wiring `call` to Externs

**Goal**: extend `encodeExpr()`'s existing `call` handling (currently
only resolves `functionIndexByName` for local functions) to also check
`module.externs`, matching `shared/ir.ts`'s own existing
generic local/extern resolution check (confirmed above, §1) — but
unlike that generic check (which only needs to confirm the callee
resolves to *something*), the WASM Backend's own version must resolve
to the CORRECT numeric index space (imported vs. local).

**Depends on**: 3.1C.1 (import indices must exist first), and
practically on M4 (call arguments) landing for this to matter for any
real Builtin — see §2's correction.

## 4. Proposed Invariants (for ratification during 3.1C's own review — not ratified here)

> **Invariant 3.1C.1 (proposed)**: every extern referenced by at least
> one `call` instruction in the module MUST have a corresponding WASM
> `import` entry; every WASM `import` entry MUST correspond to a real,
> referenced extern (no unconditional import of all 9 known Runtime
> functions regardless of use — matching the Memory section's own
> "only what's needed" precedent).

> **Invariant 3.1C.4 (proposed)**: a `call` instruction's `callee`
> resolves to EXACTLY ONE of: a local function index, or an imported
> extern index — never both, never neither (the second half of this
> already holds today via `shared/ir.ts`'s own existing invariant
> checker, lines ~493-495, reusable almost verbatim for the WASM
> Backend's own equivalent check).

## 5. Proposed Contracts

- `WASM_IMPORT_CONTRACT` (3.1C.1) — every referenced extern gets
  exactly one import; unreferenced externs get none.
- `HOST_FUNCTION_CONTRACT` (3.1C.2) — the test harness's own host-
  function shim correctly satisfies every import 3.1C.1 can emit.
- `MEMORY_INTERFACE_CONTRACT` (3.1C.3) — string round-trips correctly
  across the WASM/host boundary in both directions.
- `EXTERN_CALL_RESOLUTION_CONTRACT` (3.1C.4) — builds on
  `shared/ir.ts`'s existing generic local/extern resolution check
  (§1), extended to resolve the correct WASM index space.

## 6. Risks (specific to 3.1C, supplementing the v28 roadmap's own general M2 risk entry)

1. **Import index-space bugs are easy to get subtly wrong and easy to
   silently "work" for the first, simplest test** (matching this
   project's own repeated lesson from the RC2 critical bug: absence of
   an early failure is not proof of correctness) — 3.1C.1's own test
   plan must include a case with BOTH an import AND multiple local
   functions, checking specifically that local function indices shift
   correctly, not just that a single import works in isolation.
2. **The Memory Interface (3.1C.3) risks silently expanding the Array
   Memory Model's scope** if string representation is designed
   carelessly — explicitly mitigated in §3.1C.3 above.
3. **Builtins landing before M4 (call arguments) creates a period
   where 3.1C is "done" but not practically usable** — acceptable per
   §2's correction, but should be stated plainly in 3.1C's own closure
   review when it happens, not glossed over.

## 7. What This Document Does NOT Decide

- The exact host-function shim's file location/structure (3.1C.2's
  own first design question).
- The exact string memory representation (3.1C.3's own CFG/design-
  first step, not decided in a planning document).
- Whether 3.1C.1-3.1C.4 ship as four independent reviewed batches or
  some are combined — that's a decision for whoever begins 3.1C's own
  implementation, following this project's own "narrowest safe batch"
  precedent (e.g., 3.1B.2/3.1B.4's own batching lessons).

## 8. Out of Scope for 3.1C (prevents scope creep)

Explicitly NOT part of 3.1C, regardless of how small an addition might
seem during implementation:

- **Garbage Collector** — arrays remain bump-allocated, never freed,
  matching the Memory Model's own already-ratified design (unchanged
  by 3.1C's own Memory Interface work in 3.1C.3, which concerns
  string representation only, not a GC scheme).
- **WASI** (WebAssembly System Interface) — 3.1C's Host Functions
  (3.1C.2) are this project's OWN, narrow, hand-defined imports
  (`ur_print_int` etc.), not a WASI implementation. Adopting WASI is a
  distinct, much larger design question for a future milestone, not
  an incidental part of 3.1C.
- **Threads** — no shared-memory threading model, no WASM `shared`
  memory, no atomics. Out of scope entirely.
- **Async** — no `async`/`await`-style suspension, no WASM stack-
  switching proposals. Every Host Function call in 3.1C is synchronous.
- **OS-level syscalls** — 3.1C's Host Functions are limited to the 9
  already-existing Runtime externs (`ur_print_*`, `ur_input_string`,
  `ur_free`, `ur_panic`, plus the two lifecycle-role ones). No new
  syscall-style extern (file I/O, networking, environment variables)
  is introduced by 3.1C.
- **Advanced/dynamic Runtime features** — no dynamic linking, no
  reflection, no runtime type information beyond what already exists.
  3.1C wires up a FIXED, already-known set of Host Functions — it does
  not introduce a general extensibility mechanism for adding new ones
  at runtime.

## 9. Acceptance Criteria Per Sub-Phase (measurable, for implementation and independent review)

### 3.1C.1 — WASM Import Mechanism
- [ ] The compiler generates a syntactically valid WASM `import`
      section for a module referencing at least one extern (confirmed
      via `WebAssembly.validate()`, matching this project's own
      standing verification method for every prior WASM batch).
- [ ] A module referencing ZERO externs generates NO import section
      entries (matching the "only what's needed" Invariant proposed
      in §4).
- [ ] Local function call indices remain correct in the presence of
      one or more imports (the specific risk flagged in §6, risk 1) —
      verified with a test case combining an import AND multiple local
      functions, not just an import in isolation.

### 3.1C.2 — Host Functions
- [ ] At least one Host Function can be called successfully end-to-end
      from a compiled WASM module via `WebAssembly.instantiate()` with
      a real JS host-function object supplied.
- [ ] Calling an unsatisfied import (a host object missing a required
      function) fails clearly and is confirmed as an expected,
      documented failure mode — not a silent wrong-behavior.

### 3.1C.3 — Memory Interface
- [ ] A string value can be written into WASM linear memory by UR code
      and correctly read back by a Host Function (e.g. `ur_print_string`
      receiving the correct bytes).
- [ ] A string value returned BY a Host Function (e.g.
      `ur_input_string`) is correctly readable by subsequent UR code.
- [ ] The chosen string representation is confirmed NOT to alias or
      overlap the existing Array Memory Model's own address space
      (the risk flagged in §6, risk 2) — verified directly, not assumed.

### 3.1C.4 — Wiring `call` to Externs
- [ ] A `call` to a local function still resolves correctly (no
      regression — full existing suite passes unchanged).
- [ ] A `call` to an extern resolves to the correct WASM import index,
      confirmed by successful execution, not just successful
      compilation.
- [ ] A `call` to a name that is neither a local function nor a
      declared extern is still cleanly rejected (matching
      `shared/ir.ts`'s own existing generic check, now also verified
      not to have regressed for the WASM Backend specifically).

**Overall 3.1C closure additionally requires** (matching every prior
milestone's own bar, per `UR_BRIDGE_V28_MASTER_ROADMAP.md` §6): Golden
Test(s) with regression-detection proven by deliberate corruption and
revert, full regression suite passing with 0 failures, and
documentation updated to match shipped behavior.



3.1C's mechanism is smaller than its name suggests: the Extern/Builtins
IR shape already exists and is already proven by the C Backend. 3.1C's
real work is teaching the WASM Backend to resolve `call` against WASM
imports instead of only local functions, plus the host-side plumbing
(3.1C.2) and string memory representation (3.1C.3) needed to make that
resolution meaningful. The one correction this design work surfaced
against the v28 roadmap: M2's practical usefulness has a soft
dependency on M4 not captured in the original dependency graph.

**Per explicit review, two additions round out this document**: §8
(Out of Scope) names six specific things 3.1C deliberately excludes
(GC, WASI, Threads, Async, OS syscalls, dynamic Runtime extensibility)
to prevent scope creep during implementation; §9 gives each sub-phase
measurable Acceptance Criteria, usable directly by whoever implements
and whoever independently reviews each batch.
## 10. Implementation and Verification Status

Level 3.1C has completed its implementation and verification work for the
scope exercised by the recorded acceptance tests.

### 3.1C.1 — WASM Import Mechanism

**Status: IMPLEMENTED AND VERIFIED**

Verified coverage includes:

- Empty runtime import section behavior.
- Required runtime imports are emitted when needed.
- Missing required host imports fail rather than silently succeeding.
- Local-call behavior remains covered alongside imported-function index handling.

### 3.1C.2 — Host Functions

**Status: IMPLEMENTED AND VERIFIED**

Verified coverage includes successful host-function execution and explicit
failure when a required runtime host import is unavailable.

### 3.1C.3 — Memory Interface

**Status: IMPLEMENTED AND VERIFIED FOR THE TESTED SCOPE**

The implemented WASM string representation uses an `i32` linear-memory
offset pointing to an 8-byte length header followed by UTF-8 payload bytes.
Strings and arrays share the existing bump-allocation state.

Recorded verification covers:

- UR-produced ASCII string → Host reads the expected bytes/string.
- UR-produced multi-byte UTF-8 string → Host reads the expected string.
- Host-returned string → UR subsequently uses it.
- String/array non-alias behavior for the tested cases.

`const_string` literals are materialized at runtime using the shared memory
allocation contract. No separate string allocator or WASM Data Section
architecture was introduced by this work.

### 3.1C.4 — Local and Extern Call Integration

**Status: IMPLEMENTED AND VERIFIED FOR THE TESTED SCOPE**

Recorded verification covers:

- Existing local WASM calls.
- Extern import execution.
- Rejection of unresolved/non-declared calls.
- Local string parameters represented as `i32` pointers.
- Local string returns represented as `i32` pointers.
- End-to-end `write("hi")` execution.
- End-to-end `writeLine("hi")` execution.

### Regression and Integration Evidence

The recorded full regression run completed with:

- 171 test files passed.
- 13 test files skipped.
- 3711 tests passed.
- 32 tests skipped.
- 0 failures.
