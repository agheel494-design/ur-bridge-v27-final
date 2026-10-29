// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: CompletionEngine
//
// Context-aware completion for UR source files.
// Priority ordering: local vars > parameters > module symbols > builtins > keywords
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CompletionContext,
  CompletionItem,
  CompletionList,
  DocumentUri,
  Position,
} from "./protocol.js";
import { CompletionItemKind, type CompletionItemKindValue } from "./protocol.js";
import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable } from "./symbol-table.js";
import { UR_BUILTIN_TYPES, UR_KEYWORDS } from "./symbol-table.js";
import { SymbolKind } from "./protocol.js";

// ── Context detection ─────────────────────────────────────────────────────────

type CompletionContext2 =
  | "type-position"
  | "import-path"
  | "member-access"
  | "general";

function detectContext(
  lineText: string,
  character: number
): CompletionContext2 {
  const before = lineText.slice(0, character);

  if (/\bimport\s+["']?[^"']*$/.test(before) ||
      /\bfrom\s+["']?[^"']*$/.test(before)) {
    return "import-path";
  }

  if (/\.\s*\w*$/.test(before)) {
    return "member-access";
  }

  if (/:\s*\w*$/.test(before) ||
      /->\s*\w*$/.test(before) ||
      /\bfn\s+\w+\s*\([^)]*\)\s*-?\s*\w*$/.test(before)) {
    return "type-position";
  }

  return "general";
}

// ── Completion Engine ─────────────────────────────────────────────────────────

export class CompletionEngine {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideCompletions(
    uri: DocumentUri,
    position: Position,
    _context?: CompletionContext
  ): CompletionList {
    const doc = this.docs.get(uri);
    if (!doc) return { isIncomplete: false, items: [] };

    const lineText = doc.mapper.getLineText(position.line);
    const ctx = detectContext(lineText, position.character);

    // Prefix: text immediately before the cursor in the current word
    const before = lineText.slice(0, position.character);
    const prefixMatch = before.match(/[\p{L}\p{N}_]*$/u);
    const prefix = prefixMatch ? prefixMatch[0]!.toLowerCase() : "";

    const items: CompletionItem[] = [];

    if (ctx === "import-path") {
      // Module names from workspace
      return { isIncomplete: false, items: this.moduleCompletions(prefix) };
    }

    if (ctx === "type-position") {
      // Types first
      items.push(...this.typeCompletions(prefix));
      items.push(...this.keywordCompletions(prefix, ["fn", "type", "struct", "enum", "trait"]));
      return { isIncomplete: false, items: this.sortAndDedupe(items) };
    }

    // General: symbols, builtins, keywords
    items.push(...this.symbolCompletions(uri, prefix));
    items.push(...this.typeCompletions(prefix));
    items.push(...this.keywordCompletions(prefix));

    return { isIncomplete: false, items: this.sortAndDedupe(items) };
  }

  // ── Symbol completions ────────────────────────────────────────────────────

  private symbolCompletions(uri: DocumentUri, prefix: string): CompletionItem[] {
    const syms = this.symbols.visibleSymbols(uri);
    const items: CompletionItem[] = [];

    for (const sym of syms) {
      if (prefix && !sym.name.toLowerCase().startsWith(prefix)) continue;

      const isLocal = sym.definedIn === uri;
      items.push({
        label: sym.name,
        kind: symbolKindToCompletionKind(sym.kind),
        detail: sym.typeAnnotation
          ? `${sym.name}: ${sym.typeAnnotation}`
          : undefined,
        documentation: sym.documentation,
        sortText: isLocal ? `0_${sym.name}` : `1_${sym.name}`,
        insertText: buildInsertText(sym),
      });
    }

    return items;
  }

  // ── Type completions ─────────────────────────────────────────────────────

  private typeCompletions(prefix: string): CompletionItem[] {
    return UR_BUILTIN_TYPES
      .filter((t) => !prefix || t.name.toLowerCase().startsWith(prefix))
      .map((t) => ({
        label: t.name,
        kind: CompletionItemKind.Class,
        detail: `builtin type ${t.name}`,
        documentation: t.doc,
        sortText: `2_${t.name}`,
      }));
  }

  // ── Keyword completions ───────────────────────────────────────────────────

  private keywordCompletions(
    prefix: string,
    subset?: string[]
  ): CompletionItem[] {
    const keywords = subset ?? UR_KEYWORDS;
    return keywords
      .filter((kw) => !prefix || kw.startsWith(prefix))
      .map((kw) => ({
        label: kw,
        kind: CompletionItemKind.Keyword,
        sortText: `3_${kw}`,
      }));
  }

  // ── Module completions ────────────────────────────────────────────────────

  private moduleCompletions(prefix: string): CompletionItem[] {
    const syms = this.symbols.searchWorkspace("", 500);
    const moduleNames = new Set<string>();

    for (const sym of syms) {
      if (sym.kind === SymbolKind.Module) moduleNames.add(sym.name);
    }

    return Array.from(moduleNames)
      .filter((name) => !prefix || name.toLowerCase().startsWith(prefix))
      .map((name) => ({
        label: name,
        kind: CompletionItemKind.Module,
        sortText: `0_${name}`,
      }));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private sortAndDedupe(items: CompletionItem[]): CompletionItem[] {
    const seen = new Set<string>();
    const out: CompletionItem[] = [];
    for (const item of items) {
      if (!seen.has(item.label)) {
        seen.add(item.label);
        out.push(item);
      }
    }
    return out.sort((a, b) =>
      (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label)
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function symbolKindToCompletionKind(kind: number): CompletionItemKindValue {
  const map: Record<number, number> = {
    [SymbolKind.Function]:  CompletionItemKind.Function,
    [SymbolKind.Variable]:  CompletionItemKind.Variable,
    [SymbolKind.Constant]:  CompletionItemKind.Constant,
    [SymbolKind.Class]:     CompletionItemKind.Class,
    [SymbolKind.Struct]:    CompletionItemKind.Struct,
    [SymbolKind.Enum]:      CompletionItemKind.Enum,
    [SymbolKind.EnumMember]:CompletionItemKind.EnumMember,
    [SymbolKind.Interface]: CompletionItemKind.Interface,
    [SymbolKind.Module]:    CompletionItemKind.Module,
    [SymbolKind.Property]:  CompletionItemKind.Property,
    [SymbolKind.Method]:    CompletionItemKind.Method,
    [SymbolKind.TypeParameter]: CompletionItemKind.TypeParameter,
  };
  return (map[kind] ?? CompletionItemKind.Text) as CompletionItemKindValue;
}

function buildInsertText(sym: import("./symbol-table.js").UrSymbol): string {
  if (sym.parameters && sym.parameters.length > 0) {
    // Function: insert with parens
    return `${sym.name}($0)`;
  }
  return sym.name;
}
