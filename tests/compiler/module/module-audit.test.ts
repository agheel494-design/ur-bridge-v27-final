import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { buildModuleDescriptor, checkExports } from "../../../src/compiler/module/export-checker.js";
import { ModuleRegistry } from "../../../src/compiler/module/registry.js";

// Module Audit, corrected version.
//
// CRITICAL SELF-CORRECTION: an earlier version of this audit checked
// only export-checker.ts and wrongly concluded 4 of 6 MCODES were
// unused. Real scope: src/compiler/module/ has 5 files. MD1004
// (CIRCULAR_IMPORT) and MD1006 (AMBIGUOUS_IMPORT) are actually
// referenced in registry.ts, not export-checker.ts - missed by the
// narrower search.

function build(src: string, file: string) {
  const l = lex(src, file);
  const p = parse(l.tokens, file);
  return p.program;
}

describe("Module Audit (corrected, full scope): MD1001, MD1004, MD1005", () => {
  it("MD1001 (DUPLICATE_EXPORT): two functions with the same name", () => {
    const l = lex("function f(): int\n  return 1\nend\nfunction f(): int\n  return 2\nend", "t.ur");
    const p = parse(l.tokens, "t.ur");
    const r = buildModuleDescriptor(p.program, "t.ur");
    expect(r.diagnostics.map((d) => d.code)).toContain("MD1001");
  });

  it("MD1005 (MISSING_MODULE): importing a module not present in the registry", () => {
    const l = lex('import "nonexistent"\nfunction main(): int\n  return 0\nend', "t.ur");
    const p = parse(l.tokens, "t.ur");
    const r = buildModuleDescriptor(p.program, "t.ur");
    r.descriptor.imports[0]!.resolvedPath = "/some/resolved/path";
    const diag = checkExports(r.descriptor, new Map());
    expect(diag.map((d) => d.code)).toContain("MD1005");
  });

  it("MD1004 (CIRCULAR_IMPORT): two real modules importing each other via ModuleRegistry.resolveAll()", () => {
    const reg = new ModuleRegistry();
    reg.register(build('import "./b.ur"\nfunction fa(): int\n  return 1\nend', "a.ur"), "a.ur");
    reg.register(build('import "./a.ur"\nfunction fb(): int\n  return 2\nend', "b.ur"), "b.ur");
    const result = reg.resolveAll();
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("MD1004");
  });

  it("REGRESSION: two real modules with a healthy, non-circular import resolve cleanly", () => {
    const reg = new ModuleRegistry();
    reg.register(build("function fa(): int\n  return 1\nend", "x.ur"), "x.ur");
    reg.register(build('import "./x.ur"\nfunction fb(): int\n  return 2\nend', "y.ur"), "y.ur");
    const result = reg.resolveAll();
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});
