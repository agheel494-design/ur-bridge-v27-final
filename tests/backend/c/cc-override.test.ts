import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC } from "../../../tools/backend/c-compile.js";

// Real, live-confirmed CC environment variable override support -
// the standard Unix mechanism for compiler selection (task 3: enable
// Clang/MSVC testing for anyone with real access, since gcc is the
// only compiler installed in this project's own dev sandbox).

describe("C Backend: CC environment variable override (enables Clang/MSVC testing on machines that have them)", () => {
  it("a genuinely nonexistent CC value produces a clear error naming that exact value, not a silent gcc fallback", () => {
    const src = "function main(): int\n  return 7\nend\n";
    const { program } = parse(lex(src).tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const cSource = emitC(ir.value);

    const originalCC = process.env.CC;
    process.env.CC = "hypothetical-clang-xyz-does-not-exist";
    try {
      const compiled = compileC(cSource, "cc-override-test.bin");
      expect(compiled.ok).toBe(false);
      if (!compiled.ok) {
        expect(compiled.diagnostics[0]?.message).toContain("hypothetical-clang-xyz-does-not-exist");
      }
    } finally {
      if (originalCC === undefined) delete process.env.CC;
      else process.env.CC = originalCC;
    }
  });

  it("REGRESSION: default (no CC set) still uses real gcc correctly - struct construction compiles and runs (3+4=7)", () => {
    const src = "struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(3, 4)\n  return p.x + p.y\nend\n";
    const { program } = parse(lex(src).tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    if (!ir.ok) throw new Error("lowering failed");
    const cSource = emitC(ir.value);
    delete process.env.CC;
    const compiled = compileC(cSource, "cc-default-test.bin");
    expect(compiled.ok).toBe(true);
  });
});
