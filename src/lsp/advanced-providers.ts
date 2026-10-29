// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: SignatureHelpProvider + RenameProvider
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DocumentUri,
  Location,
  Position,
  PrepareRenameResult,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from "./protocol.js";
import type { TextDocumentManager } from "./text-document-manager.js";
import type { SymbolTable } from "./symbol-table.js";
import { SymbolKind } from "./protocol.js";

/**
 * Checks whether a character can be part of an identifier — no regex,
 * per the UR Level 1 architecture rule (no regex anywhere in src/lsp/).
 * Uses explicit Unicode code-point range checks, the same style already
 * used by the real Lexer's isUnicodeLetter (src/compiler/frontend/lexer.ts)
 * — this is a deliberately lighter-weight subset sufficient for this
 * cursor-position heuristic; the authoritative identifier grammar lives
 * exclusively in the Lexer.
 */
function isIdentChar(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp === 0x5F) return true; // underscore
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp >= 0x41 && cp <= 0x5A) return true; // A-Z
  if (cp >= 0x61 && cp <= 0x7A) return true; // a-z
  if (cp >= 0x0621 && cp <= 0x064A) return true; // Arabic letters
  if (cp >= 0x4E00 && cp <= 0x9FFF) return true; // CJK
  if (cp >= 0x0400 && cp <= 0x04FF) return true; // Cyrillic
  if (cp >= 0x00C0 && cp <= 0x024F) return true; // Latin Extended
  if (cp >= 0x0370 && cp <= 0x03FF) return true; // Greek
  if (cp >= 0x0900 && cp <= 0x097F) return true; // Devanagari
  return false;
}

// ── Signature Help ────────────────────────────────────────────────────────────

export class SignatureHelpProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  provideSignatureHelp(uri: DocumentUri, position: Position): SignatureHelp | null {
    const doc = this.docs.get(uri);
    if (!doc) return null;

    const lineText = doc.mapper.getLineText(position.line);
    const before = lineText.slice(0, position.character);

    // Find the innermost open paren that starts a call: `word(`, scanning
    // manually (no regex — see UR Level 1 architecture rule: no regex may
    // be used anywhere in src/lsp/).
    let depth = 0;
    let openParenIdx = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ")") depth++;
      else if (ch === "(") {
        if (depth === 0) { openParenIdx = i; break; }
        depth--;
      }
    }
    if (openParenIdx === -1) return null;

    const argsText = before.slice(openParenIdx + 1);

    // Scan backward from the open paren (skipping whitespace) to collect
    // the identifier that precedes it.
    let end = openParenIdx;
    while (end > 0 && (before[end - 1] === " " || before[end - 1] === "\t")) end--;
    let start = end;
    while (start > 0 && isIdentChar(before[start - 1]!)) start--;
    const funcName = before.slice(start, end);
    if (!funcName) return null;

    const sym = this.symbols.getDefinition(funcName, uri);
    if (!sym || sym.kind !== SymbolKind.Function) return null;

    // Count how many commas precede cursor → active param
    const activeParameter = (argsText?.split(",").length ?? 1) - 1;

    const params =
      sym.parameters?.map((p) => ({
        label: `${p.name}: ${p.type}`,
        documentation: undefined,
      })) ?? [];

    const label = sym.signature ?? `${sym.name}(${params.map((p) => p.label).join(", ")})`;

    return {
      signatures: [
        {
          label,
          documentation: sym.documentation,
          parameters: params,
          activeParameter,
        },
      ],
      activeSignature: 0,
      activeParameter,
    };
  }
}

// ── Rename ────────────────────────────────────────────────────────────────────

export class RenameProvider {
  constructor(
    private readonly docs: TextDocumentManager,
    private readonly symbols: SymbolTable
  ) {}

  prepareRename(uri: DocumentUri, position: Position): PrepareRenameResult | null {
    const doc = this.docs.get(uri);
    if (!doc) return null;

    const wordResult = doc.mapper.wordAtPosition(position);
    if (!wordResult) return null;

    const sym = this.symbols.getDefinition(wordResult.word, uri);
    if (!sym) return null;

    // Disallow renaming builtins
    if (sym.definedIn === "builtin://ur") return null;

    return { range: wordResult.range, placeholder: wordResult.word };
  }

  provideRenameEdits(
    uri: DocumentUri,
    position: Position,
    newName: string
  ): WorkspaceEdit | null {
    const doc = this.docs.get(uri);
    if (!doc) return null;

    const wordResult = doc.mapper.wordAtPosition(position);
    if (!wordResult) return null;

    const sym = this.symbols.getDefinition(wordResult.word, uri);
    if (!sym) return null;
    if (sym.definedIn === "builtin://ur") return null;

    const changes: { [u: string]: TextEdit[] } = {};

    // Add edit for the declaration itself
    addEdit(changes, sym.definedIn, sym.definitionRange, newName);

    // Add edits for all references
    const refs: Location[] = this.symbols.getReferences(sym.name, sym.definedIn);
    for (const ref of refs) {
      addEdit(changes, ref.uri, ref.range, newName);
    }

    return { changes };
  }
}

function addEdit(
  changes: { [u: string]: TextEdit[] },
  uri: string,
  range: import("./protocol.js").Range,
  newText: string
): void {
  if (!changes[uri]) changes[uri] = [];
  changes[uri]!.push({ range, newText });
}
