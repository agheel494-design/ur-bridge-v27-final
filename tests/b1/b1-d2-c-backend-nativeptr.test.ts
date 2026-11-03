import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIR, runOnCBackend } from "../../tools/backend/differential-runner.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";

const PROGRAM = readFileSync(
  join(process.cwd(), "tests", "backend", "wasm", "differential", "43-nativeptr-multiuse", "program.ur"),
  "utf-8",
);

function ir() {
  const r = buildIR(PROGRAM);
  if (!r.ok) throw new Error(r.detail);
  return r.module;
}

describe("B-1 D-2 - C Backend nativeptr parameter V1.0 rejection", () => {
  it("IR lowering still accepts the program", () => {
    expect(() => ir()).not.toThrow();
  });

  it("C Backend rejects a nativeptr function parameter before emitting C", () => {
    expect(() => emitC(ir())).toThrow(
      "[C1001] use: nativeptr function parameters are not supported by the C backend in V1.0",
    );
  });

  it("C differential runner fails in BUILD at emitC, before gcc compilation", () => {
    const r = runOnCBackend(ir());
    expect(r.BUILD).toBe("FAIL");
    expect(r.firstFailedPhase).toBe("BUILD");
    expect(String(r.observed)).toContain("emitC threw");
    expect(String(r.observed)).toContain("C1001");
    expect(String(r.observed)).toContain("nativeptr function parameters are not supported");
    expect(String(r.observed)).not.toContain("gcc failed");
  });

  it("WASM Backend behaviour for the same program is unchanged", () => {
    expect(() => emitWasmModule(ir())).toThrow("is neither");
  });
});
