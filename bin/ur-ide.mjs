#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UR IDE launcher shim — what package.json's "bin" field points to for the IDE.
// ─────────────────────────────────────────────────────────────────────────────
//
// Same fix as bin/ur.mjs: prefers the real, compiled dist/src/ide/server.js
// (run with plain node, no tsx) — falls back to tsx + raw TypeScript only
// when dist/ hasn't been built (development-only fallback).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compiledEntry = join(__dirname, "..", "dist", "src", "ide", "server.js");

let result;
if (existsSync(compiledEntry)) {
  result = spawnSync(process.execPath, [compiledEntry], { stdio: "inherit" });
} else {
  const serverSource = join(__dirname, "..", "src", "ide", "server.ts");
  const tsxBin = join(__dirname, "..", "node_modules", ".bin", "tsx");
  result = spawnSync(tsxBin, [serverSource], { stdio: "inherit" });
  if (result.error) {
    console.error(`error: could not launch the UR IDE. Neither a built dist/ (run 'npm run build') nor a local tsx (run 'npm install') was found.`);
    process.exit(1);
  }
}
process.exit(result.status ?? 1);
