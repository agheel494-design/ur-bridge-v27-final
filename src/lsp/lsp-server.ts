// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: LspServer
//
// Orchestrates all LSP providers. Handles the LSP request/notification
// lifecycle without coupling to any transport (JSON-RPC, in-process, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import { TextDocumentManager } from "./text-document-manager.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { UriResolver } from "./uri-resolver.js";
import { DiagnosticEngine } from "./diagnostic-engine.js";
import { SymbolTable } from "./symbol-table.js";
import { HoverProvider } from "./hover-provider.js";
import { DefinitionProvider, ReferencesProvider } from "./navigation-providers.js";
import { CompletionEngine } from "./completion-engine.js";
import { SignatureHelpProvider, RenameProvider } from "./advanced-providers.js";
import {
  SemanticHighlightingProvider,
  WorkspaceSymbolsProvider,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
} from "./highlight-provider.js";
import { IncrementalLspBridge } from "./incremental-bridge.js";

import type { DiagnosticSet } from "./diagnostic-engine.js";
import type {
  CompletionContext,
  CompletionList,
  DocumentUri,
  Hover,
  Location,
  Position,
  PrepareRenameResult,
  SemanticTokens,
  ServerCapabilities,
  SignatureHelp,
  SymbolInformation,
  TextDocumentContentChangeEvent,
  TextDocumentItem,
  WorkspaceEdit,
} from "./protocol.js";
import type { LspBuildResult } from "./incremental-bridge.js";

export interface LspServerOptions {
  workspaceRoot: string;
  maxFiles?: number;
}

export class LspServer {
  readonly documents: TextDocumentManager;
  readonly workspace: WorkspaceManager;
  readonly resolver: UriResolver;
  readonly diagnosticEngine: DiagnosticEngine;
  readonly symbolTable: SymbolTable;

  private readonly hover: HoverProvider;
  private readonly definition: DefinitionProvider;
  private readonly references: ReferencesProvider;
  private readonly completion: CompletionEngine;
  private readonly signature: SignatureHelpProvider;
  private readonly rename: RenameProvider;
  private readonly highlight: SemanticHighlightingProvider;
  private readonly workspaceSymbols: WorkspaceSymbolsProvider;
  readonly bridge: IncrementalLspBridge;

  constructor(options: LspServerOptions) {
    this.resolver = new UriResolver(options.workspaceRoot);
    this.documents = new TextDocumentManager();
    this.workspace = new WorkspaceManager(this.resolver, {
      maxFiles: options.maxFiles,
    });
    this.diagnosticEngine = new DiagnosticEngine();
    this.symbolTable = new SymbolTable();

    this.hover = new HoverProvider(this.documents, this.symbolTable);
    this.definition = new DefinitionProvider(this.documents, this.symbolTable);
    this.references = new ReferencesProvider(this.documents, this.symbolTable);
    this.completion = new CompletionEngine(this.documents, this.symbolTable);
    this.signature = new SignatureHelpProvider(this.documents, this.symbolTable);
    this.rename = new RenameProvider(this.documents, this.symbolTable);
    this.highlight = new SemanticHighlightingProvider(this.documents, this.symbolTable);
    this.workspaceSymbols = new WorkspaceSymbolsProvider(this.symbolTable);
    this.bridge = new IncrementalLspBridge(
      this.documents,
      this.symbolTable,
      this.diagnosticEngine,
      this.resolver
    );
  }

  // ── Capabilities ──────────────────────────────────────────────────────────

  capabilities(): ServerCapabilities {
    return {
      textDocumentSync: 2, // Incremental
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      completionProvider: {
        triggerCharacters: [".", "::", "(", "\"", "'"],
        resolveProvider: false,
      },
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
        retriggerCharacters: [","],
      },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      renameProvider: { prepareProvider: true },
      semanticTokensProvider: {
        legend: {
          tokenTypes: TOKEN_TYPES,
          tokenModifiers: TOKEN_MODIFIERS,
        },
        full: true,
        range: false,
      },
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onOpen(item: TextDocumentItem): Promise<DiagnosticSet | null> {
    const doc = this.documents.open(item);
    this.workspace.updateFile(item.uri, item.text);
    const result = await this.bridge.analyzeSingle(item.uri);
    return this.diagnosticEngine.get(item.uri) ?? null;
  }

  async onChange(
    uri: DocumentUri,
    version: number,
    changes: TextDocumentContentChangeEvent[]
  ): Promise<DiagnosticSet | null> {
    const doc = this.documents.applyChanges(uri, version, changes);
    this.workspace.updateFile(uri, doc.text);
    await this.bridge.analyzeSingle(uri);
    return this.diagnosticEngine.get(uri) ?? null;
  }

  onClose(uri: DocumentUri): void {
    this.documents.close(uri);
  }

  // ── Providers ─────────────────────────────────────────────────────────────

  onHover(uri: DocumentUri, position: Position): Hover | null {
    return this.hover.provideHover(uri, position);
  }

  onDefinition(uri: DocumentUri, position: Position): Location | null {
    return this.definition.provideDefinition(uri, position);
  }

  onReferences(
    uri: DocumentUri,
    position: Position,
    includeDeclaration: boolean
  ): Location[] {
    return this.references.provideReferences(uri, position, includeDeclaration);
  }

  onCompletion(
    uri: DocumentUri,
    position: Position,
    context?: CompletionContext
  ): CompletionList {
    return this.completion.provideCompletions(uri, position, context);
  }

  onSignatureHelp(uri: DocumentUri, position: Position): SignatureHelp | null {
    return this.signature.provideSignatureHelp(uri, position);
  }

  onPrepareRename(uri: DocumentUri, position: Position): PrepareRenameResult | null {
    return this.rename.prepareRename(uri, position);
  }

  onRename(
    uri: DocumentUri,
    position: Position,
    newName: string
  ): WorkspaceEdit | null {
    return this.rename.provideRenameEdits(uri, position, newName);
  }

  onSemanticTokensFull(uri: DocumentUri): SemanticTokens {
    return this.highlight.provideSemanticTokens(uri);
  }

  onWorkspaceSymbol(query: string): SymbolInformation[] {
    return this.workspaceSymbols.provideWorkspaceSymbols(query);
  }

  // ── Full workspace build ──────────────────────────────────────────────────

  async analyzeWorkspace(): Promise<LspBuildResult> {
    return this.bridge.analyzeAll();
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  stats() {
    return {
      openDocuments: this.documents.size(),
      workspaceFiles: this.workspace.fileCount(),
      symbols: this.symbolTable.totalDeclarations(),
      references: this.symbolTable.totalReferences(),
      diagnosticErrors: this.diagnosticEngine.totalErrors(),
      cacheStats: this.bridge.getCacheStats(),
    };
  }
}
