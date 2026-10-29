// ─────────────────────────────────────────────────────────────────────────────
// UR — Shared Contracts: Symbols
// Level 2 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────
//
// A minimal, stable symbol reference shape shared by Backend (linking a
// call to a function definition), Runtime (stack traces referring to named
// functions), IDE (already has its own richer UrSymbol in src/lsp/symbol-table.ts
// — this is NOT a replacement, it's what IR/Backend hand to the LSP layer
// when asked), and AI (referring to "the function add in main.ur").
//
// This is deliberately much smaller than src/lsp/symbol-table.ts's UrSymbol —
// it carries only what a non-IDE consumer (Backend, Runtime) needs.
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceLocation } from "./locations.js";

export type SymbolKind = "function" | "variable" | "parameter" | "module";

export type SharedSymbolRef = {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly location: SourceLocation;
  /** The module/file this symbol belongs to, e.g. "main.ur" or a dotted import path. */
  readonly module: string;
};

export function makeSymbolRef(
  name: string,
  kind: SymbolKind,
  location: SourceLocation,
  module: string
): SharedSymbolRef {
  return { name, kind, location, module };
}

/** A qualified name suitable for use as a linker/codegen symbol name (e.g. C function name). */
export function qualifiedName(ref: SharedSymbolRef): string {
  let safeModule = "";
  for (const ch of ref.module) {
    const cp = ch.codePointAt(0)!;
    const isAsciiAlnumOrUnderscore =
      (cp >= 0x30 && cp <= 0x39) || (cp >= 0x41 && cp <= 0x5A) ||
      (cp >= 0x61 && cp <= 0x7A) || cp === 0x5F;
    safeModule += isAsciiAlnumOrUnderscore ? ch : "_";
  }
  return `ur_${safeModule}_${ref.name}`;
}
