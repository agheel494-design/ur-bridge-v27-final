#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Real Build Script
// ─────────────────────────────────────────────────────────────────────────────
//
// Fixes a real, externally-reported Critical bug: `npm run build` previously
// only ran `tsc --noEmit` (a type-check, not a real build) - the CLI/IDE were
// only ever runnable via `tsx` (transpile-at-runtime), which is why an
// installer that doesn't run `npm install` (bundling node_modules) produced
// "tsx not found" after installation.
//
// This script performs a REAL build: compiles all TypeScript to plain
// JavaScript (via tsconfig.build.json, which unifies src/ and tools/ under
// one rootDir so their relative imports resolve correctly in the compiled
// output), then copies the non-TypeScript assets that tsc alone does not
// handle: the Runtime Core's real C source (runtime/*.c, *.h) and the IDE's
// frontend HTML (src/ide/public/index.html).
//
// After this script runs, `node dist/src/cli/index.js` and
// `node dist/src/ide/server.js` work with PLAIN node - no tsx required at
// runtime at all. tsx remains a devDependency (used by tests), not
// something the packaged, installed CLI/IDE need anymore.

import { execSync } from "node:child_process";
import { mkdirSync, copyFileSync, readdirSync, existsSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(projectRoot, "dist");

function log(msg) { console.log(`[build] ${msg}`); }

function copyDir(srcDir, destDir, filter) {
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (filter && !filter(entry)) continue;
    copyFileSync(join(srcDir, entry), join(destDir, entry));
  }
}

log("cleaning dist/");
rmSync(distDir, { recursive: true, force: true });

log("compiling TypeScript (tsconfig.build.json)...");
execSync("npx tsc -p tsconfig.build.json", { cwd: projectRoot, stdio: "inherit" });
log("TypeScript compiled cleanly (zero diagnostics).");

log("copying Runtime Core C source (runtime/*.c, *.h)...");
copyDir(join(projectRoot, "runtime"), join(distDir, "runtime"), name => name.endsWith(".c") || name.endsWith(".h"));

log("copying IDE frontend (src/ide/public/index.html)...");
mkdirSync(join(distDir, "src", "ide", "public"), { recursive: true });
copyFileSync(join(projectRoot, "src", "ide", "public", "index.html"), join(distDir, "src", "ide", "public", "index.html"));

// NEW, per explicit external field-test finding: a real Windows tester
// could not tell whether the installed CLI actually contained the
// interpreter-based (gcc-free) fix or an older, gcc-dependent build —
// there was no way to verify this from the installed product alone.
// This writes a real, verifiable build stamp: a content hash of the
// exact files that determine whether the gcc-free fix is present,
// plus a human-readable build timestamp. `ur version` (see
// src/cli/index.ts) prints this when available, so anyone can
// immediately confirm which build they actually have, closing this
// ambiguity for good.
log("writing a verifiable build stamp (dist/BUILD_INFO.json)...");
// G-9 (UR-PM-DIRECTIVE-117): reproducible builds. If SOURCE_DATE_EPOCH is set (reproducible-builds.org convention),
// the stamp uses it instead of the wall clock, so two builds of the same source give byte-identical dist/ and archives.
// Unset -> the wall clock, exactly as before.
function buildTime() {
  const e = process.env.SOURCE_DATE_EPOCH;
  if (e === undefined || e === "") return new Date();
  if (!/^[0-9]+$/.test(e)) { console.error(`[build] SOURCE_DATE_EPOCH must be a non-negative integer, got ${JSON.stringify(e)}`); process.exit(1); }
  return new Date(Number(e) * 1000);
}
const hashInputs = [
  readFileSync(join(projectRoot, "src", "cli", "index.ts"), "utf-8"),
  readFileSync(join(projectRoot, "src", "interpreter", "interpret.ts"), "utf-8"),
  readFileSync(join(projectRoot, "src", "ide", "server.ts"), "utf-8"),
].join("\n---\n");
const buildHash = createHash("sha256").update(hashInputs).digest("hex").slice(0, 12);
const buildInfo = {
  builtAt: buildTime().toISOString(),
  contentHash: buildHash,
  gccFree: true, // this build's own CLI/IDE source path — verified by the scan step in installer/windows/build-installer.mjs before packaging
};
writeFileSync(join(distDir, "BUILD_INFO.json"), JSON.stringify(buildInfo, null, 2), "utf-8");
log(`build stamp: ${buildHash} (built ${buildInfo.builtAt})`);

log("verifying the build actually works (real smoke test)...");
const versionOut = execSync(`node ${join(distDir, "src", "cli", "index.js")} version`, { encoding: "utf-8" });
if (!versionOut.trim().startsWith("ur ")) {
  console.error(`[build] smoke test failed - unexpected output: ${versionOut}`);
  process.exit(1);
}
log(`smoke test passed: ${versionOut.trim()}`);
log("build complete. dist/ is fully self-contained - no tsx needed at runtime.");
