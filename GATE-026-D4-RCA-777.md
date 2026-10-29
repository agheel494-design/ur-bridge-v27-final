# GATE-026 D4 — Root-Cause Analysis of the "777" Native Pointer ABI closure

**Scope (PM S-3):** the historical 777 closure only. This document does not reopen F-002 or F2B, and does not
change the frozen baseline `R2-FROZEN-5ff444fe`.
**Labels:** **[FACT]** = observed in code or evidence; **[INTERPRETATION]** = not established.

## 1. The claim
`ROADMAP_LOCK.md` §"Native Pointer ABI — Closure" (closed 2026-08-30) recorded:
- a real foreign pointer from a real external library;
- that pointer **passed to a second, independent native function**;
- a correct computed result `777`, "chosen by the independent reviewer specifically to rule out a coincidental
  pass";
- the conclusion that UR "can hold and pass native pointers from external libraries safely, within defined
  bounds".

## 2. Observed facts
1. **[FACT, code]** Every FRI `native` call compiles a fresh `dlopen`/`dlsym` C wrapper and runs it **in a new
   process** (`interpret.ts`, `native` branch). A `ptr` argument is passed as an integer through argv and cast back
   to `void*` in that new process. No persistent native host exists.
2. **[FACT, repository]** The 777 cross-call evidence is **not retained**: no test, log or library for it exists in
   the repository. The only `777` tests (`tests/compiler/codegen/native-call-memory-closure.test.ts`, `…-pointer-support.test.ts`)
   exercise the compiled `mem.*` backend path, **not** FRI calls across processes.
3. **[FACT, execution on G026-C0 = frozen baseline]** The harness `src/native/tests/test_gate026_d4_nativeptr.sh`
   uses a library with a static `777`, a heap `777`, and a per-process load canary. Host: Linux,
   `randomize_va_space=2`.
   - `read_box(make_static())` → `FRI_SIGNAL … SIGSEGV`. **Two** processes loaded the library, and `read_box` ran
     in the second.
   - `read_box(make_heap())` → `FRI_SIGNAL … SIGSEGV`, in the same way.
   - A `nativeptr` passed to a **python** FRI function (`take(make_static())`) was **silently accepted**: the
     foreign process started and returned `1`, exit 0. Pointer values crossed into a non-native runtime without any
     error.
4. **[FACT]** The closure text does not record the execution environment: ASLR state, library load base, PIE.

## 3. Interpretation (not established)
- **H1 — static-data address coincidence.** If the closure-era library returned the address of statically
  initialized data, and the second process mapped the library at the **same base address** (ASLR off, or a
  deterministic load base), then reading that address would yield the same initializer (`777`). The result would
  be a pass by address-space coincidence, not by pointer passing. The current observation (fact 3: SIGSEGV with
  ASLR on) is **consistent** with H1 under different ASLR conditions, but does not prove it.
- **H2 — no dereference.** The second function may not have dereferenced the pointer: for example, it returned a
  constant or used the integer value.

Neither hypothesis can be confirmed: the historical library, logs and environment are absent.

## 4. Root-cause conclusion (fact level)
- The closure's capability, "pass native pointers … safely", **is not supported** by the architecture: each FRI call
  is a separate process.
- It is also not supported by any retained evidence.
- The closure process accepted a cross-process result **without recording the environment variables that
  determine whether such a result is meaningful** (ASLR, load base).
- **The process-level root cause** was an acceptance criterion (a "distinguishable value") that cannot distinguish
  real pointer passing from address-space coincidence.

## 5. Corrective action (GATE-026 D4-a, PM-approved C-1..C-4)
- **Enforcement.** `nativeptr` arguments are rejected **at the single FRI entry for every runtime**, before the
  per-call directory, any compile step or any foreign process. The typed code is `FRI_UNSUPPORTED_ARGUMENT`.
- **Language surface unchanged.** `nativeptr` values remain legal inside UR (returned by native calls, held, used
  locally).
- **Documentation.** `ROADMAP_LOCK.md`: the claim is withdrawn and replaced with the boundary rule and the D3
  wording: "FRI is trusted foreign execution; it provides no isolation guarantee."
- **Evidence after the fix (G026-C1).**
  - T1 and T2 → `FRI_UNSUPPORTED_ARGUMENT`. **Exactly one** process loaded the library: the producer call. The
    `read_box` marker is absent.
  - T3 (python) → `FRI_UNSUPPORTED_ARGUMENT`; python never started.
  - T4 (ptr returned and held) and T5 (scalar native call) are unchanged.
