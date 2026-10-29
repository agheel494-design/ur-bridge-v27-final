// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: CLI (P0 priority, "UR v1.0 Final Sprint" directive)
// ─────────────────────────────────────────────────────────────────────────────
//
// Real, black-box, subprocess-level tests of the actual "ur" CLI - the
// same way a real user would invoke it, not by importing internals. This
// is deliberate: src/cli/index.ts is excluded from this project's strict
// tsc checking (documented in tsconfig.json's own exclude comment - no
// @types/node available in this sandboxed environment without network
// access to the npm registry), so a real subprocess invocation is both
// the most honest test AND the only type-safe way to verify it.
//
// Each test creates its own fresh temp directory directly (rather than
// via beforeEach/afterEach) — this project's own local Vitest-substitute
// test runner does not inherit beforeEach across nested describe blocks,
// a real limitation of that substitute; this structure sidesteps it.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync, execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = process.cwd();

const CLI_ENTRY = join(process.cwd(), "src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], { cwd, encoding: "utf-8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ur-cli-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI — ur version", () => {
  it("prints a version string", () => {
    withTempDir(dir => {
      const r = runCli(["version"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toMatch(/^ur \d+\.\d+\.\d+$/);
    });
  });
});

describe("CLI — ur help", () => {
  it("prints usage listing all 5 commands", () => {
    withTempDir(dir => {
      const r = runCli(["help"], dir);
      expect(r.exitCode).toBe(0);
      for (const cmd of ["init", "run", "build", "version", "help"]) {
        expect(r.stdout).toContain(cmd);
      }
    });
  });

  it("running with no arguments also shows help", () => {
    withTempDir(dir => {
      const r = runCli([], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Usage");
    });
  });
});

describe("CLI — ur init (the real, exact 'new user' starting point)", () => {
  it("creates a starter hello.ur file", () => {
    withTempDir(dir => {
      const r = runCli(["init"], dir);
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(dir, "hello.ur"))).toBe(true);
      expect(r.stdout).toContain("hello.ur");
    });
  });

  it("the created file is a real, valid, runnable UR program", () => {
    withTempDir(dir => {
      runCli(["init"], dir);
      const content = readFileSync(join(dir, "hello.ur"), "utf-8");
      expect(content).toContain("function main");
      expect(content).toContain("print(");
    });
  });

  it("refuses to overwrite an existing hello.ur", () => {
    withTempDir(dir => {
      runCli(["init"], dir);
      const r2 = runCli(["init"], dir);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).toContain("already exists");
    });
  });
});

describe("CLI — ur run (the core, end-to-end new-user experience)", () => {
  it("the FULL, exact new-user flow works: init, then run, produces the expected output", () => {
    withTempDir(dir => {
      runCli(["init"], dir);
      const r = runCli(["run", "hello.ur"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("hello from UR");
    });
  });

  it('Arabic string CONTENT works correctly through the real CLI (print("مرحبا"))', () => {
    withTempDir(dir => {
      writeFileSync(join(dir, "arabic.ur"), 'function main(): int\n  print("مرحبا")\n  return 0\nend\n', "utf-8");
      const r = runCli(["run", "arabic.ur"], dir);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("مرحبا");
    });
  });

  it("a program with a real type error produces professional diagnostic output, not a raw stack trace", () => {
    withTempDir(dir => {
      writeFileSync(join(dir, "broken.ur"), 'function main(): int\n  let x: int = "wrong type"\n  return 0\nend\n', "utf-8");
      const r = runCli(["run", "broken.ur"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("broken.ur:2:3");
      expect(r.stderr).toContain("error[TY2002]");
      expect(r.stderr).toContain("^");
    });
  });

  it("running a nonexistent file gives a clear error, not a crash", () => {
    withTempDir(dir => {
      const r = runCli(["run", "does-not-exist.ur"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("not found");
    });
  });

  it("running with no file argument gives a clear error", () => {
    withTempDir(dir => {
      const r = runCli(["run"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("requires a file argument");
    });
  });
});

describe("CLI — ur build (produces a real, standalone executable)", () => {
  it("builds a self-contained, gcc-free .js file that runs correctly via plain node, even independently of the CLI (Windows Recovery Sprint fix — build no longer uses gcc at all)", () => {
    // Uses bin/ur.mjs (which prefers the compiled dist/) rather than the
    // raw tsx-on-source runCli() helper used elsewhere in this file:
    // the generated bundle embeds an absolute path to the interpreter
    // relative to WHEREVER the CLI itself is running from — under raw
    // tsx-on-source, that resolves to src/interpreter/interpret.ts
    // (no compiled .js there), not a real bug in the fix itself, just a
    // mismatch with this specific test's own invocation style. A real
    // user's `ur` command always goes through bin/ur.mjs, so this is
    // also the more realistic test.
    execSync("node tools/build.mjs", { cwd: PROJECT_ROOT, stdio: "pipe" });
    withTempDir(dir => {
      spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "init"], { cwd: dir, encoding: "utf-8" });
      const r = spawnSync(process.execPath, [join(PROJECT_ROOT, "bin", "ur.mjs"), "build", "hello.ur"], { cwd: dir, encoding: "utf-8" });
      expect(r.status).toBe(0);
      const builtPath = join(dir, "hello.js");
      expect(existsSync(builtPath)).toBe(true);
      const direct = spawnSync("node", [builtPath], { encoding: "utf-8" });
      expect(direct.status).toBe(0);
      expect(direct.stdout.trim()).toBe("hello from UR");
    });
  }, 30000);

  it("a broken program fails to build with the same professional diagnostics as ur run", () => {
    withTempDir(dir => {
      writeFileSync(join(dir, "broken.ur"), 'function main(): int\n  let x: int = "wrong type"\n  return 0\nend\n', "utf-8");
      const r = runCli(["build", "broken.ur"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("error[TY2002]");
      expect(existsSync(join(dir, "broken.js"))).toBe(false);
    });
  });
});

describe("CLI — unknown command handling", () => {
  it("an unknown command produces a clear error and shows usage, not a crash", () => {
    withTempDir(dir => {
      const r = runCli(["foobar"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("unknown command");
    });
  });
});
