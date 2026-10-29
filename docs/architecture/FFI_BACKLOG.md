# FFI_BACKLOG.md

## Rust/JavaScript Bridge Drivers — Missing driver-registry Auto-Registration

**Status**: Open. Discovered incidentally while running an unrelated
architecture test (`tests/platform/architecture-rules.test.ts`)
during the 10-language localization task — NOT related to that
task's own scope, and NOT fixed as part of it, per explicit
direction not to touch Bridges unless a defect is directly related
to the work at hand.

**Finding**: `tests/platform/architecture-rules.test.ts`'s own rule
"every file in src/ffi/drivers/ imports from driver-registry to
auto-register" fails for `src/ffi/drivers/rust/rust-bridge.ts` and
`src/ffi/drivers/javascript/js-bridge.ts` — neither imports from
`driver-registry`, unlike the Native Bridge's own earlier drivers
(OpenCV, ONNX, ROS2, SQLite3-style). This is a real, pre-existing gap
from the sessions that built those two bridges, confirmed via `git
diff` to be unrelated to this session's own changes (zero Bridge
files touched here).

**Next action**: investigate whether `RustBridgeDriver`/
`JsBridgeDriver` should register with `driver-registry` the same way,
or whether this architecture rule itself needs updating to account
for the Native vs Runtime Bridge classification (the Runtime Bridge
may not fit the same registration pattern) — a real design question,
not addressed here.

**Status: a running backlog of confirmed findings from FFI Bridge
work (Python/Rust/JavaScript). Findings are logged here as they are
identified. Work is prioritized after evidence exists, not in
discovery order.**

---

## Python Bridge — True Multi-thread Verification

**Status**: Open.

**Reason**: the current test harness
(tests/ffi/native/harness-executor.ts) is single-process and
single-thread - confirmed via direct source inspection (zero
pthread/Thread references anywhere in that file). It generates
single-threaded C programs only, so it cannot produce genuine
contention on the GIL within one real CPython interpreter. This is a
capability gap in the test harness, not a defect in any
currently-working code - src/ffi/core, the ABI, and the Harness
itself remain frozen and unmodified per explicit direction, until a
real production need is demonstrated.

**Required before any Harness change is attempted (in this order):**

1. Study the current Harness's own real structure in detail to
   determine what minimal change (if any) would let it generate real
   multi-threaded C code without altering its existing, working
   single-threaded behavior.
2. Identify the smallest possible change achieving this - not a
   rewrite.
3. Prove that the change does not affect any currently-passing C/C++
   test (SQLite3, OpenCV, Itanium mangling, etc.) - a full regression
   run before any change is accepted as safe.
4. Design the actual GIL contention tests themselves - before writing
   any Harness change, not after.
5. Independent review of the proposed Harness change, before
   implementation - not self-approved.

**Explicitly prohibited approaches, per direct instruction - not
substitutes for this item, not to be silently used instead:**
- Creating "fake" threads by spawning independent OS processes and
  calling that a multi-thread test
- Treating concurrent, separate Node.js process calls as GIL
  verification of any kind

**Next action**: none until this item's own 5-step prerequisite list
is complete. Not started.
