// B-1 Gate — regression test for D-3 (lexer diagnostics in the CLI and the IDE).
//
// Before B-1: src/cli/index.ts (lexAndCheck) and src/ide/server.ts cast a LexError directly to
// FormattableDiagnostic (TS2352). A LexError span names its columns startCol/endCol and carries the lexer's
// placeholder file "<input>", so the CLI printed "<input>:2:undefined: error[LE002] ..." with no caret, and the
// IDE returned lexer diagnostics without "column"/"endColumn".
// After B-1: both use lexErrorToFormattable (src/compiler/diagnostics/adapter.ts). Code, message, line and the
// exit code are unchanged; the file name, column and caret are now present, as for parser errors.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { lexErrorToFormattable } from "../../src/compiler/diagnostics/adapter.js";
import { formatDiagnostic } from "../../src/shared/diagnostic-formatter.js";

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const CLI_ENTRY = join(process.cwd(), "src", "cli", "index.ts");
const UNTERMINATED = 'function main(): int\n  let s = "abc\n  return 0\nend\n';
const TWO_CHAR = "function main(): int\n  let c = 'ab'\n  return 0\nend\n";

describe("B-1 D-3 — lexErrorToFormattable", () => {
  it("maps startCol/endCol to startColumn/endColumn and keeps code and message", () => {
    const { errors } = lex(UNTERMINATED);
    expect(errors.length).toBe(1);
    const e = errors[0]!;
    const f = lexErrorToFormattable(e);
    expect(f.code).toBe("LE002");
    expect(f.message).toBe(e.message);
    expect(f.span).toEqual({ startLine: e.span.startLine, startColumn: e.span.startCol, endLine: e.span.endLine, endColumn: e.span.endCol });
    expect(f.span).toEqual({ startLine: 2, startColumn: 11, endLine: 2, endColumn: 15 });
  });

  it("does not carry the lexer's placeholder file name, so the caller's file name is used", () => {
    const { errors } = lex(UNTERMINATED);
    expect(errors[0]!.span.file).toBe("<input>");
    const text = formatDiagnostic(lexErrorToFormattable(errors[0]!), UNTERMINATED, "prog.ur");
    expect(text.split("\n")[0]).toBe("prog.ur:2:11: error[LE002]: Unterminated string literal");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("<input>");
    expect(text).toContain("^");
  });
});

describe("B-1 D-3 — CLI 'ur run' on lexer errors", () => {
  for (const [name, src, header] of [
    ["unterminated string (LE002)", UNTERMINATED, "lexerr.ur:2:11: error[LE002]: Unterminated string literal"],
    ["two-character char literal (LE005)", TWO_CHAR, "lexerr.ur:2:11: error[LE005]: Char literal contains 2 characters"],
  ] as const) {
    it(`${name}: file:line:column header, caret, exit code 1 (unchanged)`, () => {
      const dir = mkdtempSync(join(tmpdir(), "b1-d3-"));
      try {
        writeFileSync(join(dir, "lexerr.ur"), src, "utf-8");
        const r = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, "run", "lexerr.ur"], { cwd: dir, encoding: "utf-8" });
        expect(r.status).toBe(1);
        expect(r.stderr.split("\n")[0]).toContain(header);
        expect(r.stderr).not.toContain("undefined");
        expect(r.stderr).not.toContain("<input>");
        expect(r.stderr).toContain("^");
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }, 30000);
  }
});
