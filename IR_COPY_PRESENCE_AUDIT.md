# IR Copy Presence Audit

**Question this report answers:** does the current IR (as of
`v27-level2-9` in-progress work) contain any instruction pattern that a
Copy Propagation pass — scoped to plain SSA rebind copies (`v2 = v1`,
no operation) — could actually optimize?

**Answer: No. Zero occurrences, across every category tested.**

---

## 1. Why this question was asked before writing any code

`OPTIMIZER_SPEC.md`'s original §6.3 proposed Copy Propagation as item 7
of Level 2.9's fixed pipeline. Before implementation began, independent
review required this audit — a direct empirical check of whether the
proposed pass's target pattern actually occurs in real compiler output,
rather than assuming it does because Copy Propagation is a standard
pass in most textbook optimizer designs.

## 2. What counts as a "copy" for this audit

Per the ratified scope (mirroring what Copy Propagation would have been
restricted to): an instruction of the exact shape "define a new SSA
value equal to an existing SSA value, with no operation performed." This
explicitly excludes `v = constant`, `v = load(...)`, `v = call(...)`,
and any `binop`/`unop` — even though these produce a value, none of them
is a *copy* of another already-existing SSA value.

## 3. Methodology

Six categories of real UR programs, compiled through the actual
Lexer → Parser → Semantic → TypeChecker → Lowering pipeline (not
hand-constructed IR), with every resulting instruction's `kind` tallied:

1. Sequential assignments (`let a = b; let c = a; a = d; let x = c`).
2. Assignments inside `if`/`else` (forcing slot promotion).
3. Assignments inside `while` (forcing slot promotion).
4. After struct construction and struct-to-struct copy (`let q = p`).
5. After array construction and element access.
6. After a function call whose result is assigned to a variable, then
   copied again.

## 4. Results

| # | Category | Instruction kinds present | Copy pattern found? |
|---|---|---|---|
| 1 | Sequential assignments | `param` only (2 instructions total) | No — zero instructions at all for the assignments themselves |
| 2 | Inside `if`/`else` | `param`, `const`, `binop`, `store`, `load` | No |
| 3 | Inside `while` | `param`, `const`, `store`, `load`, `binop` | No |
| 4 | Struct construction/copy | `const`, `store`, `load` | No |
| 5 | Array construction/access | `const`, `array_store`, `array_load` | No |
| 6 | Function call result copied | `param`, `const`, `binop`, `call` | No |

**Zero occurrences in every single category.**

## 5. Why this is architecturally guaranteed, not merely empirically rare

The current `IRInstruction` union
(`param | const | binop | unop | call | load | store | array_load |
array_store`) contains **no instruction kind whose shape is "copy an
existing SSA value into a new one with no operation."** Every source-
level "copy" resolves during Lowering into one of exactly three things:

1. **Zero instructions** — for a non-slot-based variable (never
   crossing a branch/loop boundary), `lower-to-ir.ts`'s environment-
   based SSA construction (`varEnv`/`assignVar`) directly rebinds the
   variable name to the *existing* SSA value reference. The rebind
   itself never becomes an instruction — this is why category 1 above
   produced literally zero instructions for four assignment statements.
2. **A `load`** — for a slot-based variable, reading its current value
   is a memory read from a local slot, categorically different from an
   SSA-register-to-SSA-register copy (and excluded from this audit's
   "copy" definition regardless, per the ratified scope).
3. **A `store`** — writing into a slot; defines no SSA id at all, so it
   is not eligible to be "propagated" as a value in the first place.

Given this, no UR program — regardless of how it is written — can cause
Lowering to emit an instruction matching this audit's "copy" definition,
because no instruction kind capable of representing one exists in the IR.

## 6. Decision

**Copy Propagation is removed from Level 2.9's scope.**
`OPTIMIZER_SPEC.md` §2.1 (fixed pipeline) and §6.3 have been updated to
reflect this — recorded as a **positive finding**, not a gap: Lowering's
own SSA construction already performs the equivalent of early copy
elimination as an inherent side effect of how it resolves variable
references. Building a pass to catch a redundancy class Lowering never
produces would be correct but permanently vacuous.

## 7. Explicit reconsideration trigger

Copy Propagation should be re-evaluated from scratch — as a new,
separately-reviewed design decision — if either becomes true in a
future phase:

- Lowering's variable-resolution strategy changes such that it stops
  directly rebinding non-slot-based variables (reintroducing real copy
  instructions).
- Phi nodes are ever introduced (a phi node is fundamentally a multi-
  input copy; trivial phi elimination is Copy Propagation's classic use
  case in phi-based SSA compilers).

Until either condition holds, this remains a closed question, not an
open one deferred for later convenience.
