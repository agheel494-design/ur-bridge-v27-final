import { describe, it, expect } from "vitest";
import { PackageRegistry } from "../../src/urpm/registry.js";
import { parseSemVer } from "../../src/urpm/manifest.js";

// Real tests for URPM's PackageRegistry, same reasoning as
// dependency-graph.test.ts - previously zero test coverage for
// REGISTRY_CODES despite real usage in code.
//
// Real finding while writing these: resolve() returns undefined
// silently when no version matches a constraint on this tested code
// path - it does NOT emit a diagnostic. Corrected wording, per direct
// feedback: this increases confidence that RG1002 is potentially
// dormant, but is not proof it is unreachable under all execution
// paths - it could theoretically be wired to a different path.

describe("URPM PackageRegistry - real coverage for previously-untested REGISTRY_CODES", () => {
  it("RG1003 (DUPLICATE_PACKAGE): registering the exact same version twice is detected as a warning", () => {
    const reg = new PackageRegistry();
    reg.register({ name: "foo", versions: [{ version: parseSemVer("1.0.0")!, integrity: "abc", resolved: "url1", dependencies: {} }] } as any);
    const diags = reg.register({ name: "foo", versions: [{ version: parseSemVer("1.0.0")!, integrity: "abc", resolved: "url1", dependencies: {} }] } as any);
    expect(diags.map((d: any) => d.code)).toContain("RG1003");
  });

  it("REGRESSION: registering a genuinely new version produces no diagnostics", () => {
    const reg = new PackageRegistry();
    const diags = reg.register({ name: "foo", versions: [{ version: parseSemVer("1.0.0")!, integrity: "abc", resolved: "url1", dependencies: {} }] } as any);
    expect(diags).toEqual([]);
  });

  it("resolve() with no matching version returns undefined silently, zero diagnostics on this tested path (increases confidence RG1002 is potentially dormant, does not prove it unreachable under all paths)", () => {
    const reg = new PackageRegistry();
    reg.register({ name: "foo", versions: [{ version: parseSemVer("1.0.0")!, integrity: "abc", resolved: "url1", dependencies: {} }] } as any);
    const result = reg.resolve("foo", { raw: "^99.0.0", operator: "^", version: parseSemVer("99.0.0")! } as any);
    expect(result).toBeUndefined();
  });
});
