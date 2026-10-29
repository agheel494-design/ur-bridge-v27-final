# Stage 3 — WASM RCA Validation: Final Report

**Zero code changes made during this stage. All evidence below is
either directly reproducible from the unmodified repository, or was
captured via a temporary instrumented copy that was built and run
outside the repository (staged briefly inside it only to resolve
module paths, then deleted immediately — confirmed absent, `tsc
--noEmit` clean after removal).**

---

## Minimal Reproducer

```
function main(): int
  let a = 0
  let b = 1
  let i = 0
  while i < 2
    let temp = a + b
    a = b
    b = temp
    i = i + 1
  end
  return a
end
```

- **C Backend: `1`** (correct).
- **WASM Backend: `2`** (incorrect).

## Layer-by-Layer Verification

### Layer 1 — IR (Lowering)

Full IR dumped and hand-traced instruction-by-instruction (already
shared in full, verbatim JSON, in this investigation). Hand-trace
result: `1`, matching the C Backend. **IR is correct.**

### Layer 2 — WASM Code Generator

Direct execution trace of `encodeExpr`/`encodeStatements` (from
`src/backend/wasm/emit-wasm.ts`, unmodified source, lines 1336-1456
already shared verbatim with line numbers) for the minimal reproducer:

```
STORE slot0
value=id9
  -> calling encodeExpr(id9)
    encodeExpr(id9) ENTRY
  <- encodeExpr(id9) returned 2 bytes: [20 01]
  (total times id9 has been passed to encodeExpr so far: 1)
STORE slot1
value=id8
  -> calling encodeExpr(id8)
    encodeExpr(id8) ENTRY
    encodeExpr(id6) ENTRY
    encodeExpr(id7) ENTRY
  <- encodeExpr(id8) returned 5 bytes: [20 00 20 01 7c]
  (total times id8 has been passed to encodeExpr so far: 1)
```

`id6` (originally `load slot0`, i.e. the value of `a` at `temp`'s
true definition point) is called via `encodeExpr` exactly once, at
the point `store slot1, id8` is being encoded — which the trace shows
occurs immediately after `id9`'s own store (`STORE slot0`) already
emitted its `local.set`. There is no cache lookup, no memoization —
`encodeExpr(id6)` performs a fresh `local.get` emission at this later
position.

### Layer 3 — Binary

```
WebAssembly.validate(bytes) → true
```

The emitted module is well-formed, spec-valid WASM. **The binary
encoding itself is not malformed** — the bug is in which instructions
get chosen/ordered, not in how they are serialized.

Actual bytes for the two relevant statements, extracted directly from
the real code section:
```
'a = b'    (STORE slot0 = id9):  20 01 21 00   (local.get 1 ; local.set 0)
'b = temp' (STORE slot1 = id8):  20 00 20 01 7c 21 01   (local.get 0 ; local.get 1 ; i64.add ; local.set 1)
```

`local.get 0` (reading local #0, i.e. `a`) appears in the byte stream
for `b = temp` — positioned AFTER `local.set 0` already executed as
part of the immediately preceding `a = b` statement.

### Layer 4 — Runtime

```
WebAssembly.instantiate(bytes) → executed via standard V8/Node WASM engine
result: 2
```

The standard runtime executes the given (valid, but semantically
incorrect) bytecode deterministically and exactly as written.
**The runtime is not at fault** — it correctly runs what the bytecode
literally specifies.

## Verdict

# ✅ Confirmed

**The root cause is in the WASM Code Generator
(`src/backend/wasm/emit-wasm.ts`), specifically `encodeExpr()`'s
lazy, non-memoized re-evaluation of SSA values inside
`encodeStatements()`'s handling of the `store` instruction (lines
1419-1427).**

This verdict is supported by direct evidence at every layer:
- IR: proven correct by hand-trace.
- Codegen: proven via a live execution trace showing `encodeExpr(id8)`
  (and its recursive sub-calls `encodeExpr(id6)`/`encodeExpr(id7)`)
  fire exactly once, at the SECOND store's encoding position — after
  the FIRST store already mutated the WASM local that `id6`'s formula
  depends on.
- Binary: proven well-formed (`WebAssembly.validate` = true) — ruling
  out a serialization-level defect.
- Runtime: proven to execute deterministically and correctly per the
  given bytecode — ruling out an interpretation-level defect.

No layer other than WASM Code Generator shows any defect. No
alternative hypothesis (register allocation, local index mapping,
stack ordering, encoding bug, runtime ABI) is supported by any
evidence gathered — `encodeExpr`/`encodeStatements` do not perform
register allocation or stack-ordering logic separate from the direct,
sequential byte-emission shown above; there is no local-index-mapping
step distinct from what's already shown (the `localIndexBySlotId` map
is fixed and correct — `id6`'s `load slot0` maps to local #0
consistently at every call, confirmed by the identical `20 00` bytes
appearing wherever `slot0` is read).

## What Remains Undetermined (explicitly, not glossed over)

This verdict identifies the defective mechanism (lazy re-evaluation)
and its exact location (the `store` instruction path in
`encodeStatements`, calling into `encodeExpr`'s recursive,
non-memoized formula expansion). It does NOT yet determine the exact
fix implementation — that is Stage 4's own task, not part of this
validation.
