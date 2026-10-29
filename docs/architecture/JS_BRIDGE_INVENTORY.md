# JS_BRIDGE_INVENTORY.md — Step 1: Inventory, per explicit direction

**No code written yet. Environment inventory and architectural
reality check only.**

---

## Environment Inventory

```
Node.js: v22.22.2
N-API version: 10 (process.versions.napi)
node_api.h: present at /usr/include/node/node_api.h
C++ compiler: g++ 13.3.0 (available)
```

Target choice, per explicit direction's own three options (N-API /
V8 API / FFI-only e.g. ffi-napi): N-API is the correct choice - it is
Node's own explicitly stable, ABI-stable interface (confirmed
present, version 10). V8 API is explicitly unstable across Node
versions and correctly ruled out.

## Real, Pre-Existing N-API Library Found (not synthetic)

```
/home/claude/.npm-global/lib/node_modules/sharp/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node
```

sharp - a genuine, widely-used, real production image-processing
library (built on libvips). Confirmed already installed in this
environment, not fabricated for this task.

## Critical Finding: N-API Addons Cannot Be Called via This Project's Own Existing HarnessExecutor - Confirmed Before Writing Any Code

Direct inspection of sharp-linux-x64.node's own exported symbols
(nm -D):

```
_Z11concurrencyRKN4Napi12CallbackInfoE
_Z8metadataRKN4Napi12CallbackInfoE
_Z8pipelineRKN4Napi12CallbackInfoE
... (C++ name-mangled symbols, each taking a
     const Napi::CallbackInfo&)
```

These are NOT plain extern "C" functions with simple C-ABI
signatures (unlike SQLite3's or rav1e's own real, directly-callable
functions). Each one requires a live napi_env/V8 Isolate context to
even be called correctly.

This project's own HarnessExecutor
(tests/ffi/native/harness-executor.ts) generates and runs a plain,
standalone C program via spawnSync - confirmed directly by reading
its own source (a freshly-compiled C binary with no V8/Node runtime
linked in at all). Calling any N-API function from that generated C
program would either fail to resolve correctly or genuinely segfault
(a real, live V8 context does not exist in that process) - this was
recognized and NOT attempted, to avoid a real crash.

## Real Consequence: "JavaScript Bridge" Has a Fundamentally Different Shape Than C/Rust/Python

For C, Rust, and Python, the working pattern was: dlopen() a shared
library from a standalone process, then call its plain C-ABI
functions directly.

For genuine N-API addons, the only real, safe mechanism is to call
them from WITHIN a real, live Node.js process - i.e., the same kind
of process already running this very test suite. There is no
"load a .node file into an arbitrary C program" pattern that works
safely, because the addon's own functions expect a real V8 runtime
underneath them, not a standalone C main().

This means a genuine JavaScript Bridge, for calling real N-API
addons, is architecturally NOT a "new HarnessExecutor-style FFI
loader" - it is closer to: UR delegates to (or itself runs inside) a
real Node.js process, and that process does the real require() +
function call natively, with no dlopen step of its own at all.
Disclosed here, before any Core API design.

## What Remains Genuinely Achievable, Consistent With the Existing FFI Layer

ffi-napi/ffi-node-style modules (the "FFI-only" option in the
explicit direction's own three choices) are themselves a DIFFERENT
real mechanism: they let JS/Node code call INTO plain C-ABI libraries
(the same kind SQLite3/rav1e already are) - that is, they are
Node-side tooling to reuse the existing NativeFfiLoader-style
pattern, not a way to call N-API addons from a standalone C program.
This project's existing FFI layer (NativeFfiLoader/HarnessExecutor)
already models roughly what ffi-napi would offer UR - a JS Bridge
whose OWN purpose is "call plain C-ABI libraries from JS/UR-orchestrated-JS"
would largely duplicate work already done, not introduce a new
capability.

Real, disclosed conclusion: the genuinely new, valuable capability a
"JavaScript Bridge" would add is calling real N-API addons (like
sharp) or plain JS functions/values - and the only safe way to do
that is via a real, live Node process, not via this project's own
HarnessExecutor pattern extended to a fourth language. This is a
real architectural decision point, surfaced before any Core API code
is written, per explicit direction to inventory before designing.
