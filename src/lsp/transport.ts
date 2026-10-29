// ─────────────────────────────────────────────────────────────────────────────
// UR LSP — Layer A: stdio / Content-Length JSON-RPC Transport
// ─────────────────────────────────────────────────────────────────────────────
//
// Per the V2-M7 Design Gate: a thin adapter over the EXISTING, already-tested
// LspServer (src/lsp/lsp-server.ts) — no semantic logic here, no change to
// any existing src/lsp/ file. This module owns process.stdin/process.stdout
// exclusively: stdout carries ONLY Content-Length-framed JSON-RPC messages;
// all logging goes to stderr, never stdout, per the LSP spec's own convention
// and this Gate's own explicit requirement (no protocol contamination).
//
// Hand-written framing/dispatch, no new dependency in the main project — per
// the Design Gate's own stated reasoning (this project's own established
// minimal-dependency convention, e.g. src/ide/server.ts's own precedent).

import { LspServer, type LspServerOptions } from "./lsp-server.js";
import type {
  TextDocumentItem,
  TextDocumentContentChangeEvent,
  Position,
  CompletionContext,
} from "./protocol.js";

// ── JSON-RPC message shapes (a minimal subset, LSP 3.17 framing) ───────────

type JsonRpcId = number | string | null;

type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown };
type JsonRpcNotification = { jsonrpc: "2.0"; method: string; params?: unknown };
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } };

// Standard JSON-RPC error codes (per the JSON-RPC 2.0 spec, reused by LSP).
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INTERNAL = -32603;
const ERR_SERVER_NOT_INITIALIZED = -32002;

/** Reads Content-Length-framed messages from a byte stream, one message at a
 *  time, tolerant of messages arriving split across multiple stdin chunks
 *  (the real, common case for a child process's own stdin pipe) - buffers
 *  incrementally rather than assuming one chunk equals one message. */
export class MessageFramer {
  private buffer: Buffer = Buffer.alloc(0);

  /** Feeds newly-received bytes in; returns every COMPLETE message now
   *  available (there may be zero, one, or several, if multiple messages
   *  arrived in one chunk) - each as its own raw UTF-8 string, not yet
   *  JSON-parsed (parsing failures are the caller's own concern, so a
   *  malformed payload doesn't stop framing of subsequent, valid ones). */
  push(chunk: Buffer): string[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: string[] = [];
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break; // header not fully received yet
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Malformed header (no Content-Length at all) - drop this one
        // "frame" up to and including the separator, so a genuinely
        // corrupt stream doesn't wedge the framer permanently, and
        // surface it as a caller-visible error.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        messages.push("__FRAMING_ERROR__: no Content-Length header found");
        continue;
      }
      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break; // body not fully received yet
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf-8");
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      messages.push(body);
    }
    return messages;
  }
}

/** Frames a JSON-RPC payload for writing to stdout, per the LSP wire format. */
export function frameMessage(payload: unknown): Buffer {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf-8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

export type Writer = (buf: Buffer) => void;
export type Logger = (msg: string) => void;

/** The transport adapter itself - owns lifecycle state (initialized/shutdown)
 *  and dispatches each JSON-RPC method to the corresponding, ALREADY-
 *  EXISTING LspServer method. No semantic logic lives here. */
export class LspTransport {
  private server: LspServer | null = null;
  private initialized = false;
  private shutdownRequested = false;
  private readonly write: Writer;
  private readonly log: Logger;

  constructor(write: Writer, log: Logger) {
    this.write = write;
    this.log = log;
  }

  get isShutdown(): boolean {
    return this.shutdownRequested;
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.write(frameMessage({ jsonrpc: "2.0", id, result } satisfies JsonRpcResponse));
  }

  private respondError(id: JsonRpcId, code: number, message: string): void {
    this.write(frameMessage({ jsonrpc: "2.0", id, error: { code, message } } satisfies JsonRpcResponse));
  }

  private notify(method: string, params: unknown): void {
    this.write(frameMessage({ jsonrpc: "2.0", method, params } satisfies JsonRpcNotification));
  }

  private publishDiagnosticsIfAny(uri: string, set: { uri: string; diagnostics: unknown[]; version: number } | null): void {
    if (set) this.notify("textDocument/publishDiagnostics", { uri: set.uri, diagnostics: set.diagnostics, version: set.version });
  }

  /** Handles one raw message body (already extracted by MessageFramer).
   *  A parse/dispatch failure for THIS message produces a controlled
   *  JSON-RPC error response (or is silently logged, for a notification -
   *  no response is ever sent for a notification, per the spec) - it never
   *  throws out of this function, so one bad message cannot take down the
   *  transport loop itself. */
  async handleMessage(raw: string): Promise<void> {
    if (raw.startsWith("__FRAMING_ERROR__")) {
      this.log(`[transport] ${raw}`);
      // No id available for a framing-level error - nothing to respond to.
      return;
    }

    let msg: JsonRpcRequest | JsonRpcNotification;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      this.log(`[transport] parse error: ${(e as Error).message}`);
      // No id recoverable from unparseable JSON - per the JSON-RPC spec,
      // a parse-error response uses id: null.
      this.respondError(null, ERR_PARSE, `Parse error: ${(e as Error).message}`);
      return;
    }

    if (typeof msg !== "object" || msg === null || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      const id = "id" in msg ? (msg as JsonRpcRequest).id : null;
      this.respondError(id ?? null, ERR_INVALID_REQUEST, "Invalid Request: missing jsonrpc/method");
      return;
    }

    const isRequest = "id" in msg && msg.id !== undefined;
    const id = isRequest ? (msg as JsonRpcRequest).id : null;

    try {
      await this.dispatch(msg.method, msg.params, id, isRequest);
    } catch (e) {
      this.log(`[transport] handler threw for method '${msg.method}': ${(e as Error).stack ?? (e as Error).message}`);
      if (isRequest) this.respondError(id, ERR_INTERNAL, `Internal error: ${(e as Error).message}`);
      // A notification's own handler failure is logged, never responded to
      // (notifications never get a response, per the spec) - and, per the
      // Design Gate's own requirement, does not crash the transport loop.
    }
  }

  private async dispatch(method: string, params: unknown, id: JsonRpcId, isRequest: boolean): Promise<void> {
    if (method === "initialize") {
      const p = params as { rootUri?: string; rootPath?: string } | undefined;
      const workspaceRoot = p?.rootUri?.replace(/^file:\/\//, "") ?? p?.rootPath ?? process.cwd();
      const options: LspServerOptions = { workspaceRoot };
      this.server = new LspServer(options);
      this.initialized = true;
      this.respond(id, { capabilities: this.server.capabilities() });
      return;
    }
    if (method === "initialized") return; // acknowledgment notification, no-op
    if (method === "shutdown") {
      this.shutdownRequested = true;
      this.respond(id, null);
      return;
    }
    if (method === "exit") {
      // Handled by the caller (the process entry point), which owns
      // process.exit() - this transport module has no direct process
      // dependency of its own, keeping it independently testable.
      // Always allowed, regardless of shutdown state - the guard below
      // is placed AFTER this check specifically so "exit" is never
      // caught by it.
      return;
    }

    // Micro-Fix A-1 (Gate authorized, narrow scope): once shutdown has
    // been requested, every method other than "exit" (already returned
    // above) must be rejected with a controlled error - per the LSP
    // spec's own lifecycle contract. This guard is checked BEFORE the
    // initialized/server-null check below, so it applies uniformly
    // regardless of whether a server instance still exists.
    if (this.shutdownRequested) {
      if (isRequest) this.respondError(id, ERR_INVALID_REQUEST, "Invalid Request: server has received shutdown, no further requests are accepted (only 'exit' is)");
      else this.log(`[transport] notification '${method}' ignored - server has been shut down`);
      return;
    }

    if (!this.initialized || !this.server) {
      if (isRequest) this.respondError(id, ERR_SERVER_NOT_INITIALIZED, "Server not initialized");
      return;
    }
    const server = this.server;

    switch (method) {
      case "textDocument/didOpen": {
        const p = params as { textDocument: TextDocumentItem };
        const diags = await server.onOpen(p.textDocument);
        this.publishDiagnosticsIfAny(p.textDocument.uri, diags);
        return;
      }
      case "textDocument/didChange": {
        const p = params as { textDocument: { uri: string; version: number }; contentChanges: TextDocumentContentChangeEvent[] };
        const diags = await server.onChange(p.textDocument.uri, p.textDocument.version, p.contentChanges);
        this.publishDiagnosticsIfAny(p.textDocument.uri, diags);
        return;
      }
      case "textDocument/didClose": {
        const p = params as { textDocument: { uri: string } };
        server.onClose(p.textDocument.uri);
        return;
      }
      case "textDocument/hover": {
        const p = params as { textDocument: { uri: string }; position: Position };
        this.respond(id, server.onHover(p.textDocument.uri, p.position));
        return;
      }
      case "textDocument/definition": {
        const p = params as { textDocument: { uri: string }; position: Position };
        this.respond(id, server.onDefinition(p.textDocument.uri, p.position));
        return;
      }
      case "textDocument/references": {
        const p = params as { textDocument: { uri: string }; position: Position; context?: { includeDeclaration: boolean } };
        this.respond(id, server.onReferences(p.textDocument.uri, p.position, p.context?.includeDeclaration ?? false));
        return;
      }
      case "textDocument/completion": {
        const p = params as { textDocument: { uri: string }; position: Position; context?: CompletionContext };
        this.respond(id, server.onCompletion(p.textDocument.uri, p.position, p.context));
        return;
      }
      case "textDocument/signatureHelp": {
        const p = params as { textDocument: { uri: string }; position: Position };
        this.respond(id, server.onSignatureHelp(p.textDocument.uri, p.position));
        return;
      }
      case "textDocument/semanticTokens/full": {
        const p = params as { textDocument: { uri: string } };
        this.respond(id, server.onSemanticTokensFull(p.textDocument.uri));
        return;
      }
      case "workspace/symbol": {
        const p = params as { query: string };
        this.respond(id, server.onWorkspaceSymbol(p.query));
        return;
      }
      default:
        if (isRequest) this.respondError(id, ERR_METHOD_NOT_FOUND, `Method not found: ${method}`);
        else this.log(`[transport] unhandled notification: ${method}`);
        return;
    }
  }
}

/** Wires the transport to real process.stdin/process.stdout - the ONLY
 *  place this module touches Node's own process object directly, kept
 *  separate from LspTransport itself so the transport's own dispatch
 *  logic remains testable without a real process. */
export function runOnStdio(): void {
  const log: Logger = (msg) => { process.stderr.write(msg + "\n"); };
  const write: Writer = (buf) => { process.stdout.write(buf); };
  const transport = new LspTransport(write, log);
  const framer = new MessageFramer();

  process.stdin.on("data", (chunk: Buffer) => {
    const messages = framer.push(chunk);
    for (const raw of messages) {
      transport.handleMessage(raw).catch((e) => log(`[transport] unexpected top-level error: ${(e as Error).message}`));
    }
  });

  process.stdin.on("end", () => {
    process.exit(transport.isShutdown ? 0 : 1);
  });
}
