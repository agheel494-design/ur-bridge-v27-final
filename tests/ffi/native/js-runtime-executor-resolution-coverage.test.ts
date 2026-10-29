import { describe, it, expect } from "vitest";
import { JsBridgeDriver } from "../../../src/ffi/drivers/javascript/js-bridge.js";
import { JsRuntimeExecutor } from "./js-runtime-executor.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

// Comprehensive Module Resolution coverage, per direct independent
// review request: confirms the fix does NOT break bare specifiers,
// relative paths, or absolute paths, and does NOT change Node's own
// standard error behavior for a genuinely missing module.

describe("JS Bridge Module Resolution: bare specifiers, relative paths, absolute paths, and Node's own real error behavior all still work correctly", () => {
  const api = new JsBridgeDriver(new JsRuntimeExecutor()).bind();

  it("Bare Specifier: a real Node built-in module (os) resolves via Node's own node_modules/builtin resolution, unmodified", () => {
    const outcome = api.call({ moduleSpecifier: "os", propertyPath: ["platform"], args: [] });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(["linux", "win32", "darwin"]).toContain(outcome.value);
  });

  it("Absolute Path: a real absolute file path resolves correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-modres-abs-"));
    try {
      const modPath = join(dir, "mod.cjs");
      writeFileSync(modPath, "module.exports.f = (x) => x * 2;\n");
      const outcome = api.call({ moduleSpecifier: modPath, propertyPath: ["f"], args: [21] });
      expect(outcome).toEqual({ ok: true, value: 42 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // P0 D-A3 (PM decision 2026-10-18): process.chdir() is not available in
  // Vitest worker threads, and the runner settings are not changed. Instead
  // the temporary directory is created INSIDE the real process.cwd(), so a
  // relative specifier still exercises resolution against the caller's real
  // process.cwd(). The directory is removed in finally; a leftover
  // ".ur-modres-rel-*" directory is visible to the after-run identity check.
  it("Relative Path: resolves relative to the REAL caller's own process.cwd(), not the temp script's own location", () => {
    const dir = mkdtempSync(join(process.cwd(), ".ur-modres-rel-"));
    try {
      writeFileSync(join(dir, "mod.cjs"), "module.exports.f = (x) => x * 2;\n");
      const outcome = api.call({ moduleSpecifier: `./${basename(dir)}/mod.cjs`, propertyPath: ["f"], args: [10] });
      expect(outcome).toEqual({ ok: true, value: 20 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("Relative Path (negative): a relative specifier is NOT resolved against the module's own directory - './mod.cjs' fails when mod.cjs exists only inside a sub-directory of process.cwd()", () => {
    const dir = mkdtempSync(join(process.cwd(), ".ur-modres-rel-"));
    try {
      writeFileSync(join(dir, "mod.cjs"), "module.exports.f = (x) => x * 2;\n");
      expect(existsSync(join(process.cwd(), "mod.cjs")), "precondition: no mod.cjs directly in process.cwd()").toBe(false);
      const outcome = api.call({ moduleSpecifier: "./mod.cjs", propertyPath: ["f"], args: [10] });
      expect(outcome.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("Genuinely missing bare package: Node's OWN real, unmodified error message surfaces (not a custom/altered message, not a crash)", () => {
    const outcome = api.call({ moduleSpecifier: "definitely_does_not_exist_xyz123", propertyPath: [], args: [] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("Cannot find package");
  });
});
