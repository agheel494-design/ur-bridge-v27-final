import { describe, it, expect } from "vitest";

import {
  parseSemVer,
  semVerToString,
  compareSemVer,
  parseVersionConstraint,
  satisfies,
  makeManifest,
  manifestToJson,
  manifestFromJson,
  makeLockFile,
  lockFileToJson,
  lockFileFromJson,
  type SemVer,
  type VersionConstraint,
  type Manifest,
} from "../../src/urpm/manifest.js";

import {
  DependencyGraph,
  buildGraph,
  pickBestVersion,
  RCODES,
  type PackageNode,
} from "../../src/urpm/dependency-graph.js";

import {
  PackageRegistry,
  REGISTRY_CODES,
  type RegistryPackageVersion,
} from "../../src/urpm/registry.js";

import { Resolver } from "../../src/urpm/resolver.js";
import { PackageCache } from "../../src/urpm/cache.js";

import {
  cmdInstall,
  cmdRemove,
  cmdUpdate,
  cmdSearch,
  cmdPublish,
  cmdVerify,
} from "../../src/urpm/commands.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sv(major: number, minor: number, patch: number): SemVer {
  return { major, minor, patch };
}

function makeRegistryEntry(
  version: string,
  deps: Record<string, string> = {},
  description?: string,
): RegistryPackageVersion {
  const parsed = parseSemVer(version)!;
  return {
    version: parsed,
    integrity: `sha256-${version.replace(/\./g, "")}`,
    resolved: `https://registry.ur-lang.org/${version}.tar.gz`,
    dependencies: deps,
    description,
  };
}

function makeTestRegistry(): PackageRegistry {
  const reg = new PackageRegistry();
  reg.registerVersion("lodash", "4.17.21", makeRegistryEntry("4.17.21"));
  reg.registerVersion("lodash", "4.17.20", makeRegistryEntry("4.17.20"));
  reg.registerVersion("lodash", "3.10.1",  makeRegistryEntry("3.10.1"));
  reg.registerVersion("ur-math", "1.0.0",  makeRegistryEntry("1.0.0"), ["math", "algebra"]);
  reg.registerVersion("ur-math", "1.1.0",  makeRegistryEntry("1.1.0"), ["math", "algebra"]);
  reg.registerVersion("ur-math", "2.0.0",  makeRegistryEntry("2.0.0"), ["math", "algebra"]);
  reg.registerVersion("ur-io",   "0.5.0",  makeRegistryEntry("0.5.0", { "ur-core": "^1.0.0" }), ["io"]);
  reg.registerVersion("ur-core", "1.0.0",  makeRegistryEntry("1.0.0"), ["core"]);
  reg.registerVersion("ur-core", "1.2.0",  makeRegistryEntry("1.2.0"), ["core"]);
  return reg;
}

// ─────────────────────────────────────────────────────────────────────────────
// parseSemVer
// ─────────────────────────────────────────────────────────────────────────────

describe("parseSemVer", () => {
  it("parses simple version", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses version with prerelease", () => {
    const v = parseSemVer("2.0.0-alpha.1");
    expect(v?.prerelease).toBe("alpha.1");
    expect(v?.major).toBe(2);
  });

  it("parses version with build metadata", () => {
    const v = parseSemVer("1.0.0+build.42");
    expect(v?.build).toBe("build.42");
  });

  it("parses 0.0.0", () => {
    expect(parseSemVer("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("returns undefined for invalid version", () => {
    expect(parseSemVer("1.2")).toBeUndefined();
    expect(parseSemVer("abc")).toBeUndefined();
    expect(parseSemVer("")).toBeUndefined();
    expect(parseSemVer("1.2.3.4")).toBeUndefined();
  });

  it("parses large version numbers", () => {
    const v = parseSemVer("100.200.300");
    expect(v?.major).toBe(100);
    expect(v?.minor).toBe(200);
    expect(v?.patch).toBe(300);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// semVerToString
// ─────────────────────────────────────────────────────────────────────────────

describe("semVerToString", () => {
  it("serializes basic version", () => {
    expect(semVerToString(sv(1, 2, 3))).toBe("1.2.3");
  });

  it("includes prerelease", () => {
    expect(semVerToString({ ...sv(1, 0, 0), prerelease: "beta" })).toBe("1.0.0-beta");
  });

  it("includes build metadata", () => {
    expect(semVerToString({ ...sv(1, 0, 0), build: "sha.abc" })).toBe("1.0.0+sha.abc");
  });

  it("round-trips through parse", () => {
    const original = "3.14.159-rc.1+build.999";
    const parsed = parseSemVer(original);
    expect(semVerToString(parsed!)).toBe(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compareSemVer
// ─────────────────────────────────────────────────────────────────────────────

describe("compareSemVer", () => {
  it("equal versions return 0", () => {
    expect(compareSemVer(sv(1,2,3), sv(1,2,3))).toBe(0);
  });

  it("greater major returns 1", () => {
    expect(compareSemVer(sv(2,0,0), sv(1,9,9))).toBe(1);
  });

  it("lesser major returns -1", () => {
    expect(compareSemVer(sv(1,0,0), sv(2,0,0))).toBe(-1);
  });

  it("compares minor when major equal", () => {
    expect(compareSemVer(sv(1,3,0), sv(1,2,0))).toBe(1);
  });

  it("compares patch when major+minor equal", () => {
    expect(compareSemVer(sv(1,2,5), sv(1,2,3))).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseVersionConstraint
// ─────────────────────────────────────────────────────────────────────────────

describe("parseVersionConstraint", () => {
  it("parses ^ constraint", () => {
    const c = parseVersionConstraint("^1.2.0");
    expect(c?.operator).toBe("^");
    expect(c?.version).toEqual(sv(1,2,0));
  });

  it("parses ~ constraint", () => {
    const c = parseVersionConstraint("~1.2.0");
    expect(c?.operator).toBe("~");
  });

  it("parses >= constraint", () => {
    const c = parseVersionConstraint(">=2.0.0");
    expect(c?.operator).toBe(">=");
  });

  it("parses = constraint", () => {
    expect(parseVersionConstraint("=1.0.0")?.operator).toBe("=");
  });

  it("parses bare version as =", () => {
    const c = parseVersionConstraint("1.0.0");
    expect(c?.operator).toBe("=");
  });

  it("parses * wildcard", () => {
    expect(parseVersionConstraint("*")?.operator).toBe("*");
  });

  it("parses > constraint", () => {
    expect(parseVersionConstraint(">1.0.0")?.operator).toBe(">");
  });

  it("parses <= constraint", () => {
    expect(parseVersionConstraint("<=3.0.0")?.operator).toBe("<=");
  });

  it("returns undefined for invalid constraint", () => {
    expect(parseVersionConstraint("^abc")).toBeUndefined();
    expect(parseVersionConstraint("bad")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// satisfies
// ─────────────────────────────────────────────────────────────────────────────

describe("satisfies", () => {
  it("* satisfies any version", () => {
    const c = parseVersionConstraint("*")!;
    expect(satisfies(sv(0,0,1), c)).toBe(true);
    expect(satisfies(sv(99,99,99), c)).toBe(true);
  });

  it("= requires exact match", () => {
    const c = parseVersionConstraint("=1.2.3")!;
    expect(satisfies(sv(1,2,3), c)).toBe(true);
    expect(satisfies(sv(1,2,4), c)).toBe(false);
  });

  it("^ allows same major, higher minor/patch", () => {
    const c = parseVersionConstraint("^1.2.0")!;
    expect(satisfies(sv(1,2,0), c)).toBe(true);
    expect(satisfies(sv(1,9,9), c)).toBe(true);
    expect(satisfies(sv(2,0,0), c)).toBe(false);
    expect(satisfies(sv(1,1,9), c)).toBe(false);
  });

  it("^ with 0.x locks minor", () => {
    const c = parseVersionConstraint("^0.2.0")!;
    expect(satisfies(sv(0,2,5), c)).toBe(true);
    expect(satisfies(sv(0,3,0), c)).toBe(false);
    expect(satisfies(sv(1,0,0), c)).toBe(false);
  });

  it("^ with 0.0.x locks patch", () => {
    const c = parseVersionConstraint("^0.0.3")!;
    expect(satisfies(sv(0,0,3), c)).toBe(true);
    expect(satisfies(sv(0,0,4), c)).toBe(false);
  });

  it("~ allows same minor, higher patch", () => {
    const c = parseVersionConstraint("~1.2.0")!;
    expect(satisfies(sv(1,2,9), c)).toBe(true);
    expect(satisfies(sv(1,3,0), c)).toBe(false);
    expect(satisfies(sv(1,1,9), c)).toBe(false);
  });

  it(">= allows equal or higher", () => {
    const c = parseVersionConstraint(">=1.0.0")!;
    expect(satisfies(sv(1,0,0), c)).toBe(true);
    expect(satisfies(sv(2,0,0), c)).toBe(true);
    expect(satisfies(sv(0,9,9), c)).toBe(false);
  });

  it("> requires strictly higher", () => {
    const c = parseVersionConstraint(">1.0.0")!;
    expect(satisfies(sv(1,0,0), c)).toBe(false);
    expect(satisfies(sv(1,0,1), c)).toBe(true);
  });

  it("< requires strictly lower", () => {
    const c = parseVersionConstraint("<2.0.0")!;
    expect(satisfies(sv(1,9,9), c)).toBe(true);
    expect(satisfies(sv(2,0,0), c)).toBe(false);
  });

  it("<= allows equal or lower", () => {
    const c = parseVersionConstraint("<=1.5.0")!;
    expect(satisfies(sv(1,5,0), c)).toBe(true);
    expect(satisfies(sv(1,5,1), c)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickBestVersion
// ─────────────────────────────────────────────────────────────────────────────

describe("pickBestVersion", () => {
  it("picks highest satisfying version", () => {
    const c = parseVersionConstraint("^1.0.0")!;
    const candidates = [sv(1,0,0), sv(1,2,0), sv(1,5,0), sv(2,0,0)];
    expect(pickBestVersion(candidates, c)).toEqual(sv(1,5,0));
  });

  it("returns undefined when nothing satisfies", () => {
    const c = parseVersionConstraint("^3.0.0")!;
    const candidates = [sv(1,0,0), sv(2,0,0)];
    expect(pickBestVersion(candidates, c)).toBeUndefined();
  });

  it("returns single match", () => {
    const c = parseVersionConstraint("=1.2.3")!;
    expect(pickBestVersion([sv(1,2,3)], c)).toEqual(sv(1,2,3));
  });

  it("handles empty candidate list", () => {
    const c = parseVersionConstraint("^1.0.0")!;
    expect(pickBestVersion([], c)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manifest serialization
// ─────────────────────────────────────────────────────────────────────────────

describe("makeManifest", () => {
  it("creates manifest with name and version", () => {
    const m = makeManifest("my-app", "1.0.0");
    expect(m.name).toBe("my-app");
    expect(m.version).toBe("1.0.0");
  });

  it("defaults to version 0.1.0", () => {
    expect(makeManifest("test").version).toBe("0.1.0");
  });

  it("starts with empty deps", () => {
    const m = makeManifest("x");
    expect(m.dependencies).toEqual([]);
    expect(m.devDependencies).toEqual([]);
  });
});

describe("manifestToJson / manifestFromJson", () => {
  it("round-trips a basic manifest", () => {
    const m = makeManifest("test-pkg", "2.0.0");
    m.dependencies.push({ name: "lodash", constraint: "^4.0.0" });
    const json = manifestToJson(m);
    const parsed = manifestFromJson(json);
    expect(parsed?.name).toBe("test-pkg");
    expect(parsed?.version).toBe("2.0.0");
    expect(parsed?.dependencies[0]?.name).toBe("lodash");
  });

  it("returns undefined for invalid JSON", () => {
    expect(manifestFromJson(null)).toBeUndefined();
    expect(manifestFromJson("string")).toBeUndefined();
    expect(manifestFromJson({ version: "1.0.0" })).toBeUndefined();
  });

  it("omits empty fields from JSON output", () => {
    const json = manifestToJson(makeManifest("x"));
    expect(json["dependencies"]).toBeUndefined();
    expect(json["devDependencies"]).toBeUndefined();
  });
});

describe("lockFileToJson / lockFileFromJson", () => {
  it("round-trips a lock file", () => {
    const lf = makeLockFile();
    lf.packages.set("lodash", {
      name: "lodash",
      version: "4.17.21",
      integrity: "sha256-abc",
      resolved: "https://example.com/lodash.tar.gz",
      dependencies: {},
    });
    const json = lockFileToJson(lf);
    const parsed = lockFileFromJson(json);
    expect(parsed?.packages.has("lodash")).toBe(true);
    expect(parsed?.packages.get("lodash")?.version).toBe("4.17.21");
  });

  it("returns undefined for invalid lock file", () => {
    expect(lockFileFromJson(null)).toBeUndefined();
    expect(lockFileFromJson({ packages: {} })).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DependencyGraph
// ─────────────────────────────────────────────────────────────────────────────

describe("DependencyGraph — basic", () => {
  it("empty graph resolves cleanly", () => {
    const g = new DependencyGraph();
    const r = g.resolve();
    expect(r.valid).toBe(true);
    expect(r.buildOrder).toEqual([]);
  });

  it("single node with no deps resolves cleanly", () => {
    const g = buildGraph([{ name: "a", version: sv(1,0,0), dependencies: [] }]);
    const r = g.resolve();
    expect(r.valid).toBe(true);
    expect(r.buildOrder.length).toBe(1);
  });

  it("two nodes, one depends on other — correct order", () => {
    const a: PackageNode = { name: "a", version: sv(1,0,0), dependencies: [{ name: "b", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! }] };
    const b: PackageNode = { name: "b", version: sv(1,0,0), dependencies: [] };
    const g = buildGraph([a, b]);
    const r = g.resolve();
    expect(r.valid).toBe(true);
    const idx = (n: string) => r.buildOrder.findIndex(x => x.name === n);
    expect(idx("b")).toBeLessThan(idx("a"));
  });

  it("detects circular dependency", () => {
    const a: PackageNode = { name: "a", version: sv(1,0,0), dependencies: [{ name: "b", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! }] };
    const b: PackageNode = { name: "b", version: sv(1,0,0), dependencies: [{ name: "a", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! }] };
    const g = buildGraph([a, b]);
    const r = g.resolve();
    expect(r.valid).toBe(false);
    expect(r.diagnostics.some(d => d.code === RCODES.CIRCULAR_DEP)).toBe(true);
  });

  it("detects missing dependency", () => {
    const a: PackageNode = { name: "a", version: sv(1,0,0), dependencies: [{ name: "missing", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! }] };
    const g = buildGraph([a]);
    const r = g.resolve();
    expect(r.diagnostics.some(d => d.code === RCODES.MISSING_DEP)).toBe(true);
  });

  it("detects version conflict", () => {
    const dep: PackageNode = { name: "dep", version: sv(1,0,0), dependencies: [] };
    const a: PackageNode = { name: "a", version: sv(1,0,0), dependencies: [{ name: "dep", constraint: "^2.0.0", parsed: parseVersionConstraint("^2.0.0")! }] };
    const g = buildGraph([a, dep]);
    const r = g.resolve();
    expect(r.diagnostics.some(d => d.code === RCODES.VERSION_CONFLICT)).toBe(true);
  });

  it("3-node linear chain resolves in correct order", () => {
    const c: PackageNode = { name: "c", version: sv(1,0,0), dependencies: [] };
    const b: PackageNode = { name: "b", version: sv(1,0,0), dependencies: [{ name: "c", constraint: "*", parsed: parseVersionConstraint("*")! }] };
    const a: PackageNode = { name: "a", version: sv(1,0,0), dependencies: [{ name: "b", constraint: "*", parsed: parseVersionConstraint("*")! }] };
    const g = buildGraph([a, b, c]);
    const r = g.resolve();
    const idx = (n: string) => r.buildOrder.findIndex(x => x.name === n);
    expect(idx("c")).toBeLessThan(idx("b"));
    expect(idx("b")).toBeLessThan(idx("a"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PackageRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe("PackageRegistry — basic", () => {
  it("empty registry has size 0", () => {
    expect(new PackageRegistry().size()).toBe(0);
  });

  it("registerVersion adds a package", () => {
    const reg = new PackageRegistry();
    reg.registerVersion("pkg", "1.0.0", makeRegistryEntry("1.0.0"));
    expect(reg.size()).toBe(1);
  });

  it("getLatest returns newest version", () => {
    const reg = makeTestRegistry();
    expect(semVerToString(reg.getLatest("lodash")!.version)).toBe("4.17.21");
  });

  it("resolve returns best matching version", () => {
    const reg = makeTestRegistry();
    const c = parseVersionConstraint("^4.17.0")!;
    const v = reg.resolve("lodash", c);
    expect(v).toBeDefined();
    expect(semVerToString(v!.version)).toBe("4.17.21");
  });

  it("resolve returns undefined when no match", () => {
    const reg = makeTestRegistry();
    const c = parseVersionConstraint("^5.0.0")!;
    expect(reg.resolve("lodash", c)).toBeUndefined();
  });

  it("hasVersion returns true for known version", () => {
    const reg = makeTestRegistry();
    expect(reg.hasVersion("lodash", "4.17.21")).toBe(true);
  });

  it("hasVersion returns false for unknown version", () => {
    const reg = makeTestRegistry();
    expect(reg.hasVersion("lodash", "99.0.0")).toBe(false);
  });

  it("getPackage returns undefined for unknown package", () => {
    expect(new PackageRegistry().getPackage("nonexistent")).toBeUndefined();
  });

  it("registers multiple versions of same package", () => {
    const reg = makeTestRegistry();
    expect(reg.getVersions("lodash").length).toBe(3);
  });

  it("duplicate version produces warning", () => {
    const reg = new PackageRegistry();
    reg.registerVersion("pkg", "1.0.0", makeRegistryEntry("1.0.0"));
    const diags = reg.registerVersion("pkg", "1.0.0", makeRegistryEntry("1.0.0"));
    expect(diags.some(d => d.code === REGISTRY_CODES.DUPLICATE_PACKAGE)).toBe(true);
  });

  it("invalid version string produces error", () => {
    const reg = new PackageRegistry();
    const diags = reg.registerVersion("pkg", "bad", makeRegistryEntry("1.0.0"));
    expect(diags.some(d => d.code === REGISTRY_CODES.INVALID_VERSION)).toBe(true);
  });
});

describe("PackageRegistry — search", () => {
  it("search finds by name substring", () => {
    const reg = makeTestRegistry();
    const results = reg.search("math");
    expect(results.some(p => p.name === "ur-math")).toBe(true);
  });

  it("search finds by keyword", () => {
    const reg = makeTestRegistry();
    const results = reg.search("algebra");
    expect(results.some(p => p.name === "ur-math")).toBe(true);
  });

  it("search returns empty for no match", () => {
    expect(makeTestRegistry().search("zzznomatch").length).toBe(0);
  });

  it("empty query returns all packages", () => {
    const reg = makeTestRegistry();
    expect(reg.search("").length).toBe(reg.size());
  });

  it("packageNames returns sorted list", () => {
    const reg = makeTestRegistry();
    const names = reg.packageNames();
    expect(names).toEqual([...names].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PackageCache
// ─────────────────────────────────────────────────────────────────────────────

describe("PackageCache", () => {
  it("starts empty", () => {
    expect(new PackageCache().size()).toBe(0);
  });

  it("put and get round-trip", () => {
    const cache = new PackageCache();
    const entry = makeRegistryEntry("1.0.0");
    cache.put("pkg", entry);
    const got = cache.get("pkg", "1.0.0");
    expect(got).toBeDefined();
    expect(got?.name).toBe("pkg");
  });

  it("has returns true after put", () => {
    const cache = new PackageCache();
    cache.put("pkg", makeRegistryEntry("1.0.0"));
    expect(cache.has("pkg", "1.0.0")).toBe(true);
  });

  it("has returns false for unknown", () => {
    expect(new PackageCache().has("pkg", "1.0.0")).toBe(false);
  });

  it("evict removes entry", () => {
    const cache = new PackageCache();
    cache.put("pkg", makeRegistryEntry("1.0.0"));
    cache.evict("pkg", "1.0.0");
    expect(cache.has("pkg", "1.0.0")).toBe(false);
  });

  it("evictPackage removes all versions", () => {
    const cache = new PackageCache();
    cache.put("pkg", makeRegistryEntry("1.0.0"));
    cache.put("pkg", makeRegistryEntry("1.1.0"));
    const removed = cache.evictPackage("pkg");
    expect(removed).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("clear removes all entries", () => {
    const cache = new PackageCache();
    cache.put("a", makeRegistryEntry("1.0.0"));
    cache.put("b", makeRegistryEntry("2.0.0"));
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("stats returns correct totals", () => {
    const cache = new PackageCache();
    cache.put("pkg", makeRegistryEntry("1.0.0"));
    cache.put("pkg", makeRegistryEntry("1.1.0"));
    cache.put("other", makeRegistryEntry("2.0.0"));
    const s = cache.stats();
    expect(s.totalEntries).toBe(3);
    expect(s.packages).toBe(2);
  });

  it("versionsOf returns all versions of a package", () => {
    const cache = new PackageCache();
    cache.put("pkg", makeRegistryEntry("1.0.0"));
    cache.put("pkg", makeRegistryEntry("1.1.0"));
    expect(cache.versionsOf("pkg").length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────────────

describe("Resolver", () => {
  it("resolves single dependency", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const result = new Resolver(reg).resolve(manifest);
    expect(result.valid).toBe(true);
    expect(result.lockFile.packages.has("lodash")).toBe(true);
  });

  it("resolves transitive dependencies", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "ur-io", constraint: "^0.5.0", parsed: parseVersionConstraint("^0.5.0")! });
    const result = new Resolver(reg).resolve(manifest);
    expect(result.valid).toBe(true);
    // ur-io depends on ur-core
    expect(result.lockFile.packages.has("ur-core")).toBe(true);
  });

  it("reports error for missing package", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "nonexistent", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! });
    const result = new Resolver(reg).resolve(manifest);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(d => d.code === RCODES.MISSING_DEP)).toBe(true);
  });

  it("reports error for unsatisfiable constraint", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^99.0.0", parsed: parseVersionConstraint("^99.0.0")! });
    const result = new Resolver(reg).resolve(manifest);
    expect(result.valid).toBe(false);
  });

  it("empty manifest resolves cleanly", () => {
    const result = new Resolver(makeTestRegistry()).resolve(makeManifest("empty"));
    expect(result.valid).toBe(true);
    expect(result.lockFile.packages.size).toBe(0);
  });

  it("installFromLock validates known packages", () => {
    const reg = makeTestRegistry();
    const lf = makeLockFile();
    lf.packages.set("lodash", {
      name: "lodash", version: "4.17.21",
      integrity: "sha256-41721", resolved: "https://example.com",
      dependencies: {},
    });
    const result = new Resolver(reg).installFromLock(lf);
    expect(result.valid).toBe(true);
  });

  it("installFromLock fails for missing package", () => {
    const reg = makeTestRegistry();
    const lf = makeLockFile();
    lf.packages.set("ghost", {
      name: "ghost", version: "1.0.0",
      integrity: "sha256-abc", resolved: "https://example.com",
      dependencies: {},
    });
    const result = new Resolver(reg).installFromLock(lf);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some(d => d.code === RCODES.MISSING_DEP)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

describe("cmdInstall", () => {
  it("adds a new dependency", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    const result = cmdInstall(manifest, reg, "lodash", "^4.0.0");
    expect(result.ok).toBe(true);
    expect(result.data?.manifest.dependencies.some(d => d.name === "lodash")).toBe(true);
  });

  it("installs all existing deps when no package given", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const result = cmdInstall(manifest, reg);
    expect(result.ok).toBe(true);
  });

  it("fails for nonexistent package", () => {
    const result = cmdInstall(makeManifest("test"), makeTestRegistry(), "nonexistent", "^1.0.0");
    expect(result.ok).toBe(false);
  });

  it("fails for invalid constraint", () => {
    const result = cmdInstall(makeManifest("test"), makeTestRegistry(), "lodash", "bad-constraint");
    expect(result.ok).toBe(false);
  });

  it("adds to devDependencies when dev=true", () => {
    const reg = makeTestRegistry();
    const result = cmdInstall(makeManifest("test"), reg, "lodash", "^4.0.0", true);
    expect(result.ok).toBe(true);
    expect(result.data?.manifest.devDependencies.some(d => d.name === "lodash")).toBe(true);
  });
});

describe("cmdRemove", () => {
  it("removes an existing dependency", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const result = cmdRemove(manifest, reg, "lodash");
    expect(result.ok).toBe(true);
    expect(result.data?.manifest.dependencies.some(d => d.name === "lodash")).toBe(false);
  });

  it("fails when package not in deps", () => {
    const result = cmdRemove(makeManifest("test"), makeTestRegistry(), "nothere");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some(d => d.code === RCODES.MISSING_DEP)).toBe(true);
  });
});

describe("cmdUpdate", () => {
  it("updates a specific package", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "ur-math", constraint: "^1.0.0", parsed: parseVersionConstraint("^1.0.0")! });
    const result = cmdUpdate(manifest, reg, "ur-math");
    expect(result.ok).toBe(true);
  });

  it("updates all packages when no name given", () => {
    const reg = makeTestRegistry();
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const result = cmdUpdate(manifest, reg);
    expect(result.ok).toBe(true);
  });

  it("fails when named package not in deps", () => {
    const result = cmdUpdate(makeManifest("test"), makeTestRegistry(), "nothere");
    expect(result.ok).toBe(false);
  });
});

describe("cmdSearch", () => {
  it("returns results for known keyword", () => {
    const result = cmdSearch(makeTestRegistry(), "math");
    expect(result.ok).toBe(true);
    expect(result.data!.total).toBeGreaterThan(0);
  });

  it("returns empty results for unknown query", () => {
    const result = cmdSearch(makeTestRegistry(), "zzznomatch");
    expect(result.ok).toBe(true);
    expect(result.data!.total).toBe(0);
  });

  it("empty query returns all packages", () => {
    const reg = makeTestRegistry();
    const result = cmdSearch(reg, "");
    expect(result.data!.total).toBe(reg.size());
  });

  it("result includes latestVersion", () => {
    const result = cmdSearch(makeTestRegistry(), "lodash");
    expect(result.data!.results[0]?.latestVersion).toBeDefined();
  });
});

describe("cmdPublish", () => {
  it("validates a correct manifest", () => {
    const m = makeManifest("my-pkg", "1.0.0");
    m.description = "A great package";
    m.license = "MIT";
    const result = cmdPublish(m);
    expect(result.ok).toBe(true);
    expect(result.data?.name).toBe("my-pkg");
  });

  it("fails without name", () => {
    const m = { ...makeManifest("x"), name: "" };
    expect(cmdPublish(m).ok).toBe(false);
  });

  it("fails with invalid version", () => {
    const m = { ...makeManifest("x"), version: "bad" };
    expect(cmdPublish(m).ok).toBe(false);
  });

  it("warns when description missing", () => {
    const m = makeManifest("pkg", "1.0.0");
    m.license = "MIT";
    const result = cmdPublish(m);
    expect(result.diagnostics.some(d => d.severity === "warning")).toBe(true);
  });

  it("fails for invalid dep constraint", () => {
    const m = makeManifest("pkg", "1.0.0");
    m.dependencies.push({ name: "bad", constraint: "not-valid" });
    expect(cmdPublish(m).ok).toBe(false);
  });
});

describe("cmdVerify", () => {
  it("passes for consistent manifest and lock file", () => {
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const lf = makeLockFile();
    lf.packages.set("lodash", {
      name: "lodash", version: "4.17.21",
      integrity: "sha256-abc", resolved: "https://example.com",
      dependencies: {},
    });
    const result = cmdVerify(manifest, lf);
    expect(result.ok).toBe(true);
    expect(result.data?.valid).toBe(1);
  });

  it("fails when dep missing from lock", () => {
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const result = cmdVerify(manifest, makeLockFile());
    expect(result.ok).toBe(false);
    expect(result.data?.invalid.includes("lodash")).toBe(true);
  });

  it("fails when locked version violates constraint", () => {
    const manifest = makeManifest("test");
    manifest.dependencies.push({ name: "lodash", constraint: "^4.0.0", parsed: parseVersionConstraint("^4.0.0")! });
    const lf = makeLockFile();
    lf.packages.set("lodash", {
      name: "lodash", version: "3.0.0",
      integrity: "sha256-abc", resolved: "https://example.com",
      dependencies: {},
    });
    const result = cmdVerify(manifest, lf);
    expect(result.ok).toBe(false);
  });

  it("passes for empty manifest and empty lock", () => {
    const result = cmdVerify(makeManifest("empty"), makeLockFile());
    expect(result.ok).toBe(true);
    expect(result.data?.checked).toBe(0);
  });
});
