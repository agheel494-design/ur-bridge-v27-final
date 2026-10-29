// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Module System: Public API
// ─────────────────────────────────────────────────────────────────────────────

export { ModuleRegistry } from "./registry.js";
export type { RegistryResult } from "./registry.js";

export {
  makeModuleDescriptor,
  type ModuleDescriptor,
  type ExportRecord,
  type ImportRecord,
  type ExportKind,
} from "./module-descriptor.js";

export {
  ImportResolver,
  topologicalOrder,
  type ResolveError,
  type ResolveResult,
  type ResolverConfig,
} from "./import-resolver.js";

export {
  buildModuleDescriptor,
  checkExports,
  resolvePackageName,
  exportsOf,
  lookupExport,
  MCODES,
  type ModuleDiagnostic,
} from "./export-checker.js";
