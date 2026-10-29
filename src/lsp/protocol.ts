// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP Protocol Types (subset of LSP 3.17)
// ─────────────────────────────────────────────────────────────────────────────

// ── Primitives ────────────────────────────────────────────────────────────────

export type Uri = string;
export type DocumentUri = string;

export interface Position {
  /** 0-based line number. */
  line: number;
  /** 0-based UTF-16 character offset. */
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: DocumentUri;
  range: Range;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

// ── Text Document ─────────────────────────────────────────────────────────────

export interface TextDocumentIdentifier {
  uri: DocumentUri;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentItem {
  uri: DocumentUri;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentContentChangeEvent {
  /** If range is omitted, the entire document is replaced. */
  range?: Range;
  text: string;
}

// ── Diagnostic ────────────────────────────────────────────────────────────────

export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity];

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverityValue;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

// ── Completion ────────────────────────────────────────────────────────────────

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
} as const;

export type CompletionItemKindValue = (typeof CompletionItemKind)[keyof typeof CompletionItemKind];

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKindValue;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
  commitCharacters?: string[];
  deprecated?: boolean;
  preselect?: boolean;
  data?: unknown;
}

export interface CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];
}

export interface CompletionContext {
  triggerKind: 1 | 2 | 3; // Invoked | TriggerCharacter | TriggerForIncompleteCompletions
  triggerCharacter?: string;
}

// ── Hover ─────────────────────────────────────────────────────────────────────

export interface MarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}

export interface Hover {
  contents: MarkupContent | string;
  range?: Range;
}

// ── Signature Help ────────────────────────────────────────────────────────────

export interface ParameterInformation {
  label: string | [number, number];
  documentation?: string;
}

export interface SignatureInformation {
  label: string;
  documentation?: string;
  parameters?: ParameterInformation[];
  activeParameter?: number;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

// ── Semantic Tokens ───────────────────────────────────────────────────────────

export const SemanticTokenTypes = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
] as const;

export type SemanticTokenType = (typeof SemanticTokenTypes)[number];

export const SemanticTokenModifiers = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
] as const;

export type SemanticTokenModifier = (typeof SemanticTokenModifiers)[number];

export interface SemanticTokens {
  /** Encoded token data: [deltaLine, deltaChar, length, tokenType, tokenModifiers] * N */
  data: number[];
}

// ── Workspace Symbol ──────────────────────────────────────────────────────────

export const SymbolKind = {
  File: 1, Module: 2, Namespace: 3, Package: 4,
  Class: 5, Method: 6, Property: 7, Field: 8,
  Constructor: 9, Enum: 10, Interface: 11, Function: 12,
  Variable: 13, Constant: 14, String: 15, Number: 16,
  Boolean: 17, Array: 18, Object: 19, Key: 20,
  Null: 21, EnumMember: 22, Struct: 23, Event: 24,
  Operator: 25, TypeParameter: 26,
} as const;

export type SymbolKindValue = (typeof SymbolKind)[keyof typeof SymbolKind];

export interface SymbolInformation {
  name: string;
  kind: SymbolKindValue;
  location: Location;
  containerName?: string;
  deprecated?: boolean;
}

export interface DocumentSymbol {
  name: string;
  kind: SymbolKindValue;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
  deprecated?: boolean;
}

// ── Rename ────────────────────────────────────────────────────────────────────

export interface WorkspaceEdit {
  changes?: { [uri: DocumentUri]: TextEdit[] };
}

export interface PrepareRenameResult {
  range: Range;
  placeholder: string;
}

// ── LSP Server Capabilities ───────────────────────────────────────────────────

export interface ServerCapabilities {
  textDocumentSync: 1 | 2; // None=0, Full=1, Incremental=2
  completionProvider?: {
    triggerCharacters?: string[];
    resolveProvider?: boolean;
  };
  hoverProvider?: boolean;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  documentHighlightProvider?: boolean;
  documentSymbolProvider?: boolean;
  workspaceSymbolProvider?: boolean;
  renameProvider?: boolean | { prepareProvider: boolean };
  signatureHelpProvider?: {
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
  };
  semanticTokensProvider?: {
    legend: {
      tokenTypes: string[];
      tokenModifiers: string[];
    };
    full: boolean;
    range?: boolean;
  };
}
