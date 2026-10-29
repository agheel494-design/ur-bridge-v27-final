// B-1 Gate — regression test for D-2 (C Backend + nativeptr; known limitation, NOT a new capability).
//
// Before B-1: cType()/cZeroValue() in src/backend/c/emit-c.ts had no case for the IR type "ptr" and returned
// `undefined`, which was interpolated into the C text as the type name "undefined" (gcc: "unknown type name
// 'undefined'", BE1001). The prototype of a function taking a nativeptr parameter silently lost that parameter
// (`int64_t ur_case_use(void);`).
// After B-1: the C Backend still does NOT support nativeptr (EXPECTED_VALUES.md case 43: "not applicable to the
// C Backend as a general concept"). Every ptr-typed position now carries the explicit marker
// C_UNSUPPORTED_NATIVEPTR_TYPE, which is deliberately not a C type, so gcc still rejects the program at the same
// phase (BE1001) and the message names the reason. The WASM Backend's behaviour for the same program is unchanged.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIR } from "../../tools/backend/differential-runner.js";
import { compileC } from "../../tools/backend/c-compile.js";
import { emitC, C_UNSUPPORTED_NATIVEPTR_TYPE } from "../../src/backend/c/emit-c.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";

const PROGRAM = readFileSync(join(process.cwd(), "tests", "backend", "wasm", "differential", "43-nativeptr-multiuse", "program.ur"), "utf-8");
const gccAvailable = spawnSync("gcc", ["--version"], { stdio: "ignore" }).status === 0;

function ir() {
  const r = buildIR(PROGRAM);
  if (!r.ok) throw new Error(r.detail);
  return r.module;
}

describe("B-1 D-2 — C Backend: nativeptr is an explicit, named unsupported type (no new capability)", () => {
  it("emitted C never contains the type name 'undefined'", () => {
    const c = emitC(ir());
    expect(/\bundefined\b/.test(c)).toBe(false);
  });

  it("every nativeptr position (return type, parameter, prototype parameter, local) uses the marker", () => {
    const c = emitC(ir());
    expect(C_UNSUPPORTED_NATIVEPTR_TYPE).toBe("nativeptr_unsupported_by_c_backend");
    expect(c).toContain(`${C_UNSUPPORTED_NATIVEPTR_TYPE} ur_case_get(void);`);
    expect(c).toContain(`int64_t ur_case_use(${C_UNSUPPORTED_NATIVEPTR_TYPE});`);
    expect(c).toContain(`int64_t ur_case_use(${C_UNSUPPORTED_NATIVEPTR_TYPE} p_p) {`);
    expect(c).toContain(`${C_UNSUPPORTED_NATIVEPTR_TYPE} v0 = ur_case_get();`);
  });

  it("the marker is not declared by the C runtime, so it cannot silently become a supported type", () => {
    for (const f of ["ur_runtime.h", "ur_runtime.c"]) {
      expect(readFileSync(join(process.cwd(), "runtime", f), "utf-8")).not.toContain(C_UNSUPPORTED_NATIVEPTR_TYPE);
    }
  });

  it("the program still fails on the C Backend at compile (BE1001), and the gcc message names the marker", (ctx) => {
    if (!gccAvailable) { ctx.skip(); return; }
    // compileC's own full diagnostic is checked (not differential-runner's 300-character summary, whose cut-off
    // position depends on the length of the temporary-directory path, e.g. on Windows).
    const r = compileC(emitC(ir()), "b1-d2.out");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics[0]!.code).toBe("BE1001");
    // gcc quotes the name with ASCII '…' under the C locale and with ‘…’ under a UTF-8 locale: match without quotes.
    expect(r.diagnostics[0]!.message).toContain("unknown type name");
    expect(r.diagnostics[0]!.message).toContain(C_UNSUPPORTED_NATIVEPTR_TYPE);
  });

  it("the WASM Backend's behaviour for the same program is unchanged (rejected, message contains 'is neither')", () => {
    expect(() => emitWasmModule(ir())).toThrow("is neither");
  });
});
