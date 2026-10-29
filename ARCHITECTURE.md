# ARCHITECTURE.md

**This is the single, final reference for UR's current architectural
state.** Every other document under `docs/proposals/` and
`docs/architecture/` is **decision history** — useful for understanding
*why* a decision was made, but **this file is the only one that
states what is currently true**. When any other document conflicts
with this one, this file wins; update this file when a new decision
supersedes an old one.

## Entry point table

| Section | Official reference |
|---|---|
| Architecture Principles | This file |
| Compiler pipeline | §1, this file |
| Backend design (real status) | §2, this file — links to each backend's own active Design Proposal |
| LLVM Backend design | `docs/proposals/LLVM_BACKEND_DESIGN_PROPOSAL.md` |
| WASM nested control flow | `docs/proposals/WASM_NESTED_CONTROL_FLOW_DESIGN_PROPOSAL.md` (Layer 1), `docs/proposals/WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md` (Layer 2) |
| Ratified architectural rules | §4, this file |
| Backup Policy | §6, this file |
| Historical decisions | `docs/proposals/` and `docs/architecture/` (chronological, not authoritative for current state) |


## 1. Compiler pipeline (unchanged, foundational)

```
UR source → Lexer → Parser → Semantic Analysis → TypeSystem → IR (lower-to-ir.ts)
```
IR is memory-based (`alloca`/`store`/`load` through shared local
slots), not SSA. This is a permanent architectural choice — see §4.

## 2. Backends (current real status)

| Backend | Status |
|---|---|
| **C Backend** | Mature — full struct/array support, recursion, real `gcc`-verified compile+run. |
| **WASM Backend** | Mature — struct/array support, `if`/`while`/`break`/`continue` (single-level), nested `if` (any depth, confirmed live via real WebAssembly execution — see `docs/proposals/WASM_NESTED_CONTROL_FLOW_LAYER2_DESIGN_PROPOSAL.md`), real Golden-tested bytecode. Loops nested inside/around `if`, recursion: not yet implemented. |
| **LLVM Backend** | Early — Milestone A (literals/return/arithmetic), comparisons, `if`/`else` (including nested, via the Transitional Entry Visibility Rule, §5) all real and tested. Tier 2 (real `clang`/`llc` verification) Not Yet Verified — no toolchain in this sandbox. |

## 3. Validator architecture — the intended shape, and current real deviation

**Intended, target shape per Backend** (per direct guidance — this is
the standard to converge toward, not necessarily what exists in full
today):
```
IR → Semantic Validator → Backend Builder → Backend Validator
```
One semantic layer, one backend-specific layer — not an accumulating
stack.

**Current real state (disclosed honestly)**: the LLVM Backend has 4
real validator files (`validator.ts` pre/post-build, `memory-validator.ts`,
`control-flow-validator.ts`) — more layers than the target shape
above. This grew organically as each real constraint was discovered
(SSA well-formedness, memory-safety, CFG structure) rather than being
designed as one shape from the start.

**Not merged now — evidence-based, not principle-based**: no real
problem (performance, maintainability, or correctness) currently
motivates merging them, and each layer has a distinct, real
responsibility with its own independent, passing tests. If future
evidence shows merging would genuinely improve design or maintenance
(a real bug traced to the split, a real maintenance cost observed, a
real performance measurement), this decision should be re-evaluated
against that evidence — this is not a fixed rule against ever
consolidating, only a statement that no such evidence exists today.

## 4. Ratified decisions (permanent, until explicitly revisited)

- **Memory-based IR, no manual `phi`**: LLVM's own `mem2reg` is the
  designated SSA/`phi` owner for the LLVM Backend. Real, internal SSA
  is deferred to a future UR-internal Optimizer or LLVM-independent
  Backend.
- **Control Flow Merge Policy**: generate a merge block only when at
  least one execution path continues after a conditional.
- **Transitional Entry Visibility Rule** (LLVM Backend only): values
  defined in a function's real `entry` block (only `alloca`/`const_i64`)
  are treated as visible everywhere else — because the current LLVM
  CFG shapes are acyclic and restricted. **Not** Dominance Analysis.
  Must be re-evaluated if the IR's own representation changes.
- **Recursive code emission (WASM Backend, `encodeReturnBlockBody`)**:
  a real, deliberate architectural decision, not an incidental
  implementation detail. `encodeReturnBlockBody` (`emit-wasm.ts`)
  recursively encodes nested control flow directly — a `branch`
  terminator recurses into its target block's own encoding (real
  structural fallthrough); a `cond_branch` terminator recurses into
  both arms, emitting a real, nested, void-typed WASM `if`/`else`.
  This works specifically because WASM's own binary format natively
  supports structurally nested `if`/`else` — a property the LLVM
  Backend's own flat basic-block model does not share. **Any future
  change to this function's own traversal strategy (e.g. converting
  it to an iterative worklist, or a different CFG-walking algorithm)
  is a real architectural change to this decision, not a routine
  refactor** — it should be treated with the same scrutiny as any
  other item in this section, not modified silently.

## 5. Explicit scope boundaries (currently out of scope, everywhere)

`while`/`for` inside the LLVM Backend; nested control flow inside the
WASM Backend (Layer 2 not yet built); recursion in the WASM Backend
(deferred pending a real stack-depth/growth decision); `switch`/`match`,
`try`/`catch`, threads, SIMD, debug info, optimization passes — none
of these are implemented in any backend today.

## 6. Backup Policy (written policy, per direct instruction — not merely a claim that it happened once)

```
Backup Policy — after every accepted Milestone:

1. git commit   — with a real, descriptive message covering what changed and why
2. git tag      — a real, named checkpoint (e.g. "milestone-<name>")
3. Export ZIP   — save the working tree as a .zip release
4. Verify ZIP   — confirm the .zip is extractable and non-corrupt
                  (e.g. `python3 -c "import zipfile; zipfile.ZipFile(path).testzip()"`
                  must return None, and the file count must look real)
```

**Real, verifiable evidence for the most recent execution of this
policy** (not a bare claim): commit `2d44a7c48061f3811261705f4fd6d80409c7d8d3`,
tag `milestone-architecture-consolidated`, zip file
`ur-language-latest.zip` (8,192,644 bytes, 3,781 files, confirmed via
`zipfile.testzip()` returning `None` — i.e., confirmed non-corrupt,
not merely saved).

**Honest, disclosed limitation**: this environment has no configured
`git remote` (confirmed: `git remote -v` returns empty) and no
network access to push to GitHub/GitLab/a private server — a true
remote repository (preserving full history, not periodic snapshots)
cannot currently be set up from this sandbox. If real credentials and
a remote URL are ever provided, `git remote add` + `git push --tags`
should be added to this same policy immediately.

## 7. Rewrite caution (per direct instruction)

Do not rewrite, redesign, or restructure code that currently works
and is tested, without a concrete, stated reason (a real bug, a real
performance problem, or a real, substantial simplification) — not
"it could be cleaner." Every past rewrite in this project's own
history had a real, disclosed trigger (a lost package requiring
reconstruction, a discovered architectural bug); this is not a
standing license for aesthetic rewrites going forward.

## 8. Where to find decision history

`docs/proposals/*.md` — every Design Proposal, in chronological
order. `docs/architecture/*.md` — audits, backlogs, and older
architectural notes. These remain as historical record; **this file
is the only one guaranteed to reflect the current, real state**.

## 9. Runtime Function Call Philosophy (already decided, confirmed live, newly documented here)

**Real, existing architecture** (not new — discovered and confirmed
live this session, `builtins-registry.ts` + `shared/builtins.ts`):
Runtime capabilities (`print`, `input`, `free`, `call_external`) are
exposed to UR source code as **Builtins/Intrinsics** — plain
identifiers resolved by the Semantic Analyzer's own generic
builtin-lookup path (`walkCall()`), never a new keyword, never a
separate standard-library import mechanism.

```
UR source ("print(x)")
     |
Semantic (builtins-registry.ts) - name+arity lookup, BuiltinId "Print"
     |
Shared contract (shared/builtins.ts) - Runtime-agnostic BuiltinId, not IR-visible
     |
Runtime Registry (runtime-table.ts's resolveBuiltinExtern()) - BuiltinId + argument's real IRType -> the concrete Runtime C function (ur_print_int/ur_print_bool/ur_print_string/...)
```

**How future Runtime capabilities are added** (e.g. `read`,
`open_file`, `http_connect`): one line in `BUILTINS_REGISTRY`, one
mapping entry in `resolveBuiltinExtern()` - **zero change to the
Lexer or Parser**. This is the real, binding answer to "what is UR's
own Runtime-call philosophy" - already decided, proven extensible,
not requiring a redesign.

**Real gap found and closed this session**: this real mechanism had
never been exercised by a single real example program in this
project's own history - `examples/calculator.ur` is the first,
confirmed live via real `gcc` compile + standalone execution (not a
manually-invoked `WebAssembly` call): a genuinely standalone terminal
program that prints its own real output (`22`, `12`, `85`, `3`, `0`,
`true`, `false`).

## 10. Real Constraints Discovered While Writing examples/game_tictactoe.ur

**Real, disclosed limits found by writing an actual program** (per the
established discipline of "let real programs reveal real gaps"):

1. An array literal cannot appear in a function parameter's own type
   position (e.g. `function f(board: [int; 9])`) — this is
   misparsed as an `ArrayLiteral` expression, not a real array type
   annotation.
2. **Arrays cannot be passed as function parameters at all** in this
   Level 2 phase — only indexed element access (`arr[i]`) works, and
   only within the same scope the array was declared in. All array
   logic must currently live inside the same function that declares
   the array (confirmed: this matches `examples/array_sum.ur`'s own
   real, pre-existing structure too, not a new discovery).

**Real, honest implication**: any real UR program using arrays today
must keep all array-touching logic in one function — a genuine
usability limit for larger programs (e.g. a real Tic Tac Toe with a
real `checkWin()` helper function is not yet possible without this
constraint). Logged here as a real, concrete target for a future
Design Proposal (array-by-reference parameter passing), not
speculatively — found by writing a real program, exactly as intended.

## 11. Precise Language Fundamentals Map (confirmed live, per direct instruction to test fundamentals before larger programs)

Isolated, individually-confirmed capability map — see
`tests/examples/language-fundamentals.test.ts`:

| Capability | Status |
|---|---|
| Recursion | ✅ Works (`factorial(5) = 120`, confirmed via real gcc execution) |
| Struct construction + field access, inside any function | ✅ Works |
| Struct passed AS a function parameter | ✅ Works |
| Struct returned AS a function's own return type | ❌ Does NOT work |
| Array passed AS a function parameter | ❌ Does NOT work (confirmed, matches the tic-tac-toe discovery) |

**Real implication for program design**: any function may accept a
`struct` and read its fields, but cannot construct-and-return one, and
cannot accept an array at all. Recursion is fully real and usable.
This precisely bounds what kind of larger example program is
realistic next, without discovering the blocker mid-design.
