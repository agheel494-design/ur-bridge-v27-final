// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: DiagnosticEngine
//
// Bridges compiler-emitted CachedDiagnostics (from IncrementalPipeline)
// to LSP Diagnostic objects and manages per-document diagnostic state.
// ─────────────────────────────────────────────────────────────────────────────

import type { CachedDiagnostic } from "../compiler/incremental/index.js";
import type {
  Diagnostic,
  DiagnosticSeverityValue,
  DocumentUri,
  Range,
} from "./protocol.js";
import { DiagnosticSeverity } from "./protocol.js";
import { PositionMapper } from "./position-mapper.js";

export interface DiagnosticSet {
  uri: DocumentUri;
  diagnostics: Diagnostic[];
  version: number;
}

export class DiagnosticEngine {
  private readonly store = new Map<DocumentUri, DiagnosticSet>();

  // ── Conversion ──────────────────────────────────────────────────────────────

  /**
   * Convert a CachedDiagnostic (compiler-level) to an LSP Diagnostic.
   * `mapper` is used to produce the Range from line/col if available.
   */
  convertDiagnostic(
    cd: CachedDiagnostic,
    mapper: PositionMapper
  ): Diagnostic {
    const range = this.makeRange(cd, mapper);
    return {
      range,
      severity: this.convertSeverity(cd.severity),
      code: cd.code,
      source: "ur",
      message: cd.message,
    };
  }

  private convertSeverity(
    sev: CachedDiagnostic["severity"]
  ): DiagnosticSeverityValue {
    switch (sev) {
      case "error":   return DiagnosticSeverity.Error;
      case "warning": return DiagnosticSeverity.Warning;
      case "info":    return DiagnosticSeverity.Information;
      default:        return DiagnosticSeverity.Hint;
    }
  }

  private makeRange(cd: CachedDiagnostic, mapper: PositionMapper): Range {
    if (cd.line === undefined || cd.col === undefined) {
      return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    }

    const line = Math.max(0, cd.line - 1); // compiler is 1-based
    const character = Math.max(0, (cd.col ?? 1) - 1);

    // Extend range to end of word
    const lineText = mapper.getLineText(line);
    let endChar = character;
    while (endChar < lineText.length && /[\p{L}\p{N}_]/u.test(lineText[endChar]!)) {
      endChar++;
    }
    if (endChar === character) endChar = character + 1;

    return {
      start: { line, character },
      end: { line, character: endChar },
    };
  }

  // ── Store management ────────────────────────────────────────────────────────

  publish(uri: DocumentUri, diagnostics: Diagnostic[], version: number): DiagnosticSet {
    const set: DiagnosticSet = { uri, diagnostics, version };
    this.store.set(uri, set);
    return set;
  }

  clear(uri: DocumentUri): void {
    this.store.delete(uri);
  }

  get(uri: DocumentUri): DiagnosticSet | undefined {
    return this.store.get(uri);
  }

  all(): DiagnosticSet[] {
    return Array.from(this.store.values());
  }

  /** Clear diagnostics for URIs no longer in the workspace. */
  pruneStale(activeUris: Set<DocumentUri>): DocumentUri[] {
    const removed: DocumentUri[] = [];
    for (const uri of this.store.keys()) {
      if (!activeUris.has(uri)) {
        this.store.delete(uri);
        removed.push(uri);
      }
    }
    return removed;
  }

  /** Merge compiler FileDiagnostics array into LSP format. */
  mergeFromCompiler(
    fileDiagnostics: Array<{ path: string; diagnostics: CachedDiagnostic[] }>,
    getMapper: (path: string) => PositionMapper | undefined,
    getUri: (path: string) => string,
    version: number
  ): DiagnosticSet[] {
    const sets: DiagnosticSet[] = [];

    for (const { path, diagnostics } of fileDiagnostics) {
      const uri = getUri(path);
      const mapper = getMapper(path) ?? new PositionMapper("");
      const lspDiags = diagnostics.map((d) => this.convertDiagnostic(d, mapper));
      sets.push(this.publish(uri, lspDiags, version));
    }

    return sets;
  }

  /** Count errors across all documents. */
  totalErrors(): number {
    let count = 0;
    for (const set of this.store.values()) {
      count += set.diagnostics.filter(
        (d) => d.severity === DiagnosticSeverity.Error
      ).length;
    }
    return count;
  }
}
