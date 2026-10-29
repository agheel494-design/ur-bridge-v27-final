# UR Runtime Specification — Level 2.4 (Runtime Core)

**Status:** DRAFT — awaiting ratification. No implementation code exists
yet, per this project's established practice (mirroring
`UR_LANGUAGE_SPEC_1_0.md`'s ratification before any Lexer code was written).
No line of Runtime code should be written until this document — or a
revised version of it — is approved.

**Scope of this document:** Runtime **Core** only — the absolute minimum
needed to run a UR program with `print`/`input` and basic memory
operations. It deliberately does NOT design: the full Standard Library,
threads/async, a garbage collector, or a general ownership/borrowing
model. Those are later phases (see §9).

---

## 1. Architecture

### 1.1 What Runtime Core is

A small, hand-written **C library** (`ur_runtime.h` / `ur_runtime.c`)
linked into every UR-compiled executable. It provides a fixed set of
`extern "C"`-style functions that generated code (from `emit-c.ts`) may
call. It is **not** written in UR itself, and it is **not** optional —
every compiled UR program links against it, the same way every C program
implicitly links against parts of libc.

### 1.2 What stays in the Compiler vs. what moves to Runtime

| Concern | Owner |
|---|---|
| Lexing, parsing, type checking | Compiler (Frontend/Semantic/TypeSystem) — unchanged |
| IR construction | Compiler (Codegen) — unchanged |
| Arithmetic, comparisons, control flow (once it exists) | Compiler emits inline C — no Runtime call needed |
| Function calls between UR functions | Compiler emits direct C calls — no Runtime involvement |
| `print(x)`, `input()` | **Runtime** — the Compiler emits a call to `ur_print_*`/`ur_input_*` |
| Memory allocation (future: arrays, dynamic strings) | **Runtime** — `ur_alloc`/`ur_free` wrappers (see §2.3) |
| Panics / fatal errors | **Runtime** — `ur_panic()` (see §7) |
| Program startup/shutdown | **Runtime** — `ur_runtime_init()`/`ur_runtime_shutdown()` (see §3) |

**Design principle:** the Compiler never emits raw libc calls (`printf`,
`malloc`, `exit`) directly. It only ever calls `ur_*` Runtime functions.
This keeps ONE place (`ur_runtime.c`) responsible for every
platform-facing operation, which matters the moment a second backend
(LLVM, WASM) needs the same behavior without duplicating platform logic.

### 1.3 Linking model

`tools/backend/c-compile.ts`'s `compileC()` will be extended to always
compile and link `ur_runtime.c` alongside the generated program — this is
a **Backend build-process change**, not an IR or language change, and
does not touch any Level 1 file.

---

### 1.4 Compiler independence (new — per review)

**The Runtime must know nothing about any compiler stage.** `ur_runtime.c`
contains zero references to, and zero dependencies on:

- Lexer, Parser, AST
- Semantic Analyzer, Type Checker
- IR (`src/shared/ir.ts`)
- Optimizer (future)

The Runtime's entire responsibility is limited to exactly three concerns:

1. **Memory** — `ur_alloc`, `ur_free`
2. **I/O** — `ur_print_*`, `ur_input_string`
3. **Panic / fatal-error handling** — `ur_panic`, plus the ABI version
   check in `ur_runtime_init()` (§4.4)

This mirrors the architectural discipline already enforced elsewhere in
this project (e.g. the Localization layer's proven independence from
Parser/Semantic/TypeSystem, verified by dedicated architecture tests in
`tests/platform/architecture-rules.test.ts`). The same pattern applies
here: **a future architecture test should assert that no file under a
future `src/runtime/` or the `ur_runtime.c` source contains any import
of, or reference to, any Compiler-stage type or function.** This is a
concrete, testable invariant, not just a design intention — it will be
added to the test suite alongside the Runtime Core implementation itself
(see §9).

---

## 2. Memory Model

### 2.1 Current constraint (from Level 2.1–2.3, unchanged)

The existing IR (`src/shared/ir.ts`) has exactly five types: `i64 f64
bool string void`. There are **no arrays, structs, maps, or tuples yet**.
`string` constants today are emitted as C string literals
(`emit-c.ts`'s `emitConstant`) — i.e. **static, read-only, embedded in
the binary's data segment**. There is currently **zero dynamic memory
allocation anywhere in the compiled output**.

### 2.2 Runtime Core's memory scope (deliberately minimal)

Given the above, Runtime Core's memory model is intentionally narrow:

- **Stack**: the C call stack, managed entirely by the host C compiler —
  UR does not introduce its own stack discipline in this phase. Every UR
  function becomes a real C function; C's own calling convention and
  stack frame handle it.
- **Heap**: Runtime Core introduces exactly **two allocation-facing
  functions**: `ur_alloc(size_t)` (thin wrapper around `malloc`) and
  `ur_free(void*)` (thin wrapper around `free`). **Generated code and any
  future Standard Library code must never call C's `free()` directly** —
  every deallocation goes through `ur_free()`. This is a deliberate
  architectural constraint: keeping ALL memory operations behind the
  Runtime's own functions means a future phase can replace `malloc/free`
  with an arena allocator, reference counting, or a garbage collector
  **without changing a single already-compiled UR program or any
  Backend-emitted call site** — only `ur_runtime.c`'s internals change.
- **String representation**: unchanged for *literals* (static C string
  literals, as today). A **dynamically-produced** string (e.g. the result
  of `input()`) is a heap-allocated, null-terminated `char*`, allocated
  via `ur_alloc` and owned by the caller, who is responsible for calling
  `ur_free()` on it when done. This is the ONLY new memory behavior
  Runtime Core introduces.
- **Arrays / struct layout**: explicitly **out of scope** for Runtime
  Core — no IR representation exists for them yet (§3 of
  `IR_SPEC.md`/`BACKEND_SPEC.md`). Designing their memory layout belongs
  to whichever future phase adds them to the IR; doing it now would be
  premature per this project's own YAGNI principle.
- **Ownership**: Runtime Core adopts **no automatic ownership/borrowing
  model** in this phase. Any heap memory `ur_alloc`-ed (currently: only
  `input()`'s result) is **manually managed by the generated code, via
  `ur_free()` only** — never raw C `free()`. There is no automatic
  reference counting or garbage collection yet. A real ownership model
  (manual/ref-counted/GC) remains a genuine open question for the future
  phase that introduces arrays/collections and therefore a much larger
  allocation surface — Runtime Core defers that question by construction
  (almost no allocation exists yet), while still guaranteeing that
  **whatever model is chosen later can be implemented entirely inside
  `ur_runtime.c`**, because `ur_alloc`/`ur_free` are the only sanctioned
  entry and exit points for heap memory. **CONFIRMED** (per review): this
  is the adopted approach for Level 2.4.

---

## 3. Program Startup

```
C's real main()
    │
    ▼
ur_runtime_init()      ← NEW: Runtime Core initialization
    │
    ▼
ur_<module>_main()     ← the UR program's own `main` (unchanged from Phase 2.3)
    │
    ▼
ur_runtime_shutdown()  ← NEW: Runtime Core teardown
    │
    ▼
return (int) result;   ← unchanged exit-code behavior from Phase 2.3
```

`ur_runtime_init()` in this phase does effectively nothing (reserved for
future use — e.g. locale setup for I/O) but exists as a stable hook point
so later phases (threads, async, GC) have a defined initialization
moment without changing the C `main()` wrapper's shape again.
`ur_runtime_shutdown()` is called even if UR's `main` returns
normally — panics (§7) bypass it and call `exit()` directly, matching
the "a panic is not a normal return" semantic every runtime uses.

This changes `emit-c.ts`'s C `main()` wrapper (Backend code, not IR, not
Frontend) — a small, additive change to the two `main()`-wrapper branches
already there.

---

## 4. ABI — How the Backend Calls Runtime

### 4.1 Calling convention

Standard C calling convention — no change needed. Runtime functions are
declared with the same `IRType → C type` mapping already established in
`emit-c.ts` (`i64→int64_t, f64→double, bool→bool, string→const char*`).

### 4.2 The "extern call" gap — IMPLEMENTED (as revised per review)

**Problem:** today, `IRInstruction.call.callee` MUST resolve to a
`qualifiedName` of a function defined *in the same module*
(`checkModuleInvariants()`'s call-resolution check, `IR_SPEC.md` §7).
Runtime functions are not UR functions — they have no UR source, no
`IRFunction` entry, and live in `ur_runtime.c`, not in any lowered
`IRModule`.

**Implemented resolution** (revised from the original draft per review —
the original draft's bare `qualifiedName`/`paramTypes`/`returnType` shape
was rejected in favor of a full contract from the start):

```typescript
// src/shared/ir.ts (IMPLEMENTED)
export type ExternKind = "runtime" | "ffi" | "system" | "future";
export type ExternLifecycleRole = "init" | "shutdown" | "none";

export type ExternSymbol = {
  readonly name: string;
  readonly returnType: IRType;
  readonly parameterTypes: readonly IRType[];
  readonly callingConvention: CallingConvention; // "c" only, for now
  readonly kind: ExternKind;
  readonly lifecycleRole: ExternLifecycleRole; // never optional — "none" is explicit for ordinary functions
};

export type IRModule = {
  readonly moduleName: string;
  readonly functions: readonly IRFunction[];
  readonly externs: readonly ExternSymbol[];
};
```

**Why `kind` and `lifecycleRole` instead of just a bare name list** (per
review): this makes FFI, DLL/shared-library, and future-backend (LLVM/WASM
import) externs representable later without another `IRModule` shape
change — only new `ExternSymbol` entries and, if ever needed, a new
`ExternKind`/`CallingConvention` variant. `lifecycleRole` is **strictly**
limited to `"init" | "shutdown" | "none"` — ordinary Runtime functions
(print/input/panic/free) are never lifecycle roles, only "none".

**`checkModuleInvariants()` was extended with two guarantees** (per
review, "سلامة الـ Runtime مضمونة قبل الوصول إلى الـ Backend"):
exactly one `lifecycleRole: "init"` extern and exactly one
`lifecycleRole: "shutdown"` extern must exist per module — zero or more
than one of either is a verified violation, checked before the Backend
ever runs (see `tests/shared/contracts.test.ts`'s "Runtime lifecycle
safety" suite).

**The Backend (`emit-c.ts`) discovers Init/Shutdown purely by role — it
contains ZERO hardcoded Runtime function names anywhere in its own
source.** It looks up `module.externs.find(e => e.lifecycleRole ===
"init")` and calls `.name` on the result — never a literal string like
`"ur_runtime_init"`. This is enforced by a dedicated, permanent test
(`tests/backend/c/no-hardcoded-runtime.test.ts`) that scans `emit-c.ts`'s
own source code for every Runtime function name and fails if any appear.
Adding, renaming, or replacing a Runtime function therefore **never**
requires a Backend change — only an update to
`src/shared/runtime-table.ts`.

### 4.3 The Runtime function table for this phase (implemented)

| Qualified name | Signature | Purpose |
|---|---|---|
| `ur_print_int` | `(i64) -> void` | print an integer followed by a newline |
| `ur_print_float` | `(f64) -> void` | print a float followed by a newline |
| `ur_print_bool` | `(bool) -> void` | print `true`/`false` followed by a newline |
| `ur_print_string` | `(string) -> void` | print a string followed by a newline |
| `ur_input_string` | `() -> string` | read one line from stdin, return a heap-allocated string owned by the caller (see §2.2) |
| `ur_free` | `(string) -> void` | the **only** sanctioned way to release memory returned by `ur_input_string` — generated code must never call C's `free()` directly. **Note:** the current IR (`src/shared/ir.ts`) has no generic "pointer" type — only `i64 f64 bool string void`. `ur_free` is therefore scoped in this phase to freeing `string`-typed heap allocations specifically (the only heap-allocated IR type that exists). A generic `ur_free(void*)` accepting any future heap-allocated type (arrays, etc.) is deferred until the IR itself grows a type that needs it — introducing a generic pointer *IRType* now, with nothing to use it for, would be premature. |
| `ur_panic` | `(string) -> void` | print to stderr and terminate (see §7); never returns |

**CONFIRMED** (per review): `print`/`اطبع` is **one identifier** in the
UR language — not four separate names, and not a language-level
overloading feature. The dispatch to the correct `ur_print_*` extern
happens **entirely inside the Lowering pass** (`lower-to-ir.ts`), which
already knows every expression's static `URType` (via TypeSystem's
`inferExpr`-equivalent reasoning already reused for `binaryOpResultType`).
This keeps:

- **The language surface clean**: `print`/`اطبع` is a single ordinary
  identifier, resolved specially by the Lowering pass the same way any
  other function-call resolution already works — **no Grammar/Lexer/
  Parser/AST/Semantic/TypeSystem change**, since `print` was never a
  keyword to begin with (see §5).
- **The Runtime simple**: `ur_runtime.c` never simulates overloading —
  it just exposes four distinctly-named, distinctly-typed C functions.
  All "which one do I call" logic lives in exactly one place (the
  Lowering pass), matching this project's established principle of a
  single source of truth per concern.

```
UR:        اطبع(x)  /  print(x)
              │
              ▼
Semantic:  already knows x's type (Level 1, unchanged)
              │
              ▼
Lowering:  emits a call to ur_print_int / ur_print_float /
           ur_print_bool / ur_print_string, chosen by x's URType
              │
              ▼
Backend:   emits the matching C call (§4.2's extern mechanism)
              │
              ▼
Runtime:   the real ur_print_* function executes
```

---

### 4.4 Runtime ABI Version Contract (new — per review)

Every `ur_runtime.c` build declares a single integer constant:

```c
// ur_runtime.h
#define UR_RUNTIME_ABI_VERSION 1
```

Every C file `emit-c.ts` generates embeds the ABI version it was
compiled against:

```c
// emitted at the top of every generated .c file
#define UR_RUNTIME_ABI_REQUIRED 1
```

**CORRECTION (found during implementation, documented transparently):**
the version originally drafted here had `ur_runtime_init(void)` directly
referencing `UR_RUNTIME_ABI_REQUIRED` — but that does **not work in C**:
preprocessor macros are resolved per translation unit at compile time,
and `ur_runtime.c` is compiled separately from the generated program's
`.c` file, so it cannot see the generated file's `#define` at all. The
value must be **passed as a real function argument**:

```c
// ur_runtime.h
void ur_runtime_init(int64_t abi_required);
```

```c
// ur_runtime.c
void ur_runtime_init(int64_t abi_required) {
    if (abi_required != UR_RUNTIME_ABI_VERSION) {
        fprintf(stderr,
            "UR Runtime ABI mismatch: program requires ABI %lld, runtime provides ABI %d\n",
            (long long)abi_required, UR_RUNTIME_ABI_VERSION);
        exit(102); // distinct from the panic exit code (101, §7.2) — an ABI
                   // mismatch is a build/toolchain problem, not a program panic
    }
    /* ... reserved future initialization ... */
}
```

```c
// emitted by emit-c.ts at the top of every generated .c file, and passed
// as the literal argument at the call site inside the generated main()
#define UR_RUNTIME_ABI_REQUIRED 1
/* ... */
int main(void) {
  ur_runtime_init(UR_RUNTIME_ABI_REQUIRED);
  /* ... */
}
```

**Why this matters now, even with a single Backend and no distributed
runtime yet:** the moment `ur_runtime.c`'s internals change in a way that
breaks binary compatibility with previously-generated `.c` output (e.g. a
future phase changes `ur_alloc`'s calling convention, or replaces
`malloc`/`free` with a GC and removes `ur_free` entirely), this check
converts a silent, hard-to-diagnose miscompilation/crash into a clear,
actionable error message at program startup. This costs nothing to add
now and becomes valuable the first time the Runtime's internal contract
changes.

**Versioning policy:** `UR_RUNTIME_ABI_VERSION` increments only on a
breaking change to the Runtime function table in §4.3 (a function
removed, a signature changed, or semantics changed incompatibly). Adding
a new function to the table is NOT a breaking change and does not require
a version bump.

---

## 5. Standard Library Boundary

| Layer | Contains | Phase |
|---|---|---|
| **Runtime Core** (this document) | `ur_print_*`, `ur_input_string`, `ur_alloc`/`ur_free`, `ur_panic`, program startup/shutdown | Level 2.4 — proposed now |
| **Standard Library** | Collections (arrays, maps), higher-level IO (file handles, buffered readers), JSON/CSV/XML, Math beyond basic operators, Crypto, DateTime, Concurrency/Async | Level 2, later phase — needs the IR to support structs/arrays first |

**Principle:** Runtime Core is what makes `print`/`input` and basic
memory work at all. Standard Library is everything ergonomic built *on
top of* those primitives, in a later phase, once the IR itself supports
enough data structures to make a real collections library meaningful.

`print`/`input` are introduced as Runtime Core primitives specifically
because the approved Level 2 execution plan places them before the rest
of the Standard Library (`"3. print() وinput()"` in the requested
implementation order) — they are the one piece of "Standard Library"-ish
surface pulled forward into Runtime Core because nothing else can be
demonstrated end-to-end (a real "Hello World" that prints text, not just
an exit code) without them.

---

## 6. Program Exit Codes

Unchanged from Phase 2.3 (`BACKEND_SPEC.md` §3): a UR `main` returning
`int` or `bool` becomes the real process exit code via the existing C
`main()` wrapper. Runtime Core adds exactly one new exit path: `ur_panic`
(see §7), which does not go through this normal-return mechanism at all.

---

## 7. Error Handling

### 7.1 Runtime errors vs. panics

This phase distinguishes exactly two categories:

- **Normal program errors** (e.g. a UR-level `if`/error-handling
  construct once one exists) — **out of scope**, since UR 1.0 has no
  `try`/`catch`/`Result` type yet (`TryCatchStatement` is a Spec-1.1
  reservation, confirmed structurally unreachable in `IR_SPEC.md`).
- **Fatal Runtime errors ("panics")** — conditions the Runtime itself
  detects that make continued execution meaningless (in this phase:
  realistically only "out of memory" from `ur_alloc`, since there is no
  array indexing, null pointer dereference, or division-by-zero check
  implemented yet — `div`/`mod` by zero is **currently undefined
  behavior in the generated C**, inherited silently from C's own
  semantics, and is flagged here as a known gap, not fixed by this
  document).

### 7.2 Panic behavior (proposed)

```c
void ur_panic(const char* message) {
    fprintf(stderr, "UR panic: %s\n", message);
    exit(101); // proposed panic exit code — see decision point below
}
```

**Decision point requiring confirmation:** exit code `101` for panics
(matching Rust's convention, chosen for familiarity, not because UR
must match Rust) vs. a different UR-specific convention. Any value works
as long as it is documented and distinct from normal 0/1 exit-code usage.

### 7.3 Known gap flagged, not fixed, by this document

Integer division/modulo by zero (`a / 0`, `a % 0`) in the current C
Backend compiles to real C `/`/`%` operators, which is **undefined
behavior in C** for integer division by zero (typically a `SIGFPE` crash
on this platform, not a controlled panic). Fixing this properly means
emitting a runtime check before every `div`/`mod` that calls `ur_panic`
on a zero divisor — **this is a real, scoped piece of Runtime Core work**
this document proposes to include (see §9 implementation order), not a
change to the IR shape (the check is emitted in `emit-c.ts`, wrapping the
existing `div`/`mod` binop emission).

---

## 8. Thread Safety

**Explicitly out of scope.** Runtime Core targets **single-threaded**
execution only. No atomics, no locks, no thread-local state beyond what
a single-threaded C program already has. Concurrency/Async appears in
the original Level 2 plan as a **Standard Library** sub-feature (§5 of
this document), to be designed only once Runtime Core itself is stable —
introducing thread-safety concerns now would be premature given there is
no concurrent execution primitive anywhere in the language yet.

---

## 9. Proposed Implementation Order (pending approval of this document)

1. Extend `IRModule` with `externs` (§4.2) — the one proposed IR change.
2. Write `ur_runtime.h`/`ur_runtime.c` implementing exactly the table in
   §4.3 (`ur_print_*`, `ur_input_string`, `ur_alloc`, `ur_free`,
   `ur_panic`), plus `ur_runtime_init`/`ur_runtime_shutdown` including
   the ABI version check (§4.4).
3. Extend `tools/backend/c-compile.ts` to always compile+link
   `ur_runtime.c` (§1.3).
4. Extend `emit-c.ts`'s `main()` wrapper for `ur_runtime_init`/
   `ur_runtime_shutdown` (§3), and emit `#define UR_RUNTIME_ABI_REQUIRED`
   at the top of every generated `.c` file (§4.4).
5. Extend `lower-to-ir.ts` to recognize `print`/`اطبع` as a single
   builtin identifier (NOT a new keyword — an ordinary identifier
   resolved specially by the Lowering pass, exactly like any other
   function-call resolution already works) and dispatch to the correct
   `ur_print_*` extern based on the argument's known `URType` (§4.3).
   Similarly recognize `input`/an equivalent identifier for
   `ur_input_string`.
6. Add the `div`/`mod`-by-zero panic check to `emit-c.ts` (§7.3).
7. **New architecture test** (§1.4): assert `ur_runtime.c`/`ur_runtime.h`
   contain no reference to any Compiler-stage type, function, or import
   — mirroring `tests/platform/architecture-rules.test.ts`'s existing
   Localization-layer independence checks.
8. Golden tests + real E2E tests: real `print`/`input` output captured
   via `stdout`, matching the existing `stderr`/exit-code verification
   pattern already established in `tests/backend/c/e2e-compile-run.test.ts`.
   Include a real ABI-mismatch test (build two mismatched
   `UR_RUNTIME_ABI_REQUIRED`/`UR_RUNTIME_ABI_VERSION` values and confirm
   the program exits with code 102 and the expected stderr message).
9. Documentation: extend `IR_SPEC.md` (the `externs` field),
   `BACKEND_SPEC.md` (Runtime linking + ABI version emission), finalize
   `RUNTIME_SPEC.md` from this draft to reflect what was actually built.

**Nothing above is implemented yet.** This is the design document the
review requested, submitted for approval before step 1 begins.

---

## 10. Implementation Status (as actually built — Level 2.5 closure)

This section records what was actually implemented, superseding any
"proposed"/"pending" language in §§4.2–4.3, §9 above where it conflicts.

**Builtins dispatch mechanism — REVISED from this document's original
§4.3 proposal**, per a second engineering review round during
implementation. The original proposal envisioned Lowering resolving a
builtin's target extern by matching argument type against
`RUNTIME_CORE_EXTERNS` structurally (i.e., "find the extern whose
parameter type matches this argument's type"). This was found to be
**broken**: `ur_print_string`, `ur_free`, and `ur_panic` all share the
identical `(string) -> void` signature, so this approach could not
distinguish them.

**Implemented instead**: an explicit `BuiltinId` type
(`src/shared/builtins.ts`: `"Print" | "Input" | "Free" | "Panic"`) and a
dedicated resolver, `resolveBuiltinExtern(builtinId, argType?)`
(`src/shared/runtime-table.ts`), which maps `BuiltinId` (+ `IRType` only
for the overloaded `Print`) to a concrete `ExternSymbol` via an explicit
table — never by guessing from type signatures. This was chosen over an
alternative proposal to add a `role` field to `ExternSymbol` directly,
specifically to keep `IRModule`/`ExternSymbol` fully general — carrying
no Print/Free/Input-specific semantics — so the IR remains reusable by
any future Backend/Runtime pairing.

Semantic Analyzer's resolution order (§5 of this document, as
implemented in `src/compiler/semantic/index.ts`'s `walkCall()`):

```
1. Symbol Table (user-declared functions/imports)
2. Builtins Registry (src/compiler/semantic/builtins-registry.ts)
3. SE1002 undefined function
```

with **zero name-specific special-casing** anywhere in
`semantic/index.ts` — verified by the same architectural discipline
established for the Backend's Runtime-name independence.

**`ur_free`'s exact scope, as implemented**: string-only in this phase
(matches §2.2's original scope — the only heap-allocated IR type is
`string`). Calling `free()` on a non-string value is rejected by
Lowering with a clear `CG1001` diagnostic — proven via a real end-to-end
test (`free(42)` is rejected before reaching the C Backend).

**Verified memory-safety guarantees** (not merely claimed): a UR program
that never calls `free()` on an `input()` result is confirmed, via a
real end-to-end test compiled with `-fsanitize=address` and
`ASAN_OPTIONS=detect_leaks=1`, to produce a real LeakSanitizer report. A
UR program calling `free()` twice on the same string is confirmed to
produce a real AddressSanitizer double-free report. This closes the
loop on §2.2's ownership model: manual `ur_free()`-based management is
implemented, and its failure modes are independently, automatically
verifiable — not just documented as a caller responsibility.
