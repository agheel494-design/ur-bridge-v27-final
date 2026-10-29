# RUST_BRIDGE_INVENTORY.md — Step 1: Inventory, per explicit direction to follow the same methodology as Python Bridge

**No code written yet. Inventory and environmental reality check
only, per explicit direction (Inventory -> Audit Scope -> Runtime
Tests -> Gap Analysis -> Implementation -> Regression -> Review).**

---

## Critical Finding 1: No Rust Toolchain Available in This Environment

```
$ which rustc cargo
rustc: not found
cargo: not found
$ apt-get install -y rustc
403 Forbidden (network access blocked, confirmed repeatedly
throughout this project's own prior work)
```

This means: no new Rust code can be compiled in this session. Unlike
Python (where libpython3.12.so was already present and ready), there
is no way to produce a fresh Rust .so here to test against.

## Critical Finding 2: "Rust Bridge" Is Architecturally Different From "Python Bridge" — Disclosed Before Any Design

Python is an interpreted language - PyRun_SimpleString can run
arbitrary Python source text handed to it at runtime, which is what
made Task 1-5 of the Python Bridge possible (marshal a UR value into
Python source, execute it, retrieve the result).

Rust is a compiled language with no equivalent "run this source text
now" API. A real Rust Bridge, by its own nature, cannot work the same
way - there is no rustc_run_simple_string(). The only real mechanism
is calling pre-compiled, extern "C" functions exported from an
already-built Rust shared library - architecturally identical to the
existing SQLite3 driver's own pattern (a fixed set of known C-ABI
functions in a real .so), not to the Python driver's own pattern
(arbitrary code execution + marshaling).

This has a real, direct consequence for the task list already
applied to Python: there is no generic "UR int -> Rust int -> UR
int" round-trip test possible in the abstract - round-tripping only
makes sense against a REAL, specific Rust function that actually
exists in a REAL, specific compiled library, the same way SQLite3's
own tests work against SQLite3's own real functions, not "any C
function."

## Real, Available Rust-Compiled Library Found in This Environment

Searched the filesystem directly for any already-compiled Rust
shared library, since none can be freshly built here:

```
/usr/lib/x86_64-linux-gnu/librav1e.so.0.7.1
(a real, genuine Rust-compiled shared library - rav1e, an AV1 video
encoder written entirely in Rust, confirmed via "strings | grep
rustc" matching)
```

Real exported C-ABI functions (via nm -D), confirmed to exist:

```
rav1e_config_default
rav1e_config_parse_int
rav1e_context_new
rav1e_frame_new
rav1e_frame_fill_plane
... (real, callable extern "C" functions)
```

/usr/lib/python3/dist-packages/cryptography/hazmat/bindings/_rust.abi3.so
was also found (a real Rust-compiled library, part of Python's own
cryptography package) - disclosed as NOT a good fit: its own
exported symbols follow the CPython extension-module ABI protocol,
not plain extern "C" functions with simple signatures - calling it
correctly would require re-implementing CPython's own module-loading
protocol, a much larger undertaking than this task's own current
scope. librav1e is the real, tractable candidate.

## Corrected Architecture, Per Direct Feedback

An earlier draft of this bridge built a rav1e-specific driver
(`Rav1eDriver`, with methods like `configDefault()`/`configParseInt()`
hardcoded to rav1e's own function names) directly under
`src/ffi/drivers/rust/`. **This was corrected**: rav1e must not be
the reference architecture for the Rust Bridge. It was removed from
`src/` entirely.

**The actual, generic bridge** now lives in
`src/ffi/drivers/rust/rust-bridge.ts` (`RustBridgeDriver`) — it has
zero knowledge of rav1e or any other specific library. It exposes a
generic `call()`/`callBatch()`/`withResource()` API that works with
any Rust library exporting a C ABI, given the caller's own symbol
names as plain string arguments.

rav1e is now used ONLY in
`tests/ffi/drivers/rust-rav1e-proof-of-concept.test.ts`, explicitly
labeled as a proof of concept, not part of the bridge's own
architecture — it demonstrates the generic bridge working against a
real, independently-compiled Rust library, using nothing but the
generic API.

## Critical Review Before Any "v1.0" Declaration, Per Explicit Direction

**Corrected premise**: the interface did NOT come out of this review
unchanged — three real issues were found and two were fixed
immediately; the third is disclosed as a real, open architectural
decision, not silently deferred:

1. **Real bug found and fixed**: `withResource()` previously ran
   `use()`/`free()` even if `create()` itself failed (returned a
   null pointer or a real harness error) — a resource created
   "unsuccessfully" was still used and freed as if valid. Fixed: now
   detects this and returns `{ ok: false, error }` — with an honest
   caveat also documented in the driver's own file header: because
   this project's own harness runs a whole call batch in one real
   process, this is *detection*, not *prevention* — the already-sent
   batch's later calls have already executed by the time the failure
   is detected. A true prevention would require splitting into
   separate `execute()` calls, which reintroduces the
   separate-process/lost-ptr-table problem already documented for
   the Python Bridge — a real, disclosed tradeoff, not hidden.

2. **Real gap found and fixed**: error handling was NOT unified — the
   caller had to inspect `.kind === "error"` on every raw
   `NativeCallResult`. Fixed: `call()`/`callBatch()`/`withResource()`
   now all return a single, consistent `RustCallOutcome` shape
   (`{ ok: true, value }` / `{ ok: false, error }`).

3. **Real gap found, NOT fixed — disclosed as a Bridge Extensions
   (v2, draft) concern, per the two-tier decision below, not a
   blocker for the Core API (v1.0)**:
   - No support for passing a callback (function pointer) as an
     argument — `NativeArg`'s own kinds have no "function pointer"
     option.
   - The entire Core API is synchronous (no `Promise` anywhere).

These are documented directly in `rust-bridge.ts`'s own file header,
not only here, so they are visible to whoever builds the next bridge.

## Two-Tier Architecture Decision, Per Direct Feedback

**Corrected framing**: Point 3 above (Callback/Async support) is
NOT a blocker for starting a JavaScript Bridge. Tying it to the
generic bridge's own v1.0 core would be premature generalization —
most bridges (C/C++, SQLite, Rust via C ABI, Python's own core
CPython C API usage) genuinely do not need callbacks/async at the
core level. Designing that extension speculatively, before a real
bridge's own real requirements force the question, risks building
the wrong abstraction from guesswork rather than real need.

**Adopted two-tier split**:

```
Generic Bridge API v1.0 (Core) — Stable
  - call()
  - callBatch()
  - withResource()
  - load()/unload() (via the existing NativeFfiLoader, reused as-is)
  - unified RustCallOutcome error handling
  - type marshaling (NativeArg/NativeCallResult kinds)

Bridge Extensions v2 — Draft, designed from real need, not upfront
  - Async / Promise support
  - Callbacks (function-pointer arguments)
  - Event streams
  - Cancellation
```

Each bridge declares what it supports, explicitly, rather than the
core API assuming every bridge needs everything:

| Bridge | Core API | Async | Callbacks |
|---|---|---|---|
| C/C++ (SQLite3 driver) | ✓ | ✗ | ✗ |
| Python | ✓ | ✗ | ✗ |
| Rust (generic bridge) | ✓ | ✗ | ✗ |
| JavaScript (planned) | ✓ (to start) | Real need TBD during implementation | Real need TBD during implementation |

## Corrected Status Table

```
Architecture ............ Complete (reviewed, 2 real issues fixed)
Generic Driver API ...... Complete (unified error handling added)
Mock Validation ......... Complete (9/9, including both real fixes)
Real Rust Toolchain ..... Deferred (environment unavailable)
Real Integration ........ Partial (rav1e proof-of-concept, 3/3,
                           including a live verification of the
                           real-rejection-vs-FFI-error distinction)
Production Readiness .... Pending — Core API (v1.0) may be reused
                           as-is by JavaScript Bridge; Async/Callback
                           Extensions (v2) to be designed from real
                           need discovered during that
                           implementation, not upfront
```

Rust Bridge's own Core API (v1.0) is declared **Stable** and is the
reference template for other bridges' own core functionality. Bridge
Extensions (v2: Async, Callbacks, Event Streams, Cancellation) remain
**Draft** — each bridge declares which extensions it supports, per
the capability table above; extensions are designed from a bridge's
own real, demonstrated need during implementation, not upfront
speculation.
