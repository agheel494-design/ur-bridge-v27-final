// MULTILINGUAL-110 GATE (D-6, UR-PM-DIRECTIVE-002) — 11 program sets x 10 languages = 110 cases.
//
// Each case runs `ur run <file>` through the REAL CLI entry point (node --import tsx src/cli/index.ts, tsx from
// the project's own node_modules, cwd = the set folder), exactly like interop.test.ts. The oracle is the set's own
// expected.json. Its keys decide the rule below; there is no other source of expected values.
//
//   print sets   (any key other than result/errorCode/exitCode/big/small):
//                exit 0, stderr empty, the non-empty stdout lines == the expected.json values in key order
//   ifelse set   ({big, small}): <lang>_big.ur prints expected.big and <lang>_small.ur prints expected.small,
//                each with exit 0 and stderr empty — both programs belong to one case
//   {result}     exit code == expected.result, stderr empty (stderr is checked because exit 1 is also the CLI's
//                generic error exit)
//   {errorCode}  exit != 0 and the output contains `error[<code>]`
//   {exitCode}   exit code == expected.exitCode and the output contains "UR panic"
//
// The `interop` folder is NOT part of this gate; it has its own gate in interop.test.ts.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("./", import.meta.url));
const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const LANGS = ["ar", "de", "en", "es", "fr", "hi", "ja", "pt", "ru", "zh"];
const SETS = [
  "arrays", "calculator", "control_flow_ifelse", "control_flow_loop", "errors", "errors_div_zero",
  "errors_index_oob", "errors_type", "errors_undefined_function", "functions", "strings",
];

type Expected = Record<string, string | number>;

function runUr(dir: string, file: string) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, "run", file], {
    cwd: dir, encoding: "utf-8", timeout: 90_000,
  });
}

function lines(s: string): string[] {
  return s.split(/\r?\n/).filter(l => l.trim() !== "");
}

function log(set: string, file: string, r: ReturnType<typeof runUr>) {
  console.log(`[${set}/${file}] exit=${r.status} signal=${r.signal}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
}

describe("MULTILINGUAL-110: 11 sets x 10 languages via the real CLI, oracle = expected.json", () => {
  it("the sets on disk are exactly the 11 gated sets plus the separately gated interop folder", () => {
    const onDisk = readdirSync(ROOT).filter(f => statSync(join(ROOT, f)).isDirectory()).sort();
    expect(onDisk).toEqual([...SETS, "interop"].sort());
  });

  for (const set of SETS) {
    const dir = join(ROOT, set);
    const expected: Expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf-8"));
    const keys = Object.keys(expected);
    const isIfElse = keys.length === 2 && keys.includes("big") && keys.includes("small");

    it(`${set}: the program files on disk are exactly one case per language`, () => {
      const want = isIfElse ? LANGS.flatMap(l => [`${l}_big.ur`, `${l}_small.ur`]) : LANGS.map(l => `${l}.ur`);
      const got = readdirSync(dir).filter(f => f.endsWith(".ur")).sort();
      expect(got).toEqual([...want].sort());
    });

    for (const lang of LANGS) {
      it(`${set}/${lang} matches expected.json`, () => {
        if (isIfElse) {
          for (const [variant, value] of [["big", expected.big], ["small", expected.small]] as const) {
            const file = `${lang}_${variant}.ur`;
            expect(existsSync(join(dir, file)), file).toBe(true);
            const r = runUr(dir, file);
            log(set, file, r);
            expect(r.error).toBeUndefined();
            expect(r.status, `${file} exit`).toBe(0);
            expect(r.stderr, `${file} stderr`).toBe("");
            expect(lines(r.stdout), `${file} stdout`).toEqual([String(value)]);
          }
          return;
        }
        const file = `${lang}.ur`;
        const r = runUr(dir, file);
        log(set, file, r);
        expect(r.error).toBeUndefined();
        if ("errorCode" in expected) {
          expect(r.status, "exit").not.toBe(0);
          expect(r.stdout + r.stderr).toContain(`error[${expected.errorCode}]`);
        } else if ("exitCode" in expected) {
          expect(r.status, "exit").toBe(expected.exitCode);
          expect(r.stdout + r.stderr).toContain("UR panic");
        } else if (keys.length === 1 && keys[0] === "result") {
          expect(r.status, "exit").toBe(expected.result);
          expect(r.stderr, "stderr").toBe("");
        } else {
          expect(r.status, "exit").toBe(0);
          expect(r.stderr, "stderr").toBe("");
          expect(lines(r.stdout), "stdout").toEqual(keys.map(k => String(expected[k])));
        }
      }, 120_000);
    }
  }
});
