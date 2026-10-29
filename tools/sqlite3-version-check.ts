// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Native: SQLite3 ABI Version Checker
// Phase 7 — Native Ecosystem Hardening — SQLite3 Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// Calls the REAL sqlite3_libversion() and sqlite3_sourceid() on the
// real library (.so) via a tiny C harness compiled and executed at check
// time. Compares the result against the version the header was authored
// for. A major-version mismatch (e.g. SQLite 4.x when the header targets
// 3.x) halts further binding generation and emits a clear diagnostic —
// the binding generator should never silently produce bindings for a
// library whose ABI may have changed incompatibly.
//
// Minor-version mismatches (e.g. header for 3.39.0, library is 3.45.1)
// are reported as warnings but do not halt generation — the SQLite3
// public C API has maintained strict backward compatibility within the
// 3.x series for many years.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export type VersionCheckResult = {
  compatible: boolean;
  headerVersion: string;  // version the header was written for
  runtimeVersion: string; // actual sqlite3_libversion() result
  runtimeSourceId: string; // actual sqlite3_sourceid() result
  diagnostics: string[];  // errors (incompatible) or warnings (minor mismatch)
};

/**
 * Parses a SQLite3 version string into its numeric components.
 * Format: "MAJOR.MINOR.PATCH", e.g. "3.45.1".
 */
export function parseSqliteVersion(v: string): { major: number; minor: number; patch: number } | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: parseInt(m[1]!), minor: parseInt(m[2]!), patch: parseInt(m[3]!) };
}

/**
 * Compares expected vs. actual versions per the compatibility policy:
 * - Major mismatch → incompatible (halt generation)
 * - Minor mismatch → warning only (generation proceeds)
 * - Patch mismatch → silent (always compatible)
 */
export function checkVersionCompatibility(
  headerVersion: string,
  runtimeVersion: string,
  runtimeSourceId: string,
): VersionCheckResult {
  const expected = parseSqliteVersion(headerVersion);
  const actual = parseSqliteVersion(runtimeVersion);
  const diagnostics: string[] = [];

  if (!expected) {
    diagnostics.push(`[ERROR] Could not parse header version string: "${headerVersion}"`);
    return { compatible: false, headerVersion, runtimeVersion, runtimeSourceId, diagnostics };
  }
  if (!actual) {
    diagnostics.push(`[ERROR] Could not parse runtime version string: "${runtimeVersion}"`);
    return { compatible: false, headerVersion, runtimeVersion, runtimeSourceId, diagnostics };
  }

  if (actual.major !== expected.major) {
    diagnostics.push(
      `[ERROR] Major version mismatch: header targets SQLite ${headerVersion} (major=${expected.major}), ` +
      `but the runtime library is ${runtimeVersion} (major=${actual.major}). ` +
      `The SQLite public C API is NOT guaranteed compatible across major versions. ` +
      `Binding generation halted. Update the header or the library to match.`
    );
    return { compatible: false, headerVersion, runtimeVersion, runtimeSourceId, diagnostics };
  }

  if (actual.minor !== expected.minor) {
    diagnostics.push(
      `[WARN] Minor version mismatch: header targets SQLite ${headerVersion}, ` +
      `runtime is ${runtimeVersion}. The SQLite3 C API has maintained strict ` +
      `backward compatibility within the 3.x series — this is expected to work ` +
      `but has not been specifically regression-tested for this combination.`
    );
  }

  return { compatible: true, headerVersion, runtimeVersion, runtimeSourceId, diagnostics };
}

/**
 * Resolves the real SQLite3 runtime version by compiling and running a
 * minimal C program that links against the real library and calls
 * sqlite3_libversion() / sqlite3_sourceid() for real. Returns null if
 * gcc is not available or the library cannot be found.
 *
 * This is not a dlopen()-based approach because we need the actual
 * sqlite3_libversion string at the TypeScript layer without writing a
 * native addon — a tiny compiled program is the simplest genuinely real
 * approach within the current environment constraints.
 */
export function resolveRuntimeVersion(libraryPath: string): {
  version: string; sourceId: string
} | null {
  const dir = mkdtempSync(join(tmpdir(), "ur-sqlite-ver-"));
  const src = join(dir, "vcheck.c");
  const bin = join(dir, "vcheck");

  writeFileSync(src, `
#include <stdio.h>
extern const char* sqlite3_libversion(void);
extern const char* sqlite3_sourceid(void);
int main(void) {
  printf("%s\\n%s\\n", sqlite3_libversion(), sqlite3_sourceid());
  return 0;
}
`);

  const compile = spawnSync("gcc", ["-o", bin, src, libraryPath, "-Wl,-rpath," + dirname(libraryPath)], { stdio: "pipe" });
  // Fallback: try linking by name if direct path doesn't work
  if (compile.status !== 0) {
    const compile2 = spawnSync("gcc", ["-o", bin, src, "-L" + dirname(libraryPath), "-lsqlite3"], { stdio: "pipe" });
    if (compile2.status !== 0) return null;
  }

  const run = spawnSync(bin, [], { stdio: "pipe" });
  if (run.status !== 0) return null;

  const lines = (run.stdout?.toString() ?? "").trim().split("\n");
  if (lines.length < 2) return null;

  try { unlinkSync(src); unlinkSync(bin); } catch { /* cleanup best-effort */ }

  return { version: lines[0]!.trim(), sourceId: lines[1]!.trim() };
}
