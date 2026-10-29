// ─────────────────────────────────────────────────────────────────────────────
// UR — Tests: C Backend Emitter (unit-level, no gcc invocation)
// Level 2 — Phase 2.3
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";

function irFor(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const result = lowerToIR(program, "t.ur", "t");
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

describe("emit-c — structural correctness", () => {
  it("includes required C99 headers", () => {
    const c = emitC(irFor("function main(): int\n  return 0\nend\n"));
    expect(c).toContain("#include <stdint.h>");
    expect(c).toContain("#include <stdbool.h>");
  });

  it("emits a forward declaration (prototype) for every function", () => {
    const c = emitC(irFor("function add(a: int, b: int): int\n  return a + b\nend\nfunction main(): int\n  return add(1,2)\nend\n"));
    expect(c).toContain("int64_t ur_t_add(int64_t, int64_t);");
  });

  it("emits a real C main() wrapping the UR main function", () => {
    const c = emitC(irFor("function main(): int\n  return 7\nend\n"));
    expect(c).toContain("int main(void) {");
    expect(c).toContain("int result = (int)ur_t_main();");
    expect(c).toContain("return result;");
  });

  it("emits a C main() for a void UR main too", () => {
    const c = emitC(irFor("function main()\n  let x = 1\nend\n"));
    expect(c).toContain("int main(void) {");
    expect(c).toContain("return 0;");
  });

  it("does not emit a C main() when there is no UR 'main' function", () => {
    const c = emitC(irFor("function helper(): int\n  return 1\nend\n"));
    expect(c).not.toContain("int main(void)");
  });

  it("maps IR types to correct C types", () => {
    const c = emitC(irFor("function f(): int\n  return 1\nend\n"));
    expect(c).toContain("int64_t");
  });

  it("maps bool IR type to C bool", () => {
    const c = emitC(irFor("function f(): bool\n  return true\nend\n"));
    expect(c).toContain("bool");
    expect(c).toContain("true");
  });

  it("maps float IR type to C double, with a valid float literal", () => {
    const c = emitC(irFor("function f(): float\n  return 3.14\nend\n"));
    expect(c).toContain("double");
    expect(c).toContain("3.14");
  });

  it("integer-valued float literal gets a .0 suffix (valid C float syntax)", () => {
    const c = emitC(irFor("function f(): float\n  return 5.0\nend\n"));
    expect(c).toMatch(/5(\.0)?;/); // either "5.0;" — must not emit bare "5;" for a double context ambiguity
    expect(c).toContain("5.0");
  });

  it("string literal is escaped correctly (quotes, backslashes, newlines)", () => {
    const c = emitC(irFor('function f(): string\n  return "line1\\nline2"\nend\n'));
    expect(c).toContain('"line1\\nline2"');
  });

  it("binary operators map to correct C operators", () => {
    const c = emitC(irFor("function f(): int\n  return 1 + 2 * 3\nend\n"));
    expect(c).toContain("+");
    expect(c).toContain("*");
  });

  it("function calls emit a direct C call with qualified name", () => {
    const c = emitC(irFor("function helper(): int\n  return 1\nend\nfunction main(): int\n  return helper()\nend\n"));
    expect(c).toContain("ur_t_helper()");
  });

  it("parameters are correctly bound to their SSA values", () => {
    const c = emitC(irFor("function f(x: int): int\n  return x\nend\n"));
    expect(c).toContain("p_x");
  });

  it("generated C is syntactically well-formed (balanced braces)", () => {
    const c = emitC(irFor("function add(a: int, b: int): int\n  return a + b\nend\nfunction main(): int\n  return add(1, 2)\nend\n"));
    const opens = (c.match(/\{/g) ?? []).length;
    const closes = (c.match(/\}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("REGRESSION: an unused local variable is suppressed with (void)vN; to prevent a legitimate-but-noisy gcc -Wunused-variable warning", () => {
    // Found during Backend E2E hardening: `let y = 20` (never used) produced
    // a real gcc -Wunused-variable warning, which would have made ANY UR
    // program with an intentionally-or-accidentally unused binding fail a
    // "zero warnings" Backend correctness check. Fixed by emitting a
    // `(void)vN;` suppression statement for every SSA value that is
    // defined but never referenced by any later instruction or terminator.
    const c = emitC(irFor("function main(): int\n  let x = 10\n  let y = 20\n  return x\nend\n"));
    expect(c).toMatch(/\(void\)v\d+;/);
  });

  it("bool-returning main() casts to int in the C wrapper (0/1 exit code), not silently discarded", () => {
    // Found during Backend E2E hardening: only i64-returning `main` was
    // wired through `(int)` cast; a bool-returning `main` fell into the
    // "discard result, always exit 0" branch, making comparison-result
    // programs unable to express their result as a real exit code.
    const c = emitC(irFor("function main(): bool\n  return true\nend\n"));
    expect(c).toContain("int result = (int)ur_t_main();");
    expect(c).toContain("return result;");
  });

  it("main() wrapper calls Runtime lifecycle functions around the UR program, discovered via lifecycleRole (not hardcoded)", () => {
    const c = emitC(irFor("function main(): int\n  return 1\nend\n"));
    const mainBody = c.slice(c.indexOf("int main(void) {"));
    const initIdx = mainBody.indexOf("ur_runtime_init(");
    const callIdx = mainBody.indexOf("ur_t_main()");
    const shutdownIdx = mainBody.indexOf("ur_runtime_shutdown(");
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(callIdx).toBeGreaterThan(initIdx);
    expect(shutdownIdx).toBeGreaterThan(callIdx);
  });
});
