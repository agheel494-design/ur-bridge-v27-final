# LLVM Backend — Environment Requirements (BLOCKING)

**Status: Level 3 (LLVM Backend) is BLOCKED, not In Progress.** This
document exists specifically to prevent anyone — a future contributor,
a future session, or a future version of the assistant working on this
project — from attempting LLVM Backend implementation in an environment
that cannot verify it, per the explicit decision recorded here and in
`FREEZE_LOG.md`/`ROADMAP_LOCK.md`.

---

## 1. Why This Phase Is Blocked

This project's entire methodology, since Level 2.1, rests on one
non-negotiable principle: **no phase is considered complete unless it
is proven by real execution** — real `gcc` compilation, real running
binaries, real `AddressSanitizer`/`UndefinedBehaviorSanitizer` output,
real `stdout`/exit-code comparison. Every Golden Test, every E2E test,
every fuzz/stress test throughout Levels 2.1–2.9 followed this rule
without exception.

**The current development environment cannot apply this same standard
to LLVM IR.** A direct, exhaustive check (performed before this
document was written, not assumed) found:

| Requirement | Status in this environment |
|---|---|
| `clang` (C-family frontend, also used to compile `.ll` → object/executable) | **Not installed** |
| `llc` (LLVM static compiler: `.ll`/`.bc` → native assembly/object) | **Not installed** |
| `opt` (LLVM optimizer/verifier CLI) | **Not installed** |
| `llvm-as` (LLVM textual-IR assembler, minimum syntax check) | **Not installed** |
| `apt-get install llvm-20 clang-20` | **Fails — network egress blocked (403 Forbidden on every package fetch)** |
| `pip install llvmlite` (Python LLVM binding, could JIT/verify without the CLI tools) | **Fails — no network access to PyPI** |
| Node.js LLVM bindings (e.g. `llvm-bindings`) | **Not installed, not installable (no network)** |
| `libLLVM-20.so` (raw shared library) | **Present on disk**, but unusable without a binding layer or the CLI tools — there is no way to invoke it from this project's TypeScript/Node toolchain |

**Conclusion:** it is not merely inconvenient to write LLVM Backend
code here — it is **impossible to verify** any of it: not its syntax,
not its semantics, not its compiled behavior. Writing it anyway would
produce a large body of code whose correctness rests entirely on
training-data recall of LLVM IR syntax, with zero empirical check —
precisely the failure mode this project has avoided at every other
phase.

## 2. Minimum Toolchain Required to Unblock This Phase

All of the following must be independently confirmed present and
working (not merely installed) before LLVM Backend implementation may
begin:

| Tool | Minimum version | Purpose |
|---|---|---|
| `clang` | 14.0 (any actively-supported LLVM major version acceptable) | Reference frontend; may also serve as the final `.ll` → executable linker step |
| `llc` | Matching `clang`'s LLVM major version | `.ll`/`.bc` → native object file |
| `opt` | Matching `clang`'s LLVM major version | Running `-verify` (LLVM's own IR well-formedness checker) and, later, LLVM's own optimization passes |
| `llvm-as` | Matching `clang`'s LLVM major version | Fast textual-IR syntax check, cheaper than a full `opt -verify` for quick iteration |

**Verification command, to be run and its output pasted into whatever
document unblocks this phase** (not merely claimed):

```sh
clang --version && llc --version && opt --version && llvm-as --version
```

All four must succeed and report a consistent LLVM version family.

## 3. Criteria for "Developable" (unblocking this phase)

This phase may move from **Blocked** to **In Progress** only when ALL
of the following hold, verified directly in the target environment —
not assumed by version string alone:

1. §2's four tools are present and run successfully (version check
   above passes).
2. A trivial, hand-written `.ll` file (e.g. a `main` returning a
   constant) can be verified with `opt -verify`, compiled with
   `llc`/`clang`, linked, and **run**, producing the expected exit
   code — the exact same "real execution" bar every other phase of
   this project has cleared.
3. The existing Runtime Core (`runtime/ur_runtime.c`) can be linked
   against LLVM-emitted object code (confirming the calling convention
   and ABI this project has frozen — `RUNTIME_SPEC.md` §4,
   `FUNCTIONS_ABI_SPEC.md` — is compatible with what LLVM's default
   target produces, or documenting exactly what adaptation is needed
   if not).

Only once these three are demonstrated should a
`LLVM_BACKEND_SPEC.md` design document be written — following this
project's established sequence (specification → independent review →
implementation → verification → freeze), identical to every prior
phase.

## 4. What This Document Does NOT Decide

- The design of the LLVM Backend itself (IR mapping, calling convention
  bridging, optimization-pass interaction with UR's own frozen
  Optimizer from Level 2.9) — deferred entirely to
  `LLVM_BACKEND_SPEC.md`, written only once this phase is unblocked.
- Whether LLVM's own optimization passes should run instead of, before,
  or after UR's own Level 2.9 Optimizer — an open design question for
  that future specification, not resolved here.
- A timeline for when a suitable environment will exist — this is an
  infrastructure/environment question outside this project's own
  engineering scope.

## 5. Standing Instruction (per review)

**Do not begin any LLVM Backend implementation work — including
"exploratory" or "unverified" LLVM IR generation code — while this
document's status reads BLOCKED.** If a future session or contributor
is tempted to make partial progress "to be tested later," that is
explicitly the rejected option (per review: *"لا أوصي بالخيار (ب):
كتابة LLVM IR الآن ثم اختباره لاحقًا"*) — it would produce unverified
code that may require significant rework once real tooling exists, with
no way to distinguish correct from incorrect code in the meantime.

Development effort during this blocked period should go toward
verifiable work per the approved list: C Backend improvements, Runtime
Core improvements, the Functions/Aggregates bridge, Benchmark Suite
expansion, documentation, and confirmed bug fixes — never speculative
LLVM code.
