// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Package Cache
//
// Manages the local package cache — a flat store of resolved package entries
// keyed by "name@version". The cache sits between the resolver and the
// registry: resolved entries are stored here to avoid redundant resolution.
//
// This is an in-memory cache; filesystem persistence is out-of-scope for
// Phase 2 and will be added when real I/O is implemented.
// ─────────────────────────────────────────────────────────────────────────────

import { type SemVer, semVerToString, parseSemVer } from "./manifest.js";
import { type RegistryPackageVersion } from "./registry.js";

// ── Cache entry ───────────────────────────────────────────────────────────────

export interface CacheEntry {
  name: string;
  version: SemVer;
  integrity: string;
  resolved: string;
  dependencies: Record<string, string>;
  /** Timestamp when cached (ms since epoch) */
  cachedAt: number;
}

// ── Cache key helpers ─────────────────────────────────────────────────────────

function cacheKey(name: string, version: string): string {
  return `${name}@${version}`;
}

// ── PackageCache ──────────────────────────────────────────────────────────────

export class PackageCache {
  private store: Map<string, CacheEntry> = new Map();

  /**
   * Store a resolved registry entry in the cache.
   */
  put(name: string, entry: RegistryPackageVersion): void {
    const vStr = semVerToString(entry.version);
    const key = cacheKey(name, vStr);
    this.store.set(key, {
      name,
      version: entry.version,
      integrity: entry.integrity,
      resolved: entry.resolved,
      dependencies: { ...entry.dependencies },
      cachedAt: Date.now(),
    });
  }

  /**
   * Retrieve a cached entry by name and exact version string.
   */
  get(name: string, version: string): CacheEntry | undefined {
    return this.store.get(cacheKey(name, version));
  }

  /**
   * Check whether an entry is cached.
   */
  has(name: string, version: string): boolean {
    return this.store.has(cacheKey(name, version));
  }

  /**
   * Remove a specific version from the cache.
   */
  evict(name: string, version: string): boolean {
    return this.store.delete(cacheKey(name, version));
  }

  /**
   * Remove all cached versions of a package.
   */
  evictPackage(name: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(`${name}@`)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Returns the number of cached entries.
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Returns all cached entries.
   */
  all(): CacheEntry[] {
    return Array.from(this.store.values());
  }

  /**
   * Returns all cached versions of a given package name.
   */
  versionsOf(name: string): CacheEntry[] {
    return Array.from(this.store.values()).filter(e => e.name === name);
  }

  /**
   * Returns cache statistics.
   */
  stats(): { totalEntries: number; packages: number } {
    const packages = new Set(Array.from(this.store.values()).map(e => e.name));
    return { totalEntries: this.store.size, packages: packages.size };
  }
}
