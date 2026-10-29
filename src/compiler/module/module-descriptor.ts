// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Module System (Phase 1.5): Module Descriptor
//
// A ModuleDescriptor captures everything known about a single UR source file:
// its canonical path, the names it exports (with resolved types), and the
// imports it declares (with resolved paths ready for the import resolver).
//
// No dependency on src/compiler, src/runtime, src/cli, src/lsp, or src/urpm.
// ─────────────────────────────────────────────────────────────────────────────

import type { URType } from "../typesystem/types.js";

// ── Export record ─────────────────────────────────────────────────────────────

export type ExportKind = "function" | "variable" | "const" | "type";

export interface ExportRecord {
  /** The name as it appears at the use-site (after alias resolution). */
  name: string;
  kind: ExportKind;
  /** Resolved type, if available. Unknown for opaque re-exports. */
  type: URType;
}

// ── Import record (before resolution) ────────────────────────────────────────

export interface ImportRecord {
  /** Raw path string from the source: "std/io", "./utils", etc. */
  path: string;
  /** Alias bound in the importing file (`import "x" as alias`). */
  alias: string;
  /** Resolved module path after ImportResolver runs (undefined until resolved). */
  resolvedPath?: string | undefined;
}

// ── Module descriptor ─────────────────────────────────────────────────────────

export interface ModuleDescriptor {
  /** Canonical absolute path of the source file. */
  filePath: string;
  /** Module name declared with `module <name>` (defaults to stem of filePath). */
  name: string;
  /** All names exported from this module. */
  exports: Map<string, ExportRecord>;
  /** All imports declared in this module. */
  imports: ImportRecord[];
  /** Whether this descriptor has been fully resolved (imports + types). */
  resolved: boolean;
}

/** Creates an empty ModuleDescriptor for a given file. */
export function makeModuleDescriptor(filePath: string, name?: string): ModuleDescriptor {
  const stem = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "main";
  return {
    filePath,
    name: name ?? stem,
    exports: new Map(),
    imports: [],
    resolved: false,
  };
}
