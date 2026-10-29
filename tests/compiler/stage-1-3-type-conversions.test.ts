// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Stage 1.3 Type Conversions — Bug Hunt Results
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase. The one real bug found in this
// stage (integer literal precision) has its own dedicated test file:
// tests/compiler/frontend/integer-literal-precision.test.ts.
//
// This file confirms the REST of Type Conversions is sound:
//   - int -> float (implicit widening): works correctly.
//   - bool <-> int, string <-> number, float -> int (narrowing): all
//     correctly REJECTED at type-check time — sound, safe behavior,
//     not a bug.
//   - Explicit cast syntax (int(x), float(x)): confirmed NOT
//     implemented (a missing feature, not a bug).
//   - Signed/unsigned: does not apply at the general-purpose language
//     level — Tier-2 ABI-precise types are FFI/ABI-only per
//     ADR_1_TIER2_TYPES_DECISION.md, already documented; not re-probed.

import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../tools/backend/c-compile.js";

function typeErrors(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const tc = typeCheck(program);
  return (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
}

async function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program } = parse(tokens);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r;
}

describe("Stage 1.3 Type Conversions — implicit widening (confirmed working, no bug)", () => {
  it("int assigned to a float-typed variable widens correctly", async () => {
    const r = await compileAndRun('function main(): int\n  let x: float = 5\n  print(x)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("5");
  });

  it("int used in float arithmetic widens correctly", async () => {
    const r = await compileAndRun('function main(): int\n  let x: float = 3\n  let y: float = x + 2\n  print(y)\n  return 0\nend\n');
    expect(r.stdout.trim()).toBe("5");
  });
});

describe("Stage 1.3 Type Conversions — implicit cross-type coercion is correctly REJECTED (sound type safety, not a bug)", () => {
  it("bool -> int is rejected", () => {
    const errors = typeErrors('function main(): int\n  let x: int = true\n  return 0\nend\n');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.code).toBe("TY2002");
  });

  it("int -> bool is rejected", () => {
    const errors = typeErrors('function main(): int\n  let x: bool = 1\n  return 0\nend\n');
    expect(errors.length).toBeGreaterThan(0);
  });

  it("string -> int is rejected", () => {
    const errors = typeErrors('function main(): int\n  let x: int = "5"\n  return 0\nend\n');
    expect(errors.length).toBeGreaterThan(0);
  });

  it("int -> string is rejected", () => {
    const errors = typeErrors('function main(): int\n  let x: string = 5\n  return 0\nend\n');
    expect(errors.length).toBeGreaterThan(0);
  });

  it("float -> int (implicit narrowing) is rejected", () => {
    const errors = typeErrors('function main(): int\n  let x: int = 3.7\n  return 0\nend\n');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("Stage 1.3 Type Conversions — confirmed NOT implemented (missing feature, not a bug)", () => {
  it("explicit int(x) cast syntax does not exist — rejected as an unresolved function call, not a real cast", () => {
    const { tokens } = lex('function main(): int\n  let x: float = 3.7\n  let y: int = int(x)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
    if (ir.ok) return;
    expect(JSON.stringify(ir.diagnostics)).toContain("unresolved function");
  });

  it("explicit float(x) cast syntax does not exist either", () => {
    const { tokens } = lex('function main(): int\n  let x: int = 5\n  let y: float = float(x)\n  return 0\nend\n');
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "t.ur", "t");
    expect(ir.ok).toBe(false);
  });
});
