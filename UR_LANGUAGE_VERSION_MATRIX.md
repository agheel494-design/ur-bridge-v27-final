# UR Language — Official Version Matrix

**Status: DESIGN DECISION DOCUMENT. Produced during UR Language
Freeze Week, per explicit instruction to halt all implementation
until this matrix and the accompanying Final Specification are
signed off. No code was touched to produce this document.**

**Every row's version assignment reflects the current, real state of
this codebase (per `SPEC_IMPLEMENTATION_MATRIX.md`'s direct
verification) plus a design decision for every item that isn't yet
implemented — assign it to 1.1 (do later, in-scope) or 2.0
(deliberately out of v1.x's own reach), never left unassigned.**

| Feature | 1.0 | 1.1 | 2.0 | Basis for This Assignment |
|---|---|---|---|---|
| Variables (`let`) | ✅ | | | Implemented, tested, shipped. |
| Functions (0-arg calls) | ✅ | | | Implemented, tested, shipped. |
| Functions (N-arg calls) | ⚠️ (C only, explicit types) | ✅ (WASM + inference) | | WASM support and unannotated-parameter inference are the two remaining gaps — both real, both scoped, neither architectural. |
| `if`/`else` (statement) | ✅ | | | Implemented, tested, shipped. |
| `while`/`break`/`continue` | ✅ | | | Implemented, tested, shipped. |
| Arrays | ✅ | | | Implemented, tested, shipped (3.1B.1-3.1B.5). |
| Structs | ✅ | | | Implemented, tested, shipped (LANGUAGE_SYNTAX_1_1_SPEC.md). |
| `type` alias declarations | ✅ | | | Implemented this cycle, tested. |
| `byte` (Tier 1) | ✅ | | | Implemented this cycle, tested. |
| Char literals | ✅ | | | Implemented this cycle, tested. |
| Tier 2 ABI types (`i8`...`f64`) | ✅ (FFI/ABI-only) | | | ADR-1: CLOSED. Already correctly implemented in `src/ffi/abi/` — not a general UR type, by design. |
| Named-type annotations (struct/alias names used as an explicit `: TypeName`) | ❌ | ✅ | | New issue found this cycle (`issues/named-type-annotations-not-resolved.md`) — real, scoped, not architectural. Moved to 1.1 explicitly rather than left an open gap in 1.0. |
| **`for`/`in` — array iteration** (`for x in arr`) | ✅ | | | **[V1.0-FOR-IN-CONTRACT-INCLUSION-GATE-012 correction]**: this row previously read "❌ / ✅ / —", combined with range iteration below. Confirmed directly, real, verified semantics (elements, nesting, scope, mutation, `return`, `break`, `continue`) identical on the Interpreter and C Backend, protected by conformance/012-019_forin_*. WASM currently rejects this (`WASM1002`, a general CFG-shape limitation, not `for`/`in`-specific) — WASM support is not required for this row's own v1.0 status. |
| **`for`/`in` — range iteration** (`for i in 1 to 5`) | ❌ | ✅ | | **Decision, unchanged: MOVED to 1.1.** Grammar exists (§5.8), Lowering doesn't — requires a genuinely new CFG shape, matching this project's own design-first discipline for every prior control-flow feature. Not implemented under freeze-week time pressure. Matches conformance/010_for_deferred_to_1_1. |
| **`if`-expression** | ❌ | ✅ | | **Decision this round: MOVED to 1.1.** Same reasoning as `for` — a new CFG shape (a conditional producing a value), not a small patch. |
| Unannotated-parameter/variable type inference (the `void` gap, Finding F4) | ❌ (requires explicit annotation) | ✅ | | Reclassified last cycle: a genuine bidirectional/contextual inference feature, not a bug fix. Assigned to 1.1 as real, scoped future work — not left permanently undecided. |
| `||`/`&&` (full pipeline) | ⚠️ (parses; not independently re-verified past that) | — | — | Not yet fully audited — carried forward as an open verification item, not a version decision (see `SPEC_IMPLEMENTATION_MATRIX.md` §6). |
| Generics / type parameters | ❌ | ❌ | ✅ | §11 already defers this explicitly; confirmed no code exists. Architectural — new type-parameter machinery throughout the pipeline. |
| Classes / Inheritance / Interfaces | ❌ | ❌ | ✅ | Confirmed absent from every UR-language-specific document (the only `class`/`inheritance` matches found anywhere are in unrelated C++ FFI binding tooling). Architectural. |
| Async / await | ❌ | ❌ | ✅ | §11 already defers this explicitly. Architectural — needs a runtime execution model UR doesn't have yet. |
| Pattern matching (`match`) | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| Closures | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| Error handling (`try`/`catch`) | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| Operator overloading | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| Macros | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| Tuples (multiple return values) | ❌ | ❌ | ✅ | §11 already defers this explicitly. |
| GC / `free` for arrays | ❌ | ❌ | ✅ (v29 per `UR_BRIDGE_V28_MASTER_ROADMAP.md`) | Already named in the v28 roadmap's own v29 definition — kept consistent, not reassigned here. |
| Dynamic array length | ❌ | ❌ | ✅ (v29 per `UR_BRIDGE_V28_MASTER_ROADMAP.md`) | Same as the GC/`free` row above — WASM's own bounds check still uses a compile-time-constant length, not a runtime header read. |
| Nested / multidimensional arrays (`int[][]`) | ✅ | | | **[V1.0-DOC-DRIFT-MULTIARRAY-003 correction]**: this row previously read "❌ / ❌ / ✅ (v29)", combined with the Dynamic array length row above. Confirmed directly: `UR_LANGUAGE_SPEC_1_0.md`'s own real §11 "deferred to 1.1" list does not exclude nested arrays; type-checking, Lowering, the Interpreter, the C backend, and the WASM backend all correctly support this today (the real, prior "v29" reference was this WASM backend's own internal milestone label for the engineering work, now completed — not a UR language version). |
| Struct-array interaction — construction (`[Pt(1), Pt(2)]`) | ✅ | | | **[GATE-022A correction]**: this row previously read a single, blanket "❌ / ❌ / ✅ (v29)" for all struct-array interaction. Confirmed directly (V1.0-WASM-STRUCT-ARRAY-ISOLATION-004): construction works today, all three backends. |
| Struct-array interaction — extraction/mutation/assignment (`let p = arr[0]`, element/whole-array reassignment) | ✅ (Interpreter/C) | | ❌ (WASM only) | Same correction. WASM specifically rejects this (`'store'` unsupported); Interpreter and C both work. Classified OUT OF CONTRACT for WASM (W-SIA-CD-001) — not required for v1.0's own WASM scope. |
| Struct-array interaction — `Array<Struct>` with mixed scalar/reference fields | ❌ | ❌ | ❌ | Same correction. A real, separate, already-frozen policy (`ARRAY_OF_STRUCT_LANGUAGE_CONTRACT.md`, Gate R1.5-CGEN-002) — deliberately rejected (`CG1002`), not an implementation gap. |
| Struct-array interaction — chained field access (`arr[0].x`) | ❌ | ❌ | ❌ | Same correction. A general Lowering limitation (`CG1001`), not WASM- or array-specific — also affects plain struct-in-struct access with no array involved. Classified a known, documented, non-blocking limitation (V1.0-CHAINED-FIELD-ACCESS-CONTRACT-DECISION-015) — contract status UNRESOLVED, not a v1.0 requirement. |
| **Full 64-bit integer literal precision** (any legal i64 value, not only those under `2^53-1`) | ⚠️ (safe subset only — literals beyond `2^53-1` rejected via `PE011`, never silently corrupted) | ✅ | | **Recorded engineering decision (Compiler & Runtime Stabilization phase)**: `IntLiteral.value` (ast.ts) is currently `number` (JS float64), exact only up to `2^53-1`. A real bug (silent corruption of legal, in-range i64 literals beyond that point — confirmed directly: `2^53+1` and a realistic nanosecond timestamp both silently corrupted to a different, wrong value) was found and fixed for v1.0 by REJECTING any literal beyond the safe range (`PE011`, `tests/compiler/frontend/integer-literal-precision.test.ts`) rather than silently continuing with a corrupted value — this closes the data-corruption risk but does not extend precision. The full fix — converting `IntLiteral.value` to `bigint` and threading exact 64-bit arithmetic through the TypeChecker's constant evaluation, the Optimizer's constant-folding pass, Lowering's `const` instruction construction, and the C Backend's literal emission — is explicitly assigned to v1.1, not attempted now: reviewed and deliberately deferred (a genuinely larger, multi-file change, weighed against v1.0's own release-timing priority) rather than left as an unexamined gap.

## What This Table Deliberately Does NOT Include

Backend-specific implementation gaps that are NOT language-design
questions (e.g., "WASM Backend doesn't support `%` yet") are tracked
in `WASM_BACKEND_GUIDE.md`/`KNOWN_LIMITATIONS.md`, not here — this
table is about what the LANGUAGE itself includes at each version, not
which Backend has caught up to which language feature yet.
