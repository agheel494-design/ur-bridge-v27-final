// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: JS Bridge Runtime Executor (Node child process, no dlopen)
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the "Runtime Bridge" engine, per the adopted architectural
// classification (Native Bridge: C/Rust/Python via dlopen/dlsym vs.
// Runtime Bridge: JavaScript/Node via a real Node child process).
//
// Lives in tests/ (like harness-executor.ts) because it imports from
// "node:child_process"/"node:fs" - src/ stays platform-agnostic.
//
// For each JsFunctionCall batch: generates a real, temporary .mjs
// script that does require(moduleSpecifier)[propertyPath...] and, if
// it's a function, calls it with the given args - synchronously only
// (Async is a Bridge Extension, not attempted here). Runs it via a
// REAL `node` child process (spawnSync) - a genuine, live Node/V8
// runtime, unlike HarnessExecutor's own plain C binary. Reads back
// real JSON results from stdout. One process per execute() call,
// same real constraint already documented for the Native Bridge
// drivers.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export type JsFunctionCall = {
  moduleSpecifier: string;
  propertyPath: string[];
  args: unknown[];
};

export type JsCallResult =
  | { kind: "value"; value: unknown }
  | { kind: "error"; message: string };

export class JsRuntimeExecutor {
  execute(calls: JsFunctionCall[]): JsCallResult[] {
    if (calls.length === 0) return [];

    const dir = mkdtempSync(join(tmpdir(), "ur-js-bridge-"));
    const scriptPath = join(dir, "run.mjs");

    // REAL FIX (root cause, per direct review): the generated run.mjs
    // lives inside a TEMP directory - a relative moduleSpecifier
    // (e.g. "./calculator.js") would resolve relative to run.mjs's
    // own location, not the caller's. Every moduleSpecifier is now
    // resolved to a real, absolute file:// URL HERE, relative to the
    // real caller's own process.cwd() (not the temp script's
    // location), before it is ever embedded in the generated script -
    // import() itself only ever receives an absolute file:// URL,
    // never a bare relative path.
    const resolvedCalls = calls.map(call => {
      let specifier = call.moduleSpecifier;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        specifier = pathToFileURL(resolve(process.cwd(), specifier)).href;
      } else if (isAbsolute(specifier)) {
        specifier = pathToFileURL(specifier).href;
      }
      // else: bare package name (e.g. "sharp") or already a URL/scheme
      // — passed through unchanged, so Node's own real node_modules
      // resolution (or a genuinely-missing-package error) still
      // applies exactly as it would without this wrapper.
      return { ...call, moduleSpecifier: specifier };
    });

    const script = `
// REAL FINDING while generalizing this executor beyond the initial
// sharp proof-of-concept: require() (via createRequire) cannot load
// genuine ES Modules at all, and this project's own package.json
// itself has "type": "module", which silently makes plain .js files
// behave as ESM too (a real module in this repo needed to be
// renamed to .cjs to be loadable as CommonJS at all - confirmed live
// before this fix, not assumed). Dynamic import() correctly loads
// BOTH CommonJS and ES Modules with one unified mechanism - switched
// to it here for real generality, not just to fix ESM specifically.
const calls = ${JSON.stringify(resolvedCalls)};
const results = [];
for (const call of calls) {
  try {
    const mod = await import(call.moduleSpecifier);
    let target = mod;
    for (const key of call.propertyPath) {
      // REAL CJS/ESM interop difference discovered while generalizing
      // beyond the initial sharp proof-of-concept: some CommonJS
      // modules (e.g. sharp itself) expose their real exports only
      // under mod.default when loaded via dynamic import() - genuine
      // ES Modules do not have this indirection. Try the direct key
      // first (correct for ESM and many CJS modules), fall back to
      // .default[key] only if the direct key is missing.
      if (target && typeof target === "object" && key in target) {
        target = target[key];
      } else if (target && typeof target === "object" && "default" in target && target.default && key in target.default) {
        target = target.default[key];
      } else {
        target = target[key]; // let it be undefined naturally, surfaced below
      }
    }
    let value;
    if (typeof target === "function") {
      value = target(...call.args);
    } else {
      if (call.args.length > 0) throw new Error("cannot call args on a non-function property: " + call.propertyPath.join("."));
      value = target;
    }
    results.push({ kind: "value", value });
  } catch (e) {
    results.push({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
process.stdout.write("UR_JS_RESULTS:" + JSON.stringify(results) + "\\n");
`;
    writeFileSync(scriptPath, script);

    try {
      const run = spawnSync("node", [scriptPath], { stdio: "pipe", encoding: "utf-8" });
      if (run.status !== 0) {
        const msg = `real Node child process failed (exit ${run.status}): ${run.stderr || run.stdout}`;
        return calls.map(() => ({ kind: "error", message: msg }));
      }
      const marker = "UR_JS_RESULTS:";
      const line = run.stdout.split("\n").find((l) => l.startsWith(marker));
      if (!line) {
        return calls.map(() => ({ kind: "error", message: `real Node process produced no results line: ${run.stdout}` }));
      }
      return JSON.parse(line.slice(marker.length)) as JsCallResult[];
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    }
  }
}
