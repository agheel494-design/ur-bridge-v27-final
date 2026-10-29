// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — urpm: Dependency Graph
//
// Builds and validates the dependency graph for a set of packages.
// Performs:
//   - Topological ordering (Kahn's algorithm)
//   - Circular dependency detection
//   - Version conflict detection
//   - Transitive dependency resolution
// ─────────────────────────────────────────────────────────────────────────────

import {
  type SemVer,
  type VersionConstraint,
  type PackageDependency,
  parseSemVer,
  parseVersionConstraint,
  satisfies,
  semVerToString,
  compareSemVer,
} from "./manifest.js";

// ── Graph node ────────────────────────────────────────────────────────────────

export interface PackageNode {
  name: string;
  version: SemVer;
  /** Direct dependencies of this node */
  dependencies: PackageDependency[];
}

// ── Resolution result ─────────────────────────────────────────────────────────

export interface ResolutionDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  packageName?: string | undefined;
}

export const RCODES = {
  CIRCULAR_DEP:      "RP1001",
  VERSION_CONFLICT:  "RP1002",
  MISSING_DEP:       "RP1003",
  INVALID_CONSTRAINT:"RP1004",
  INVALID_VERSION:   "RP1005",
} as const;

export interface ResolutionResult {
  /** Resolved packages in dependency order (dependencies first) */
  buildOrder: PackageNode[];
  /** All version conflicts and missing packages */
  diagnostics: ResolutionDiagnostic[];
  valid: boolean;
}

// ── DependencyGraph ───────────────────────────────────────────────────────────

export class DependencyGraph {
  private nodes: Map<string, PackageNode> = new Map();

  /** Add a package to the graph. */
  addPackage(node: PackageNode): void {
    this.nodes.set(node.name, node);
  }

  /** Returns all nodes in the graph. */
  all(): PackageNode[] {
    return Array.from(this.nodes.values());
  }

  get(name: string): PackageNode | undefined {
    return this.nodes.get(name);
  }

  size(): number {
    return this.nodes.size;
  }

  /**
   * Resolve the full dependency graph.
   * Returns build order + diagnostics.
   */
  resolve(): ResolutionResult {
    const diagnostics: ResolutionDiagnostic[] = [];

    // Validate all constraints are parseable
    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        if (!dep.parsed) {
          const parsed = parseVersionConstraint(dep.constraint);
          if (!parsed) {
            diagnostics.push({
              severity: "error",
              code: RCODES.INVALID_CONSTRAINT,
              message: `invalid version constraint '${dep.constraint}' for dependency '${dep.name}' in package '${node.name}'`,
              packageName: node.name,
            });
          } else {
            dep.parsed = parsed;
          }
        }
      }
    }

    // Detect missing dependencies
    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep.name)) {
          diagnostics.push({
            severity: "error",
            code: RCODES.MISSING_DEP,
            message: `missing dependency '${dep.name}' required by '${node.name}'`,
            packageName: node.name,
          });
        }
      }
    }

    // Detect version conflicts
    const conflicts = this.detectConflicts();
    diagnostics.push(...conflicts);

    // Detect circular dependencies
    const cycles = this.detectCycles();
    for (const cycle of cycles) {
      diagnostics.push({
        severity: "error",
        code: RCODES.CIRCULAR_DEP,
        message: `circular dependency: ${cycle.join(" → ")}`,
        packageName: cycle[0],
      });
    }

    // Topological order (only if no cycles)
    const buildOrder = cycles.length === 0
      ? this.topologicalOrder()
      : Array.from(this.nodes.values());

    const valid = diagnostics.every(d => d.severity !== "error");
    return { buildOrder, diagnostics, valid };
  }

  // ── Conflict detection ─────────────────────────────────────────────────────

  /**
   * Detects version conflicts: two packages requiring incompatible versions
   * of the same dependency.
   */
  private detectConflicts(): ResolutionDiagnostic[] {
    const diagnostics: ResolutionDiagnostic[] = [];
    // Map: dep name → list of (requirer, constraint)
    const requirements = new Map<string, Array<{ requirer: string; constraint: VersionConstraint }>>();

    for (const node of this.nodes.values()) {
      for (const dep of node.dependencies) {
        if (!dep.parsed) continue;
        if (!requirements.has(dep.name)) requirements.set(dep.name, []);
        requirements.get(dep.name)!.push({ requirer: node.name, constraint: dep.parsed });
      }
    }

    for (const [depName, reqs] of requirements) {
      const target = this.nodes.get(depName);
      if (!target) continue; // missing dep already reported

      // Check that the resolved version satisfies every constraint
      for (const req of reqs) {
        if (!satisfies(target.version, req.constraint)) {
          diagnostics.push({
            severity: "error",
            code: RCODES.VERSION_CONFLICT,
            message: `version conflict: '${req.requirer}' requires '${depName}@${req.constraint.raw}' but resolved version is '${semVerToString(target.version)}'`,
            packageName: depName,
          });
        }
      }

      // Also check all pairs of constraints are mutually compatible
      // (conservative: warn when constraints cannot possibly overlap)
      if (reqs.length > 1) {
        for (let i = 0; i < reqs.length; i++) {
          for (let j = i + 1; j < reqs.length; j++) {
            const a = reqs[i]!;
            const b = reqs[j]!;
            if (!constraintsCompatible(a.constraint, b.constraint)) {
              diagnostics.push({
                severity: "warning",
                code: RCODES.VERSION_CONFLICT,
                message: `potentially incompatible constraints on '${depName}': '${a.requirer}' wants '${a.constraint.raw}', '${b.requirer}' wants '${b.constraint.raw}'`,
                packageName: depName,
              });
            }
          }
        }
      }
    }

    return diagnostics;
  }

  // ── Cycle detection (DFS) ──────────────────────────────────────────────────

  private detectCycles(): string[][] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (name: string, stack: string[]): void => {
      if (inStack.has(name)) {
        const start = stack.indexOf(name);
        cycles.push([...stack.slice(start), name]);
        return;
      }
      if (visited.has(name)) return;
      visited.add(name);
      inStack.add(name);
      stack.push(name);

      const node = this.nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          dfs(dep.name, [...stack]);
        }
      }

      inStack.delete(name);
    };

    for (const name of this.nodes.keys()) dfs(name, []);
    return cycles;
  }

  // ── Topological order (Kahn's algorithm) ──────────────────────────────────

  private topologicalOrder(): PackageNode[] {
    // Build in-degree map
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>(); // name → dependents

    for (const node of this.nodes.values()) {
      if (!inDegree.has(node.name)) inDegree.set(node.name, 0);
      if (!adj.has(node.name)) adj.set(node.name, []);
      for (const dep of node.dependencies) {
        if (!this.nodes.has(dep.name)) continue;
        inDegree.set(node.name, (inDegree.get(node.name) ?? 0) + 1);
        if (!adj.has(dep.name)) adj.set(dep.name, []);
        adj.get(dep.name)!.push(node.name);
      }
    }

    // Start with nodes that have no dependencies
    const queue: string[] = [];
    for (const [name, deg] of inDegree) {
      if (deg === 0) queue.push(name);
    }
    queue.sort(); // deterministic order

    const result: PackageNode[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      const node = this.nodes.get(name);
      if (node) result.push(node);
      for (const dependent of (adj.get(name) ?? [])) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {
          queue.push(dependent);
          queue.sort();
        }
      }
    }

    return result;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Heuristically checks whether two version constraints can ever be
 * simultaneously satisfied. Conservative: only catches obvious cases.
 */
function constraintsCompatible(a: VersionConstraint, b: VersionConstraint): boolean {
  if (a.operator === "*" || b.operator === "*") return true;

  // If both are exact, they must be equal
  if (a.operator === "=" && b.operator === "=") {
    return compareSemVer(a.version, b.version) === 0;
  }

  // Major version mismatch under ^ is always incompatible
  if (a.operator === "^" && b.operator === "^") {
    if (a.version.major !== b.version.major) return false;
  }

  return true; // optimistic for other cases
}

/**
 * Builds a DependencyGraph from a flat list of PackageNodes.
 */
export function buildGraph(nodes: PackageNode[]): DependencyGraph {
  const g = new DependencyGraph();
  for (const n of nodes) g.addPackage(n);
  return g;
}

/**
 * Resolves the best version from a list of candidates satisfying a constraint.
 * Returns the highest satisfying version, or undefined.
 */
export function pickBestVersion(
  candidates: SemVer[],
  constraint: VersionConstraint,
): SemVer | undefined {
  const matching = candidates.filter(v => satisfies(v, constraint));
  if (matching.length === 0) return undefined;
  return matching.reduce((best, v) => compareSemVer(v, best) > 0 ? v : best, matching[0]!);
}
