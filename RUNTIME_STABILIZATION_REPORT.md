# RUNTIME_STABILIZATION_REPORT.md

**FINAL STATUS (precise wording, per explicit review correction):
Runtime is ready for the first release WITH TWO DOCUMENTED, DELIBERATE
LIMITATIONS — not "fully closed" without qualification. The two
limitations are: (1) use-after-free is undetected in normal builds
(detectable via AddressSanitizer during development), and (2) stack
overflow from deep recursion is undetected and unmitigated (Option C:
documented and measured, not fixed). Both are deliberate, reviewed
decisions for v1.0, not open bugs — but they are real, present
limitations, not absence of any remaining concern.**

**Compiler & Runtime Stabilization phase. Two real Critical (Category
A) findings — one fixed, one requires an explicit decision before any
fix is attempted, per the "stop before big redesign" policy.**

---

## Finding 1: Integer Division/Modulo by Zero — FIXED

**Confirmed a real Critical bug**: `10 / 0` and `10 % 0` (integer
operands) previously raised SIGFPE — an unhandled process crash, not a
clean panic. `exit code -1` alone did not reveal this; it was only
confirmed after fixing a SEPARATE, real gap: runExecutable()
(tools/backend/c-compile.ts) was silently discarding the actual
termination signal, reporting -1 indistinguishably from any other
failure. Fixed that infrastructure gap first (now exposes the real
signal name), which is what made this finding possible to confirm
precisely.

**Fixed the actual crash**: binop emission (emit-c.ts) now checks the
divisor for zero on integer division/modulo, panicking cleanly
(matching the already-established array-bounds-check pattern) instead
of executing raw C division. Verified:

- 10 / 0 (int): now exit 101, "UR panic: division by zero", no signal.
- 10 % 0 (int): same.
- 10.0 / 0.0 (float): UNCHANGED, still correctly produces IEEE 754
  inf - the fix is deliberately scoped to integer operands only.
- All normal division/modulo (including negative divisors) verified
  unaffected.

## Finding 2: Deep Recursion -> Stack Overflow (SIGSEGV) — CONFIRMED, NOT FIXED

**Confirmed a real Critical bug, NOT fixed this round**: deep
recursion causes an unhandled SIGSEGV. Measured the actual threshold
directly rather than assuming:

| Recursion depth | Result |
|---|---|
| 1,000 | OK |
| 10,000 | OK |
| 50,000 | OK |
| 100,000 | SIGSEGV |
| 200,000 / 500,000 | SIGSEGV |

**This is a realistic depth, not an extreme edge case** — a real
program processing a reasonably large recursive data structure could
plausibly reach 100,000 levels.

### Why This Was NOT Fixed This Round

A safe fix requires genuine systems-programming work, not a small,
local change:

1. **Depth-counter approach**: pass an explicit recursion-depth
   parameter through every UR function call, checked against a limit.
   Real overhead on every call, and requires threading a new parameter
   through every function signature in Lowering/Backend.
2. **Signal-handler approach** (the more standard technique): install
   a SIGSEGV handler running on a separate sigaltstack()-allocated
   stack, distinguish a stack-overflow fault from other invalid-
   memory-access faults, and convert it to a clean panic. Real,
   correctness-sensitive C systems programming, and is
   Linux/POSIX-specific — Windows needs a completely different
   mechanism, which this sandboxed, Linux-only environment has no way
   to implement or verify.

Given the project's own established two-party validation model, a
Linux-only fix here without the ability to design or verify the
Windows counterpart risks shipping a platform-inconsistent
mitigation.

### Decision Needed (two options, not started)

**Option A — small, launch-safe mitigation**: implement the
depth-counter approach with a generous limit (e.g. 40,000, comfortably
under the confirmed ~50,000-100,000 crash threshold), accepting the
per-call overhead and the Lowering/Backend signature change. Real,
invasive, but bounded and same-behavior-on-every-platform.

**Option B — full redesign, deferred**: the signal-handler approach,
done properly across Linux AND Windows, as its own dedicated
architectural item post-v1.0 (or validated by the independent Windows
reviewer before shipping in v1.0).

**Decision made: Option C** (see below) — Options A and B not implemented.

**Important caveat on the threshold numbers themselves, stated explicitly per review request**: the failure threshold depends on the operating system, the compiler's own settings, and the call frame size — it is NOT a portable constant. The specific numbers reported here (safe at 50,000, SIGSEGV at 500,000) are a measurement of THIS test environment only, not a guarantee for any other operating system, compiler version, or platform. This is precisely why Option C's own permanent test measures the threshold directly rather than hardcoding an assumed value.

## Finding 3: Invalid Pointer Passed to free() — FIXED

**Confirmed a real Critical bug**: UR's own type checker does not
restrict free()'s argument type at all - free("hello") (a string
LITERAL, never heap-allocated) type-checks with zero errors. At
runtime, this reached glibc's own free() directly, which correctly
detects the pointer is not a valid heap allocation and aborts with an
uncaught SIGABRT ("free(): invalid pointer") - confirmed directly.

**Fixed** using the same small, contained mechanism as double-free:
every pointer ur_input_string() actually allocates is now recorded;
ur_free() only proceeds if the incoming pointer is a KNOWN, real
allocation, panicking cleanly ("invalid pointer passed to free")
otherwise.

## Two Real Bugs Found IN This Fix Itself, By Stress Testing (Both Fixed)

Per the explicit "long-running execution" and "heavy alloc/free
cycling" review requirements, the fix above was stress-tested at
scale - which caught two real problems in the fix itself, not in the
original code:

**Bug A - tracking-table capacity exhaustion caused false positives**:
the tracking tables only ever grew (entries added on allocate/free,
never removed). Confirmed directly: a program doing 50,000+ sequential
input()+free() cycles incorrectly panicked with "invalid pointer"
around the 4096th cycle, because the fixed-capacity table filled with
stale entries for already-freed pointers that were never removed.
**Fixed**: a pointer is now removed from the allocated-table when
freed, and from the freed-table when a reused address is freshly
re-allocated. Verified correct up to 200,000 cycles.

**Bug B - check ordering misclassified a genuine double-free**: after
fixing Bug A, checking "known allocation" BEFORE "already freed" meant
a genuine double-free was misclassified as "invalid pointer". Fixed:
check "already freed" first.

Also found and fixed: storing every allocated pointer in a global
tracking array made LeakSanitizer's own reachability analysis consider
every allocation "still reachable" - breaking this project's own
pre-existing, working leak-detection test. Fixed: all of this tracking
is compiled out entirely under __SANITIZE_ADDRESS__ - ASan/LSan
already provide strictly better detection when active.

## Use-After-Free — Confirmed, Not Fixed (Documented, Detectable Under ASan)

**Confirmed directly**: reading a string after free()-ing it is
silently undetected in a normal build - true undefined behavior,
matching standard systems-language behavior (C/C++/unsafe Rust all
have this property without a garbage collector or borrow checker).
Not fixed as a default runtime behavior - would require intercepting
every string-consuming operation, a broader change than this stage's
own scope. Confirmed detectable via this project's own existing
AddressSanitizer test infrastructure (heap-use-after-free, with a
full, precise stack trace) for development-time verification.

## Option C for Stack Overflow (per explicit review decision)

Per explicit direction: no depth counter, no signal handler. Instead:

- **Documented**: deep recursion may cause a stack overflow depending
  on the operating system.
- **Permanent stress test added**: measures the actual crash threshold
  directly on THIS test environment specifically (confirmed: no crash
  at 50,000, SIGSEGV at 500,000) - so a
  future regression is caught by CI, without any runtime cost added.
- **Recorded as a formal v1.1/v2.0 item**: proper handling deferred to
  a future Runtime redesign, not attempted now.

## Long-Running Execution — Confirmed Stable

- 10,000,000 arithmetic operations: correct result, ~30ms, no crash.
- 200,000 sequential real heap allocate+free cycles: correct result,
  ~9ms, no crash, no false positives (after the Bug A/B fixes above).

## Statistics

- **Critical Bugs found**: 5 (division/modulo by zero; stack overflow;
  invalid pointer to free; tracking-table capacity exhaustion found by
  stress-testing the invalid-pointer fix itself; check-ordering bug
  found in the same re-verification)
- **Critical Bugs fixed**: 4 (all except stack overflow)
- **Critical Bugs confirmed, decision made (Option C, documented not fixed)**: 1 (stack overflow)
- **Infrastructure gaps found and fixed**: 2 (runExecutable() silently
  discarding the real termination signal; the tracking mechanism's own
  interference with LeakSanitizer's reachability analysis)
- **Use-After-Free**: confirmed silently undetected in normal builds
  (documented, matches standard systems-language behavior), confirmed
  detectable via existing ASan infrastructure for development-time use
