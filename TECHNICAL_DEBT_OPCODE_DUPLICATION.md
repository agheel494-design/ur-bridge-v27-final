# Technical Debt: Duplicated WASM Opcode Constants — RESOLVED

**Status: RESOLVED. Extracted into `src/backend/wasm/wasm-opcodes.ts`,
imported by both `emit-wasm.ts` and `array-memory.ts`. A later,
explicit engineering directive authorized this exact extraction
(superseding the earlier freeze-preparation-era decision to defer it,
documented below for historical context).**

## Confirmed Duplication (verified precisely, not estimated)

16 opcode constants are defined identically (same name, same value) in
both `src/backend/wasm/emit-wasm.ts` and
`src/backend/wasm/array-memory.ts`:

```
OPCODE_END = 0x0b            OPCODE_I64_GE_S = 0x59
OPCODE_GLOBAL_GET = 0x23     OPCODE_I64_LOAD = 0x29
OPCODE_GLOBAL_SET = 0x24     OPCODE_I64_LT_S = 0x53
OPCODE_I32_ADD = 0x6a        OPCODE_I64_STORE = 0x37
OPCODE_I32_CONST = 0x41      OPCODE_IF = 0x04
OPCODE_I32_MUL = 0x6c        OPCODE_LOCAL_SET = 0x21
OPCODE_I32_OR = 0x72         OPCODE_UNREACHABLE = 0x00
OPCODE_I32_WRAP_I64 = 0xa7
OPCODE_I64_CONST = 0x42
```

Verified programmatically: all 16 shared names have byte-identical
values in both files — a genuine, harmless duplication (never a
divergent/conflicting redefinition), confirmed directly rather than
assumed.

## Why Documentation, Not Extraction, During This Cycle

1. **Risk vs. benefit during a freeze-preparation window**: extraction
   into a shared file is mechanically simple, but it is still a code
   change touching two already-shipped, tested, and (pending only
   external verification) soon-to-be-frozen files. Every prior
   freeze-preparation directive across this project's history has
   drawn the same line: documentation is safe during this window, code
   changes — even low-risk ones — are deferred to their own reviewed
   batch, precisely to avoid introducing any last-minute regression
   risk into a baseline that is otherwise fully verified.
2. **Zero behavioral impact either way**: since the values are
   confirmed identical, extraction would be a pure refactor with no
   functional change — meaning documenting the duplication (rather
   than fixing it now) costs nothing in correctness, only in code
   cleanliness, which can wait for a dedicated, low-stakes batch.
3. **`array-memory.ts` was deliberately designed as a self-contained
   module** (per its own original design intent — isolating Memory
   Model concerns from the general WASM emitter) — some duplication is
   an accepted, if imperfect, trade-off for that isolation, not purely
   an oversight.

## Recommended Future Resolution (not started, not decided beyond this recommendation)

Extract the 16 shared constants into a new file (e.g.
`src/backend/wasm/wasm-opcodes.ts`), imported by both `emit-wasm.ts`
and `array-memory.ts`. This should be its own small, dedicated,
reviewed batch — with the full regression suite and Golden Tests
re-run before and after, per this project's own standing discipline
for any code change, however mechanical it appears.

## Scope

This item does not block the current Release-Candidate-Ready status,
does not affect any test result, and requires no action before the
pending external verification cycle completes.
