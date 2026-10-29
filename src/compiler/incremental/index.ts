// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Incremental Compilation: Public API
// ─────────────────────────────────────────────────────────────────────────────

// FileFingerprint
export {
  hashContent,
  makeFingerprint,
  fingerprintsEqual,
  fingerprintMatchesContent,
  computeSnapshot,
  diffSnapshots,
  snapshotToJson,
  snapshotFromJson,
  type FileFingerprint,
  type FingerprintSnapshot,
  type FingerprintSnapshotJson,
  type SnapshotDiff,
} from "./fingerprint.js";

// BuildCache
export {
  BuildCache,
  type CompiledArtifact,
  type CachedDiagnostic,
  type BuildCacheStats,
  type BuildCacheJson,
} from "./build-cache.js";

// DependencyTracker
export {
  DependencyTracker,
  type DepNode,
  type ChangeDetectionResult,
  type TopologicalResult,
  type DependencyTrackerJson,
} from "./dependency-tracker.js";

// IncrementalPipeline
export {
  IncrementalPipeline,
  makeStubPipeline,
  type CompilerFn,
  type CompilerFnResult,
  type PipelineOptions,
  type BuildResult,
  type BuildInput,
  type FileDiagnostic,
  type StubCompilerEntry,
} from "./pipeline.js";
