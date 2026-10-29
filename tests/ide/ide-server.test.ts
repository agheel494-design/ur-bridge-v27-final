// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: IDE Backend Server (P0 priority, "minimal IDE" scope)
// ─────────────────────────────────────────────────────────────────────────────
//
// Real tests against a REAL, running HTTP server (spawned as a real
// subprocess, same discipline as the CLI tests) — not mocked. src/ide is
// excluded from strict tsc checking for the same disclosed @types/node
// reason as src/cli.
//
// Confirmed directly, end-to-end, before writing these tests: the server
// starts, serves the frontend HTML, and every API endpoint (new, open,
// save, run, build, terminal) works correctly, including returning
// structured diagnostics for a broken program and producing a real,
// independently-runnable executable via /api/build.

import { describe, it, expect } from "vitest";
import { spawn, spawnSync, execSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const SERVER_ENTRY = join(process.cwd(), "src/ide/server.ts");
// W-1 (RB-2): never spawn node_modules/.bin/tsx.cmd, which Node.js refuses to spawn without a shell on Windows
// (spawn EINVAL). Fix-HA (H-a): the server is ONE process — the current node with tsx's loader registered through
// --import — not the tsx CLI, which runs the server as a second (child) process that kill() does not reach on Windows
// (Windows run W1FIX-WIN, 2026-10-12: EPERM removing the temporary directory in all 9 tests). With a single process,
// stopServerThenRemoveDir (Fix-W2) can confirm that the server itself has exited before the directory is removed.
const TSX_LOADER_URL = pathToFileURL(join(process.cwd(), "node_modules", "tsx", "dist", "loader.mjs")).href;
const PROJECT_ROOT = process.cwd();

async function withServer<T>(fn: (baseUrl: string, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ur-ide-test-"));
  const port = 4300 + Math.floor(Math.random() * 500);
  const proc = spawn(process.execPath, ["--import", TSX_LOADER_URL, SERVER_ENTRY], {
    cwd: dir,
    env: { ...process.env, UR_IDE_PORT: String(port) },
    stdio: "pipe",
  });
  let bodyFailed = false;
  try {
    const baseUrl = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(baseUrl + "/");
        break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    return await fn(baseUrl, dir);
  } catch (e) {
    bodyFailed = true;
    throw e;
  } finally {
    await stopServerThenRemoveDir(proc, dir, bodyFailed);
  }
}

// Runs the REAL, compiled dist/src/ide/server.js (via plain node) rather
// than the raw src/ide/server.ts (via tsx) — needed specifically for the
// build test below: the generated bundle embeds an interpreter path
// relative to wherever the server itself is running from, and under raw
// tsx-on-source that resolves to a .ts file with no compiled .js
// counterpart. A real user's IDE always runs the compiled dist/ version
// (via bin/ur-ide.mjs), so this is also the more realistic test.
async function withCompiledServer<T>(fn: (baseUrl: string, dir: string) => Promise<T>): Promise<T> {
  execSync("node tools/build.mjs", { cwd: PROJECT_ROOT, stdio: "pipe" });
  const compiledEntry = join(PROJECT_ROOT, "dist", "src", "ide", "server.js");
  const dir = mkdtempSync(join(tmpdir(), "ur-ide-compiled-test-"));
  const port = 4900 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, [compiledEntry], {
    cwd: dir,
    env: { ...process.env, UR_IDE_PORT: String(port) },
    stdio: "pipe",
  });
  let bodyFailed = false;
  try {
    const baseUrl = `http://localhost:${port}`;
    for (let i = 0; i < 50; i++) {
      try { await fetch(baseUrl + "/"); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    return await fn(baseUrl, dir);
  } catch (e) {
    bodyFailed = true;
    throw e;
  } finally {
    await stopServerThenRemoveDir(proc, dir, bodyFailed);
  }
}

// Fix-W2 (PM-W2-001; first authorized under PM-B1-NEXT-005). On Windows a directory cannot be removed while a
// running process still uses it as its working directory. Reproduced on Windows: EPERM from rmSync immediately
// after kill() in this very helper (R-2/R-3, 2026-10-09), and in isolation (EPERM-PROBE, 2026-10-10: immediate
// removal fails, removal after the 'exit' event succeeds). The server is therefore stopped and its exit CONFIRMED
// (the 'exit' event) before the directory is removed. The wait is bounded; there is no fixed delay:
//  - a process that has already exited (exitCode/signalCode set) is not waited for, and is not killed again;
//  - otherwise the 'exit' listener is registered BEFORE kill(), so an exit cannot be missed;
//  - if the process does not exit within the timeout, the helper fails with an explicit error and leaves the
//    directory in place (its path is in the message);
//  - if the removal itself fails, that error is reported with the path.
// When the test body has already failed, a cleanup failure is logged (console.error) and the body's own error is
// the one reported, so the original failure is never masked. `opts` exists only so the helper can be tested
// below (timeout length, removal function); the server teardown uses the defaults.
const SERVER_EXIT_TIMEOUT_MS = 10000;
async function stopServerThenRemoveDir(
  proc: ChildProcess, dir: string, bodyFailed: boolean,
  opts: { timeoutMs?: number; remove?: (d: string) => void } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? SERVER_EXIT_TIMEOUT_MS;
  const remove = opts.remove ?? ((d: string) => rmSync(d, { recursive: true, force: true }));
  let cleanupError: Error | undefined;
  const alreadyExited = proc.exitCode !== null || proc.signalCode !== null;
  const exited = alreadyExited
    ? Promise.resolve(true)
    : new Promise<boolean>(resolveExit => {
        const timer = setTimeout(() => resolveExit(false), timeoutMs);
        proc.once("exit", () => { clearTimeout(timer); resolveExit(true); });
      });
  if (!alreadyExited) proc.kill();
  if (!(await exited)) {
    cleanupError = new Error(`IDE test server (pid ${proc.pid}) did not exit within ${timeoutMs} ms after kill(); temporary directory NOT removed: ${dir}`);
  } else {
    try {
      remove(dir);
    } catch (e) {
      cleanupError = new Error(`removing the temporary directory failed after the server had exited: ${dir}: ${(e as Error).message}`);
    }
  }
  if (cleanupError) {
    console.error(`[ide-server.test cleanup] ${cleanupError.message}`);
    if (!bodyFailed) throw cleanupError;
  }
}

// Tests of the Fix-W2 teardown itself (portable: no platform-specific behaviour is needed to reach any branch).
describe("Fix-W2 — server teardown (stopServerThenRemoveDir)", () => {
  // A real child process whose working directory is the temporary directory, as in withCompiledServer.
  const holder = (cwd: string) => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
  // A stand-in process handle that never exits (kill() has no effect): reaches the timeout branch on every platform.
  const neverExits = () => Object.assign(new EventEmitter(), { pid: -1, exitCode: null, signalCode: null, kill: () => true }) as unknown as ChildProcess;
  // Every teardown call is bounded by the test itself: a helper that never settles fails here with an explicit
  // message, independently of the runner's own per-test timeout.
  const settleWithin = <T,>(p: Promise<T>, ms: number) => new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`teardown helper did not settle within ${ms} ms`)), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
  const captureConsoleError = async (f: () => Promise<void>): Promise<string[]> => {
    const lines: string[] = []; const orig = console.error;
    console.error = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
    try { await f(); } finally { console.error = orig; }
    return lines;
  };

  it("kills a process that holds the directory, waits for its exit, then removes the directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-w2-teardown-"));
    const proc = holder(dir);
    await new Promise(r => setTimeout(r, 300));
    expect(proc.exitCode === null && proc.signalCode === null).toBe(true);
    await settleWithin(stopServerThenRemoveDir(proc, dir, false), 12000);
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
    expect(existsSync(dir)).toBe(false);
  }, 15000);

  it("a process that has already exited is not waited for and not killed again; the directory is removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-w2-teardown-"));
    const proc = spawn(process.execPath, ["-e", ""], { cwd: dir, stdio: "ignore" });
    await new Promise<void>(r => proc.once("exit", () => r()));
    let killed = false; const realKill = proc.kill.bind(proc);
    proc.kill = ((s?: NodeJS.Signals | number) => { killed = true; return realKill(s); }) as typeof proc.kill;
    const t0 = Date.now();
    await settleWithin(stopServerThenRemoveDir(proc, dir, false, { timeoutMs: 5000 }), 8000);
    expect(killed).toBe(false);
    expect(Date.now() - t0 < 5000).toBe(true);
    expect(existsSync(dir)).toBe(false);
  }, 15000);

  it("a process that does not exit: explicit error after the timeout, directory NOT removed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-w2-teardown-"));
    let msg = "";
    const lines = await captureConsoleError(async () => {
      try { await settleWithin(stopServerThenRemoveDir(neverExits(), dir, false, { timeoutMs: 300 }), 5000); } catch (e) { msg = (e as Error).message; }
    });
    expect(msg).toContain("did not exit within 300 ms");
    expect(msg).toContain(dir);
    expect(existsSync(dir)).toBe(true);
    expect(lines.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  }, 15000);

  it("removal fails after the process exited: the error is reported with the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-w2-teardown-"));
    const proc = holder(dir);
    await new Promise(r => setTimeout(r, 300));
    let msg = "";
    await captureConsoleError(async () => {
      try {
        await settleWithin(stopServerThenRemoveDir(proc, dir, false, { remove: () => { throw new Error("injected removal failure"); } }), 12000);
      } catch (e) { msg = (e as Error).message; }
    });
    expect(msg).toContain("removing the temporary directory failed after the server had exited");
    expect(msg).toContain("injected removal failure");
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 15000);

  it("when the test body already failed, a cleanup failure is logged but not thrown (the body's error stays the reported one)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-w2-teardown-"));
    let threw = false;
    const lines = await captureConsoleError(async () => {
      try { await settleWithin(stopServerThenRemoveDir(neverExits(), dir, true, { timeoutMs: 300 }), 5000); } catch { threw = true; }
    });
    expect(threw).toBe(false);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("did not exit within 300 ms");
    rmSync(dir, { recursive: true, force: true });
  }, 15000);
});

describe("IDE server — serves the frontend", () => {
  it("GET / returns the HTML page with the Monaco editor and expected UI elements", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(baseUrl + "/");
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain("monaco-editor");
      expect(html).toContain("btn-run");
      expect(html).toContain("btn-build");
      expect(html).toContain("terminal");
    });
  }, 15000);
});

describe("IDE server — file operations", () => {
  it("POST /api/new creates a real starter file on disk", async () => {
    await withServer(async (baseUrl, dir) => {
      const r = await fetch(baseUrl + "/api/new", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "hello.ur" }),
      });
      const body = await r.json();
      expect(body.content).toContain("function main");
      expect(existsSync(join(dir, "hello.ur"))).toBe(true);
    });
  }, 15000);

  it("POST /api/new refuses to overwrite an existing file", async () => {
    await withServer(async (baseUrl) => {
      await fetch(baseUrl + "/api/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "x.ur" }) });
      const r2 = await fetch(baseUrl + "/api/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "x.ur" }) });
      expect(r2.status).toBe(409);
    });
  }, 15000);

  it("POST /api/save writes real content, GET /api/open reads it back correctly", async () => {
    await withServer(async (baseUrl, dir) => {
      const content = "function main(): int\n  return 42\nend\n";
      await fetch(baseUrl + "/api/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "x.ur", content }) });
      expect(readFileSync(join(dir, "x.ur"), "utf-8")).toBe(content);
      const r = await fetch(baseUrl + "/api/open?path=x.ur");
      const body = await r.json();
      expect(body.content).toBe(content);
    });
  }, 15000);

  it("GET /api/open on a nonexistent file returns 404", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(baseUrl + "/api/open?path=nope.ur");
      expect(r.status).toBe(404);
    });
  }, 15000);
});

describe("IDE server — run (the core, real-time feedback loop)", () => {
  it("running a correct program returns real stdout and exit code 0", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(baseUrl + "/api/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "hello.ur", content: 'function main(): int\n  print("hello from UR")\n  return 0\nend\n' }),
      });
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(body.stdout.trim()).toBe("hello from UR");
      expect(body.exitCode).toBe(0);
    });
  }, 15000);

  it("running a broken program returns structured diagnostics, not a crash", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(baseUrl + "/api/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "broken.ur", content: 'function main(): int\n  let x: int = "wrong"\n  return 0\nend\n' }),
      });
      const body = await r.json();
      expect(body.ok).toBe(false);
      expect(body.diagnostics).toHaveLength(1);
      expect(body.diagnostics[0].code).toBe("TY2002");
      expect(body.diagnostics[0].line).toBe(2);
    });
  }, 15000);
});

describe("IDE server — build (produces a real, independently-runnable executable)", () => {
  it("building a correct program produces a self-contained, gcc-free .js file that runs correctly on its own via node (Windows Recovery Sprint fix)", async () => {
    await withCompiledServer(async (baseUrl, dir) => {
      const r = await fetch(baseUrl + "/api/build", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "hello.ur", content: 'function main(): int\n  print("built via IDE")\n  return 0\nend\n' }),
      });
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(existsSync(join(dir, "hello.js"))).toBe(true);
      const direct = spawnSync("node", [join(dir, "hello.js")], { encoding: "utf-8" });
      expect(direct.status).toBe(0);
      expect(direct.stdout.trim()).toBe("built via IDE");
    });
  }, 30000);
});

describe("IDE server — terminal (minimal, non-interactive command execution)", () => {
  it("executes a real shell command and returns its actual output", async () => {
    await withServer(async (baseUrl) => {
      const r = await fetch(baseUrl + "/api/terminal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "echo real_terminal_output" }),
      });
      const body = await r.json();
      expect(body.stdout.trim()).toBe("real_terminal_output");
      expect(body.exitCode).toBe(0);
    });
  }, 15000);
});
