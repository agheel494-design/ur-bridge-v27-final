// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Integer Literal Safe-Precision Rejection (PE011)
// ─────────────────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase — Category A (Critical) fix.
// Confirmed real bug: `Number(t.text)` in parser.ts silently lost
// precision for any integer literal beyond JS's float64 exact-integer
// limit (2^53-1) — NOT only for genuine i64 overflow. A realistic
// nanosecond timestamp and even 2^53+1 (an ordinary, in-range i64 value)
// both silently corrupted to a DIFFERENT wrong number, zero diagnostic.
//
// DECISION (explicit, recorded — see the ENGINEERING TODO in parser.ts's
// own INT_LIT case): full, exact i64 precision for every legal literal
// requires converting IntLiteral.value to bigint throughout the whole
// pipeline — deferred to a future version. For v1.0: reject unsafe
// literals explicitly (PE011) rather than silently corrupting them —
// the fix implemented and tested here.

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";

function pe011Count(src: string): number {
  const { tokens } = lex(src);
  const { errors } = parse(tokens);
  return errors.filter((e: any) => e.code === "PE011").length;
}

describe("Integer literal safe-precision rejection (PE011) — exact required boundaries", () => {
  it("2^53 - 1 (9007199254740991) is ACCEPTED — the exact upper edge of safe precision", () => {
    expect(pe011Count("let x = 9007199254740991\n")).toBe(0);
  });

  it("2^53 exactly (9007199254740992) is REJECTED — one past the safe boundary", () => {
    expect(pe011Count("let x = 9007199254740992\n")).toBe(1);
  });

  it("2^53 + 1 (9007199254740993) is REJECTED — the exact value that silently corrupted before this fix", () => {
    expect(pe011Count("let x = 9007199254740993\n")).toBe(1);
  });

  it("a value far beyond i64's own range (23 digits) is REJECTED", () => {
    expect(pe011Count("let x = 99999999999999999999999\n")).toBe(1);
  });

  it("a large negative value (via 0 - X, UR's own negation form) is REJECTED — the underlying positive magnitude is still checked", () => {
    expect(pe011Count("let x = 0 - 9007199254740993\n")).toBe(1);
  });

  it("a large negative value via direct unary minus is REJECTED too", () => {
    expect(pe011Count("let x = -9007199254740993\n")).toBe(1);
  });
});

describe("Integer literal safe-precision rejection (PE011) — additional coverage", () => {
  it("an ordinary small literal is accepted (baseline sanity)", () => {
    expect(pe011Count("let x = 42\n")).toBe(0);
  });

  it("zero is accepted", () => {
    expect(pe011Count("let x = 0\n")).toBe(0);
  });

  it("a large hex literal exceeding the safe limit is rejected (0x20000000000000 == 2^53)", () => {
    expect(pe011Count("let x = 0x20000000000000\n")).toBe(1);
  });

  it("a realistic large-but-safe value (e.g. a Unix timestamp) is accepted", () => {
    expect(pe011Count("let x = 1700000000\n")).toBe(0);
  });

  it("a realistic nanosecond timestamp (the exact motivating real-world case) is rejected, not silently corrupted", () => {
    expect(pe011Count("let x = 1700000000123456789\n")).toBe(1);
  });

  it("the diagnostic message names the exact safe limit and explains the rejection reason clearly", () => {
    const { tokens } = lex("let x = 9007199254740992\n");
    const { errors } = parse(tokens);
    const err = errors.find((e: any) => e.code === "PE011");
    expect(err).toBeDefined();
    expect(err!.message).toContain("safe precision limit");
    expect(err!.message).toContain("9007199254740991");
  });

  it("rejecting an unsafe literal does not also produce a cascade of unrelated errors for the rest of a larger program", () => {
    const { tokens } = lex("function main(): int\n  let x = 9007199254740992\n  let y = 5\n  return y\nend\n");
    const { errors } = parse(tokens);
    expect(errors.filter((e: any) => e.code === "PE011")).toHaveLength(1);
  });
});
