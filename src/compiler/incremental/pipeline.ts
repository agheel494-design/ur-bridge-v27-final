// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Incremental Compilation: IncrementalPipeline
//
// Orchestrates partial recompilation. Given a set of source files and
// their content, the pipeline:
//
//   1. Computes fingerprints for all files
//   2. Diffs against the previous snapshot (DependencyTracker)
//   3. Determines which files need recompilation
//   4. For unchanged files, returns cached artifacts (BuildCache)
//   5. For changed files, invokes the compiler function
//   6. Stores new artifacts in the cache
//   7. Updates dependency graph if imports changed
//   8. Returns a BuildResult with full diagnostics and timing
//
// The compiler function is injected (pure DI) so this module has
// no dependency on the actual compiler implementation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  computeSnapshot,
  makeFingerprint,
  type FingerprintSnapshot,
} from "./fingerprint.js";

import {
  BuildCache,
  type CompiledArtifact,
  type CachedDiagnostic,
} from "./build-cache.js";

import {
  DependencyTracker,
  type ChangeDetectionResult,
} from "./dependency-tracker.js";

// ── Compiler function contract ────────────────────────────────────────────────

/**
 * A compiler function takes a single source file and returns a
 * CompiledArtifact (or throws on unrecoverable error).
 *
 * The pipeline calls this only for files that are not in the cache.
 */
export type CompilerFn = (
  path: string,
  content: string
) => CompilerFnResult;

export interface CompilerFnResult {
  output: string;
  kind: CompiledArtifact["kind"];
  diagnostics: CachedDiagnostic[];
  /** Import paths detected in this file (for dependency tracking). */
  imports: string[];
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface PipelineOptions {
  /** LRU capacity of the build cache. Default: 1024. */
  cacheSize?: number;
  /** Output kind to cache. Default: "ir". */
  defaultKind?: CompiledArtifact["kind"];
}

export interface BuildResult {
  /** All artifacts (cached + freshly compiled). */
  artifacts: Map<string, CompiledArtifact>;
  /** Files that were served from cache. */
  cacheHits: string[];
  /** Files that were recompiled. */
  recompiled: string[];
  /** Files removed from the project. */
  removed: string[];
  /** All diagnostics across all files. */
  diagnostics: FileDiagnostic[];
  /** true if any diagnostic has severity "error". */
  hasErrors: boolean;
  /** Wall-clock time for the entire build (ms). */
  totalMs: number;
  /** Change detection result (what changed vs prev build). */
  changeDetection: ChangeDetectionResult;
  /** Build cache statistics. */
  cacheStats: ReturnType<BuildCache["stats"]>;
}

export interface FileDiagnostic extends CachedDiagnostic {
  path: string;
}

export interface BuildInput {
  /** Map of path → source content for all files in the project. */
  files: Map<string, string>;
}

// ── IncrementalPipeline ────────────────────────────────────────────────────────

export class IncrementalPipeline {
  private readonly cache: BuildCache;
  private readonly tracker: DependencyTracker;
  private readonly kind: CompiledArtifact["kind"];
  private isFirstBuild = true;

  constructor(
    private readonly compilerFn: CompilerFn,
    options: PipelineOptions = {}
  ) {
    this.cache = new BuildCache(options.cacheSize ?? 1024);
    this.tracker = new DependencyTracker();
    this.kind = options.defaultKind ?? "ir";
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  /**
   * Run an incremental build.
   *
   * First build: compiles all files.
   * Subsequent builds: compiles only changed files + their dependents.
   */
  build(input: BuildInput): BuildResult {
    const startMs = Date.now();

    // 1. Compute fingerprints
    const nextSnapshot = computeSnapshot(input.files);

    // 2. Determine what changed
    let changeDetection: ChangeDetectionResult;
    if (this.isFirstBuild) {
      this.tracker.seedSnapshot(nextSnapshot);
      changeDetection = {
        diff: {
          added: new Set(input.files.keys()),
          removed: new Set(),
          modified: new Set(),
          unchanged: new Set(),
        },
        toRecompile: new Set(input.files.keys()),
        removed: new Set(),
      };
      this.isFirstBuild = false;
    } else {
      changeDetection = this.tracker.detectChanges(nextSnapshot);
    }

    const { toRecompile, removed, diff } = changeDetection;

    // Files present in toRecompile solely because a *dependency* of theirs
    // changed (not their own content) must bypass the cache: the cache key
    // is keyed only on the file's own content hash, so a cache hit there
    // would silently serve a stale artifact compiled against the old
    // dependency. Files whose own content changed (diff.modified) already
    // miss the cache naturally, since their hash differs; files that are
    // brand new (diff.added) are intentionally still eligible for a cache
    // hit, to support the "restored to identical prior content" case.
    const propagatedOnly = new Set<string>();
    for (const path of toRecompile) {
      if (!diff.added.has(path) && !diff.modified.has(path)) {
        propagatedOnly.add(path);
      }
    }

    // 3. Process each file
    const artifacts = new Map<string, CompiledArtifact>();
    const cacheHits: string[] = [];
    const recompiled: string[] = [];
    const allDiagnostics: FileDiagnostic[] = [];

    // Process files in topological order where possible
    const topo = this.tracker.topologicalOrder();
    const orderedFiles = this.orderFiles(
      Array.from(input.files.keys()),
      topo.order
    );

    for (const path of orderedFiles) {
      const content = input.files.get(path)!;
      const fp = makeFingerprint(path, content);

      // ── 3-phase execution: cache lookup before recompile decision ──────────
      //
      // Phase 1 (Semantic Change Detection): fingerprint diff → toRecompile set
      // Phase 2 (Build Plan):               toRecompile = planning hint only
      // Phase 3 (Execution):                cache lookup by hash is authoritative
      //
      // A file in toRecompile whose content hash matches a cached artifact is
      // served from cache — this handles the "restore-to-original" case and
      // ensures content-addressed caching, not change-detection-addressed
      // caching. EXCEPTION: files pulled into toRecompile purely via
      // dependency propagation (propagatedOnly) always bypass the cache,
      // since their own hash can't detect a dependency-only change.
      const cached = propagatedOnly.has(path)
        ? undefined
        : this.cache.get(fp, this.kind);
      if (cached) {
        // Cache hit: serve from cache regardless of toRecompile.
        // The hash match is the source of truth.
        artifacts.set(path, cached);
        cacheHits.push(path);
        for (const d of cached.diagnostics) {
          allDiagnostics.push({ ...d, path });
        }
        // Keep dependency graph up to date if this is a "restored" file
        if (cached.diagnostics.length === 0) {
          // imports already tracked from prior build — no update needed
        }
        continue;
      }
      // Cache miss: must compile (file is new, modified, or evicted)

      // Compile
      const compileStart = Date.now();
      let result: CompilerFnResult;
      try {
        result = this.compilerFn(path, content);
      } catch (err) {
        result = {
          output: "",
          kind: this.kind,
          diagnostics: [{
            severity: "error",
            code: "IC0001",
            message: err instanceof Error ? err.message : String(err),
          }],
          imports: [],
        };
      }
      const compiledInMs = Date.now() - compileStart;

      const artifact: CompiledArtifact = {
        sourcePath: path,
        sourceHash: fp.hash,
        output: result.output,
        kind: result.kind,
        compiledInMs,
        compiledAt: Date.now(),
        diagnostics: result.diagnostics,
      };

      this.cache.set(artifact);
      this.tracker.setImports(path, result.imports);
      artifacts.set(path, artifact);
      recompiled.push(path);

      for (const d of result.diagnostics) {
        allDiagnostics.push({ ...d, path });
      }
    }

    const hasErrors = allDiagnostics.some((d) => d.severity === "error");
    const totalMs = Date.now() - startMs;

    return {
      artifacts,
      cacheHits,
      recompiled,
      removed: Array.from(removed),
      diagnostics: allDiagnostics,
      hasErrors,
      totalMs,
      changeDetection,
      cacheStats: this.cache.stats(),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Order input files using known topological order, appending unknowns. */
  private orderFiles(files: string[], topoOrder: string[]): string[] {
    const fileSet = new Set(files);
    const ordered: string[] = [];
    const seen = new Set<string>();

    for (const path of topoOrder) {
      if (fileSet.has(path)) {
        ordered.push(path);
        seen.add(path);
      }
    }
    // Append any files not yet in the topology (new files)
    for (const path of files) {
      if (!seen.has(path)) ordered.push(path);
    }
    return ordered;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  get buildCache(): BuildCache {
    return this.cache;
  }

  get dependencyTracker(): DependencyTracker {
    return this.tracker;
  }

  /** Force-invalidate cache entries for a given path. */
  invalidate(path: string): void {
    this.cache.invalidatePath(path);
  }

  /** Clear all state (full rebuild on next call). */
  reset(): void {
    this.cache.clear();
    // Create fresh tracker
    (this as unknown as { tracker: DependencyTracker }).tracker =
      new DependencyTracker();
    this.isFirstBuild = true;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create an IncrementalPipeline with a stub compiler for testing.
 * The stub compiler records calls and returns the provided artifacts.
 */
export interface StubCompilerEntry {
  output: string;
  kind?: CompiledArtifact["kind"];
  diagnostics?: CachedDiagnostic[];
  imports?: string[];
}

export function makeStubPipeline(
  entries: Map<string, StubCompilerEntry>,
  options?: PipelineOptions
): { pipeline: IncrementalPipeline; callLog: string[] } {
  const callLog: string[] = [];

  const compilerFn: CompilerFn = (path, _content) => {
    callLog.push(path);
    const entry = entries.get(path) ?? {
      output: `/* compiled: ${path} */`,
      kind: "ir" as const,
      diagnostics: [],
      imports: [],
    };
    return {
      output: entry.output,
      kind: entry.kind ?? "ir",
      diagnostics: entry.diagnostics ?? [],
      imports: entry.imports ?? [],
    };
  };

  return { pipeline: new IncrementalPipeline(compilerFn, options), callLog };
}
