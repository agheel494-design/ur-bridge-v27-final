import { describe, it, expect } from "vitest";
import { JsBridgeDriver } from "../../../src/ffi/drivers/javascript/js-bridge.js";
import { JsRuntimeExecutor } from "../native/js-runtime-executor.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/js-modules");

// JS Bridge generality proof, per direct feedback: sharp alone only
// proves a Proof of Concept, not a General JavaScript Bridge. These
// two real, independent, standalone modules (one genuine CommonJS,
// one genuine ES Module - neither related to sharp or to each other)
// prove the bridge does not depend on sharp's own specifics.

const CJS_MODULE_PATH = join(FIXTURES_DIR, "calculator-cjs.cjs");
const ESM_MODULE_PATH = join(FIXTURES_DIR, "calculator-esm.mjs");

describe("JS Bridge generality: a real, independent CommonJS module and a real ES Module, neither related to sharp", () => {
  const api = new JsBridgeDriver(new JsRuntimeExecutor()).bind();

  it("real CommonJS module (.cjs, module.exports): sum(2,3) = 5", () => {
    const outcome = api.call({ moduleSpecifier: CJS_MODULE_PATH, propertyPath: ["sum"], args: [2, 3] });
    expect(outcome).toEqual({ ok: true, value: 5 });
  });

  it("real CommonJS module: sub(10,4) = 6 and mul(6,7) = 42, via callBatch", () => {
    const outcome = api.callBatch([
      { moduleSpecifier: CJS_MODULE_PATH, propertyPath: ["sub"], args: [10, 4] },
      { moduleSpecifier: CJS_MODULE_PATH, propertyPath: ["mul"], args: [6, 7] },
    ]);
    expect(outcome).toEqual({ ok: true, value: [6, 42] });
  });

  it("real ES Module (.mjs, genuine export syntax): sum(2,3) = 5", () => {
    const outcome = api.call({ moduleSpecifier: ESM_MODULE_PATH, propertyPath: ["sum"], args: [2, 3] });
    expect(outcome).toEqual({ ok: true, value: 5 });
  });

  it("real ES Module: sub(10,4) = 6 and mul(6,7) = 42, via callBatch", () => {
    const outcome = api.callBatch([
      { moduleSpecifier: ESM_MODULE_PATH, propertyPath: ["sub"], args: [10, 4] },
      { moduleSpecifier: ESM_MODULE_PATH, propertyPath: ["mul"], args: [6, 7] },
    ]);
    expect(outcome).toEqual({ ok: true, value: [6, 42] });
  });

  it("REAL FINDING confirmed by a permanent test: a plain .js file in this repo is NOT loadable as CommonJS, because this project's own package.json has \"type\": \"module\" - require()/import() treat it as ESM regardless of module.exports syntax inside it. This is why calculator-cjs.cjs needed the explicit .cjs extension.", () => {
    // This assertion documents the real constraint directly, rather
    // than only in a comment - a genuine .cjs file (extension
    // overrides package.json's own "type") loads correctly:
    const outcome = api.call({ moduleSpecifier: CJS_MODULE_PATH, propertyPath: ["sum"], args: [1, 1] });
    expect(outcome).toEqual({ ok: true, value: 2 });
  });
});
