# IMPORTS_ARCHITECTURE_REPORT.md

**Engineering report only, per explicit review policy — no redesign
started.** Answers the exact question posed: "Can the current Imports
architecture accommodate importing C, Python, JavaScript, and other
language libraries later, without rewriting the system?"

---

## Two Separate, Disconnected Import Systems Exist Today

### 1. The Native Library Registry mechanism (CONNECTED, real, working)

`import sqlite3` + `sqlite3.libversion()`-style member-calls. Built
during the FFI stages. Confirmed directly this round to correctly
handle: single/multiple imports, duplicate-import rejection (`SE2002`),
lazy validation (bogus unused imports don't error; bogus imports that
are actually USED do). Confirmed to compile 1000 import-using
functions in well under a 2-second budget.

**This is the ONLY import mechanism actually reachable from a real UR
program today** — confirmed via direct testing through the full,
correct pipeline (lex -> parse -> analyze -> typeCheck -> lowerToIR).

### 2. The general-purpose module system (DISCONNECTED — real code, but dead from the compiler's own perspective)

`src/compiler/module/` (import-resolver.ts, module-descriptor.ts,
registry.ts, index.ts) — a genuinely more sophisticated system:
relative imports (./foo), stdlib imports (std/io), package imports
(bare names), circular-import detection (two mechanisms), and
topological build ordering.

**Confirmed via direct search: referenced by ZERO real pipeline entry
points.** lower-to-ir.ts, the frontend, the type checker, and every
build tool never import from src/compiler/module/ anywhere. It has its
own isolated test file that exercises it directly, but no real UR
program compiled through the actual pipeline ever reaches this code.
Confirmed directly: the connected Parser doesn't even accept the
SYNTAX this system is designed to resolve (import ./mymodule and
import std/io both fail at parse time).

## Answer to the Explicit Question

**Partially yes, partially no — precise, not a simple yes/no:**

- **For importing more NATIVE (C) libraries**, following the same
  pattern: **yes**, scales directly — adding a library is purely a
  registry-entry addition, no language/parser/pipeline changes needed.
  Already proven repeatedly during the FFI stages.

- **For importing OTHER LANGUAGES' libraries** (C++, Rust, Python,
  JavaScript): **the current connected architecture is fundamentally
  C-FFI-shaped** — its whole design (real C symbol names, dlopen/
  link-time C prototypes, C-ABI type mapping) has no natural extension
  point for a different language's own calling convention. Each
  additional source language needs its own, separate bridge mechanism
  (matching the project's own earlier vision of namespaced imports like
  `import c.sqlite3` / `import python.numpy`) — not a natural extension
  of the current registry's data shape, which has no language-tag
  concept at all today.

- **The DISCONNECTED module system**, if wired in, would provide the
  right kind of general namespacing/resolution/circular-detection
  machinery a multi-language scheme would eventually need — but
  connecting it is itself a real, undone integration task.

## What This Means, Concretely (no redesign attempted, per policy)

1. **No immediate blocker for v1.0**: the connected system is
   sufficient for the stated v1.0 scope (libc/libm/sqlite3, all C
   libraries, all already working).
2. **A real architectural decision is needed before Python/JS/Rust
   imports begin** (explicitly deferred to after v1.0) — likely: wire
   in the disconnected module system for general namespacing, and
   design a per-source-language bridge abstraction the registry
   currently has no concept of. Neither is started here.
3. **The disconnected module system is not wasted effort** — it is
   real, tested, working code for exactly the resolution problem
   multi-language imports will eventually need; it just currently sits
   unconnected from the real pipeline.

## Recommendation

Document this finding and proceed with v1.0 as planned — the connected
system fully covers the stated v1.0 import scope. Treat "wire in the
general module system + design a multi-language bridge abstraction" as
its own, explicitly scoped v1.1+/v2.0 architectural item, not started
now.
