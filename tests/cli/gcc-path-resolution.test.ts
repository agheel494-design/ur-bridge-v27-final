// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: GCC Path Resolution (Windows Recovery Sprint, Priority 4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Priority 4 ("no manual GCC install" for a real end user) is only
// PARTIALLY addressed — see WINDOWS_GCC_BUNDLING_STATUS.md for the full,
// honest account of what remains.
//
// What IS done and tested here: compileC() now resolves gcc via a
// bundled-toolchain-first, PATH-fallback strategy. On this Linux
// environment (no bundled toolchain ever present), the fallback path is
// exercised by every compile-related test — this file specifically
// verifies compilation still succeeds correctly through the new
// resolution logic.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

describe("GCC path resolution — bundled-toolchain-first, PATH-fallback", () => {
  it("compilation still succeeds correctly via the PATH-fallback path (no bundled toolchain present in this environment)", () => {
    const src = 'function main(): int\n  print("gcc resolution still works")\n  return 0\nend\n';
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const cSource = emitC(ir.value);
    const compiled = compileC(cSource, "a.out", {});
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const r = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    expect(r.stdout.trim()).toBe("gcc resolution still works");
    expect(r.exitCode).toBe(0);
  });
});
