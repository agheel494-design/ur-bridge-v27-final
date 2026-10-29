// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Incremental Compilation: FileFingerprint
//
// Computes and stores a content-based fingerprint for each source file.
// Fingerprints are used by the BuildCache and DependencyTracker to detect
// which files changed between build invocations.
//
// No I/O — all hashing is pure (string → string). Callers supply content.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────────────────────────

/** A content fingerprint for a single source file. */
export interface FileFingerprint {
  /** Absolute or project-relative path used as identity key. */
  path: string;
  /** SHA-256-like hex digest of the file content (32 bytes = 64 hex chars). */
  hash: string;
  /** File content length in bytes (UTF-8). */
  size: number;
  /** Timestamp of when this fingerprint was computed (ms since epoch). */
  computedAt: number;
}

/** A snapshot of all file fingerprints in a build. */
export type FingerprintSnapshot = Map<string, FileFingerprint>;

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic 64-char hex hash of a string.
 *
 * Uses 8 independent FNV-1a (32-bit) lanes, each seeded with a distinct
 * prime/offset pair and finalized with a Murmur-style avalanche mix, so the
 * result is:
 *   - pure (no crypto API required — works identically in Node, browsers,
 *     and WASM hosts)
 *   - fast (single pass over content, O(n))
 *   - stable across JS engines
 *   - collision-resistant enough for build caching
 *
 * Every lane contributes one 8-hex-char (32-bit) segment, for 8 × 8 = 64
 * hex characters total.
 */
export function hashContent(content: string): string {
  const LANES = 8;
  const PRIMES = [
    0x01000193, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f,
    0x165667b1, 0x9e3779b1, 0x7feb352d, 0x6c62272e,
  ];
  const OFFSETS = [
    0x811c9dc5, 0x2166f723, 0x9747b28c, 0x3243f6a9,
    0xb7e15163, 0x243f6a88, 0x85a308d3, 0x13198a2e,
  ];

  const lanes = new Uint32Array(LANES);
  for (let l = 0; l < LANES; l++) lanes[l] = OFFSETS[l]!;

  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    // Mix both bytes of the UTF-16 code unit so every lane is affected by
    // non-Latin1 (e.g. Arabic, CJK) content, not just the low byte.
    const lo = code & 0xff;
    const hi = (code >>> 8) & 0xff;
    for (let l = 0; l < LANES; l++) {
      let h = lanes[l]!;
      h ^= (lo + l) & 0xff;
      h = Math.imul(h, PRIMES[l]!) >>> 0;
      h ^= (hi + i) & 0xff;
      h = Math.imul(h, PRIMES[l]!) >>> 0;
      lanes[l] = h >>> 0;
    }
  }

  // Final avalanche mix per lane, folding in content length so empty/short
  // inputs still produce well-distributed digests.
  const len = content.length;
  let out = "";
  for (let l = 0; l < LANES; l++) {
    let h = (lanes[l]! ^ (len + l * 0x9e3779b9)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a FileFingerprint for a given path and its content. */
export function makeFingerprint(path: string, content: string): FileFingerprint {
  return {
    path,
    hash: hashContent(content),
    size: new TextEncoder().encode(content).length,
    computedAt: Date.now(),
  };
}

// ── Comparison ────────────────────────────────────────────────────────────────

/** Returns true if two fingerprints represent identical file content. */
export function fingerprintsEqual(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.hash === b.hash && a.size === b.size;
}

/** Returns true if the fingerprint matches the given content. */
export function fingerprintMatchesContent(fp: FileFingerprint, content: string): boolean {
  return fp.hash === hashContent(content) &&
    fp.size === new TextEncoder().encode(content).length;
}

// ── Snapshot helpers ──────────────────────────────────────────────────────────

/**
 * Compute a FingerprintSnapshot from a map of path → content.
 * Returns a new Map keyed by path.
 */
export function computeSnapshot(files: Map<string, string>): FingerprintSnapshot {
  const snapshot: FingerprintSnapshot = new Map();
  for (const [path, content] of files) {
    snapshot.set(path, makeFingerprint(path, content));
  }
  return snapshot;
}

/**
 * Diff two snapshots. Returns the set of paths that:
 *   - were added (in `next` but not `prev`)
 *   - were removed (in `prev` but not `next`)
 *   - were modified (in both but hash changed)
 */
export interface SnapshotDiff {
  added: Set<string>;
  removed: Set<string>;
  modified: Set<string>;
  unchanged: Set<string>;
}

export function diffSnapshots(
  prev: FingerprintSnapshot,
  next: FingerprintSnapshot
): SnapshotDiff {
  const added = new Set<string>();
  const removed = new Set<string>();
  const modified = new Set<string>();
  const unchanged = new Set<string>();

  for (const [path, nextFp] of next) {
    const prevFp = prev.get(path);
    if (!prevFp) {
      added.add(path);
    } else if (!fingerprintsEqual(prevFp, nextFp)) {
      modified.add(path);
    } else {
      unchanged.add(path);
    }
  }

  for (const path of prev.keys()) {
    if (!next.has(path)) {
      removed.add(path);
    }
  }

  return { added, removed, modified, unchanged };
}

// ── Serialization ─────────────────────────────────────────────────────────────

export interface FingerprintSnapshotJson {
  version: 1;
  entries: FileFingerprint[];
}

export function snapshotToJson(snapshot: FingerprintSnapshot): FingerprintSnapshotJson {
  return {
    version: 1,
    entries: Array.from(snapshot.values()),
  };
}

export function snapshotFromJson(json: FingerprintSnapshotJson): FingerprintSnapshot {
  const snap: FingerprintSnapshot = new Map();
  for (const fp of json.entries) {
    snap.set(fp.path, fp);
  }
  return snap;
}
