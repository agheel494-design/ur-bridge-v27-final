UR Language V1.0
Official Developer Guide and Documentation Map for UR V1.0

UR is a multilingual programming language with a compiler toolchain, interpreter-based CLI execution paths, separate C and WebAssembly backends, package-management support, and native interoperability facilities.

This document is the primary developer-facing guide to UR V1.0. It provides a clear entry point to the language, its implemented capabilities, its limitations, and the authoritative engineering documents behind those claims.

It does not replace the language specification, architectural decisions, implementation evidence, release evidence, or historical engineering records.

## 1. Documentation Authority
UR has accumulated specifications, architectural decisions, implementation reports, verification records, release-candidate reports, and historical engineering evidence during development.

Those documents are preserved.

For UR V1.0, use the following authority model.

### 1.1 Language semantics and grammar
UR_LANGUAGE_SPEC_1_0.md

Defines the base UR 1.0 language specification, including lexical rules, grammar, types, modules, AST structures, and diagnostics.

Use this document when determining how a UR language construct is defined.

### 1.2 Version assignment
UR_LANGUAGE_VERSION_MATRIX.md

The official feature-by-version matrix.

Use this document to determine whether a capability belongs to V1.0, V1.1, or later scope.

A feature being recognized by the lexer or parser does not, by itself, mean that the feature is supported end-to-end in V1.0.

### 1.3 Implementation evidence
SPEC_IMPLEMENTATION_MATRIX.md

Records implementation evidence at the source-file and function level.

Use this document when determining whether a language feature described by the specification is implemented by the compiler/toolchain.

### 1.4 Closed architectural decisions
Some V1.0 semantics are governed by later, focused Architectural Decision Records.

The current closed decisions include:

ADR_1_TIER2_TYPES_DECISION.md — Tier 2 / ABI-precise type scope.
ADR_2_NULL_LITERAL_DECISION.md — null recognition is retained, while full executable null semantics are outside the V1.0 execution contract.
ADR_3_LOGICAL_SHORT_CIRCUIT_DECISION.md — && and || use short-circuit evaluation.
When an applicable closed ADR contains a later, explicit decision about a specific issue, this guide follows that decision rather than reproducing an older intermediate conclusion.

### 1.5 Backend and implementation limitations
Backend-specific restrictions and implementation limitations are documented separately, including:

KNOWN_LIMITATIONS.md
SUPPORTED_PLATFORMS.md
backend-specific specifications and guides
Language-level support and backend coverage are not assumed to be identical.

A construct may belong to the UR V1.0 language contract while still having a documented restriction in a particular backend or execution environment.

### 1.6 Release evidence
UR_V1_0_FINAL_RELEASE_EVIDENCE.md

Records the final V1.0 release identity and verification evidence.

Release verification evidence establishes what was actually verified for the release. It does not redefine language semantics and does not imply that the implementation is free of every possible defect.

### 1.7 Historical documentation
Earlier release-candidate reports, milestone reports, investigations, repair evidence, validation reports, and superseded design documents remain part of the UR engineering record.

They are retained for traceability.

Unless explicitly identified as a current authority above, a historical document must not be used by itself to determine the current UR V1.0 language contract or release status.

## 2. UR V1.0 Status
UR V1.0 is the published stable v1.0.0 release.

The released source is anchored to:

82ccb01ceee47ffe8dd00aa7358208e5d22a772d

Developer documentation may be updated after publication to clarify the released language, correct documentation errors, organize evidence, or record later findings.

Such documentation changes do not silently alter the immutable source associated with the V1.0 release.

## 3. How to Read This Guide
Each capability described in this guide should be understood using the following status vocabulary:

Supported — part of the V1.0 contract and supported in the stated execution scope.
Supported with limitations — part of V1.0, with explicitly documented restrictions.
Recognized only — accepted or represented by an earlier compiler layer, but not supported as a complete executable V1.0 capability.
Backend-specific — availability or behavior depends on the selected backend.
Internal — implemented for internal compiler/tooling purposes but not exposed as a supported user-facing V1.0 interface.
Deferred — intentionally assigned to a later language version.
Unsupported — not part of the supported V1.0 contract.
This terminology prevents parser recognition, internal implementation, backend support, and complete language support from being treated as equivalent claims.

## 4. Documentation Map
For normal UR development, start with this guide.

For normative or forensic questions, use the following sources:

Language syntax and semantics: UR_LANGUAGE_SPEC_1_0.md
Feature-to-version assignment: UR_LANGUAGE_VERSION_MATRIX.md
Implementation evidence: SPEC_IMPLEMENTATION_MATRIX.md
Tier 2 / ABI type decision: ADR_1_TIER2_TYPES_DECISION.md
null semantics and V1.0 scope: ADR_2_NULL_LITERAL_DECISION.md
&& and || short-circuit semantics: ADR_3_LOGICAL_SHORT_CIRCUIT_DECISION.md
Known implementation limitations: KNOWN_LIMITATIONS.md
Platform verification and support: SUPPORTED_PLATFORMS.md
V1.0 release identity and verification: UR_V1_0_FINAL_RELEASE_EVIDENCE.md
Historical reports remain available for audit and engineering traceability, but they are not substitutes for the current authorities listed above.
## 5. UR V1.0 Capability Overview
This section summarizes the developer-facing capability contract of UR V1.0.

It is intentionally conservative. A construct is not described as fully supported merely because it is recognized by the lexer, accepted by the parser, represented in the AST, or implemented by one backend.

Where a later closed ADR resolves an older documentation state, the closed ADR governs the affected capability.

### 5.1 Core language capabilities
The following list summarizes the V1.0 language capability assignments established by the current specification, version matrix, implementation evidence, and applicable closed ADRs.

Variables (let) — Supported

Part of the UR V1.0 language scope.
Functions — Supported with limitations

Zero-argument functions are part of V1.0.
Multi-argument functions are supported on the C Backend under the documented type requirements.
if / else statements — Supported

Statement-form conditional control flow is part of V1.0.
if expressions — Deferred

Expression-form if is outside the V1.0 execution contract.
while — Supported

Part of V1.0 control flow.
break / continue — Supported

Available with supported loop forms.
Array-based for / in — Supported

Array iteration is assigned to V1.0 by the official version matrix.
Range-based for — Deferred

Range iteration belongs to later scope.
Parser or grammar recognition alone must not be interpreted as end-to-end V1.0 support.
Arrays — Supported

Arrays are part of the V1.0 language capability set.
Nested / multidimensional arrays — Supported

Assigned to V1.0 by the official version matrix.
Structs — Supported with limitations

Constructor-call inference is part of the V1.0 scope.
Named-type annotations have separate version restrictions.
Type aliases — Supported with limitations

Alias form is part of V1.0.
byte — V1.0 language type; implementation status requires explicit evidence

The base specification classifies byte as a Tier 1 general-purpose type.
Its presence in the specification must not, by itself, be interpreted as proof of complete compiler/backend coverage.
Consult SPEC_IMPLEMENTATION_MATRIX.md before making an implementation-support claim.
Character literals — Supported

Included in the V1.0 language capability set.
Tier 2 ABI-precise types — ABI-specific

Governed by ADR_1_TIER2_TYPES_DECISION.md.
These types belong to FFI/ABI usage and must not be presented as general-purpose Tier 1 source-language types.
null — Recognized only

Frontend and type-level recognition exists.
Full executable null semantics are outside the V1.0 execution contract under ADR_2_NULL_LITERAL_DECISION.md.
Enums — Deferred
Enum declarations are not part of the supported V1.0 contract.
### 5.2 Logical operators
UR defines && and || using short-circuit evaluation.

Under ADR-3:

lhs && rhs evaluates rhs only when required by the value of lhs.
lhs || rhs evaluates rhs only when required by the value of lhs.
ADR-3 is closed and records implementation closure for this behavior. Older intermediate documentation that described short-circuit behavior as unverified must not be treated as the current V1.0 status.

### 5.3 Type annotations and inference
UR V1.0 does not treat every syntactically representable type annotation or inference case as a supported executable capability.

In particular:

Named-type annotations such as let p: Point are outside the supported V1.0 contract.
Struct construction through the supported constructor/inference path remains distinct from named-type annotation support.
Contexts that require a concrete backend type may require explicit typing in V1.0.
A future-version assignment in the version matrix takes precedence over assumptions based only on parser or AST support.
### 5.4 Integer precision boundary
V1.0 must not be documented as providing unrestricted large-integer literal precision.

The official version record distinguishes the V1.0 behavior around the JavaScript safe-integer boundary from later full-width integer-literal support.

Where the V1.0 frontend rejects an out-of-contract integer literal, that rejection must not be described as equivalent to full 64-bit literal support.

Consult the language specification, version matrix, and implementation evidence for the exact accepted literal contract.

### 5.5 Language support versus backend support
A language capability and a backend capability are different claims.

For every non-trivial feature, developers should distinguish:

whether the syntax is recognized;
whether semantic/type checking supports it;
whether lowering supports it;
whether a particular backend supports the resulting representation;
whether the capability is exposed through a supported V1.0 CLI workflow; and
whether that end-to-end path has verification evidence.
A capability must not be promoted to full V1.0 support merely because one stage of this chain implements it.

### 5.6 Deferred does not mean defective
A capability explicitly assigned to V1.1 or later is not, by that fact alone, a V1.0 defect.

Similarly, an internal compiler capability that is not part of the public V1.0 surface must not be advertised as a supported user-facing feature.

Defects, deferred features, backend limitations, and unsupported features are separate classifications and should remain separate in UR documentation.

## 6. Installation and First Program
This section provides the shortest verified path from the UR source repository to running and building a simple UR program.

For more detailed installation information, consult docs/INSTALLATION_GUIDE.md.

### 6.1 Prerequisites
The documented development prerequisites are:

Node.js
npm
Git when installing or working from the source repository
Backend-specific or advanced development workflows may have additional requirements. Do not assume that requirements for an internal backend are requirements for the normal ur run or ur build workflow.

### 6.2 Build UR from the source repository
From the UR-Bridge repository:

npm install
npm run build
For development verification, the repository also documents:

npm run typecheck
npm test -- --run
### 6.3 First UR program
Create a file named hello.ur:

function main(): int
    return 0
end
### 6.4 Run a UR program
Use:

ur run hello.ur

In the CLI implementation reviewed for this guide, ur run compiles the source to UR IR and executes that IR through the UR interpreter.

Execution path:

UR source -> compiler front end -> UR IR -> UR interpreter -> program result

The normal ur run path must not be described as using the C Backend unless the CLI implementation changes and that change is independently verified.
### 6.5 Build a UR program
Use:

ur build hello.ur

In the CLI implementation reviewed for this guide, ur build generates a .js output corresponding to the UR source basename.

Example:

hello.ur -> hello.js

The generated JavaScript provides a Node.js execution path around compiled UR IR and the UR interpreter.

It must not be described as a native executable produced by GCC or another C compiler.

It also must not be assumed to be a portable standalone artifact independent of the UR-Bridge installation unless that property is separately verified.
### 6.6 Run and build are not backend synonyms
ur run, ur build, the C Backend, and the WebAssembly Backend are separate concepts.

The presence of a backend in the repository does not prove that the backend is used by a particular CLI command.

For the CLI implementation reviewed for this guide:

ur run executes compiled UR IR through the UR interpreter.
ur build produces a .js execution path around compiled UR IR and the UR interpreter.
The C Backend and WebAssembly Backend are documented separately and must not be presented as the implementation of ur run or ur build unless that CLI relationship is independently verified.
### 6.7 Basic CLI commands
The developer documentation identifies the following basic CLI commands:

ur init
ur run <file>
ur build <file>
ur version
ur help
The exact behavior and supported options of each command should be taken from the current CLI implementation and its dedicated documentation rather than inferred from the presence of a backend elsewhere in the repository.
### 6.8 Verification discipline
When validating a local UR checkout, keep these claims separate:

Repository dependencies installed successfully.
The project built successfully.
Type checking completed successfully.
A specific test suite passed.
Some tests were skipped.
A UR source program ran successfully.
A build artifact was produced successfully.
Success in one category does not automatically prove success in the others.

Test reports should preserve the distinction between passed, failed, and skipped tests. Release-level claims should be tied to the exact source revision and evidence used for that verification.
## 7. Types and Values
UR V1.0 distinguishes between user-facing language types and ABI-specific types used for native interoperability.

The presence of a type in the language specification does not, by itself, prove complete end-to-end implementation across every compiler stage or backend.

For implementation claims, consult SPEC_IMPLEMENTATION_MATRIX.md. For version assignment, consult UR_LANGUAGE_VERSION_MATRIX.md.

### 7.1 Tier 1 — User-facing types
The base V1.0 specification identifies the following Tier 1 types:

int
float
bool
string
char
byte
null
These names do not all have identical implementation status.

In particular:

byte belongs to the Tier 1 language specification, but complete compiler/backend coverage must be established from implementation evidence rather than assumed from the specification alone.
null is recognized by the frontend and type system, but full executable null semantics are outside the V1.0 execution contract under ADR_2_NULL_LITERAL_DECISION.md.
Therefore, neither specification presence nor frontend recognition should be treated automatically as proof of complete executable V1.0 support.
### 7.2 Tier 2 — ABI-precise types
UR V1.0 also defines ABI-precise types for native interoperability.

The V1.0 Tier 2 type set includes:

i8
i16
i32
i64
u8
u16
u32
u64
f32
f64
void is used where the ABI requires a no-value return.

Under ADR_1_TIER2_TYPES_DECISION.md, these types are FFI/ABI-specific in V1.0.

They must not be documented as general-purpose Tier 1 types for ordinary UR variables or normal source-language function signatures.

This distinction is intentional:

Tier 1 describes user-facing language types.
Tier 2 provides ABI precision for native interoperability.
The existence of Tier 2 types does not expand the general-purpose V1.0 type system beyond its documented contract.
When documenting or testing a Tier 2 type, the FFI/ABI context must remain explicit.
### 7.3 Type inference and annotations
UR supports type inference, but V1.0 does not guarantee that every program can omit explicit type information.

The compiler may infer types from expressions and other available type information where the supported V1.0 implementation provides enough context.

Developers should therefore distinguish between:

syntax that permits an omitted annotation;
a context in which the compiler can infer the required type;
a context that requires a concrete type for later compiler or backend processing.
In V1.0, some contexts that require a concrete backend type may still require explicit type annotations.

Named-type annotations also have their own version restrictions and must not be inferred to be supported merely because the grammar or AST can represent them.

For example, support for constructing a struct through the documented constructor/inference path does not automatically establish support for a declaration such as:

let p: Point = ...

When the specification, version matrix, and implementation evidence differ in age, use the current version assignment together with applicable closed ADRs and verified implementation evidence before making an end-to-end support claim.
### 7.4 Tier mapping
The UR V1.0 specification defines canonical mappings between selected user-facing Tier 1 types and ABI-level representations.

The specified mappings include:

int -> i64 on 64-bit targets
float -> f64
byte -> u8
These mappings describe the language and ABI model. They must not be treated, by themselves, as proof that every mapped type has complete end-to-end implementation across the frontend, IR, interpreter, C Backend, WebAssembly Backend, or FFI paths.

In particular, byte is specified as a Tier 1 type and maps to u8 at the ABI level, but its complete implementation status must be determined from current implementation evidence.

For V1.0:

Tier mapping is part of the specified type model.
ABI representation and general-purpose language support are separate claims.
Backend support must be verified independently.
Implementation evidence takes precedence over assumptions based solely on a type mapping.
Developers working at an FFI or backend boundary should therefore verify both the language-level type and the specific ABI/backend path involved.
### 7.5 Type-system boundaries in V1.0
UR V1.0 documentation distinguishes between the stages through which a language construct may pass.

A capability may be:

specified by the language;
recognized by the lexer or parser;
represented in the AST;
recognized or validated by the type system;
lowered into the compiler IR;
supported by a particular execution backend or interpreter; and
verified through an end-to-end user-facing path.
Support at an earlier stage does not automatically establish support at every later stage.

For example, a construct may parse successfully but still be intentionally rejected during lowering. Likewise, a type may exist in the language specification without having complete implementation coverage across all execution paths.

This distinction is especially important when reading V1.0 documentation:

Specified does not automatically mean fully implemented.
Parsed does not automatically mean executable.
Type-recognized does not automatically mean lowerable.
Lowerable does not automatically mean supported by every backend.
Backend support does not automatically mean the capability is exposed through the public CLI.
Internal implementation does not automatically make a feature part of the public V1.0 contract.
A capability should be described as fully supported only when the applicable V1.0 contract and the required implementation path both support that claim.

When those sources disagree, preserve the disagreement explicitly until the relevant specification, version decision, implementation evidence, or closed ADR resolves it.
## 8. Control Flow and Logical Evaluation
UR V1.0 supports structured control flow, but syntax recognition and complete executable support must remain distinct.

The base grammar represents more constructs than the public V1.0 execution contract necessarily exposes. Version assignments and applicable closed ADRs therefore govern the support statements in this section.

### 8.1 if / else
Statement-form if / else is part of the supported V1.0 control-flow contract.

Basic form:

if condition ... else ... end

The base grammar can also represent if in an expression position.

However, expression-form if is deferred from the supported V1.0 execution contract. Its presence in the grammar and AST must not be presented as proof of end-to-end V1.0 execution support.

For V1.0 documentation:

if / else statement form — Supported
if expression form — Deferred
When a historical specification example shows an if expression, read that example as grammar/specification material rather than evidence that the expression form is executable in V1.0.
### 8.2 while, break, and continue
UR V1.0 supports while loops as part of its executable control-flow contract.

Basic form:

while condition ... end

The loop condition is evaluated to determine whether execution enters or continues the loop body.

UR V1.0 also supports:

break to leave a supported loop.
continue to continue with the next iteration of a supported loop.
while, break, and continue belong to the V1.0 control-flow capability set.

As with other UR constructs, their presence in the grammar is not used by this guide as the sole evidence of support. Their V1.0 status follows the current version assignment and implementation evidence.
### 8.3 Array-based for / in
UR V1.0 supports for / in iteration over arrays.

Conceptual form:

for item in array ... end

For V1.0, it is important to distinguish array iteration from other forms of for.

Array-based for / in — Supported in V1.0
Range-based for — Deferred to later scope
The base grammar can represent the general for <identifier> in <expression> structure, but grammar recognition alone does not establish that every possible iteration expression is supported by V1.0.

Therefore, documentation and examples must not use the supported array-iteration form as evidence that range iteration is also supported.

The in keyword is part of the for construct in this context. Its treatment outside that context must follow the lexical and grammar rules defined by the V1.0 specification.
### 8.4 Logical && and ||
UR V1.0 defines && and || with short-circuit evaluation.

Under ADR_3_LOGICAL_SHORT_CIRCUIT_DECISION.md, this behavior is part of the closed V1.0 language decision.

For &&:

Evaluate the left-hand side first.
Evaluate the right-hand side only when the left-hand side requires it.
For ||:

Evaluate the left-hand side first.
Evaluate the right-hand side only when the left-hand side requires it.
The key V1.0 contract is that the right-hand side is not evaluated unconditionally.

This matters when the right-hand side performs observable work or contains an operation that should not execute after the left-hand side has already determined the logical result.

ADR-3 records implementation closure for this behavior. Older documentation that describes && or || short-circuit behavior as unverified is historical and must not be used as the current V1.0 status.

The presence of && and || in the expression grammar establishes their syntax; ADR-3 establishes the required short-circuit evaluation semantics.
### 8.5 Expressions and operator precedence
UR V1.0 expressions are organized into precedence levels so that operators bind predictably.

From lower to higher precedence, the expression grammar groups the operators as follows:

Logical OR: ||
Logical AND: &&
Equality: ==, !=
Comparison: <, <=, >, >=
Addition and subtraction: +, -
Multiplication, division, and remainder: *, /, %
Unary operators: !, unary -
Postfix operations such as function calls, indexing, and member access
Primary expressions
Parentheses may be used to make grouping explicit where supported by the expression grammar.

Operator precedence defines how an expression is grouped. It does not, by itself, define every runtime evaluation rule.

In particular, the short-circuit semantics of && and || are governed by ADR_3_LOGICAL_SHORT_CIRCUIT_DECISION.md, not merely by their position in the precedence hierarchy.

Likewise, the presence of an expression form in the grammar does not automatically establish complete V1.0 execution support. The version assignment and implementation evidence remain authoritative for that question.
## 9. Functions
UR V1.0 supports user-defined functions.

Function syntax, type information, call behavior, and backend coverage are separate aspects of function support. A function form being representable by the grammar does not automatically establish that every combination of parameters, annotations, calls, and backends is supported end-to-end.

### 9.1 Function declarations
The base grammar represents a function declaration with:

a function name;
an optional parameter list;
optional parameter type annotations;
an optional return type;
a function body; and
end as the block terminator.
A minimal function can be written as:

function main(): int ... end

The grammar can also represent multiple parameters.

For example, at the syntax level:

function add(a, b) ... end

However, syntax support must not be confused with complete V1.0 execution support.

In particular, parameter typing requirements and multi-argument execution support must follow the current V1.0 version assignment and implementation evidence rather than being inferred solely from the grammar.
### 9.2 Parameters and multi-argument functions
The UR grammar can represent functions with zero, one, or multiple parameters.

At the syntax level, parameters may also carry explicit type annotations.

However, V1.0 documentation must distinguish grammatical support from verified execution support.

For the V1.0 contract documented by the current version and implementation evidence:

Zero-argument functions are part of the supported V1.0 function model.
Multi-argument functions have verified support on the C Backend under the documented explicit parameter-type requirements.
The existence of an untyped multi-parameter form in the grammar does not, by itself, establish complete end-to-end support for that form.
Parameter inference must not be described as universally available when a concrete compiler or backend type is required.
For example, the grammar can represent:

function add(a, b) ... end

That syntax alone is not evidence that every unannotated multi-argument execution path is supported by V1.0.

When portability across execution paths matters, consult the current implementation evidence and backend-specific limitations before relying on parameter inference or multi-argument behavior.
### 9.3 Return values and return types
UR function declarations may include an explicit return type after the parameter list.

For example:

function main(): int ... end

The base grammar also allows a return statement with an optional expression.

Conceptually, these are separate cases:

return value returns a value from the current function.
return represents a return without an explicit value where that form is valid for the applicable function contract.
The presence of an optional return annotation in the grammar does not mean that every return type can be inferred successfully in every V1.0 context.

When a concrete type is required by later compiler stages or an execution path, developers should follow the applicable V1.0 typing requirements rather than assume that omitted type information will always be inferred.

Return-type syntax, type inference, ABI representation, and backend execution are separate concerns.

In particular, ABI-specific return types must follow the Tier 2 rules established by ADR_1_TIER2_TYPES_DECISION.md and must not be presented as general-purpose Tier 1 return types.
### 9.4 Function calls and program entry
UR represents function calls with a callee and an argument list.

The compiler implementation lowers supported calls into IR call instructions that preserve the target function and the lowered arguments.

Function-call support must still respect the applicable V1.0 typing, arity, and backend requirements described elsewhere in this guide and in the implementation evidence.

The examples in this guide use main as the program entry function:

function main(): int ... end

This guide does not claim command-line argument support for main, or a broader mandatory main signature, unless that behavior is established separately by the current CLI/runtime implementation.

Likewise, the existence of a call representation in the parser or IR does not establish that every possible combination of argument types, return types, or execution backends is supported in V1.0.
## 10. Arrays
Arrays are part of the UR V1.0 language capability set.

Array support must still be documented with attention to the operation being performed and the execution backend involved. Support for basic arrays, nested arrays, array iteration, and arrays containing structured values does not imply that every array-related operation has identical backend coverage.

### 10.1 V1.0 array status
The official V1.0 version matrix records arrays as implemented, tested, and shipped.

It also records nested and multidimensional arrays as part of the V1.0 capability set.

For documentation purposes, keep these claims separate:

Basic arrays — Supported in V1.0
Nested / multidimensional arrays — Supported in V1.0
Array-based for / in iteration — Supported in the V1.0 language contract
Range-based for iteration — Deferred
Dynamic array length — Not part of V1.0
GC / explicit free support for arrays — Not part of V1.0
Backend-specific restrictions are documented separately and must not be generalized into language-wide statements.
### 10.2 Array indexing
UR V1.0 supports array indexing with the [...] form.

The current implementation evidence records array indexing across the compiler stages covered by the implementation matrix and reports extensive test coverage for this capability.

Conceptual form:

array[index]

Basic array indexing should be distinguished from more complex operations involving structured array elements.

In particular:

basic array[index] support does not automatically establish support for chained access such as array[index].field;
struct-array mutation and assignment can have backend-specific restrictions;
backend-specific rejection of a more complex array operation must not be generalized into a claim that basic array indexing itself is unsupported.
For complex array operations, consult the struct-array and backend-specific sections of this guide.
### 10.3 Array element access and bounds
UR V1.0 provides bounds checking for supported array element reads and writes.

The recorded implementation evidence reports that out-of-bounds access is rejected through a controlled panic path rather than being treated as a valid memory access.

Array element operations must still be distinguished from whole-array operations.

In particular:

supported element reads and writes do not imply support for array-to-array assignment;
array parameters and array return values can have separate Lowering restrictions;
explicit array type annotations and array literal forms have their own implementation constraints;
support for multidimensional array types must not be confused with support for every nested array-literal form.
For whole-array assignment, array parameters/returns, nested literals, and backend-specific restrictions, consult the current implementation evidence and known-limitations documentation.
### 10.4 Whole-array operations and current limitations
UR V1.0 distinguishes element-level array operations from operations that move or expose an entire array value.

The current implementation evidence records the following:

Explicit array annotations such as int[] are supported for verified literal-initialization cases.
Nested array literals are supported in the corrected V1.0 documentation and have recorded execution coverage across the Interpreter, C Backend, and WebAssembly Backend.
Empty array literals ([]) are not supported because the element type is ambiguous; the documented diagnostic is TY6002.
Assigning from an existing array value to another array declaration can still fail at Lowering when the required fixed size is not known at the declaration point.
Passing arrays through function parameters and returning arrays through function signatures remain subject to the same Lowering representation limitation documented for whole-array values.
free(array) is not supported in V1.0.
These restrictions must not be generalized into a claim that arrays themselves are unsupported.

In particular, basic arrays, supported array indexing, bounds-checked element access, and supported nested array forms remain separate capabilities from whole-array assignment and function-boundary array transfer.
### 10.5 Nested and multidimensional arrays
Nested and multidimensional arrays are part of the corrected UR V1.0 capability set.

The current V1.0 documentation records nested array literals as successfully type-checked, lowered, and executed through the Interpreter, C Backend, and WebAssembly Backend.

For example, multidimensional array types may include forms such as:

int[][]

This capability must remain distinct from dynamic array sizing.

UR V1.0 support for nested arrays does not imply that array dimensions or lengths are represented by a general runtime-sized array model.

It must also remain distinct from empty array literals:

Nested array literals with sufficient type information are supported.
The empty literal [] remains unsupported where the element type cannot be determined, with the documented TY6002 diagnostic.
Older documentation that broadly described nested arrays as unsupported has been superseded by the later V1.0 correction and must not be used as the current capability status.
## 11. Structs
Structs are part of the UR V1.0 language capability set.

Struct support must be distinguished from named-type annotations, chained field access, and struct-array interoperability. Those capabilities have separate version assignments or implementation restrictions.

### 11.1 V1.0 struct status
The official version matrix records structs as implemented, tested, and shipped in V1.0.

V1.0 supports the documented struct construction path, including constructor-call inference where applicable.

However, this does not imply that every syntax involving a struct name is supported.

In particular:

Structs themselves — Supported in V1.0
Supported constructor/inference paths — Part of the V1.0 struct contract
Explicit named-type annotations such as let p: Point = ... — Deferred to V1.1
Chained field access such as arr[0].x — Not a V1.0 requirement; current contract status is unresolved in the version record
A struct being constructible and usable through a supported path must not be used as evidence that explicit : TypeName annotations are also supported.
### 11.2 Struct construction and type identity
UR V1.0 supports struct construction through the documented constructor/inference path.

A struct value can therefore establish its struct type through a supported construction expression without implying that every explicit named-type annotation is legal in V1.0.

This distinction is important.

For V1.0:

Struct construction through the supported constructor/inference path is part of the language contract.
The resulting value retains the applicable struct type identity required by supported compiler operations.
Explicit named-type annotations have a separate version assignment.
Syntax such as let p: Point = ... must not be advertised as supported merely because Point(...) construction is supported.
In other words:

construction support != named-type-annotation support

Documentation, examples, and tests should preserve this distinction.

When explicit type spelling is required in a context not covered by the supported V1.0 struct path, consult the version matrix and implementation evidence rather than assuming that a struct name can be used anywhere a general type annotation is syntactically representable.
### 11.3 Struct field access
UR V1.0 supports the documented direct member-access operation for structs using ..

Conceptual form:

value.field

The current implementation evidence records member access through the compiler stages covered by the implementation matrix, with the verified scope identified as struct member access.

Direct member access must be distinguished from chained access.

For example:

arr[0].x

is not equivalent, from an implementation-support perspective, to a simple direct struct member access.

The current V1.0 version record identifies chained field access as a general Lowering limitation associated with CG1001. The limitation is not specific to arrays or to the WebAssembly Backend and can also affect chained access through nested struct values.

For the V1.0 contract:

Direct supported struct member access — Supported
Chained field access — Not a V1.0 requirement
arr[0].x — Do not document as a supported V1.0 capability
The version record currently classifies the broader chained-field-access contract as unresolved. Documentation must preserve that status rather than silently promoting the feature to supported.
### 11.4 Structs inside arrays
UR V1.0 includes documented support for arrays whose elements are struct values, but the supported operations and backend coverage are not identical for every struct-array shape.

The current V1.0 evidence distinguishes several cases:

Constructing a struct array through supported struct constructors is part of the documented V1.0 capability set.
Extraction, mutation, and assignment involving struct-array elements have documented support on the Interpreter and C Backend in the recorded verification scope.
The corresponding WebAssembly path has a documented restriction involving store; therefore, support verified on the Interpreter or C Backend must not automatically be claimed for WebAssembly.
Struct arrays that mix scalar and reference-valued fields have a documented intentional rejection in the current contract. This case must not be described merely as an accidental implementation gap.
Chained access such as arr[0].x remains governed by the chained-field-access limitation described in §11.3.
These distinctions mean that Array<Struct> is not a single all-or-nothing capability.

When documenting or testing a struct-array operation, identify the specific operation and execution backend rather than making a general claim that every struct-array form is supported everywhere.
## 12. Modules and Imports
### 12.1 V1.0 import status
UR V1.0 supports direct package imports, with important implementation limitations.

The source-level import syntax accepts module names such as:

import mathlib
Direct UR packages are supported by the verified CLI path when they use the package layout expected by that path, including:

ur_packages/
  mathlib/
    index.ur
End-to-end tests verify that functions from such packages can be imported and called. Multiple direct package imports and duplicate imports are also covered by the V1.0 implementation evidence.

This support must not be interpreted as a general claim that every module resolution form described by the language specification is exposed through the V1.0 CLI.

In particular:

nested package imports are restricted in the verified CLI path;
arbitrary top-level declarations must not be assumed to become usable exports merely because their package is imported;
the implementation contains internal relative-path resolution machinery, but the inspected V1.0 source parser does not expose ./ or ../ as source-level import syntax;
relative paths used inside FFI package manifests are a separate mechanism and do not establish support for source-level relative UR imports.
Therefore, Modules and Imports should be treated as Supported with limitations in UR V1.0.
### 12.2 Package layout and resolution
The verified V1.0 CLI path supports direct package imports using the ur_packages package layout.

For a source import such as:

import mathlib
the verified package layout is:

ur_packages/
  mathlib/
    index.ur
The V1.0 implementation evidence includes end-to-end cases in which the CLI locates a direct package in this layout and makes supported declarations from that package available to the importing program.

Package lookup is relative to the project context used by the verified CLI path. A package placed under another directory's ur_packages tree must not be assumed to be visible automatically.

The implementation also contains an ImportResolver with resolution logic for standard-library, package, and relative paths. This internal resolver capability does not by itself establish that every such path form is exposed through V1.0 source syntax or through the verified CLI path.

In particular, internal handling of ./ and ../ must not be interpreted as evidence that source forms such as import ./localmod or import ../localmod are supported in V1.0. The inspected source parser accepts identifier-based module paths and does not expose those relative forms through the parser path that was reviewed.

Package-manifest relative paths are a separate mechanism. Relative target paths used by FFI/native package manifests do not establish source-level relative UR import support.
### 12.3 Direct imports, composition, and limitations
The verified V1.0 CLI evidence covers direct package imports and several composition cases.

The covered behavior includes:

importing and calling functions from a direct UR package;
importing more than one direct package in the same program;
encountering the same direct import more than once in the tested cases;
importing a struct declaration and using that struct from the importing program.
These verified cases do not establish unrestricted transitive module composition.

In particular, nested package imports are restricted in the verified CLI path. A package imported by the main program must not be assumed to be able to import another package successfully merely because both packages exist under ur_packages.

Importing a package also must not be interpreted as exporting every top-level declaration from that package. The V1.0 evidence includes a case where a top-level let declaration in an imported package is not available to the importing program and produces the recorded SE1001 diagnostic.

Therefore, the verified direct-import behavior should not be generalized into a claim of unrestricted transitive imports or arbitrary package exports.
### 12.4 Native and FFI package imports
Native and FFI package imports are related to the module system but must be distinguished from ordinary UR source-package imports.

The V1.0 implementation includes package manifests that can describe native targets. Verified test cases include manifest target paths that are relative to the package manifest, including paths beginning with ./ and ../.

These manifest-relative paths belong to native/FFI package resolution. They do not establish that UR source code can use equivalent relative import forms such as:

import ./localmod
or:

import ../localmod
Native-library availability can also depend on the target platform and the registered native-library configuration. Therefore, successful resolution of a native import on one supported platform must not be generalized to every platform.

For source-level relative UR imports, see the limitation described in §12.2. For ABI-specific types used at native boundaries, see §7.2 and ADR-1.
### 12.5 Import boundaries and documentation authority
The V1.0 import contract must be interpreted per import form and per implementation layer. Recognition by the parser, resolution by an internal resolver, successful CLI execution, and native/FFI resolution are distinct levels of support.

For UR V1.0:

direct package imports have verified CLI evidence for the supported cases described above;
nested package imports remain restricted in the verified CLI path;
source-level ./ and ../ relative imports are not established as supported V1.0 source forms by the inspected frontend;
internal relative-path handling in ImportResolver does not override that source-level limitation;
relative paths inside native/FFI package manifests belong to a separate resolution mechanism;
package import support must not be generalized into unrestricted export of arbitrary top-level declarations.
When documentation disagrees about import capabilities, distinguish the language specification from implementation evidence. Use UR_LANGUAGE_SPEC_1_0.md for the specified language contract, UR_LANGUAGE_VERSION_MATRIX.md for version placement, SPEC_IMPLEMENTATION_MATRIX.md for implementation evidence, and KNOWN_LIMITATIONS.md for recorded implementation restrictions.

Accordingly, the V1.0 import system documented here is Supported with limitations. Broader resolver capabilities must not be presented as source-level or end-to-end support without corresponding evidence.

## 13. Type Aliases
### 13.1 V1.0 type-alias status
UR V1.0 includes type-alias declarations using the form:

type Age = int
The V1.0 frontend parses this declaration into a TypeAliasDecl, and the official type_alias example includes this declaration form.

Type-alias declaration support must not be interpreted as general named-type-annotation support.

In the verified V1.0 scope, declaring an alias such as Age does not establish that the alias name can be used as an explicit type annotation elsewhere. For example, the official example records the following form as unsupported:

let a: Age = 30
The example therefore declares Age but uses the underlying Tier 1 type directly:

let a: int = 30
The struct-like form:

type Name = { ... }
is also outside the V1.0 alias contract and is deferred beyond V1.0.

Accordingly, type-alias declarations are Supported with limitations in UR V1.0. Declaration support, alias-name resolution in annotations, and struct-like type declarations are separate capabilities and must not be treated as equivalent.
### 13.2 Known type-alias limitations
Type-alias declarations in V1.0 have additional boundaries beyond the named-type-annotation limitation described above.

The recorded implementation behavior currently allows duplicate alias names without producing a diagnostic. For example, declarations equivalent to:

type A = int
type A = float
have been observed without a duplicate-name diagnostic.

This behavior is recorded as unclassified. The current documentation does not establish whether duplicate aliases are intended to support shadowing or whether the absence of a diagnostic is a defect.

Therefore, applications should not rely on duplicate type-alias declarations as a defined V1.0 language semantic.
## 14. Characters and Character Literals
### 14.1 V1.0 character-literal status
UR V1.0 includes the Tier 1 char type and dedicated character-literal syntax using single quotes.

For example:

let c: char = 'a'
A character literal is distinct from a string literal. The frontend produces a dedicated CharLiteral, and the type checker assigns it the char type rather than string.

A valid character literal contains exactly one Unicode scalar value. Empty character literals and literals containing more than one character are rejected with LE005. An unterminated character literal is reported with LE002.

Character literals also support escape processing in the lexer. For example, the V1.0 lexer tests cover the newline escape:

'\n'
During IR construction, a character literal is represented by its Unicode code point and lowered as an integer constant while retaining char as its language-level value type.

These frontend, type-system, and lowering capabilities establish character literals as a V1.0 language feature. Backend-specific execution coverage should be documented separately rather than inferred from lowering support alone.
### 14.2 Verified expression usage
Character literals are not limited to lexer recognition in the recorded V1.0 evidence.

An end-to-end language-core test declares two char variables, initializes them with character literals, compares them using !=, and uses the result in control flow.

This establishes verified expression-level use of char for that tested path.

The test should not be generalized into a claim that every backend has independently verified character support. Backend-specific support requires backend-specific evidence.
## 15. Source Files and Lexical Conventions
### 15.1 Source-file contract
The UR V1.0 language specification defines UR source files as UTF-8 text without a byte-order mark (BOM), using the .ur file extension.

Both LF (\n) and CRLF (\r\n) line endings are part of the specified source-file contract. The specification states that the lexer normalizes these forms to LF.

Identifiers are Unicode-aware at the language-contract level. An identifier begins with a Unicode letter or _, and subsequent characters may include letters, digits, or _. Digit-only forms are not identifiers.

These statements describe the V1.0 language specification. Implementation behavior, including Unicode handling and line-ending normalization, should be treated as independently verified only where corresponding implementation or test evidence exists.
### 15.2 Verified lexer behavior
The V1.0 lexer operates on Unicode code points rather than UTF-16 code units. This behavior is implemented explicitly so source positions and character processing are not limited to single UTF-16 code units.

LF and CRLF input are both handled by the lexer. The lexer has separate paths for these newline forms, and the frontend tests verify that a CRLF sequence produces a single NEWLINE token.

Identifier handling is also verified for several important forms, including:

Latin identifiers;
Arabic identifiers;
identifiers beginning with _;
digits after, but not as the required initial identifier character;
mixed Arabic-and-digit identifiers;
selected Arabic combining diacritics inside identifiers.
The frontend tests also verify code-point-based source-column tracking for Arabic text.

These implementation results should not be generalized into a claim that every possible Unicode identifier form has independent V1.0 test coverage. The language specification defines the broader source-level contract, while the implementation evidence establishes the cases actually implemented and tested.

The inspected lexer evidence does not independently establish BOM rejection, so the UTF-8-without-BOM rule remains a specification-level requirement unless separate implementation evidence is available.
### 15.3 Comments
The UR V1.0 language specification defines both line and block comments.

A line comment begins with:

//
A block comment uses:

/* ... */
Comments do not produce language tokens. The specification also states that block comments are not nested.

Line comments are discarded without consuming the following newline. In the verified lexer implementation, that newline remains available to produce a NEWLINE token.

These statements describe the V1.0 lexical specification. They should not be expanded into claims about additional comment forms or nested-comment behavior beyond that contract without corresponding implementation evidence.
### 15.4 Numeric literals
UR V1.0 supports decimal, hexadecimal, and binary integer literals.

Examples include:

42
0xFF
0b1010
Underscores may be used as visual separators in numeric literals. The lexer removes these separators from the token value; for example:

1_000_000
is tokenized with the numeric text 1000000.

Floating-point literals support decimal and exponent forms, including forms such as:

3.14
1e10
1.5e-3
The lexer reports LE004 when an exponent marker is not followed by the required exponent digits.

V1.0 also has an important source-literal precision boundary. An integer literal written directly in source is rejected with PE011 when its magnitude exceeds the compiler's safe precision limit of 2^53 - 1.

This restriction applies to integer literals written in source and must not be interpreted as the general range of every runtime int value. Full exact 64-bit integer-literal precision is outside the V1.0 literal contract.
### 15.5 String literals
UR V1.0 string literals use double quotes and are represented by dedicated STRING_LIT tokens in the frontend.

The verified lexer tests cover:

empty strings;
ASCII text;
Arabic text;
emoji;
escape sequences;
Unicode escapes using the \u{...} form.
For example, the Unicode escape:

"\u{1F600}"
is decoded by the lexer to the corresponding Unicode code point.

The lexer supports the documented escape forms for newline, tab, carriage return, backslash, and double quote. Invalid or unknown escape sequences are reported with LE003.

An unterminated string literal is reported with LE002.

These results establish verified frontend handling of string literals. They should not by themselves be interpreted as independent verification of string behavior across every execution backend.
## 16. Diagnostics and Error Reporting
### 16.1 Diagnostic families
UR V1.0 reports failures through stable diagnostic-code families associated with different compiler and execution layers.

The implementation currently includes:

LE codes for lexer diagnostics;
PE codes for parser diagnostics;
SE codes for semantic-analysis diagnostics;
TY codes for type-system diagnostics;
CG codes for lowering/code-generation diagnostics;
BE codes for backend compile/link failures;
IM diagnostics used by the CLI import/merge path;
WASM codes for WASM-backend diagnostics.
These families represent different stages of processing. A construct being accepted by one stage does not imply that a later stage or backend supports it.

For example, the implementation defines diagnostics for undefined semantic symbols, unknown or mismatched types, unsupported lowering constructs, import resolution/merge failures, and unsupported WASM features.

Diagnostic codes should be interpreted in the context of the stage that emits them. The existence of a diagnostic code also must not be interpreted as evidence that every possible failure in that category has independent end-to-end test coverage.
### 16.2 Shared diagnostic structure
UR V1.0 includes a shared diagnostic representation for reporting diagnostics across compiler and execution layers.

A shared diagnostic can carry:

the component or stage that produced it;
a severity;
a stable diagnostic code;
a human-readable message;
a source location.
The shared severity levels are error, warning, and info.

The shared representation does not replace the diagnostic types used internally by the lexer, parser, semantic analyzer, or type checker. Those frontend stages retain their own diagnostic representations, which can be converted into the shared form when a common downstream representation is needed.

Therefore, developers should treat the diagnostic code and producing stage as part of the diagnostic context rather than assuming that all compiler stages originate diagnostics through one identical internal type.
### 16.3 Source locations
Shared diagnostics use a SourceLocation to identify the relevant source region.

A source location contains:

a source file;
a start point;
an end point.
Each source point contains a line and column. Normal source positions use 1-based line and column values, with columns represented as code-point offsets.

The shared location representation can be constructed from frontend source spans, allowing downstream compiler and runtime layers to refer to source regions without depending directly on frontend-internal span types.

Compiler-generated code that has no real source origin can use a synthetic location. The shared implementation represents this using the file name <synthetic> and zero-valued start and end positions.

As with shared diagnostics generally, this location representation provides a common downstream vocabulary; it does not replace the frontend's own source-span representations.
## 17. Deferred and Out-of-Scope Capabilities
### 17.1 How to interpret deferred features
Not every capability outside the UR V1.0 contract has the same status.

The version documentation distinguishes between features assigned to a later UR version, capabilities deliberately outside the V1.x language scope, and known implementation limitations whose future language status is not yet assigned.

A feature described as Deferred in this guide is not part of the V1.0 language contract. Recognition by the grammar or existence of partial implementation code does not promote a deferred feature into V1.0 support.

Similarly, a backend-specific limitation does not automatically redefine the language-level version assignment. Backend scope and language-version scope must be evaluated separately.

When historical documentation disagrees with a later focused decision or version correction, this guide follows the documentation-authority rules in §1. In particular, corrected V1.0 capabilities must not be moved back into a deferred list merely because an older document described them that way.
### 17.2 Deferred to V1.1
The following capabilities are explicitly assigned to UR V1.1 rather than the V1.0 language contract:

named-type annotations using struct or type-alias names as explicit : TypeName annotations;
range iteration, such as for i in 1 to 5;
if expressions that produce a value;
the broader contextual/bidirectional type-inference behavior required for the recorded unannotated parameter and variable cases;
full exact 64-bit integer-literal precision beyond the V1.0 safe source-literal subset.
These assignments do not remove related V1.0 capabilities. In particular, array-based for/in iteration and nested/multidimensional arrays are V1.0 capabilities and must not be classified as deferred merely because older documentation grouped them with unfinished features.

For integer literals, V1.0 deliberately rejects source literals beyond the safe precision boundary with PE011 rather than accepting a silently corrupted value. V1.1 is the assigned version for extending that literal representation to full exact 64-bit precision.
### 17.3 Capabilities assigned beyond V1.x
The version matrix assigns several larger language capabilities to UR 2.0 rather than to either V1.0 or V1.1:

generics and type parameters;
classes, inheritance, and interfaces;
async/await;
pattern matching;
closures;
try/catch error handling;
operator overloading;
macros;
tuples and multiple return values.
These are outside the UR V1.x language contract. Their absence from V1.0 should therefore be treated as deliberate version scope rather than as an unclosed V1.0 implementation defect.

Array garbage collection or explicit free, and dynamic array length, are also outside V1.0 and V1.1 in the current version matrix. Their recorded roadmap assignment is expressed in project-milestone terms (v29), so this guide does not relabel them as ordinary UR 2.0 language features.

Other deliberately rejected or unresolved constructs must be kept separate from this future-version list. In particular, an intentionally rejected language contract or a capability whose future version remains unresolved must not be presented as implicitly scheduled for UR 2.0.
### 17.4 Unresolved and intentionally rejected capabilities
A capability that is unavailable in V1.0 is not automatically a deferred future feature.

The current version documentation records at least two distinct cases:

mixed scalar/reference Array<Struct> forms are deliberately rejected by the existing language contract rather than classified as an unfinished V1.0 implementation;
chained field access such as arr[0].x is a documented general Lowering limitation whose language-contract status remains unresolved. It is not a V1.0 requirement and has no future language-version assignment established by the current version matrix.
These cases must not be relabeled as V1.1 or UR 2.0 features without a later language decision.

Backend-specific gaps are separate again. A capability missing from one backend does not by itself establish that the language feature is deferred to another language version; backend limitations are documented through the corresponding backend guidance and known-limitations records.
