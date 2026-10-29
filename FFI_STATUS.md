# FFI_STATUS.md

**Status: comprehensive audit of `src/ffi/`, per explicit FFI
Stabilization directive. No language changes made (no `extern`, no
pointer types, no `unsafe`, no Parser/Lexer/Syntax changes).**

---

## What Is Complete (verified, tested)

### TypeScript-level tooling (100% test coverage, 20/20 files)

- **ABI layer** (`src/ffi/abi/`): type definitions, memory layout
  computation, semantic versioning/compatibility checks.
- **C bindgen** (`src/ffi/bindgen/`): C header parsing, ABI
  conversion, UR/TypeScript source emission.
- **C++ bindgen** (`src/ffi/bindgen/cpp/`): C++ header parsing,
  exception-handling metadata, a full Itanium name-mangling
  implementation, ABI conversion.
- **Native loading infrastructure** (`src/ffi/native/`): a driver
  registry (capability-based lookup), a native library loader,
  platform-specific executor stubs (Linux implemented; Windows/macOS
  correctly return `notSupported()` — see `SUPPORTED_PLATFORMS.md`).
- **FFI runtime** (`src/ffi/runtime/memory.ts`): an arena allocator
  and string encode/decode for passing data across the FFI boundary.
- **URPM native package planning** (`src/ffi/urpm-native/`): resolves
  which native packages/link flags a target platform needs.
- **Domain drivers**: OpenCV, ONNX Runtime, ROS2 — each implements
  `INativeDriver<T>`, wraps its own C API, and self-registers with the
  Driver Registry. **All 3 now have full unit test coverage** (ONNX
  and ROS2 tests added this round — see below).

### Real, working end-to-end demonstration

`tests/ffi/integration.test.ts`'s "Phase 6 End-to-End Integration"
suite (14/14 passing, re-confirmed this round) uses a realistic
SQLite3 C header through the full pipeline: parse → convert → ABI-
compatibility-check → emit bindings → generate a native-package link
plan.

## What Was Fixed This Round

- `src/ffi/drivers/onnx/onnx-driver.ts`: **0 → 25 tests.** Every
  method covered (descriptor, version, environment/session lifecycle,
  session introspection, tensor I/O, inference, error handling,
  Driver Registry integration).
- `src/ffi/drivers/ros2/ros2-driver.ts`: **0 → 39 tests.** Every
  method covered (descriptor, version, lifecycle, node, publisher,
  subscriber, timer, service, executor, error handling, Driver
  Registry integration).
- No bugs were found in either driver during this test-writing
  process — both implementations matched their own documented API
  contracts exactly; the gap was purely missing test coverage, not
  incorrect code.
- No unused code found and removed in `src/ffi/` specifically — the
  entire directory's 20 files are now confirmed referenced and tested
  (see `COVERAGE_REPORT.md`'s own earlier, broader repository finding,
  which flagged these same 2 files before this round closed the gap).

## What Is Incomplete (precisely, not vaguely)

### FIXED THIS ROUND: generated UR bindings are now valid UR v1.0 syntax

**Status: RESOLVED.** `emitUrBindings()` was rewritten to target only
real UR v1.0 syntax — confirmed directly, not assumed. Full detail:
`issues/ffi-bindgen-generates-invalid-ur-syntax.md` (status: FIXED).

**Mandatory closure condition met**: 4 new end-to-end tests in
`tests/ffi/integration.test.ts` generate a real binding (SQLite3,
OpenCV-like, an enum-bearing header, a `#define`-bearing header) and
run each through the REAL UR lexer → parser → type checker, asserting
zero errors at every stage. All 4 pass.

**A real bug was found and fixed during this exact closure-condition
testing** (not before — the test caught it as designed): a C struct
field or function named `type` (a real, common C identifier) collided
with UR's own reserved `type` keyword, producing genuine parse
errors. Fixed with an identifier-sanitization pass
(`sanitizeIdent()`) against UR's complete, real keyword list
(confirmed directly from `src/compiler/localization/en.ts`) — any
colliding identifier is suffixed with `_`.

**What emitted bindings actually are now**: real, valid, parseable
and type-checkable UR v1.0 source — but still PLACEHOLDER function
signatures with empty bodies, since UR v1.0 has no `extern`/FFI-call
mechanism for user code. Calling a real native function from emitted
UR code remains blocked on that separate, larger language-level gap
(see below) — this round's fix makes the GENERATED TEXT valid UR, not
functionally connected to the native library yet.

### No end-to-end test with a REAL native library

`tests/ffi/integration.test.ts`'s own suite (and the new ONNX/ROS2
tests) all use mock executors — none dlopen() an actual `.so`/`.dll`.
A real native-library end-to-end test would require the target library
installed in the test environment; none is available here (matches
this project's own standing "cannot verify what this sandbox can't
run" disclosure pattern).

### RESOLVED (Stage 3.1) for REGISTERED native libraries — still no GENERAL FFI mechanism

**Status update**: Stage 3.1 added a Native Library Registry
(`src/compiler/semantic/native-library-registry.ts`) and Lowering
support for `x.y(...)` member-call syntax — but ONLY when `x` matches
a registered entry, both imported AND present in the registry.
Confirmed directly, end-to-end, with zero simulation: `import
sqlite3` + `sqlite3.libversion()` + `print(version)` compiles, links
against the REAL `/usr/lib/x86_64-linux-gnu/libsqlite3.so.0`, and
prints the real SQLite version string. No new keyword, no Parser/
Lexer change — `import` and `x.y(...)` already parsed and typechecked
successfully before this Stage; only Lowering's own handling of an
already-valid AST shape changed.

**Still NOT general**: calling an unregistered library/function, or
using member-call syntax on an ordinary variable, is still correctly
rejected (11/11 tests covering exactly this — see
`tests/compiler/codegen/native-library-member-call.test.ts`). There is
still no `extern`/pointer-type/`unsafe` syntax, and no way for a UR
program to call an ARBITRARY native function without a corresponding
registry entry — this remains a real, deliberate scope boundary, not
a gap. Zero-argument and single-string-argument functions are proven
working. **Output-parameters are now ALSO proven working — see the
Stage 3.3 section below, which corrects this paragraph's own earlier
claim that they were "not yet attempted."** Structs (reading/writing
native-returned struct fields), arrays, and callbacks remain separate,
not-yet-attempted pieces.

### Stage 3.3 (partial) — Output parameter support: PROVEN with real sqlite3_open/close

**Status: real, end-to-end success, not simulated.** The C Backend now
handles output parameters (e.g. `sqlite3_open`'s own `sqlite3**
ppDb`): the wrapper declares a local variable of the pointee's real C
type, passes its address at the real parameter position (entirely
hidden from UR's own visible signature), and returns that variable's
final value as the handle. Ordinary pointer arguments (e.g.
`sqlite3_close`'s own `sqlite3*` parameter) are handled by casting the
incoming UR-side `i64` handle back to the real pointer type. Opaque
struct types (`sqlite3` itself) are forward-declared automatically,
deduplicated across every extern that references them.

**Confirmed directly**: `sqlite3.open(":memory:")` returns a real,
non-zero database handle (a genuine pointer value); `sqlite3.close()`
on that handle returns `0` (success); two separate `open()` calls
produce two distinct handles, both closable. 11 new tests.

**Still not attempted**: structs (reading/writing fields of a
native-returned struct), arrays passed to/from native functions,
callbacks (e.g. `qsort`-style function-pointer arguments), and
cross-platform (Windows/macOS) validation — each is its own,
separately-scoped piece of Stage 3.3, not bundled into this round.

**Known limitation, RESOLVED in Stage 3.2** (was disclosed as an open
risk in Stage 3.1): the registry's `isComplete` entry previously
declared a wider IR return type (`i64`) than the real C function's
actual `int` return, relying on this platform's own calling
convention rather than defined behavior. **Fixed properly**: every
`NativeFunctionSignature` now requires explicit `cReturnType`/
`cParamTypes` fields stating the REAL C ABI types; the C Backend
declares the extern prototype using these exact types and generates a
thin, explicitly-casting wrapper function for Lowering's `call`
instruction to target — fully defined C behavior (a correctly-
prototyped call followed by a standard numeric conversion), not an
ABI mismatch relying on platform luck. Verified directly across 6
registered functions spanning `string`/`i64` (both narrowed-from-`int`
and exact-width-`int64_t` cases)/`bool`/`f64` return types.

### Stage 4.2 — Pointer read/write/arithmetic + Memory Safety Layer: COMPLETE

**Status: real, end-to-end success, including the safety layer
explicitly required before this stage could be considered closed.**
UR still has NO pointer type at the language level (unchanged). The
registered `mem` library (`tests/fixtures/ffi-type-coverage/libmem.so`)
provides `alloc`/`free`/`offset` (pointer arithmetic)/read-write for
i32/i64/f64/u8/ptr, letting a UR program allocate real memory,
read/write through an opaque handle at any type/width, compute offset
addresses, and dereference a pointer-to-pointer — entirely via
registered native calls.

**Safety layer (added per explicit review — 4 required properties, all
directly tested, not merely claimed):**

1. **Out-of-bounds detection**: every read/write validates the target
   address + access width against a tracking table of live
   allocations before touching memory. An 8-byte write into a 4-byte
   buffer, or an 8-byte write reached via `offset()` that extends past
   the buffer's own end, are both detected (error code `1`) — the
   write does not happen, memory is not corrupted.
2. **Alignment correctness (32-bit and 64-bit)**: every read/write
   uses `memcpy` (never a raw pointer dereference), which is
   alignment-agnostic by construction. Directly tested at
   intentionally UNALIGNED offsets (1, 3, 5 bytes — none aligned to
   4/8-byte boundaries) for i32/i64/f64 — all round-trip correctly.
3. **Use-after-free / double-free detection**: `free()` marks the
   allocation as freed in the tracking table (does not merely call
   libc `free()` and forget); any subsequent read/write is detected
   (error code `2`, and reads return a safe `0` rather than garbage or
   crashing) and a second `free()` on the same pointer is detected
   (error code `4`) rather than corrupting the allocator's own state.
4. **Pointer-arithmetic bounds — documented AND tested**: `offset()`
   itself does NOT bounds-check (matches real C semantics — computing
   an out-of-range address is allowed) — this is a deliberate,
   documented choice (stated in `mem_lib.c`'s own header comment), not
   an oversight. The actual violation is caught at the point of
   dereference: reading through an `offset()`-computed address that
   lands outside any tracked allocation is correctly detected (error
   code `3`, unknown pointer).

Errors are surfaced via `mem.lastError()` (`0`=OK, `1`=OOB,
`2`=use-after-free, `3`=unknown pointer, `4`=double-free) — checked
explicitly by the calling UR program, never a silent corruption or an
uncontrolled process crash.

25 total tests for Stage 4.2 (11 core pointer-mechanics + 14 safety
layer), all passing against the real, compiled library.

**Still not attempted**: real struct types (Stage 4.3's own job),
arrays, callbacks, cross-platform (Windows/macOS) validation.

### Stage 4.2 Closure — Handle reuse bug found+fixed, invalid sizes rejected, stress-tested; Windows/macOS explicitly NOT achievable here

**Real bug found and fixed**: the tracking table's `ur_mem_alloc()`
always appended a NEW slot for each allocation — when `malloc()`
(very commonly, on Linux/glibc) returned the SAME address a
just-freed allocation used, the OLD (freed) tracking entry for that
address was still present. `validate_access()`'s linear scan found
the STALE entry first, incorrectly flagging the brand-new, perfectly
valid allocation as a use-after-free. **Confirmed directly** before
the fix: writing `777` then reading back returned `0` with a false
`USE_AFTER_FREE` error. **Fixed**: `ur_mem_alloc()` now searches for
and REUSES any existing tracking slot for the exact same address
first, guaranteeing at most one entry per address at any time.
Verified fixed directly, and stress-tested with 5000 alloc/write/
read/free cycles of the same size (near-guaranteed repeated address
reuse across the run) — zero false positives.

**Invalid size handling**: negative, zero, and unreasonably large
(>1 GiB, a deliberately generous sanity cap for this synthetic
library's own testing scope) allocation requests are now rejected
with a distinct error code (`5`), never passed through to `malloc()`
as a huge unsigned value (which a negative `int64_t` cast to `size_t`
would become) or silently accepted.

**Genuine OOM (real allocation failure under actual system memory
pressure)**: the code path exists (`ALLOC_FAILED`, error code `6`,
distinct from `INVALID_SIZE`) but was NOT stress-tested by actually
exhausting system memory — doing so in this shared sandbox risks
destabilizing the test runner itself for an edge case this project's
own environment cannot safely reproduce. Flagged as untested, not
silently assumed correct.

**Explicitly NOT achievable from this environment, disclosed not
hidden**: Windows and macOS validation. This entire Stage's own work
(the harness executor, the C compilation pipeline, `libmem.so` itself)
is Linux-specific — confirmed no cross-platform testing was performed
or is possible from this sandboxed Linux-only environment. This
remains squarely in the domain of the project's own separate,
established multi-platform validation process (see
`WINDOWS_VALIDATION_RUNNING_INSTRUCTIONS.md`), not something this
round's work can close.

## What Is Needed in the Future (not started, not designed this round)

1. **Resolve the bindgen syntax gap** — either fix `emitUrBindings()`
   to target real UR v1.0 syntax, or design new UR syntax (`extern`,
   pointers, `unsafe`) as its own deliberate, scoped language decision
   (see `issues/ffi-bindgen-generates-invalid-ur-syntax.md`'s own two
   documented resolution paths).
2. **A real native-library end-to-end test**, once (1) is resolved and
   a target environment with an actual installed library is available.
3. **`Team 2` languages** (C++/Rust/Go/Java/Kotlin/.NET, per the v28
   directive's own stated order) — each needs its own bindgen/ABI work
   analogous to what exists for C today; none has been assessed this
   round beyond confirming C++ bindgen tooling already exists
   (untested against the real-syntax question above, since it shares
   the same emitter).

---

## Final Report (per explicit directive: only 3 lines)

- ✅ **ما الذي أُنجز**: **إغلاق فعلي لثغرات إدارة الذاكرة المتبقية** — اكتُشف وأُصلح **خلل حقيقي خطير** (إعادة استخدام العنوان من `malloc` كانت تُنتج إيجابية زائفة لـUse-After-Free)، رفض صريح للأحجام السالبة/الصفرية/الكبيرة جداً، واختبار ضغط حقيقي بـ5000 دورة.
- ✅ **نتائج الاختبارات**: 2773/2773، Conformance 11/11. **صراحة**: Windows/macOS **غير قابلين للتحقق من هذه البيئة إطلاقاً** (Linux فقط) — لم يُختبَرا، لا افتراض بأنهما يعملان. اختبار OOM حقيقي (نفاد ذاكرة فعلي) لم يُنفَّذ عمداً (خطر على بيئة التشغيل المُشتركة نفسها).
- ✅ **إيقاف توسيع FFI الآن**، بموجب توجيهك — العودة إلى: تحسين المُصرِّف، الأداء، IDE، مدير الحزم. Struct/Callbacks/هياكل معقدة مؤجَّلة لما بعد إصدار مستقر.
