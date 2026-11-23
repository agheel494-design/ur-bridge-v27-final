# UR V2.0 — Point 3/5: Language Design

## Purpose

This report records the language-design decisions made for UR V2.0 Point 3.

Point 3 defines language contracts. It does not implement them. Compiler, runtime, backend, and test changes required to satisfy these contracts belong to Point 4 — Implementation & Verification.

The baseline used for this assessment was:

- Branch: `release/v1.0-candidate`
- HEAD: `e33668e352e2a22166e359ef21e9020be697840d`
- Remote-tracking reference after `git fetch origin`: `origin/release/v1.0-candidate` at the same commit.

Point 1 and Point 2 remain closed. Their frozen architectural decisions were treated as constraints rather than reopened for redesign.

The governing distinction throughout this assessment is:

- historical intent is not current behavior;
- current behavior is not automatically the language specification;
- implementation presence is not proof of production integration;
- a language decision is not proof that implementation already conforms to it.

## LD-1 — Contextual IN

**Decision: APPROVED**

Canonical `IN` remains contextual in UR V2.0 and is not globally reserved.

The language contract is:

1. A surface spelling mapped to canonical `IN` is interpreted as the `in` grammatical construct where the grammar requires it, such as the relevant position in `for`.
2. Outside such a grammatical context, the spelling remains available as an ordinary identifier subject to the general identifier rules.
3. A spelling must not become globally unavailable as an identifier merely because Localization maps it to canonical `IN`.
4. Multilingual surface recognition remains a Localization responsibility. The Parser reasons in terms of canonical grammatical concepts rather than maintaining independent hard-coded rules for each human language.

This preserves the V1 language contract rather than introducing a new reservation rule.

The assessment found current source evidence that canonical `IN` maps to `IDENTIFIER` and that the Parser performs contextual recognition through the Localization boundary.

A behavioral probe also accepted the English spelling as a local identifier in:

    function main()
      let in = 7
      print(in)
    end

and produced `7`.

The behavioral probe was initially run through `bin/ur.mjs`. Later investigation established that this launcher preferred an existing ignored `dist/src/cli/index.js` artifact whose provenance relative to the verified HEAD had not been established. The LD-1 decision therefore does not depend solely on that probe. Current source and the V1 specification independently support the contextual design.

Changing canonical `IN` into a globally reserved keyword would be an intentional compatibility change and requires a separate language decision supported by new evidence.

### Point 4 verification requirement

Verification must protect both sides of the contract:

- contextual recognition where the grammar requires `IN`;
- identifier use outside that context.

Multilingual coverage should verify the canonical Localization boundary rather than testing only the English spelling.

## LD-2 — Backend-Neutral Observable Semantics

**Decision: APPROVED**

No individual execution implementation defines UR language semantics.

In particular:

- the Interpreter is not the language specification;
- the C backend is not the language specification;
- WASM or another backend is not the language specification.

When two execution paths claim support for the same language construct, they must agree on the language-observable semantics defined by that construct's contract.

Depending on the construct, observable semantics can include:

- program-visible values and results;
- program-visible output and its ordering;
- language-defined side effects and their ordering;
- termination and exit behavior where defined by the language contract;
- language-defined failure behavior.

The requirement does not imply identical internal architecture, generated representation, binary output, or byte-for-byte diagnostics.

Diagnostic wording or `stderr` formatting is part of the language contract only when a language specification explicitly makes it observable.

A backend may support a documented subset of UR. Explicit non-support is not semantic divergence. However, an execution path that claims support for a construct must not silently assign that construct different language semantics.

### Point 4 verification requirement

Cross-execution-path tests must derive their oracle from the language contract being tested rather than treating one implementation as correct merely because it is the Interpreter or C backend.

## LD-3 — Range Iteration

**Decision: DEFERRED**

Range iteration such as:

    for i in 1 to 5

is not a required UR V2.0 feature under the current Point 3 design.

Historical material described range iteration as deferred and in places stated that its grammar existed while Lowering did not. That statement must not be carried into the V2 specification as an accurate description of the current source.

A current-source Parser probe for `for i in 1 to 5` produced no Parser diagnostics but did not produce a Range AST.

The resulting `ForStatement` contained:

- `IntLiteral(1)` as its iterable;
- `Identifier("to")` as a statement in the loop body;
- `IntLiteral(5)` as another statement in the loop body.

A current-source CLI run through `tsx` subsequently reported `SE1001` for undefined symbol `to`.

Separately, tracked conformance material records a path in which the range fixture is rejected by Lowering with `CG1001`. That conformance path does not establish range execution semantics and does not prove that the production pipeline has a valid Range AST.

The assessment found no complete inherited semantic contract defining matters such as:

- upper-bound inclusion or exclusion;
- descending ranges;
- step semantics;
- valid bound types;
- bound evaluation timing.

Introducing range iteration would therefore be an unsupported-to-supported language extension requiring an independent language-design gate before implementation.

The historical statement that range iteration was moved to a later release is historical planning evidence, not a binding UR V2 requirement.

### Point 4 verification concern

The recorded conformance failure boundary and the observed current production-source failure boundary differ. That difference should be investigated if relevant to Point 4, but Point 3 does not classify it as a defect without a dedicated verification gate.

## LD-4 — Enum Declarations

**Decision: DEFERRED**

UR V2.0 does not require native enum declarations under the current Point 3 design.

V1 evidence establishes intentional rejection of enum declarations, including dedicated diagnostics. Historical future-development material also mentions enums as a future candidate.

Neither fact supplies a complete enum language contract.

Foreign C enum handling in FFI infrastructure is not evidence that UR itself already has enum declaration semantics.

Before native enums can be admitted to the language, a separate language-design decision must define at least the areas relevant to the selected enum model, including:

- declaration and variant syntax;
- type identity;
- payload policy, if any;
- discriminant policy, if any;
- equality;
- conversions;
- exhaustiveness requirements;
- interaction with pattern matching, if any;
- program-visible behavior.

The existence of `PE009` is evidence of intentional rejection behavior in its tested scope. It is not evidence that an enum semantic model has been designed.

Deferral prevents an incomplete type feature from becoming a compatibility commitment.

## LD-5 — Logical Operators: Short-Circuit Evaluation

**Decision: APPROVED**

UR V2.0 defines `&&` and `||` using short-circuit evaluation.

The language contract is:

- evaluate the left operand first;
- `false && rhs` must not evaluate `rhs`;
- `true && rhs` evaluates `rhs`;
- `true || rhs` must not evaluate `rhs`;
- `false || rhs` evaluates `rhs`;
- side effects in a skipped right operand must not occur;
- the result follows the Boolean typing rules applicable to the logical operators.

An execution path must not evaluate a skipped right operand merely because eager evaluation is more convenient for that implementation.

Previous evidence reported eager right-hand-side evaluation in tested UR behavior. That evidence motivates the language decision but is not treated here as proof that every current execution path is non-conforming.

Point 3 defines the required semantics. Determining exactly which current execution paths conform or fail to conform is a Point 4 verification task.

This is a deliberate V2 semantic decision. Any V1 behavior that requires eager evaluation of the right operand is not carried forward as the V2 language contract.

### Point 4 verification requirement

Tests must use observable right-hand-side behavior to distinguish execution from non-execution and must cover all four Boolean cases.

Every execution path claiming support for these logical operators must be checked against the same language contract.

## Deferred Historical Feature Candidates

Historical plans for later UR versions do not automatically become UR V2 requirements.

Based on the evidence available during Point 3, the following remain deferred:

- `if` expressions;
- named-type annotations beyond the currently established language contract;
- expanded contextual or bidirectional type inference;
- generics / type parameters;
- pattern matching;
- closures / anonymous functions;
- async / await;
- `try` / `catch`;
- range iteration;
- native enum declarations.

Deferral does not mean that these features are undesirable or permanently rejected.

It means that Point 3 did not establish both a demonstrated need and a sufficiently complete language contract to make them mandatory V2 commitments.

A future feature must pass its own language-design gate before implementation.

## Historical Statements That Must Not Be Promoted to V2 Facts

The V2 specification must distinguish historical planning from verified current behavior.

The following statements require qualification or must not be copied as current V2 facts:

### "Range grammar exists; only Lowering is missing"

Current-source Parser evidence examined in Point 3 does not support that statement as an accurate description of the verified baseline.

### "Range was moved to 1.1"

This records historical planning. It does not make range iteration mandatory in UR V2.

### The deferred range conformance fixture proves range semantics

It does not. The fixture and its recorded rejection demonstrate a deferred/unsupported path, not a complete execution contract.

### Enum was planned for a future version

This establishes historical intent, not a V2 requirement or an enum semantic model.

### `PE009` establishes the enum design

It does not. It establishes intentional rejection behavior within its covered scope.

### Foreign C enum support establishes UR enum support

It does not. Interoperability with a foreign representation does not create a native UR declaration or type contract.

### Interpreter or C behavior defines the language

Rejected. Implementations are subjects of conformance to the language contract, not sole authorities over it.

## Language, Implementation, Verification, and Documentation Boundaries

Point 3 establishes language requirements only.

### LD-1

Language requirement:
`IN` is contextual and not globally reserved.

Point 4 concern:
preserve or implement the required behavior without breaking the Localization boundary.

Verification:
contextual use and ordinary identifier use, including multilingual coverage.

### LD-2

Language requirement:
shared constructs have backend-neutral observable semantics.

Point 4 concern:
each execution path claiming support must implement the specified semantics.

Verification:
cross-path tests based on the language contract, not an implementation-as-oracle assumption.

### LD-3

Language requirement:
none for range iteration in the current V2 scope; the feature is deferred.

Point 4 concern:
no range implementation is required by this decision.

Verification concern:
do not claim range support implicitly; investigate inconsistent failure boundaries only through a dedicated gate if required.

### LD-4

Language requirement:
none for native enum declarations in the current V2 scope; the feature is deferred.

Point 4 concern:
no enum implementation is required by this decision.

Verification:
existing rejection behavior must not be silently mistaken for native enum support.

### LD-5

Language requirement:
`&&` and `||` use short-circuit evaluation.

Point 4 concern:
all execution paths claiming support must implement that evaluation contract.

Verification:
use observable side effects and cover all four left-operand/operator combinations.

## Evidence Boundaries

Point 3 did not perform a full compiler test suite, full conformance run, backend matrix, security assessment, or implementation modification.

Tests found in source were treated as evidence of intended or recorded contracts unless they were explicitly executed during the investigation.

An important provenance issue was discovered during behavioral probing:

`bin/ur.mjs` prefers an existing `dist/src/cli/index.js` when present. The local `dist` artifact was present, untracked, and ignored through the repository's `dist/` ignore rule. Its relationship to the verified HEAD was not established.

Therefore behavioral results initially obtained through that artifact were not treated as authoritative current-source evidence where provenance mattered.

Current-source behavior was subsequently probed directly through the TypeScript CLI where required for the range investigation.

No statement in this report that defines a V2 language requirement should be read as a claim that the current implementation already conforms.

## Point 3 Decision Ledger

- LD-1 — Contextual `IN`: **APPROVED**
- LD-2 — Backend-neutral observable semantics: **APPROVED**
- LD-3 — Range iteration: **DEFERRED**
- LD-4 — Enum declarations: **DEFERRED**
- LD-5 — Logical `&&` / `||` short-circuit semantics: **APPROVED**

UR V2 favors a smaller set of explicit, testable language contracts over importing historical future-feature lists as implicit commitments.

## Transition Requirement

Point 3 is not closed merely because the language decisions have been made.

Closure requires:

1. this report to be reviewed against the evidence;
2. confirmation that no implementation code was unintentionally modified as part of Point 3 documentation;
3. repository-state verification;
4. explicit staging of this report only;
5. staged-diff verification;
6. commit;
7. push;
8. final verification that the intended branch and remote-tracking reference contain the Point 3 report;
9. formal declaration of Point 3 as `CLOSED + DOCUMENTED + PUSHED`.

Only after those conditions are satisfied may the five-point roadmap move to:

**Point 4/5 — Implementation & Verification.**
