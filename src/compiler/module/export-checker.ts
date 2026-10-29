// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Module System: Export Checker + Module Builder
//
// ExportChecker validates that exported names exist in the AST and have known
// types. ModuleBuilder constructs a ModuleDescriptor from a parsed Program.
// ─────────────────────────────────────────────────────────────────────────────

import type { Program } from "../frontend/ast.js";
import type { URType } from "../typesystem/types.js";

import { resolveOptionalTypeRef } from "../typesystem/type-env.js";
import {
  makeModuleDescriptor,
  type ModuleDescriptor,
  type ExportRecord,
  type ImportRecord,
} from "./module-descriptor.js";

// ── Module diagnostic ─────────────────────────────────────────────────────────

export interface ModuleDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  filePath: string;
}

export const MCODES = {
  DUPLICATE_EXPORT:    "MD1001",
  MISSING_EXPORT:      "MD1002",
  UNRESOLVED_IMPORT:   "MD1003",
  CIRCULAR_IMPORT:     "MD1004",
  MISSING_MODULE:      "MD1005",
  AMBIGUOUS_IMPORT:    "MD1006",
} as const;

// ── Module Builder ────────────────────────────────────────────────────────────

/**
 * Builds a `ModuleDescriptor` from a parsed Program AST.
 * Extracts: module name, all top-level declarations as exports,
 * all import declarations as unresolved ImportRecords.
 *
 * In UR Phase 1.5 all top-level declarations are implicitly exported.
 * Explicit `export` keyword support is deferred to Phase 2.
 */
export function buildModuleDescriptor(
  program: Program,
  filePath: string,
): { descriptor: ModuleDescriptor; diagnostics: ModuleDiagnostic[] } {
  const diagnostics: ModuleDiagnostic[] = [];

  // Determine module name
  const declaredName = program.modules[0]?.name;
  const descriptor = makeModuleDescriptor(filePath, declaredName);

  // ── Imports ────────────────────────────────────────────────────────────────
  for (const imp of program.imports) {
    const alias = imp.alias ?? deriveAlias(imp.path[imp.path.length - 1] ?? "");
    const record: ImportRecord = {
      path: imp.path.join("/"),
      alias,
    };
    descriptor.imports.push(record);
  }

  // ── Exports: global variables ──────────────────────────────────────────────
  for (const g of program.globals) {
    const ty = resolveOptionalTypeRef(g.type);
    const existing = descriptor.exports.get(g.name);
    if (existing) {
      diagnostics.push({
        severity: "error",
        code: MCODES.DUPLICATE_EXPORT,
        message: `duplicate export '${g.name}'`,
        filePath,
      });
      continue;
    }
    const rec: ExportRecord = {
      name: g.name,
      kind: g.isConst ? "const" : "variable",
      type: ty,
    };
    descriptor.exports.set(g.name, rec);
  }

  // ── Exports: functions ────────────────────────────────────────────────────
  for (const fn of program.functions) {
    const existing = descriptor.exports.get(fn.name);
    if (existing) {
      diagnostics.push({
        severity: "error",
        code: MCODES.DUPLICATE_EXPORT,
        message: `duplicate export '${fn.name}'`,
        filePath,
      });
      continue;
    }
    const paramTypes: URType[] = fn.params.map(p => resolveOptionalTypeRef(p.type));
    const retType: URType = resolveOptionalTypeRef(fn.returnType);
    const rec: ExportRecord = {
      name: fn.name,
      kind: "function",
      type: { kind: "Function", params: paramTypes, ret: retType },
    };
    descriptor.exports.set(fn.name, rec);
  }

  // ── Exports: structs (Blocker 4: struct must work as an importable type) ───
  for (const st of program.structs) {
    const existing = descriptor.exports.get(st.name);
    if (existing) {
      diagnostics.push({
        severity: "error",
        code: MCODES.DUPLICATE_EXPORT,
        message: `duplicate export '${st.name}'`,
        filePath,
      });
      continue;
    }
    const fields = st.fields.map(f => ({ name: f.name, type: resolveOptionalTypeRef(f.type) }));
    const rec: ExportRecord = {
      name: st.name,
      kind: "type",
      type: { kind: "Struct", name: st.name, fields },
    };
    descriptor.exports.set(st.name, rec);
  }

  // ── Exports: type aliases ───────────────────────────────────────────────────
  for (const ta of program.typeAliases) {
    const existing = descriptor.exports.get(ta.name);
    if (existing) {
      diagnostics.push({
        severity: "error",
        code: MCODES.DUPLICATE_EXPORT,
        message: `duplicate export '${ta.name}'`,
        filePath,
      });
      continue;
    }
    const rec: ExportRecord = {
      name: ta.name,
      kind: "type",
      type: resolveOptionalTypeRef(ta.aliasedType),
    };
    descriptor.exports.set(ta.name, rec);
  }

  descriptor.resolved = false;
  return { descriptor, diagnostics };
}

// ── Export Checker ─────────────────────────────────────────────────────────────

/**
 * Validates that every name imported from another module actually exists
 * in that module's exports.
 */
export function checkExports(
  importer: ModuleDescriptor,
  registry: Map<string, ModuleDescriptor>,
): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];

  for (const imp of importer.imports) {
    if (!imp.resolvedPath) continue; // unresolved — error already logged by resolver

    const target = registry.get(imp.resolvedPath);
    if (!target) {
      diagnostics.push({
        severity: "error",
        code: MCODES.MISSING_MODULE,
        message: `module '${imp.path}' (resolved to '${imp.resolvedPath}') not found in registry`,
        filePath: importer.filePath,
      });
      continue;
    }

    // The alias itself is the binding name; nothing more to validate at Phase 1.5
    // (explicit named imports like `import { fn } from "x"` are Phase 2).
  }

  return diagnostics;
}

// ── Package Resolution stub ──────────────────────────────────────────────────

/**
 * Stub for package-name → local path resolution.
 * Full implementation deferred to urpm (Phase 5).
 */
export function resolvePackageName(
  packageName: string,
  packagesRoot: string,
): string {
  return `${packagesRoot}/${packageName}/index.ur`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveAlias(path: string): string {
  // "std/io" → "io", "./utils/math" → "math", "mylib" → "mylib"
  return path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
}

/** Returns the set of all names accessible via an import alias. */
export function exportsOf(
  alias: string,
  importer: ModuleDescriptor,
  registry: Map<string, ModuleDescriptor>,
): Map<string, ExportRecord> {
  const imp = importer.imports.find(i => i.alias === alias);
  if (!imp?.resolvedPath) return new Map();
  return registry.get(imp.resolvedPath)?.exports ?? new Map();
}

/** Look up a single export by alias + name. */
export function lookupExport(
  alias: string,
  name: string,
  importer: ModuleDescriptor,
  registry: Map<string, ModuleDescriptor>,
): ExportRecord | undefined {
  return exportsOf(alias, importer, registry).get(name) ??
    // Also try the module itself (alias is the module name)
    (alias === importer.name ? importer.exports.get(name) : undefined);
}
