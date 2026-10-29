// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Incremental Compilation: DependencyTracker
//
// Tracks which source files depend on which others so the incremental
// pipeline knows the exact set of files that must be recompiled when
// a source changes.
//
// Model:
//   - A directed graph: edge A → B means "A imports B"
//   - When B changes, ALL transitive importers of B must be recompiled
//   - Change detection is fingerprint-driven (see fingerprint.ts)
//
// This module is pure — no file I/O, no external calls.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type FingerprintSnapshot,
  type SnapshotDiff,
  diffSnapshots,
} from "./fingerprint.js";

// ── Graph ─────────────────────────────────────────────────────────────────────

/** Directed import graph node. */
export interface DepNode {
  path: string;
  /** Files this file directly imports. */
  imports: Set<string>;
  /** Files that directly import this file. */
  importedBy: Set<string>;
}

// ── Tracker ───────────────────────────────────────────────────────────────────

export class DependencyTracker {
  private readonly nodes = new Map<string, DepNode>();
  private lastSnapshot: FingerprintSnapshot = new Map();

  // ── Node management ─────────────────────────────────────────────────────────

  private getOrCreate(path: string): DepNode {
    let node = this.nodes.get(path);
    if (!node) {
      node = { path, imports: new Set(), importedBy: new Set() };
      this.nodes.set(path, node);
    }
    return node;
  }

  /**
   * Register that `importer` imports `imported`.
   * Creates nodes on demand.
   */
  addEdge(importer: string, imported: string): void {
    const importerNode = this.getOrCreate(importer);
    const importedNode = this.getOrCreate(imported);
    importerNode.imports.add(imported);
    importedNode.importedBy.add(importer);
  }

  /**
   * Remove all import edges for `importer` and replace with `newImports`.
   * Call this when a file is reparsed with potentially different import set.
   */
  setImports(importer: string, newImports: Iterable<string>): void {
    const node = this.getOrCreate(importer);

    // Remove old reverse edges
    for (const old of node.imports) {
      const dep = this.nodes.get(old);
      if (dep) dep.importedBy.delete(importer);
    }
    node.imports.clear();

    // Add new edges
    for (const imp of newImports) {
      this.addEdge(importer, imp);
    }
  }

  /** Remove a file from the graph entirely (file deleted). */
  removeFile(path: string): void {
    const node = this.nodes.get(path);
    if (!node) return;

    // Remove as importer
    for (const dep of node.imports) {
      this.nodes.get(dep)?.importedBy.delete(path);
    }
    // Remove as imported
    for (const rev of node.importedBy) {
      this.nodes.get(rev)?.imports.delete(path);
    }
    this.nodes.delete(path);
  }

  // ── Reachability ────────────────────────────────────────────────────────────

  /**
   * Return the set of files that transitively import `changedPath`.
   * Does NOT include `changedPath` itself.
   * Uses BFS on the reverse (importedBy) edges.
   */
  transitiveImporters(changedPath: string): Set<string> {
    const result = new Set<string>();
    const queue: string[] = [changedPath];
    const visited = new Set<string>([changedPath]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (!node) continue;
      for (const rev of node.importedBy) {
        if (!visited.has(rev)) {
          visited.add(rev);
          result.add(rev);
          queue.push(rev);
        }
      }
    }
    return result;
  }

  /**
   * Return the set of files that transitively depend on ANY of the given
   * changed paths. Includes the changed files themselves.
   */
  affectedFiles(changedPaths: Iterable<string>): Set<string> {
    const affected = new Set<string>();
    for (const path of changedPaths) {
      affected.add(path);
      for (const imp of this.transitiveImporters(path)) {
        affected.add(imp);
      }
    }
    return affected;
  }

  // ── Change detection ────────────────────────────────────────────────────────

  /**
   * Compare `nextSnapshot` against the stored previous snapshot.
   * Returns the set of source paths that need recompilation.
   *
   * Rules:
   *   - Added file   → compile it
   *   - Removed file → remove from graph, invalidate importers
   *   - Modified file → recompile it + all transitive importers
   *   - Unchanged file → skip
   */
  detectChanges(nextSnapshot: FingerprintSnapshot): ChangeDetectionResult {
    const diff = diffSnapshots(this.lastSnapshot, nextSnapshot);

    // Remove deleted files from graph
    for (const path of diff.removed) {
      this.removeFile(path);
    }

    // Determine recompile set
    const toRecompile = new Set<string>();

    // Added files
    for (const path of diff.added) {
      toRecompile.add(path);
    }

    // Modified files + their transitive importers
    for (const path of diff.modified) {
      for (const affected of this.affectedFiles([path])) {
        toRecompile.add(affected);
      }
    }

    // Store snapshot for next call
    this.lastSnapshot = new Map(nextSnapshot);

    return {
      diff,
      toRecompile,
      removed: diff.removed,
    };
  }

  /**
   * Seed the tracker with an initial snapshot (first build).
   * All files are "new" — all need compilation.
   */
  seedSnapshot(snapshot: FingerprintSnapshot): void {
    this.lastSnapshot = new Map(snapshot);
  }

  // ── Topology ─────────────────────────────────────────────────────────────────

  /**
   * Topological sort of files in dependency order.
   * Files with no imports come first (leaves before roots).
   * Detects cycles and returns them as a separate list.
   */
  topologicalOrder(): TopologicalResult {
    // Kahn's algorithm for topological sort.
    //
    // Build order: dependencies compiled before their importers.
    //   - Edge A → B means "A imports B" (A depends on B)
    //   - inDegree[X] = number of files that import X (i.e. X's importedBy count)
    //   - Start from files nobody imports (pure dependencies, inDegree = 0)
    //   - After processing a dependency, decrement inDegree of its importers
    //
    // Example chain: a imports b imports c
    //   inDegree: a=0 (nobody imports a), b=1 (a imports b), c=1 (b imports c)
    //   Start: queue = [a]  ← WRONG for build order; we want c first
    //
    // Correct build-order version uses importedBy counts as inDegree:
    //   inDegree[X] = |X.importedBy| = how many files depend on X
    //   Files with inDegree=0 have no dependents → safe to compile last (roots)
    //   Files with inDegree=0 in the *reverse* sense = leaf deps = compile first
    //
    // Simplest correct approach: reverse-Kahn on importedBy edges.
    //   inDegree[X] = |X.imports| = how many files X depends on
    //   inDegree=0 → X has no dependencies → compile first
    //   After compiling X, decrement inDegree of X.importedBy entries

    const inDegree = new Map<string, number>();
    for (const [path, node] of this.nodes) {
      if (!inDegree.has(path)) inDegree.set(path, node.imports.size);
      for (const dep of node.imports) {
        if (!inDegree.has(dep)) inDegree.set(dep, this.nodes.get(dep)?.imports.size ?? 0);
      }
    }

    // Seed queue with files that have no dependencies (leaf deps)
    const queue = Array.from(inDegree.entries())
      .filter(([, d]) => d === 0)
      .map(([p]) => p)
      .sort(); // deterministic

    const order: string[] = [];
    const remaining = new Set(this.nodes.keys());

    while (queue.length > 0) {
      const path = queue.shift()!;
      order.push(path);
      remaining.delete(path);
      const node = this.nodes.get(path);
      if (!node) continue;
      // Decrement inDegree of all files that import this one
      for (const importer of [...node.importedBy].sort()) {
        const deg = (inDegree.get(importer) ?? 1) - 1;
        inDegree.set(importer, deg);
        if (deg === 0) queue.push(importer);
      }
    }

    return {
      order,
      cycles: Array.from(remaining),
      hasCycles: remaining.size > 0,
    };
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  hasFile(path: string): boolean {
    return this.nodes.has(path);
  }

  directImports(path: string): ReadonlySet<string> {
    return this.nodes.get(path)?.imports ?? new Set();
  }

  directImporters(path: string): ReadonlySet<string> {
    return this.nodes.get(path)?.importedBy ?? new Set();
  }

  get fileCount(): number {
    return this.nodes.size;
  }

  allFiles(): string[] {
    return Array.from(this.nodes.keys()).sort();
  }

  // ── Serialization ─────────────────────────────────────────────────────────────

  toJson(): DependencyTrackerJson {
    const edges: [string, string][] = [];
    for (const node of this.nodes.values()) {
      for (const imp of node.imports) {
        edges.push([node.path, imp]);
      }
    }
    return { version: 1, edges };
  }

  static fromJson(json: DependencyTrackerJson): DependencyTracker {
    const tracker = new DependencyTracker();
    for (const [importer, imported] of json.edges) {
      tracker.addEdge(importer, imported);
    }
    return tracker;
  }
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface ChangeDetectionResult {
  diff: SnapshotDiff;
  /** Files (and their transitive dependents) that must be recompiled. */
  toRecompile: Set<string>;
  /** Files that were deleted from the project. */
  removed: Set<string>;
}

export interface TopologicalResult {
  order: string[];
  cycles: string[];
  hasCycles: boolean;
}

export interface DependencyTrackerJson {
  version: 1;
  edges: [string, string][];
}
