// B-1 Gate — regression tests for the two latent items L-1 and L-2 (unreachable from the CLI; reachable only by
// calling the compiler APIs directly with semantic analysis bypassed).
//
// L-1 (src/compiler/typesystem/struct-layout-calculator.ts). Before: computeStructLayout with a "ptr" field
// threw TypeError ("Cannot destructure property 'size' ... as it is undefined"). After: it throws
// StructLayoutRejectionError (the module's diagnosable error type). No layout is assigned to nativeptr.
// L-2 (src/compiler/codegen/ir-builder.ts). Before: an array parameter whose element struct mixes scalar and
// reference fields recorded CG1002 but the function was still returned with params=[null], so lowerToIR reported
// ok:true (and both backends then crashed with TypeError). After: lowerFunction returns null, lowerToIR reports
// ok:false with the same CG1002 diagnostic.
import { describe, it, expect } from "vitest";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { analyze } from "../../src/compiler/semantic/index.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { computeStructLayout, StructLayoutRejectionError } from "../../src/compiler/typesystem/struct-layout-calculator.js";

describe("B-1 L-1 — struct layout of a nativeptr field", () => {
  it("is rejected with StructLayoutRejectionError, not a TypeError", () => {
    expect(() => computeStructLayout("S", [{ name: "a", type: "i64" }, { name: "p", type: "ptr" }])).toThrow(StructLayoutRejectionError);
    expect(() => computeStructLayout("S", [{ name: "p", type: "ptr" }])).toThrow("nativeptr");
  });

  it("other primitive layouts are unchanged", () => {
    const l = computeStructLayout("T", [{ name: "a", type: "bool" }, { name: "b", type: "i64" }, { name: "c", type: "string" }, { name: "d", type: "array_ref" }, { name: "e", type: "f64" }]);
    expect(l.fields.map(f => f.offset)).toEqual([0, 8, 16, 24, 32]);
    expect(l.size).toBe(40);
    expect(l.alignment).toBe(8);
  });

  it("from source, a nativeptr struct field is still rejected first by semantic analysis (SE6001)", () => {
    const { program } = parse(lex("struct S\n  a: int\n  p: nativeptr\nend\nfunction main(): int\n  return 0\nend\n").tokens);
    const codes = (analyze(program).diagnostics ?? []).map((d: { code: string }) => d.code);
    expect(codes).toContain("SE6001");
  });
});

describe("B-1 L-2 — array parameter of a mixed scalar/reference struct", () => {
  const SRC = "struct Rec\n  n: int\n  xs: int[]\nend\nfunction first(rs: Rec[]): int\n  return 1\nend\nfunction main(): int\n  return 0\nend\n";

  it("lowerToIR now fails (ok:false) with CG1002 instead of returning params=[null]", () => {
    const { program } = parse(lex(SRC).tokens);
    const ir = lowerToIR(program, "p.ur", "p");
    expect(ir.ok).toBe(false);
    expect(ir.diagnostics.map(d => d.code)).toEqual(["CG1002"]);
  });

  it("from source, semantic analysis still rejects the struct first (SE6001)", () => {
    const { program } = parse(lex(SRC).tokens);
    const codes = (analyze(program).diagnostics ?? []).map((d: { code: string }) => d.code);
    expect(codes).toContain("SE6001");
  });
});
