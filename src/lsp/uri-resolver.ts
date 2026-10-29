// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — LSP: UriResolver
//
// Converts between LSP DocumentUri (file:// URLs) and filesystem paths.
// Handles Windows-style drive letters (file:///C:/...) and POSIX paths.
// ─────────────────────────────────────────────────────────────────────────────

import type { DocumentUri } from "./protocol.js";

export class UriResolver {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    // Normalize: strip trailing slash
    this.workspaceRoot = workspaceRoot.replace(/[/\\]+$/, "");
  }

  // ── URI → Path ──────────────────────────────────────────────────────────────

  uriToPath(uri: DocumentUri): string {
    if (!uri.startsWith("file://")) {
      throw new Error(`Non-file URI not supported: ${uri}`);
    }

    let path = decodeURIComponent(uri.slice("file://".length));

    // Windows: file:///C:/... → C:/...
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1);
    }

    return path;
  }

  // ── Path → URI ──────────────────────────────────────────────────────────────

  pathToUri(fsPath: string): DocumentUri {
    // Normalize separators on Windows
    const normalized = fsPath.replace(/\\/g, "/");

    // POSIX absolute path
    if (normalized.startsWith("/")) {
      return "file://" + encodePathComponents(normalized);
    }

    // Windows absolute path (C:/...)
    if (/^[A-Za-z]:\//.test(normalized)) {
      return "file:///" + encodePathComponents(normalized);
    }

    // Relative: resolve against workspace root
    const abs = this.workspaceRoot + "/" + normalized;
    return this.pathToUri(abs);
  }

  // ── Workspace helpers ───────────────────────────────────────────────────────

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  workspaceRootUri(): DocumentUri {
    return this.pathToUri(this.workspaceRoot);
  }

  /** True if the URI is under the current workspace root. */
  isWorkspaceFile(uri: DocumentUri): boolean {
    try {
      const path = this.uriToPath(uri);
      const root = this.workspaceRoot.replace(/\\/g, "/");
      return path.replace(/\\/g, "/").startsWith(root);
    } catch {
      return false;
    }
  }

  /** Return the path relative to workspace root (or undefined if outside). */
  relativePathInWorkspace(uri: DocumentUri): string | undefined {
    try {
      const path = this.uriToPath(uri).replace(/\\/g, "/");
      const root = this.workspaceRoot.replace(/\\/g, "/") + "/";
      if (path.startsWith(root)) {
        return path.slice(root.length);
      }
    } catch {
      // ignore
    }
    return undefined;
  }

  /** Guess module name from URI (filename without extension). */
  moduleNameFromUri(uri: DocumentUri): string {
    const path = this.uriToPath(uri);
    const base = path.split(/[/\\]/).pop() ?? path;
    return base.replace(/\.ur$/, "");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function encodePathComponents(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%2F/g, "/"))
    .join("/");
}
