// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Regression: dependency-only changes must not serve a stale
// cached artifact for importers.
//
// BUG (found during Hardening phase, v27 audit):
//
//   IncrementalPipeline.build() looked up the BuildCache by a file's OWN
//   content hash before honoring DependencyTracker's `toRecompile` set.
//   DependencyTracker correctly added transitive importers of a changed
//   file to `toRecompile`, but if an importer's own source text was byte-
//   identical to the previous build, its content hash was unchanged, so
//   `cache.get(fp, kind)` returned a hit and the pipeline silently served
//   the OLD artifact — one compiled against the dependency's PREVIOUS
//   content — instead of recompiling.
//
//   Concretely: `a.ur` does `import "lib.ur"` and never otherwise changes.
//   `lib.ur`'s exported function signature changes. A correct incremental
//   compiler must recompile `a.ur` (its semantic analysis / codegen output
//   may depend on lib.ur's new signature), but the buggy pipeline reused
//   a.ur's stale artifact because a.ur's own hash never changed. This is a
//   silent-corruption class bug: the build "succeeds" and produces no
//   error, but the compiled output for importers is wrong.
//
//   Two stress-test files (tests/stress/compiler-stress.test.ts and
//   tests/stability/incremental-stress.test.ts) had explicitly encoded this
//   bug as the *expected* behavior ("only leaf recompiles, importers from
//   cache"); those assertions were corrected alongside this fix.
//
// FIX: IncrementalPipeline now computes which files were added to
//   `toRecompile` purely via dependency propagation (i.e. not because their
//   own content changed) and forces those files to bypass the cache lookup
//   entirely, guaranteeing they are recompiled with up-to-date dependency
//   state. Files whose own content changed already miss the cache
//   naturally (their hash differs); newly-added files remain eligible for
//   a cache hit, to preserve the legitimate "restored to identical prior
//   content" case.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  IncrementalPipeline,
  type CompilerFn,
} from "../../src/compiler/incremental/pipeline.js";

describe("Regression: dependency-only changes force importer recompilation", () => {
  it("importer with unchanged source still recompiles when its dependency's content changes", () => {
    // The compiler stub's output for a.ur DEPENDS on lib.ur's current
    // content — simulating a real compiler whose semantic output for an
    // importer is influenced by what it imports (types, signatures, consts).
    const libContents = new Map<string, string>();
    const callLog: string[] = [];

    const compiler: CompilerFn = (path, content) => {
      callLog.push(path);
      if (path === "lib.ur") {
        libContents.set("lib.ur", content);
        return { output: `/* lib: ${content} */`, kind: "ir", diagnostics: [], imports: [] };
      }
      // a.ur "sees through" to lib.ur's latest known content — if the
      // pipeline ever fails to recompile a.ur after lib.ur changes, this
      // stub is never invoked again and the stale output is returned.
      const seenLib = libContents.get("lib.ur") ?? "";
      return {
        output: `/* a depends on: ${seenLib} */`,
        kind: "ir",
        diagnostics: [],
        imports: ["lib.ur"],
      };
    };

    const pipeline = new IncrementalPipeline(compiler);

    // NOTE: on the very first build there is no dependency graph yet (the
    // tracker only learns "a.ur imports lib.ur" from the imports returned
    // by *compiling* a.ur), so file processing order on build #1 falls back
    // to Map insertion order, not topological order. Insert lib.ur first so
    // build #1 deterministically compiles it before a.ur.
    const build1 = pipeline.build({
      files: new Map([
        ["lib.ur", "fn foo() {}"],
        ["a.ur", "import lib"],
      ]),
    });
    expect(build1.artifacts.get("a.ur")?.output).toBe("/* a depends on: fn foo() {} */");

    callLog.length = 0;

    // a.ur's own source text is UNCHANGED. Only lib.ur's content changes.
    // From build #2 onward the tracker DOES know the dependency edge, so
    // lib.ur is correctly ordered before a.ur regardless of Map order —
    // this is the actual scenario the bug affected.
    const build2 = pipeline.build({
      files: new Map([
        ["a.ur", "import lib"],
        ["lib.ur", "fn foo() { return 1 }"],
      ]),
    });

    // The compiler MUST be invoked again for a.ur — not served from cache.
    expect(callLog).toContain("lib.ur");
    expect(callLog).toContain("a.ur");
    expect(build2.recompiled).toContain("a.ur");
    expect(build2.cacheHits).not.toContain("a.ur");

    // The artifact must reflect lib.ur's NEW content, not the stale one.
    expect(build2.artifacts.get("a.ur")?.output).toBe("/* a depends on: fn foo() { return 1 } */");
  });

  it("propagation is transitive across multi-hop chains (a → b → c)", () => {
    const callLog: string[] = [];
    const compiler: CompilerFn = (path, _content) => {
      callLog.push(path);
      const imports = path === "a.ur" ? ["b.ur"] : path === "b.ur" ? ["c.ur"] : [];
      return { output: `/* ${path} */`, kind: "ir", diagnostics: [], imports };
    };
    const pipeline = new IncrementalPipeline(compiler);

    pipeline.build({
      files: new Map([
        ["a.ur", "import b"],
        ["b.ur", "import c"],
        ["c.ur", "fn c() {}"],
      ]),
    });
    callLog.length = 0;

    // Only c.ur's content changes; a.ur and b.ur's own source is unchanged.
    const result = pipeline.build({
      files: new Map([
        ["a.ur", "import b"],
        ["b.ur", "import c"],
        ["c.ur", "fn c() { return 1 }"],
      ]),
    });

    expect(callLog).toContain("c.ur");
    expect(callLog).toContain("b.ur");
    expect(callLog).toContain("a.ur");
    expect(result.cacheHits).toHaveLength(0);
  });

  it("unrelated files with no dependency edge are still served from cache (no regression)", () => {
    const callLog: string[] = [];
    const compiler: CompilerFn = (path, _content) => {
      callLog.push(path);
      return { output: `/* ${path} */`, kind: "ir", diagnostics: [], imports: [] };
    };
    const pipeline = new IncrementalPipeline(compiler);

    pipeline.build({
      files: new Map([
        ["a.ur", "stable"],
        ["b.ur", "v1"],
      ]),
    });
    callLog.length = 0;

    const result = pipeline.build({
      files: new Map([
        ["a.ur", "stable"],
        ["b.ur", "v2"],
      ]),
    });

    expect(callLog).toContain("b.ur");
    expect(callLog).not.toContain("a.ur");
    expect(result.cacheHits).toContain("a.ur");
    expect(result.recompiled).toContain("b.ur");
  });
});
