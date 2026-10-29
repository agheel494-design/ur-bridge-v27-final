// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: TextDocumentManager
//
// Maintains in-memory state of all open text documents.
// Applies incremental text change events (LSP textDocument/didChange).
// ─────────────────────────────────────────────────────────────────────────────

import { PositionMapper } from "./position-mapper.js";
import type {
  DocumentUri,
  TextDocumentItem,
  TextDocumentContentChangeEvent,
} from "./protocol.js";

export interface ManagedDocument {
  uri: DocumentUri;
  languageId: string;
  version: number;
  text: string;
  mapper: PositionMapper;
  /** Timestamp of last modification (Date.now()). */
  lastModified: number;
}

export class TextDocumentManager {
  private readonly docs = new Map<DocumentUri, ManagedDocument>();

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  open(item: TextDocumentItem): ManagedDocument {
    const doc: ManagedDocument = {
      uri: item.uri,
      languageId: item.languageId,
      version: item.version,
      text: item.text,
      mapper: new PositionMapper(item.text),
      lastModified: Date.now(),
    };
    this.docs.set(item.uri, doc);
    return doc;
  }

  close(uri: DocumentUri): void {
    this.docs.delete(uri);
  }

  get(uri: DocumentUri): ManagedDocument | undefined {
    return this.docs.get(uri);
  }

  has(uri: DocumentUri): boolean {
    return this.docs.has(uri);
  }

  all(): ManagedDocument[] {
    return Array.from(this.docs.values());
  }

  // ── Apply changes ───────────────────────────────────────────────────────────

  applyChanges(
    uri: DocumentUri,
    version: number,
    changes: TextDocumentContentChangeEvent[]
  ): ManagedDocument {
    const existing = this.docs.get(uri);
    if (!existing) {
      throw new Error(`Document not open: ${uri}`);
    }

    let text = existing.text;

    for (const change of changes) {
      if (change.range === undefined) {
        // Full document replacement
        text = change.text;
      } else {
        // Incremental: apply range replacement
        const mapper = new PositionMapper(text);
        const startOffset = mapper.positionToOffset(change.range.start);
        const endOffset = mapper.positionToOffset(change.range.end);
        text = text.slice(0, startOffset) + change.text + text.slice(endOffset);
      }
    }

    const updated: ManagedDocument = {
      ...existing,
      version,
      text,
      mapper: new PositionMapper(text),
      lastModified: Date.now(),
    };

    this.docs.set(uri, updated);
    return updated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Update text without a version bump (e.g., external file save). */
  updateText(uri: DocumentUri, text: string): ManagedDocument | undefined {
    const existing = this.docs.get(uri);
    if (!existing) return undefined;
    const updated: ManagedDocument = {
      ...existing,
      text,
      mapper: new PositionMapper(text),
      lastModified: Date.now(),
    };
    this.docs.set(uri, updated);
    return updated;
  }

  size(): number {
    return this.docs.size;
  }
}
