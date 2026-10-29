// ─────────────────────────────────────────────────────────────────────────────
// UR IDE — Backend Server (P0 priority, "minimal IDE" scope)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit project-manager directive: the smallest possible IDE, not a
// feature platform. Exactly: open file, save file, new project, Run button,
// Build button, error window, syntax highlighting, terminal. No AI, no
// debugger, no git integration, no extensions.
//
// This is a local HTTP server (no new dependencies — Node's built-in http
// module only) serving a single-page frontend (public/index.html, Monaco
// editor via CDN) and a small REST API wrapping the EXISTING, already-
// tested compiler pipeline directly — no compiler logic duplicated.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { lex } from "../compiler/frontend/lexer.js";
import { parse } from "../compiler/frontend/parser.js";
import { analyze } from "../compiler/semantic/index.js";
import { typeCheck } from "../compiler/typesystem/checker.js";
import { lowerToIR } from "../compiler/codegen/lower-to-ir.js";
import { interpretModule } from "../interpreter/interpret.js";
import { formatDiagnostic, type FormattableDiagnostic } from "../shared/diagnostic-formatter.js";
import { lexErrorToFormattable } from "../compiler/diagnostics/adapter.js"; // B-1 Gate (D-3)
import type { IRModule } from "../shared/ir.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UR_IDE_PORT) || 4173;
const PROJECT_ROOT = process.cwd();

type Diagnostic = { message: string; line: number; column: number; endLine: number; endColumn: number; severity: string; code: string };

/**
 * FIXED — Windows Recovery Sprint, same fix as the CLI's own cmdRun/
 * cmdBuild: compiles up to the IR only — NO C Backend, NO gcc, at all.
 * Both /api/run and /api/build now execute via the interpreter
 * (src/interpreter/interpret.ts), matching Node.js itself (already
 * this server's own runtime) as the only prerequisite.
 */
function compileToIR(source: string, fileName: string):
  | { ok: true; ir: IRModule }
  | { ok: false; diagnostics: Diagnostic[] } {
  const toDiag = (d: FormattableDiagnostic): Diagnostic => {
    const span = "startLine" in d.span
      ? d.span
      : { startLine: d.span.start.line, startColumn: d.span.start.column, endLine: d.span.end.line, endColumn: d.span.end.column };
    return {
      message: d.message,
      line: span.startLine, column: span.startColumn,
      endLine: span.endLine, endColumn: span.endColumn,
      severity: d.severity ?? "error", code: d.code,
    };
  };

  const { tokens, errors: lexErrors } = lex(source);
  // B-1 Gate (D-3): was `toDiag(d as FormattableDiagnostic)` (TS2352), which read the
  // non-existent `startColumn`/`endColumn` of a LexError span — see lexErrorToFormattable.
  if (lexErrors.length > 0) return { ok: false, diagnostics: lexErrors.map(d => toDiag(lexErrorToFormattable(d))) };
  const { program, errors: parseErrors } = parse(tokens);
  if (parseErrors.length > 0) return { ok: false, diagnostics: parseErrors.map(d => toDiag(d as FormattableDiagnostic)) };

  const sem = analyze(program);
  const semErrors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (semErrors.length > 0) return { ok: false, diagnostics: semErrors.map(d => toDiag(d as FormattableDiagnostic)) };

  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length > 0) return { ok: false, diagnostics: tcErrors.map(d => toDiag(d as FormattableDiagnostic)) };

  const ir = lowerToIR(program, fileName, fileName.replace(/\.ur$/, ""));
  if (!ir.ok) {
    const asFormattable = ir.diagnostics.map(d => ({ ...d, span: d.location })) as FormattableDiagnostic[];
    return { ok: false, diagnostics: asFormattable.map(toDiag) };
  }

  return { ok: true, ir: ir.value };
}

function replaceBigInt(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? { __bigint__: (value as bigint).toString() } : value;
}

function safeResolve(relPath: string): string | null {
  const abs = resolve(PROJECT_ROOT, relPath);
  // Confine file operations to the project directory the IDE server was
  // started in — a minimal, real safety boundary for a local dev tool.
  if (!abs.startsWith(PROJECT_ROOT)) return null;
  return abs;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    if (pathname === "/api/open" && req.method === "GET") {
      const url = new URL(req.url!, `http://localhost:${PORT}`);
      const relPath = url.searchParams.get("path") ?? "";
      const abs = safeResolve(relPath);
      if (!abs || !existsSync(abs)) return sendJson(res, 404, { error: "file not found" });
      return sendJson(res, 200, { content: readFileSync(abs, "utf-8") });
    }

    if (pathname === "/api/save" && req.method === "POST") {
      const { path: relPath, content } = JSON.parse(await readBody(req));
      const abs = safeResolve(relPath);
      if (!abs) return sendJson(res, 400, { error: "invalid path" });
      writeFileSync(abs, content, "utf-8");
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === "/api/new" && req.method === "POST") {
      const { path: relPath } = JSON.parse(await readBody(req));
      const abs = safeResolve(relPath);
      if (!abs) return sendJson(res, 400, { error: "invalid path" });
      if (existsSync(abs)) return sendJson(res, 409, { error: "file already exists" });
      const starter = "function main(): int\n  print(\"hello from UR\")\n  return 0\nend\n";
      writeFileSync(abs, starter, "utf-8");
      return sendJson(res, 200, { content: starter });
    }

    if (pathname === "/api/run" && req.method === "POST") {
      const { path: relPath, content } = JSON.parse(await readBody(req));
      const fileName = relPath.split("/").pop() ?? "main.ur";
      const compiled = compileToIR(content, fileName);
      if (!compiled.ok) return sendJson(res, 200, { ok: false, diagnostics: compiled.diagnostics });
      const result = interpretModule(compiled.ir, "main");
      return sendJson(res, 200, { ok: true, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, signal: null });
    }

    if (pathname === "/api/build" && req.method === "POST") {
      const { path: relPath, content } = JSON.parse(await readBody(req));
      const abs = safeResolve(relPath);
      if (!abs) return sendJson(res, 400, { error: "invalid path" });
      const fileName = relPath.split("/").pop() ?? "main.ur";
      const compiled = compileToIR(content, fileName);
      if (!compiled.ok) return sendJson(res, 200, { ok: false, diagnostics: compiled.diagnostics });
      const outputPath = abs.replace(/\.ur$/, "") + ".js";
      const interpreterPath = join(__dirname, "..", "interpreter", "interpret.js");
      const bundle = `#!/usr/bin/env node
// Generated by the UR IDE's Build button — self-contained, no gcc/C-compiler needed to run this.
import { interpretModule } from ${JSON.stringify(pathToFileURL(interpreterPath).href)};
function revive(value) {
  if (value === null || typeof value !== "object") return value;
  if (Object.prototype.hasOwnProperty.call(value, "__bigint__")) return BigInt(value.__bigint__);
  if (Array.isArray(value)) return value.map(revive);
  const out = {};
  for (const k of Object.keys(value)) out[k] = revive(value[k]);
  return out;
}
const ir = revive(${JSON.stringify(compiled.ir, replaceBigInt)});
const result = interpretModule(ir, "main");
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
`;
      writeFileSync(outputPath, bundle, "utf-8");
      try { chmodSync(outputPath, 0o755); } catch { /* best-effort */ }
      return sendJson(res, 200, { ok: true, outputPath });
    }

    if (pathname === "/api/terminal" && req.method === "POST") {
      // A minimal, non-interactive terminal: run one command, return its
      // full output — matching "minimal IDE" scope, not a full PTY.
      const { command } = JSON.parse(await readBody(req));
      const result = spawnSync(command, { cwd: PROJECT_ROOT, shell: true, encoding: "utf-8", timeout: 30000 });
      return sendJson(res, 200, { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 });
    }

    sendJson(res, 404, { error: "unknown endpoint" });
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
  }
}

export function createIdeServer() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    // Serve the single-page frontend for everything else.
    const html = readFileSync(join(__dirname, "public", "index.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

function main(): void {
  const server = createIdeServer();
  server.listen(PORT, () => {
    console.log(`UR IDE running at http://localhost:${PORT} (project: ${PROJECT_ROOT})`);
  });
}

// Only auto-start when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
