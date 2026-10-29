# IMPORT_ARCHITECTURE_AUDIT.md

Pure investigation, no code changes, per explicit direction. Every
claim below is grounded in direct source inspection (grep + file
reading), not inferred.

---

## 1. Every Import Entry Point, Who Calls It, Whether It Uses ModuleRegistry

| # | File | What it actually does with `program.imports`/`ImportDecl` | Calls `ModuleRegistry`? |
|---|---|---|---|
| 1 | `src/compiler/frontend/parser.ts` | Parses the `import`/`استورد` syntax into `ImportDecl[]` (path segments + optional alias). Produces the data; does not consume or act on it. | No |
| 2 | `src/compiler/frontend/ast.ts` | Defines the `ImportDecl`/`Program.imports` TYPE only. No behavior. | No |
| 3 | `src/compiler/semantic/index.ts` (line ~109) | For each import, declares its own name/alias as a `"import"`-kind scope entry, purely to detect a NAME COLLISION between two import statements themselves (`DUPLICATE_FUNCTION`/"duplicate import name") and to make the alias a valid identifier for later member-call syntax (`sqlite3.open(...)`). Does **not** read the imported file, does **not** merge its declarations, does **not** validate that the imported thing actually exists. | No |
| 4 | `src/compiler/codegen/lower-to-ir.ts` (line ~1183) | Builds `importedNames: Set<string>` — used ONLY to distinguish an FFI-style external call (e.g. `sqlite3.open()`) from an unresolved UR function call, for the Backend's own error-message purposes. Does **not** read the imported file, does **not** merge anything. | No |
| 5 | `src/lsp/incremental-bridge.ts` (line ~212) | Collects `imports: string[]` (just the path strings) for the LSP's own incremental-recompilation dependency tracking (so the IDE knows "if file X changes, also re-check files that import X"). Runs `analyze`/`typeCheck` on the SINGLE file being edited, with **no merge of any imported module's own declarations** — confirmed directly: no `ModuleRegistry`, no file-read of the imported module anywhere in this function. | No |
| 6 | `src/cli/index.ts` (`compileToIR`/`resolveAndMergeImports`, added this session) | **The only entry point that actually EXECUTES an import**: reads the imported `.ur` file from disk (`./ur_packages/<path>/index.ur`, relative to CWD), parses it, and merges its `functions`/`structs` directly into the main `Program`'s own arrays before `analyze`/`typeCheck`/`lowerToIR` run. | **No** — confirmed by direct `grep`, this entry point does its own, independent file-read + AST merge; it does not call `ModuleRegistry` at all. |
| 7 | `src/compiler/module/export-checker.ts` (`buildModuleDescriptor`) | Converts `ImportDecl[]` → `ImportRecord[]` (the shape `ModuleRegistry` itself expects). This IS part of the `ModuleRegistry` subsystem's own internals — called BY `ModuleRegistry.register()`, not by anything else. | **Is itself part of** `ModuleRegistry`'s own machinery, but is never invoked outside of it. |

## 2. Where `ModuleRegistry` Itself Is Actually Used

```
grep -rln "new ModuleRegistry|ModuleRegistry(" --include="*.ts" .
```

Real result — **four files, all tests, zero production code**:
- `tests/compiler/module/module-audit.test.ts`
- `tests/compiler/module/module.test.ts`
- `tests/compiler/localization/import-system-status.test.ts`
- `tests/compiler/struct-ir/struct-full-pipeline-runtime.test.ts`

**`ModuleRegistry`/`ImportResolver` (a real, tested, symbol-based
module system — confirmed working correctly in 28+ tests across
those four files) is never called from any real, user-facing
execution path in this project.** It is exercised only by tests that
construct and drive it directly, by hand, inside the test file
itself.

## 3. Flow Diagram — CLI → Parser → IR → Module Loading → Merge → Codegen

```
REAL, EXECUTED PATH (the only one that actually runs an import):

  ur run test.ur
      |
      v
  src/cli/index.ts: compileToIR(filePath)
      |
      v
  lex + parse (main file)  ->  Program { imports: [ImportDecl...], functions, structs, ... }
      |
      v
  resolveAndMergeImports(program)      <-- ADDED THIS SESSION (Phase 0-A)
      |  for each ImportDecl:
      |    - resolve path -> ./ur_packages/<path>/index.ur (relative to CWD)
      |    - read file from disk directly (fs.readFileSync)
      |    - lex + parse the imported file -> a SECOND, separate Program
      |    - push its functions/structs into the MAIN program's own arrays
      |    (ModuleRegistry is NOT called anywhere in this step)
      |
      v
  ONE merged Program (imports: [] — cleared after merging)
      |
      v
  analyze(mergedProgram)     <-- sees imported functions as ordinary,
      |                          already-declared functions (no special
      |                          cross-module logic engaged - the merge
      |                          already made them look local)
      v
  typeCheck(mergedProgram)   <-- same: ordinary local declarations now
      |
      v
  lowerToIR(mergedProgram)  <-- same: emits IR for ALL functions
      |                         (main file's own + imported module's own)
      |                         as if they were one file all along
      v
  interpretModule(ir, "main")  <-- executes; imported functions are
                                   just entries in ir.functions, no
                                   different from main's own


SEPARATE, UNRELATED PATHS (touch program.imports for DIFFERENT reasons,
do not execute an import in the sense above):

  LSP (src/lsp/incremental-bridge.ts):
    parse -> collect import PATH STRINGS only -> feed to incremental-
    build dependency tracker. analyze/typeCheck run on the single file
    only. No merge. Purpose: "recompile file X's own diagnostics when
    a file it imports changes" — a cache-invalidation signal, not
    program execution.

  Semantic (own internal check) + Lowering (own internal check):
    both read program.imports, but only to build small, LOCAL sets
    for their own, narrow internal purposes (name-collision detection;
    FFI-vs-UR-function disambiguation) — neither reads a second file,
    neither merges anything.

DESIGNED BUT UNUSED PATH (real, tested, never wired to anything above):

  ModuleRegistry.register(program, filePath)
      |
      v
  export-checker.ts: buildModuleDescriptor()
      |  builds ImportRecord[] + ExportRecord map (symbol-based,
      |  not AST-merge-based)
      v
  ImportResolver.resolveAll()
      |  resolves each ImportRecord's own path to a canonical file
      |  path (pure computation — does NOT read the file itself)
      v
  (nothing further — no code anywhere calls this from a real
   execution entry point; the caller is expected to read the
   resolved path's own file and register IT too, recursively — this
   pattern IS exercised inside the four test files listed in §2, by
   the test's own hand-written loop, never by production code)
```

## 4. Dead Code — Identified Directly, Not Assumed

**`ModuleRegistry`, `ImportResolver`, and `export-checker.ts`'s own
`buildModuleDescriptor` are dead code from a production-execution
standpoint** — real, working, tested code (confirmed via the four
test files' own 28+ passing tests), but with zero call sites in any
file that a real `ur run`/`ur build`/LSP invocation would ever
actually execute. This is not a judgment that the code is bad — the
symbol-based design it implements (exported-names tracking, resolved
paths, circular-import detection via its own `resolving: Set`) is
real and more architecturally sound than the CLI's own direct-copy
merge added this session — it is simply unconnected to any real
entry point today.

## 5. Is There More Than One Import Path? — Direct Answer

**Yes, in the sense that multiple files touch `program.imports` for
different reasons — but only ONE of them actually executes an
import** (reads the imported file, makes its declarations usable).
The others (`Semantic`, `Lowering`, `LSP`) use the same data field
for narrow, unrelated, non-competing purposes (name-collision
checking, FFI disambiguation, dependency-tracking for IDE caching)
— they do not compete with each other or with the CLI's own path,
because none of them attempt to do what the CLI's own new merge
step does.

**The real architectural question this raises, stated directly, not
softened**: the CLI's own new merge (Phase 0-A, this session) is a
plain AST-copy, built independently of the already-existing,
already-tested, symbol-based `ModuleRegistry`/`ImportResolver`
system — meaning **this project now has two real, different designs
for "what importing means"** (copy-based vs. symbol-based), one
wired to production, one fully built and tested but wired to
nothing. This is not "two competing execution paths fighting over
the same request" (confirmed above — only one path executes
anything) — it is **one shipped, minimal design and one unshipped,
more capable design sitting side by side, unconnected**. Whether the
CLI's own path should be replaced with the `ModuleRegistry`-based one
before FRI work begins is the real decision this audit surfaces, not
decided here.
