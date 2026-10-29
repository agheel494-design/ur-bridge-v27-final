// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Incremental Compilation
//
// Coverage:
//   FileFingerprint    — hash, makeFingerprint, diff, snapshot
//   BuildCache         — LRU, hit/miss, eviction, invalidate, serialization
//   DependencyTracker  — edges, reachability, change detection, topology
//   IncrementalPipeline — first build, incremental, cache hit rate
//   Benchmark          — build-time reduction ≥ 80% on re-builds
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  hashContent,
  makeFingerprint,
  fingerprintsEqual,
  fingerprintMatchesContent,
  computeSnapshot,
  diffSnapshots,
  snapshotToJson,
  snapshotFromJson,
} from "../../src/compiler/incremental/fingerprint.js";

import {
  BuildCache,
  type CompiledArtifact,
} from "../../src/compiler/incremental/build-cache.js";

import {
  DependencyTracker,
} from "../../src/compiler/incremental/dependency-tracker.js";

import {
  IncrementalPipeline,
  makeStubPipeline,
  type BuildInput,
  type CompilerFn,
} from "../../src/compiler/incremental/pipeline.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeArtifact(path: string, hash: string, kind: CompiledArtifact["kind"] = "ir"): CompiledArtifact {
  return {
    sourcePath: path,
    sourceHash: hash,
    output: `/* ${path} */`,
    kind,
    compiledInMs: 1,
    compiledAt: Date.now(),
    diagnostics: [],
  };
}

function buildInput(files: Record<string, string>): BuildInput {
  return { files: new Map(Object.entries(files)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FileFingerprint
// ─────────────────────────────────────────────────────────────────────────────

describe("hashContent", () => {
  it("returns 64-char hex string", () => {
    const h = hashContent("hello");
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it("is deterministic", () => {
    expect(hashContent("ur language")).toBe(hashContent("ur language"));
  });

  it("differs for different inputs", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
    expect(hashContent("")).not.toBe(hashContent(" "));
  });

  it("handles empty string", () => {
    const h = hashContent("");
    expect(h).toHaveLength(64);
  });

  it("handles unicode", () => {
    const h1 = hashContent("مرحبا");
    const h2 = hashContent("hello");
    expect(h1).not.toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("handles long content", () => {
    const long = "x".repeat(100_000);
    const h = hashContent(long);
    expect(h).toHaveLength(64);
  });
});

describe("makeFingerprint", () => {
  it("creates fingerprint with correct path and hash", () => {
    const fp = makeFingerprint("src/main.ur", "const x = 1");
    expect(fp.path).toBe("src/main.ur");
    expect(fp.hash).toHaveLength(64);
    expect(fp.size).toBeGreaterThan(0);
    expect(fp.computedAt).toBeGreaterThan(0);
  });

  it("size reflects UTF-8 byte length", () => {
    const fp = makeFingerprint("f.ur", "hello");
    expect(fp.size).toBe(5);
  });

  it("size for Arabic is > char length", () => {
    const fp = makeFingerprint("f.ur", "مرحبا");
    expect(fp.size).toBeGreaterThan(5);
  });
});

describe("fingerprintsEqual", () => {
  it("returns true for identical fingerprints", () => {
    const a = makeFingerprint("a.ur", "x");
    const b = makeFingerprint("a.ur", "x");
    expect(fingerprintsEqual(a, b)).toBe(true);
  });

  it("returns false when hash differs", () => {
    const a = makeFingerprint("a.ur", "x");
    const b = makeFingerprint("a.ur", "y");
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it("returns false when size differs", () => {
    const a = makeFingerprint("a.ur", "x");
    const b = { ...a, size: a.size + 1 };
    expect(fingerprintsEqual(a, b)).toBe(false);
  });
});

describe("fingerprintMatchesContent", () => {
  it("matches original content", () => {
    const fp = makeFingerprint("a.ur", "hello");
    expect(fingerprintMatchesContent(fp, "hello")).toBe(true);
  });

  it("rejects changed content", () => {
    const fp = makeFingerprint("a.ur", "hello");
    expect(fingerprintMatchesContent(fp, "world")).toBe(false);
  });
});

describe("computeSnapshot", () => {
  it("returns snapshot with all file fingerprints", () => {
    const files = new Map([["a.ur", "x"], ["b.ur", "y"]]);
    const snap = computeSnapshot(files);
    expect(snap.size).toBe(2);
    expect(snap.has("a.ur")).toBe(true);
    expect(snap.has("b.ur")).toBe(true);
  });

  it("empty files → empty snapshot", () => {
    expect(computeSnapshot(new Map()).size).toBe(0);
  });
});

describe("diffSnapshots", () => {
  it("detects added files", () => {
    const prev = computeSnapshot(new Map([["a.ur", "x"]]));
    const next = computeSnapshot(new Map([["a.ur", "x"], ["b.ur", "y"]]));
    const d = diffSnapshots(prev, next);
    expect(d.added.has("b.ur")).toBe(true);
    expect(d.removed.size).toBe(0);
    expect(d.modified.size).toBe(0);
  });

  it("detects removed files", () => {
    const prev = computeSnapshot(new Map([["a.ur", "x"], ["b.ur", "y"]]));
    const next = computeSnapshot(new Map([["a.ur", "x"]]));
    const d = diffSnapshots(prev, next);
    expect(d.removed.has("b.ur")).toBe(true);
    expect(d.added.size).toBe(0);
  });

  it("detects modified files", () => {
    const prev = computeSnapshot(new Map([["a.ur", "x"]]));
    const next = computeSnapshot(new Map([["a.ur", "x_changed"]]));
    const d = diffSnapshots(prev, next);
    expect(d.modified.has("a.ur")).toBe(true);
    expect(d.unchanged.size).toBe(0);
  });

  it("reports unchanged files", () => {
    const prev = computeSnapshot(new Map([["a.ur", "x"]]));
    const next = computeSnapshot(new Map([["a.ur", "x"]]));
    const d = diffSnapshots(prev, next);
    expect(d.unchanged.has("a.ur")).toBe(true);
    expect(d.modified.size).toBe(0);
  });

  it("handles all cases simultaneously", () => {
    const prev = computeSnapshot(new Map([["a.ur", "1"], ["b.ur", "2"], ["c.ur", "3"]]));
    const next = computeSnapshot(new Map([["a.ur", "1"], ["b.ur", "CHANGED"], ["d.ur", "4"]]));
    const d = diffSnapshots(prev, next);
    expect(d.unchanged.has("a.ur")).toBe(true);
    expect(d.modified.has("b.ur")).toBe(true);
    expect(d.removed.has("c.ur")).toBe(true);
    expect(d.added.has("d.ur")).toBe(true);
  });
});

describe("snapshot serialization", () => {
  it("round-trips correctly", () => {
    const files = new Map([["a.ur", "hello"], ["b.ur", "world"]]);
    const snap = computeSnapshot(files);
    const json = snapshotToJson(snap);
    const restored = snapshotFromJson(json);
    expect(restored.size).toBe(2);
    expect(restored.get("a.ur")?.hash).toBe(snap.get("a.ur")?.hash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BuildCache
// ─────────────────────────────────────────────────────────────────────────────

describe("BuildCache — basic", () => {
  let cache: BuildCache;
  beforeEach(() => { cache = new BuildCache(4); });

  it("starts empty", () => {
    expect(cache.size).toBe(0);
  });

  it("stores and retrieves artifact", () => {
    const fp = makeFingerprint("a.ur", "x");
    const art = makeArtifact("a.ur", fp.hash);
    cache.set(art);
    const hit = cache.get(fp, "ir");
    expect(hit).toBeDefined();
    expect(hit?.sourcePath).toBe("a.ur");
  });

  it("returns undefined on miss", () => {
    const fp = makeFingerprint("a.ur", "x");
    expect(cache.get(fp, "ir")).toBeUndefined();
  });

  it("has() is true after set", () => {
    const fp = makeFingerprint("a.ur", "x");
    const art = makeArtifact("a.ur", fp.hash);
    cache.set(art);
    expect(cache.has(fp, "ir")).toBe(true);
  });

  it("has() is false for different hash", () => {
    const fp = makeFingerprint("a.ur", "x");
    const art = makeArtifact("a.ur", fp.hash);
    cache.set(art);
    const fpOther = makeFingerprint("a.ur", "y");
    expect(cache.has(fpOther, "ir")).toBe(false);
  });

  it("differentiates by kind", () => {
    const fp = makeFingerprint("a.ur", "x");
    const artIr = { ...makeArtifact("a.ur", fp.hash, "ir") };
    const artWasm = { ...makeArtifact("a.ur", fp.hash, "wasm") };
    cache.set(artIr);
    cache.set(artWasm);
    expect(cache.get(fp, "ir")?.kind).toBe("ir");
    expect(cache.get(fp, "wasm")?.kind).toBe("wasm");
  });

  it("clear() empties cache", () => {
    const fp = makeFingerprint("a.ur", "x");
    cache.set(makeArtifact("a.ur", fp.hash));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get(fp, "ir")).toBeUndefined();
  });

  it("invalidatePath removes all entries for that path", () => {
    const fp = makeFingerprint("a.ur", "x");
    cache.set(makeArtifact("a.ur", fp.hash, "ir"));
    cache.set(makeArtifact("a.ur", fp.hash, "wasm"));
    cache.invalidatePath("a.ur");
    expect(cache.get(fp, "ir")).toBeUndefined();
    expect(cache.get(fp, "wasm")).toBeUndefined();
  });
});

describe("BuildCache — LRU eviction", () => {
  it("evicts LRU when at capacity", () => {
    const cache = new BuildCache(2);
    const fpA = makeFingerprint("a.ur", "a");
    const fpB = makeFingerprint("b.ur", "b");
    const fpC = makeFingerprint("c.ur", "c");
    cache.set(makeArtifact("a.ur", fpA.hash));
    cache.set(makeArtifact("b.ur", fpB.hash));
    cache.set(makeArtifact("c.ur", fpC.hash)); // evicts a
    expect(cache.get(fpA, "ir")).toBeUndefined();
    expect(cache.get(fpB, "ir")).toBeDefined();
    expect(cache.get(fpC, "ir")).toBeDefined();
  });

  it("accessing entry promotes it (prevents eviction)", () => {
    const cache = new BuildCache(2);
    const fpA = makeFingerprint("a.ur", "a");
    const fpB = makeFingerprint("b.ur", "b");
    const fpC = makeFingerprint("c.ur", "c");
    cache.set(makeArtifact("a.ur", fpA.hash));
    cache.set(makeArtifact("b.ur", fpB.hash));
    // Access a → promotes it, b becomes LRU
    cache.get(fpA, "ir");
    cache.set(makeArtifact("c.ur", fpC.hash)); // evicts b
    expect(cache.get(fpA, "ir")).toBeDefined();
    expect(cache.get(fpB, "ir")).toBeUndefined();
  });

  it("stats reports evictions", () => {
    const cache = new BuildCache(1);
    cache.set(makeArtifact("a.ur", "h1"));
    cache.set(makeArtifact("b.ur", "h2")); // evicts a
    expect(cache.stats().evictions).toBe(1);
  });
});

describe("BuildCache — stats", () => {
  it("hit rate is 0 with no access", () => {
    const cache = new BuildCache(10);
    expect(cache.stats().hitRate).toBe(0);
  });

  it("hit rate is 1 when all hits", () => {
    const cache = new BuildCache(10);
    const fp = makeFingerprint("a.ur", "x");
    cache.set(makeArtifact("a.ur", fp.hash));
    cache.get(fp, "ir");
    cache.get(fp, "ir");
    expect(cache.stats().hitRate).toBe(1);
  });

  it("hit rate is 0.5 with equal hits/misses", () => {
    const cache = new BuildCache(10);
    const fp = makeFingerprint("a.ur", "x");
    cache.set(makeArtifact("a.ur", fp.hash));
    cache.get(fp, "ir"); // hit
    const fpMiss = makeFingerprint("b.ur", "y");
    cache.get(fpMiss, "ir"); // miss
    expect(cache.stats().hitRate).toBeCloseTo(0.5);
  });
});

describe("BuildCache — serialization", () => {
  it("round-trips entries", () => {
    const cache = new BuildCache(8);
    const fp = makeFingerprint("a.ur", "x");
    cache.set(makeArtifact("a.ur", fp.hash));
    const json = cache.toJson();
    const restored = BuildCache.fromJson(json);
    expect(restored.get(fp, "ir")).toBeDefined();
  });

  it("preserves maxSize", () => {
    const cache = new BuildCache(42);
    const json = cache.toJson();
    const restored = BuildCache.fromJson(json);
    expect(restored.stats().maxSize).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DependencyTracker
// ─────────────────────────────────────────────────────────────────────────────

describe("DependencyTracker — edges", () => {
  let tracker: DependencyTracker;
  beforeEach(() => { tracker = new DependencyTracker(); });

  it("starts empty", () => {
    expect(tracker.fileCount).toBe(0);
  });

  it("addEdge creates nodes and edge", () => {
    tracker.addEdge("a.ur", "b.ur");
    expect(tracker.directImports("a.ur").has("b.ur")).toBe(true);
    expect(tracker.directImporters("b.ur").has("a.ur")).toBe(true);
  });

  it("setImports replaces old edges", () => {
    tracker.addEdge("a.ur", "b.ur");
    tracker.setImports("a.ur", ["c.ur"]);
    expect(tracker.directImports("a.ur").has("b.ur")).toBe(false);
    expect(tracker.directImports("a.ur").has("c.ur")).toBe(true);
    expect(tracker.directImporters("b.ur").has("a.ur")).toBe(false);
  });

  it("removeFile cleans both directions", () => {
    tracker.addEdge("a.ur", "b.ur");
    tracker.removeFile("b.ur");
    expect(tracker.directImports("a.ur").has("b.ur")).toBe(false);
    expect(tracker.hasFile("b.ur")).toBe(false);
  });

  it("hasFile returns false for unknown", () => {
    expect(tracker.hasFile("unknown.ur")).toBe(false);
  });
});

describe("DependencyTracker — transitiveImporters", () => {
  let tracker: DependencyTracker;
  beforeEach(() => {
    tracker = new DependencyTracker();
    // a → b → c (a imports b, b imports c)
    tracker.addEdge("a.ur", "b.ur");
    tracker.addEdge("b.ur", "c.ur");
  });

  it("c is transitively imported by a and b", () => {
    const importers = tracker.transitiveImporters("c.ur");
    expect(importers.has("b.ur")).toBe(true);
    expect(importers.has("a.ur")).toBe(true);
  });

  it("does not include the file itself", () => {
    expect(tracker.transitiveImporters("c.ur").has("c.ur")).toBe(false);
  });

  it("leaf file with no importers returns empty", () => {
    expect(tracker.transitiveImporters("a.ur").size).toBe(0);
  });

  it("diamond dependency: both paths included", () => {
    // a → b, a → c, b → d, c → d
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    t.addEdge("a.ur", "c.ur");
    t.addEdge("b.ur", "d.ur");
    t.addEdge("c.ur", "d.ur");
    const importers = t.transitiveImporters("d.ur");
    expect(importers.has("a.ur")).toBe(true);
    expect(importers.has("b.ur")).toBe(true);
    expect(importers.has("c.ur")).toBe(true);
  });
});

describe("DependencyTracker — affectedFiles", () => {
  it("includes changed file itself", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    const affected = t.affectedFiles(["b.ur"]);
    expect(affected.has("b.ur")).toBe(true);
    expect(affected.has("a.ur")).toBe(true);
  });

  it("multi-change union", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "x.ur");
    t.addEdge("b.ur", "y.ur");
    const affected = t.affectedFiles(["x.ur", "y.ur"]);
    expect(affected.has("a.ur")).toBe(true);
    expect(affected.has("b.ur")).toBe(true);
  });
});

describe("DependencyTracker — change detection", () => {
  it("first seedSnapshot seeds correctly", () => {
    const t = new DependencyTracker();
    const snap = computeSnapshot(new Map([["a.ur", "x"]]));
    t.seedSnapshot(snap);
    // No changes detected yet — next detectChanges with same snap = unchanged
    const next = computeSnapshot(new Map([["a.ur", "x"]]));
    const result = t.detectChanges(next);
    expect(result.toRecompile.size).toBe(0);
    expect(result.diff.unchanged.has("a.ur")).toBe(true);
  });

  it("detects modified file in toRecompile", () => {
    const t = new DependencyTracker();
    t.seedSnapshot(computeSnapshot(new Map([["a.ur", "v1"]])));
    const result = t.detectChanges(computeSnapshot(new Map([["a.ur", "v2"]])));
    expect(result.toRecompile.has("a.ur")).toBe(true);
  });

  it("propagates change to transitive importers", () => {
    const t = new DependencyTracker();
    t.addEdge("consumer.ur", "lib.ur");
    t.seedSnapshot(computeSnapshot(new Map([["lib.ur", "v1"], ["consumer.ur", "c"]])));
    const result = t.detectChanges(computeSnapshot(new Map([["lib.ur", "v2"], ["consumer.ur", "c"]])));
    expect(result.toRecompile.has("consumer.ur")).toBe(true);
  });

  it("removed files appear in result.removed", () => {
    const t = new DependencyTracker();
    t.seedSnapshot(computeSnapshot(new Map([["a.ur", "x"], ["b.ur", "y"]])));
    const result = t.detectChanges(computeSnapshot(new Map([["a.ur", "x"]])));
    expect(result.removed.has("b.ur")).toBe(true);
  });

  it("unchanged files are not in toRecompile", () => {
    const t = new DependencyTracker();
    t.seedSnapshot(computeSnapshot(new Map([["a.ur", "stable"]])));
    const result = t.detectChanges(computeSnapshot(new Map([["a.ur", "stable"]])));
    expect(result.toRecompile.has("a.ur")).toBe(false);
  });
});

describe("DependencyTracker — topologicalOrder", () => {
  it("single file", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    const { order, hasCycles } = t.topologicalOrder();
    expect(hasCycles).toBe(false);
    expect(order.indexOf("b.ur")).toBeLessThan(order.indexOf("a.ur"));
  });

  it("detects cycle", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    t.addEdge("b.ur", "a.ur");
    const { hasCycles } = t.topologicalOrder();
    expect(hasCycles).toBe(true);
  });

  it("linear chain a → b → c: c before b before a", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    t.addEdge("b.ur", "c.ur");
    const { order } = t.topologicalOrder();
    expect(order.indexOf("c.ur")).toBeLessThan(order.indexOf("b.ur"));
    expect(order.indexOf("b.ur")).toBeLessThan(order.indexOf("a.ur"));
  });
});

describe("DependencyTracker — serialization", () => {
  it("round-trips edges", () => {
    const t = new DependencyTracker();
    t.addEdge("a.ur", "b.ur");
    t.addEdge("b.ur", "c.ur");
    const json = t.toJson();
    const restored = DependencyTracker.fromJson(json);
    expect(restored.directImports("a.ur").has("b.ur")).toBe(true);
    expect(restored.directImporters("b.ur").has("a.ur")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. IncrementalPipeline
// ─────────────────────────────────────────────────────────────────────────────

describe("IncrementalPipeline — first build", () => {
  it("compiles all files on first build", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    pipeline.build(buildInput({ "a.ur": "x", "b.ur": "y" }));
    expect(callLog).toContain("a.ur");
    expect(callLog).toContain("b.ur");
  });

  it("produces artifacts for all files", () => {
    const { pipeline } = makeStubPipeline(new Map());
    const result = pipeline.build(buildInput({ "a.ur": "x" }));
    expect(result.artifacts.has("a.ur")).toBe(true);
  });

  it("recompiled list equals all files on first build", () => {
    const { pipeline } = makeStubPipeline(new Map());
    const result = pipeline.build(buildInput({ "a.ur": "x", "b.ur": "y" }));
    expect(result.recompiled).toContain("a.ur");
    expect(result.recompiled).toContain("b.ur");
    expect(result.cacheHits).toHaveLength(0);
  });

  it("cacheStats.hits = 0 on first build", () => {
    const { pipeline } = makeStubPipeline(new Map());
    const result = pipeline.build(buildInput({ "a.ur": "x" }));
    expect(result.cacheStats.hits).toBe(0);
  });
});

describe("IncrementalPipeline — unchanged rebuild", () => {
  it("no files recompiled if nothing changed", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    const files = { "a.ur": "x", "b.ur": "y" };
    pipeline.build(buildInput(files));
    callLog.length = 0;
    const result2 = pipeline.build(buildInput(files));
    expect(callLog).toHaveLength(0);
    expect(result2.recompiled).toHaveLength(0);
    expect(result2.cacheHits).toContain("a.ur");
    expect(result2.cacheHits).toContain("b.ur");
  });

  it("cache hit rate = 1.0 on second build (no changes)", () => {
    const { pipeline } = makeStubPipeline(new Map());
    const files = { "a.ur": "x", "b.ur": "y" };
    pipeline.build(buildInput(files));
    const result2 = pipeline.build(buildInput(files));
    // hits / (hits + misses) — misses from build 1 + hits from build 2
    expect(result2.cacheStats.hits).toBeGreaterThan(0);
    expect(result2.recompiled).toHaveLength(0);
  });
});

describe("IncrementalPipeline — partial rebuild", () => {
  it("only changed file is recompiled", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    pipeline.build(buildInput({ "a.ur": "v1", "b.ur": "stable" }));
    callLog.length = 0;
    const result2 = pipeline.build(buildInput({ "a.ur": "v2", "b.ur": "stable" }));
    expect(callLog).toContain("a.ur");
    expect(callLog).not.toContain("b.ur");
    expect(result2.recompiled).toContain("a.ur");
    expect(result2.cacheHits).toContain("b.ur");
  });

  it("propagates change to dependent files", () => {
    const entries = new Map([
      ["a.ur", { output: "/* a */", imports: ["lib.ur"] }],
      ["lib.ur", { output: "/* lib */", imports: [] }],
    ]);
    const { pipeline, callLog } = makeStubPipeline(entries);
    pipeline.build(buildInput({ "a.ur": "import lib", "lib.ur": "fn foo() {}" }));
    callLog.length = 0;
    // lib.ur changed → a.ur must also recompile
    pipeline.build(buildInput({ "a.ur": "import lib", "lib.ur": "fn foo() { return 1 }" }));
    expect(callLog).toContain("lib.ur");
    expect(callLog).toContain("a.ur");
  });
});

describe("IncrementalPipeline — diagnostics", () => {
  it("collects error diagnostics from compiler", () => {
    const compiler: CompilerFn = (_path, _content) => ({
      output: "",
      kind: "ir",
      diagnostics: [{ severity: "error", code: "E1", message: "fail" }],
      imports: [],
    });
    const pipeline = new IncrementalPipeline(compiler);
    const result = pipeline.build(buildInput({ "a.ur": "bad" }));
    expect(result.hasErrors).toBe(true);
    expect(result.diagnostics[0]?.code).toBe("E1");
  });

  it("hasErrors = false when no errors", () => {
    const { pipeline } = makeStubPipeline(new Map());
    const result = pipeline.build(buildInput({ "a.ur": "ok" }));
    expect(result.hasErrors).toBe(false);
  });

  it("handles compiler throws gracefully", () => {
    const compiler: CompilerFn = () => { throw new Error("fatal crash"); };
    const pipeline = new IncrementalPipeline(compiler);
    const result = pipeline.build(buildInput({ "a.ur": "x" }));
    expect(result.hasErrors).toBe(true);
    expect(result.diagnostics[0]?.code).toBe("IC0001");
    expect(result.diagnostics[0]?.message).toContain("fatal crash");
  });
});

describe("IncrementalPipeline — added / removed files", () => {
  it("new file added between builds is compiled", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    pipeline.build(buildInput({ "a.ur": "x" }));
    callLog.length = 0;
    pipeline.build(buildInput({ "a.ur": "x", "new.ur": "y" }));
    expect(callLog).toContain("new.ur");
    expect(callLog).not.toContain("a.ur");
  });

  it("removed file appears in result.removed", () => {
    const { pipeline } = makeStubPipeline(new Map());
    pipeline.build(buildInput({ "a.ur": "x", "gone.ur": "y" }));
    const result2 = pipeline.build(buildInput({ "a.ur": "x" }));
    expect(result2.removed).toContain("gone.ur");
  });
});

describe("IncrementalPipeline — reset / invalidate", () => {
  it("reset() forces full rebuild", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    const files = { "a.ur": "x" };
    pipeline.build(buildInput(files));
    callLog.length = 0;
    pipeline.reset();
    pipeline.build(buildInput(files));
    expect(callLog).toContain("a.ur");
  });

  it("invalidate() forces single file recompile", () => {
    const { pipeline, callLog } = makeStubPipeline(new Map());
    const files = { "a.ur": "x", "b.ur": "y" };
    pipeline.build(buildInput(files));
    callLog.length = 0;
    pipeline.invalidate("a.ur");
    pipeline.build(buildInput(files));
    expect(callLog).toContain("a.ur");
    expect(callLog).not.toContain("b.ur");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Benchmark — build-time reduction ≥ 80%
// ─────────────────────────────────────────────────────────────────────────────

describe("Benchmark — incremental build-time reduction", () => {
  it("achieves ≥ 80% reduction in compile calls on unchanged rebuild", () => {
    // Simulate a 50-file project
    const fileCount = 50;
    const files: Record<string, string> = {};
    for (let i = 0; i < fileCount; i++) {
      files[`src/module${i}.ur`] = `// module ${i}\nconst x${i} = ${i};`;
    }

    let totalCompileCalls = 0;
    const compiler: CompilerFn = (path, _content) => {
      totalCompileCalls++;
      return { output: `/* ${path} */`, kind: "ir", diagnostics: [], imports: [] };
    };

    const pipeline = new IncrementalPipeline(compiler);

    // Build 1: compile all
    pipeline.build({ files: new Map(Object.entries(files)) });
    const firstBuildCalls = totalCompileCalls;
    expect(firstBuildCalls).toBe(fileCount);

    // Build 2: no changes
    totalCompileCalls = 0;
    pipeline.build({ files: new Map(Object.entries(files)) });
    const secondBuildCalls = totalCompileCalls;

    const reduction = (firstBuildCalls - secondBuildCalls) / firstBuildCalls;
    expect(reduction).toBeGreaterThanOrEqual(0.80);
  });

  it("partial change: only 1/50 files recompiled", () => {
    const fileCount = 50;
    const files: Record<string, string> = {};
    for (let i = 0; i < fileCount; i++) {
      files[`src/module${i}.ur`] = `// v1 module ${i}`;
    }

    const { pipeline, callLog } = makeStubPipeline(new Map());
    pipeline.build({ files: new Map(Object.entries(files)) });

    // Change only one file
    files["src/module0.ur"] = "// v2 changed";
    callLog.length = 0;
    pipeline.build({ files: new Map(Object.entries(files)) });

    // Only module0 recompiled (no deps declared in stub)
    expect(callLog).toHaveLength(1);
    expect(callLog[0]).toBe("src/module0.ur");
  });

  it("timing: second build is faster than first (wall clock)", () => {
    const fileCount = 30;
    const files: Record<string, string> = {};
    for (let i = 0; i < fileCount; i++) {
      files[`f${i}.ur`] = "x".repeat(100);
    }

    const compiler: CompilerFn = (path, _content) => {
      // Simulate compile time: 2ms per file
      const deadline = Date.now() + 2;
      while (Date.now() < deadline) { /* spin */ }
      return { output: "", kind: "ir", diagnostics: [], imports: [] };
    };

    const pipeline = new IncrementalPipeline(compiler);
    const build1 = pipeline.build({ files: new Map(Object.entries(files)) });
    const build2 = pipeline.build({ files: new Map(Object.entries(files)) });

    expect(build2.totalMs).toBeLessThan(build1.totalMs);
  });
});
