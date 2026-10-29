# UR Intermediate Representation (IR) Specification

**Status:** Phase 2.1, complete **within the scope defined in §8** — this
is not a claim of general-purpose IR completeness. See §8 for the exact
boundary and `CODEGEN_PIPELINE.md` for how this fits into the full pipeline.
**Location:** `src/shared/ir.ts`
**Verifier:** `checkModuleInvariants()` in the same file

---

## 1. Design Philosophy

UR's IR is **SSA-based** (Static Single Assignment): every value is defined
exactly once, by exactly one instruction, identified by a monotonically
increasing integer id within its function. This was chosen over a tree-based
IR specifically because later phases (Optimizer, LLVM backend, WASM backend)
all benefit from or require SSA form — building it in from the start avoids
a costly IR redesign later.

**Current scope (Phase 2.1-2.3):** straight-line code only. Every function
lowers to exactly one basic block ending in one terminator. Control flow
(`if`/`while`/`for` → branches + phi nodes) is a deliberately separate,
not-yet-implemented phase — but the type definitions below already model
the general multi-block case (`branch`, `cond_branch` terminators exist)
so introducing control flow later is additive, not a redesign.

---

## 2. Types

```typescript
type IRType = "i64" | "f64" | "bool" | "string" | "void";
```

Maps from UR's tier-1 types (`int→i64`, `float→f64`, `bool→bool`,
`string→string`) plus `void` for functions with no return type annotation
(UR's `URType` system represents this as `Unknown` — see §6).

---

## 3. SSA Values

```typescript
type IRValueRef = { id: number };
```

A reference to a previously-defined value. IDs are unique within a function
and assigned in strict definition order — `checkModuleInvariants()` rejects
any reference to an id that has not yet been defined at that point.

---

## 4. Instructions

Every instruction defines exactly one new SSA value (`id`), carries its
result `type`, and carries a `location` (see `src/shared/locations.ts`) for
diagnostics/debug-symbol purposes.

| Kind | Purpose |
|---|---|
| `param` | Binds a function parameter to an SSA value (id 0..n-1, in the entry block) |
| `const` | A literal int/float/bool/string constant |
| `binop` | A binary arithmetic/comparison/logical operation |
| `unop` | A unary negation or logical-not |
| `call` | A direct call to another function in the same module, by qualified name |

### Binary operators (`IRBinOp`)
`add sub mul div mod eq neq lt lte gt gte and or`

### Unary operators (`IRUnOp`)
`neg not`

---

## 5. Terminators

Every basic block ends in exactly one terminator.

| Kind | Purpose | Phase 2.1-2.3 status |
|---|---|---|
| `return` | Returns a value | ✅ produced by the lowering pass |
| `return_void` | Returns nothing | ✅ produced by the lowering pass |
| `branch` | Unconditional jump to another block | 🔜 declared, not yet produced (control-flow phase) |
| `cond_branch` | Conditional jump (then/else) | 🔜 declared, not yet produced (control-flow phase) |

---

## 6. Basic Blocks, Functions, Modules

```
IRModule { moduleName, functions: IRFunction[] }
IRFunction { qualifiedName, sourceName, params, returnType, blocks, entryBlock, location }
IRBasicBlock { id, label, instructions, terminator }
```

`qualifiedName` is the mangled, C-safe identifier (see
`src/shared/symbols.ts`'s `qualifiedName()`) used as the emitted symbol
name by any backend. `sourceName` is the original UR identifier, kept for
diagnostics and debug symbols — it may be non-ASCII (e.g. Arabic function
names); `qualifiedName` never is.

**Void representation:** UR's `URType` system has no `"Void"` kind — a
function with no return-type annotation resolves to `T_UNKNOWN` by
convention (see `resolveOptionalTypeRef` in `type-env.ts`). The IR lowering
pass (`toIRType`) maps `Unknown → "void"`. This is a Frontend design
decision predating Level 2 — the IR conforms to it rather than introducing
a new Frontend-level Void type.

---

## 7. The Verifier (`checkModuleInvariants`)

A pure, standalone function — never called by the lowering pass itself —
that checks structural SSA/CFG discipline on any `IRModule` and returns a
list of violations (empty = valid). Checks performed:

1. **No duplicate SSA ids** within a function.
2. **No duplicate block ids** within a function.
3. **Definition before use**: every value reference (`binop`/`unop` operands,
   `call` arguments, `return`/`cond_branch` operands) must refer to an
   already-defined id.
4. **Branch target existence**: `branch`/`cond_branch` targets must name a
   real block id in the same function.
5. **Entry block existence**: `entryBlock` must name a real block.
6. **CFG reachability**: every block must be reachable from the entry block
   by following `branch`/`cond_branch` edges — an unreachable block is
   flagged as dead code.
7. **Call resolution**: every `call.callee` must match some function's
   `qualifiedName` in the same module (no FFI/extern calls exist in this
   phase's scope — that model will be introduced in a later phase).

**Deferred to the control-flow phase** (per explicit scope agreement):
dominance analysis and phi-node validity. These are meaningless to check
against an IR that never produces more than one block per function; adding
them now would be premature. The verifier's `branch`/`cond_branch`/
multi-block checks above are already exercised by hand-built test fixtures
in `tests/shared/contracts.test.ts`, so the verifier itself is ready the
moment the lowering pass starts emitting real branches.

---

## 8. What Is Explicitly Out of Scope (Phase 2.1-2.3)

- Control flow (`if`/`while`/`for`) — needs branches + phi nodes (declared
  in the type system, not yet lowered to).
- Structs, arrays, maps, tuples, optionals.
- FFI / extern calls.
- Multi-file linking (imports parse fine at the Frontend level but are
  never acted upon by the lowering pass in this phase).
- Dominance / phi-node verification (see §7).

Every one of these produces a `CG1001 UNSUPPORTED_CONSTRUCT` diagnostic
when encountered — never silent mishandling. See
`tests/compiler/codegen/lower-to-ir.test.ts`'s "out-of-scope constructs"
suite for the full regression coverage of this guarantee.
