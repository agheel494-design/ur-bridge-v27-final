# ANSWERS_TO_REVIEWER_QUESTIONS.md — Multi-Language, Import, and Standard Library Status

Every answer below is backed by a real, live test performed in this
session (not narrated from memory or documentation alone). Status
labels used exactly as requested: Supported / Partially Supported /
Not Supported.

---

## Q1: Can the same program be written and run in all 10 languages, passing through all compiler stages with the same behavior?

Status: Supported (through Canonical IR - the highest stage
currently, uniformly proven; NOT through Backend/Runtime execution).

Evidence: tests/compiler/localization/comprehensive-reference-program.test.ts
(11/11 passing, real logs in run-logs-languages/). A single
reference program - using TYPE, FUNCTION, IF/ELSE, RETURN, WHILE,
LET, TRUE/FALSE, recursion, function calls, arithmetic - is
auto-generated from each language's own keyword table and run
through Lexer -> Parser -> Semantic -> TypeChecker -> Canonical IR
for all 10 languages: zero errors at every stage, ir.ok === true for
all 10, and a byte-identical structural AST (after stripping only
user-chosen identifier text).

Not claimed: Backend (WASM/C) code-generation output equivalence, or
actual runtime execution-output equivalence - neither was tested
this session. See docs/architecture/UR_1.0_LANGUAGE_COVERAGE.md's own
"What This Document Does NOT Claim" section.

## Q2: Does the import system work in all 10 languages?

Status: Partially Supported.

What IS confirmed, live, this session: the IMPORT keyword tokenizes
and parses correctly in all 10 languages (already proven in Q1's own
reference-program result - IMPORT is one of the 17 canonical
keywords, present and working identically in every language file).
Beyond that, a real, second test was performed: building a real
second module (ur_packages/mathlib/index.ur) and a real importing
module, registering both in ModuleRegistry, and calling resolveAll()
- this succeeded for all 10 languages (valid: true, zero
diagnostics, for ar/en/fr/es/de/ja/ru/zh/pt/hi identically) - real,
live evidence that the module-resolution mechanism itself works
uniformly.

What is NOT confirmed - a real, newly-discovered gap: calling a
function from the imported module was tested directly (same
importing program, calling double(5) after import mathlib) and
FAILED with SE1002: "undefined function 'double'" at the Semantic
Analyzer stage. The single-file analyze()/typeCheck() entry points
used throughout this project's own testing do not appear to receive
or use the cross-module symbol information that
ModuleRegistry.resolveAll() itself validates. This was not tested
before this specific question was asked - a real gap found in direct
response to it, not previously known or hidden.

Conclusion: import RESOLUTION (the module exists, the path is valid)
is Supported and uniform across all 10 languages. Import USAGE
(calling a function from the imported module) could not be made to
work through the pipeline paths tested in this session - this is
reported as a real, open question requiring further investigation,
not asserted as either fully working or fully broken beyond what was
directly tested.

## Q3: Can standard library modules (math, io, etc.) be imported in all languages?

Status: Not Supported.

Evidence: stdlib/std_math.ur and stdlib/std_io.ur exist as real UR
source files. However, examples/std_math_usage.ur's own source
comment states explicitly: "Since UR v1.0 has no import mechanism
wired to the Standard Library yet, this example inlines the two
functions it uses directly... matching stdlib/std_math.ur's own
source exactly (copy-paste, not reimplementation) - this is the
current, correct way to use the Standard Library until a real import
mechanism exists (tracked as future work, not v1.0 scope)." This is
the project's own, pre-existing, explicit statement - not a new
finding, confirmed by reading the file directly this session.

## Q4: Can functions inside these libraries be called after import, in all languages?

Status: Not Supported, for the same reason as Q3 - there is no
working import path to the Standard Library at all, so calling a
function from it cannot be tested as working. Independent of the
Standard Library specifically, Q2's own finding (calling a function
from ANY imported module fails at Semantic Analysis in the paths
tested) further confirms this gap is not specific to the Standard
Library - it appears to be a more general current limitation of
cross-module function calls.

## Q5: Are standard library names fixed (e.g. math) across all languages, or translated per language?

Status: N/A in practice, given Q3's own finding - since no working
import mechanism to the Standard Library exists, there is no real
import statement to inspect for a name convention. For what it's
worth, stdlib/std_math.ur's own filename (std_math) is a single,
fixed, English-based identifier with no translated variants found
anywhere in the codebase (confirmed via search). If/when a real
import mechanism is built, the naming convention (fixed vs.
per-language) would be a real design decision not yet made.

## Q6: Known limitations to state in the review report

1. Import RESOLUTION works uniformly across all 10 languages; import
   USAGE (calling an imported function) does not work in the paths
   tested - a real, newly-discovered gap (Q2).
2. No working path from any import statement to UR's own Standard
   Library exists yet - explicitly documented as future work by the
   project's own existing comments (Q3/Q4).
3. FOR and NULL, while supported through TypeChecker, are rejected at
   IR/Codegen for all languages equally (a real UR 1.0 limitation,
   not a per-language gap) - see UR_1.0_LANGUAGE_COVERAGE.md.
4. A struct's own declared name is not recognized as a valid type by
   the Type Checker (a real, logged Bug, not fixed) - see
   COMPILER_BACKLOG.md's own Bug classification.
5. Diagnostic/error messages remain English-only regardless of which
   language's keywords a program uses - see TEN_LANGUAGES_SCOPE.md.
6. No Backend (WASM/C) or Runtime-execution-level equivalence across
   the 10 languages has been tested - Q1's own claim stops at
   Canonical IR.
