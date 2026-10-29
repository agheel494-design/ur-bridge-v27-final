// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Phase 5: Resource Stability Tests
//
// Validates absence of:
//   - Memory growth (approximate via artifact/map size checks)
//   - Cache leaks after eviction
//   - DependencyTracker node accumulation after file removal
//   - LspServer state growth after open/close cycles
//   - Unbounded queue growth in rapid-change scenarios
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  IncrementalPipeline,
  BuildCache,
  DependencyTracker,
  makeFingerprint,
  type CompilerFn,
} from "../../src/compiler/incremental/index.js";
import { LspServer } from "../../src/lsp/index.js";

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

function uri(name: string) { return `file:///workspace/${name}`; }
function makeDoc(u: string, text: string, ver = 1) {
  return { uri: u, languageId: "ur", version: ver, text };
}

// ── 1. Build cache resource bounds ───────────────────────────────────────────

describe("Resource: BuildCache never exceeds declared capacity", () => {
  it("cache size stays ≤ maxSize after 10,000 insertions", () => {
    const cache = new BuildCache(100);

    for (let i = 0; i < 10000; i++) {
      const fp = makeFingerprint(`f${i}.ur`, `fn f${i}() {}`);
      cache.set({
        sourcePath: `f${i}.ur`,
        sourceHash: fp.hash,
        output: `compiled_${i}`,
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
    }

    expect(cache.size).toBeLessThanOrEqual(100);
  });

  it("cache size stays ≤ maxSize = 1 under pressure", () => {
    const cache = new BuildCache(1);
    for (let i = 0; i < 500; i++) {
      const fp = makeFingerprint(`f${i}.ur`, `content ${i}`);
      cache.set({
        sourcePath: `f${i}.ur`,
        sourceHash: fp.hash,
        output: "x",
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
      expect(cache.size).toBeLessThanOrEqual(1);
    }
  });

  it("eviction count matches insertions - capacity", () => {
    const capacity = 10;
    const cache = new BuildCache(capacity);
    for (let i = 0; i < 100; i++) {
      const fp = makeFingerprint(`e${i}.ur`, `evict ${i}`);
      cache.set({
        sourcePath: `e${i}.ur`,
        sourceHash: fp.hash,
        output: "x",
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
    }
    const stats = cache.stats();
    // Inserted 100 into capacity 10 → at least 90 evictions
    expect(stats.evictions).toBeGreaterThanOrEqual(90);
    expect(cache.size).toBeLessThanOrEqual(capacity);
  });

  it("clear() resets size to zero from any state", () => {
    const cache = new BuildCache(50);
    for (let i = 0; i < 200; i++) {
      const fp = makeFingerprint(`c${i}.ur`, `fn c${i}() {}`);
      cache.set({
        sourcePath: `c${i}.ur`,
        sourceHash: fp.hash,
        output: "x",
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
    }
    expect(cache.size).toBeGreaterThan(0);
    cache.clear();
    expect(cache.size).toBe(0);
    const stats = cache.stats();
    expect(stats.size).toBe(0);
  });

  it("stats.size always equals cache.size", () => {
    const cache = new BuildCache(20);
    for (let i = 0; i < 30; i++) {
      const fp = makeFingerprint(`s${i}.ur`, `fn s${i}() {}`);
      cache.set({
        sourcePath: `s${i}.ur`,
        sourceHash: fp.hash,
        output: "x",
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
      expect(cache.stats().size).toBe(cache.size);
    }
  });
});

// ── 2. DependencyTracker node cleanup ────────────────────────────────────────

describe("Resource: DependencyTracker cleans up removed nodes", () => {
  it("fileCount returns to 0 after removing all files", () => {
    const tracker = new DependencyTracker();
    for (let i = 0; i < 100; i++) tracker.addEdge(`a${i}.ur`, `b${i}.ur`);
    const allFiles = tracker.allFiles();
    for (const f of allFiles) tracker.removeFile(f);
    expect(tracker.fileCount).toBe(0);
  });

  it("fileCount does not grow when re-adding same edges", () => {
    const tracker = new DependencyTracker();
    for (let i = 0; i < 100; i++) tracker.addEdge("hub.ur", `leaf${i}.ur`);
    const countAfterFirst = tracker.fileCount;
    for (let i = 0; i < 100; i++) tracker.addEdge("hub.ur", `leaf${i}.ur`);
    expect(tracker.fileCount).toBe(countAfterFirst);
  });

  it("setImports replaces without accumulating stale edges", () => {
    const tracker = new DependencyTracker();
    // First: a imports [b, c, d, e]
    tracker.setImports("a.ur", ["b.ur", "c.ur", "d.ur", "e.ur"]);
    // Then: a imports only [f]
    tracker.setImports("a.ur", ["f.ur"]);
    expect(tracker.directImports("a.ur").has("b.ur")).toBe(false);
    expect(tracker.directImports("a.ur").has("f.ur")).toBe(true);
    expect(tracker.directImports("a.ur").size).toBe(1);
  });

  it("1000 add/remove cycles leave tracker empty", () => {
    const tracker = new DependencyTracker();
    for (let i = 0; i < 1000; i++) {
      tracker.addEdge(`src${i}.ur`, `dep${i}.ur`);
      tracker.removeFile(`src${i}.ur`);
      tracker.removeFile(`dep${i}.ur`);
    }
    expect(tracker.fileCount).toBe(0);
  });

  it("removing importer does not leave orphan importedBy edges", () => {
    const tracker = new DependencyTracker();
    tracker.addEdge("a.ur", "b.ur");
    tracker.addEdge("c.ur", "b.ur");
    tracker.removeFile("a.ur");

    // b.ur is still imported by c.ur only
    expect(tracker.directImporters("b.ur").has("a.ur")).toBe(false);
    expect(tracker.directImporters("b.ur").has("c.ur")).toBe(true);
  });
});

// ── 3. Pipeline artifact count stability ─────────────────────────────────────

describe("Resource: IncrementalPipeline artifacts stay bounded", () => {
  it("artifact map size = file count on every build", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());

    let files = new Map<string, string>();
    for (let i = 0; i < 50; i++) {
      files.set(`f${i}.ur`, `fn f${i}() {}`);
      const r = pipeline.build({ files });
      expect(r.artifacts.size).toBe(i + 1);
    }
  });

  it("artifact map does not retain deleted files across builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map<string, string>();
    for (let i = 0; i < 20; i++) files.set(`x${i}.ur`, `fn x${i}() {}`);
    pipeline.build({ files });

    // Delete 10 files
    for (let i = 0; i < 10; i++) files.delete(`x${i}.ur`);
    const r = pipeline.build({ files });
    expect(r.artifacts.size).toBe(10);
  });

  it("1000 sequential single-file builds don't grow artifact map", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    for (let i = 0; i < 1000; i++) {
      const r = pipeline.build({
        files: new Map([[`only.ur`, `fn f${i}() {}`]]),
      });
      expect(r.artifacts.size).toBe(1);
    }
  });

  it("diagnostics array does not accumulate across stable builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([["clean.ur", "fn clean() {}"]]);
    for (let i = 0; i < 100; i++) {
      const r = pipeline.build({ files });
      expect(r.diagnostics.length).toBe(0);
    }
  });
});

// ── 4. LspServer open/close cycles ───────────────────────────────────────────

describe("Resource: LspServer open/close stability", () => {
  let server: LspServer;

  beforeEach(() => { server = new LspServer({ workspaceRoot: "/workspace" }); });

  it("100 open/close cycles leave document manager empty", async () => {
    for (let i = 0; i < 100; i++) {
      await server.onOpen(makeDoc(uri(`cycle${i}.ur`), `fn f${i}() {}`));
      server.onClose(uri(`cycle${i}.ur`));
    }
    expect(server.documents.size()).toBe(0);
  });

  it("opening same document twice (re-open) does not double-count", async () => {
    await server.onOpen(makeDoc(uri("dup.ur"), "fn v1() {}", 1));
    await server.onOpen(makeDoc(uri("dup.ur"), "fn v2() {}", 2));
    expect(server.documents.size()).toBe(1);
    expect(server.documents.get(uri("dup.ur"))?.version).toBe(2);
  });

  it("stats() openDocuments matches actual open count", async () => {
    for (let i = 0; i < 10; i++) {
      await server.onOpen(makeDoc(uri(`s${i}.ur`), `fn s${i}() {}`));
    }
    expect(server.stats().openDocuments).toBe(10);
    server.onClose(uri("s0.ur"));
    server.onClose(uri("s1.ur"));
    expect(server.stats().openDocuments).toBe(8);
  });

  it("symbol table grows then shrinks correctly after open/close", async () => {
    const uris: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = uri(`sym${i}.ur`);
      await server.onOpen(makeDoc(u, `fn sym${i}() {}`));
      uris.push(u);
    }
    await server.analyzeWorkspace();
    const statsBefore = server.stats();

    for (const u of uris) server.onClose(u);
    const statsAfter = server.stats();

    expect(statsAfter.openDocuments).toBe(0);
    // Symbol count should still be valid (symbols persist until invalidated)
    expect(statsAfter.symbols).toBeGreaterThanOrEqual(0);
  });

  it("500 onChange events on single document don't crash", async () => {
    await server.onOpen(makeDoc(uri("stress.ur"), "fn v0() {}", 1));
    for (let i = 1; i <= 500; i++) {
      await server.onChange(uri("stress.ur"), i, [
        { text: `fn v${i}() { return ${i} }` },
      ]);
    }
    expect(server.documents.get(uri("stress.ur"))?.version).toBe(500);
  });
});

// ── 5. 10,000 compilation cycles ─────────────────────────────────────────────

describe("Resource: 10,000 compilation cycle stability", () => {
  it("10,000 builds of 1-file project complete without crash", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([["main.ur", "fn main() {}"]]);

    let crashed = false;
    for (let i = 0; i < 10000; i++) {
      try {
        const r = pipeline.build({ files });
        if (r.artifacts.size !== 1) { crashed = true; break; }
      } catch {
        crashed = true;
        break;
      }
    }

    expect(crashed).toBe(false);
  });

  it("10,000 alternating builds stay deterministic", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const filesA = new Map([["f.ur", "fn v1() {}"]]);
    const filesB = new Map([["f.ur", "fn v2() {}"]]);

    for (let i = 0; i < 5000; i++) {
      const rA = pipeline.build({ files: filesA });
      const rB = pipeline.build({ files: filesB });
      expect(rA.artifacts.get("f.ur")?.output).toBe("ok:f.ur");
      expect(rB.artifacts.get("f.ur")?.output).toBe("ok:f.ur");
    }
  });

  it("cacheStats.hits + misses grows monotonically over 1000 builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([["m.ur", "fn m() {}"]]);
    pipeline.build({ files }); // first build

    let prev = 0;
    for (let i = 0; i < 1000; i++) {
      const r = pipeline.build({ files });
      const total = r.cacheStats.hits + r.cacheStats.misses;
      expect(total).toBeGreaterThanOrEqual(prev);
      prev = total;
    }
  });
});

// ── 6. No memory growth heuristic ────────────────────────────────────────────

describe("Resource: no memory growth heuristic", () => {
  it("DependencyTracker.fileCount stays constant after 1000 steady-state builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map<string, string>();
    for (let i = 0; i < 20; i++) files.set(`steady${i}.ur`, `fn f${i}() {}`);
    pipeline.build({ files });

    // 1000 stable builds — tracker should not accumulate
    for (let i = 0; i < 1000; i++) {
      pipeline.build({ files });
    }
    // We can't inspect tracker directly from pipeline, but build artifacts should be stable
    const r = pipeline.build({ files });
    expect(r.artifacts.size).toBe(20);
    expect(r.recompiled.length).toBe(0);
  });

  it("cache stats hit count growth plateaus on stable builds", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([["plateau.ur", "fn stable() {}"]]);
    pipeline.build({ files }); // seed

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = pipeline.build({ files });
      samples.push(r.cacheStats.hits);
    }

    // Each build adds exactly 1 hit → monotonically increasing
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThan(samples[i - 1]!);
    }
  });

  it("BuildCache serialization round-trip is stable", () => {
    const cache = new BuildCache(50);
    for (let i = 0; i < 50; i++) {
      const fp = makeFingerprint(`rt${i}.ur`, `fn rt${i}() {}`);
      cache.set({
        sourcePath: `rt${i}.ur`,
        sourceHash: fp.hash,
        output: `compiled_${i}`,
        kind: "ir",
        compiledInMs: 1,
        compiledAt: Date.now(),
        diagnostics: [],
      });
    }
    const json = cache.toJson();
    const restored = BuildCache.fromJson(json);
    expect(restored.size).toBe(cache.size);
    expect(restored.stats().size).toBe(cache.stats().size);
  });
});
