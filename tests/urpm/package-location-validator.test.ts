import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createFilesystemPackageLocationValidator,
  RESOLVED_PACKAGE_LOCATION_INVALID,
  type ResolvedPackage,
} from "../../src/urpm/package-location-validator.js";
import { Resolver } from "../../src/urpm/resolver.js";
import { PackageRegistry } from "../../src/urpm/registry.js";
import { pickBestVersion } from "../../src/urpm/dependency-graph.js";
import { parseSemVer, parseVersionConstraint } from "../../src/urpm/manifest.js";

// ADR-007 / Integration Contract v1.0 — PackageLocationValidator.
// F1 (not found) and F3 (multiple versions) remain entirely within
// Package Resolver's own existing code, untouched by this layer —
// confirmed by the real regression guard below.

describe("PackageLocationValidator (Integration Contract v1.0, F2)", () => {
  it("REQUIRED TEST 1: an existing, real directory -> ok: true, pkg unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "urpm-loc-test-"));
    try {
      const validator = createFilesystemPackageLocationValidator();
      const pkg: ResolvedPackage = { name: "mathlib", version: "1.0.0", resolvedPath: dir };
      const result = validator.validate(pkg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Confirms name/version pass through completely unchanged -
        // this layer performs no Package-identity re-resolution.
        expect(result.pkg).toEqual(pkg);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REQUIRED TEST 2: a real, non-existent path -> ok: false + RESOLVED_PACKAGE_LOCATION_INVALID", () => {
    const validator = createFilesystemPackageLocationValidator();
    const pkg: ResolvedPackage = { name: "mathlib", version: "1.0.0", resolvedPath: "/tmp/urpm-does-not-exist-" + Date.now() };
    const result = validator.validate(pkg);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(RESOLVED_PACKAGE_LOCATION_INVALID);
      expect(result.path).toBe(pkg.resolvedPath);
    }
  });

  it("REQUIRED TEST 3: validator is a pure pass-through/reject on resolvedPath alone - performs no version/dependency/module logic of its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "urpm-loc-test-purity-"));
    try {
      const validator = createFilesystemPackageLocationValidator();
      // A deliberately unusual version string and name - if the
      // validator performed any real version parsing/selection or
      // name re-interpretation of its own, this would surface it.
      const pkg: ResolvedPackage = { name: "some/weird::name", version: "not-a-real-semver-at-all", resolvedPath: dir };
      const result = validator.validate(pkg);
      // Success depends SOLELY on the real directory's existence -
      // never on name/version being well-formed.
      expect(result.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REQUIRED TEST 4 (regression guard): Package Resolver's own existing F1 (not found) and F3 (multiple versions) paths remain completely unchanged by this addition", () => {
    // F1: PackageRegistry's own real "not found" behavior, untouched.
    const registry = new PackageRegistry();
    const resolver = new Resolver(registry);
    const manifest = { name: "app", version: "1.0.0", dependencies: [{ name: "does-not-exist", constraint: "^1.0.0" }], devDependencies: [] };
    const output = resolver.resolve(manifest as any);
    expect(output.valid).toBe(false); // real, existing behavior - unaffected

    // F3: dependency-graph.ts's own real pickBestVersion, untouched.
    const v1 = parseSemVer("1.0.0")!;
    const v2 = parseSemVer("2.0.0")!;
    const constraint = parseVersionConstraint("^1.0.0")!;
    const best = pickBestVersion([v1, v2], constraint);
    expect(best).toEqual(v1); // real, existing selection logic - unaffected
  });
});
