import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ur = join(process.cwd(), "bin", "ur.mjs");

describe("stdin is read lazily", () => {
  it("program without input() exits while stdin remains open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-"));
    const file = join(dir, "main.ur");
    writeFileSync(file, "function main(): int\n  return 0\nend\n");

    const started = Date.now();

    const result = await new Promise<{ code: number | null; ms: number }>((resolve) => {
      const p = spawn(process.execPath, [ur, "run", file], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      p.on("close", code => resolve({
        code,
        ms: Date.now() - started,
      }));
    });

    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(6000);
  });

  it("input() still receives piped data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-"));
    const file = join(dir, "main.ur");

    writeFileSync(
      file,
      'function main(): int\n  let s = input()\n  print(s)\n  return 0\nend\n'
    );

    const output = await new Promise<string>((resolve) => {
      const p = spawn(process.execPath, [ur, "run", file], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      p.stdout.on("data", chunk => stdout += chunk);
      p.stdin.end("hello\n");
      p.on("close", () => resolve(stdout));
    });

    expect(output).toContain("hello");
  });
});
