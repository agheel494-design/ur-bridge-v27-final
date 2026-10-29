// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: DefinitionProvider + ReferencesProvider
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentUri, Location, Position } from "./protocol.js";
import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable } from "./symbol-table.js";

// ── Definition ────────────────────────────────────────────────────────────────

export class DefinitionProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideDefinition(uri: DocumentUri, position: Position): Location | null {
    const doc = this.docs.get(uri);
    if (!doc) return null;

    const wordResult = doc.mapper.wordAtPosition(position);
    if (!wordResult) return null;

    const sym = this.symbols.getDefinition(wordResult.word, uri);
    if (!sym) return null;

    return {
      uri: sym.definedIn,
      range: sym.definitionRange,
    };
  }
}

// ── References ────────────────────────────────────────────────────────────────

export class ReferencesProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideReferences(
    uri: DocumentUri,
    position: Position,
    includeDeclaration: boolean
  ): Location[] {
    const doc = this.docs.get(uri);
    if (!doc) return [];

    const wordResult = doc.mapper.wordAtPosition(position);
    if (!wordResult) return [];

    const sym = this.symbols.getDefinition(wordResult.word, uri);
    if (!sym) return [];

    const refs = this.symbols.getReferences(sym.name, sym.definedIn);

    if (includeDeclaration) {
      return [
        { uri: sym.definedIn, range: sym.definitionRange },
        ...refs,
      ];
    }

    return refs;
  }
}
