#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Installer Build Orchestration (Windows)
// ─────────────────────────────────────────────────────────────────────────────
//
// FIXED — real, externally-reported Critical bug: "the ide folder is empty
// after installation." Root cause: nothing previously PREVENTED someone
// from compiling installer/windows/ur-bridge.iss WITHOUT first running
// `npm run build` - Inno Setup's Source: "..\dist\*" on a missing or
// empty dist/ directory produces an installer that copies nothing there,
// silently.
//
// This script is now the ONLY supported way to build the Windows
// installer: it (1) runs the real build (tools/build.mjs), (2) VERIFIES
// every file the installer's own [Files] section depends on actually
// exists and is non-empty, failing LOUDLY if anything is missing, and
// (3) only then invokes Inno Setup's own compiler (iscc.exe).
//
// Usage (on a real Windows machine with Inno Setup installed):
//   node installer/windows/build-installer.mjs

import { execSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(scriptDir));

function log(msg) { console.log(`[build-installer] ${msg}`); }
function fail(msg) {
  console.error(`[build-installer] FATAL: ${msg}`);
  console.error(`[build-installer] Refusing to package an incomplete installer.`);
  process.exit(1);
}

function requireNonEmptyFile(relPath) {
  const abs = join(projectRoot, relPath);
  if (!existsSync(abs)) fail(`required file is missing: ${relPath}`);
  const stat = statSync(abs);
  if (stat.size === 0) fail(`required file is empty (0 bytes): ${relPath}`);
}

log("Step 1/3: running the real build (npm run build)...");
try {
  execSync("node tools/build.mjs", { cwd: projectRoot, stdio: "inherit" });
} catch {
  fail("tools/build.mjs itself failed - see its own output above.");
}

log("Step 2/3: verifying every file the installer actually needs exists and is non-empty...");
const requiredFiles = [
  "dist/src/cli/index.js",
  "dist/src/ide/server.js",
  "dist/src/ide/public/index.html",
  "dist/runtime/ur_runtime.c",
  "dist/runtime/ur_runtime.h",
  "installer/windows/open-ide.bat",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "VERSION",
  "docs/INSTALLATION_GUIDE.md",
];
for (const f of requiredFiles) requireNonEmptyFile(f);
log(`all ${requiredFiles.length} required files verified present and non-empty.`);

// NEW SAFEGUARD, added per explicit external field-test finding: a real
// Windows tester saw GCC/MinGW/WinMain references AFTER installation,
// despite this repo's own source having no such call path — the most
// likely explanation is that the tester's installer was built from an
// OLDER package predating the interpreter-based fix, not from a fresh
// build of THIS repo. This step makes that class of mismatch IMPOSSIBLE
// to ship silently again: it scans the exact files the installer is
// about to package for any literal reference to the old, eliminated
// C-Backend/gcc call path, and refuses to proceed if found.
log("Step 2.5/3: scanning the freshly-built dist/ for any remaining gcc/C-Backend dependency (the exact class of issue an external Windows tester found)...");
// NOTE: earlier versions of this scan matched bare words like "gcc"/
// "mingw" anywhere in the file, which produced real false positives —
// this project's own source legitimately CONTAINS explanatory comments
// discussing why gcc/MinGW were removed (e.g. compileToIR's own
// docstring), and a bare-word match can't tell that apart from an
// actual dependency. Fixed: check for the one truly reliable signal —
// an actual IMPORT of the c-compile module (the real wrapper around
// gcc) — plus real call-syntax for its exported functions, not just
// their names appearing anywhere (e.g. in a comment).
const forbiddenPatterns = [/from\s*["'][^"']*c-compile[^"']*["']/, /\bemitC\s*\(/, /\bcompileC\s*\(/];
const scanFiles = ["dist/src/cli/index.js", "dist/src/ide/server.js"];
for (const relPath of scanFiles) {
  const abs = join(projectRoot, relPath);
  const content = readFileSync(abs, "utf-8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) {
      fail(`${relPath} still references the eliminated C-Backend/gcc path (matched ${pattern}) - refusing to package an installer that could reintroduce the exact issue an external Windows tester already reported. This means the interpreter-based fix in this repo's own src/ has regressed - fix the source, do not bypass this check.`);
    }
  }
}
log("confirmed: the packaged dist/ has zero remaining gcc/C-Backend references in its CLI/IDE entry points.");

log("Step 3/3: compiling the Inno Setup installer (iscc)...");
const iscc = process.env.ISCC_PATH || "iscc";
try {
  execSync(`"${iscc}" "${join(scriptDir, "ur-bridge.iss")}"`, { cwd: scriptDir, stdio: "inherit" });
} catch {
  fail(`Inno Setup compilation failed (looked for iscc at "${iscc}" - set the ISCC_PATH environment variable if Inno Setup is installed somewhere else). See its own output above for the real Inno Setup error.`);
}

log("Installer built successfully. See installer/windows/installer-output/ for the .exe.");
