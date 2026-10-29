// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Package Registry
//
// In-memory registry of available packages and their versions.
// Represents the client-side view of a remote registry (or a local cache).
//
// Responsibilities:
//   - Package discovery (listing available packages)
//   - Version enumeration
//   - Search by name/keyword
//   - Package metadata storage
//
// The registry is intentionally decoupled from network I/O — it operates on
// plain data. A future registry client will populate it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type SemVer,
  type VersionConstraint,
  parseSemVer,
  semVerToString,
  satisfies,
  compareSemVer,
} from "./manifest.js";
import { pickBestVersion } from "./dependency-graph.js";

// ── Package entry ─────────────────────────────────────────────────────────────

export interface RegistryPackageVersion {
  version: SemVer;
  /** Content hash of the package archive */
  integrity: string;
  /** Download URL or local cache path */
  resolved: string;
  /** Direct dependencies (name → constraint string) */
  dependencies: Record<string, string>;
  /** Optional description for this version */
  description?: string | undefined;
}

export interface RegistryPackage {
  name: string;
  /** All published versions, newest first */
  versions: RegistryPackageVersion[];
  /** Keywords for search */
  keywords: string[];
  /** Author */
  author?: string | undefined;
  /** Package homepage */
  homepage?: string | undefined;
}

// ── Registry diagnostics ──────────────────────────────────────────────────────

export interface RegistryDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export const REGISTRY_CODES = {
  PACKAGE_NOT_FOUND:  "RG1001",
  VERSION_NOT_FOUND:  "RG1002",
  DUPLICATE_PACKAGE:  "RG1003",
  INVALID_VERSION:    "RG1004",
} as const;

// ── PackageRegistry ───────────────────────────────────────────────────────────

export class PackageRegistry {
  private packages: Map<string, RegistryPackage> = new Map();

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a package in the registry.
   * If the package already exists, merges versions.
   */
  register(pkg: RegistryPackage): RegistryDiagnostic[] {
    const diagnostics: RegistryDiagnostic[] = [];
    const existing = this.packages.get(pkg.name);

    if (existing) {
      // Merge: add versions not already present
      const existingVersionStrings = new Set(existing.versions.map(v => semVerToString(v.version)));
      for (const v of pkg.versions) {
        const key = semVerToString(v.version);
        if (existingVersionStrings.has(key)) {
          diagnostics.push({
            severity: "warning",
            code: REGISTRY_CODES.DUPLICATE_PACKAGE,
            message: `package '${pkg.name}@${key}' already registered — skipping`,
          });
        } else {
          existing.versions.push(v);
        }
      }
      // Re-sort newest first
      existing.versions.sort((a, b) => compareSemVer(b.version, a.version));
    } else {
      // Sort newest first on initial registration
      const sorted = [...pkg.versions].sort((a, b) => compareSemVer(b.version, a.version));
      this.packages.set(pkg.name, { ...pkg, versions: sorted });
    }

    return diagnostics;
  }

  /**
   * Register a single version of a package.
   */
  registerVersion(
    name: string,
    version: string,
    entry: Omit<RegistryPackageVersion, "version">,
    keywords: string[] = [],
  ): RegistryDiagnostic[] {
    const parsed = parseSemVer(version);
    if (!parsed) {
      return [{
        severity: "error",
        code: REGISTRY_CODES.INVALID_VERSION,
        message: `invalid version string '${version}' for package '${name}'`,
      }];
    }

    const pkg = this.packages.get(name);
    if (pkg) {
      const key = semVerToString(parsed);
      const dup = pkg.versions.find(v => semVerToString(v.version) === key);
      if (dup) {
        return [{
          severity: "warning",
          code: REGISTRY_CODES.DUPLICATE_PACKAGE,
          message: `'${name}@${version}' already registered`,
        }];
      }
      pkg.versions.unshift({ version: parsed, ...entry });
      pkg.versions.sort((a, b) => compareSemVer(b.version, a.version));
    } else {
      this.packages.set(name, {
        name,
        keywords,
        versions: [{ version: parsed, ...entry }],
      });
    }

    return [];
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  /**
   * Returns the package metadata without version-specific info.
   */
  getPackage(name: string): RegistryPackage | undefined {
    return this.packages.get(name);
  }

  /**
   * Returns all versions of a package.
   */
  getVersions(name: string): RegistryPackageVersion[] {
    return this.packages.get(name)?.versions ?? [];
  }

  /**
   * Returns the latest version of a package (highest semver).
   */
  getLatest(name: string): RegistryPackageVersion | undefined {
    return this.packages.get(name)?.versions[0];
  }

  /**
   * Returns the best version matching a constraint.
   */
  resolve(
    name: string,
    constraint: VersionConstraint,
  ): RegistryPackageVersion | undefined {
    const pkg = this.packages.get(name);
    if (!pkg) return undefined;

    const candidates = pkg.versions.map(v => v.version);
    const best = pickBestVersion(candidates, constraint);
    if (!best) return undefined;

    const bestStr = semVerToString(best);
    return pkg.versions.find(v => semVerToString(v.version) === bestStr);
  }

  /**
   * Checks whether a specific version exists.
   */
  hasVersion(name: string, version: string): boolean {
    const pkg = this.packages.get(name);
    if (!pkg) return false;
    return pkg.versions.some(v => semVerToString(v.version) === version);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  /**
   * Search packages by name prefix or keyword.
   * Returns packages sorted by name.
   */
  search(query: string): RegistryPackage[] {
    const q = query.toLowerCase().trim();
    if (!q) return Array.from(this.packages.values()).sort((a, b) => a.name.localeCompare(b.name));

    return Array.from(this.packages.values())
      .filter(pkg =>
        pkg.name.toLowerCase().includes(q) ||
        pkg.keywords.some(k => k.toLowerCase().includes(q)) ||
        (pkg.versions[0]?.description?.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => {
        // Exact name match first, then prefix, then keyword
        const aExact = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
        const bExact = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns total number of packages in the registry.
   */
  size(): number {
    return this.packages.size;
  }

  /**
   * Returns all package names.
   */
  packageNames(): string[] {
    return Array.from(this.packages.keys()).sort();
  }

  /**
   * Returns all packages.
   */
  all(): RegistryPackage[] {
    return Array.from(this.packages.values());
  }
}
