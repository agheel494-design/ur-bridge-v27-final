// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Incremental Compilation: BuildCache
//
// Maps (filePath, contentHash) → compiled artifact. When a file has not
// changed (same hash), the cached artifact is returned without recompilation.
//
// Design:
//   - Pure in-memory LRU cache (no disk I/O in this module)
//   - Keyed by path + hash to handle file renames correctly
//   - Serializable for persistence between build invocations
// ─────────────────────────────────────────────────────────────────────────────

import { type FileFingerprint } from "./fingerprint.js";

// ── Artifact ──────────────────────────────────────────────────────────────────

/** A compiled artifact produced from a single source file. */
export interface CompiledArtifact {
  /** Source file path. */
  sourcePath: string;
  /** Hash of the source that produced this artifact. */
  sourceHash: string;
  /** The compiled output (IR, bytecode, or WASM bytes as base64). */
  output: string;
  /** Output kind for routing in the pipeline. */
  kind: "ir" | "wasm" | "ssa" | "tokens" | "ast" | "semantic";
  /** Compilation duration in milliseconds. */
  compiledInMs: number;
  /** Timestamp of compilation. */
  compiledAt: number;
  /** Diagnostics emitted during compilation (errors + warnings). */
  diagnostics: CachedDiagnostic[];
}

export interface CachedDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  line?: number;
  col?: number;
}

// ── Cache key ─────────────────────────────────────────────────────────────────

function cacheKey(path: string, hash: string, kind: CompiledArtifact["kind"]): string {
  return `${path}::${hash}::${kind}`;
}

// ── LRU node ──────────────────────────────────────────────────────────────────

interface LRUNode {
  key: string;
  artifact: CompiledArtifact;
  prev: LRUNode | null;
  next: LRUNode | null;
}

// ── BuildCache ────────────────────────────────────────────────────────────────

export interface BuildCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
}

export class BuildCache {
  private readonly map = new Map<string, LRUNode>();
  private head: LRUNode | null = null; // MRU
  private tail: LRUNode | null = null; // LRU
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(private readonly maxSize: number = 1024) {
    if (maxSize < 1) throw new Error("BuildCache: maxSize must be ≥ 1");
  }

  // ── LRU plumbing ────────────────────────────────────────────────────────────

  private detach(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  private pushFront(node: LRUNode): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private evictLRU(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this.detach(this.tail);
    this._evictions++;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Look up a cached artifact by file fingerprint and output kind.
   * Returns `undefined` on cache miss.
   */
  get(
    fp: FileFingerprint,
    kind: CompiledArtifact["kind"]
  ): CompiledArtifact | undefined {
    const key = cacheKey(fp.path, fp.hash, kind);
    const node = this.map.get(key);
    if (!node) {
      this._misses++;
      return undefined;
    }
    // Move to front (MRU)
    this.detach(node);
    this.pushFront(node);
    this._hits++;
    return node.artifact;
  }

  /**
   * Store a compiled artifact, evicting LRU entries if at capacity.
   */
  set(artifact: CompiledArtifact): void {
    const key = cacheKey(artifact.sourcePath, artifact.sourceHash, artifact.kind);
    const existing = this.map.get(key);
    if (existing) {
      existing.artifact = artifact;
      this.detach(existing);
      this.pushFront(existing);
      return;
    }
    if (this.map.size >= this.maxSize) {
      this.evictLRU();
    }
    const node: LRUNode = { key, artifact, prev: null, next: null };
    this.map.set(key, node);
    this.pushFront(node);
  }

  /**
   * Returns true if the fingerprint + kind is already cached.
   * Does NOT move the entry to the front (non-consuming peek).
   */
  has(fp: FileFingerprint, kind: CompiledArtifact["kind"]): boolean {
    return this.map.has(cacheKey(fp.path, fp.hash, kind));
  }

  /** Invalidate all cached artifacts for a given file path. */
  invalidatePath(path: string): number {
    const kinds: CompiledArtifact["kind"][] = ["ir", "wasm", "ssa", "tokens", "ast", "semantic"];
    let count = 0;
    for (const kind of kinds) {
      // We don't know the hash so we must scan
      for (const [key, node] of this.map) {
        if (node.artifact.sourcePath === path) {
          this.detach(node);
          this.map.delete(key);
          count++;
        }
      }
    }
    return count;
  }

  /** Remove all entries. */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.map.size;
  }

  stats(): BuildCacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.map.size,
      maxSize: this.maxSize,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  // ── Serialization ────────────────────────────────────────────────────────────

  toJson(): BuildCacheJson {
    const entries: CompiledArtifact[] = [];
    let node = this.head;
    while (node) {
      entries.push(node.artifact);
      node = node.next;
    }
    return { version: 1, maxSize: this.maxSize, entries };
  }

  static fromJson(json: BuildCacheJson): BuildCache {
    const cache = new BuildCache(json.maxSize);
    // Insert in reverse so MRU order is preserved
    for (let i = json.entries.length - 1; i >= 0; i--) {
      cache.set(json.entries[i]!);
    }
    return cache;
  }
}

export interface BuildCacheJson {
  version: 1;
  maxSize: number;
  entries: CompiledArtifact[];
}
