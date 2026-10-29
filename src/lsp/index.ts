// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: Public API
// ─────────────────────────────────────────────────────────────────────────────

export { LspServer, type LspServerOptions } from "./lsp-server.js";
export { TextDocumentManager, type ManagedDocument } from "./text-document-manager.js";
export { WorkspaceManager, type WorkspaceFile, type WorkspaceSettings } from "./workspace-manager.js";
export { UriResolver } from "./uri-resolver.js";
export { PositionMapper } from "./position-mapper.js";
export { DiagnosticEngine, type DiagnosticSet } from "./diagnostic-engine.js";
export { SymbolTable, type UrSymbol, type UrReference, UR_KEYWORDS, UR_BUILTIN_TYPES } from "./symbol-table.js";
export { HoverProvider } from "./hover-provider.js";
export { DefinitionProvider, ReferencesProvider } from "./navigation-providers.js";
export { CompletionEngine } from "./completion-engine.js";
export { SignatureHelpProvider, RenameProvider } from "./advanced-providers.js";
export { SemanticHighlightingProvider, WorkspaceSymbolsProvider, TOKEN_TYPES, TOKEN_MODIFIERS } from "./highlight-provider.js";
export { IncrementalLspBridge, type LspBuildResult } from "./incremental-bridge.js";
export * from "./protocol.js";
