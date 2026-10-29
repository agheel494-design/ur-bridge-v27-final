import { describe, it, expect } from "vitest";
import { buildGraph } from "../../src/urpm/dependency-graph.js";
import { parseSemVer } from "../../src/urpm/manifest.js";

// Real tests for URPM's dependency resolver, per the Diagnostic
// Inventory's own highest-priority finding: this subsystem's error
// paths (RCODES) were used in real code but had ZERO test coverage
// before this file. Written test-first, no code changes made to
// dependency-graph.ts - the goal was to discover whether real bugs
// exist, not assume they do.
//
// Result: all 4 previously-untested codes (RP1001-RP1004) fired
// correctly on real reproducers, and a healthy program resolved with
// zero diagnostics. No bug found - itself a valuable result (a real
// risk area is now covered and confirmed working).

function node(name: string, version: string, deps: { name: string; constraint: string }[] = []) {
  return { name, version: parseSemVer(version)!, dependencies: deps };
}

describe("URPM DependencyGraph.resolve() - real coverage for previously-untested RCODES", () => {
  it("RP1001 (CIRCULAR_DEP): a real circular dependency (a -> b -> a) is detected", () => {
    const g = buildGraph([
      node("a", "1.0.0", [{ name: "b", constraint: "^1.0.0" }]),
      node("b", "1.0.0", [{ name: "a", constraint: "^1.0.0" }]),
    ]);
    const r = g.resolve();
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("RP1001");
  });

  it("RP1003 (MISSING_DEP): a dependency on a package never added to the graph is detected", () => {
    const g = buildGraph([node("a", "1.0.0", [{ name: "b", constraint: "^1.0.0" }])]);
    const r = g.resolve();
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("RP1003");
  });

  it("RP1002 (VERSION_CONFLICT): a dependency requiring an incompatible major version is detected", () => {
    const g = buildGraph([
      node("a", "1.0.0", [{ name: "b", constraint: "^2.0.0" }]),
      node("b", "1.0.0"),
    ]);
    const r = g.resolve();
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("RP1002");
  });

  it("RP1004 (INVALID_CONSTRAINT): a syntactically invalid version constraint string is detected", () => {
    const g = buildGraph([
      node("a", "1.0.0", [{ name: "b", constraint: "not-a-valid-constraint!!" }]),
      node("b", "1.0.0"),
    ]);
    const r = g.resolve();
    expect(r.valid).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("RP1004");
  });

  it("REGRESSION: a healthy dependency graph with no issues resolves cleanly", () => {
    const g = buildGraph([
      node("a", "1.0.0", [{ name: "b", constraint: "^1.0.0" }]),
      node("b", "1.0.0"),
    ]);
    const r = g.resolve();
    expect(r.valid).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });
});
