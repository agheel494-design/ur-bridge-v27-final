// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Phase 5: Determinism Layer
//
// Golden rule: same input → same output ALWAYS
//
// Tests:
//   - Identical inputs across N pipeline instances → identical artifacts
//   - Identical inputs across N sequential builds → identical hashes
//   - Fingerprint determinism (hash stability)
//   - Snapshot determinism
//   - Artifact content determinism
//   - Order-independence of file map iteration
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  IncrementalPipeline,
  makeFingerprint,
  computeSnapshot,
  diffSnapshots,
  type CompilerFn,
} from "../../src/compiler/incremental/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCompilerFn(): CompilerFn {
  return (path: string, content: string) => {
    const imports: string[] = [];
    const re = /import\s+"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) imports.push(m[1]!);
    // Output is deterministic function of input only
    return {
      output: `compiled|${path}|${content.length}|${content.slice(0, 32)}`,
      kind: "ir",
      diagnostics: [],
      imports,
    };
  };
}

function flatProject(n: number): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    files.set(`mod${i}.ur`, `fn func${i}(x: Int): Int { return x + ${i} }`);
  }
  return files;
}

function artifactHashes(
  pipeline: IncrementalPipeline,
  files: Map<string, string>
): Map<string, string> {
  const r = pipeline.build({ files });
  const hashes = new Map<string, string>();
  for (const [path, artifact] of r.artifacts) {
    hashes.set(path, artifact.output);
  }
  return hashes;
}

// ── 1. Cross-instance determinism ─────────────────────────────────────────────

describe("Determinism: independent pipeline instances produce identical output", () => {
  it("two fresh pipelines on same input produce same artifacts", () => {
    const files = flatProject(20);
    const p1 = new IncrementalPipeline(makeCompilerFn());
    const p2 = new IncrementalPipeline(makeCompilerFn());

    const h1 = artifactHashes(p1, files);
    const h2 = artifactHashes(p2, files);

    for (const [path, hash] of h1) {
      expect(h2.get(path)).toBe(hash);
    }
  });

  it("10 independent pipeline instances all agree", () => {
    const files = flatProject(10);
    const pipelines = Array.from({ length: 10 }, () =>
      new IncrementalPipeline(makeCompilerFn())
    );
    const results = pipelines.map((p) => artifactHashes(p, files));
    const reference = results[0]!;

    for (let i = 1; i < results.length; i++) {
      for (const [path, hash] of reference) {
        expect(results[i]!.get(path)).toBe(hash);
      }
    }
  });

  it("pipeline with cache and pipeline without cache produce same artifacts", () => {
    const files = flatProject(15);
    const withCache = new IncrementalPipeline(makeCompilerFn(), { cacheSize: 1000 });
    const noCache = new IncrementalPipeline(makeCompilerFn(), { cacheSize: 1 }); // minimum valid

    withCache.build({ files }); // warm cache
    const h1 = artifactHashes(withCache, files); // from cache
    const h2 = artifactHashes(noCache, files);   // always recompile

    for (const [path, hash] of h1) {
      expect(h2.get(path)).toBe(hash);
    }
  });
});

// ── 2. Sequential build determinism ───────────────────────────────────────────

describe("Determinism: 50 sequential builds produce identical outputs", () => {
  it("50 builds of same project → same artifact hashes every time", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(10);

    const reference = artifactHashes(pipeline, files);

    for (let i = 0; i < 50; i++) {
      const current = artifactHashes(pipeline, files);
      for (const [path, hash] of reference) {
        expect(current.get(path)).toBe(hash);
      }
    }
  });

  it("50 builds alternating between two states are consistent", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const filesA = flatProject(5);
    const filesB = new Map<string, string>();
    for (const [k] of filesA) filesB.set(k, `fn modified_${k}() {}`);

    const refA = artifactHashes(pipeline, filesA);
    const refB = artifactHashes(pipeline, filesB);

    for (let i = 0; i < 25; i++) {
      expect(artifactHashes(pipeline, filesA)).toEqual(refA);
      expect(artifactHashes(pipeline, filesB)).toEqual(refB);
    }
  });

  it("adding a file does not change existing file artifacts", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const base = flatProject(5);
    const ref = artifactHashes(pipeline, base);

    const expanded = new Map(base);
    expanded.set("new_mod.ur", "fn new_fn() {}");
    const r = artifactHashes(pipeline, expanded);

    for (const [path, hash] of ref) {
      expect(r.get(path)).toBe(hash);
    }
  });
});

// ── 3. Fingerprint determinism ────────────────────────────────────────────────

describe("Determinism: fingerprint hash stability", () => {
  it("makeFingerprint is pure: same path+content → same hash always", () => {
    const path = "stable.ur";
    const content = "fn stable() { let x = 42\n  return x }";
    const hashes = Array.from({ length: 100 }, () =>
      makeFingerprint(path, content).hash
    );
    const first = hashes[0]!;
    expect(hashes.every((h) => h === first)).toBe(true);
  });

  it("whitespace change produces different hash", () => {
    const fp1 = makeFingerprint("a.ur", "fn a()  {}");
    const fp2 = makeFingerprint("a.ur", "fn a() {}");
    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("case change produces different hash", () => {
    const fp1 = makeFingerprint("a.ur", "fn Foo() {}");
    const fp2 = makeFingerprint("a.ur", "fn foo() {}");
    expect(fp1.hash).not.toBe(fp2.hash);
  });

  it("empty content has consistent hash", () => {
    const h1 = makeFingerprint("e.ur", "").hash;
    const h2 = makeFingerprint("e.ur", "").hash;
    expect(h1).toBe(h2);
  });

  it("1000-char content hashes consistently", () => {
    const content = "fn f() {}".repeat(111);
    const h1 = makeFingerprint("long.ur", content).hash;
    const h2 = makeFingerprint("long.ur", content).hash;
    expect(h1).toBe(h2);
  });

  it("path changes hash key (different path = different fingerprint identity)", () => {
    const fp1 = makeFingerprint("path_a.ur", "fn f() {}");
    const fp2 = makeFingerprint("path_b.ur", "fn f() {}");
    expect(fp1.path).not.toBe(fp2.path);
  });

  it("hash is non-empty string", () => {
    const fp = makeFingerprint("x.ur", "fn x() {}");
    expect(typeof fp.hash).toBe("string");
    expect(fp.hash.length).toBeGreaterThan(0);
  });
});

// ── 4. Snapshot determinism ───────────────────────────────────────────────────

describe("Determinism: snapshot computation", () => {
  it("computeSnapshot produces same Map regardless of insertion order", () => {
    const files1 = new Map([
      ["a.ur", "fn a() {}"],
      ["b.ur", "fn b() {}"],
      ["c.ur", "fn c() {}"],
    ]);
    const files2 = new Map([
      ["c.ur", "fn c() {}"],
      ["a.ur", "fn a() {}"],
      ["b.ur", "fn b() {}"],
    ]);
    const s1 = computeSnapshot(files1);
    const s2 = computeSnapshot(files2);

    for (const [path, fp] of s1) {
      expect(s2.get(path)?.hash).toBe(fp.hash);
    }
  });

  it("snapshot of 100 files is deterministic across 20 calls", () => {
    const files = flatProject(100);
    const first = computeSnapshot(files);

    for (let i = 0; i < 20; i++) {
      const snap = computeSnapshot(files);
      for (const [path, fp] of first) {
        expect(snap.get(path)?.hash).toBe(fp.hash);
      }
    }
  });

  it("diffSnapshots is commutatively consistent", () => {
    const base = computeSnapshot(flatProject(5));
    const next = computeSnapshot(flatProject(5));
    // Identical snapshots should produce empty diff
    const diff = diffSnapshots(base, next);
    expect(diff.modified.size).toBe(0);
    expect(diff.added.size).toBe(0);
    expect(diff.removed.size).toBe(0);
    expect(diff.unchanged.size).toBe(5);
  });
});

// ── 5. Order independence ─────────────────────────────────────────────────────

describe("Determinism: file order independence", () => {
  it("shuffled file Map produces same artifacts as ordered", () => {
    const files = flatProject(10);
    const p1 = new IncrementalPipeline(makeCompilerFn());
    const h1 = artifactHashes(p1, files);

    // Shuffle: collect entries, reverse, rebuild map
    const reversed = new Map([...files.entries()].reverse());
    const p2 = new IncrementalPipeline(makeCompilerFn());
    const h2 = artifactHashes(p2, reversed);

    for (const [path, hash] of h1) {
      expect(h2.get(path)).toBe(hash);
    }
  });

  it("topological sort is stable on identical graphs", () => {
    const pipeline1 = new IncrementalPipeline(makeCompilerFn());
    const pipeline2 = new IncrementalPipeline(makeCompilerFn());
    const files = new Map([
      ["a.ur", 'import "b.ur"\nfn a() {}'],
      ["b.ur", 'import "c.ur"\nfn b() {}'],
      ["c.ur", "fn c() {}"],
    ]);

    const r1 = pipeline1.build({ files });
    const r2 = pipeline2.build({ files });

    // Same files recompiled
    expect(new Set(r1.recompiled)).toEqual(new Set(r2.recompiled));
  });

  it("cache restore path produces same output as fresh compile", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const files = flatProject(5);

    // Fresh compile
    const fresh = artifactHashes(pipeline, files);

    // Force cache path (second build)
    const cached = artifactHashes(pipeline, files);

    expect(cached).toEqual(fresh);
  });
});

// ── 6. Determinism under mutation and restore ─────────────────────────────────

describe("Determinism: mutation and restore cycle", () => {
  it("mutate then restore produces original hash (content-addressed)", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const original = new Map([["target.ur", "fn original() { let x = 1 }"]]);
    const mutated = new Map([["target.ur", "fn mutated() { let x = 999 }"]]);

    const h_original_1 = artifactHashes(pipeline, original);
    pipeline.build({ files: mutated });
    const h_original_2 = artifactHashes(pipeline, original);

    expect(h_original_1.get("target.ur")).toBe(h_original_2.get("target.ur"));
  });

  it("10 mutation-restore cycles all converge to same hash", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const original = new Map([["f.ur", "fn stable() {}"]]);
    const reference = artifactHashes(pipeline, original);

    for (let i = 0; i < 10; i++) {
      pipeline.build({ files: new Map([["f.ur", `fn version${i}() {}`]]) });
      const restored = artifactHashes(pipeline, original);
      expect(restored.get("f.ur")).toBe(reference.get("f.ur"));
    }
  });

  it("three-state rotation stays deterministic", () => {
    const pipeline = new IncrementalPipeline(makeCompilerFn());
    const s1 = new Map([["x.ur", "fn v1() {}"]]);
    const s2 = new Map([["x.ur", "fn v2() {}"]]);
    const s3 = new Map([["x.ur", "fn v3() {}"]]);

    const h1 = artifactHashes(pipeline, s1);
    const h2 = artifactHashes(pipeline, s2);
    const h3 = artifactHashes(pipeline, s3);

    // Rotate back
    expect(artifactHashes(pipeline, s1).get("x.ur")).toBe(h1.get("x.ur"));
    expect(artifactHashes(pipeline, s2).get("x.ur")).toBe(h2.get("x.ur"));
    expect(artifactHashes(pipeline, s3).get("x.ur")).toBe(h3.get("x.ur"));
  });
});

// ── 7. Diagnostic determinism ─────────────────────────────────────────────────

describe("Determinism: diagnostic output stability", () => {
  it("error diagnostics are reproducible across builds", () => {
    const errorFn: CompilerFn = (path) => ({
      output: "",
      kind: "ir",
      diagnostics: [
        { severity: "error", code: "D001", message: `error in ${path}`, line: 1, col: 1 },
      ],
      imports: [],
    });
    const pipeline = new IncrementalPipeline(errorFn);
    const files = new Map([["broken.ur", "fn broken("]]);

    const r1 = pipeline.build({ files });
    // Clear cache to force recompile
    pipeline.build({ files: new Map([["broken.ur", "fn changed("]]) });
    pipeline.build({ files }); // back to original

    const r2 = pipeline.build({ files });

    // Diagnostics for broken.ur should be consistent
    const d1 = r1.diagnostics.filter((d) => d.path === "broken.ur");
    const d2 = r2.diagnostics.filter((d) => d.path === "broken.ur");
    expect(d1.length).toBe(d2.length);
  });

  it("hasErrors is stable across builds with same erroring input", () => {
    const errorFn: CompilerFn = () => ({
      output: "",
      kind: "ir",
      diagnostics: [{ severity: "error", code: "E1", message: "err" }],
      imports: [],
    });
    const pipeline = new IncrementalPipeline(errorFn);
    const files = new Map([["e.ur", "fn e() {}"]]);

    for (let i = 0; i < 10; i++) {
      const r = pipeline.build({ files });
      expect(r.hasErrors).toBe(true);
    }
  });
});
