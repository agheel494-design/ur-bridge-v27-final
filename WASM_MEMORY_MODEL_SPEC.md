# WASM Memory Model — Specification (Level 3.1B — IMPLEMENTED, RC2)

**Status: IMPLEMENTED AND TESTED (corrected from a stale "DESIGN ONLY"
header — this document originated as a pre-implementation design
proposal for 3.1B.1, per explicit review instruction ("لا تبدأوا
التنفيذ بعد"), but every section below now describes RATIFIED,
SHIPPED, TESTED behavior through 3.1B.5 and the RC2 critical fix — not
a pending proposal.** The original design-first discipline this
document records (CFG/design first, direct hand-built-module
verification second, spec third, code fourth) is preserved as the
historical record of HOW each piece was built, not as a claim that the
building has not yet happened.

**Scope of this document**: the Memory Model only — how memory is laid
out, how arrays are represented, how allocation works, how addresses
are computed. It does NOT cover bounds checking (3.1B.2), dynamic
indices (3.1B.3, though see §4's note on why this is mostly free), or
arrays inside `if`/`while` (3.1B.4). Those remain separately reviewed
follow-ups.

---

## 1. Memory Layout

A single WASM linear memory, declared with a minimum of 1 page (64KiB)
— matching what every array in this narrow phase will need, since
without dynamic growth (deferred) or large arrays (not yet exercised),
64KiB is far more than sufficient, and growing it later (via WASM's own
`memory.grow`) is a non-breaking addition if ever needed.

```
Address 0x0000 ────────────────────────────────────────
              │  RESERVED (8 bytes) — address 0 deliberately
              │  never allocated to any array, so a null/
              │  uninitialized address (0) can never alias a
              │  real array's header — a cheap, free safety
              │  margin, not a feature being built yet.
Address 0x0008 ────────────────────────────────────────
              │  Heap region — bump-allocated, growing upward.
              │  Every array's header + data lives here,
              │  contiguously, in allocation order.
              ▼
```

**The bump pointer** is stored in a single WASM **Global**
(`(global $bump (mut i32) (i32.const 8))`) — confirmed viable by direct
hand-built-module testing (§7) before this document was written, not
assumed. This is the ONE piece of mutable state shared across the
whole module for this phase — every array allocation reads it, uses it
as that array's base address, then advances it by that array's total
size.

## 2. Array Header

Every array is laid out as one contiguous region:

```
┌─────────────────┬──────────────┬──────────────┬─────┬──────────────┐
│ length (i64,     │ element[0]   │ element[1]   │ ... │ element[N-1] │
│ 8 bytes)         │ (i64, 8 bytes│ (i64, 8 bytes│     │ (i64, 8 bytes│
└─────────────────┴──────────────┴──────────────┴─────┴──────────────┘
  offset +0          offset +8      offset +16          offset +8+8*(N-1)
```

- **`length` is stored, even though this phase does not yet check it**
  (bounds checking is 3.1B.2) — because storing it now, at allocation
  time, costs nothing extra (the value is already known statically at
  compile time for every array this phase can construct) and avoids a
  breaking layout change when 3.1B.2 adds the check that reads it.
- **All fields are `i64` (8 bytes), matching every existing convention
  in this Backend** (§0's Feature Matrix — `i64` is the only integer
  width supported anywhere in 3.1A/3.1B so far). No packing, no mixed
  widths, no alignment surprises.
- **8-byte alignment throughout** — every field's offset is a multiple
  of 8. WASM's `i64.load`/`i64.store` do not strictly require aligned
  offsets to be correct (unlike some native ISAs, unaligned access is
  legal per the WASM spec, just potentially slower on some engines) —
  this project chooses alignment anyway, for simplicity and to avoid
  ever having to reason about unaligned access, not because WASM
  demands it.
- **Total size of an array with `N` elements**: `8 + 8*N` bytes (header
  + data). This is exactly what the bump allocator advances by (§3).

**The array's own "address" (as referenced everywhere else in this
design) is the address of its `length` field — i.e., the very first
byte of this whole region.** Reading an element or the length is
always relative to this one address.

## 3. Allocation Strategy: Simple Bump Allocator

**Confirmed viable by direct hand-built-module testing (§7) before
this document was written**: a WASM Global holds the "next free
address." Allocating an array of `N` elements:

```
arrBase = global.get $bump
global.set $bump (i32.add (global.get $bump) (i32.const (8 + 8*N)))
```

Then the array's header/data is written starting at `arrBase`, exactly
as laid out in §2.

**What this deliberately does NOT do (explicitly out of scope for
3.1B.1, not silently assumed away)**:

- **No `free`/deallocation of any kind.** Memory only ever grows for
  the lifetime of the module instance. For this phase's actual test
  programs (single function calls, no loops allocating arrays
  repeatedly — arrays inside `while` are 3.1B.4, not yet in scope),
  this is not yet a practical problem; it is recorded here as
  technical debt this design does not solve, not hidden.
- **No resizing.** An array's size is fixed at allocation and never
  changes.
- **No garbage collection.** Not attempted, not designed around, not
  a goal of this phase.
- **No thread-safety/concurrency concern.** WASM (as used here, no
  threads proposal) is single-threaded; irrelevant for this phase.

## 4. Address Calculation (the one formula everything else builds on)

> **`elementAddress = arrayBase + 8 + index * 8`**
>
> (`arrayBase` = the array's own address, per §2; `+8` skips the
> `length` header field; `index * 8` because each element is 8 bytes.)

**SINGLE-FORMULA COMMITMENT (ratified, per explicit review — a standing
design rule, not a suggestion): this is the ONLY address formula that
exists anywhere in this Backend, for every array access, every
sub-phase (3.1B.1 through 3.1B.4 and beyond), regardless of whether the
index is a literal or a computed expression, and regardless of which
CFG shape (straight-line, `if`, `while`) surrounds the access. If a
second, different address formula is ever proposed anywhere in this
codebase, that is itself a design deviation requiring its own explicit
review before being written — never introduced silently as a "special
case."**

**This formula is identical whether `index` is a compile-time constant
or a runtime-computed value** — per explicit review's own correct
observation, there is no architectural difference between `arr[1]` and
`arr[i]`; the WASM instruction sequence to compute this address is:

```wat
(i32.add
  (i32.add (local.get $arrBase) (i32.const 8))
  (i32.mul (<lower index, either a const or any i64 expr>) (i64.const 8)))
```

with the final `i32.add`'s result truncated/wrapped from `i64` to
`i32` for use as a memory address (WASM's `i32.load`/`i32.store`
family require `i32` addresses even when the loaded/stored VALUE is
`i64` — an `i32.wrap_i64` is needed on the computed offset before the
final address addition, or the arithmetic can be kept in `i32`
throughout for the address computation specifically, converting the
index to `i32` early). **This detail — exactly where the `i64`→`i32`
narrowing happens in the address arithmetic — is deferred to 3.1B.1's
own implementation-level review, not resolved here; this document
fixes the formula, not its exact instruction-by-instruction encoding.**

**This is why "constant index" was correctly rejected as its own
architectural phase (per review) — 3.1B.3 ("Dynamic Index") is really
just "3.1B.1's formula, fed a non-constant `index` operand" — no new
address-calculation design is needed for it. What 3.1B.3 actually adds,
if anything, is verifying the Expression Tree Property (§2.1, already
established) correctly extends to `index` being an arbitrary expression
rather than only a literal.**

## 5. IR-Side Clarification (important: no new shared IR instruction proposed)

The existing, frozen IR (confirmed by direct inspection, not assumed)
already represents array construction as a sequence of `array_store`
instructions to a pre-declared `IRLocalSlot` carrying a `.length`
property, and element reads as `array_load` instructions referencing
the same slot:

```
slot 0 (arr, length=3)
array_store slot=0 index={const 0} value={const 10}
array_store slot=0 index={const 1} value={const 20}
array_store slot=0 index={const 2} value={const 30}
array_load  slot=0 index={const 1}   -> id 7
```

**There is no `array_new` instruction in the shared IR, and this
document does NOT propose adding one.** "Array allocation," from this
Backend's perspective, is a WASM-Backend-internal concept only: **the
FIRST `array_store` targeting a given slot is where this Backend emits
the bump-allocation sequence (§3) for that slot**; every subsequent
`array_store`/`array_load` targeting the same slot reuses the address
already computed and held (in a WASM local, one per array slot, mirror-
ing exactly how scalar locals already work in 3.1A.5). This is a
Backend-side lowering decision, not a change to the frozen IR — matching
this project's standing policy (IR frozen unless a documented reason
exists) exactly as it applied throughout Level 2's `RUNTIME_SPEC.md`/
`FUNCTIONS_ABI_SPEC.md` work.

**Array ownership/lifetime** (per review's explicit question): given
§3's bump allocator never frees anything, every array's lifetime is
simply "for the remaining duration of the module instance" — there is
no ownership model to design yet, because nothing is ever reclaimed.
This is recorded as a direct consequence of §3's scope, not a separate
design decision.

## 6. WASM Mapping Summary

| Concept | WASM construct |
|---|---|
| Linear memory | `(memory 1)` — 1 page minimum |
| Bump pointer | `(global $bump (mut i32) (i32.const 8))` |
| Array base address (per slot) | A WASM local (`i32`), set once at first `array_store`, read thereafter — one per array-typed slot |
| `length` header field | `i64.store`/`i64.load` at the array's base address (offset +0) |
| Element access | `i64.store`/`i64.load` at `base + 8 + index*8` (offset computed per §4) |

## 7. Verification Performed Before This Document Was Written

Two hand-built WASM modules were constructed and directly tested,
matching this project's standing discipline (never assume a primitive
works — verify it):

1. **Core memory primitive**: a `(memory 1)` section with direct
   `i64.store`/`i64.load` at fixed, hand-computed addresses (`0`, `8`,
   `16`) — storing `10, 20, 30` and reading back address `8` — executed
   correctly, returning `20` (`arr[1]`).
2. **Bump allocator via WASM Global**: a `(global $bump (mut i32)
   (i32.const 8))`, read into a local as an array's base address, then
   advanced by that array's total size (`32` bytes for 3 `i64`
   elements + header) — the SAME array-construction-and-read pattern,
   this time via the allocator rather than hand-picked addresses —
   executed correctly, again returning `20`.

**A real, instructive bug was found and fixed during this second
test**: the WASM Global's initializer expression is itself a tiny
constant-expression program (`i32.const 8`, then `end`) — the first
attempt omitted the `i32.const` opcode itself, leaving only the raw
LEB128-encoded value `8`, which the WASM validator correctly rejected
(`"opcode throw is not allowed in constant expressions"` — the raw
byte `8` was being mis-parsed as a different, invalid opcode). Fixed by
including the `i32.const` (`0x41`) opcode explicitly before the value.
Recorded here as a reminder that **every constant expression in WASM
(global initializers, offset expressions) needs its own real opcode,
not just the encoded value** — a distinct, additional lesson from the
LEB128-signedness bug already recorded in `WASM_BACKEND_SPEC.md` §7.

## 8. Invariants (proposed, for ratification alongside this document)

> **ELEMENT_SIZE_IMMUTABLE_CONTRACT (ratified, per explicit review):
> the current element size is `8` bytes (`i64`, the only element type
> this phase supports). This value MUST NOT vary anywhere in 3.1B's
> code — it exists as exactly one named constant (`ELEMENT_SIZE`),
> never a literal `8` scattered through the implementation. When other
> element types (`i32`, `f64`, structs) are supported in a future
> phase, the design must extend (e.g., a per-array element-size field,
> or a per-type constant) without breaking this phase's existing
> `i64`-only layout — never by silently redefining `ELEMENT_SIZE`
> itself to mean something else.**

> **Invariant 3.1B.1-Memory-Layout**: every array's `length` field and
> all `N` elements are stored contiguously, 8-byte-aligned, starting at
> that array's own base address, with `length` at offset `+0` and
> element `i` at offset `+8+8*i`. No other memory layout is ever
> produced by this Backend.

> **Invariant 3.1B.1-Allocation**: exactly one WASM Global (`$bump`)
> exists per module, initialized to `8`, monotonically increasing,
> never decremented, never reset. Every array-typed slot's base address
> is computed exactly once (at that slot's first `array_store`) and
> reused for every subsequent access to that slot within the same
> function. Two different array slots (even of the same declared
> length) never share a base address.

> **MEMORY_LAYOUT_IMMUTABLE_CONTRACT (ratified, per explicit review —
> a PERMANENT commitment, not scoped to 3.1B.1 alone): once §2's Array
> Header layout is ratified by this document, it MUST NOT change
> anywhere in 3.1B or 3.2 — not the field order (`length` at `+0`,
> elements starting at `+8`), not the field width (`i64`, 8 bytes
> throughout), not the alignment (8-byte). Changing this layout later
> would silently break every array any earlier sub-phase's tests or
> Golden Tests already committed to memory, since nothing in this
> design versions the layout or tags data with a format identifier.
> If a genuine future need to change the layout ever arises (e.g., a
> future variable-width element type), that is a NEW, explicitly
> versioned layout decision requiring its own full design review — not
> an in-place edit to this one. This Invariant exists specifically to
> make any accidental layout drift (e.g., someone "optimizing" the
> header to save 4 bytes) a caught violation, not a silent, breaking
> change discovered only when old Golden Tests start failing for a
> confusing reason.**

> **ELEMENT_SIZE_IMMUTABLE_CONTRACT (ratified, per explicit review):
> the current element size (`8` bytes, `i64`-only) MUST be represented
> by exactly ONE named constant (`ELEMENT_SIZE`) in the implementation
> — never a literal `8` written independently at more than one call
> site. Likewise, the header size (`8` bytes, the `length` field) MUST
> be represented by exactly ONE named constant (`ARRAY_HEADER_SIZE`).
> Both constants may change in VALUE with zero risk, exactly because
> every address computation derives from them rather than from
> hardcoded numbers — this is the entire point of naming them. When
> other element types are eventually supported, `ELEMENT_SIZE` becomes
> per-type, but the one-source-of-truth property itself must survive
> unchanged.**

## 9. Contracts Required (proposed, to be implemented as tests alongside 3.1B.1's code)

| Contract | What it must guard |
|---|---|
| `ARRAY_LAYOUT_CONTRACT` | Directly inspects emitted bytes/memory contents after real execution to confirm `length` and elements land at the exact offsets §2 specifies — not merely that reads/writes "work," but that the layout itself is exactly right. |
| `BUMP_MONOTONIC_CONTRACT` | Confirms the bump pointer only ever increases, and that two arrays declared in sequence receive non-overlapping address ranges (checked directly, e.g. by allocating two arrays and confirming the second's base equals the first's base plus the first's total size). |
| `BOUNDS_CHECK_REQUIRED_CONTRACT` (3.1B.2 — supersedes `NO_BOUNDS_CHECK_YET_CONTRACT`, per explicit review: "لا أنصح بحذفه، بل استبداله") | Confirms bounds checking is now a mandatory, always-applied part of every `array_load`/`array_store` — an in-bounds access proceeds normally; an out-of-bounds access (including negative indices) traps via `unreachable`, verified by real execution actually throwing (`WebAssembly.RuntimeError`), not merely by inspecting emitted bytes. **Historical note, preserved rather than deleted**: `NO_BOUNDS_CHECK_YET_CONTRACT` (3.1B.1) documented the *absence* of this check as a real, then-current gap; this contract documents its *presence* as a now-mandatory guarantee — the same underlying behavior, tracked across its two states, not two unrelated tests. |
| `MEMORY_LAYOUT_IMMUTABLE_CONTRACT` | **A permanent, cross-phase guard (not scoped to 3.1B.1 alone)** — asserts the exact byte offsets from §2 (`length` at `+0`, element `i` at `+8+8*i`, 8-byte fields throughout) directly against emitted memory contents. This test must never be updated to match a layout change; a failure here means the layout drifted, which is itself the bug to fix (revert), not the test. |
| `ELEMENT_SIZE_IMMUTABLE_CONTRACT` | **A permanent guard on the element width specifically**: asserts `ELEMENT_SIZE === 8` (i64-only, this phase) directly, and — more importantly — asserts that exactly ONE named constant (`ELEMENT_SIZE`) is what every address computation in the emitter derives from, never a literal `8` written independently at a second call site. When other element types (`i32`, `f64`, `struct`) are eventually supported, this constant becomes per-type rather than global, but the ONE-SOURCE-OF-TRUTH property this contract checks must survive that change unchanged. |

## 10. Golden Tests Required

At least two, matching every prior sub-phase's pattern: one array
construction + constant-index read (the exact `[10,20,30]`/`arr[1]`
example verified by hand in §7), and one with a *computed* (non-literal)
index expression as the array value being stored (e.g. `arr[0] = 2+3`)
to confirm the Expression Tree Property (§2.1) composes correctly with
`array_store`'s value operand — not merely with `index`.

## 10b. Bounds Checking Design (3.1B.2 — ratified, per review's two corrections)

**Confirmed by direct hand-built-module testing before implementation
began**: for a known array length `L` and an index expression, emit
`(if (i32.or (i64.lt_s index 0) (i64.ge_s index L)) (then
(unreachable)))` — no `else` needed (mirroring the exact `break`/
`continue` "if with only a `then`, no `else`" pattern already proven
in 3.1A.6b/3.1A.6c) — directly before the existing `array_load`/
`array_store` lowering. Verified directly: an in-bounds index proceeds
normally (returns the value); an out-of-bounds index (both a too-large
positive index and a negative index) traps with a real
`WebAssembly.RuntimeError`, confirmed by actual execution, not
inferred.

**Correction 1 (ratified, per review): compile-time length is THIS
PHASE's mechanism for obtaining the bound to check against — not a
permanent architectural commitment.** In 3.1B.2, the bound checked is
the array's length as already known at compile time (the same
`IRLocalSlot.length` value the C Backend itself already uses for its
own bounds check, per direct inspection during `issues/level-2.8-
single-element-array-c-backend-bug.md`'s investigation). If a future
phase ever needs the length to be read at runtime instead (e.g., if
arrays gain a length determined dynamically), that phase may change
*how* the bound value is obtained — **without changing
`array_load`/`array_store`'s own interface**, since bounds checking is
lowered as a fixed wrapper around those two instructions, not baked
into their definition.

**Correction 2 (ratified, per review): the correctness criterion is
NOT "WASM matches C's specific failure mechanism."** The correct
framing is:

```
UR language semantics
        |
        +-- independently implemented by --> C Backend
        |
        +-- independently implemented by --> WASM Backend
```

Both backends independently implement the same UR-level semantic
requirement ("an out-of-bounds array access is rejected, never
silently read/written") — confirmed by direct testing that BOTH
backends genuinely reject an out-of-bounds access (`WebAssembly.
RuntimeError` for WASM; a real process exit via `ur_panic`, `exitCode
101`, for C) — but the SPECIFIC mechanism each one uses (a WASM trap
vs. a native process exit) is a platform detail, not the thing being
verified. Prior phrasing ("both fail, therefore this is Backend
Correctness") is corrected: the actual criterion is that each backend
correctly enforces UR's own semantics on its own terms, and the two
happening to both "fail" for this program is a consequence of that,
not the definition of it.

## 10c. Dynamic Index (3.1B.3 — ratified: no new design needed, per §4's own prediction)

**Confirmed by direct testing before any code was written for this
sub-phase (in fact: confirmed that NO code changes were needed at
all)**: `arr[f()]` (an index sourced from a function call's return
value — genuinely unknowable at compile time, unlike `arr[i]` for a
simple local variable, which Lowering's own environment-rebinding
already resolves to a plain constant, per `IR_COPY_PRESENCE_AUDIT.md`'s
identical finding) compiles, validates, and executes correctly through
the EXISTING implementation, unmodified — because `array_load`/
`array_store`'s `index` operand was already lowered via the same
general `encodeExpr()` recursion used for every other expression
(`const`, `binop`, `call`, `load`), never specially restricted to
`const` only. §4's own prediction — "no difference in design between
`arr[1]` and `arr[i]`" — is confirmed to extend to `arr[f()]` as well.

**Also confirmed to compose correctly, unmodified**: bounds checking
(3.1B.2) traps correctly for an out-of-bounds *dynamic* index (`arr[f()]`
where `f()` returns `10` against a 3-element array) — the bounds-check
formula operates on whatever value the index expression produces,
regardless of how that value was computed. **And the Expression Tree
Property (§2.1) already rejects an index value that is reused
elsewhere** (e.g. `let i = 1+1; return arr[i] + i` — `i` used twice) via
the exact same general fan-out check every other expression is subject
to — no array-specific carve-out was ever needed.

**Expanded verification, per explicit review's methodological
correction**: a single `arr[f()]` example does not, by itself, prove
that EVERY expression shape composes through the same general path
without any array-index-specific logic. Confirmed directly, using
function-call-sourced operands specifically (never a plain variable
reference, which Lowering's own environment-rebinding resolves away to
nothing, per `IR_COPY_PRESENCE_AUDIT.md` — a real risk review correctly
flagged, since that would make the "dynamic" index secretly static
again): `arr[a + b]` (both operands call results), `arr[x * 2]` (a call
result combined with a literal), `arr[(a + b) * c]` (a deeper nested
tree), and `arr[g()]` where `g()` itself internally calls `f()` (the
closest expressible equivalent to `arr[g(f()))]` within this Backend's
current scope — calls-with-arguments, i.e. passing one call's result
INTO another call, remain out of scope per 3.1A.3's zero-argument-only
restriction, noted explicitly rather than silently substituted).
**Every one of these matched the C Backend exactly**, confirming the
dynamic-index behavior is a property emerging from the general design
(every expression kind composes through `encodeExpr()` uniformly), not
a feature that happened to work for one specific tested shape.

**Invariant 3.1B.3 (ratified) — a non-invariant, stated explicitly so
it is not mistaken for an oversight**: there is no new Invariant to add
for this sub-phase, because no new behavior was introduced — `array_load`/
`array_store`'s `index` operand was always a general expression, not a
constant-only field, since 3.1B.1. This sub-phase's contribution is
confirming and testing that fact explicitly (via `DYNAMIC_INDEX_CONTRACT`,
Golden Tests, and Backend Correctness comparisons), not implementing
anything new.

## 10d. Arrays Inside Control Flow — Constant Index Only (3.1B.4 — ratified scope, per review's concept-based re-scoping)

**Scoping principle (ratified, per explicit review correction): the
criterion for what belongs in this sub-phase is "does it introduce a
new Memory Model concept," not "which syntactic construct (`if` vs
`while`) the array access is nested inside."** An initial proposal to
split by syntax (`if`/`else` now, `while` deferred) was corrected: a
constant-index array access inside `while` reuses exactly the same
`array_load`/`array_store` lowering and the same While CFG shape
already frozen (3.1A.6) — it introduces nothing new, so there is no
principled reason to defer it while accepting the syntactically
different but conceptually identical `if`/`else` case.

**3.1B.4's actual scope**: array `array_load`/`array_store` with a
**constant index**, where the array itself is allocated OUTSIDE the
`if`/`else`/`while` construct (in `entry`), used INSIDE `then`/`else`/
`merge` (Invariant 3.1A.5's Merge shape) or `loop_body`/`loop_exit`
(Invariant 3.1A.6's plain-`while` shape) — reusing those exact,
already-ratified CFG shapes unmodified, only extending the block-level
instruction validation/encoding to also recognize array instructions
within them.

**Confirmed by direct testing before implementation began**: this
exposed a real, precise root cause — `validateMergeShape()`/
`validateWhileShape()` already compute `knownSlotIds` from ALL of
`fn.locals` (including array-typed ones), but `validateBlockInstructions()`
gates array-instruction support behind a SEPARATE `knownArraySlotIds`
parameter, which these two validators never populate — so
`allowArrayAccess` was always `false` inside them, even though the
single-block path already supports arrays correctly. The fix is
narrow: thread `knownArraySlotIds` (and, for encoding,
`arrayBaseLocalIndexBySlotId`/`bumpGlobalIndex`) through these two
validators/encoders exactly as the single-block path already does —
no new CFG recognition, no new address formula, no Memory Model change.

**Explicitly deferred, per review's concept-based criterion (NOT
merely "inside a loop")**:

- **3.1B.5 — Dynamic Index Inside a Loop**: `arr[i]` where `i` is the
  loop's own mutated variable (or any value that changes across
  iterations) genuinely combines three concerns at once (a
  loop-carried value, the bounds check re-evaluating each iteration
  against a value that could differ per-iteration, and the general
  Dynamic Index composition already proven in 3.1B.3) — deferred
  because THIS combination hasn't been directly tested, not because
  "it's inside a loop" per se.
- **3.1B.6 — Conditional Allocation**: an array declared (allocated)
  inside only ONE branch of an `if`/`else` (e.g., `if (...) { let arr
  = [...] ... }`) is a genuinely new question — does the array's base-
  address WASM local need any special handling if the OTHER branch
  never touches it? — deferred as its own sub-phase, not bundled here.

**Additional gaps found during independent code-level review (not
merely described — directly tested), recorded here for completeness**:
`array_load`/`array_store` are ALSO not yet supported inside the
return-only Diamond shape (Invariant 3.1A.4 — as opposed to the Merge
shape this batch extends), nor inside the `while`+`break`
(3.1A.6b)/`while`+`continue` (3.1A.6c) shapes. All three combinations
were confirmed to reject cleanly (a proper `WasmUnsupportedError`, not
a crash or silent bypass) via the existing generic fallback — they were
simply never explicitly tested or documented as deferred until this
review. Recorded here as open extension points for a future batch,
not assumed to be automatically included whenever Merge/While gain
array support.

**A real diagnostic-quality bug found and fixed during this same
review**: nested control flow (`if` inside `while`, `while` inside
`if`, etc.) with an array access also produces a 7-block CFG in simple
cases, and previously fell through to `validateWhileBreakShape()`'s
own error messages by default when `classifySevenBlockShape()`
returned `undefined` — producing a misleading "Invariant 3.1A.6b
violated" message for programs that have nothing to do with `break`.
Fixed: an unrecognized 7-block shape now produces its own clear,
correctly-attributed diagnostic.

## 10e. Dynamic Index Inside a Loop (3.1B.5 — ratified: minimal fix, one check removed)

**Per direct code review (not guessed), the exact and ONLY failure
point was identified**: a single validation check inside
`validateWhileShape()` (added during 3.1B.4, restricting array indices
in `loop_body` to literal constants) — never an encoding-side
limitation. `encodeExpr()` already handled a `load`-sourced index
generically since 3.1A.5 (Local Variables); array index encoding was
never restricted to any particular instruction kind.

**Confirmed by direct testing, before the fix was applied**: with that
one check temporarily disabled, all drawn cases (write with a dynamic
index; read with a dynamic index; both together; a computed expression
of the loop variable; an out-of-bounds dynamic index) executed
correctly and matched the C Backend exactly. Critically: **bounds
checking was directly confirmed to re-evaluate correctly on every
iteration** — a loop that writes `arr[i]` for `i` from `0` up to `5`
against a 3-element array correctly traps at the exact iteration `i`
becomes `3`, not before and not after.

**Minimal fix applied**: removed exactly that one check. No other
code changed — the Memory Layout, Address Formula, IR, IR-consuming
validators for other shapes (Merge, Diamond, `while`+`break`/`continue`),
and every existing Contract remain untouched. Confirmed directly that
everything explicitly out of scope for this phase remains correctly
rejected: conditional allocation, an array allocated repeatedly inside
a loop body, and all four nested-control-flow combinations.

**This is not a "worked by accident" finding** (unlike 3.1B.4's
conditional-allocation surprise, which was explicitly rejected despite
working) — supporting a dynamic index inside a loop body is precisely
this sub-phase's own stated goal, and the fix directly, intentionally
delivers exactly that, nothing more.


- The exact instruction sequence for the `i64`→`i32` address-narrowing
  step (§4) — an implementation-level decision for 3.1B.1's own code
  review.
- Bounds checking's exact trap mechanism (WASM `unreachable`, matching
  `WASM_BACKEND_SPEC.md` §3's original anticipation for 3.1B) — 3.1B.2.
- Whether arrays ever need to cross function-call boundaries (passed as
  arguments, returned) — function parameters/arguments remain entirely
  out of scope for all of 3.1A and this document; revisit only once
  that separate deferral (`LEVEL_3_1A_CLOSURE_REVIEW.md` §8) is lifted.
- Arrays inside `if`/`while` (3.1B.4) — this document's Memory Model
  itself does not change for that phase (the SAME bump allocator,
  header layout, and address formula apply), but the CFG-shape
  questions that phase raises (does allocation happen inside a
  conditionally-executed block? what if a branch never allocates?) are
  not addressed here.
