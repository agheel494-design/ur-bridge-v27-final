// ─────────────────────────────────────────────────────────────────────────────
// UR Backend Validation Suite (V2-M6) — Differential Runner
// ─────────────────────────────────────────────────────────────────────────────
//
// New infrastructure only. Does not modify emit-wasm.ts, wasm-cfg-validation.ts,
// ir-builder.ts, or any Frozen Baseline. Wraps already-proven, already-exposed
// pieces (emitC/compileC/runExecutable, emitWasmModule/validate/instantiate)
// this track has used manually, Gate after Gate, into one reusable pair of
// functions.
//
// Per the V2-M6 Design Gate and its own governance conditions:
//  - tools/generate-wasm-golden.ts is NOT used and is NOT the source of any
//    expected value — see tests/backend/wasm/differential/EXPECTED_VALUES.md,
//    written and reviewed BEFORE any fixture in this Suite.
//  - C == WASM is checked, but is never treated as proof both are correct —
//    each side is ALSO compared against the independent Oracle separately.
//  - Every phase (BUILD/VALIDATE/INSTANTIATE/EXECUTE) is tracked individually
//    (PhaseResult below) — a bare PASS/FAIL is never reported, per the direct
//    lesson from V2-MU (a module can validate() === true while still failing
//    real instantiation on a genuine signature mismatch).

import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";
import { emitC } from "../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "./c-compile.js";
import type { IRModule } from "../../src/shared/ir.js";

export type Phase = "BUILD" | "VALIDATE" | "INSTANTIATE" | "EXECUTE";
export type PhaseStatus = "PASS" | "FAIL" | "SKIPPED";

export type PhaseResult = {
  BUILD: PhaseStatus;
  VALIDATE: PhaseStatus;
  INSTANTIATE: PhaseStatus;
  EXECUTE: PhaseStatus;
  observed: unknown;
  firstFailedPhase: Phase | null;
};

/** A host stub for ur_runtime imports, sufficient for every fixture kind in
 *  this Suite (int/float printing, string input/print/free) - captures
 *  every observable side effect (host invocation counts, printed values)
 *  rather than silently swallowing them, so a fixture can assert on them
 *  directly (see the side-effect-multi-use fixture in particular). */
export function makeHostStub(scriptedStdinLine: string = "") {
  const printedInts: bigint[] = [];
  const printedFloats: number[] = [];
  const printedStrings: string[] = [];
  let inputCallCount = 0;
  let freeCallCount = 0;
  let memoryRef: WebAssembly.Memory | undefined;
  let bumpRef: WebAssembly.Global | undefined;
  const importObject = {
    ur_runtime: {
      ur_print_int: (n: bigint) => { printedInts.push(n); },
      ur_print_float: (f: number) => { printedFloats.push(f); },
      ur_input_string: () => {
        inputCallCount++;
        if (!memoryRef || !bumpRef) throw new Error("host stub: memory/bump not wired before ur_input_string call");
        const bytes = new TextEncoder().encode(scriptedStdinLine);
        const offset = (bumpRef.value as unknown) as number;
        const view = new DataView(memoryRef.buffer);
        view.setBigInt64(offset, BigInt(bytes.length), true);
        new Uint8Array(memoryRef.buffer, offset + 8, bytes.length).set(bytes);
        (bumpRef as unknown as { value: number }).value = offset + 8 + bytes.length;
        return offset;
      },
      ur_print_string: (offset: number) => {
        if (!memoryRef) throw new Error("host stub: memory not wired before ur_print_string call");
        const view = new DataView(memoryRef.buffer);
        const length = Number(view.getBigInt64(offset, true));
        printedStrings.push(new TextDecoder().decode(new Uint8Array(memoryRef.buffer, offset + 8, length)));
      },
      ur_free: () => { freeCallCount++; },
    },
  };
  return {
    importObject,
    setMemoryRefs: (instance: WebAssembly.Instance) => {
      memoryRef = instance.exports.memory as WebAssembly.Memory | undefined;
      bumpRef = instance.exports.ur_bump as WebAssembly.Global | undefined;
    },
    printedInts, printedFloats, printedStrings,
    getInputCallCount: () => inputCallCount,
    getFreeCallCount: () => freeCallCount,
  };
}

/** Compiles UR source to IR once (shared by both backends, matching the
 *  Design Gate's own architecture diagram) - throws only for a genuine
 *  parse/lowering failure, which is itself a BUILD-phase failure. */
export function buildIR(src: string): { ok: true; module: IRModule } | { ok: false; detail: string } {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) return { ok: false, detail: `parse: ${JSON.stringify(errors).slice(0, 300)}` };
  const ir = lowerToIR(program, "program.ur", "case");
  if (!ir.ok) return { ok: false, detail: `lower: ${JSON.stringify(ir.diagnostics).slice(0, 300)}` };
  return { ok: true, module: ir.value };
}

/** Runs the C Backend side: emit -> compile -> execute. Every phase this
 *  side has (BUILD covers emit+compile here, since the C Backend has no
 *  separate validate/instantiate concept - EXECUTE covers running the
 *  produced binary) is tracked the same way as the WASM side, for a
 *  symmetric PhaseResult shape. */
export function runOnCBackend(module: IRModule): PhaseResult {
  const result: PhaseResult = { BUILD: "FAIL", VALIDATE: "SKIPPED", INSTANTIATE: "SKIPPED", EXECUTE: "SKIPPED", observed: undefined, firstFailedPhase: "BUILD" };
  let cSource: string;
  try {
    cSource = emitC(module);
  } catch (e) {
    result.observed = `emitC threw: ${(e as Error).message}`;
    return result;
  }
  const compiled = compileC(cSource, `v2m6_c_${Date.now()}_${Math.random().toString(36).slice(2)}.out`, {});
  if (!compiled.ok) {
    result.observed = `compileC failed: ${JSON.stringify(compiled).slice(0, 300)}`;
    return result;
  }
  result.BUILD = "PASS";
  result.VALIDATE = "PASS";
  result.INSTANTIATE = "PASS";
  try {
    const run = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    result.EXECUTE = "PASS";
    result.observed = { exitCode: run.exitCode, stdout: run.stdout, signal: run.signal };
    result.firstFailedPhase = null;
  } catch (e) {
    result.EXECUTE = "FAIL";
    result.observed = `runExecutable threw: ${(e as Error).message}`;
    result.firstFailedPhase = "EXECUTE";
  }
  return result;
}

/** Runs the WASM Backend side: validate -> instantiate -> execute,
 *  tracked as three genuinely separate phases (the direct V2-MU lesson -
 *  never collapse this into one boolean). */
export async function runOnWasmBackend(module: IRModule, hostStub: ReturnType<typeof makeHostStub>): Promise<PhaseResult> {
  const result: PhaseResult = { BUILD: "FAIL", VALIDATE: "SKIPPED", INSTANTIATE: "SKIPPED", EXECUTE: "SKIPPED", observed: undefined, firstFailedPhase: "BUILD" };
  // B-1 Gate (type-only): WebAssembly.validate/instantiate take a
  // BufferSource, i.e. a view over an ArrayBuffer (not a SharedArrayBuffer).
  // emitWasmModule's declared return type is Uint8Array<ArrayBufferLike>,
  // which TypeScript (lib.dom since 5.7) does not accept there (TS2345 at
  // validate; and TS2339 on `.instance`, because overload resolution then
  // fell back to the `(module: WebAssembly.Module)` overload). Copying the
  // bytes into a fresh Uint8Array (backed by a plain ArrayBuffer) gives the
  // exact same byte content and the correct static type.
  let wasmBytes: Uint8Array<ArrayBuffer>;
  try {
    wasmBytes = new Uint8Array(emitWasmModule(module));
    result.BUILD = "PASS";
  } catch (e) {
    result.observed = `emitWasmModule threw (rejection): ${(e as Error).message}`;
    result.firstFailedPhase = "BUILD";
    return result;
  }
  const isValid = WebAssembly.validate(wasmBytes);
  result.VALIDATE = isValid ? "PASS" : "FAIL";
  if (!isValid) { result.firstFailedPhase = "VALIDATE"; result.observed = "WebAssembly.validate() returned false"; return result; }
  let instance: WebAssembly.Instance;
  try {
    const instantiated = await WebAssembly.instantiate(wasmBytes, hostStub.importObject);
    instance = instantiated.instance;
    hostStub.setMemoryRefs(instance);
    result.INSTANTIATE = "PASS";
  } catch (e) {
    result.INSTANTIATE = "FAIL";
    result.firstFailedPhase = "INSTANTIATE";
    result.observed = `WebAssembly.instantiate threw: ${(e as Error).message}`;
    return result;
  }
  try {
    const main = instance.exports.main as () => bigint | number;
    const returnValue = main();
    result.EXECUTE = "PASS";
    result.observed = {
      returnValue,
      printedInts: hostStub.printedInts.slice(),
      printedFloats: hostStub.printedFloats.slice(),
      printedStrings: hostStub.printedStrings.slice(),
      inputCallCount: hostStub.getInputCallCount(),
      freeCallCount: hostStub.getFreeCallCount(),
    };
    result.firstFailedPhase = null;
  } catch (e) {
    result.EXECUTE = "FAIL";
    result.firstFailedPhase = "EXECUTE";
    result.observed = `execution threw: ${(e as Error).message}`;
  }
  return result;
}
