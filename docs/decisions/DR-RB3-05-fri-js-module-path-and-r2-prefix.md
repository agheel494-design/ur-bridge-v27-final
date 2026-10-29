# DR-RB3-05 — FRI: JS/TS relative module paths, and the R2 structured failure prefix

**Status:** APPROVED (PM, Gate 3 decision). **Nature:** both behaviours are already in the implementation. This
record documents them; it does not introduce them.

## (a) P1-7 Finding B: JavaScript/TypeScript module path resolution
A `./`- or `../`-relative `module` in a `javascript` or `typescript` manifest is resolved **relative to the manifest's
own directory**, not the process cwd. A bare module name is passed through unchanged.

Source: `src/cli/index.ts`, comment "P1-7 Design Gate, Finding B (JavaScript half)", and the P1-2-T
Implementation Gate (TypeScript).

Python modules are not rewritten; the manifest directory is placed on `PYTHONPATH`. The compiled runtimes keep their
existing resolution. Test realignment: fixtures use `./<file>`, relative to the manifest.

## (b) R2 structured failure contract: the `FRI_*` prefix
FRI panics carry a typed category prefix, for example `UR panic: FRI_FAILED: external call 'f' …`. The prefix belongs
to the R2 failure taxonomy (`FRI_FAILED`, `FRI_TIMEOUT`, `FRI_OUTPUT_LIMIT`, `FRI_RUNTIME_NOT_FOUND`, …).

Test realignment: assertions check the prefixed form.

## Cases covered
- `fn-external-contract-protection` 5;
- `fri_manifest_test` 1;
- `multi_language_test` 1;
- `language-core-audit-suite` 1.
