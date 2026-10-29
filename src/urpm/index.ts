// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Public API
// ─────────────────────────────────────────────────────────────────────────────

// Manifest + SemVer + LockFile
export {
  parseSemVer,
  semVerToString,
  compareSemVer,
  parseVersionConstraint,
  satisfies,
  makeManifest,
  manifestToJson,
  manifestFromJson,
  makeLockFile,
  lockFileToJson,
  lockFileFromJson,
  type SemVer,
  type VersionConstraint,
  type PackageDependency,
  type Manifest,
  type LockedPackage,
  type LockFile,
} from "./manifest.js";

// Dependency graph
export {
  DependencyGraph,
  buildGraph,
  pickBestVersion,
  RCODES,
  type PackageNode,
  type ResolutionDiagnostic,
  type ResolutionResult,
} from "./dependency-graph.js";

// Registry
export {
  PackageRegistry,
  REGISTRY_CODES,
  type RegistryPackage,
  type RegistryPackageVersion,
  type RegistryDiagnostic,
} from "./registry.js";

// Resolver
export {
  Resolver,
  type ResolveOutput,
} from "./resolver.js";

// Cache
export {
  PackageCache,
  type CacheEntry,
} from "./cache.js";

// Commands
export {
  cmdInstall,
  cmdRemove,
  cmdUpdate,
  cmdSearch,
  cmdPublish,
  cmdVerify,
  type CommandResult,
  type InstallResult,
  type RemoveResult,
  type UpdateResult,
  type SearchResult,
  type PublishResult,
  type VerifyResult,
} from "./commands.js";
