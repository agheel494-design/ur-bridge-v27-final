UR V2.0 — Point 1 Discovery Report
Status: Closed
Phase: V2.0 — Point 1: Discovery
Branch: release/v1.0-candidate
Baseline: 6cf7da2d87776c10dbbe967dbc40072842322bf9

Why this review was done
Before making architectural changes for UR V2.0, I wanted a reliable picture of what the project actually looks like today.

The repository already contains a large amount of design material, audit reports, historical notes, specifications, and previous engineering work. Those documents are useful, but they were written at different stages of the project. For this review, the source tree and the current implementation were treated as the primary evidence.

No compiler or runtime code was changed during this discovery work. The purpose was simply to understand the system we are about to evolve.

The local branch was checked after fetching from origin. At the start of the review, both the local HEAD and origin/release/v1.0-candidate resolved to:

6cf7da2d87776c10dbbe967dbc40072842322bf9

The working tree also contained a number of pre-existing untracked files. They were left alone.

What the compiler looks like today
The compiler is not one large component. The source tree separates the frontend, semantic analysis, type system, lowering, runtime-facing code, interpreter, optimizer, and backends.

The frontend itself is small:

src/compiler/frontend/lexer.ts
src/compiler/frontend/parser.ts
src/compiler/frontend/ast.ts
The lexer turns source text into tokens. The parser consumes those tokens and produces the program AST used by later compiler stages.

One important detail is that multilingual support begins before parsing.

The lexer imports AGGREGATED_KEYWORD_MAP from the localization layer. That layer combines the language descriptors currently present for Arabic, English, French, Spanish, German, Japanese, Russian, Chinese, Portuguese, and Hindi.

This means the multilingual keyword system is not implemented as ten independent parsers. Surface-language words are mapped into a common lexical representation that the rest of the compiler can work with.

There is one interesting exception worth carrying into the V2 architecture review.

The word corresponding to in in a for statement is treated as a contextual identifier. parser.ts calls isCanonicalIn() from the localization layer to determine whether the current identifier represents the canonical in concept.

So the parser is mostly insulated from literal language spellings, but it is not completely independent of localization.

That is not being classified as a bug here. It is simply an architectural choice that V2 should review deliberately.

Semantic analysis and type checking
Both semantic analysis and type checking consume the frontend Program AST directly.

The Semantic Analyzer exposes:

analyze(program, externalFunctionNames?)

and imports its AST types from src/compiler/frontend/ast.ts.

The TypeSystem exposes:

typeCheck(program, externalStructTypes?)

and also consumes the same frontend AST.

The important point is that these are separate compiler stages. They are not one combined checker.

The actual CLI path confirmed their ordering.

For the compilation path inspected in src/cli/index.ts, the sequence is:

Program AST -> Semantic Analysis -> Type Checking -> IR Lowering

Semantic errors stop the path before it proceeds further. Type errors likewise prevent IR lowering.

This ordering came from reading the current CLI implementation rather than assuming that an older architecture diagram still describes the system correctly.

The IR is more complicated than a simple SSA model
IR lowering is performed through lowerToIR(), which produces an IRModule.

The main IR definitions are not inside a backend. They live in:

src/shared/ir.ts

That makes the IR a shared boundary between compiler components.

An IRModule contains functions and external definitions. Functions contain basic blocks, instructions, local slots, parameters, return information, and the data needed by downstream execution paths.

Control flow is represented explicitly through block terminators, including returns and conditional and unconditional branches.

The IR also supports operations for arrays and structures in addition to ordinary scalar operations.

The most important architectural observation from this review is that the current IR is not a pure SSA-only representation.

It combines SSA-style value IDs with explicit local storage slots and additional array/structure storage information.

IRLocalSlot has an ID space separate from SSA value IDs.

This design may be entirely reasonable given how UR reached its current state, but V2 should not inherit it accidentally. We need to decide whether this mixed value/storage model is the representation we actually want to maintain long-term.

That decision belongs to Point 2.

What ur run actually executes
The CLI path inspected during Discovery lowers the program to IR and then passes that IR to the interpreter.

interpretModule() accepts an IRModule directly.

So for the normal execution path we traced, the system is:

AST -> Semantic -> TypeCheck -> IR -> Interpreter

The inspected cmdBuild() path also starts with compileToIR(). It writes a JavaScript artifact containing serialized IR and uses the interpreter infrastructure to execute it.

This was an important finding because the repository also contains C, WebAssembly, and LLVM backends. Their existence does not mean that the CLI path we inspected automatically goes through one of them.

The optimizer exists, but it is not in the traced CLI pipeline
UR has a real optimizer implementation under src/optimizer/.

It contains constant folding, dead-code elimination, dominance analysis, liveness analysis, dataflow analysis, control-flow analysis, validation, and a pass driver.

The main driver we inspected is:

runPipeline()

Repository-wide search found its actual uses in optimizer tests and development tools.

During this Discovery pass, no call to runPipeline() was found in the production src execution paths that we searched.

So I am not recording the optimizer as part of the verified default CLI pipeline.

That statement needs to stay narrow. It does not mean that no optimization occurs anywhere else. Lowering or individual backends may perform transformations of their own.

The only conclusion from Point 1 is that the optimizer's runPipeline() driver was not shown to be wired into the CLI path we traced.

Backends
Three backend families are present:

C
WebAssembly
LLVM
The C backend exposes:

emitC(module: IRModule)

The WebAssembly backend exposes:

emitWasmModule(module: IRModule)

The LLVM builder exposes:

buildLLVMModule(module: IRModule)

All three therefore have an interface capable of consuming the shared IR.

C and WebAssembly are used in repository tests and tooling. LLVM also has dedicated backend test coverage visible in the repository.

What we did not find during the traced CLI investigation was a direct call from the inspected run or build path into these backend entry points.

For V2, that distinction matters.

We have backend implementations, but we still need to decide which execution route is supposed to be authoritative and how those backends are meant to participate in the normal compiler workflow.

Interpreter, sandbox, and external runtimes
The interpreter is doing more than evaluating arithmetic IR instructions.

It implements several UR runtime operations directly, including basic output, string input, panic handling, and related runtime calls.

UR i64 values are represented with JavaScript bigint in the interpreter rather than being reduced to ordinary JavaScript numbers.

The interpreter also contains sandbox handling.

The sandbox policy inspected during this review includes filesystem and network capabilities. Filesystem reads are checked against granted scopes before the read occurs. Network access uses host-provided endpoint mappings in the path we inspected.

Other FFI calls are rejected in that sandboxed dispatch path.

This review did not attempt to prove the sandbox secure. It only established how the current implementation is structured.

Outside that sandbox path, the interpreter contains the FRI dispatch machinery.

Runtime branches are present for:

Python
JavaScript
native
C
Rust
C++
WebAssembly
Go
Java
TypeScript
Several of those branches visibly contain real wrapper generation, compilation, or execution logic.

That is enough for Discovery. It is not enough to claim that every runtime integration is complete or correct, and no such claim is made here.

Runtime and memory management
UR also has a C runtime:

runtime/ur_runtime.c
runtime/ur_runtime.h
This runtime is not limited to printing values.

The inspected interface includes runtime initialization and shutdown, I/O operations, memory-related functions, array support, and garbage-collection infrastructure.

The implementation contains functions including:

ur_runtime_init
ur_runtime_shutdown
ur_free
ur_register_array_allocation
ur_free_array
ur_gc_alloc_array
ur_array_length
ur_gc_push_frame
ur_gc_pop_frame
ur_gc_set_root
ur_gc_get_root
ur_gc_collect
The presence of those functions does not prove that every compiler path uses every part of the runtime. That relationship will need to be considered during the architecture review.

Existing V1-to-V2 work
There is already a V1-to-V2 transition document:

docs/proposals/TRANSITION_NOTE_v1_to_v2.md

Its scope is narrower than this report.

That document records the transition around ArrayObjectModel, where a Semantic-layer consumer was introduced while the existing lowering/backend model remained protected at that transition point.

It should remain as its own historical/design record.

This report does not replace it. Point 1 is the wider baseline review of the system we are inheriting for V2.

Questions carried into Point 2
Discovery found several areas where V2 needs an explicit architectural answer.

We need to decide whether the Parser should continue handling contextual language concepts such as in.

We need to decide whether the existing separation and ordering of Semantic Analysis and Type Checking is the right long-term boundary.

The hybrid IR deserves a deliberate decision. In particular, we need to decide whether SSA values, mutable local slots, array storage, and structure storage should continue to live together in the same shared representation.

The optimizer needs a defined role. If it is meant to be part of normal compilation, that integration should be explicit rather than assumed.

The same applies to execution. UR currently has an interpreter as well as C, WebAssembly, and LLVM backend implementations. V2 needs a clear answer about which paths are authoritative and what equivalence is expected between them.

Sandbox, FRI, and general external calls also need a coherent boundary.

Finally, the Runtime and GC interfaces need to be examined as contracts rather than simply inherited because they already exist.

None of those questions is being answered in this report.

That is the purpose of Point 2.

What was not done
This Discovery pass did not rerun the full test suite or reopen the already completed V1 release gates.

It did not benchmark the compiler.

It did not perform a security audit of the sandbox.

It did not try to prove feature completeness for C, WebAssembly, LLVM, or each FRI runtime.

It did not modify the compiler, runtime, optimizer, or backends.

It also did not clean or remove the pre-existing untracked and backup files found in the working tree.

This was an architecture discovery pass, not an implementation or verification campaign.

Conclusion
Point 1 has done what it was intended to do.

We now have a source-based picture of the system that V2 is actually inheriting, including the compiler frontend, multilingual mapping, semantic and type stages, shared IR, interpreter, optimizer, backends, sandbox/FRI boundary, and C runtime.

There are architectural questions in that system, but Discovery is not the place to answer them.

UR V2.0 — Point 1: Discovery is closed.

The next phase is Point 2: Architecture Assessment.

Point 2 should start from the implementation described here and decide what UR V2 will deliberately preserve, what it will redesign, and which boundaries must be frozen before implementation begins.