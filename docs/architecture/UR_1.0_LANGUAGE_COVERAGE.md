# UR_1.0_LANGUAGE_COVERAGE.md

No new language feature was added. No compiler file was modified.
Every row below is backed by a real, live test run captured in
run-logs-languages/, or by direct, deep source inspection across
Parser, AST, Semantic Analyzer, Type Checker, and IR/Codegen - not
shallow keyword search alone, per explicit direction.

---

## Methodology Note

An initial pass at this inventory used only grep on parser.ts and
concluded switch/try-catch/array did not exist at all. This was
corrected after a deeper check across the dedicated AST file
(ast.ts), the Semantic Analyzer, and the Type Checker - some of these
DO have real, complete node types and processing logic; the actual
gap for those is narrower (Parser-only) than the initial shallow
search suggested. Disclosed explicitly - a wrong initial conclusion,
corrected before being reported as final.

## Coverage Table

| Feature | Status | Evidence |
|---|---|---|
| FUNCTION keyword (all 10 languages) | Supported | Tested - tests/compiler/localization/comprehensive-reference-program.test.ts, 11/11, run-logs-languages/04-comprehensive-reference-program.log |
| LET keyword | Supported | Tested - same file/log |
| TYPE keyword (type alias) | Supported | Tested - same file/log |
| IMPORT keyword | Supported | Tested - reviewer-proofs.test.ts (Japanese program uses it), Parser-level; not exercised through TypeChecker/IR in the comprehensive program |
| RETURN keyword | Supported | Tested - same file/log |
| END keyword | Supported | Tested - same file/log |
| IF / ELSE | Supported | Tested - same file/log |
| WHILE | Supported | Tested - same file/log |
| FOR / IN (contextual) | Supported (Lexer/Parser/AST/Semantic/TypeChecker) - Not Supported at IR/Codegen | Tested up to TypeChecker: 0 errors. IR: direct, live failure - CG1001: "statement kind 'ForStatement' is not supported in this Level 2 phase ... no for/switch/try-catch" - this exact message is the IR's own stated scope boundary, not inferred |
| BREAK / CONTINUE | Supported | Tested - live run up to TypeChecker, 0 errors |
| TRUE / FALSE | Supported | Tested - comprehensive-reference-program.test.ts |
| NULL | Supported (Lexer/Parser/AST/Semantic) - Not Supported at IR/Codegen | Live failure - CG1001: "expression kind 'NullLiteral' is not supported in this Level 2 phase" |
| STRUCT (declaration) | Supported | Tested - Lexer/Parser/AST/Semantic all pass with 0 errors for a struct declaration alone |
| STRUCT (as a variable/parameter type) | Bug found, not fixed (out of scope) | Live failure at Type Checker: TY1001: "unknown type 'Point'" - the Type Checker does not recognize a struct-declared name as a valid type for a variable or parameter, regardless of syntax. A real defect, not a missing feature - the struct declaration itself is fully processed with zero errors; only using the resulting type fails. Not fixed, per explicit direction not to modify the compiler this session. |
| Recursion | Supported | Tested - factorial calling itself, through full pipeline including IR |
| Function calls | Supported | Tested - same file/log |
| Variables, arithmetic, comparison | Supported | Tested - same file/log |
| Array literal (non-nested) | Supported (real code paths found in lower-to-ir.ts, semantic/index.ts, typesystem/checker.ts) | Not directly exercised in the comprehensive reference program this session; [V1.0-DOC-DRIFT-MULTIARRAY-ARCH-001 correction]: this clause previously stated that a nested array literal is rejected at IR, citing a parser.ts comment that no longer exists in the current source. Current verified behavior accepts nested array literals through type checking and lowering, with execution verified on the Interpreter, C backend, and WASM backend. This is distinct from empty array literals (TY6002) and from arrays-of-structs, which remain separate capabilities with their own documented scope. |
| Existing data types (int, bool) | Supported | Tested - same file/log |
| enum | Planned, Not Implemented | Direct source evidence: parser.ts, addError("PE009", "enum declarations are not supported in UR 1.0. This feature is planned for a future version.", t) - an explicit, first-class rejection, not a silent gap |
| map (as a language type) | Planned, Not Implemented | Zero references found across Parser, AST, Semantic, Type Checker, or IR |
| generics | Planned, Not Implemented | Zero references found across all five layers, same method |
| switch | Planned, Not Implemented (Parser gap specifically - AST/Semantic/TypeChecker are ready) | SwitchStatement/SwitchCase ARE fully defined in ast.ts and have complete, real processing logic in both semantic/index.ts and typesystem/checker.ts - but the Parser has zero code path that ever constructs a SwitchStatement from any keyword or syntax |
| try/catch | Planned, Not Implemented (Parser gap specifically - AST/Semantic/TypeChecker are ready) | Same finding as switch: TryCatchStatement has complete AST + Semantic + TypeChecker logic, but zero Parser entry point |
| threads | Not Implemented | Zero references to any thread-related AST node, keyword, or concept anywhere |
| async | Not Implemented | The only "async"/"await" references anywhere in the compiler's own source are in code comments about the Parser's own internal modifier-handling logic, not a real UR language feature |
| Diagnostic message translation | Not Implemented (documented separately) | See docs/architecture/TEN_LANGUAGES_SCOPE.md - every diagnostic message is a hardcoded English string |

## Cross-Language Structural Equivalence - the Central Claim, Directly Tested

All 10 languages, using the SAME reference program (only genuinely
IR-supported features: TYPE, FUNCTION, IF/ELSE, RETURN, WHILE, LET,
TRUE/FALSE, recursion, function calls, arithmetic), produce:

- Zero Lexer errors (all 10)
- Zero Parser errors (all 10)
- Zero Semantic Analyzer errors (all 10)
- Zero Type Checker errors (all 10)
- Successful Canonical IR lowering (ir.ok === true, all 10)
- Byte-identical structural AST (after stripping only user-chosen
  identifier text; en is used as the baseline all 9 others are
  compared against)

No manual editing occurred between languages - the reference program
is generated programmatically from each language's own keyword table
(buildReferenceProgram() in the test file), then run through the
real, unmodified compiler pipeline.

Real, attached evidence: run-logs-languages/04-comprehensive-reference-program.log
- 11/11 tests passing (10 per-language + 1 cross-language structural
match), tests/compiler/localization/comprehensive-reference-program.test.ts.

## What This Document Does NOT Claim

- Bytecode/Backend-level (WASM, C) output equivalence across
  languages - not tested this session; the reference program stops
  at Canonical IR.
- Runtime execution output equivalence - this session verified
  compilation success (IR), not actual program execution/output
  comparison across languages. A real, disclosed gap.
- Full-language completeness - UR 1.0 itself does not yet support
  enum, map, generics, switch, try/catch, threads, or async, per the
  table above; this document proves the 10 languages are equivalent
  for what UR 1.0 DOES support, not for a hypothetical fuller
  language.
