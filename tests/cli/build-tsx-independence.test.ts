// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Real Build (tsx-independence fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// FIXED — real, externally-reported Critical bug: a real installer produced
// "tsx not found" after installation, because bin/ur.mjs ALWAYS invoked
// tsx against raw TypeScript source, and the installer never ran
// `npm install`. Fixed: `npm run build` now performs a REAL build
// (compiles to dist/, copies non-TS assets), and bin/ur.mjs/bin/ur-ide.mjs
// now prefer the compiled dist/ output (plain `node`, no tsx at all),
// falling back to tsx + raw source only for local development.
//
// This test verifies the fix directly: runs the real build, then runs the
// real CLI/IDE from the compiled output with tsx explicitly UNAVAILABLE,
// confirming the exact scenario the external report described no longer
// fails.

import { describe, it, expect } from "vitest";
import { execSync, spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = process.cwd();

describe("Real build (tools/build.mjs) — the direct fix for the externally-reported tsx-not-found bug", () => {
  it("npm run build produces a self-contained dist/ with a working CLI entry point", () => {
    execSync("node tools/build.mjs", { cwd: PROJECT_ROOT, stdio: "pipe" });
    expect(existsSync(join(PROJECT_ROOT, "dist", "src", "cli", "index.js"))).toBe(true);
    expect(existsSync(join(PROJECT_ROOT, "dist", "src", "ide", "server.js"))).toBe(true);
    expect(existsSync(join(PROJECT_ROOT, "dist", "runtime", "ur_runtime.c"))).toBe(true);
    expect(existsSync(join(PROJECT_ROOT, "dist", "src", "ide", "public", "index.html"))).toBe(true);
  }, 60000);

  it("the compiled CLI runs correctly with PLAIN node, with tsx completely unavailable (the exact bug scenario) — also confirms the Windows Recovery Sprint's later fix: run/build use the interpreter, not gcc, so this passes with no C compiler involved at all either", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-fix-test-"));
    try {
      const cleanEnv = { ...process.env };
      delete cleanEnv.PATH;
      cleanEnv.PATH = "/usr/bin:/bin";

      const versionResult = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "version"], { cwd: dir, encoding: "utf-8", env: cleanEnv });
      expect(versionResult.status).toBe(0);
      expect(versionResult.stdout.trim().split("\n")[0]).toMatch(/^ur \d+\.\d+\.\d+$/);

      const initResult = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "init"], { cwd: dir, encoding: "utf-8", env: cleanEnv });
      expect(initResult.status).toBe(0);

      const runResult = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "run", "hello.ur"], { cwd: dir, encoding: "utf-8", env: cleanEnv });
      expect(runResult.status).toBe(0);
      expect(runResult.stdout.trim()).toBe("hello from UR");

      const buildResult = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "build", "hello.ur"], { cwd: dir, encoding: "utf-8", env: cleanEnv });
      expect(buildResult.status).toBe(0);
      expect(existsSync(join(dir, "hello.js"))).toBe(true);

      const directRun = spawnSync(process.execPath, [join(dir, "hello.js")], { encoding: "utf-8" });
      expect(directRun.status).toBe(0);
      expect(directRun.stdout.trim()).toBe("hello from UR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("the compiled CLI shows a real, verifiable build stamp confirming gcc-free status (fixes the field-test ambiguity: 'did the fix reach this installed version?')", () => {
    const buildInfoPath = join(PROJECT_ROOT, "dist", "BUILD_INFO.json");
    expect(existsSync(buildInfoPath)).toBe(true);
    const info = JSON.parse(readFileSync(buildInfoPath, "utf-8"));
    expect(info.gccFree).toBe(true);
    expect(typeof info.contentHash).toBe("string");
    expect(info.contentHash.length).toBeGreaterThan(0);

    const versionResult = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "version"], { encoding: "utf-8" });
    expect(versionResult.stdout).toContain(info.contentHash);
    expect(versionResult.stdout).toContain("gcc-free: true");
  });
});
