// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — IR Interpreter (Windows Recovery Sprint, Priority 4 — Option 2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per explicit direction: bundling a real GCC/MinGW toolchain is not
// achievable from this development environment (no network access, no
// Windows test environment - see WINDOWS_GCC_BUNDLING_STATUS.md), and
// "install GCC/MinGW yourself" is explicitly REJECTED as an acceptable
// answer for a v1.0 end user. This file is the accepted alternative
// (Option 2): a real interpreter for the compiler's own IR, executing UR
// programs directly in Node.js - ZERO dependency on gcc or any external
// toolchain. `ur run` now uses this by default; Node.js itself remains
// the only prerequisite.
//
// Scope: implements every IR instruction/terminator kind that exists
// (param, const, binop, unop, call, load, store, array_load,
// array_store; return, return_void, branch, cond_branch) - the WHOLE
// instruction set, so any UR program that lowers successfully to IR runs
// correctly here too. FFI/native-library calls are NOT interpretable
// this way (need a real, linked native library) - calling one produces
// a clear, immediate error rather than a silent wrong result.

import type {
  IRModule, IRFunction, IRBasicBlock, IRInstruction, IRTerminator,
} from "../shared/ir.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, rmdirSync, accessSync, constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, posix, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── FRI R1 (V1.0-FRI-REMEDIATION-GATE, D1-b): dedicated result channel ───
// The foreign function's return value no longer travels on stdout. Each
// adapter writes ONE typed JSON envelope {"t": <type>, "v": <value>} to the
// file named by UR_FRI_RESULT_PATH; the foreign process's own stdout is
// treated as diagnostics only (appended to UR's stderr), never as the
// result. Decoding is strict against the declared UR return type: any
// mismatch, missing envelope, or malformed envelope is a UrPanic — there is
// no silent fallback value anywhere on this path.
const PY_RESULT_WRITER = [
  "import os as __ur_os",
  "def __ur_enc(r):",
  "    if isinstance(r, bool): return {'t': 'bool', 'v': r}",
  "    if isinstance(r, int): return {'t': 'int', 'v': str(r)}",
  "    if isinstance(r, float): return {'t': 'float', 'v': repr(r)}",
  "    if isinstance(r, str): return {'t': 'string', 'v': r}",
  "    if r is None: return {'t': 'null'}",
  "    return {'t': 'other', 'v': repr(r)}",
  "with open(__ur_os.environ['UR_FRI_RESULT_PATH'], 'w', encoding='utf-8') as __ur_f: json.dump(__ur_enc(__r), __ur_f)",
].join("\n");
const JS_RESULT_WRITER = `const __ur_enc = (r) => typeof r === "boolean" ? { t: "bool", v: r } : typeof r === "bigint" ? { t: "int", v: r.toString() } : typeof r === "number" ? (Number.isSafeInteger(r) ? { t: "int", v: String(r) } : { t: "float", v: String(r) }) : typeof r === "string" ? { t: "string", v: r } : (r === null || r === undefined) ? { t: "null" } : { t: "other", v: String(JSON.stringify(r)) }; require("fs").writeFileSync(process.env.UR_FRI_RESULT_PATH, JSON.stringify(__ur_enc(__r)));`;

// ─── FRI R2 (V1.0-FRI-REMEDIATION-GATE): containment + timeout contract ───
// Binding contract (PM, R2 closure directive): FRI requires FULL process
// containment. If it cannot be established, the call is rejected with
// FRI_CONTAINMENT_UNAVAILABLE BEFORE any foreign runtime or toolchain starts.
// There is no fallback to weaker containment.
//   Linux  : one cgroup v2 per FRI step, created by UR itself (friPrepareContainment).
//            A launcher shell joins it, VERIFIES its own membership, and only
//            then execs the foreign command. cgroup.kill ends every member,
//            including processes that left the session / process group.
//   Windows: src/native/ur-fri-jobrun.exe (Job Object, KILL_ON_JOB_CLOSE,
//            CREATE_SUSPENDED → assign → verify → resume). Missing helper ⇒
//            FRI_CONTAINMENT_UNAVAILABLE.
//   Other platforms: FRI_CONTAINMENT_UNAVAILABLE.
// FRI error taxonomy (UrPanic message prefix = machine-checkable code):
//   FRI_CONTAINMENT_UNAVAILABLE · FRI_SPAWN_FAILED · FRI_RUNTIME_NOT_FOUND · FRI_COMPILE_TIMEOUT ·
//   FRI_TIMEOUT · FRI_OUTPUT_LIMIT · FRI_SIGNAL · FRI_COMPILE_FAILED · FRI_FAILED · FRI_CLEANUP_FAILED ·
//   FRI_UNSUPPORTED_ARGUMENT (GATE-026 D4: nativeptr argument; raised before any foreign process starts)
//   FRI_INVALID_MANIFEST_IDENTIFIER (GATE-026 D5: symbol/module/native-path validation; raised before any foreign process starts)
// Lifecycle: timeout / output limit / non-zero exit / signal / supervisor
// death ⇒ the whole tree is killed. A SUCCESSFUL call kills nothing (OPEN-3):
// remaining members are released back to UR's own cgroup. Every cleanup
// failure is reported (FRI_CLEANUP_FAILED) - nothing is swallowed.
export const FRI_DEFAULT_RUN_MS = 30_000;
export const FRI_DEFAULT_COMPILE_MS = 60_000;
export const FRI_MIN_TIMEOUT_MS = 1_000;
export const FRI_MAX_TIMEOUT_MS = 600_000;
const FRI_MAX_BUFFER = 16 * 1024 * 1024;
const FRI_SUPERVISOR_GRACE_MS = 10_000;
const FRI_SUPERVISOR = String.raw`
const fs = require("fs"), cp = require("child_process"), path = require("path");
const spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const win = process.platform === "win32";
let child, kind = null, done = false, timer, outN = 0, errN = 0;
const out = [], err = [], notes = [];
function killTree() {
  if (spec.containment.kind === "cgroup") {
    try { fs.writeFileSync(path.join(spec.containment.dir, "cgroup.kill"), "1"); }
    catch (e) { if (e.code !== "ENOENT") notes.push("cgroup.kill failed: " + (e.code || e.message)); }
    if (child && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") notes.push("process-group kill failed: " + (e.code || e.message)); } }
  } else if (child && child.pid) {
    // Windows: killing the helper closes the Job handle; KILL_ON_JOB_CLOSE ends the tree.
    try { child.kill("SIGKILL"); } catch (e) { notes.push("helper kill failed: " + (e.code || e.message)); }
  }
}
// FRI-FINDING-002 (Option A): Job Object path only. After line 1 "OK", exactly one line-2 result
// "R:ok" or "R:fail:<winerr>" must arrive. Evaluated only for a natural helper exit (kind "exit");
// timeout / output-limit kills are supervisor-initiated and keep their own classification.
function statusCleanup() {
  if (spec.containment.kind !== "jobobject" || kind !== "exit") return undefined;
  const lines = launcherStatus.split(/\r?\n/).filter(l => l !== "");
  if (lines[0] !== "OK") return undefined;           // enrollment path is classified in the exit handler
  const rest = lines.slice(1);
  if (rest.length === 1 && rest[0] === "R:ok") return undefined;
  if (rest.length === 1 && /^R:fail:\d+$/.test(rest[0])) return "containment helper reported a cleanup failure (" + rest[0].slice(7) + ")";
  if (rest.length === 0) return "containment helper did not report a cleanup result";
  return "status protocol violation: " + JSON.stringify(rest.join("|")).slice(0, 80);
}
function finish(extra) {
  if (done) return; done = true; clearTimeout(timer);
  const cleanup = statusCleanup();
  if (cleanup !== undefined) extra = Object.assign({}, extra, { cleanup });
  fs.writeFileSync(spec.reportPath, JSON.stringify(Object.assign({ kind, notes, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }, extra)));
  process.exit(0);
}
function take(which) {
  return d => {
    if (which === "o") { outN += d.length; if (outN <= spec.maxBuffer) out.push(d); }
    else { errN += d.length; if (errN <= spec.maxBuffer) err.push(d); }
    if ((outN > spec.maxBuffer || errN > spec.maxBuffer) && !kind) { kind = "output_limit"; killTree(); }
  };
}
function resolveCmd(cmd) {
  const sep = win ? ";" : ":";
  const exts = win ? ["", ".exe", ".cmd", ".bat"] : [""];
  if (cmd.includes("/") || (win && cmd.includes("\\"))) return fs.existsSync(cmd) ? cmd : null;
  for (const d of String((spec.env && (spec.env.PATH || spec.env.Path)) || "").split(sep)) {
    if (!d) continue;
    for (const x of exts) {
      const f = path.join(d, cmd + x);
      try { if (fs.statSync(f).isFile()) { if (!win) fs.accessSync(f, fs.constants.X_OK); return f; } } catch (e) { /* not here */ }
    }
  }
  return null;
}
const resolved = resolveCmd(spec.cmd);
if (resolved === null) { kind = "spawn_error"; finish({ code: "ENOENT" }); }
let launch;
if (spec.containment.kind === "cgroup") {
  // join → verify own membership → exec. The foreign command never runs uncontained.
  // Option B launcher script: OK/F:<step> to fd 3 (closed before exec; foreign process cannot inherit it).
  // "OK" means: "launcher completed containment enrollment and transferred execution to the foreign
  // command path" — it does NOT mean the foreign process successfully started.
  const script = 'echo $$ > "$1" 2>/dev/null || { printf "F:join\\n" >&3; exec 3>&-; exit 125; }; ok=; while IFS= read -r l; do [ "$l" = "0::$2" ] && ok=1; done < /proc/self/cgroup; [ -n "$ok" ] || { printf "F:verify\\n" >&3; exec 3>&-; exit 125; }; printf "OK\\n" >&3; exec 3>&-; shift 2; exec "$@"';
  launch = ["/bin/sh", ["-c", script, "ur-fri-launch", path.join(spec.containment.dir, "cgroup.procs"), spec.containment.relPath, resolved, ...spec.args]];
} else {
  const isBatch = /\.(cmd|bat)$/i.test(resolved);
  const target = isBatch ? ["cmd.exe", "/d", "/s", "/c", resolved, ...spec.args] : [resolved, ...spec.args];
  // --status-fd 3: CRT fd index of the inherited status pipe write end (Node maps stdio[3] to this fd).
  // The helper must write OK/F:<step>:<winerr> then close the handle before ResumeThread.
  launch = [spec.containment.helper, ["--status-fd", "3", String(spec.timeoutMs + 5000), "--", ...target]];
}
// launcherStatus hoisted: must be in scope for both the stdio[3] data handler
// and the child.on("exit") handler (which is outside the try block).
let launcherStatus = "";
try {
  // stdio[3] = write end inside the child; child.stdio[3] = readable in supervisor.
  // The launcher (Linux /bin/sh) inherits fd 3 and writes status before exec then closes it.
  // The helper (Windows) receives fd 3 as a CRT fd, writes status, then closes before ResumeThread.
  // The foreign process never inherits fd 3.
  child = cp.spawn(launch[0], launch[1], { cwd: spec.cwd, env: spec.env, detached: !win, stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true });
  if (child.stdio[3]) {
    child.stdio[3].setEncoding("utf8");
    child.stdio[3].on("data", (d) => { launcherStatus += d; });
  }
} catch (e) { kind = "spawn_error"; finish({ code: e.code || String(e.message) }); }
child.on("error", e => { if (!kind) kind = "spawn_error"; finish({ code: e.code || String(e.message) }); });
child.stdout.on("data", take("o"));
child.stderr.on("data", take("e"));
timer = setTimeout(() => { if (!kind) kind = "timeout"; killTree(); }, spec.timeoutMs);
child.on("exit", (status, signal) => {
  const e = Buffer.concat(err).toString("utf8");
  // Option B (FRI-FINDING-001): launcher status comes from the trusted fd-3 pipe, not stderr.
  // 'launcherStatus' is set by the 'data' handler on child.stdio[3] before this 'exit' event.
 const launched = launcherStatus.startsWith("OK");
 if (win && spec.containment.kind === "jobobject" && !launched) {
 const raw = launcherStatus.trim();
 kind = "containment_failed";
 killTree();
 finish({ code: "missing-or-invalid-OK-status:" + (raw || "empty") });
 return;
 }
  if (!launched && (status === 125 || status === 126)) {
    const raw = launcherStatus.trim();
    // Protocol: F:<step> or F:<step>:<platform-error>; empty = launcher did not complete enrollment
    if (raw.startsWith("F:") || raw === "") {
      kind = raw.startsWith("F:cleanup") ? "cleanup_failed" : "containment_failed";
      const code = raw.startsWith("F:") ? raw.slice(2) : "launcher did not complete enrollment";
      killTree(); finish({ code }); return;
    }
    // Unknown status: protocol error — treat as containment failure so nothing is silently accepted
    kind = "containment_failed"; killTree(); finish({ code: "protocol-error:" + raw.slice(0, 40) }); return;
  }
  const failed = kind !== null || status !== 0 || signal !== null;
  if (failed) killTree();
  if (!kind) kind = "exit";
  setTimeout(() => finish({ status, signal }), 2000);
});
child.on("close", (status, signal) => { if (!kind) kind = "exit"; finish({ status, signal }); });
`;

type FriPhase = "run" | "compile";
type FriExecOptions = { cwd?: string; env?: Record<string, string | undefined>; timeoutMs: number; phase: FriPhase; workDir: string; where: string; diagnostics: (s: string) => void; exitMessages?: Record<number, string> };
type FriContainment =
  | { kind: "cgroup"; dir: string; relPath: string; parentProcs: string }
  | { kind: "jobobject"; helper: string };

let friExecCounter = 0;
function friSleep(ms: number): void { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// Establish containment BEFORE anything foreign starts. Throws
// FRI_CONTAINMENT_UNAVAILABLE (never a weaker fallback).
function friPrepareContainment(where: string): FriContainment {
  const unavailable = (reason: string) => new UrPanic(`FRI_CONTAINMENT_UNAVAILABLE: ${where}: ${reason} - foreign code was not started`);
  if (process.platform === "linux") {
    let mountPoint: string | undefined;
    let rel: string | undefined;
    try {
      mountPoint = (readFileSync("/proc/mounts", "utf-8") as string).split("\n").map((l: string) => l.split(" ")).find((f: string[]) => f[2] === "cgroup2")?.[1];
      rel = (readFileSync("/proc/self/cgroup", "utf-8") as string).split("\n").find((l: string) => l.startsWith("0::"))?.slice(3);
    } catch (e) { throw unavailable(`cannot read cgroup information (${(e as { code?: string }).code ?? String(e)})`); }
    if (!mountPoint) throw unavailable("no cgroup v2 mount");
    if (rel === undefined) throw unavailable("process has no cgroup v2 membership");
    const parent = join(mountPoint, rel);
    const name = `ur-fri-${process.pid}-${friExecCounter}-${Date.now()}`;
    const dir = join(parent, name);
    try { mkdirSync(dir); } catch (e) { throw unavailable(`cannot create child cgroup under ${parent} (${(e as { code?: string }).code ?? String(e)})`); }
    const bail = (reason: string) => { try { rmdirSync(dir); } catch { /* reported below */ } return unavailable(reason); };
    if (!existsSync(join(dir, "cgroup.kill"))) throw bail("cgroup.kill not supported by this kernel (needs Linux 5.14+)");
    try { accessSync(join(dir, "cgroup.procs"), fsConstants.W_OK); } catch { throw bail("cgroup.procs not writable"); }
    return { kind: "cgroup", dir, relPath: posix.join(rel.startsWith("/") ? rel : `/${rel}`, name), parentProcs: join(parent, "cgroup.procs") };
  }
  if (process.platform === "win32") {
    let helper: string;
    try { helper = fileURLToPath(new URL("../native/bin/ur-fri-jobrun.exe", import.meta.url)); } catch { throw unavailable("cannot locate containment helper"); }
    if (!existsSync(helper)) throw unavailable(`containment helper not found (${helper})`);
    return { kind: "jobobject", helper };
  }
  throw unavailable(`no supported containment mechanism on platform '${process.platform}'`);
}

function friCgroupMembers(dir: string): string[] {
  try { return readFileSync(join(dir, "cgroup.procs"), "utf-8").split("\n").filter(Boolean); } catch { return []; }
}

// After the supervisor is gone (normally or not): release on success, kill
// otherwise, wait until empty, remove. Returns a description of any failure.
function friFinishContainment(c: FriContainment, success: boolean): string | undefined {
  if (c.kind !== "cgroup") return undefined;
  const problems: string[] = [];
  if (success) {
    for (const pid of friCgroupMembers(c.dir)) {
      try { writeFileSync(c.parentProcs, pid); } catch (e) { if (existsSync(`/proc/${pid}`)) problems.push(`could not release pid ${pid} (${(e as { code?: string }).code ?? String(e)})`); }
    }
  } else {
    try { writeFileSync(join(c.dir, "cgroup.kill"), "1"); } catch (e) { problems.push(`cgroup.kill failed (${(e as { code?: string }).code ?? String(e)})`); }
  }
  for (let i = 0; i < 200 && friCgroupMembers(c.dir).length > 0; i++) friSleep(10);
  const left = friCgroupMembers(c.dir);
  if (left.length > 0) problems.push(`${left.length} process(es) still in ${c.dir}: ${left.join(",")}`);
  try { rmdirSync(c.dir); } catch (e) { problems.push(`cgroup ${c.dir} not removed (${(e as { code?: string }).code ?? String(e)})`); }
  return problems.length ? problems.join("; ") : undefined;
}

function friExec(cmd: string, args: readonly string[], o: FriExecOptions): { stdout: string; stderr: string } {
  const containment = friPrepareContainment(o.where);          // throws before anything foreign starts
  const id = friExecCounter++;
  const specPath = join(o.workDir, `sup-${id}.json`);
  const reportPath = join(o.workDir, `sup-${id}-report.json`);
  let failure: UrPanic | undefined;
  let value: { stdout: string; stderr: string } | undefined;
  try {
    writeFileSync(specPath, JSON.stringify({ cmd, args, cwd: o.cwd, env: o.env ?? process.env, timeoutMs: o.timeoutMs, maxBuffer: FRI_MAX_BUFFER, reportPath, containment }));
    const sup = spawnSync(process.execPath, ["-e", FRI_SUPERVISOR, specPath], { stdio: "ignore", timeout: o.timeoutMs + FRI_SUPERVISOR_GRACE_MS, killSignal: "SIGKILL", windowsHide: true });
    const timeoutPrefix = o.phase === "compile" ? "FRI_COMPILE_TIMEOUT" : "FRI_TIMEOUT";
    const timeoutMsg = `${timeoutPrefix}: ${o.where} exceeded ${o.phase} timeout of ${o.timeoutMs} ms`;
    if (!existsSync(reportPath)) {
      failure = (sup.error && (sup.error as { code?: string }).code === "ETIMEDOUT")
        ? new UrPanic(`${timeoutMsg} (supervisor unresponsive)`)
        : new UrPanic(`FRI_SPAWN_FAILED: ${o.where}: supervisor ended without a report (status ${sup.status}, signal ${sup.signal})`);
    } else {
      const r = JSON.parse(readFileSync(reportPath, "utf-8")) as { kind: string; notes?: string[]; stdout: string; stderr: string; status?: number | null; signal?: string | null; code?: string; cleanup?: string };
      if (r.notes && r.notes.length) o.diagnostics(`FRI containment notes: ${r.notes.join("; ")}\n`);
      const forward = () => { if (r.stdout) o.diagnostics(r.stdout.endsWith("\n") ? r.stdout : r.stdout + "\n"); if (r.stderr) o.diagnostics(r.stderr.endsWith("\n") ? r.stderr : r.stderr + "\n"); };
      if (r.kind === "containment_failed") {
        const reason = r.code === "verify" ? "verify its cgroup membership"
          : r.code === "join" ? "join the cgroup"
          : r.code === "launcher did not complete enrollment" ? "complete enrollment (the status channel received no success signal)"
          : r.code?.startsWith("protocol-error:") ? `report a valid status (${r.code})`
          : `establish containment (${r.code})`;
        failure = new UrPanic(`FRI_CONTAINMENT_UNAVAILABLE: ${o.where}: launcher could not ${reason} - foreign code was not started`);
      }
      else if (r.kind === "cleanup_failed") failure = new UrPanic(`FRI_CLEANUP_FAILED: ${o.where}: containment helper could not release the job after a successful call (${r.code})`);
      else if (r.kind === "timeout") { forward(); failure = new UrPanic(timeoutMsg); }
      else if (r.kind === "spawn_error") failure = r.code === "ENOENT" ? new UrPanic(`FRI_RUNTIME_NOT_FOUND: ${o.where}: '${cmd}' not found`) : new UrPanic(`FRI_SPAWN_FAILED: ${o.where}: ${r.code ?? "unknown error"}`);
      else if (r.kind === "output_limit") failure = new UrPanic(`FRI_OUTPUT_LIMIT: ${o.where}: foreign output exceeded ${FRI_MAX_BUFFER} bytes`);
      else if ((r.status === null || r.status === undefined) && r.signal) { forward(); failure = new UrPanic(`FRI_SIGNAL: ${o.where} terminated by ${r.signal}`); }
      else if (r.status !== 0) {
        const special = o.phase === "run" ? o.exitMessages?.[r.status as number] : undefined;
        failure = o.phase === "compile" ? new UrPanic(`FRI_COMPILE_FAILED: ${o.where}: ${r.stderr}`)
          : special ? new UrPanic(`${special} — ${r.stderr.trim()}`)
          : new UrPanic(`FRI_FAILED: ${o.where}: exit ${r.status}: ${r.stderr}`);
      } else value = { stdout: r.stdout, stderr: r.stderr };
      // FRI-FINDING-002 (Option A): helper-reported cleanup outcome (status channel line 2).
      if (r.cleanup !== undefined) {
        failure = failure ? new UrPanic(`${failure.message} [FRI_CLEANUP_FAILED: ${r.cleanup}]`) : new UrPanic(`FRI_CLEANUP_FAILED: ${o.where}: ${r.cleanup}`);
        value = undefined;
      }
    }
  } catch (e) {
    failure = e instanceof UrPanic ? e : new UrPanic(`FRI_SPAWN_FAILED: ${o.where}: ${(e as Error).message}`);
  }
  const cleanupProblem = friFinishContainment(containment, failure === undefined);
  if (failure) throw cleanupProblem ? new UrPanic(`${failure.message} [FRI_CLEANUP_FAILED: ${cleanupProblem}]`) : failure;
  if (cleanupProblem) throw new UrPanic(`FRI_CLEANUP_FAILED: ${o.where}: ${cleanupProblem}`);
  return value!;
}

function friFloatToken(v: string): number | undefined {
  switch (v) {
    case "inf": case "Infinity": return Infinity;
    case "-inf": case "-Infinity": return -Infinity;
    case "nan": case "NaN": return NaN;
  }
  return /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v) ? Number(v) : undefined;
}

function decodeFriResult(fn: IRFunction, resultPath: string, foreignStdout: string, diagnostics: (s: string) => void): RtValue {
  const ext = fn.external!;
  const where = `external call '${fn.sourceName}' (${ext.runtime}: ${ext.module}.${ext.symbol})`;
  if (foreignStdout.length > 0) diagnostics(foreignStdout.endsWith("\n") ? foreignStdout : foreignStdout + "\n");
  if (fn.returnType === "void") return 0n;
  if (!existsSync(resultPath)) throw new UrPanic(`${where} produced no result (result channel empty)`);
  let envelope: { t?: unknown; v?: unknown };
  try { envelope = JSON.parse(readFileSync(resultPath, "utf-8")); } catch { throw new UrPanic(`${where} produced a malformed result envelope`); }
  const t = envelope.t, v = envelope.v;
  const mismatch = (declared: string) => new UrPanic(`${where} declared return type '${declared}' but produced ${t === "null" ? "null" : `${String(t)} ${JSON.stringify(v)}`}`);
  switch (fn.returnType) {
    case "string":
      if (t === "string" && typeof v === "string") return v;
      throw mismatch("string");
    case "bool":
      if (t === "bool" && typeof v === "boolean") return v;
      throw mismatch("bool");
    case "f64": {
      const n = (t === "float" || t === "int") && typeof v === "string" ? friFloatToken(v) : undefined;
      if (n !== undefined) return n;
      throw mismatch("float");
    }
    case "ptr":
      if (t === "ptr" && typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
      throw mismatch("nativeptr");
    default:
      if (t === "int" && typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
      throw mismatch("int");
  }
}

export type InterpretResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

// i64 values are real bigint throughout - never JS `number` - matching
// int64_t's exact range, not JS's float64-limited safe-integer range.
type RtValue = bigint | number | boolean | string | RtValue[] | undefined;

class UrPanic extends Error {
  constructor(message: string) { super(message); }
}

export interface SandboxCapabilityGrant { capability: "filesystem" | "network"; scope: string }
export interface SandboxPolicy { allow: SandboxCapabilityGrant[] }
export interface SandboxAuditEvent { capability: string; scope: string; decision: "allow" | "deny"; executionId: string; timestamp: string }
export interface SandboxOptions {
  policy: SandboxPolicy;
  timeoutMs: number;
  onAudit: (event: SandboxAuditEvent) => void;
  executionId: string;
  /** Host-provided real network endpoints, keyed by the same scope name used in policy grants - never a raw URL the snippet itself supplies. */
  networkEndpoints?: Record<string, string>;
}

export type FriOptions = { readonly timeouts?: Readonly<Record<string, { readonly runMs?: number; readonly compileMs?: number }>> };

export function interpretModule(module: IRModule, entryFunctionName: string, sandboxOptions?: SandboxOptions, friOptions?: FriOptions): InterpretResult {
  const fnsByName = new Map<string, IRFunction>();
  for (const fn of module.functions) fnsByName.set(fn.qualifiedName, fn);

  const entryFn = module.functions.find(f => f.sourceName === entryFunctionName || f.qualifiedName === entryFunctionName);
  if (!entryFn) {
    return { stdout: "", stderr: `interpreter error: entry function '${entryFunctionName}' not found`, exitCode: 1 };
  }

  let stdout = "";
  let stderr = "";
  const write = (s: string) => { stdout += s; };
  const sandboxDeadline = sandboxOptions ? Date.now() + sandboxOptions.timeoutMs : Infinity;

  function callExtern(name: string, args: readonly RtValue[]): RtValue {
    switch (name) {
      case "ur_runtime_init": case "ur_runtime_shutdown": return undefined;
      case "ur_print_int": write(String(args[0] as bigint) + "\n"); return undefined;
      case "ur_print_float": write(formatFloat(args[0] as number) + "\n"); return undefined;
      case "ur_print_bool": write(String(args[0] as boolean) + "\n"); return undefined;
      case "ur_print_string": write((args[0] as string) + "\n"); return undefined;
      case "ur_input_string": return "";
      case "ur_free": return undefined;
      case "ur_panic": throw new UrPanic(String(args[0]));
      default:
        throw new UrPanic(`interpreter error: call to '${name}' is not supported by the interpreter (likely an FFI/native-library call - this requires the C Backend + gcc path)`);
    }
  }

  function formatFloat(v: number): string {
    // Matches ur_print_float's own real C implementation exactly:
    // printf("%g", value) — a whole-number float prints with NO decimal
    // point at all (e.g. 5.0 -> "5"). JS's own String() already produces
    // this same shortest form for whole numbers, confirmed directly by
    // comparing against the real C Backend's own output.
    return String(v);
  }

  function evalConst(value: { kind: string; value: unknown }): RtValue {
    switch (value.kind) {
      case "const_int": return value.value as bigint;
      case "const_float": return value.value as number;
      case "const_bool": return value.value as boolean;
      case "const_string": return value.value as string;
      default: throw new UrPanic(`interpreter error: unknown constant kind ${value.kind}`);
    }
  }

  const JS_GLOBAL_OBJECTS = new Set(["Math", "JSON", "Date", "Number", "String", "Boolean", "Array", "Object", "Reflect", "Atomics"]);

  /**
   * Real fix for the reported C Bridge bug: a manifest's own `module`
   * field given WITHOUT a file extension (e.g. "mathlib" instead of
   * "mathlib.c") was silently resolved via plain resolve() into a
   * path missing its real extension — gcc/g++/rustc/go/javac then
   * failed with a confusing linker/file-not-found error that never
   * named the real cause. This tries the file as given first, then
   * each of the language-appropriate extensions in order, and throws
   * a clear, specific error (naming every path actually tried) only
   * if none of them exist — never a raw, unexplained ld/gcc error.
   */
  function resolveModuleFile(rawModule: string, extensions: readonly string[], sourceName: string, runtime: string, manifestBaseDir?: string): string {
    const candidates: string[] = [];
    if (manifestBaseDir) candidates.push(resolve(manifestBaseDir, rawModule));
    candidates.push(resolve(rawModule));
    for (const base of candidates) {
      if (existsSync(base)) return base;
    }
    const tried = [...candidates];
    for (const base of [...candidates]) {
      for (const ext of extensions) {
        const withExt = base + ext;
        tried.push(withExt);
        if (existsSync(withExt)) return withExt;
      }
    }
    throw new UrPanic(`external call '${sourceName}' (${runtime}): could not find module file '${rawModule}' — tried: ${tried.join(", ")}`);
  }

  function callFunction(fn: IRFunction, args: readonly RtValue[]): RtValue {
    if (fn.external) {
      if (fn.external.module === "ur_stdlib_string") {
        const s = (v: RtValue) => String(v);
        switch (fn.external.symbol) {
          case "length": return BigInt(s(args[0]).length);
          case "trim": return s(args[0]).trim();
          case "split": return s(args[0]).split(s(args[1])) as RtValue[];
          case "split_get": {
            const parts = s(args[0]).split(s(args[1]));
            const idx = Number(args[2]);
            if (idx < 0 || idx >= parts.length) throw new UrPanic(`string_split_get: index ${idx} out of range (${parts.length} parts)`);
            return parts[idx]!;
          }
          case "join": return (args[0] as RtValue[]).map(s).join(s(args[1]));
          case "contains": return s(args[0]).includes(s(args[1]));
          case "starts_with": return s(args[0]).startsWith(s(args[1]));
          case "ends_with": return s(args[0]).endsWith(s(args[1]));
          case "substring": return s(args[0]).substring(Number(args[1]), Number(args[2]));
          case "to_int": {
            const n = s(args[0]).trim();
            if (!/^-?\d+$/.test(n)) throw new UrPanic(`string_to_int: '${n}' is not a valid integer`);
            return BigInt(n);
          }
          case "to_float": {
            const n = Number(s(args[0]).trim());
            if (Number.isNaN(n)) throw new UrPanic(`string_to_float: '${s(args[0])}' is not a valid float`);
            return n;
          }
          case "int_to_string": return s(args[0]);
          case "float_to_string": return s(args[0]);
          default: throw new UrPanic(`unknown string stdlib function '${fn.external.symbol}'`);
        }
      }
      if (sandboxOptions) {
        const audit = (capability: string, scope: string, decision: "allow" | "deny") =>
          sandboxOptions.onAudit({ capability, scope, decision, executionId: sandboxOptions.executionId, timestamp: new Date().toISOString() });

        if (fn.external.module === "sandbox_fs" && fn.external.symbol === "read") {
          const path = String(args[0]);
          const granted = sandboxOptions.policy.allow.some(g => {
            if (g.capability !== "filesystem") return false;
            const scopePath = resolve(g.scope);
            const targetPath = resolve(path);
            const rel = relative(scopePath, targetPath);
            return rel === "" ||
              (rel !== ".." &&
               !rel.startsWith(`..${sep}`) &&
               !isAbsolute(rel));
          });
          audit("filesystem", path, granted ? "allow" : "deny");
          if (!granted) throw new UrPanic(`CAPABILITY_DENIED: filesystem.read('${path}')`);
          // Only reachable after an explicit grant - no read has occurred before this line.
          return readFileSync(path, "utf-8");
        }
        if (fn.external.module === "sandbox_net" && fn.external.symbol === "request") {
          const endpointName = String(args[0]);
          const granted = sandboxOptions.policy.allow.some(g => g.capability === "network" && g.scope === endpointName);
          audit("network", endpointName, granted ? "allow" : "deny");
          if (!granted) throw new UrPanic(`CAPABILITY_DENIED: network.request('${endpointName}')`);
          // Only reachable after an explicit grant - no network call has occurred before this line.
          const url = sandboxOptions.networkEndpoints?.[endpointName];
          if (!url) throw new UrPanic(`sandbox misconfiguration: endpoint '${endpointName}' is granted but has no registered URL`);
          const res = spawnSync(process.execPath, ["-e", `fetch(${JSON.stringify(url)}).then(r=>r.text()).then(t=>{process.stdout.write(t)})`], { encoding: "utf-8", timeout: 5000 });
          return res.stdout ?? "";
        }
        // Every other external call - real Python/JavaScript/C/Rust/etc.
        // FFI - is an unconditional, policy-independent denial in
        // sandboxed mode. This is the hard block Architecture Gate 1
        // required: FFI is not a grantable capability in v0.1.
        audit("ffi", `${fn.external.module}.${fn.external.symbol}`, "deny");
        throw new UrPanic(`CAPABILITY_DENIED: ffi is not permitted in sandboxed execution (attempted '${fn.external.module}.${fn.external.symbol}')`);
      }
      // SECURITY: fn.external.rawArgs (when present, i.e. call_external)
      // is now a SAFE, pre-validated JSON array string (parsed and
      // re-serialized at rewrite time in cli/index.ts) — it is passed
      // as a REAL, SEPARATE argv entry below, NEVER spliced into the
      // script's own source text. The script text itself is now FIXED
      // and contains zero user-controlled content.
      // H-B Fix (per direct instruction, Numeric Contract: Exact
      // Integer Preservation, Bidirectional FFI Exactness Boundary):
      // a bigint argument that cannot round-trip exactly through
      // Number is now serialized as a JSON string of its exact
      // decimal digits, instead of the prior unconditional
      // Number(a) (which silently lost precision for large ints,
      // confirmed live: 9007199254740993 came back as ...992). A
      // safe bigint (round-trips exactly) is still serialized as a
      // plain JSON number, unchanged. Per FFI's own already-proven
      // Int-only type contract, every FFI argument today is an
      // integer - the Python/JavaScript wrapper scripts below are
      // updated to convert a string-encoded argument back to a real
      // integer before the call, per the same explicit protocol.
      // H-B Arguments Fix (per direct instruction, Numeric Contract:
      // Exact Integer Preservation, explicit Envelope protocol):
      // confined precisely to this import/exports RtValue[] path -
      // call_external's own rawArgs (compile-time JSON literals,
      // confirmed by trace to never carry a real UR bigint value) is
      // completely untouched, bypassing this map entirely. A safe
      // bigint (its own textual round-trip through Number matches
      // exactly) is serialized as a plain JSON number, unchanged. An
      // unsafe bigint is wrapped in an explicit, uniquely-tagged
      // object envelope - not a bare string - so a real string
      // argument (confirmed live: ".", "echo PWNED", or even a
      // string that happens to look like a large number) can never
      // be mistaken for one: the wrapper below checks for this exact
      // object shape, never guesses from a string's own content.
      // GATE-026 D4-a (PM-approved C-1..C-3): a nativeptr value must never cross the FRI process
      // boundary. Every FRI call runs in a separate process, so an address obtained in one process is
      // meaningless (or dangerous) in another. Checked here - the single FRI entry for EVERY runtime -
      // BEFORE the per-call directory, any compile step or any foreign process exists. nativeptr values
      // remain legal inside UR itself (returned by native calls, held, used locally); only passing one
      // as an FRI argument is rejected. Typed code: FRI_UNSUPPORTED_ARGUMENT (FRI error taxonomy).
      const friPtrParam = fn.params.findIndex(p => p.type === "ptr");
      if (friPtrParam >= 0) {
        throw new UrPanic(`FRI_UNSUPPORTED_ARGUMENT: external call '${fn.sourceName}' (${fn.external.runtime}) parameter ${friPtrParam + 1} is 'nativeptr'; native pointers cannot cross the FRI process boundary (each FRI call runs in a separate process) - foreign code was not started`);
      }
      // GATE-026 D5 (PM-approved C-1..C-4): strict manifest identifier validation. Every manifest string that
      // reaches generated foreign code by raw interpolation must be a strict ASCII identifier: the export
      // symbol for python, c, cpp, go, java and native, and the python module (dotted). The native library
      // path is not an identifier but is embedded in generated C source, so control characters are rejected.
      // javascript / typescript / wasm are unchanged (their strings are escaped or used as object keys).
      // Checked here, BEFORE the per-call directory, any compile step, any runtime/tool lookup or any
      // foreign process. Typed code: FRI_INVALID_MANIFEST_IDENTIFIER (FRI error taxonomy).
      {
        const rt: string = fn.external.runtime;   // widened: the declared runtime union omits "native" (pre-existing typing gap; not changed here)
        const FRI_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
        const FRI_PY_MODULE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
        const invalid = (field: string, value: string, why: string) => new UrPanic(`FRI_INVALID_MANIFEST_IDENTIFIER: external call '${fn.sourceName}' (${rt}): ${field} ${JSON.stringify(value)} ${why} - foreign code was not started`);
        if ((rt === "python" || rt === "c" || rt === "cpp" || rt === "go" || rt === "java" || rt === "native") && !FRI_IDENT.test(fn.external.symbol)) {
          throw invalid("symbol", fn.external.symbol, "is not a valid identifier ([A-Za-z_][A-Za-z0-9_]*)");
        }
        if (rt === "python" && !FRI_PY_MODULE.test(fn.external.module)) {
          throw invalid("module", fn.external.module, "is not a valid dotted Python module identifier");
        }
        if (rt === "native" && /[\u0000-\u001f\u007f]/.test(fn.external.module)) {
          throw invalid("native library path", fn.external.module, "contains a control character");
        }
      }
      const friResultDir = mkdtempSync(join(tmpdir(), "ur-fri-res-"));
      const friResultPath = join(friResultDir, "result.json");
      const friEnv = { ...process.env, UR_FRI_RESULT_PATH: friResultPath };
      const friDiagnostics = (s: string) => { stderr += s; };
      let friPrimaryError: unknown;
      const friBudget = friOptions?.timeouts?.[fn.sourceName];
      const friRunMs = friBudget?.runMs ?? FRI_DEFAULT_RUN_MS;
      const friCompileMs = friBudget?.compileMs ?? FRI_DEFAULT_COMPILE_MS;
      const friWhere = `external call '${fn.sourceName}' (${fn.external.runtime}: ${fn.external.module}.${fn.external.symbol})`;
      const friRun = (cmd: string, cmdArgs: readonly string[], extra: { cwd?: string; timeoutMs?: number; exitMessages?: Record<number, string> } = {}) =>
        friExec(cmd, cmdArgs, { cwd: extra.cwd, env: friEnv, timeoutMs: extra.timeoutMs ?? friRunMs, phase: "run", workDir: friResultDir, where: friWhere, diagnostics: friDiagnostics, exitMessages: extra.exitMessages });
      const friCompile = (cmd: string, cmdArgs: readonly string[], extra: { cwd?: string } = {}) =>
        friExec(cmd, cmdArgs, { cwd: extra.cwd, timeoutMs: friCompileMs, phase: "compile", workDir: friResultDir, where: friWhere, diagnostics: friDiagnostics });
      try {
      const encodeFriArg = (a: unknown): unknown => {
        if (typeof a === "bigint") {
          const n = Number(a);
          return Number.isSafeInteger(n) && BigInt(n) === a ? n : { __ur_exact_int__: a.toString() };
        }
        if (Array.isArray(a)) return a.map(encodeFriArg);
        return a;
      };
      const argsJsonForArgv = fn.external.rawArgs !== undefined ? fn.external.rawArgs : JSON.stringify(args.map(encodeFriArg));
      let command: string, commandArgs: string[];
      if (fn.external.runtime === "python") {
        const script = `import json, sys\nimport ${fn.external.module} as __m\nargs = json.loads(sys.argv[1])\nargs = [int(a["__ur_exact_int__"]) if isinstance(a, dict) and "__ur_exact_int__" in a else a for a in args]\n__r = getattr(__m, ${JSON.stringify(fn.external.symbol)})(*args)\n${PY_RESULT_WRITER}`;
        // F-1 (Option C): PYTHON_BIN override, else platform-aware default (Windows: python; others: python3).
        const pythonBin = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
        command = pythonBin; commandArgs = ["-c", script, argsJsonForArgv];
      } else if (fn.external.runtime === "javascript") {
        const target = JS_GLOBAL_OBJECTS.has(fn.external.module) ? fn.external.module : `require(${JSON.stringify(fn.external.module)})`;
        const script = `let args = JSON.parse(process.argv[1]); args = args.map(a => (a !== null && typeof a === "object" && "__ur_exact_int__" in a) ? BigInt(a.__ur_exact_int__) : a); const __r = ${target}[${JSON.stringify(fn.external.symbol)}](...args); ${JS_RESULT_WRITER}`;
        command = "node"; commandArgs = ["-e", script, argsJsonForArgv];
      } else if (fn.external.runtime === "native") {
        // Native Integration Design Gate (SQLite3 Linux reference) +
        // Native Pointer ABI Gate C (authorized, narrow scope): generates
        // its own dlopen()/dlsym() C shim entirely - fn.external.module
        // is the real shared library's path/soname, not a user-authored
        // source file, unlike the "c" branch immediately below. This is
        // a direct, narrowly-scoped port of the exact, already-proven
        // technique in tests/ffi/native/harness-executor.ts (a test-only
        // reference implementation, not itself Production API) -
        // dlopen()/dlsym() are real, genuine calls against the real
        // library named in the manifest, not simulated.
        //
        // Gate C narrowly extends the original SQLite3-only (zero-arg,
        // i64-return) scope to ALSO support: (a) a `ptr`-returning
        // function (returned as an unsigned 64-bit address, printed via
        // %lu and parsed back as a BigInt - the exact representation
        // NativeCallResult's own {kind:"ptr", value:bigint} already
        // uses), and (b) a SINGLE `ptr`-typed parameter, passed through
        // as an incoming address (via argv, reconstructed as void* in
        // the shim) so a previously-obtained native pointer can be
        // handed to a subsequent native call - exactly the "pass it to
        // a Native boundary" capability the Native Pointer ABI Design
        // Gate scoped, and no further: no struct-field access, no
        // function-pointer-through-a-vtable dereferencing, no
        // multi-argument calls, no pointer arithmetic anywhere in this
        // shim - if a real target ever needs those, that is a new,
        // separate Finding, not silently added here.
        const tmpDir = mkdtempSync(join(friResultDir, "native-"));
        const wrapperPath = join(tmpDir, "wrapper.c");
        const binPath = join(tmpDir, "wrapper.bin");
        const libraryPath = fn.external.module;
        const symbolName = fn.external.symbol;
        const returnsPtr = fn.returnType === "ptr";
        const paramTypes = fn.params.map(p => p.type);
        if (paramTypes.length > 1 || (paramTypes.length === 1 && paramTypes[0] !== "ptr")) {
          throw new UrPanic(`external call '${fn.sourceName}' (native) failed: this Gate supports zero arguments, or exactly one 'ptr'-typed argument only — got ${paramTypes.length} argument(s) of type(s) [${paramTypes.join(", ")}]`);
        }
        const hasPtrArg = paramTypes.length === 1;
        const castType = returnsPtr ? "void*" : "long";
        const printFormat = returnsPtr ? "%lu" : "%ld";
        const printExpr = returnsPtr ? "(unsigned long)result" : "result";
        writeFileSync(wrapperPath, [
          `#include <stdio.h>`,
          `#include <stdlib.h>`,
          `#include <dlfcn.h>`,
          `int main(${hasPtrArg ? "int argc, char** argv" : "void"}) {`,
          `  void* lib = dlopen(${JSON.stringify(libraryPath)}, RTLD_NOW);`,
          `  if (!lib) { fprintf(stderr, "DLOPEN_FAIL:%s\\n", dlerror()); return 2; }`,
          `  void* f = dlsym(lib, ${JSON.stringify(symbolName)});`,
          `  if (!f) { fprintf(stderr, "DLSYM_FAIL:%s\\n", ${JSON.stringify(symbolName)}); return 3; }`,
          ...(hasPtrArg ? [
            `  void* arg0 = (void*)strtoul(argv[1], NULL, 10);`,
            `  ${castType} (*fn)(void*) = (${castType} (*)(void*))f;`,
            `  ${castType} result = fn(arg0);`,
          ] : [
            `  ${castType} (*fn)(void) = (${castType} (*)(void))f;`,
            `  ${castType} result = fn();`,
          ]),
          `  FILE* __ur_o = fopen(getenv("UR_FRI_RESULT_PATH"), "w");`,
          `  if (!__ur_o) return 4;`,
          `  fprintf(__ur_o, "{\\"t\\":\\"${returnsPtr ? "ptr" : "int"}\\",\\"v\\":\\"${printFormat}\\"}", ${printExpr});`,
          `  fclose(__ur_o);`,
          `  dlclose(lib);`,
          `  return 0;`,
          `}`,
          ``,
        ].join("\n"));
        friCompile("gcc", [wrapperPath, "-o", binPath, "-ldl"]);
        const runArgs = hasPtrArg ? [String(args[0] as bigint)] : [];
        const result3 = friRun(binPath, runArgs, { exitMessages: {
          2: `external call '${fn.sourceName}' (native: ${libraryPath}.${symbolName}) failed: library not found or could not be loaded`,
          3: `external call '${fn.sourceName}' (native: ${libraryPath}.${symbolName}) failed: symbol '${symbolName}' not found in ${libraryPath}`,
        } });
        return decodeFriResult(fn, friResultPath, result3.stdout, friDiagnostics);
      } else if (fn.external.runtime === "c") {
        const tmpDir = mkdtempSync(join(friResultDir, "c-"));
        const wrapperPath = join(tmpDir, "wrapper.c");
        const binPath = join(tmpDir, "wrapper.bin");
        writeFileSync(wrapperPath, `#include <stdio.h>\n#include <stdlib.h>\nlong ${fn.external.symbol}(long);\nint main(int argc, char **argv) {\n  long a = atol(argv[1]);\n  long __ur_r = ${fn.external.symbol}(a);\n  FILE* __ur_o = fopen(getenv("UR_FRI_RESULT_PATH"), "w");\n  if (!__ur_o) return 4;\n  fprintf(__ur_o, "{\\"t\\":\\"int\\",\\"v\\":\\"%ld\\"}", __ur_r);\n  fclose(__ur_o);\n  return 0;\n}\n`);
        const cFilePath = resolveModuleFile(fn.external.module, [".c"], fn.sourceName, "c", fn.external.manifestBaseDir);
        friCompile("gcc", [wrapperPath, cFilePath, "-o", binPath]);
        command = binPath; commandArgs = [String(args[0])];
      } else if (fn.external.runtime === "rust") {
        const tmpDir = mkdtempSync(join(friResultDir, "rust-"));   // R2-RUST-CONTAINMENT-001: inside the per-call dir (same cleanup guarantee)
        const wrapperPath = join(tmpDir, "wrapper.rs");
        const binPath = join(tmpDir, "wrapper.bin");
        const moduleSource = readFileSync(resolveModuleFile(fn.external.module, [".rs"], fn.sourceName, "rust", fn.external.manifestBaseDir), "utf-8");
        friCompile("rustc", [wrapperPath, "-o", binPath]);   // R2-RUST-CONTAINMENT-001: same containment runner; Rust integration itself unchanged
        command = binPath; commandArgs = [String(args[0])];
      } else if (fn.external.runtime === "cpp") {
        const tmpDir = mkdtempSync(join(friResultDir, "cpp-"));
        const wrapperPath = join(tmpDir, "wrapper.cpp");
        const binPath = join(tmpDir, "wrapper.bin");
        writeFileSync(wrapperPath, `#include <cstdio>\n#include <cstdlib>\nextern "C" long ${fn.external.symbol}(long);\nint main(int argc, char **argv) {\n  long a = atol(argv[1]);\n  long __ur_r = ${fn.external.symbol}(a);\n  FILE* __ur_o = fopen(getenv("UR_FRI_RESULT_PATH"), "w");\n  if (!__ur_o) return 4;\n  fprintf(__ur_o, "{\\"t\\":\\"int\\",\\"v\\":\\"%ld\\"}", __ur_r);\n  fclose(__ur_o);\n  return 0;\n}\n`);
        friCompile("g++", [wrapperPath, resolveModuleFile(fn.external.module, [".cpp", ".cc", ".cxx"], fn.sourceName, "cpp", fn.external.manifestBaseDir), "-o", binPath]);
        command = binPath; commandArgs = [String(args[0])];
      } else if (fn.external.runtime === "wasm") {
        const wasmBytes = readFileSync(resolveModuleFile(fn.external.module, [".wasm"], fn.sourceName, "wasm", fn.external.manifestBaseDir));
        const wasmModule = new WebAssembly.Module(wasmBytes);
        const instance = new WebAssembly.Instance(wasmModule, {});
        const exportedFn = (instance.exports as Record<string, (...a: bigint[]) => bigint>)[fn.external.symbol];
        if (typeof exportedFn !== "function") {
          throw new UrPanic(`external call '${fn.sourceName}' (wasm: ${fn.external.module}.${fn.external.symbol}) failed: export not found or not a function`);
        }
        return exportedFn(...args.map(a => BigInt(a as string | number | bigint | boolean))) as unknown as RtValue;
      } else if (fn.external.runtime === "go") {
        const tmpDir = mkdtempSync(join(friResultDir, "go-"));
        const wrapperPath = join(tmpDir, "wrapper.go");
        const moduleSource = readFileSync(resolveModuleFile(fn.external.module, [".go"], fn.sourceName, "go", fn.external.manifestBaseDir), "utf-8");
        writeFileSync(wrapperPath, `package main\nimport ("fmt"; "os"; "strconv")\n${moduleSource.replace(/^package main\n/, "")}\nfunc main() {\n  a, _ := strconv.ParseInt(os.Args[1], 10, 64)\n  _ = os.WriteFile(os.Getenv("UR_FRI_RESULT_PATH"), []byte(fmt.Sprintf("{\\"t\\":\\"int\\",\\"v\\":\\"%d\\"}", ${fn.external.symbol}(a))), 0600)\n}\n`);
        const runResult = friRun("go", ["run", wrapperPath, String(args[0])], { timeoutMs: friCompileMs + friRunMs });
        return decodeFriResult(fn, friResultPath, runResult.stdout, friDiagnostics);
      } else if (fn.external.runtime === "java") {
        const tmpDir = mkdtempSync(join(friResultDir, "java-"));
        const moduleSource = readFileSync(resolveModuleFile(fn.external.module, [".java"], fn.sourceName, "java", fn.external.manifestBaseDir), "utf-8");
        const className = "Wrapper";
        const wrapperSource = moduleSource.replace(/class\s+\w+/, `class ${className}`) + `
class ${className}Main {
  public static void main(String[] args) throws Exception {
    long a = Long.parseLong(args[0]);
    java.nio.file.Files.write(java.nio.file.Paths.get(System.getenv("UR_FRI_RESULT_PATH")), ("{\"t\":\"int\",\"v\":\"" + ${className}.${fn.external.symbol}(a) + "\"}").getBytes("UTF-8"));
  }
}
`;
        const wrapperPath = join(tmpDir, `${className}.java`);
        writeFileSync(wrapperPath, wrapperSource);
        friCompile("javac", [wrapperPath], { cwd: tmpDir });
        const runResult = friRun("java", [`${className}Main`, String(args[0])], { cwd: tmpDir });
        return decodeFriResult(fn, friResultPath, runResult.stdout, friDiagnostics);
      } else if (fn.external.runtime === "typescript") {
        const script = `const m = require(${JSON.stringify(resolve(fn.external.module))}); const args = JSON.parse(process.argv[1]); const __r = m[${JSON.stringify(fn.external.symbol)}](...args); ${JS_RESULT_WRITER}`;
        const tsxBin = process.env.TSX_BIN ?? "tsx";
        // P1-2-T-R2 Official Fix Directive (diagnostic pattern
        // confirmed working on real Windows): a `.cmd` file is not a
        // native executable Windows' CreateProcess can launch directly
        // - it requires cmd.exe to interpret it, which spawnSync does
        // not provide unless routed explicitly. Handled as its own
        // case rather than via `shell: true` on the spawnSync call
        // itself, per explicit instruction against that shortcut. A
        // `.mjs` path (tsx's own real package entry, reachable via a
        // manually-set TSX_BIN) is run via `node` directly, mirroring
        // the already-proven "javascript" runtime branch above. Any
        // other value (a bare "tsx" name, or an already-executable
        // local `tsx` path on POSIX, where none of this applies) is
        // invoked exactly as before this fix.
        let command: string, commandArgs: string[];
        if (tsxBin.endsWith(".cmd") && process.platform === "win32") {
          command = process.env.ComSpec || "cmd.exe";
          commandArgs = ["/c", tsxBin, "-e", script, argsJsonForArgv];
        } else if (tsxBin.endsWith(".mjs")) {
          command = process.execPath;
          commandArgs = [tsxBin, "-e", script, argsJsonForArgv];
        } else {
          command = tsxBin;
          commandArgs = ["-e", script, argsJsonForArgv];
        }
        const result2 = friRun(command, commandArgs);
        return decodeFriResult(fn, friResultPath, result2.stdout, friDiagnostics);
      } else {
        throw new UrPanic(`external call '${fn.sourceName}' declares unsupported runtime '${fn.external.runtime}'`);
      }
      const result = friRun(command, commandArgs);
      return decodeFriResult(fn, friResultPath, result.stdout, friDiagnostics);
      } catch (e) {
        friPrimaryError = e;
        throw e;
      } finally {
        let friTmpProblem: string | undefined;
        try { rmSync(friResultDir, { recursive: true, force: true }); } catch (e) { friTmpProblem = `temporary directory ${friResultDir} not removed (${(e as { code?: string }).code ?? String(e)})`; }
        if (friTmpProblem === undefined && existsSync(friResultDir)) friTmpProblem = `temporary directory ${friResultDir} still present`;
        if (friTmpProblem !== undefined) {
          if (friPrimaryError instanceof UrPanic) throw new UrPanic(`${friPrimaryError.message} [FRI_CLEANUP_FAILED: ${friTmpProblem}]`);
          throw new UrPanic(`FRI_CLEANUP_FAILED: ${friWhere}: ${friTmpProblem}`);
        }
      }
    }
    const ssa = new Map<number, RtValue>();
    const slots = new Map<number, RtValue>();
    // Pre-initialize array-typed slots as real, correctly-sized arrays —
    // matching the C Backend's own fixed-size array declaration. Without
    // this, the first array_store would write into `undefined` rather
    // than a real array. Confirmed necessary by testing directly before
    // this fix (an array program threw immediately).
    // Compound Parameter Binding Fix (Phase 3R-B, per direct instruction):
    // real, existing IRParam metadata (structLayout/arrayLength) is now
    // also consumed by the Interpreter, matching C/WASM Backend's own
    // already-ratified BY VALUE semantics (LANGUAGE_SYNTAX_1_1_SPEC.md
    // §2.1/§2.5 - Reference semantics explicitly rejected there). A
    // compound-typed local whose name matches a real function parameter
    // is initialized with an independent shallow copy of the incoming
    // argument (now a real, correctly-positioned value, per 3R-A/3R-C's
    // own fixes) - a full, correct copy today, since Level 2.8
    // structs/arrays cannot nest. Every other local (ordinary `let`
    // declarations) keeps its exact prior empty-initialization
    // behavior, unchanged.
    const paramsByName = new Map(fn.params.map(p => [p.name, p]));
    for (const local of fn.locals) {
      const matchingParam = paramsByName.get(local.name);
      if (matchingParam && (matchingParam.structLayout || matchingParam.arrayLength !== undefined)) {
        const paramIdx = fn.params.indexOf(matchingParam);
        const incoming = args[paramIdx];
        slots.set(local.id, Array.isArray(incoming) ? [...incoming] : incoming);
        continue;
      }
      if (local.isArray) slots.set(local.id, new Array(local.length ?? 1).fill(undefined));
      if (local.structLayout) slots.set(local.id, new Array(local.structLayout.fields.length).fill(undefined));
    }

    const blocksById = new Map<number, IRBasicBlock>();
    for (const b of fn.blocks) blocksById.set(b.id, b);

    let currentBlock: IRBasicBlock | undefined = blocksById.get(fn.entryBlock);

    while (currentBlock) {
      if (sandboxOptions && Date.now() > sandboxDeadline) {
        throw new UrPanic(`EXECUTION_TIMEOUT: exceeded ${sandboxOptions.timeoutMs}ms`);
      }
      for (const inst of currentBlock.instructions) {
        execInstruction(inst, ssa, slots, args);
      }
      const term = currentBlock.terminator;
      const result = execTerminator(term, ssa, slots);
      if (result.kind === "return") return result.value;
      currentBlock = blocksById.get(result.target);
    }
    throw new UrPanic("interpreter error: entry block not found or function fell through without a terminator");
  }

  function execInstruction(
    inst: IRInstruction,
    ssa: Map<number, RtValue>,
    slots: Map<number, RtValue>,
    args: readonly RtValue[],
  ): void {
    switch (inst.kind) {
      // Phase 3R-C (per direct instruction): use the real, existing,
      // already-correct inst.index field to read the parameter's own
      // real position in `args`, instead of a separate sequential
      // counter. This is necessary because compound-typed parameters
      // (arraySlot/structSlot) never produce a "param" instruction at
      // all - a sequential counter incremented only on "param"
      // instructions drifts out of sync with the real args[] positions
      // whenever a scalar parameter follows a compound one.
      case "param": { ssa.set(inst.id, args[inst.index]); return; }
      case "const": { ssa.set(inst.id, evalConst(inst.value)); return; }
      case "binop": {
        // 3R-M Fix (per direct instruction, Contract: LANGUAGE_SYNTAX_1_1_SPEC.md
        // §2.4, Structural/Deep Equality, field-by-field): a struct
        // operand to eq/neq carries the same real IRValueRef shape
        // (structSlot) already consumed at the call-argument (3R-A),
        // return (3R-D), and assignment (3R-E) boundaries - reading
        // the real field array from the referenced slot instead of
        // ssa.get(inst.left/right.id), which read the dummy id:-1
        // placeholder. The comparison performed is the exact
        // field-by-field structural equality the Spec mandates -
        // not object identity, not reference identity, not
        // serialization/hash - implemented as a plain element-wise
        // comparison over the two field arrays (both structs of the
        // same declared type always have the same field count and
        // order, confirmed by the Lowerer's own shared
        // StructLayoutCalculator). neq is the exact negation of eq's
        // own result, per direct instruction. Confined strictly to
        // eq/neq - every other operator, and every non-struct
        // operand pair, keeps its exact prior behavior unchanged.
        if ((inst.op === "eq" || inst.op === "neq") && (inst.left.structSlot !== undefined || inst.right.structSlot !== undefined)) {
          const lv = inst.left.structSlot !== undefined ? slots.get(inst.left.structSlot) : ssa.get(inst.left.id);
          const rv = inst.right.structSlot !== undefined ? slots.get(inst.right.structSlot) : ssa.get(inst.right.id);
          const la = lv as RtValue[], ra = rv as RtValue[];
          const structEq = la.length === ra.length && la.every((v, i) => v === ra[i]);
          ssa.set(inst.id, inst.op === "eq" ? structEq : !structEq);
          return;
        }
        const l = ssa.get(inst.left.id);
        const r = ssa.get(inst.right.id);
        ssa.set(inst.id, evalBinop(inst.op, l, r));
        return;
      }
      case "unop": {
        const v = ssa.get(inst.operand.id);
        ssa.set(inst.id, inst.op === "neg" ? (typeof v === "bigint" ? -v : -(v as number)) : !(v as boolean));
        return;
      }
      case "call": {
        // Phase 3R-A (per direct instruction): compound-value arguments
        // (arraySlot/structSlot) carry a real, existing IRValueRef shape
        // already produced by the Lowerer, with id:-1 as a dummy (never
        // meaningful) - reading their real value means reading the
        // referenced slot directly, using the exact same real mechanism
        // array_load/field_load already use (`slots.get(slotId)`), not a
        // second, new access path. A plain scalar arg (neither field
        // set) keeps its exact prior behavior (ssa.get(a.id)), unchanged.
        const callArgs = inst.args.map(a => {
          if (a.arraySlot !== undefined) return slots.get(a.arraySlot);
          if (a.structSlot !== undefined) return slots.get(a.structSlot);
          return ssa.get(a.id);
        });
        const target = fnsByName.get(inst.callee);
        const result = target ? callFunction(target, callArgs) : callExtern(inst.callee, callArgs);
        // Phase 3R-D (per direct instruction): a struct-returning call
        // carries a real, existing resultStructSlot field on the call
        // instruction itself (already consumed correctly by the C
        // Backend) - the real result must be stored into that slot
        // directly, as a real, independent copy (matching 3R-B's own
        // BY VALUE guarantee), since the consumer reading this call's
        // own value elsewhere (e.g. a renamed local slot) reads it from
        // `slots`, not from `ssa` under the dummy id:-1 placeholder. A
        // plain (non-struct-returning) call keeps its exact prior
        // behavior, unchanged.
        if (inst.resultStructSlot !== undefined) {
          slots.set(inst.resultStructSlot, Array.isArray(result) ? [...result] : result);
        }
        if (inst.resultArraySlot !== undefined) {
          slots.set(inst.resultArraySlot, Array.isArray(result) ? [...result] : result);
        }
        ssa.set(inst.id, result);
        return;
      }
      case "load": { ssa.set(inst.id, slots.get(inst.slot)); return; }
      case "store": { slots.set(inst.slot, ssa.get(inst.value.id)); return; }
      case "field_load": { ssa.set(inst.id, (slots.get(inst.slot) as RtValue[])[inst.fieldIndex]); return; }
      case "field_store": { (slots.get(inst.slot) as RtValue[])[inst.fieldIndex] = ssa.get(inst.value.id); return; }
      case "array_load": {
        // INTERPRETER-NESTED-ARRAY-001 fix: array_load's own real IR
        // contract (confirmed directly, ir-builder.ts lines 850-868)
        // is slot = a real, named local array, OR slot = -1 paired
        // with a real baseRef = the SSA id of a prior array_load's
        // own result (chained/nested access, e.g. arr[0][1]). Mirrors
        // emit-c.ts/emit-wasm.ts's own already-correct, identical
        // baseRef-aware pattern exactly.
        const arr = (inst.baseRef ? ssa.get(inst.baseRef.id) : slots.get(inst.slot)) as RtValue[] | undefined;
        const idx = Number(ssa.get(inst.index.id) as bigint);
        if (!arr || idx < 0 || idx >= arr.length) throw new UrPanic("array index out of bounds");
        ssa.set(inst.id, arr[idx]);
        return;
      }
      case "array_length": {
        const arr = (inst.baseRef ? ssa.get(inst.baseRef.id) : slots.get(inst.slot)) as RtValue[] | undefined;
        ssa.set(inst.id, BigInt(arr ? arr.length : 0));
        return;
      }
      case "array_store": {
        // INTERPRETER-NESTED-ARRAY-001 fix: identical reasoning to the
        // array_load fix immediately above (confirmed directly,
        // ir-builder.ts lines 1120-1132: "identical reasoning to the
        // read-side fix").
        const arr = (inst.baseRef ? ssa.get(inst.baseRef.id) : slots.get(inst.slot)) as RtValue[] | undefined;
        const idx = Number(ssa.get(inst.index.id) as bigint);
        if (!arr || idx < 0 || idx >= arr.length) throw new UrPanic("array index out of bounds");
        // A1 Consumer-Safety Remediation (per direct instruction): an
        // array element that is itself a struct or array value arrives
        // here as a structSlot/arraySlot-bearing IRValueRef (the dummy
        // id:-1 placeholder is not a real ssa key) - read the real value
        // from the referenced slot instead, matching the exact same
        // already-proven-correct pattern used at the return terminator,
        // struct equality, and call-argument construction. A plain
        // scalar element (neither field set) keeps its exact prior
        // behavior, unchanged.
        if (inst.value.structSlot !== undefined) { arr[idx] = [...(slots.get(inst.value.structSlot) as RtValue[])]; return; }
        if (inst.value.arraySlot !== undefined) { arr[idx] = slots.get(inst.value.arraySlot); return; }
        arr[idx] = ssa.get(inst.value.id);
        return;
      }
    }
  }

  function evalBinop(op: string, l: RtValue, r: RtValue): RtValue {
    if (typeof l === "bigint" && typeof r === "bigint") {
      switch (op) {
        case "add": return l + r; case "sub": return l - r; case "mul": return l * r;
        case "div": if (r === 0n) throw new UrPanic("division by zero"); return l / r;
        case "mod": if (r === 0n) throw new UrPanic("division by zero"); return l % r;
        case "eq": return l === r; case "neq": return l !== r;
        case "lt": return l < r; case "lte": return l <= r; case "gt": return l > r; case "gte": return l >= r;
      }
    }
    if (typeof l === "number" && typeof r === "number") {
  switch (op) {
    case "add": return l + r;
    case "sub": return l - r;
    case "mul": return l * r;
    case "div": return l / r;
    case "mod": return l % r;

    case "eq": return l === r;
    case "neq": return l !== r;

    case "lt": return l < r;
    case "lte": return l <= r;
    case "gt": return l > r;
    case "gte": return l >= r;
  }
}

if (typeof l === "string" && typeof r === "string") {
  switch (op) {
    case "add": return l + r;

    case "eq": return l === r;
    case "neq": return l !== r;

    case "lt": return l < r;
    case "lte": return l <= r;
    case "gt": return l > r;
    case "gte": return l >= r;
  }
}
    if (typeof l === "boolean" && typeof r === "boolean") {
      switch (op) { case "and": return l && r; case "or": return l || r; case "eq": return l === r; case "neq": return l !== r; }
    }
    // 3R-F Fix (per direct instruction): TypeChecker already, correctly
    // and explicitly, allows mixing Int and Float in any arithmetic or
    // comparison operator (binaryOpResultType's own bothNum check,
    // promoting the result to Float) - the Lowerer passes the raw
    // bigint/number values through unchanged (no cast is inserted, nor
    // needed). The gap was entirely Consumer-side: evalBinop had no
    // path for a mixed bigint/number pair. A single, central numeric
    // normalization point - converting the bigint side to a real
    // JS number and re-dispatching through evalBinop itself - reuses
    // the existing, already-correct (number, number) branch's own
    // logic for every operator and both directions, rather than
    // duplicating switch(op) per operator per direction (11 operators
    // x 2 directions = 22 cases avoided). Placed after every
    // homogeneous-type branch, so bigint/bigint, string/string, and
    // boolean/boolean are completely unaffected.
    // H-A Fix (per direct instruction, Numeric Contract: Exact Integer
    // Preservation): the prior 3R-F normalization converted bigint to
    // Number unconditionally, which silently collapsed distinct large
    // integers (beyond Number.MAX_SAFE_INTEGER) into the same Number
    // value - confirmed live before this fix (2^53+1 collapsed to
    // 2^53). Per the Golden Contract (Acceptance Matrix, per direct
    // instruction): mixed operations remain allowed when the bigint
    // side is exactly representable as a Number (round-trips back to
    // the identical bigint) - normalize and continue, reusing the
    // existing (number,number) branch's own logic. When it is NOT
    // exactly representable, an explicit, clear numeric-precision
    // UrPanic is thrown instead of a silent, incorrect result -
    // matching PE011's own stated philosophy ("rejected rather than
    // silently corrupted"). Homogeneous bigint/bigint arithmetic
    // (which never loses precision, confirmed live) is completely
    // unaffected - only the mixed bigint/number branches are touched.
    if (typeof l === "bigint" && typeof r === "number") {
      const n = Number(l);
      if (BigInt(n) !== l) throw new UrPanic(`numeric precision error: integer ${l} cannot be represented exactly as a float — mixed int/float operation '${op}' would silently lose precision`);
      return evalBinop(op, n, r);
    }
    if (typeof l === "number" && typeof r === "bigint") {
      const n = Number(r);
      if (BigInt(n) !== r) throw new UrPanic(`numeric precision error: integer ${r} cannot be represented exactly as a float — mixed int/float operation '${op}' would silently lose precision`);
      return evalBinop(op, l, n);
    }
    throw new UrPanic(`interpreter error: unsupported binop '${op}' for operand types ${typeof l}/${typeof r}`);
  }

  function execTerminator(term: IRTerminator, ssa: Map<number, RtValue>, slots: Map<number, RtValue>): { kind: "return"; value: RtValue } | { kind: "jump"; target: number } {
    switch (term.kind) {
      case "return": {
        // Phase 3R-D (per direct instruction): a struct (or array, for
        // consistency) construction expression used directly as a
        // return value produces the same real IRValueRef shape
        // (structSlot/arraySlot) already consumed at the call-argument
        // boundary (3R-A) - read the real value from the referenced
        // slot instead of ssa.get(term.value.id), which would read the
        // dummy id:-1 placeholder. Needed together with call's own
        // resultStructSlot consumption for a complete, correct result -
        // confirmed live: without this, callFunction itself returns
        // undefined regardless of the call-site fix alone. A plain
        // scalar return value (neither field set) keeps its exact
        // prior behavior.
        if (term.value.structSlot !== undefined) return { kind: "return", value: slots.get(term.value.structSlot) };
        if (term.value.arraySlot !== undefined) return { kind: "return", value: slots.get(term.value.arraySlot) };
        return { kind: "return", value: ssa.get(term.value.id) };
      }
      case "return_void": return { kind: "return", value: undefined };
      case "branch": return { kind: "jump", target: term.target };
      case "cond_branch": {
        const cond = ssa.get(term.condition.id) as boolean;
        return { kind: "jump", target: cond ? term.thenTarget : term.elseTarget };
      }
    }
  }

  try {
    const result = callFunction(entryFn, []);
    // F3-INTERPRETER-MAIN-EXIT-CODE (RUNTIME_SPEC.md §6): a UR `main` returning `int` OR `bool` becomes the process
    // exit code. `bool` maps to 1/0 exactly as the C backend's main() wrapper does (`(int)ur_<module>_main()`).
    // Every other result kind keeps its previous behaviour (exit 0); ur_panic paths (101) are unchanged below.
    const exitCode = typeof result === "bigint" ? Number(result) : typeof result === "boolean" ? (result ? 1 : 0) : 0;
    return { stdout, stderr, exitCode };
  } catch (e) {
    if (e instanceof UrPanic) {
      return { stdout, stderr: stderr + `UR panic: ${e.message}\n`, exitCode: 101 };
    }
    // F2c Remediation, Option B (per direct instruction): narrowly recognize
    // the specific host-level stack-exhaustion exception at this single,
    // outermost entry point - the only place in the entire call chain where
    // a RangeError from unbounded UR-level recursion can be distinguished
    // from every other possible failure without touching callFunction or
    // execInstruction at all. The check matches ONLY a RangeError whose
    // message is V8's own stack-overflow text - any other exception
    // (including a completely different TypeError, such as the one A1
    // produces) is re-thrown completely unchanged below, exactly as before
    // this change, so no unrelated bug's raw exception is masked.
    if (e instanceof RangeError && /call stack/i.test(e.message)) {
      return { stdout, stderr: stderr + `UR panic: recursion depth exceeded the host execution limit\n`, exitCode: 101 };
    }
    throw e;
  }
}
