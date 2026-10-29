// INTEROP-ORACLE-GATE-001 — official interop regression (implementation authorized by PM).
//
// Oracle: for each of the 10 approved languages, `ur run <lang>.ur` through the REAL CLI entry point
// (node --import tsx src/cli/index.ts, tsx from the project's own node_modules — no PATH dependency)
// must exit with expected.json.result (49).
//
// PM amendments:
//  (1) A missing Python runtime is recorded as SKIP per language, but the gate guard below then FAILS:
//      a run in which any required language could not execute is never a passing run.
//  (2) The result must be proven to come from the interop path (UR source → CLI → FRI adapter → Python
//      runtime → result), not merely "exit 49". Therefore:
//        a. fixture binding is asserted: each program imports the `sq` package, whose manifest declares
//           runtime "python", module "square_impl", export "square", and square_impl.py exists;
//        b. a negative control re-runs the same program with PYTHON_BIN pointing to a non-existent command:
//           it must NOT exit 49 and must report FRI_RUNTIME_NOT_FOUND — so the 49 depends on the foreign
//           runtime actually running;
//        c. every run logs language, runtime, the Python command in effect, exit code, stdout and stderr.
//
// stdout/stderr are recorded, not asserted as the oracle. PYTHONDONTWRITEBYTECODE=1 is set for the child
// processes only, so the test never writes __pycache__/*.pyc into the repository.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DIR = fileURLToPath(new URL("./interop/", import.meta.url));
const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const EXPECTED: number = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf-8")).result;
const LANGS = ["ar", "de", "en", "es", "fr", "hi", "ja", "pt", "ru", "zh"];
const PKG = join(DIR, "ur_packages", "sq");
const MANIFEST = JSON.parse(readFileSync(join(PKG, "manifest.json"), "utf-8"));
const NO_PYTHON = "ur-interop-oracle-no-such-python";

// Same resolution rule as the interpreter (F-1): PYTHON_BIN, else python (win32) / python3.
const PY = process.env.PYTHON_BIN ?? (process.platform === "win32" ? "python" : "python3");
const pyCheck = spawnSync(PY, ["--version"], { encoding: "utf-8" });
const PY_OK = pyCheck.status === 0;
const PY_DESC = PY_OK ? `${PY} (${(pyCheck.stdout || pyCheck.stderr).trim()})` : `${PY} UNAVAILABLE (${pyCheck.error?.message ?? `exit ${pyCheck.status}`})`;
const skipped: string[] = [];

function runUr(lang: string, extraEnv: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, "run", `${lang}.ur`], {
    cwd: DIR, encoding: "utf-8", timeout: 90_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...extraEnv },
  });
}

describe("INTEROP-ORACLE: 10 multilingual programs via the real CLI", () => {
  it("the fixture set on disk is exactly the 10 approved languages", () => {
    const onDisk = readdirSync(DIR).filter(f => f.endsWith(".ur")).map(f => f.slice(0, -3)).sort();
    expect(onDisk).toEqual([...LANGS].sort());
  });

  it("the fixture package binds to the Python interop path", () => {
    expect(MANIFEST.runtime).toBe("python");
    expect(MANIFEST.module).toBe("square_impl");
    expect(MANIFEST.exports?.square).toBe("square");
    expect(existsSync(join(PKG, "square_impl.py"))).toBe(true);
    for (const lang of LANGS) {
      const src = readFileSync(join(DIR, `${lang}.ur`), "utf-8");
      expect(src.split(/\r?\n/)[0].trim(), `${lang}.ur must import sq`).toBe("import sq");
      expect(src.includes("square(7)"), `${lang}.ur must call square(7)`).toBe(true);
    }
    console.log(`interop runtime: python via ${PY_DESC}; package sq → ${MANIFEST.module}.square`);
  });

  for (const lang of LANGS) {
    it(`${lang}.ur exits with expected.json.result (${EXPECTED}) through the Python runtime`, (ctx) => {
      if (!PY_OK) { skipped.push(lang); console.log(`SKIP ${lang}: required runtime ${PY_DESC}`); ctx.skip(); return; }
      const r = runUr(lang, {});
      console.log(`[${lang}] runtime=python cmd=${PY} exit=${r.status} signal=${r.signal}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
      expect(r.error).toBeUndefined();
      expect(r.status).toBe(EXPECTED);
    }, 120_000);

    it(`${lang}.ur negative control: without the Python runtime it must NOT produce ${EXPECTED}`, (ctx) => {
      if (!PY_OK) { skipped.push(`${lang}(control)`); ctx.skip(); return; }
      const r = runUr(lang, { PYTHON_BIN: NO_PYTHON });
      console.log(`[${lang}/control] PYTHON_BIN=${NO_PYTHON} exit=${r.status}\n--- stderr ---\n${r.stderr}`);
      expect(r.error).toBeUndefined();
      expect(r.status).not.toBe(EXPECTED);
      expect(r.stdout + r.stderr).toContain("FRI_RUNTIME_NOT_FOUND");
    }, 120_000);
  }

  // Gate guard (PM amendment 1): SKIP is recorded above, but a run with any skipped required language
  // is INCOMPLETE and must not pass.
  it("gate guard: every required language actually executed (no SKIP)", () => {
    expect(PY_OK, `required Python runtime missing: ${PY_DESC} — INTEROP gate INCOMPLETE`).toBe(true);
    expect(skipped, "skipped required languages").toEqual([]);
  });
});
