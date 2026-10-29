#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge CLI shim — this is what package.json's "bin" field points to.
// ─────────────────────────────────────────────────────────────────────────────
//
// FIXED — real, externally-reported Critical bug: this shim previously
// ALWAYS invoked tsx against the raw TypeScript source, meaning ANY
// installer that doesn't run `npm install` (bundling node_modules/tsx)
// produced "tsx not found" immediately after installation, even though
// tsx is correctly declared as a dependency — the installer simply never
// resolved it. Fixed: this shim now prefers the REAL, COMPILED JavaScript
// at dist/src/cli/index.js (produced by `npm run build`, see
// tools/build.mjs) — running it with PLAIN node, no tsx involved at all.
// Only falls back to tsx + the raw TypeScript source when dist/ hasn't
// been built yet (a real, disclosed development-only fallback, not the
// path a real installed package should ever take).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compiledEntry = join(__dirname, "..", "dist", "src", "cli", "index.js");
const args = process.argv.slice(2);

let result;
if (existsSync(compiledEntry)) {
  result = spawnSync(process.execPath, [compiledEntry, ...args], { stdio: "inherit" });
} else {
  const cliSource = join(__dirname, "..", "src", "cli", "index.ts");
  const tsxBin = join(__dirname, "..", "node_modules", ".bin", "tsx");
  result = spawnSync(tsxBin, [cliSource, ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(`error: could not launch the UR CLI. Neither a built dist/ (run 'npm run build') nor a local tsx (run 'npm install') was found.`);
    process.exit(1);
  }
}
process.exit(result.status ?? 1);
