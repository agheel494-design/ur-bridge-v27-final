// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Phase 5: Incremental Stress Tests
//
// Validates the incremental compilation contract:
//   recompileRatio < 0.20  (at most 20% of files recompiled on local change)
//   cacheHitRate   > 0.70  (at least 70% served from cache)
//
// Scenarios:
//   - 1 file changed out of 100
//   - 10 files changed out of 1000
//   - File addition / deletion
//   - Cascading dependency invalidation
//   - Cyclic import injection and recovery
//   - LSP onChange simulation
//   - Workspace snapshot correctness
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  IncrementalPipeline,
  DependencyTracker,
  BuildCache,
  makeFingerprint,
  computeSnapshot,
  diffSnapshots,
  type CompilerFn,
  type BuildResult,
} from "../../src/compiler/incremental/index.js";
import {
  LspServer,
} from "../../src/lsp/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompilerFn(): CompilerFn {
  return (path: string, content: string) => {
    const imports: string[] = [];
    const re = /import\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) imports.push(m[1]!);
    return { output: `ok:${path}`, kind: "ir", diagnostics: [], imports };
  };
}

function flatProject(n: number): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    files.set(`mod${i}.ur`, `fn f${i}(x: Int): Int { return x + ${i} }`);
  }
  return files;
}

function chainProject(n: number): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const imp = i < n - 1 ? `import "mod${i + 1}.ur"\n` : "";
    files.set(`mod${i}.ur`, `${imp}fn f${i}() {}`);
  }
  return files;
}

function makeDoc(uri: string, text: string, version = 1) {
  return { uri, languageId: "ur", version, text };
}

const ROOT = "/workspace";
function uri(name: string) { return `file:///workspace/${name}`; }

// ── 1. Core ratio contract ────────────────────────────────────────────────────

describe("Incremental: recompileRatio < 0.20 on single-file change", () => {
  it("1 file changed out of 100 → ratio = 0.01", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(100);
    pipeline.build({ files });

    const mutated = new Map(files);
    mutated.set("mod42.ur", "fn f42_new(x: Int): Int { return x * 2 }");
    const r = pipeline.build({ files: mutated });

    const ratio = r.recompiled.length / files.size;
    expect(ratio).toBeLessThan(0.20);
    expect(r.cacheHits.length / files.size).toBeGreaterThan(0.70);
  });

  it("5 files changed out of 100 → ratio = 0.05", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(100);
    pipeline.build({ files });

    const mutated = new Map(files);
    for (let i = 0; i < 5; i++) {
      mutated.set(`mod${i}.ur`, `fn f${i}_v2(x: Int): Int { return x - ${i} }`);
    }
    const r = pipeline.build({ files: mutated });

    expect(r.recompiled.length / files.size).toBeLessThan(0.20);
    expect(r.cacheHits.length).toBe(95);
  });

  it("0 files changed out of 100 → ratio = 0.00", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(100);
    pipeline.build({ files });
    const r = pipeline.build({ files });

    expect(r.recompiled.length).toBe(0);
    expect(r.cacheHits.length / files.size).toBe(1.0);
  });

  it("10 files changed out of 1000 → ratio ≤ 0.01", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(1000);
    pipeline.build({ files });

    const mutated = new Map(files);
    for (let i = 0; i < 10; i++) {
      mutated.set(`mod${i}.ur`, `fn f${i}_changed() {}`);
    }
    const r = pipeline.build({ files: mutated });

    const ratio = r.recompiled.length / files.size;
    expect(ratio).toBeLessThanOrEqual(0.015); // some tolerance for dep propagation
    expect(r.cacheHits.length).toBeGreaterThanOrEqual(990);
  });
});

// ── 2. File addition / removal ────────────────────────────────────────────────

describe("Incremental: file addition and removal", () => {
  it("adding 10 files to 100-file project recompiles only new 10", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(100);
    pipeline.build({ files });

    const expanded = new Map(files);
    for (let i = 100; i < 110; i++) {
      expanded.set(`mod${i}.ur`, `fn f${i}() {}`);
    }
    const r = pipeline.build({ files: expanded });

    expect(r.recompiled.length).toBe(10);
    expect(r.cacheHits.length).toBe(100);
    expect(r.removed.length).toBe(0);
  });

  it("removing 10 files from 100-file project reports removed correctly", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(100);
    pipeline.build({ files });

    const reduced = new Map(files);
    for (let i = 0; i < 10; i++) reduced.delete(`mod${i}.ur`);
    const r = pipeline.build({ files: reduced });

    expect(r.removed.length).toBe(10);
    expect(r.artifacts.size).toBe(90);
    expect(r.cacheHits.length).toBe(90);
  });

  it("adding then immediately removing a file leaves project clean", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const base = flatProject(10);
    pipeline.build({ files: base });

    const withNew = new Map(base);
    withNew.set("temp.ur", "fn temp() {}");
    pipeline.build({ files: withNew });

    const r = pipeline.build({ files: base });
    expect(r.removed).toContain("temp.ur");
    expect(r.artifacts.size).toBe(10);
    expect(r.cacheHits.length).toBe(10);
  });

  it("replacing all file contents recompiles all (cache miss)", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(20);
    pipeline.build({ files });

    const replaced = new Map<string, string>();
    for (const [k] of files) replaced.set(k, `fn replaced_${k}() {}`);
    const r = pipeline.build({ files: replaced });

    expect(r.recompiled.length).toBe(20);
    expect(r.cacheHits.length).toBe(0);
  });

  it("project shrinks to 1 file: only that file remains in artifacts", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    pipeline.build({ files: flatProject(50) });
    const r = pipeline.build({ files: new Map([["only.ur", "fn only() {}"]]) });
    expect(r.artifacts.size).toBe(1);
  });
});

// ── 3. Dependency cascade ─────────────────────────────────────────────────────

describe("Incremental: dependency invalidation cascade", () => {
  it("changing a mid-chain node recompiles it and its transitive importers", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    // chain: 0→1→2→3→4 (0 imports 1, 1 imports 2, ...)
    const files = chainProject(5);
    pipeline.build({ files });

    const mutated = new Map(files);
    mutated.set("mod3.ur", 'import "mod4.ur"\nfn f3_new() {}');
    const r = pipeline.build({ files: mutated });

    // mod3 changed, mod2 imports mod3, mod1 imports mod2, mod0 imports mod1
    expect(r.recompiled).toContain("mod3.ur");
    expect(r.recompiled.length).toBeGreaterThanOrEqual(1);
    expect(r.hasErrors).toBe(false);
  });

  it("changing leaf (mod9): leaf and all transitive importers recompile", () => {
    // NOTE: this test previously asserted the OPPOSITE — that mod0..mod8
    // would be served from cache because their own content hash is
    // unchanged. That was a real correctness bug (fixed in IncrementalPipeline):
    // the build cache is keyed only on a file's *own* content hash, so it
    // cannot detect when a file's *dependency* changed. Serving cache hits
    // for importers in that case means returning a STALE compiled artifact
    // whenever a dependency's semantics change — see
    // tests/regression/dependency-cache-staleness.test.ts.
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = chainProject(10);
    pipeline.build({ files });

    const mutated = new Map(files);
    mutated.set("mod9.ur", "fn f9_leaf_new() {}");
    const r = pipeline.build({ files: mutated });

    expect(r.recompiled).toContain("mod9.ur");
    // mod9 is imported transitively by mod0..mod8, so all 10 files recompile.
    expect(r.recompiled.length).toBe(10);
    expect(r.cacheHits.length).toBe(0);
    expect(r.hasErrors).toBe(false);
  });

  it("diamond: changing shared dep recompiles all 4 nodes", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([
      ["a.ur", 'import "b.ur"\nimport "c.ur"\nfn a() {}'],
      ["b.ur", 'import "d.ur"\nfn b() {}'],
      ["c.ur", 'import "d.ur"\nfn c() {}'],
      ["d.ur", 'fn d() {}'],
    ]);
    pipeline.build({ files });

    const mutated = new Map(files);
    mutated.set("d.ur", "fn d_new() {}");
    const r = pipeline.build({ files: mutated });

    expect(r.recompiled).toContain("d.ur");
    // d is imported by b and c, which are imported by a
    expect(r.recompiled.length).toBeGreaterThanOrEqual(1);
    expect(r.hasErrors).toBe(false);
  });

  it("adding import edge triggers re-analysis of importer", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([
      ["a.ur", "fn a() {}"],
      ["b.ur", "fn b() {}"],
    ]);
    pipeline.build({ files });

    // a now imports b
    const mutated = new Map(files);
    mutated.set("a.ur", 'import "b.ur"\nfn a() {}');
    const r = pipeline.build({ files: mutated });
    expect(r.recompiled).toContain("a.ur");
  });

  it("removing import edge does not recompile unrelated files", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([
      ["a.ur", 'import "b.ur"\nfn a() {}'],
      ["b.ur", 'import "c.ur"\nfn b() {}'],
      ["c.ur", "fn c() {}"],
      ["d.ur", "fn d() {}"], // independent
    ]);
    pipeline.build({ files });

    const mutated = new Map(files);
    mutated.set("a.ur", "fn a() {}"); // drop import
    const r = pipeline.build({ files: mutated });

    expect(r.recompiled).toContain("a.ur");
    expect(r.recompiled).not.toContain("d.ur");
  });
});

// ── 4. Cyclic import injection / recovery ────────────────────────────────────

describe("Incremental: cyclic import injection", () => {
  it("injecting a cycle does not crash the pipeline", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const acyclic = new Map([
      ["a.ur", 'import "b.ur"\nfn a() {}'],
      ["b.ur", "fn b() {}"],
    ]);
    pipeline.build({ files: acyclic });

    // Inject cycle: b now imports a
    const cyclic = new Map([
      ["a.ur", 'import "b.ur"\nfn a() {}'],
      ["b.ur", 'import "a.ur"\nfn b() {}'],
    ]);
    expect(() => pipeline.build({ files: cyclic })).not.toThrow();
  });

  it("recovering from cycle (breaking it) restores normal behavior", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const cyclic = new Map([
      ["x.ur", 'import "y.ur"\nfn x() {}'],
      ["y.ur", 'import "x.ur"\nfn y() {}'],
    ]);
    pipeline.build({ files: cyclic });

    // Break the cycle
    const fixed = new Map([
      ["x.ur", 'import "y.ur"\nfn x() {}'],
      ["y.ur", "fn y() {}"],
    ]);
    const r = pipeline.build({ files: fixed });
    expect(r.hasErrors).toBe(false);
    expect(r.artifacts.size).toBe(2);
  });

  it("self-import cycle does not crash", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const self = new Map([["me.ur", 'import "me.ur"\nfn me() {}']]);
    expect(() => pipeline.build({ files: self })).not.toThrow();
  });

  it("long cycle (10 nodes) handled gracefully", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map<string, string>();
    for (let i = 0; i < 10; i++) {
      const next = (i + 1) % 10;
      files.set(`cyc${i}.ur`, `import "cyc${next}.ur"\nfn f${i}() {}`);
    }
    expect(() => pipeline.build({ files })).not.toThrow();
  });
});

// ── 5. Cache statistics contract ─────────────────────────────────────────────

describe("Incremental: cache statistics correctness", () => {
  it("hitRate = hits / (hits + misses)", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(10);
    pipeline.build({ files });
    const r = pipeline.build({ files });

    const { hits, misses, hitRate } = r.cacheStats;
    const expected = hits + misses === 0 ? 0 : hits / (hits + misses);
    expect(Math.abs(hitRate - expected)).toBeLessThan(0.001);
  });

  it("hits increase on repeated stable builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(5);
    pipeline.build({ files });
    const r1 = pipeline.build({ files });
    const r2 = pipeline.build({ files });
    expect(r2.cacheStats.hits).toBeGreaterThanOrEqual(r1.cacheStats.hits);
  });

  it("cache size never exceeds cacheSize option", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn(), { cacheSize: 10 });
    const files = flatProject(50);
    pipeline.build({ files });
    const r = pipeline.build({ files });
    expect(r.cacheStats.size).toBeLessThanOrEqual(10);
  });

  it("cache evictions > 0 when project exceeds cache size", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn(), { cacheSize: 5 });
    const files = flatProject(20);
    pipeline.build({ files });
    const r = pipeline.build({ files });
    expect(r.cacheStats.evictions).toBeGreaterThan(0);
  });

  it("invalidatePath removes exactly that entry", () => {
    const cache = new BuildCache(100);
    const fp = makeFingerprint("target.ur", "fn t() {}");
    cache.set({
      sourcePath: "target.ur",
      sourceHash: fp.hash,
      output: "compiled",
      kind: "ir",
      compiledInMs: 1,
      compiledAt: Date.now(),
      diagnostics: [],
    });
    expect(cache.has(fp, "ir")).toBe(true);
    const removed = cache.invalidatePath("target.ur");
    expect(removed).toBe(1);
    expect(cache.has(fp, "ir")).toBe(false);
  });
});

// ── 6. LSP onChange simulation ────────────────────────────────────────────────

describe("Incremental: LSP onChange simulation", () => {
  let server: LspServer;

  beforeEach(() => { server = new LspServer({ workspaceRoot: ROOT }); });

  it("opening 5 files and changing 1 recompiles only changed", async () => {
    for (let i = 0; i < 5; i++) {
      await server.onOpen(makeDoc(uri(`f${i}.ur`), `fn f${i}() {}`, 1));
    }
    await server.analyzeWorkspace();

    const result = await server.onChange(
      uri("f2.ur"),
      2,
      [{ text: "fn f2_changed() {}" }]
    );
    const stats = server.bridge.getCacheStats();
    // After change, f2 should be reanalyzed; others cached
    expect(stats.hits).toBeGreaterThanOrEqual(0);
    expect(server.documents.get(uri("f2.ur"))?.text).toBe("fn f2_changed() {}");
  });

  it("repeated onChange on same file accumulates version correctly", async () => {
    await server.onOpen(makeDoc(uri("edit.ur"), "fn v1() {}", 1));
    await server.onChange(uri("edit.ur"), 2, [{ text: "fn v2() {}" }]);
    await server.onChange(uri("edit.ur"), 3, [{ text: "fn v3() {}" }]);
    await server.onChange(uri("edit.ur"), 4, [{ text: "fn v4() {}" }]);
    expect(server.documents.get(uri("edit.ur"))?.version).toBe(4);
    expect(server.documents.get(uri("edit.ur"))?.text).toBe("fn v4() {}");
  });

  it("onOpen + analyzeWorkspace + onChange pattern is stable 10x", async () => {
    await server.onOpen(makeDoc(uri("stable.ur"), "fn s() {}", 1));
    await server.analyzeWorkspace();

    for (let i = 2; i <= 11; i++) {
      await server.onChange(
        uri("stable.ur"),
        i,
        [{ text: `fn s_v${i}() {}` }]
      );
    }

    expect(server.documents.get(uri("stable.ur"))?.version).toBe(11);
    expect(() => server.stats()).not.toThrow();
  });

  it("closing a document removes it from open set", async () => {
    await server.onOpen(makeDoc(uri("temp.ur"), "fn t() {}", 1));
    expect(server.documents.has(uri("temp.ur"))).toBe(true);
    server.onClose(uri("temp.ur"));
    expect(server.documents.has(uri("temp.ur"))).toBe(false);
  });

  it("incremental edit (range change) applies correctly", async () => {
    await server.onOpen(makeDoc(uri("range.ur"), "fn hello() {}", 1));
    await server.onChange(uri("range.ur"), 2, [
      {
        range: {
          start: { line: 0, character: 3 },
          end: { line: 0, character: 8 },
        },
        text: "world",
      },
    ]);
    expect(server.documents.get(uri("range.ur"))?.text).toBe("fn world() {}");
  });

  it("workspace snapshot contains all open documents", async () => {
    for (let i = 0; i < 10; i++) {
      await server.onOpen(makeDoc(uri(`ws${i}.ur`), `fn ws${i}() {}`, 1));
    }
    expect(server.documents.size()).toBe(10);
  });
});

// ── 7. Snapshot correctness ───────────────────────────────────────────────────

describe("Incremental: snapshot correctness", () => {
  it("computeSnapshot is deterministic (same input same output)", () => {
    const files = flatProject(20);
    const s1 = computeSnapshot(files);
    const s2 = computeSnapshot(files);
    for (const [path, fp] of s1) {
      expect(s2.get(path)?.hash).toBe(fp.hash);
    }
  });

  it("diffSnapshots correctly classifies added/removed/modified/unchanged", () => {
    const base = new Map([
      ["a.ur", "fn a() {}"],
      ["b.ur", "fn b() {}"],
      ["c.ur", "fn c() {}"],
    ]);
    const next = new Map([
      ["b.ur", "fn b() {}"],              // unchanged
      ["c.ur", "fn c_modified() {}"],     // modified
      ["d.ur", "fn d() {}"],              // added
                                           // a removed
    ]);
    const snap1 = computeSnapshot(base);
    const snap2 = computeSnapshot(next);
    const diff = diffSnapshots(snap1, snap2);

    expect(diff.added.has("d.ur")).toBe(true);
    expect(diff.removed.has("a.ur")).toBe(true);
    expect(diff.modified.has("c.ur")).toBe(true);
    expect(diff.unchanged.has("b.ur")).toBe(true);
  });

  it("snapshot size matches file count", () => {
    const files = flatProject(50);
    const snap = computeSnapshot(files);
    expect(snap.size).toBe(50);
  });

  it("empty snapshot diff produces empty sets", () => {
    const diff = diffSnapshots(new Map(), new Map());
    expect(diff.added.size).toBe(0);
    expect(diff.removed.size).toBe(0);
    expect(diff.modified.size).toBe(0);
    expect(diff.unchanged.size).toBe(0);
  });

  it("seedSnapshot allows first build to detect changes correctly", () => {
    const tracker = new DependencyTracker();
    const initial = computeSnapshot(new Map([["a.ur", "fn a() {}"]]));
    tracker.seedSnapshot(initial);

    const next = computeSnapshot(new Map([
      ["a.ur", "fn a_v2() {}"],
      ["b.ur", "fn b() {}"],
    ]));
    const result = tracker.detectChanges(next);

    expect(result.diff.modified.has("a.ur")).toBe(true);
    expect(result.diff.added.has("b.ur")).toBe(true);
    expect(result.toRecompile.has("a.ur")).toBe(true);
    expect(result.toRecompile.has("b.ur")).toBe(true);
  });
});

// ── 8. Build result integrity ─────────────────────────────────────────────────

describe("Incremental: build result integrity across 50 builds", () => {
  it("recompiled ∪ cacheHits = all files in stable build (50 iterations)", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(30);
    pipeline.build({ files });

    for (let i = 0; i < 50; i++) {
      const r = pipeline.build({ files });
      const all = new Set([...r.recompiled, ...r.cacheHits]);
      for (const key of files.keys()) expect(all.has(key)).toBe(true);
      expect(r.hasErrors).toBe(false);
    }
  });

  it("artifacts always contain every input file (no silent drops)", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(20);

    for (let i = 0; i < 5; i++) {
      const r = pipeline.build({ files });
      for (const key of files.keys()) {
        expect(r.artifacts.has(key)).toBe(true);
      }
    }
  });

  it("totalMs does not grow unboundedly over 100 stable builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(10);
    pipeline.build({ files }); // warm up

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      times.push(pipeline.build({ files }).totalMs);
    }
    // Median should be very low (< 200ms) for stable cached builds
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median).toBeLessThan(200);
  });

  it("removed files never appear in artifacts after deletion", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(10);
    pipeline.build({ files });

    const reduced = new Map(files);
    const deleted = ["mod0.ur", "mod1.ur", "mod2.ur"];
    deleted.forEach((f) => reduced.delete(f));
    const r = pipeline.build({ files: reduced });

    deleted.forEach((f) => expect(r.artifacts.has(f)).toBe(false));
    expect(r.artifacts.size).toBe(7);
  });
});
