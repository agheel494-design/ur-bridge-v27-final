UR V2.0 — Point 2 Architecture Assessment
Purpose
This report records the architecture assessment performed for UR V2.0 after the completion of Point 1 — Discovery.

Point 1 established the source-based baseline of the system inherited from V1 and deliberately left several architectural questions unresolved. Point 2 examined those questions against the current implementation and made explicit decisions about what V2 should preserve, what should be refined, and what should not be changed without additional evidence.

The assessment was performed on:

release/v1.0-candidate

with the repository HEAD verified at:

3ceeca104e28a15c542d4505482514c12d8a3722

The same commit remained checked out when the assessment was completed and documentation began.

No compiler, runtime, optimizer, interpreter, backend, or language implementation code was changed during this assessment.

The pre-existing untracked files in the working tree were not cleaned, staged, or modified as part of this work.

This report builds on UR_V2_POINT1_DISCOVERY_REPORT.md. It does not replace Discovery or reopen the V1 release gates.

docs/proposals/TRANSITION_NOTE_v1_to_v2.md also remains a separate design and historical record. Its ArrayObjectModel transition scope is narrower than this assessment and was not folded into this report.

How the assessment was made
The current source remained the primary evidence.

Historical specifications, comments, transition notes, and completed gate records were useful for explaining why parts of the system exist, but they were not treated as stronger evidence than the current implementation.

Where comments described an earlier development stage that no longer matched the source tree, the current implementation was used for the architectural decision.

The assessment also deliberately distinguished between:

behavior that V2 must preserve for compatibility;
representation choices that may be refined without changing semantics;
implementation details that should not automatically become frozen V2 contracts;
language-design questions that belong to Point 3 rather than Point 2;
and changes that would require a separate evidence gate before they could be authorized.
The decisions below are architecture decisions. They are not implementation authorization.

Shared IR
The shared IR is intentionally hybrid in practice.

It combines SSA-style values with mutable local storage. Local slots are used for state that must survive reassignment and control-flow merge points, including loop-carried state, without requiring the current compiler architecture to introduce phi nodes for those cases.

The evidence does not support replacing this model with a pure-SSA architecture.

At the same time, the current representation exposes storage details broadly. IRValueRef may identify an SSA value or carry array/structure slot information, and several consumers understand those representation details directly.

The assessment also found a more specific boundary leak around runtime-length metadata. The IR builder constructs C-oriented length parameter names and stores runtimeLengthCName in shared IR metadata consumed by the C backend. Runtime array length is a legitimate shared semantic concern; a C identifier used to realize that concern is not the same thing.

Decision AD-1: Preserve the hybrid SSA/storage semantics. Refine representation boundaries. Do not perform a wholesale IR rewrite or pure-SSA conversion without new evidence.

For V2, the important distinction is between preserving the semantics of mutable storage and freezing every current representation detail. Those are not the same decision.

Backend capability subsets are also legitimate. A backend is not required to silently support every shared IR instruction. WebAssembly, for example, has an explicit validation boundary and rejects unsupported IR rather than treating the entire shared IR as automatically supported.

Optimizer
The optimizer is a real architectural component, not an empty placeholder.

The current source contains an optimization pass abstraction, structural validation around the pass pipeline, constant folding, dead-code elimination, and supporting control-flow/dataflow analyses. A full-pipeline integration test also constructs an explicit optimization sequence using constant folding followed by dead-code elimination before C emission.

At the same time, repository-wide investigation did not establish runPipeline() as part of the normal production CLI path. Its direct uses found during the assessment were concentrated in optimizer tests and development tools.

That distinction matters. A tested optimizer is not automatically a mandatory compilation policy.

Decision AD-2: Preserve the optimizer as a first-class, explicit capability. Do not make it a mandatory default compilation stage without a separate gate.

Any future proposal to change the normal pipeline to include optimization by default must explicitly establish semantic preservation, define the optimization policy, and verify compatibility with the execution/backend paths that the proposal claims to support.

The older commentary in pass.ts describing an earlier zero-pass or first-item state is historical and no longer describes the complete optimizer source tree. That is documentation debt, not evidence that the current optimizer is absent.

Execution paths and backend equivalence
The interpreter is operationally central to the current system.

The inspected ur run path compiles to IR and executes that IR through interpretModule().

The inspected ur build path also begins with IR. It emits a JavaScript artifact containing serialized IR and uses the interpreter infrastructure to execute that artifact. The generated artifact therefore remains tied to interpreter infrastructure rather than representing evidence that build currently routes through the C, WebAssembly, or LLVM backend.

The interpreter is also used by IDE and sandbox-related execution paths.

This establishes the interpreter as an important inherited operational execution path. It does not make the interpreter implementation itself the specification of the UR language.

The C backend is also a real execution backend. Existing interpreter tests include direct differential cases where the same IR is executed through the C backend and the interpreter and selected observable results are compared. Those tests explicitly use the C backend as a ground truth for that test suite.

That testing convention does not make the C implementation the language specification either.

The differential evidence reviewed in Point 2 is meaningful but limited. It does not prove complete semantic equivalence across all behavior, error handling, effects, FRI behavior, sandbox behavior, or all backends.

Decision AD-3: Preserve the interpreter as the primary operational execution path inherited from V1. Do not elevate either the interpreter or the C implementation into the language specification. Preserve differential verification and require an explicit backend-neutral equivalence contract.

A backend may support a documented subset of the shared IR. When multiple execution paths claim support for the same construct, however, V2 needs an explicit definition of the observable behavior that must agree.

The language-level details of that equivalence contract belong to Point 3 where they affect language semantics. Point 2 establishes that the contract must exist.

Sandbox, FRI, and external effects
The interpreter currently owns more than IR instruction evaluation.

The inspected source shows sandbox policy evaluation, audit reporting, filesystem and network capability checks, privileged operations, FRI argument validation and serialization, timeout preparation, temporary result infrastructure, and runtime-specific foreign execution dispatch living within the broader interpreter execution path.

This is architectural coupling. It is not, by itself, evidence of a security vulnerability.

Point 2 did not perform a penetration test or security certification, and this report makes no claim that the sandbox is either comprehensively secure or insecure.

The existing capability behavior and FRI functionality also cannot simply be discarded. They are existing behavior with compatibility implications, and several boundary checks occur before the external effect or foreign process is started.

Decision AD-4: Preserve behavior; refine responsibility boundaries.

V2 should preserve the capability semantics, audit behavior, deny-before-effect behavior observed in the inspected paths, FRI functionality, exact-value handling required at foreign boundaries, and existing process-boundary restrictions unless a separately evidenced change is authorized.

At the same time, IR execution semantics should not remain unnecessarily coupled to the mechanisms that implement filesystem/network effects, sandbox policy, and foreign runtime dispatch.

Point 2 deliberately does not prescribe a new class hierarchy or host API. The required architectural boundary is frozen here; the concrete implementation shape is not.

Runtime and garbage-collection contract
The C runtime exposes a versioned runtime ABI and is an active dependency of generated C code.

The current C backend emits calls into runtime operations including GC-backed array allocation, runtime-mediated array length, and shadow-stack/root-management operations.

This means the Runtime/GC boundary cannot be treated as an implementation detail that V2 may freely replace.

The opposite conclusion would also be wrong. Not every type or test helper exposed by the current public header needs to become a permanent V2 architectural contract.

The assessment specifically examined UrGcHeader. Repository search across the source, runtime, tests, and tools found its use confined to runtime/ur_runtime.h and runtime/ur_runtime.c. The C backend uses runtime operations rather than directly reading this header layout, and the old direct array-length pointer-arithmetic pattern appears only as historical commentary in the inspected C emitter rather than as the current implementation.

That distinction is valuable. Generated code can depend on runtime semantics without depending on collector representation.

The public runtime header also contains test/configuration/introspection functions alongside generated-code-facing operations. Those interfaces do not necessarily require the same stability policy.

ur_free_array(ptr, length) is another representation debt candidate. The header documents that the length parameter is retained because of the current C call-argument encoding even though freeing the allocation does not require the length itself. Point 2 records the coupling but does not authorize an ABI change.

Decision AD-5: Preserve the versioned Runtime ABI and the behavioral contracts actually relied upon by generated code. Keep collector representation conceptually behind that boundary. Refine the distinction between production ABI, runtime implementation representation, and test/introspection interfaces.

No collector rewrite, trigger-policy redesign, ownership change, or breaking runtime ABI change is authorized by this assessment.

Any breaking ABI proposal requires independent evidence and an explicit migration gate.

Parser and localization boundary
The Parser currently treats in contextually in a for statement.

The Lexer delivers that surface word as an identifier in this case. The Parser knows that the grammar position requires the canonical IN concept and calls isCanonicalIn() rather than hardcoding any language-specific spelling.

isCanonicalIn() delegates the decision to the aggregated canonical localization map.

The Lexer also consumes localization infrastructure through the aggregated keyword map. The architecture therefore has a shared localization boundary rather than independent Arabic, English, or other language spellings embedded in frontend grammar code.

The Parser is responsible for grammatical context. The localization layer is responsible for mapping surface spellings to canonical language concepts.

The evidence does not justify moving all canonicalization into the Parser, nor does it justify turning in into an unconditional lexer keyword as an architecture cleanup. Either change could also become a language-design decision rather than a purely architectural one.

Decision AD-6: Preserve the localization boundary and the Parser's responsibility for contextual grammatical decisions expressed in canonical concepts rather than surface-language spellings.

This decision does not freeze the V2 grammar itself.

Whether in should remain contextual in the V2 language is deferred to Point 3. If the language design changes that rule, it requires an explicit language decision and a compatibility assessment rather than being smuggled in as a frontend refactor.

Semantic Analysis and Type Checking
Semantic Analysis and Type Checking are structurally separate stages in the current compiler.

Semantic Analysis performs its own declaration hoisting and scope-based walk and owns name/declaration/contextual semantic responsibilities.

The Type Checker creates its own type environment and struct-type registry and emits diagnostics for type-dependent constraints including assignment compatibility, boolean conditions, return types, array element types, operators, call argument types, and unknown types.

The production CLI path also enforces the ordering explicitly. Semantic Analysis runs first. Semantic errors terminate that compilation path before Type Checking begins. Type errors then form a separate failure boundary before downstream lowering.

There is limited coordination between the stages. For example, the Type Checker has paths that carry unknown type state in situations where an earlier semantic diagnostic may already own the primary error. This is evidence that the inter-stage contract matters; it is not evidence that the stages should be merged.

Decision AD-7: Preserve Semantic Analysis and Type Checking as separate stages and preserve the current Semantic → TypeCheck ordering. Refine and document the contract between them.

The V2 architecture should state more explicitly what invariants Semantic Analysis guarantees before Type Checking, which diagnostic categories belong to which stage, how unknown/error sentinel types prevent cascading diagnostics, and how external symbol/type information enters the two stages.

There is no current evidence justifying a unified analyzer, reversed ordering, or a new intermediate AST solely for architectural tidiness.

Architectural direction established by Point 2
Taken together, these decisions establish a conservative V2 architecture.

V2 should evolve the system by strengthening boundaries rather than replacing working subsystems without evidence.

The architecture direction is:

preserve the hybrid IR semantics while reducing representation leakage;
preserve the optimizer as an explicit first-class capability without silently changing default compilation policy;
preserve interpreter operational compatibility while defining backend-neutral equivalence expectations;
preserve sandbox/FRI behavior while separating execution semantics from privileged/external mechanisms;
preserve the generated-code Runtime ABI while keeping collector representation outside the frozen architectural contract where dependencies permit;
preserve the localization boundary and canonical frontend model;
preserve the Semantic → TypeCheck pipeline while making its inter-stage contract explicit.
These decisions intentionally protect V1 behavior and the stabilized core while allowing V2 to improve boundaries where the evidence showed coupling or unclear contracts.

Gates required before implementation decisions
Point 2 does not authorize implementation.

Several changes discussed during the assessment require additional evidence before they can become implementation work.

A proposal to make optimization mandatory in normal compilation requires an optimization integration gate establishing the intended pass policy, semantic preservation requirements, and backend/execution compatibility.

Changes affecting execution/backend authority require an equivalence gate with an explicit definition of observable equivalence for the supported constructs and execution paths.

A breaking Runtime ABI change requires a migration gate. Existing generated-code dependencies and compatibility requirements must be accounted for explicitly.

Changes to contextual syntax, including whether in remains contextual, belong to Point 3 and require an explicit language-design and compatibility decision.

Refactoring Sandbox/FRI boundaries must preserve the behavior Point 2 decided to retain and must not be represented as a security improvement unless separate security evidence supports that claim.

Representation refinements to the shared IR must preserve the hybrid semantics frozen by AD-1 and must be verified against the IR consumers affected by the refinement.

What remains deliberately unresolved
Point 2 did not design the V2 language.

It did not decide new syntax or new language features.

It did not define the final detailed backend-equivalence semantics.

It did not choose a concrete replacement abstraction for the current Sandbox/FRI coupling.

It did not design a replacement IR.

It did not make the optimizer mandatory.

It did not redesign the collector or change its trigger policy.

It did not perform performance benchmarking.

It did not perform a security audit of the sandbox or FRI implementation.

It did not prove feature completeness for the C, WebAssembly, LLVM, or individual FRI runtime integrations.

It did not rerun the V1 release gates or the full test suite because no implementation code was modified and those closed gates were not reopened by new contrary evidence.

Those limits are intentional. They prevent Architecture Assessment from silently becoming Language Design or Implementation.

Point 2 status
The seven architectural questions carried forward by Point 1 have each received an explicit architecture decision in this assessment.

The assessment itself was performed without modifying implementation code and remained anchored to:

release/v1.0-candidate

3ceeca104e28a15c542d4505482514c12d8a3722

Point 2 may be closed only after this report itself has been reviewed, checked, committed, pushed, and the resulting repository state has been verified.

Until then:

Point 2 — ASSESSED, DOCUMENTATION PENDING VERIFICATION

Point 3 — V2 Language Design has not started.