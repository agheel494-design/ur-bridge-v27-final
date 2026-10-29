// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Optimizer Validation Performance (O(n²) fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase — found via direct profiling
// (tests/optimizer/pass.ts's own header comment on validateFunction has
// the full root-cause writeup): validateFunction's sibling-inclusion fix
// (needed for correct cross-function call resolution) originally passed
// each sibling's FULL real body into checkModuleInvariants' wrapper
// module, causing an O(n²) re-validation of every sibling's full
// instruction set on every single validateFunction call. For a 200-
// function program, this was 92.9% of total (lex+parse+typecheck+lower+
// optimize+emit) compile time. Fixed: siblings are now lightweight name/
// signature-only stubs (empty blocks) — call resolution (name-based) is
// unaffected; the expensive per-instruction structural loop does
// effectively zero work per stub.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { runPipeline } from "../../src/optimizer/pass.js";
import { constantFoldingPass } from "../../src/optimizer/constant-folding.js";
import { deadCodeEliminationPass } from "../../src/optimizer/dead-code-elimination.js";

function buildProgram(fnCount: number): string {
  let src = "";
  for (let i = 0; i < fnCount; i++) {
    src += `function f${i}(a: int, b: int): int\n`;
    src += `  let x = a + b\n  let y = x * 2\n`;
    src += `  if y > 10\n    y = y - 1\n  else\n    y = y + 1\n  end\n`;
    src += `  let i = 0\n  while i < 5\n    y = y + i\n    i = i + 1\n  end\n`;
    src += `  return y\nend\n\n`;
  }
  src += `function main(): int\n  return f0(1, 2)\nend\n`;
  return src;
}

describe("Optimizer validation performance — O(n²) fix", () => {
  it("optimizing a 200-function program completes well within a generous time budget (regression guard against the fixed O(n²) sibling re-validation bug)", () => {
    const src = buildProgram(200);
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "bench.ur", "bench");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;

    const t0 = performance.now();
    for (const fn of ir.value.functions) {
      runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass], ir.value.functions);
    }
    const elapsed = performance.now() - t0;

    // Before the fix: ~1832ms on this exact program in this exact
    // environment. After: ~324ms. A generous 1000ms budget (well above
    // the fixed version's own measured time, far below the broken
    // version's) catches a real regression without being flaky on
    // normal environment timing variance.
    expect(elapsed).toBeLessThan(1000);
  });

  it("cross-function call resolution still works correctly after the stub-sibling fix (the ORIGINAL bug this mechanism exists to prevent)", () => {
    const src = "function double(x: int): int\n  return x * 2\nend\n\nfunction main(): int\n  return double(21)\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    // Must NOT throw — a call to a real sibling function must resolve
    // correctly even though the sibling is now passed as a stub.
    expect(() => {
      for (const fn of ir.value.functions) {
        runPipeline(fn, [constantFoldingPass, deadCodeEliminationPass], ir.value.functions);
      }
    }).not.toThrow();
  });

  it("a GENUINELY unresolved call (to a function that does not exist anywhere) is still correctly detected as invalid, even with stubbed siblings", () => {
    // Constructs a minimal IR function directly with a call to a
    // nonexistent symbol, bypassing the real compiler pipeline (which
    // would never produce this) — proving validateFunction's own
    // detection logic still works, not just that valid programs pass.
    const badFn = {
      qualifiedName: "bad_fn", sourceName: "bad_fn", params: [], returnType: "i64" as const,
      entryBlock: 0, locals: [],
      blocks: [{
        id: 0, label: "entry",
        instructions: [{ kind: "call" as const, id: 0, type: "i64" as const, callee: "totally_nonexistent_function", args: [], location: { file: "t", start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } }],
        terminator: { kind: "return" as const, value: { id: 0 }, location: { file: "t", start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } },
      }],
      location: { file: "t", start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
    };
    expect(() => runPipeline(badFn, [], [])).toThrow(/unresolved function 'totally_nonexistent_function'/);
  });
});
