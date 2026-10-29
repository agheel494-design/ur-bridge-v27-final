// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: SymbolTable
//
// Maintains a per-document and workspace-wide index of declared symbols.
// Used by Hover, Go To Definition, Find References, Completion, and Rename.
//
// This is a standalone in-memory structure; it is populated by the
// SemanticAnalyzer output, not by re-parsing.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentUri, Location, Range, SymbolKindValue } from "./protocol.js";
import { SymbolKind } from "./protocol.js";

// ── Symbol record ─────────────────────────────────────────────────────────────

export interface UrSymbol {
  /** Canonical name. */
  name: string;
  /** LSP SymbolKind. */
  kind: SymbolKindValue;
  /** File where the symbol is declared. */
  definedIn: DocumentUri;
  /** Range of the defining token. */
  definitionRange: Range;
  /** Type annotation (if known). */
  typeAnnotation?: string;
  /** Documentation comment (if any). */
  documentation?: string;
  /** For function/method symbols: parameter signature. */
  signature?: string;
  /** For function params: list of { name, type }. */
  parameters?: Array<{ name: string; type: string }>;
  /** True if the symbol was exported from its module. */
  exported: boolean;
  /** Parent symbol name (e.g., method inside a class). */
  containerName?: string;
}

// ── Reference record ──────────────────────────────────────────────────────────

export interface UrReference {
  symbolName: string;
  definedIn: DocumentUri;
  location: Location;
}

// ── Symbol Table ──────────────────────────────────────────────────────────────

export class SymbolTable {
  /** Declarations: symbolKey → UrSymbol */
  private readonly declarations = new Map<string, UrSymbol>();

  /** References: symbolKey → locations */
  private readonly references = new Map<string, Location[]>();

  /** Per-document declared symbol keys */
  private readonly docSymbols = new Map<DocumentUri, Set<string>>();

  /** Per-document reference keys */
  private readonly docRefs = new Map<DocumentUri, Set<string>>();

  // ── Keys ────────────────────────────────────────────────────────────────────

  private symbolKey(name: string, definedIn: DocumentUri): string {
    return `${definedIn}::${name}`;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  declareSymbol(sym: UrSymbol): void {
    const key = this.symbolKey(sym.name, sym.definedIn);
    this.declarations.set(key, sym);

    let docSet = this.docSymbols.get(sym.definedIn);
    if (!docSet) {
      docSet = new Set();
      this.docSymbols.set(sym.definedIn, docSet);
    }
    docSet.add(key);
  }

  addReference(ref: UrReference): void {
    const key = this.symbolKey(ref.symbolName, ref.definedIn);

    let locs = this.references.get(key);
    if (!locs) {
      locs = [];
      this.references.set(key, locs);
    }
    locs.push(ref.location);

    let docSet = this.docRefs.get(ref.location.uri);
    if (!docSet) {
      docSet = new Set();
      this.docRefs.set(ref.location.uri, docSet);
    }
    docSet.add(key);
  }

  // ── Lookup ───────────────────────────────────────────────────────────────────

  getDefinition(name: string, inUri: DocumentUri): UrSymbol | undefined {
    // Try same-document first
    const localKey = this.symbolKey(name, inUri);
    const local = this.declarations.get(localKey);
    if (local) return local;

    // Search all documents
    for (const [key, sym] of this.declarations) {
      if (key.endsWith(`::${name}`) && sym.exported) {
        return sym;
      }
    }
    return undefined;
  }

  getReferences(name: string, definedIn: DocumentUri): Location[] {
    const key = this.symbolKey(name, definedIn);
    return this.references.get(key) ?? [];
  }

  /** All symbols declared in a document. */
  symbolsInDocument(uri: DocumentUri): UrSymbol[] {
    const keys = this.docSymbols.get(uri);
    if (!keys) return [];
    const syms: UrSymbol[] = [];
    for (const key of keys) {
      const sym = this.declarations.get(key);
      if (sym) syms.push(sym);
    }
    return syms;
  }

  /** All symbols visible in a document (local + exported from imports). */
  visibleSymbols(uri: DocumentUri, importedUris: DocumentUri[] = []): UrSymbol[] {
    const result: UrSymbol[] = [];
    // Local symbols
    result.push(...this.symbolsInDocument(uri));
    // Exported symbols from imports
    for (const importUri of importedUris) {
      for (const sym of this.symbolsInDocument(importUri)) {
        if (sym.exported) result.push(sym);
      }
    }
    return result;
  }

  /** Workspace-wide symbol search. */
  searchWorkspace(query: string, maxResults = 100): UrSymbol[] {
    const q = query.toLowerCase();
    const results: UrSymbol[] = [];
    for (const sym of this.declarations.values()) {
      if (sym.name.toLowerCase().includes(q)) {
        results.push(sym);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }

  // ── Invalidation ────────────────────────────────────────────────────────────

  /** Remove all symbols and references declared/located in a document. */
  invalidateDocument(uri: DocumentUri): void {
    // Remove declarations
    const declKeys = this.docSymbols.get(uri) ?? new Set();
    for (const key of declKeys) {
      this.declarations.delete(key);
      this.references.delete(key);
    }
    this.docSymbols.delete(uri);

    // Remove references that point into this document
    const refKeys = this.docRefs.get(uri) ?? new Set();
    for (const key of refKeys) {
      const locs = this.references.get(key);
      if (locs) {
        const filtered = locs.filter((l) => l.uri !== uri);
        if (filtered.length === 0) {
          this.references.delete(key);
        } else {
          this.references.set(key, filtered);
        }
      }
    }
    this.docRefs.delete(uri);
  }

  totalDeclarations(): number {
    return this.declarations.size;
  }

  totalReferences(): number {
    let n = 0;
    for (const locs of this.references.values()) n += locs.length;
    return n;
  }
}

// ── Builtins ──────────────────────────────────────────────────────────────────

export const UR_KEYWORDS: string[] = [
  "let", "mut", "fn", "return", "if", "else", "while", "for", "in",
  "match", "case", "struct", "enum", "trait", "impl", "type", "module",
  "import", "export", "pub", "priv", "true", "false", "null", "and",
  "or", "not", "as", "use", "from", "new", "self", "super",
];

export const UR_BUILTIN_TYPES: Array<{ name: string; doc: string }> = [
  { name: "Int",    doc: "64-bit signed integer." },
  { name: "Float",  doc: "64-bit IEEE 754 floating point." },
  { name: "Bool",   doc: "Boolean value (true | false)." },
  { name: "String", doc: "Immutable UTF-8 string." },
  { name: "Char",   doc: "Unicode scalar value." },
  { name: "Void",   doc: "Unit type — no value." },
  { name: "Never",  doc: "Bottom type — expression never returns." },
  { name: "List",   doc: "Generic dynamically-sized list." },
  { name: "Map",    doc: "Generic key-value map." },
  { name: "Option", doc: "Optional value: Some(T) | None." },
  { name: "Result", doc: "Error-handling type: Ok(T) | Err(E)." },
];

export function builtinSymbol(name: string, doc: string, kind: SymbolKindValue): UrSymbol {
  return {
    name,
    kind,
    definedIn: "builtin://ur",
    definitionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    typeAnnotation: name,
    documentation: doc,
    exported: true,
  };
}
