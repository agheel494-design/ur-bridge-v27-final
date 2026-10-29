// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Module System: Module Registry
//
// ModuleRegistry is the top-level coordinator for a multi-file UR build.
// It ties together:
//   1. ModuleDescriptor building from parsed Programs
//   2. Import resolution
//   3. Circular-dependency detection
//   4. Export checking
//   5. Topological ordering for compilation
// ─────────────────────────────────────────────────────────────────────────────

import type { Program } from "../frontend/ast.js";
import type { URType } from "../typesystem/types.js";
import type { ModuleDescriptor } from "./module-descriptor.js";
import { ImportResolver, topologicalOrder, type ResolverConfig } from "./import-resolver.js";
import {
  buildModuleDescriptor,
  checkExports,
  type ModuleDiagnostic,
} from "./export-checker.js";

export interface RegistryResult {
  diagnostics: ModuleDiagnostic[];
  buildOrder: ModuleDescriptor[];
  valid: boolean;
}

export class ModuleRegistry {
  private modules: Map<string, ModuleDescriptor> = new Map();
  private resolver: ImportResolver;

  constructor(config: ResolverConfig = {}) {
    this.resolver = new ImportResolver(this.modules, config);
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /** Register a parsed Program as a module. */
  register(
    program: Program,
    filePath: string,
  ): ModuleDiagnostic[] {
    const { descriptor, diagnostics } = buildModuleDescriptor(program, filePath);
    this.modules.set(filePath, descriptor);
    return diagnostics;
  }

  /** Register a pre-built descriptor directly (used in tests). */
  registerDescriptor(descriptor: ModuleDescriptor): void {
    this.modules.set(descriptor.filePath, descriptor);
  }

  get(filePath: string): ModuleDescriptor | undefined {
    return this.modules.get(filePath);
  }

  /**
   * Real cross-module wiring (Blocker 1, per explicit direction):
   * returns the set of names exported by a given, already-registered
   * module - using the descriptor's own existing `exports` Map
   * (already populated by `buildModuleDescriptor`, no new tracking
   * logic added). Intended to be passed to
   * `analyze(program, externalFunctionNames)` for a program that
   * imports this module, so previously-undefined-function errors
   * (SE1002) for genuinely-exported names are correctly suppressed.
   */
  getExportedNames(filePath: string): ReadonlySet<string> {
    const descriptor = this.modules.get(filePath);
    if (!descriptor) return new Set();
    return new Set(descriptor.exports.keys());
  }

  /**
   * Real cross-module wiring (Blocker 4, per explicit direction):
   * same idea as getExportedNames(), but returns the actual exported
   * URType for each name (not just the name) - needed so
   * TypeChecker can recognize an imported struct/type-alias as a
   * genuinely known type, not just a known symbol.
   */
  getExportedTypes(filePath: string): ReadonlyMap<string, URType> {
    const descriptor = this.modules.get(filePath);
    const result = new Map<string, URType>();
    if (!descriptor) return result;
    for (const [name, record] of descriptor.exports) {
      result.set(name, record.type);
    }
    return result;
  }

  all(): ModuleDescriptor[] {
    return Array.from(this.modules.values());
  }

  size(): number {
    return this.modules.size;
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /**
   * Resolves all imports across all registered modules.
   * Must be called after all modules are registered.
   */
  resolveAll(): RegistryResult {
    const diagnostics: ModuleDiagnostic[] = [];

    // Pass 1: resolve imports for each module
    for (const mod of this.modules.values()) {
      const errors = this.resolver.resolveAll(mod);
      for (const e of errors) {
        diagnostics.push({
          severity: "error",
          code: e.kind === "circular" ? "MD1004" :
                e.kind === "missing"  ? "MD1005" : "MD1006",
          message: e.message,
          filePath: e.fromFile,
        });
      }
    }

    // Pass 2: detect circular imports
    const cycles = this.resolver.detectCycles();
    for (const cycle of cycles) {
      diagnostics.push({
        severity: "error",
        code: "MD1004",
        message: `circular import: ${cycle.join(" → ")}`,
        filePath: cycle[0] ?? "",
      });
    }

    // Pass 3: validate exports
    for (const mod of this.modules.values()) {
      const errs = checkExports(mod, this.modules);
      diagnostics.push(...errs);
    }

    // Mark all resolved
    for (const mod of this.modules.values()) {
      mod.resolved = true;
    }

    // Build order (topological)
    const buildOrder = cycles.length === 0
      ? topologicalOrder(this.modules)
      : Array.from(this.modules.values());

    const valid = diagnostics.every(d => d.severity !== "error");
    return { diagnostics, buildOrder, valid };
  }

  // ── Lookup helpers ────────────────────────────────────────────────────────

  /** Resolve an import path from a given file. */
  resolveImport(importPath: string, fromFile: string): string | undefined {
    return this.resolver.resolve(importPath, fromFile).resolvedPath;
  }

  /**
   * Find which module exports a given name.
   * Useful for cross-module "go to definition" (future LSP use).
   */
  findExport(name: string): { filePath: string; descriptor: ModuleDescriptor } | undefined {
    for (const [filePath, mod] of this.modules) {
      if (mod.exports.has(name)) return { filePath, descriptor: mod };
    }
    return undefined;
  }
}
