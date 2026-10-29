// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Resolver
//
// Ties together the PackageRegistry and DependencyGraph to produce a fully
// resolved, reproducible build plan:
//
//   1. Start from a Manifest's dependency list
//   2. Resolve each dependency's best version from the registry
//   3. Recursively resolve transitive dependencies
//   4. Detect conflicts and cycles via DependencyGraph
//   5. Produce a LockFile for reproducible installs
//
// This module is pure — it does not perform I/O. The caller supplies the
// registry and manifest.
// ─────────────────────────────────────────────────────────────────────────────

import {
  type Manifest,
  type PackageDependency,
  type LockFile,
  type LockedPackage,
  parseVersionConstraint,
  makeLockFile,
  semVerToString,
  parseSemVer,
} from "./manifest.js";

import {
  DependencyGraph,
  type PackageNode,
  type ResolutionDiagnostic,
  RCODES,
  buildGraph,
} from "./dependency-graph.js";

import { type PackageRegistry } from "./registry.js";

// ── Resolution output ─────────────────────────────────────────────────────────

export interface ResolveOutput {
  /** Generated lock file */
  lockFile: LockFile;
  /** Build order (dependency-first) */
  buildOrder: PackageNode[];
  /** All diagnostics (errors + warnings) */
  diagnostics: ResolutionDiagnostic[];
  valid: boolean;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export class Resolver {
  private registry: PackageRegistry;

  constructor(registry: PackageRegistry) {
    this.registry = registry;
  }

  /**
   * Resolve all dependencies declared in a manifest.
   * Performs BFS transitive resolution, then validates via DependencyGraph.
   */
  resolve(manifest: Manifest, includeDev = false): ResolveOutput {
    const diagnostics: ResolutionDiagnostic[] = [];
    const resolvedNodes = new Map<string, PackageNode>();
    const lockFile = makeLockFile();

    // Collect direct deps
    const directDeps: PackageDependency[] = [
      ...manifest.dependencies,
      ...(includeDev ? manifest.devDependencies : []),
    ];

    // BFS queue
    const queue: PackageDependency[] = [...directDeps];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const dep = queue.shift()!;
      if (visited.has(dep.name)) continue;
      visited.add(dep.name);

      // Parse constraint
      const constraint = dep.parsed ?? parseVersionConstraint(dep.constraint);
      if (!constraint) {
        diagnostics.push({
          severity: "error",
          code: RCODES.INVALID_CONSTRAINT,
          message: `invalid version constraint '${dep.constraint}' for '${dep.name}'`,
          packageName: dep.name,
        });
        continue;
      }

      // Resolve best version from registry
      const entry = this.registry.resolve(dep.name, constraint);
      if (!entry) {
        diagnostics.push({
          severity: "error",
          code: RCODES.MISSING_DEP,
          message: `no version of '${dep.name}' satisfies constraint '${dep.constraint}'`,
          packageName: dep.name,
        });
        continue;
      }

      // Build PackageNode
      const transitiveDeps: PackageDependency[] = Object.entries(entry.dependencies).map(
        ([name, constraint]) => ({
          name,
          constraint,
          parsed: parseVersionConstraint(constraint) ?? undefined,
        })
      );

      const node: PackageNode = {
        name: dep.name,
        version: entry.version,
        dependencies: transitiveDeps,
      };

      resolvedNodes.set(dep.name, node);

      // Lock entry
      const locked: LockedPackage = {
        name: dep.name,
        version: semVerToString(entry.version),
        parsedVersion: entry.version,
        integrity: entry.integrity,
        resolved: entry.resolved,
        dependencies: entry.dependencies,
      };
      lockFile.packages.set(dep.name, locked);

      // Enqueue transitive deps
      for (const transitive of transitiveDeps) {
        if (!visited.has(transitive.name)) {
          queue.push(transitive);
        }
      }
    }

    // Build and validate dependency graph
    const graph = buildGraph(Array.from(resolvedNodes.values()));
    const graphResult = graph.resolve();

    // Merge graph diagnostics
    diagnostics.push(...graphResult.diagnostics);

    const valid = diagnostics.every(d => d.severity !== "error");

    return {
      lockFile,
      buildOrder: graphResult.buildOrder,
      diagnostics,
      valid,
    };
  }

  /**
   * Install from an existing lock file (reproducible install).
   * Validates that all locked packages are available in the registry.
   */
  installFromLock(lockFile: LockFile): ResolveOutput {
    const diagnostics: ResolutionDiagnostic[] = [];
    const nodes: PackageNode[] = [];

    for (const [name, locked] of lockFile.packages) {
      const version = parseSemVer(locked.version);
      if (!version) {
        diagnostics.push({
          severity: "error",
          code: RCODES.INVALID_CONSTRAINT,
          message: `invalid locked version '${locked.version}' for '${name}'`,
          packageName: name,
        });
        continue;
      }

      const available = this.registry.hasVersion(name, locked.version);
      if (!available) {
        diagnostics.push({
          severity: "error",
          code: RCODES.MISSING_DEP,
          message: `locked package '${name}@${locked.version}' not found in registry`,
          packageName: name,
        });
      }

      const transitiveDeps: PackageDependency[] = Object.entries(locked.dependencies).map(
        ([n, c]) => ({ name: n, constraint: c, parsed: parseVersionConstraint(c) ?? undefined })
      );

      nodes.push({ name, version, dependencies: transitiveDeps });
    }

    const graph = buildGraph(nodes);
    const graphResult = graph.resolve();
    diagnostics.push(...graphResult.diagnostics);

    const valid = diagnostics.every(d => d.severity !== "error");
    return {
      lockFile,
      buildOrder: graphResult.buildOrder,
      diagnostics,
      valid,
    };
  }
}
