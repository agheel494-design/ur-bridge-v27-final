// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: SemanticHighlightingProvider + WorkspaceSymbolsProvider
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DocumentUri,
  SemanticTokens,
  SymbolInformation,
} from "./protocol.js";
import { SemanticTokenTypes, SemanticTokenModifiers, SymbolKind } from "./protocol.js";
import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable, UrSymbol } from "./symbol-table.js";
import { UR_BUILTIN_TYPES, UR_KEYWORDS } from "./symbol-table.js";
import { lex, type TokenKind } from "../compiler/frontend/lexer.js";

const KEYWORD_TOKEN_KINDS = new Set<TokenKind>([
  "FUNCTION_KW", "LET_KW", "TYPE_KW", "IMPORT_KW", "RETURN_KW", "END_KW",
  "IF_KW", "ELSE_KW", "WHILE_KW", "FOR_KW", "BREAK_KW", "CONTINUE_KW",
  "TRUE_LIT", "FALSE_LIT", "NULL_LIT",
]);

function isKeywordToken(kind: TokenKind): boolean {
  return KEYWORD_TOKEN_KINDS.has(kind);
}

// ── Semantic Tokens Legend (exported for ServerCapabilities) ──────────────────

export const TOKEN_TYPES = [...SemanticTokenTypes];
export const TOKEN_MODIFIERS = [...SemanticTokenModifiers];

const TYPE_INDEX = new Map<string, number>(
  TOKEN_TYPES.map((t, i) => [t, i])
);
const MOD_INDEX = new Map<string, number>(
  TOKEN_MODIFIERS.map((m, i) => [m, i])
);

function typeIdx(name: string): number { return TYPE_INDEX.get(name) ?? 0; }
function modBit(name: string): number {
  const i = MOD_INDEX.get(name);
  return i !== undefined ? (1 << i) : 0;
}

// ── Semantic Token Entry ──────────────────────────────────────────────────────

interface TokenEntry {
  line: number;
  character: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

// ── SemanticHighlightingProvider ──────────────────────────────────────────────

export class SemanticHighlightingProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideSemanticTokens(uri: DocumentUri): SemanticTokens {
    const doc = this.docs.get(uri);
    if (!doc) return { data: [] };

    const entries: TokenEntry[] = [];
    const text = doc.mapper.getText();

    // Real Lexer, real canonical tokens — no regex, no stale keyword list.
    //
    // CONFIRMED (Regex Audit — Category B): this method previously
    // re-implemented a mini-tokenizer via regex (`/[\p{L}_][\p{L}\p{N}_]*/gu`)
    // and classified words against `UR_KEYWORDS` — a hardcoded, RC2-era
    // list (`fn`, `mut`, `struct`, `trait`, `impl`, ...) that did not even
    // contain UR 1.0's real keywords (`function`/`دالة`, `end`/`نهاية`,
    // ...) and had zero awareness of the 10 supported languages. Semantic
    // highlighting was therefore unable to correctly classify ANY real UR
    // 1.0 keyword as a keyword, in any language. Fixed by running the
    // real Lexer (which already canonicalizes all 10 languages via the
    // Language Mapper) and classifying tokens by their real TokenKind.
    const { tokens } = lex(text);

    const docSymbols = new Map(
      this.symbols.symbolsInDocument(uri).map((s) => [s.name, s])
    );

    for (const tok of tokens) {
      if (tok.kind === "EOF" || tok.kind === "NEWLINE" || tok.kind === "ERROR") continue;

      let tokenType = -1;
      let tokenModifiers = 0;

      if (isKeywordToken(tok.kind)) {
        tokenType = typeIdx("keyword");
      } else if (tok.kind === "STRING_LIT") {
        tokenType = typeIdx("string");
      } else if (tok.kind === "INT_LIT" || tok.kind === "FLOAT_LIT") {
        tokenType = typeIdx("number");
      } else if (tok.kind === "IDENTIFIER") {
        const typeSet = new Set(UR_BUILTIN_TYPES.map((t) => t.name));
        if (typeSet.has(tok.text)) {
          tokenType = typeIdx("type");
          tokenModifiers = modBit("defaultLibrary");
        } else {
          const sym = docSymbols.get(tok.text) ?? this.symbols.getDefinition(tok.text, uri);
          if (sym) {
            tokenType = symKindToTokenType(sym);
            tokenModifiers = symModifiers(sym);
          }
        }
      }

      if (tokenType >= 0) {
        entries.push({
          line: tok.span.startLine - 1,     // Lexer spans are 1-based; LSP positions are 0-based
          character: tok.span.startCol - 1,
          length: tok.text.length,
          tokenType,
          tokenModifiers,
        });
      }
    }

    // Sort by line then character
    entries.sort((a, b) => a.line !== b.line ? a.line - b.line : a.character - b.character);

    // Encode as delta-encoded array
    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;

    for (const e of entries) {
      const deltaLine = e.line - prevLine;
      const deltaChar = deltaLine === 0 ? e.character - prevChar : e.character;
      data.push(deltaLine, deltaChar, e.length, e.tokenType, e.tokenModifiers);
      prevLine = e.line;
      prevChar = e.character;
    }

    return { data };
  }
}

function symKindToTokenType(sym: UrSymbol): number {
  switch (sym.kind) {
    case SymbolKind.Function:  return typeIdx("function");
    case SymbolKind.Method:    return typeIdx("method");
    case SymbolKind.Variable:  return typeIdx("variable");
    case SymbolKind.Constant:  return typeIdx("variable");
    case SymbolKind.Class:     return typeIdx("class");
    case SymbolKind.Struct:    return typeIdx("struct");
    case SymbolKind.Enum:      return typeIdx("enum");
    case SymbolKind.EnumMember:return typeIdx("enumMember");
    case SymbolKind.Interface: return typeIdx("interface");
    case SymbolKind.Module:    return typeIdx("namespace");
    case SymbolKind.TypeParameter: return typeIdx("typeParameter");
    case SymbolKind.Property:  return typeIdx("property");
    default:                   return typeIdx("variable");
  }
}

function symModifiers(sym: UrSymbol): number {
  let bits = 0;
  if (!sym.definedIn.startsWith("builtin://")) {
    bits |= modBit("declaration");
  } else {
    bits |= modBit("defaultLibrary");
  }
  return bits;
}

// ── WorkspaceSymbolsProvider ──────────────────────────────────────────────────

export class WorkspaceSymbolsProvider {
  constructor(private readonly symbols: SymbolTable) {}

  provideWorkspaceSymbols(query: string): SymbolInformation[] {
    const syms = this.symbols.searchWorkspace(query, 200);
    return syms
      .filter((s) => s.definedIn !== "builtin://ur")
      .map((sym) => ({
        name: sym.name,
        kind: sym.kind,
        location: {
          uri: sym.definedIn,
          range: sym.definitionRange,
        },
        containerName: sym.containerName,
        deprecated: false,
      }));
  }
}
