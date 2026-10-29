// B-1 Gate — regression test for D-1 (free(array); known limitation, behaviour UNCHANGED by B-1).
//
// Before and after B-1: free() on an owning local array lowers to a call of the generic "Free" builtin extern,
// `ur_free` (string-typed). No `ur_free_array` extern is registered (V29-D3 NOT OPENED per ROADMAP_LOCK), so the
// C Backend emits `ur_free(slot_a, 3);`, which gcc rejects (BE1001).
// What B-1 changed: ir-builder.ts passed a third argument (`true`) that resolveBuiltinExtern does not declare
// (TS2554). JavaScript ignored it, so removing it changes nothing at runtime. This test pins that the IR and the
// C text are exactly what C5-r2 produced, so any future change to free(array) must be an explicit decision.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { buildIR } from "../../tools/backend/differential-runner.js";
import { compileC } from "../../tools/backend/c-compile.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { resolveBuiltinExtern } from "../../src/shared/runtime-table.js";
import { RUNTIME_CORE_EXTERNS } from "../../src/shared/runtime-table.js";

const PROGRAM = "function main(): int\n  let a = [1, 2, 3]\n  free(a)\n  return 0\nend\n";
const gccAvailable = spawnSync("gcc", ["--version"], { stdio: "ignore" }).status === 0;

function ir() {
  const r = buildIR(PROGRAM);
  if (!r.ok) throw new Error(r.detail);
  return r.module;
}

describe("B-1 D-1 — free(array) keeps its C5-r2 behaviour (known limitation pinned)", () => {
  it("the Free builtin resolves to ur_free, and no ur_free_array extern is registered", () => {
    expect(resolveBuiltinExtern("Free")?.name).toBe("ur_free");
    expect(RUNTIME_CORE_EXTERNS.some(e => e.name === "ur_free_array")).toBe(false);
  });

  it("IR: free(a) on an owning local array is a call to ur_free carrying the array slot", () => {
    const main = ir().functions.find(f => f.sourceName === "main")!;
    const calls = main.blocks.flatMap(b => b.instructions).filter(i => i.kind === "call");
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    if (call.kind !== "call") throw new Error("unreachable");
    expect(call.callee).toBe("ur_free");
    expect(call.args.length).toBe(1);
    expect(call.args[0]!.arraySlot).toBeDefined();
  });

  it("C text: the call is emitted as ur_free(slot_a, 3) — as in C5-r2", () => {
    expect(emitC(ir())).toContain("ur_free(slot_a, 3);");
  });

  it("C Backend: still rejected at compile with BE1001 (D-1 not fixed by B-1)", (ctx) => {
    if (!gccAvailable) { ctx.skip(); return; }
    // compileC's own full diagnostic (not differential-runner's truncated summary).
    const r = compileC(emitC(ir()), "b1-d1.out");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics[0]!.code).toBe("BE1001");
    expect(r.diagnostics[0]!.message).toContain("ur_free");
  });

  it("free(array) on a parameter is still rejected at compile time (Owner Authority unchanged)", () => {
    const r = buildIR("function f(a: int[]): int\n  free(a)\n  return 0\nend\nfunction main(): int\n  return 0\nend\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("owning local array");
  });
});
