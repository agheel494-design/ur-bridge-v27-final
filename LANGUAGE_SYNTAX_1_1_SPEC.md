# UR Language Syntax 1.1 — Design Specification (Arrays & Structs)

**Status:** RATIFIED FOR IMPLEMENTATION — approved after two independent
review rounds. Round 1 (GO WITH FIXES): three clarifications applied —
explicit primitive-only field scope tied directly to copy semantics
§2.3, precise structural comparison semantics including field order/
short-circuit/string-content-comparison §2.4, and an explicit
no-resize-operation statement for fixed-size arrays §1.4. Round 2 (after
Grammar+Parser+AST implementation surfaced a real gap during Semantic-
layer preparation): **struct construction syntax was missing entirely**
from the original ratified document — resolved in §2.7 (`Point(1, 2)`,
positional-call syntax reusing `CallExpression`) with two explicit rules
confirmed by review: strict arity (argument count must exactly equal
field count) and field-declaration-order positional binding (never
name-based). This closes the last open gap blocking Struct-related
Semantic Analyzer work. **This document still contains zero code and
proposes zero implementation** — it exists solely to resolve syntax/
semantics questions BEFORE any Grammar/Lexer/Parser/AST/Semantic/
TypeSystem/IR change is written — per explicit review instruction, this
is a new phase (**Level 2.7.5 — Language Syntax Extension Design**)
inserted before Level 2.8, and it changes nothing: no Parser code, no
Lexer code, no Semantic code, no IR code. Level 2.8's implementation
must not expand scope beyond what is ratified here (explicitly: no
Generics, no Dynamic Arrays, no Nested Structs, no named-argument or
brace-literal struct construction) without a new, separately-reviewed
design document.

**Trigger for this document:** direct testing proved UR 1.0's frozen
grammar has **no syntax at all** for struct declarations, array literals,
or array type annotations — confirmed via `PE001`/`PE003` parse errors on
every such construct. "Aggregates" therefore cannot be added as a pure
Level 2 (IR/Backend) phase; it requires a **new, deliberately-designed
grammar extension** (hence "UR Language Syntax 1.1", not merely "Level
2.8 IR work").

---

## 1. Arrays

### 1.1 Literal syntax

```
let a = [1, 2, 3]
```

Bracket-delimited, comma-separated elements. `[` and `]` are **already
tokenized** by the Lexer (`LBRACKET`/`RBRACKET`) — used today only for
`IndexExpression` (`arr[0]`). No new Lexer token is required for this.

**Element type:** inferred from the literal's elements (all elements
must share one type — matching UR's existing `let`-inference philosophy
elsewhere; Semantic Analyzer would reject a mixed-type literal like
`[1, "two", true]`).

### 1.1.1 Empty array literals (`[]`): REJECTED — a design decision, not an unexplained limitation

**`[]` is rejected in Level 2.8, by deliberate design** (implemented as
`TY6002` — an explicit, dedicated diagnostic, not a fallback/default
error). This is recorded here explicitly so that if a future phase adds
type inference from context (e.g. `let a: int[] = []`, where the
annotation supplies the element type the literal itself cannot) or a
Generics feature, the decision to accept `[]` again is understood as a
**new, deliberate architectural change to this specification** — not
simply "finishing something that was left incomplete." The reason `[]`
is rejected now is structural, not accidental: without generics or
contextual type inference, an empty array literal's element type cannot
be determined from the literal alone, and Level 2.8 introduces neither
mechanism.

### 1.2 Type annotation syntax

```
function f(arr: int[]): int
let a: int[] = [1, 2, 3]
```

**Recommendation: bracket-suffix (`int[]`), not generic angle-bracket
syntax (`Array<int>`).** Reasoning:

- `Array<int>` requires parsing `<`/`>` as type-argument delimiters,
  which are **already tokenized as the `LT`/`GT` comparison operators**.
  Distinguishing "`<` starts a generic type argument list" from "`<` is
  a less-than comparison" is a well-known, genuinely hard parsing
  ambiguity (C++ has struggled with exactly this for decades — e.g.
  `a<b>c` is ambiguous without extensive lookahead/backtracking or
  semantic feedback into the parser). Avoiding it entirely removes an
  entire class of parser complexity and potential bugs.
- `int[]` reuses `LBRACKET`/`RBRACKET` — **already tokenized, already
  used for indexing** — with zero new ambiguity: a `[` immediately after
  a type name in a type-annotation position is unambiguous.
- This is precedented and well-understood (C, Java, C#, TypeScript all
  use bracket-suffix array types).

**`TypeRef.typeArgs` (dormant field, currently unused by the Parser)** is
explicitly **not** used for this — it remains unallocated for a possible
future generic-type feature, unrelated to this array-syntax decision.

### 1.3 Multi-dimensional arrays: SUPPORTED

**[V1.0-DOC-DRIFT-MULTIARRAY-003 correction]**: this section previously
read "DEFERRED" / "explicitly out of scope for Level 2.8." Confirmed
directly: `UR_LANGUAGE_SPEC_1_0.md`'s own real §11 "deferred to 1.1"
list does not exclude nested arrays, and `int[][]` (array of arrays)
type-checks, lowers, and correctly executes on the Interpreter, the C
backend, and the WASM backend today. The prior "deferred" framing
reflected this WASM backend's own internal v29 milestone label (see
`UR_BRIDGE_V28_MASTER_ROADMAP.md` §9), not a UR language version — that
backend-internal engineering work has since been completed. The
bracket-suffix grammar's own forward-compatibility property (the suffix
parse loop simply repeats, with **zero grammar redesign** needed) is
preserved below as real, accurate historical design rationale for why
this extension was straightforward once undertaken.

Note: this correction covers arrays of arrays (`int[][]`) specifically.
Arrays of structs, and struct fields that are arrays, remain a
genuinely separate, distinct, real limitation — unaffected by this
correction.

### 1.4 Fixed-size only: DEFERRED (no dynamic/growable arrays yet)

Level 2.8 arrays are **fixed-size, size fixed at creation and never
changing thereafter** (their size is determined by the literal's element
count at the point of construction). **An array's size is part of its
creation-time state only — there is no operation of any kind that
changes an existing array's size in Level 2.8.** This is a deliberate
scope boundary, not an oversight: `push`/`pop`/`resize`/`append` were not
forgotten — they simply do not exist yet, by design, and their absence
should not be read as an implementation gap to silently work around.
Dynamic, growable arrays (requiring `ur_alloc`/`realloc`-style Runtime
heap management, similar to `ur_input_string`'s existing allocation
pattern) are deferred to a future Standard-Library-Collections phase.

### 1.5 Bounds checking: YES, via `ur_panic`

Every array index access is bounds-checked at runtime. An out-of-range
index calls the **already-existing** `ur_panic()` Runtime primitive
(`RUNTIME_SPEC.md` §7) — no new Runtime function is needed for this.
This matches UR's established "safety by default" pattern (explicit
`free()` model, AddressSanitizer-verified memory tests) rather than
C's own unchecked-array-access default.

### 1.6 Memory location: stack-allocated (Local Slot model, extended)

A fixed-size array (size known at compile time, from its literal) is
represented as a **Local Slot holding multiple contiguous elements**
rather than one scalar — a natural, additive extension of the Local Slot
model already frozen at Level 2.6 (`CFG_SPEC.md` §1.3), not a new memory
concept. No heap allocation is involved for Level 2.8 arrays.

---

## 2. Structs

### 2.1 Declaration syntax

```
struct Point
    x: int
    y: int
end
```

This matches UR's existing block-`end` pattern (functions/if/while all
use `... end`) and reuses the **existing** `name: type` field syntax
already used for function parameters — no new field-declaration grammar
shape is introduced, only a new top-level declaration kind that contains
a list of them.

**New keyword required:** `struct` (English) needs a canonical keyword
and a translation in each of the 10 supported languages, e.g. Arabic
`بنية` ("structure" — the standard Arabic CS term). This is the **only**
new keyword this document proposes — everything else reuses existing
tokens/grammar shapes.

**Rejected alternative:** `type Point ... end` (reusing the existing
`TYPE` keyword, already reserved but unused as a statement-starter) —
rejected because `type` more naturally suggests a type *alias*
(`type UserId = int`), a different, unrelated future feature; reusing it
for struct declarations would create confusion between two conceptually
different constructs sharing one keyword.

### 2.2 Field access

```
p.x
```

Dot notation — reuses the **existing** `MemberExpression` AST node
(currently used only for module-qualified calls like `math.add(...)`).
This requires **no new Parser grammar** for the access syntax itself —
only a Semantic Analyzer extension to recognize `.` on a struct-typed
value as field access (in addition to its current module-access
meaning), which is a Semantic-level change, not a Grammar-level one.

**Rejected alternative:** `p->x` (arrow notation, C-style for
pointer-to-struct access) — rejected because Level 2.8 structs are
value types (§2.3), never accessed through a pointer in this phase, so
there is no "arrow vs dot" distinction to make; introducing arrow syntax
now for a feature (struct pointers) that doesn't exist yet would be
premature.

### 2.3 Copy semantics: VALUE (copy), matching C struct assignment

```
let b = a   // b is a full, independent COPY of a's fields
```

**Explicit scope boundary (per review):** this "copy" is well-defined
and trivial ONLY because Level 2.8 restricts every struct field to a
**primitive scalar type** (`int`, `float`, `bool`, `string`) — see §2.6.
**No struct field may itself be a struct or an array in Level 2.8.**
Copying a flat sequence of primitives is a fixed-size, fixed-layout
memcpy-equivalent with no recursion and no aliasing questions. If nested
aggregates existed now, "copy" would need its own recursive definition
(deep copy of every nested field, recursively) — that question is
correctly deferred *together with* nesting itself (§2.6), not decided
prematurely here for a case that cannot yet occur.

**Reasoning:** this is the natural extension of
`FUNCTIONS_ABI_SPEC.md` §2.1's **already-documented, already-frozen**
default — "Parameters are passed by value" — applying the exact same
default to struct assignment and struct parameter-passing requires **no
ABI amendment**, just confirming the existing default extends to the new
type. It also matches native C struct assignment semantics exactly
(`struct Point b = a;` in C already copies all fields), making the C
Backend's job for this operation trivial: emit `b = a;` and let C's own
value semantics do the work.

**Rejected alternative:** reference semantics (`b = a` making `b` an
alias of `a`) — rejected because it would require introducing a
pointer/reference concept into the type system now, with all the
aliasing and lifetime questions that entails — exactly the complexity
the review specifically wants resolved by a complete memory model
**before** the Optimizer phase, not accidentally introduced piecemeal
inside Aggregates.

### 2.4 Comparison semantics: STRUCTURAL (field-by-field)

```
a == b   // true iff every field is equal, pairwise
```

The natural counterpart to value-copy semantics — two independently-
copied structs with identical field values are equal. Implemented as an
explicit per-field comparison chain in the Backend (not `memcmp`, which
risks comparing uninitialized padding bytes between fields — a real,
well-known C pitfall this design avoids deliberately).

**Precise, language-level behavior (per review — this is language
semantics, not an implementation detail):**

1. **Field comparison order is declaration order** — fields are compared
   in exactly the order they appear in the `struct` declaration, not
   memory layout order (though for Level 2.8's flat, non-nested,
   non-reordered fields, these are the same order — this distinction
   matters once field reordering/padding-optimization is ever considered
   in a future phase, which is explicitly not decided here).
2. **All fields are evaluated; results are combined with logical AND —
   this is NOT short-circuiting.** Every field pair is compared, in
   declaration order, and the struct-level result is the logical AND
   of all per-field results.
   **Correction record (§2.4.2 amendment — Documentation/Contract-only
   change, zero code, zero semantics change to points 1 or 3 above):**
   this point previously claimed the comparison "short-circuits on the
   first unequal field... matches `&&`'s existing short-circuit
   behavior elsewhere in UR." **That claim was investigated directly
   (Gate V1-SHORT-CIRCUIT-DECISION) and found to be factually
   incorrect, both historically and as currently implemented — not a
   regression, a wording error present since this section's own
   original ratification.** Direct evidence: `&&`/`||` in UR use
   **eager evaluation** — both operands are always evaluated,
   unconditionally — confirmed by live-tested execution with an
   observable side effect (`issues/eager-evaluation-and-or.md`,
   status: "DOCUMENTED — a real, current, consistent language design
   choice, not a bug"), and independently corroborated by two earlier
   project records (`LEVEL_3_1A_CLOSURE_REVIEW.md` and `CHANGELOG.md`)
   both stating short-circuit evaluation was "Not supported /
   Deferred" at an earlier phase and was never subsequently
   implemented. Separately, the current compiler has no expression-
   level conditional-branching Lowering capability at all for any
   construct (confirmed: `ConditionalExpression`/ternary itself has no
   Lowering implementation) — building one solely to give struct
   equality a short-circuit property neither `&&` nor `||` themselves
   possess would be an unjustified, unrequested architectural
   expansion. Struct equality's own field-comparison behavior is
   therefore defined to match UR's own actual, documented, eager
   evaluation model — full evaluation of every field, combined with
   logical AND — not the short-circuiting behavior this section
   previously, incorrectly assumed `&&` already had.
3. **String fields are compared by content, never by pointer identity.**
   A `string` field is a `const char*` at the C Backend level (per
   `BACKEND_SPEC.md` §2's existing type mapping) — comparing two
   `string`-typed struct fields with `==` must compare their *contents*
   (equivalent to C's `strcmp(...) == 0`), never the raw pointer values.
   Two structs holding separately-allocated strings with identical
   content must compare equal. This is a real, easy-to-get-wrong pitfall
   in a naive Backend implementation (a naive `a.field == b.field` on
   two `const char*` values would compare pointers in C) — explicitly
   called out here so Level 2.8's implementation does not silently ship
   pointer comparison for string fields.

### 2.5 Parameter passing: BY VALUE

A struct parameter is passed by value (a full copy), consistent with
§2.3 and with `FUNCTIONS_ABI_SPEC.md` §2.1's existing, frozen default.
No new parameter-passing mode is introduced for structs.

### 2.6 Nesting: DEFERRED (no nested structs, no array/struct fields)

Level 2.8 structs contain **only primitive scalar fields** (`int`,
`float`, `bool`, `string`) — no struct-typed fields, no array-typed
fields. This keeps memory layout trivial: a struct is a flat, fixed
sequence of C-typed fields, mapping directly to a C `struct` with the
same field order (no padding/alignment surprises to design around yet).
Nested aggregates are deferred to a future phase, once the flat case is
implemented, tested, and frozen.

---

### 2.7 Struct Construction (found missing during this review's Semantic-layer preparation — resolved here, not deferred)

**Gap found:** this document specified struct *declaration* (§2.1),
*field access* (§2.2), *copy* (§2.3), *comparison* (§2.4), *parameter
passing* (§2.5), and *nesting boundaries* (§2.6) — but never specified
how a UR program actually **constructs** a struct value in the first
place. Without this, Semantic Analyzer cannot resolve anything
struct-related. This is a language-*syntax* question, squarely in this
document's scope (not an IR-mechanics question, which correctly remains
deferred to `AGGREGATES_SPEC.md` per §4 below).

**Decision: positional constructor call syntax.**

```
struct Point
    x: int
    y: int
end

let p = Point(1, 2)   // x=1, y=2, in field declaration order
```

**Reasoning:**

- Reuses the **existing** `CallExpression` grammar (already fully
  parseable — a struct name followed by `(args)` is syntactically
  indistinguishable from an ordinary function call) — **zero new
  tokens, zero new grammar productions.**
- Resolution happens the same way `print`/`input`/`free` already resolve
  specially (Level 2.5's Builtins Registry pattern): Semantic Analyzer
  checks the Symbol Table first (ordinary functions), then a **Struct
  Registry** (new, this phase) for a struct sharing the callee's name,
  before falling through to `SE1002` undefined-function. A user-defined
  function with the same name as a struct takes precedence, mirroring
  the exact precedence rule already established for builtins.
- Arguments are positional, matched to fields **in declaration order**
  (the same order §2.4's structural comparison already uses) — argument
  count must exactly match field count (an arity-style check, reusing
  the same `SE3001`-style diagnostic shape already used for function-call
  arity mismatches).

**Rule 1 — strict arity: argument count must exactly equal field count.**

```
struct Point
    x: int
    y: int
end

Point(1)       // REJECTED — 1 argument, but Point has 2 fields
Point(1, 2)    // OK — x=1, y=2
Point(1, 2, 3) // REJECTED — 3 arguments, but Point has 2 fields
```

Both too few and too many arguments are rejected, with no default-value
mechanism and no partial construction — Level 2.8 has no concept of
either.

**Rule 2 — positional binding is by field DECLARATION ORDER, never by
argument names (there are no argument names in this phase).**

```
struct Point
    x: int
    y: int
end

Point(10, 20)   // x=10, y=20 — position 1 -> field 1 (x), position 2 -> field 2 (y)
```

The binding is purely positional and purely based on the order fields
were declared in the `struct` block — there is no field-name matching
of any kind in Level 2.8's construction syntax.

**Explicitly rejected for this phase (not merely unimplemented —
deliberately out of scope):**

- Named-argument construction (`Point(x: 1, y: 2)` or `Point(x=1, y=2)`)
  — no argument-name-to-field-name matching exists in Level 2.8.
- Brace/named-field-literal construction (`Point { x: 1, y: 2 }`) — no
  such syntax exists; `{`/`}` remain untokenized (§2.7's original
  rejection reasoning above still applies).

Either could be added **additively** in a future phase without breaking
Rule 1/Rule 2's positional contract for existing code — this is
recorded as a possible future enhancement, not a promise.

**Rejected alternative:** named-field literal syntax (`Point { x: 1, y:
2 }`) — rejected because `{`/`}` are **not currently tokenized at all**
by the Lexer (confirmed by direct inspection — no `LBRACE`/`RBRACE`
token kind exists), making this a strictly larger, riskier Lexer+Grammar
change than reusing the already-fully-working `CallExpression` shape.
Named-field construction remains available as a future enhancement once
there is a concrete need for it (e.g. structs with many fields, where
positional-only construction becomes error-prone) — this decision does
not preclude adding it later, additively.

### 2.8 Forward Struct Reference: ALLOWED (matches the existing function forward-reference rule)

**Confirmed decision (per explicit review request — this must be
documented, not left implicit):** a struct may be **constructed before
its own declaration appears in the source file**, exactly matching the
forward-reference rule UR 1.0 already applies to functions
(`FUNCTIONS_ABI_SPEC.md` §3.1).

```
function f()
    let p = Point(1, 2)   // used here...
end

struct Point                // ...declared later in the same file — ALLOWED
    x: int
    y: int
end
```

**Mechanism:** Semantic Analyzer's existing two-pass structure already
provides this for free — Pass 1 ("hoisting") registers every struct
declaration in the Struct Registry (§2.7) **before** Pass 2 walks any
function body, exactly the same two-pass shape already used for
function forward-references. This required no new mechanism — it is a
direct, deliberate consequence of registering structs during the same
hoisting pass functions already use, not a coincidence to be revisited
later.

**Verified directly:** a program constructing `Point(1, 2)` textually
before `struct Point ... end` produces zero Semantic diagnostics.

---

## 3. Summary Table

| Question | Decision | Deferred alternative |
|---|---|---|
| Array literal | `[1, 2, 3]` | — |
| Array type annotation | `int[]` (bracket-suffix) | `Array<int>` (rejected: `<`/`>` parsing ambiguity) |
| Multi-dimensional arrays | Supported | `int[][]` — see §1.3, corrected under V1.0-DOC-DRIFT-MULTIARRAY-003 |
| Array size | Fixed at creation | Dynamic/growable — later Collections phase |
| Array bounds checking | Yes, via `ur_panic` | — |
| Array memory | Stack (Local Slot, extended) | Heap-allocated — later phase |
| Struct declaration | `struct Name ... end` | `type Name ...` (rejected: keyword collision with future type-alias feature) |
| Struct field access | `p.x` (reuses `MemberExpression`) | `p->x` (rejected: no pointer-to-struct concept exists) |
| Struct assignment | Value copy | Reference/alias — deferred with the memory model |
| Struct comparison | Structural (per-field) | Reference identity — not applicable given value semantics |
| Struct parameter passing | By value | By reference — deferred |
| Struct nesting | Deferred (flat fields only) | Nested structs / array fields — later phase |
| Struct construction | `Point(1, 2)` (positional call) | `Point { x: 1, y: 2 }` (rejected: `{`/`}` untokenized) |
| Struct construction arity | Must exactly equal field count | Default values / partial construction — not in Level 2.8 |
| Struct construction argument order | Field declaration order (positional only) | Named arguments (`Point(x: 1, y: 2)`) — deferred, additive if ever added |
| Forward struct reference | Allowed (matches function forward-reference) | — |

---

## 4. What This Document Does NOT Decide

- The exact `IRType`/`IRInstruction` additions needed to implement
  struct construction, element access, and field access — that is
  Level 2.8's own design document (`AGGREGATES_SPEC.md`, informed by
  this one), not this one. §2.7 above resolves the *syntax*; the IR
  representation of "call `Point(1, 2)`, get a struct value" remains
  open.
- Any Runtime Core changes — bounds-check panics reuse the existing
  `ur_panic`; no new Runtime function is anticipated by this document,
  but Level 2.8's own spec should confirm this once IR-level design
  begins.
- The Optimizer's handling of array/struct aliasing — explicitly the
  reason this phase exists *before* the Optimizer (Level 2.9), per the
  approved roadmap.

---

## 5. Compatibility

This specification assumes, and is written against, the frozen state at:

- `v27-level2-6-control-flow` (Local Slot model, §1.6 extends it)
- `v27-level2-7-functions-abi` (§2.3/§2.5 extend its by-value default)
- Level 1's frozen Lexer token set (`LBRACKET`/`RBRACKET`/`LT`/`GT` all
  already exist; this document proposes using existing tokens in new
  grammar positions, not adding new token kinds)

If any of these change, this document should be re-reviewed.
