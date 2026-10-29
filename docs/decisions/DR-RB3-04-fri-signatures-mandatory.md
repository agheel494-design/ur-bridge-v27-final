# DR-RB3-04 — FRI manifests: sibling `signatures.ur` is mandatory (post-hoc record of "P1-7")

**Status:** APPROVED (PM; post-hoc record). **No standalone "P1-7 Design Gate" document exists in the tree.** The decision is
recorded only in code: `src/cli/index.ts` around the `signaturesPath` check, with the comments "P1-7 Design Gate,
Finding A … No fallback to the old template is permitted … Design Gate §3".

## Contract (as in force)
Every manifest-based package must have a sibling `signatures.ur` declaring each export. The arity and types come
from that file. If the file is missing, the import fails with **IM1001** and no fallback is used.

## Cases covered (RB3-B1)
21 tests write `manifest.json` without `signatures.ur` and therefore fail with IM1001:
- `multi_language_test` 9;
- `fn-external-contract-protection` 5;
- `fri_manifest_test` 4;
- `decision-2d-boundary-protection` 1;
- `call_external_design_limitations` 1;
- `language-core-audit-suite` 1.

Realignment: add the `signatures.ur` fixtures, keeping every expected value unchanged.
