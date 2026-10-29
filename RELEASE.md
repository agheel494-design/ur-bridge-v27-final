# RELEASE.md

**This is the single, official record for this release.** The
**Release Tag** below is the official reference for this release —
not a commit hash embedded in this file, which would create a real,
unresolvable circular dependency (this file's own content determines
its own commit hash; writing that hash into the content changes the
content, which changes the hash again). This is the standard, common
approach: the tag is created after this file's own commit, and points
to it directly — no self-reference problem exists at the tag level.

**Fixed field order (kept identical across every future release, to
make cross-release comparison straightforward):**

## Release Name
WASM Nested Control Flow (Layer 1 + Layer 2) + LLVM Backend
Memory-to-SSA Readiness

## Release Date
2026-08-01

## Release Tag
`milestone-release-record-v2` — the official reference for this
exact release. Verify via: `git show milestone-release-record-v2`.

## Baseline Commit (Built From)
`f2bbcaa25f744a453ad7bc0d0e4d496fa6bc2b66` — the last commit *prior*
to this release's own tag (the real state this release was built
from), not this file's own commit (avoiding the circular
self-reference described above).

## Test Summary

| Suite | Passed | Failed |
|---|---|---|
| WASM `emit-wasm.test.ts` | 190 | 0 |
| WASM `golden/golden.test.ts` | 25 | 0 |
| WASM `layer1-structural-proof.test.ts` | 4 | 0 |
| WASM `nested-control-flow-layer1.test.ts` | 6 | 0 |
| WASM `layer2-nested-if-execution.test.ts` | 7 | 0 |
| WASM `layer1-wiring-proof.test.ts` | 3 | 0 |
| LLVM `rebuilt-comprehensive.test.ts` | 15 | 0 |
| **Total** | **250** | **0** |

## Tests Added
10 total (7 in `layer2-nested-if-execution.test.ts`, 3 in
`layer1-wiring-proof.test.ts`).

## Tests Changed
3 (`emit-wasm.test.ts` — nested-if/nested-merge/if-inside-if+array,
from expecting rejection to expecting acceptance, per the deliberate,
approved spec change).

## Tests Removed
2 (`emit-wasm.test.ts`'s own `DIAGNOSTIC QUALITY FIX`,
`layer1-structural-proof.test.ts`'s own duplicate rejection test —
both tested a since-reversed rejection).

## Known Limitations
- LLVM Backend Tier 2 (real `clang`/`llc` compile+run) — **Not Yet
  Verified**. No LLVM toolchain in this sandbox; `apt-get install
  clang llvm` fails (403 Forbidden, network-restricted).
- WASM: loops nested inside/around `if` — not supported (out of
  scope for this Milestone, per explicit boundary).
- WASM: recursion — not supported (deferred pending a real
  stack-depth/growth decision).
- WASM Layer 2's own nested-if acceptance does not yet run the
  deeper per-block semantic checks (e.g. Expression Tree Property)
  that single-level shapes receive.
- No remote Git repository configured in this sandbox (confirmed:
  `git remote -v` returns empty).

## Produced Artifacts
- Backup ZIP: `ur-language-latest.zip`
- Git Tag: `milestone-release-record-v2`

---

## Checklist

- [x] All WASM tests pass. (235/235 across 6 real test files)
- [x] All LLVM tests pass. (15/15)
- [x] No open TODOs blocking release. (5 raw matches, all previously documented/tracked — see `docs/ARCHITECTURE_FREEZE_AUDIT.md`)
- [x] A real `git tag` exists for this release/Milestone.
- [x] A `.zip` backup exists and is verified extractable.
- [x] `CHANGELOG.md` updated with this release's own real changes.

## How to run this checklist (the real commands, for anyone — human or Claude — executing this in a future session)

```bash
# 1. WASM tests
tsx run-tests.ts tests/backend/wasm/emit-wasm.test.ts
tsx run-tests.ts tests/backend/wasm/golden/golden.test.ts
tsx run-tests.ts tests/backend/wasm/layer1-structural-proof.test.ts
tsx run-tests.ts tests/backend/wasm/nested-control-flow-layer1.test.ts
tsx run-tests.ts tests/backend/wasm/layer2-nested-if-execution.test.ts
tsx run-tests.ts tests/backend/wasm/layer1-wiring-proof.test.ts

# 2. LLVM tests
tsx run-tests.ts tests/backend/llvm/rebuilt-comprehensive.test.ts

# 3. TODO/FIXME/HACK scan
grep -rn "TODO\|FIXME\|HACK" src/

# 4. Confirm the tag
git show milestone-release-record-v2 --stat

# 5. Verify the zip
python3 -c "import zipfile; z = zipfile.ZipFile('ur-language-latest.zip'); print(z.testzip())"

# 6. Confirm CHANGELOG.md was updated
git log -1 --stat -- CHANGELOG.md
```
