// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: WorkspaceManager
//
// Maintains the set of UR source files in the workspace and their
// last-known content. Provides the list of "all files" for workspace-wide
// operations (Find References, Workspace Symbols, Rename).
// ─────────────────────────────────────────────────────────────────────────────

import { UriResolver } from "./uri-resolver.js";
import type { DocumentUri } from "./protocol.js";

export interface WorkspaceFile {
  uri: DocumentUri;
  fsPath: string;
  /** Content as last known to the workspace (may lag behind open-document edits). */
  content: string;
  /** Timestamp of last workspace-level update. */
  updatedAt: number;
}

export interface WorkspaceSettings {
  /** Maximum number of files to index. */
  maxFiles?: number;
  /** File glob patterns to ignore. */
  excludePatterns?: string[];
}

export class WorkspaceManager {
  private readonly files = new Map<DocumentUri, WorkspaceFile>();
  private readonly resolver: UriResolver;
  private readonly settings: Required<WorkspaceSettings>;

  constructor(resolver: UriResolver, settings: WorkspaceSettings = {}) {
    this.resolver = resolver;
    this.settings = {
      maxFiles: settings.maxFiles ?? 2000,
      excludePatterns: settings.excludePatterns ?? ["node_modules", ".git", "dist"],
    };
  }

  // ── File registration ───────────────────────────────────────────────────────

  addFile(uri: DocumentUri, content: string): void {
    if (this.files.size >= this.settings.maxFiles) return;
    if (this.shouldExclude(uri)) return;
    const fsPath = this.tryResolvePath(uri);
    this.files.set(uri, { uri, fsPath, content, updatedAt: Date.now() });
  }

  removeFile(uri: DocumentUri): void {
    this.files.delete(uri);
  }

  updateFile(uri: DocumentUri, content: string): void {
    const existing = this.files.get(uri);
    if (existing) {
      existing.content = content;
      existing.updatedAt = Date.now();
    } else {
      this.addFile(uri, content);
    }
  }

  getFile(uri: DocumentUri): WorkspaceFile | undefined {
    return this.files.get(uri);
  }

  hasFile(uri: DocumentUri): boolean {
    return this.files.has(uri);
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  allFiles(): WorkspaceFile[] {
    return Array.from(this.files.values());
  }

  allUris(): DocumentUri[] {
    return Array.from(this.files.keys());
  }

  fileCount(): number {
    return this.files.size;
  }

  /** Files modified after `since` timestamp (ms). */
  filesModifiedAfter(since: number): WorkspaceFile[] {
    return Array.from(this.files.values()).filter((f) => f.updatedAt > since);
  }

  /** Search files whose URI contains `query` (case-insensitive). */
  findFilesByName(query: string): WorkspaceFile[] {
    const q = query.toLowerCase();
    return Array.from(this.files.values()).filter((f) =>
      f.uri.toLowerCase().includes(q)
    );
  }

  /** URIs of UR source files (*.ur). */
  urSourceFiles(): DocumentUri[] {
    return Array.from(this.files.keys()).filter((uri) => uri.endsWith(".ur"));
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private shouldExclude(uri: string): boolean {
    return this.settings.excludePatterns.some((pattern) =>
      uri.includes(pattern)
    );
  }

  private tryResolvePath(uri: DocumentUri): string {
    try {
      return this.resolver.uriToPath(uri);
    } catch {
      return uri;
    }
  }

  getResolver(): UriResolver {
    return this.resolver;
  }
}
