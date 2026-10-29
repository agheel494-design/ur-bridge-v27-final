// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: release identity consistency (UR-PM-G1-DECISION-001, option B)
// ─────────────────────────────────────────────────────────────────────────────
//
// Binding decision: the file VERSION is the single source of truth for the UR
// PRODUCT version. Every other place that states the product version must agree
// with it:
//   - the CLI (`ur version`, from src/cli/index.ts) - checked on its real output;
//   - the Windows installer definition (installer/windows/ur-bridge.iss,
//     `#define MyAppVersion`).
// The repository/package identity in package.json (ur-bridge-v27 / 27.0.0) is a
// SEPARATE, deliberately different identity and must stay a separate field: it is
// checked to be exactly ur-bridge-v27 / 27.0.0 (decision item 2), never compared with
// the product version.
// The release tool (r3, outside this tree) enforces the same rule on the archive.

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Pure check: every named source must equal the VERSION value. Returns the mismatches. */
function mismatches(source: string, others: Record<string, string | undefined>): string[] {
  return Object.entries(others)
    .filter(([, v]) => v !== source)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)} (VERSION = ${JSON.stringify(source)})`);
}

function readVersionFile(): string {
  return readFileSync(join(ROOT, "VERSION"), "utf-8").trim();
}

function cliVersion(): {
  value: string | undefined;
  raw: string;
  status: number | null;
} {
  const tsxCli = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const cliEntry = join(ROOT, "src", "cli", "index.ts");

  const r = spawnSync(
    process.execPath,
    [tsxCli, cliEntry, "version"],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
      windowsHide: true,
    },
  );

  const first = (r.stdout ?? "").split(/\r?\n/)[0].trim();
  const m = /^ur (\S+)$/.exec(first);

  const raw = [
    r.stdout ?? "",
    r.stderr ?? "",
    r.error ? `spawn error: ${r.error.message}` : "",
    r.signal ? `signal: ${r.signal}` : "",
  ].filter(Boolean).join("\n");

  return {
    value: m ? m[1] : undefined,
    raw,
    status: r.status,
  };
}

function installerVersion(): string | undefined {
  const iss = readFileSync(join(ROOT, "installer", "windows", "ur-bridge.iss"), "utf-8");
  const m = /^#define\s+MyAppVersion\s+"([^"]*)"\s*$/m.exec(iss);
  return m ? m[1] : undefined;
}

describe("Release identity: VERSION is the single source of truth for the UR product version", () => {
  it("VERSION holds exactly one well-formed product version", () => {
    const v = readVersionFile();
    expect(v, "VERSION must not be empty").not.toBe("");
    expect(v, `VERSION is not a semantic version: ${JSON.stringify(v)}`).toMatch(SEMVER);
  });

  it("the real CLI output (`ur version`) states the VERSION product version", () => {
    const v = readVersionFile();
    const cli = cliVersion();
    expect(cli.status, `ur version exited ${cli.status}: ${cli.raw}`).toBe(0);
    expect(mismatches(v, { "ur version": cli.value })).toEqual([]);
  }, 60_000);

  it("the Windows installer definition states the VERSION product version", () => {
    const v = readVersionFile();
    expect(mismatches(v, { "installer/windows/ur-bridge.iss MyAppVersion": installerVersion() })).toEqual([]);
  });

  it("the repository/package identity stays the separate, decided identity ur-bridge-v27 / 27.0.0 (not the product version source)", () => {
    // UR-PM-G1-DECISION-001 item 2: the repository/package identity is retained exactly as ur-bridge-v27 / 27.0.0.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    expect(pkg.name).toBe("ur-bridge-v27");
    expect(pkg.version).toBe("27.0.0");
  });

  it("the check itself reports a mismatch (negative control, no file is changed)", () => {
    expect(mismatches("1.0.0", { a: "1.0.0", b: "1.0.1", c: undefined })).toEqual([
      'b = "1.0.1" (VERSION = "1.0.0")',
      'c = undefined (VERSION = "1.0.0")',
    ]);
    expect(mismatches("1.0.0", { a: "1.0.0" })).toEqual([]);
  });
});
