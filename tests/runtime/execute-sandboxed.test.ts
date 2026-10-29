import { describe, it, expect } from "vitest";
import { executeSandboxed } from "../../src/sandbox/execute-sandboxed.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("executeSandboxed import gate", () => {
  it("rejects imports before execution", () => {
    const result = executeSandboxed(
      "import example\n",
      {
        policy: { allow: [] },
        timeoutMs: 1000,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("'import' is not permitted");
    expect(result.auditLog).toEqual([]);
  });
});

describe("executeSandboxed filesystem capability", () => {
  it("denies filesystem reads when no grant is provided", () => {
    const code = [
      "function sandbox_fs_read(path: string): string",
      '  return ""',
      "end",
      "function main(): int",
      '  let value = sandbox_fs_read("C:/sandbox-probe-nonexistent")',
      "  return 0",
      "end",
      "",
    ].join("\n");

    const result = executeSandboxed(code, {
      policy: { allow: [] },
      timeoutMs: 1000,
    });

    console.log("SANDBOX_PROBE", JSON.stringify({
      exitCode: result.exitCode,
      stderr: result.stderr,
      auditLog: result.auditLog,
    }));

    expect(result.exitCode).toBe(101);
    expect(result.stderr).toContain("CAPABILITY_DENIED");
    expect(result.auditLog).toHaveLength(1);
    expect(result.auditLog[0]).toMatchObject({
      capability: "filesystem",
      scope: "C:/sandbox-probe-nonexistent",
      decision: "deny",
    });
  });
});

describe("executeSandboxed filesystem path boundaries", () => {
  it("denies reads from a sibling directory sharing the granted path prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "ur-sandbox-prefix-"));
    const safeDir = join(root, "safe");
    const siblingDir = join(root, "safe-evil");
    const targetFile = join(siblingDir, "probe.txt");

    try {
      mkdirSync(safeDir);
      mkdirSync(siblingDir);
      writeFileSync(targetFile, "CONTROLLED_PREFIX_BYPASS_PROBE", "utf8");

      const scope = safeDir.replace(/\\/g, "/");
      const target = targetFile.replace(/\\/g, "/");

      const code = [
        "function sandbox_fs_read(path: string): string",
        '  return ""',
        "end",
        "function main(): int",
        `  let value = sandbox_fs_read("${target}")`,
        "  return 0",
        "end",
        "",
      ].join("\n");

      const result = executeSandboxed(code, {
        policy: {
          allow: [{ capability: "filesystem", scope }],
        },
        timeoutMs: 1000,
      });

      console.log("PATH_BOUNDARY_PROBE", JSON.stringify({
        exitCode: result.exitCode,
        stderr: result.stderr,
        auditLog: result.auditLog,
      }));

      expect(result.exitCode).toBe(101);
      expect(result.stderr).toContain("CAPABILITY_DENIED");
      expect(result.auditLog).toHaveLength(1);
      expect(result.auditLog[0]).toMatchObject({
        capability: "filesystem",
        decision: "deny",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("executeSandboxed filesystem allowed path", () => {
  it("allows reads from a file inside the granted directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ur-sandbox-allowed-"));
    const safeDir = join(root, "safe");
    const targetFile = join(safeDir, "probe.txt");

    try {
      mkdirSync(safeDir);
      writeFileSync(targetFile, "CONTROLLED_ALLOWED_READ_PROBE", "utf8");

      const scope = safeDir.replace(/\\/g, "/");
      const target = targetFile.replace(/\\/g, "/");

      const code = [
        "function sandbox_fs_read(path: string): string",
        '  return ""',
        "end",
        "function main(): int",
        `  let value = sandbox_fs_read("${target}")`,
        "  return 0",
        "end",
        "",
      ].join("\n");

      const result = executeSandboxed(code, {
        policy: {
          allow: [{ capability: "filesystem", scope }],
        },
        timeoutMs: 1000,
      });

      console.log("ALLOWED_PATH_PROBE", JSON.stringify({
        exitCode: result.exitCode,
        stderr: result.stderr,
        auditLog: result.auditLog,
      }));

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.auditLog).toHaveLength(1);
      expect(result.auditLog[0]).toMatchObject({
        capability: "filesystem",
        scope: target,
        decision: "allow",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});