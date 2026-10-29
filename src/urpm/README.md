# `src/urpm/` — UR Package Manager

**Status:** ✅ closed (Phase 2). Full command suite implemented and tested
(108/108 tests, 0 TypeScript errors). This document previously read
"not started" — that was stale and has been corrected as part of the
Phase 6.5 Hardening pass documentation review.

## Modules

| File | Responsibility |
|------|-----------------|
| `manifest.ts` | SemVer parsing/comparison, `VersionConstraint` parsing (`^`, `~`, exact, ranges), `Manifest` / `LockFile` types + JSON (de)serialization |
| `dependency-graph.ts` | `DependencyGraph` — package node graph, version-conflict detection, `RCODES` diagnostics, `pickBestVersion` |
| `resolver.ts` | `Resolver` — turns a manifest's declared dependencies into a fully-resolved dependency graph |
| `registry.ts` | `PackageRegistry` — in-memory package registry abstraction (publish/lookup), `REGISTRY_CODES` diagnostics |
| `cache.ts` | `PackageCache` — content-addressed local package cache |
| `commands.ts` | CLI command implementations: `cmdInstall`, `cmdRemove`, `cmdUpdate`, `cmdSearch`, `cmdPublish`, `cmdVerify` |
| `index.ts` | Public API surface re-exporting the above |

## Commands

| Command | Description |
|---------|-------------|
| `urpm install <pkg>` | Add a dependency to the manifest and resolve it against the registry |
| `urpm remove <pkg>` | Remove a dependency |
| `urpm update` | Re-resolve all dependencies to the latest versions satisfying their constraints |
| `urpm search <query>` | Search the package registry |
| `urpm publish` | Validate and publish a package to the registry |
| `urpm verify` | Check that the manifest and lock file are consistent (locked versions satisfy declared constraints) |

Produces:
- `urpm.json` — declared dependencies and metadata (`Manifest`)
- `urpm.lock` — fully-resolved, content-addressed lock file (`LockFile`)

## Boundary

- **Does not** implement an import system inside the compiler (that is
  `src/compiler/` + `src/semantic/` + `src/module/`).
- **Does not** implement a registry *server* — `registry.ts` is client-side
  tooling; a real network-backed registry is a future phase.
- Native package resolution and ABI compatibility gating for compiled
  artifacts lives in `src/ffi/urpm-native/`, layered on top of this module.

## Tests

`tests/urpm/urpm.test.ts` — 108/108 passing. Covers SemVer parsing,
constraint satisfaction, manifest/lockfile round-tripping, dependency
graph conflict detection, and all six CLI commands including error paths
(missing name, invalid version, invalid constraint, missing/violated lock
entries).
