import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, CLI_PATH, ...args], { cwd, encoding: "utf-8" });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
  }
}

describe("Phase 0-A E2E: real CLI import resolution", () => {
  it("a real UR program importing a local module runs correctly via the real 'ur run' CLI entry point (English)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-e2e-"));
    try {
      mkdirSync(join(dir, "ur_packages", "geo"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "geo", "index.ur"), "function hello(): int\n  print(42)\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import geo\n\nfunction main(): int\n  hello()\n  return 0\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("42");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("the exact Arabic example works via the real CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-e2e-ar-"));
    try {
      mkdirSync(join(dir, "ur_packages", "geo"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "geo", "index.ur"), "دالة اختبار(): عدد\n  أرجع 99\nنهاية\n");
      writeFileSync(join(dir, "test.ur"), "استورد geo\n\nدالة main(): عدد\n  أرجع اختبار()\nنهاية\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(99);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a missing imported module produces a clear, real CLI error (not a crash)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-e2e-missing-"));
    try {
      writeFileSync(join(dir, "test.ur"), "import doesnotexist\n\nfunction main(): int\n  return 0\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("doesnotexist");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("KNOWN, DISCLOSED SCOPE BOUNDARY: nested import is explicitly rejected", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-e2e-nested-"));
    try {
      mkdirSync(join(dir, "ur_packages", "a"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "b"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "b", "index.ur"), "function bFn(): int\n  return 1\nend\n");
      writeFileSync(join(dir, "ur_packages", "a", "index.ur"), "import b\n\nfunction aFn(): int\n  return 2\nend\n");
      writeFileSync(join(dir, "test.ur"), "import a\n\nfunction main(): int\n  return aFn()\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("nested");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("importing the same module twice or three times succeeds (deduplicated)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-dup-"));
    try {
      mkdirSync(join(dir, "ur_packages", "a"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "a", "index.ur"), "function aVal(): int\n  return 10\nend\n");
      writeFileSync(join(dir, "test.ur"), "import a\nimport a\nimport a\n\nfunction main(): int\n  return aVal()\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(10);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("different import order still produces correct results", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cli-order-"));
    try {
      mkdirSync(join(dir, "ur_packages", "a"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "b"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "a", "index.ur"), "function aVal(): int\n  return 1\nend\n");
      writeFileSync(join(dir, "ur_packages", "b", "index.ur"), "function bVal(): int\n  return 2\nend\n");
      writeFileSync(join(dir, "test.ur"), "import b\nimport a\n\nfunction main(): int\n  return aVal() + bVal()\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
