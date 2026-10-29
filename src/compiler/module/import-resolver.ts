// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Module System: Import Resolver
//
// Resolves raw import paths (from `ImportRecord.path`) to canonical file paths:
//
//   Relative:  "./utils"       → <dir of importer>/utils.ur
//   Stdlib:    "std/io"        → <stdlib root>/io.ur
//   Package:   "mylib"         → <packages root>/mylib/index.ur
//
// Also detects circular imports and missing modules.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModuleDescriptor } from "./module-descriptor.js";

export interface ResolveError {
  kind: "missing" | "circular" | "ambiguous";
  importPath: string;
  fromFile: string;
  message: string;
}

export interface ResolveResult {
  /** Resolved canonical path, or undefined if resolution failed. */
  resolvedPath: string | undefined;
  error?: ResolveError | undefined;
}

export interface ResolverConfig {
  /** Root directory for stdlib packages (e.g. "std/io" → stdlib + "/io.ur"). */
  stdlibRoot?: string | undefined;
  /** Root directory for third-party packages. */
  packagesRoot?: string | undefined;
  /** Extension appended to bare names during resolution (default: ".ur"). */
  extension?: string | undefined;
}

const DEFAULT_CONFIG = {
  stdlibRoot:   "/usr/lib/ur/stdlib",
  packagesRoot: "./ur_packages",
  extension:    ".ur",
} as const satisfies ResolverConfig;

// ── Path helpers ──────────────────────────────────────────────────────────────

function dirOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx >= 0 ? filePath.slice(0, idx) : ".";
}

function normalizePath(raw: string): string {
  const parts: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

// ── ImportResolver ────────────────────────────────────────────────────────────

export class ImportResolver {
  private cfg: { stdlibRoot: string; packagesRoot: string; extension: string };
  /** All modules registered in the build (path → descriptor). */
  private registry: Map<string, ModuleDescriptor>;
  /** Tracks in-progress resolution to detect circular imports. */
  private resolving: Set<string> = new Set();

  constructor(
    registry: Map<string, ModuleDescriptor>,
    config: ResolverConfig = {},
  ) {
    this.registry = registry;
    this.cfg = {
      stdlibRoot:   config.stdlibRoot   ?? DEFAULT_CONFIG.stdlibRoot,
      packagesRoot: config.packagesRoot ?? DEFAULT_CONFIG.packagesRoot,
      extension:    config.extension    ?? DEFAULT_CONFIG.extension,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Resolves a single import path from `fromFile`.
   * Does NOT mutate the registry — callers should populate resolved paths.
   */
  resolve(importPath: string, fromFile: string): ResolveResult {
    const canonical = this.toCanonical(importPath, fromFile);
    if (!canonical) {
      return {
        resolvedPath: undefined,
        error: {
          kind: "missing",
          importPath,
          fromFile,
          message: `cannot resolve module '${importPath}' from '${fromFile}'`,
        },
      };
    }

    if (this.resolving.has(canonical)) {
      return {
        resolvedPath: undefined,
        error: {
          kind: "circular",
          importPath,
          fromFile,
          message: `circular import detected: '${fromFile}' → '${importPath}' (resolves to '${canonical}')`,
        },
      };
    }

    return { resolvedPath: canonical };
  }

  /**
   * Resolves all imports in a descriptor, mutating `ImportRecord.resolvedPath`.
   * Returns all errors encountered.
   */
  resolveAll(
    descriptor: ModuleDescriptor,
  ): ResolveError[] {
    const errors: ResolveError[] = [];
    this.resolving.add(descriptor.filePath);

    for (const imp of descriptor.imports) {
      const { resolvedPath, error } = this.resolve(imp.path, descriptor.filePath);
      if (error) {
        errors.push(error);
      } else {
        imp.resolvedPath = resolvedPath;
      }
    }

    this.resolving.delete(descriptor.filePath);
    return errors;
  }

  /**
   * Checks for circular dependencies among all registered modules.
   * Returns a list of cycles as arrays of file paths.
   */
  detectCycles(): string[][] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (path: string, stack: string[]): void => {
      if (inStack.has(path)) {
        const cycleStart = stack.indexOf(path);
        cycles.push(stack.slice(cycleStart));
        return;
      }
      if (visited.has(path)) return;
      visited.add(path);
      inStack.add(path);
      stack.push(path);

      const mod = this.registry.get(path);
      if (mod) {
        for (const imp of mod.imports) {
          if (imp.resolvedPath) dfs(imp.resolvedPath, [...stack]);
        }
      }

      inStack.delete(path);
    };

    for (const path of this.registry.keys()) {
      dfs(path, []);
    }
    return cycles;
  }

  // ── Resolution strategy ─────────────────────────────────────────────────────

  private toCanonical(importPath: string, fromFile: string): string | undefined {
    const ext = this.cfg.extension;

    // 1. Relative: starts with "./" or "../"
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      const dir = dirOf(fromFile);
      const resolved = normalizePath(`${dir}/${importPath}`);
      const withExt = resolved.endsWith(ext) ? resolved : resolved + ext;
      // Accept if in registry or as a path (we don't do filesystem access here)
      return withExt;
    }

    // 2. Standard library: starts with "std/"
    if (importPath.startsWith("std/")) {
      const rest = importPath.slice(4); // strip "std/"
      return normalizePath(`${this.cfg.stdlibRoot}/${rest}${ext}`);
    }

    // 3. Package: bare name (no slashes or "std/" prefix)
    if (!importPath.includes("/")) {
      return normalizePath(`${this.cfg.packagesRoot}/${importPath}/index${ext}`);
    }

    // 4. Scoped package path: "pkg/sub/module"
    return normalizePath(`${this.cfg.packagesRoot}/${importPath}${ext}`);
  }
}

// ── Build-order topological sort ──────────────────────────────────────────────

/**
 * Returns modules in dependency order (dependencies first).
 * Assumes cycles have already been detected and reported.
 */
export function topologicalOrder(
  registry: Map<string, ModuleDescriptor>,
): ModuleDescriptor[] {
  const visited = new Set<string>();
  const result: ModuleDescriptor[] = [];

  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    const mod = registry.get(path);
    if (!mod) return;
    for (const imp of mod.imports) {
      if (imp.resolvedPath) visit(imp.resolvedPath);
    }
    result.push(mod);
  }

  for (const path of registry.keys()) visit(path);
  return result;
}
