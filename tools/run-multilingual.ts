// ─────────────────────────────────────────────────────────────────────────────
// UR — Multilingual Equivalence Runner (Phase 1)
// ─────────────────────────────────────────────────────────────────────────────
//
// Scope, per the authorized P1-5 Phase 1 Design Gate: Calculator and
// Undefined-Variable-Error categories ONLY. Functions/Control Flow/Arrays/
// Strings/remaining Errors/Interop/OOP are explicitly out of scope for this
// script and this Gate - see V2_0_CAPABILITY_ROADMAP.md and the P1-5 Design
// Gate document for the full context.
//
// This script:
//   1. Discovers the supported-language list LIVE from the actual baseline
//      source (never from memory or a hardcoded list here).
//   2. Runs each language's fixture file via the real CLI (the same `ur run`/
//      `ur build` path a real user invokes - not an internal API shortcut).
//   3. Captures stdout, stderr, and exit code.
//   4. Compares the result against each category's own expected.json.
//   5. Reports a Language x Test result table.
//
// This script NEVER modifies expected.json or any fixture file to force a
// pass. If a category doesn't reproduce the already-known-correct result,
// this is reported as a Runner/Fixture Reproducibility Failure, per direct
// instruction - not silently patched around.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLI = join(REPO_ROOT, "src", "cli", "index.ts");
const TSX = process.env.TSX_BIN ?? "tsx";

type Row = { language: string; test: string; expected: string; actual: string; exitCode: number; status: "PASS" | "FAIL" };

function discoverLanguages(): string[] {
  const localizationIndexPath = join(REPO_ROOT, "src", "compiler", "localization", "index.ts");
  const src = readFileSync(localizationIndexPath, "utf-8");
  const match = src.match(/ALL_LANGUAGES[^=]*=\s*\[([^\]]+)\]/);
  if (!match) {
    throw new Error(
      `Could not discover language list from ${localizationIndexPath} - expected an ALL_LANGUAGES array. ` +
      `Refusing to fall back to a hardcoded list, per the original Gate's own mandatory rule.`
    );
  }
  const languages = Array.from(match[1]!.matchAll(/[A-Za-z0-9_]+/g)).map((m) => m[0]!);
  if (languages.length === 0) {
    throw new Error(`ALL_LANGUAGES matched but yielded zero language codes - refusing to proceed with an empty list.`);
  }
  return languages;
}

function runUr(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout: stdout.replace(/\r\n/g, "\n"), stderr: "", exitCode: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: err.stdout ? err.stdout.toString().replace(/\r\n/g, "\n") : "",
      stderr: err.stderr ? err.stderr.toString() : "",
      exitCode: err.status ?? 1,
    };
  }
}

function runCalculator(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "calculator");
  const file = join(dir, `${lang}.ur`);
  const expectedPath = join(dir, "expected.json");
  if (!existsSync(file)) {
    return [{ language: lang, test: "calculator", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf-8")) as Record<string, number>;
  const result = runUr(["run", file], dir);
  const lines = result.stdout.trim().split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const keys = ["addition", "subtraction", "multiplication", "division"];
  const rows: Row[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const actual = lines[i] ?? "(no output)";
    const expectedVal = String(expected[key]);
    const status: "PASS" | "FAIL" = actual === expectedVal && result.exitCode === 0 ? "PASS" : "FAIL";
    rows.push({ language: lang, test: `calculator.${key}`, expected: expectedVal, actual, exitCode: result.exitCode, status });
  }
  return rows;
}

function runErrorCase(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "errors");
  const file = join(dir, `${lang}.ur`);
  const expectedPath = join(dir, "expected.json");
  if (!existsSync(file)) {
    return [{ language: lang, test: "errors.undefinedVariable", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf-8")) as { errorCode: string };
  const result = runUr(["build", file], dir);
  const combined = result.stdout + result.stderr;
  const codeMatch = combined.match(/error\[([A-Z0-9]+)\]/);
  const actualCode = codeMatch ? codeMatch[1]! : "(no code found)";
  const status: "PASS" | "FAIL" = actualCode === expected.errorCode ? "PASS" : "FAIL";
  return [{ language: lang, test: "errors.undefinedVariable", expected: expected.errorCode, actual: actualCode, exitCode: result.exitCode, status }];
}

function runFunctions(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "functions");
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: "functions", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as Record<string, number>;
  const result = runUr(["run", file], dir);
  const lines = result.stdout.trim().split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const keys = ["r1", "r2", "r3"];
  return keys.map((key, i) => {
    const actual = lines[i] ?? "(no output)";
    const expectedVal = String(expected[key]);
    const status: "PASS" | "FAIL" = actual === expectedVal && result.exitCode === 0 ? "PASS" : "FAIL";
    return { language: lang, test: `functions.${key}`, expected: expectedVal, actual, exitCode: result.exitCode, status };
  });
}

function runControlFlowIfElse(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "control_flow_ifelse");
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { big: string; small: string };
  const rows: Row[] = [];
  for (const [tag, key] of [["big", "big"], ["small", "small"]] as const) {
    const file = join(dir, `${lang}_${tag}.ur`);
    if (!existsSync(file)) { rows.push({ language: lang, test: `control_flow.if_${tag}`, expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }); continue; }
    const result = runUr(["run", file], dir);
    const actual = result.stdout.trim();
    const status: "PASS" | "FAIL" = actual === expected[key] && result.exitCode === 0 ? "PASS" : "FAIL";
    rows.push({ language: lang, test: `control_flow.if_${tag}`, expected: expected[key], actual, exitCode: result.exitCode, status });
  }
  return rows;
}

function runControlFlowLoop(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "control_flow_loop");
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: "control_flow.loop", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { sum: number };
  const result = runUr(["run", file], dir);
  const actual = result.stdout.trim();
  const status: "PASS" | "FAIL" = actual === String(expected.sum) && result.exitCode === 0 ? "PASS" : "FAIL";
  return [{ language: lang, test: "control_flow.loop", expected: String(expected.sum), actual, exitCode: result.exitCode, status }];
}

function runArrays(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "arrays");
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: "arrays", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { first: number; third: number; sum: number; afterWrite: number };
  const result = runUr(["run", file], dir);
  const lines = result.stdout.trim().split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const keys: (keyof typeof expected)[] = ["first", "third", "sum", "afterWrite"];
  return keys.map((key, i) => {
    const actual = lines[i] ?? "(no output)";
    const expectedVal = String(expected[key]);
    const status: "PASS" | "FAIL" = actual === expectedVal && result.exitCode === 0 ? "PASS" : "FAIL";
    return { language: lang, test: `arrays.${key}`, expected: expectedVal, actual, exitCode: result.exitCode, status };
  });
}

function runStrings(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "strings");
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: "strings.equality", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { result: number };
  const result = runUr(["run", file], dir);
  const actualCode = result.exitCode;
  const status: "PASS" | "FAIL" = actualCode === expected.result ? "PASS" : "FAIL";
  return [{ language: lang, test: "strings.equality", expected: String(expected.result), actual: String(actualCode), exitCode: result.exitCode, status }];
}

function runErrorByCode(lang: string, category: string, buildArgs: "build" | "run"): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", category);
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: category, expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { errorCode?: string; exitCode?: number };
  const result = runUr([buildArgs, file], dir);
  if (expected.errorCode !== undefined) {
    const combined = result.stdout + result.stderr;
    const codeMatch = combined.match(/error\[([A-Z0-9]+)\]/);
    const actualCode = codeMatch ? codeMatch[1]! : "(no code found)";
    const status: "PASS" | "FAIL" = actualCode === expected.errorCode ? "PASS" : "FAIL";
    return [{ language: lang, test: category, expected: expected.errorCode, actual: actualCode, exitCode: result.exitCode, status }];
  }
  const status: "PASS" | "FAIL" = result.exitCode === expected.exitCode ? "PASS" : "FAIL";
  return [{ language: lang, test: category, expected: String(expected.exitCode), actual: String(result.exitCode), exitCode: result.exitCode, status }];
}

function runInterop(lang: string): Row[] {
  const dir = join(__dirname, "..", "tests", "multilingual", "interop");
  const file = join(dir, `${lang}.ur`);
  if (!existsSync(file)) return [{ language: lang, test: "interop", expected: "(fixture exists)", actual: "MISSING FIXTURE", exitCode: -1, status: "FAIL" }];
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8")) as { result: number };
  const result = runUr(["run", file], dir);
  const status: "PASS" | "FAIL" = result.exitCode === expected.result ? "PASS" : "FAIL";
  return [{ language: lang, test: "interop.square", expected: String(expected.result), actual: String(result.exitCode), exitCode: result.exitCode, status }];
}

function main(): void {
  const languages = discoverLanguages();
  console.log(`Languages discovered from baseline: ${languages.join(", ")} (${languages.length} total)\n`);

  const allRows: Row[] = [];
  for (const lang of languages) {
    allRows.push(...runCalculator(lang));
    allRows.push(...runErrorCase(lang));
    allRows.push(...runFunctions(lang));
    allRows.push(...runControlFlowIfElse(lang));
    allRows.push(...runControlFlowLoop(lang));
    allRows.push(...runArrays(lang));
    allRows.push(...runStrings(lang));
    allRows.push(...runErrorByCode(lang, "errors_undefined_function", "build"));
    allRows.push(...runErrorByCode(lang, "errors_type", "build"));
    allRows.push(...runErrorByCode(lang, "errors_div_zero", "run"));
    allRows.push(...runErrorByCode(lang, "errors_index_oob", "run"));
    allRows.push(...runInterop(lang));
  }

  console.log("Language | Test | Expected | Actual | Exit Code | Status");
  console.log("---------|------|----------|--------|-----------|-------");
  for (const row of allRows) {
    console.log(`${row.language} | ${row.test} | ${row.expected} | ${row.actual} | ${row.exitCode} | ${row.status}`);
  }

  const total = allRows.length;
  const passed = allRows.filter((r) => r.status === "PASS").length;
  const failed = total - passed;

  console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFAILED ROWS:");
    for (const row of allRows.filter((r) => r.status === "FAIL")) {
      console.log(`  ${row.language} / ${row.test}: expected=${row.expected} actual=${row.actual} exitCode=${row.exitCode}`);
    }
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main();

