// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: HoverProvider
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentUri, Hover, Position } from "./protocol.js";
import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable } from "./symbol-table.js";
import { UR_BUILTIN_TYPES, UR_KEYWORDS } from "./symbol-table.js";

export class HoverProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideHover(uri: DocumentUri, position: Position): Hover | null {
    const doc = this.docs.get(uri);
    if (!doc) return null;

    const wordResult = doc.mapper.wordAtPosition(position);
    if (!wordResult) return null;

    const { word, range } = wordResult;

    // 1. Try symbol table
    const sym = this.symbols.getDefinition(word, uri);
    if (sym) {
      let md = `**${kindLabel(sym.kind)}** \`${sym.name}\``;
      if (sym.typeAnnotation) md += `: \`${sym.typeAnnotation}\``;
      if (sym.signature) md += `\n\n\`\`\`ur\n${sym.signature}\n\`\`\``;
      if (sym.documentation) md += `\n\n${sym.documentation}`;
      return { contents: { kind: "markdown", value: md }, range };
    }

    // 2. Builtin types
    const builtin = UR_BUILTIN_TYPES.find((t) => t.name === word);
    if (builtin) {
      return {
        contents: {
          kind: "markdown",
          value: `**type** \`${builtin.name}\`\n\n${builtin.doc}`,
        },
        range,
      };
    }

    // 3. Keywords
    if (UR_KEYWORDS.includes(word)) {
      return {
        contents: {
          kind: "markdown",
          value: `**keyword** \`${word}\``,
        },
        range,
      };
    }

    return null;
  }
}

function kindLabel(kind: number): string {
  const map: Record<number, string> = {
    3: "function", 6: "variable", 5: "class", 10: "interface",
    8: "struct", 22: "enum", 14: "type", 12: "function",
    13: "constant", 7: "property",
  };
  return map[kind] ?? "symbol";
}
