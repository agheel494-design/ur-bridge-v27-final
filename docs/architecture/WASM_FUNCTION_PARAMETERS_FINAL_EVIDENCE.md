# WASM_FUNCTION_PARAMETERS_FINAL_EVIDENCE.md

The three remaining approval gates, with direct evidence. No code.

---

## Gate 1: Deduplication - Full Pseudo-code

```
// Run once per module, before encodeTypeSection()/encodeFunctionSection().

function buildFunctionTypes(functions: IRFunction[]):
    typeKeyToIndex := new Map<string, number>()   // dedup key -> WASM type index
    typeEntries := []                              // ordered list of encoded funcType bytes
    functionTypeIndex := new Map<functionName, number>()  // per-function -> its type index

    for fn in functions:
        // The dedup key is a pure function of the SIGNATURE only -
        // never the function's own name/identity - so two functions
        // with genuinely identical signatures always produce the
        // identical key, by construction, not by luck.
        paramKindsKey := fn.params.map(p => p.type).join(",")   // e.g. "i64,i64" or "" for zero params
        returnKey := fn.returnType                               // e.g. "i64" or "void"
        key := paramKindsKey + "->" + returnKey

        if typeKeyToIndex.has(key):
            // REUSE: do not create a new Type Section entry.
            functionTypeIndex.set(fn.name, typeKeyToIndex.get(key))
        else:
            // NEW: this exact signature has not been seen yet in
            // this module - append one new entry, record its index.
            newIndex := typeEntries.length
            typeEntries.push(encodeFuncType(fn.params, fn.returnType))
            typeKeyToIndex.set(key, newIndex)
            functionTypeIndex.set(fn.name, newIndex)

    return { typeEntries, functionTypeIndex }


function encodeTypeSection(typeEntries):
    return SECTION_TYPE + withLength(encodeVector(typeEntries))
    // Real, direct consequence of Q1's own finding: encodeVector
    // already accepts any-length input - this is the SAME function
    // call shape as today, only fed a real, possibly-multi-entry
    // array instead of always a one-element array.

function encodeFunctionSection(functions, functionTypeIndex):
    indices := functions.map(fn => functionTypeIndex.get(fn.name))
    return SECTION_FUNCTION + withLength(encodeVector(indices.map(encodeULEB128)))
    // Each function's own entry is now its REAL type index (possibly
    // shared with other functions of the identical signature) -
    // replacing today's hardcoded index-0-for-everyone.
```

How duplicate creation is actually prevented: the Map<string,
number> lookup (typeKeyToIndex.has(key)) happens BEFORE any new
entry is ever pushed - a duplicate signature can structurally never
reach the typeEntries.push(...) line, not merely "is expected not
to" by convention. This mirrors struct-memory.ts's own
structDecls.has(layout.structName) dedup-check-before-push pattern
already used and already tested for struct type declarations.

## Gate 2: Modules/Imports Compatibility - Real, Direct Finding, Not Assumed

Direct finding, changes the shape of this answer: confirmed via
direct source inspection, this WASM Backend has NO WASM-level Import
Section at all today - none exists, none is planned as part of this
design. The comment this question's own premise likely refers to
(emit-wasm.ts's own header: "FORBIDDEN... Runtime imports") refers
to importing functions FROM THE HOST (e.g. a JavaScript-side print
implementation) - a WASM import section entry - which remains
explicitly out of scope, unaffected by this design either way.

UR-level module imports (import geo) are a completely separate
concept, already resolved BEFORE reaching the WASM Backend at all -
confirmed directly by this branch's own already-completed,
already-tested work: externalStructLayouts (built by ModuleRegistry,
in lower-to-ir.ts's own lowerToIR() call) is merged into ONE, single
IRModule per compiled UR file - the imported module's own struct
declarations become ordinary entries in the SAME module's
structLayouts map, with no cross-WASM-module boundary ever created.
This was already confirmed live, working, in Phase 1/2's own
imported-struct test - the WASM module emitted for main.ur already
contains the imported struct's own compiled behavior directly, with
zero WASM-level import mechanism involved.

Direct consequence for this design: because there is no Import
Section to interact with, Type/Function Section ordering has exactly
ONE real constraint to satisfy - the standard WASM module section
order (Type, then Import [empty/absent here], then Function, then...,
then Code) - which emitWasmModule's own existing section-concat
order already satisfies today (confirmed: encodeTypeSection() is
already emitted before encodeFunctionSection() in the current code,
unchanged by this design). No reordering is needed; this design adds
entries to two existing sections without touching their own relative
position.

## Gate 3: Test Plan - What Would Fail If the Implementation Is Wrong

Each test below targets a SPECIFIC, real risk this document or the
prior review's own risk table already identified:

1. Two functions, two different real signatures - asserts the Type
   Section has exactly 2 entries, and the Function Section correctly
   maps each to its own DIFFERENT index. Catches: a dedup key that
   accidentally collapses genuinely different signatures together.

2. Two functions, the SAME real signature - asserts the Type Section
   has exactly 1 entry (not 2), and BOTH functions' own Function
   Section entries reference that SAME index. Catches: dedup failing
   to reuse (bloating the Type Section).

3. Nested/chained calls (f calls g(1,2), which calls h(3)) - real
   WebAssembly execution, asserting the correct final numeric result.
   Catches: argument-pushing order errors that only manifest when one
   call's own arguments are themselves the result of another call.

4. A parameter used inside a while loop, across multiple iterations -
   per the Materialization risk flagged in the original design's own
   risk table - real execution, asserting the correct result
   specifically on iteration 2+, not just iteration 1.

5. A function with parameters AND its own local scalar AND its own
   local array - asserts each reads/writes the correct,
   independently-computed local index. Catches: the
   local-index-renumbering collision risk.

6. print (a Builtin) is still correctly rejected, with its own
   specific, correctly-scoped error message - not the generic
   "arguments not supported" message. Catches: the pre-existing
   TODO's own exact concern.

7. Regression: every existing, currently-passing zero-parameter WASM
   test still passes unchanged - the full existing 191+ WASM test
   suite (Phase 1/2's own struct tests included), re-run as-is.
   Catches: any change to encodeTypeSection's own single-entry
   output shape for a module that genuinely has only zero-parameter
   functions.

8. WebAssembly.instantiate() itself succeeds for a real, varied set
   of parameter/return-type combinations - per the original design's
   own risk table: a malformed Type/Function Section mismatch is
   expected to fail loudly at instantiation, and this test confirms
   that real safety net actually holds for this Backend's own real
   output.
