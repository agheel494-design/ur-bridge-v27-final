import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { JsBridgeDriver } from "../../../src/ffi/drivers/javascript/js-bridge.js";
import { JsRuntimeExecutor } from "../native/js-runtime-executor.js";

// JavaScript Bridge (Runtime Bridge) — real, full-chain proof:
// UR -> JS Bridge -> Node Runtime -> require("sharp") -> a real
// function call -> the result returned to UR. Not just "Node runs" -
// this proves the bridge's own real mechanism (spawning a genuine
// Node child process, doing a real require() + call inside it, and
// parsing real JSON results back) actually works end-to-end.
//
// sharp is a real, pre-existing, widely-used production library
// (confirmed already installed in this environment) - not a
// synthetic example. sharp.format/sharp.cache() are used because
// they are genuinely SYNCHRONOUS (Async remains a Bridge Extension,
// not implemented in this Core API round).

// RB3-TEST-INFRA-FIX: 'sharp' is an OPTIONAL external library (not a project dependency). Resolve it
// portably; if it is not installed on this host the suite is SKIPPED with an explicit reason (never a
// false failure, never a silent pass).
let SHARP_MODULE_PATH = "";
try { SHARP_MODULE_PATH = createRequire(import.meta.url).resolve("sharp"); } catch { /* not installed */ }
if (!SHARP_MODULE_PATH) console.warn("[js-bridge-sharp] SKIPPED: optional library 'sharp' is not installed on this host (not a project dependency)");
const describeIfSharp = SHARP_MODULE_PATH ? describe : describe.skip;

describeIfSharp("JS Bridge (Runtime Bridge) - real full chain to require('sharp'), no simulation", () => {
  const api = new JsBridgeDriver(new JsRuntimeExecutor()).bind();

  it("real property read: sharp.format returns the real, full set of supported image formats from the actual library", () => {
    const outcome = api.call({ moduleSpecifier: SHARP_MODULE_PATH, propertyPath: ["format"], args: [] });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const formats = outcome.value as Record<string, unknown>;
      expect(formats).toHaveProperty("jpeg");
      expect(formats).toHaveProperty("png");
      expect(formats).toHaveProperty("webp");
    }
  });

  it("real function call: sharp.cache(false) genuinely disables sharp's own real cache and returns its real prior stats object", () => {
    const outcome = api.call({ moduleSpecifier: SHARP_MODULE_PATH, propertyPath: ["cache"], args: [false] });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const stats = outcome.value as Record<string, unknown>;
      expect(stats).toHaveProperty("memory");
      expect(stats).toHaveProperty("items");
    }
  });

  it("callBatch(): two real calls to the real library in one real Node process invocation", () => {
    const outcome = api.callBatch([
      { moduleSpecifier: SHARP_MODULE_PATH, propertyPath: ["format"], args: [] },
      { moduleSpecifier: SHARP_MODULE_PATH, propertyPath: ["cache"], args: [] },
    ]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.length).toBe(2);
  });

  it("real error handling: requiring a genuinely nonexistent module surfaces the real Node error message via { ok: false }, not a crash", () => {
    const outcome = api.call({ moduleSpecifier: "definitely_not_a_real_module_xyz", propertyPath: [], args: [] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Cannot find package");
  });
});
