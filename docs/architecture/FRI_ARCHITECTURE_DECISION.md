# FRI_ARCHITECTURE_DECISION.md

Official decision (final, not left ambiguous), per direct request to
resolve the two-systems question before this file can be considered
closed.

## The two real systems, confirmed by direct inspection

1. **`manifest.json`-based FRI** (`src/cli/index.ts` +
   `src/interpreter/interpret.ts`, added this session): the ONLY
   mechanism a `.ur` program's own `import`/`استورد` statement can
   reach. Compiles/executes source directly, per call, via a
   subprocess (gcc/g++/rustc/go/javac+java/dotnet/node/tsx/python3).

2. **`src/ffi/drivers/*`** (python-driver.ts, js-bridge.ts,
   rust-bridge.ts, onnx-driver.ts, opencv-driver.ts, ros2-driver.ts):
   a real, independently-tested (225+ tests across these files,
   confirmed in earlier sessions) TypeScript-level native-library
   loader (dlopen-based, via `NativeFfiLoader`/`HarnessExecutor`).
   **Not reachable from any `.ur` program's own `import` statement —
   confirmed directly: zero call site connects `resolveAndMergeImports`
   or `interpretModule` to `DriverRegistry`/`NativeFfiLoader`.**

## Decision

**Option 2 is adopted, not Option 1**: the two systems are NOT
unified in this phase. `src/ffi/drivers/*` is documented here,
explicitly and permanently for this version, as an **internal,
TypeScript-level toolkit** — usable by code written directly against
this codebase's own TypeScript API, but **not part of UR's own
public, language-level import system**. The manifest-based FRI
mechanism (#1 above) is the **sole, official, public multi-language
import system** for UR programs.

## Why Option 2, not Option 1 (unification)

- The two systems solve genuinely different problems: #1 answers
  "call a function in another language from a `.ur` program, at
  the language level"; #2 answers "load a precompiled native
  library from TypeScript code that builds on this compiler/
  runtime." Collapsing #2 into #1's own subprocess-per-call model
  would require rewriting #2's own dlopen-based, already-tested
  design, or would require rewriting #1 into a dlopen-based model —
  either is a real architectural rewrite, not achievable within a
  bug-fix/feature-closure pass without introducing new, unproven
  risk into already-tested code (#2's own 225+ tests).
- #2's own real constraint (confirmed in RUST_BRIDGE_INVENTORY.md):
  Runtime Validation against a real Rust toolchain/library was
  ALREADY deferred by the original team, for the identical reason
  (`rustc`/toolchain unavailability) this session hit again with #1.
  Unifying the two systems would not have resolved that constraint
  either way.

## What this means going forward

- `src/ffi/drivers/*` is NOT deprecated and is NOT being removed —
  it remains a real, valid internal toolkit.
- A future version MAY expose `src/ffi/drivers/*` through the
  `import` statement (making #2 reachable from `.ur` code) as a
  deliberate, separate feature — not decided or scheduled here.
- Until then, any documentation describing "UR supports importing
  Rust/Go/Java/C#" must describe this specifically as the
  manifest-based mechanism (#1), with its own accurate per-runtime
  status table (see FFI_STATUS.md's own "FRI Manifest-Based Import"
  section) — never conflated with `src/ffi/drivers/*`'s own,
  separate status.
