// D-8 (UR-PM-DIRECTIVE-002) — UR-in-UR equivalence: selfhost/lexer/charclass.ur vs the TypeScript reference.
//
// Reference: isUnicodeLetter / isIdentStart / isIdentContinue, taken VERBATIM from src/compiler/frontend/lexer.ts
// at test time (the lexer does not export them, and this gate does not change src/). Only the TypeScript
// parameter/return annotations are removed before evaluation; the test asserts that each function was found
// exactly once and that the removed text is exactly that annotation, so a reshaped source fails loudly.
//
// Subject: charclass.ur run through the REAL CLI (node <project tsx>/cli src/cli/index.ts run), cwd = its folder.
// Oracle: for each of the 16 blocks of 4096 code points (0..65535), the four numbers printed by charclass.ur
// (identStart count, identContinue count, and their positional sums) must equal the same numbers computed from
// the TypeScript reference. A negative control proves the comparison detects a one-code-point change.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
// tsx is resolved from this project's own node_modules (as in tests/cli/decision-2d-boundary-protection.test.ts),
// so the child does not depend on the working directory it is started in.
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const LEXER = fileURLToPath(new URL("../../src/compiler/frontend/lexer.ts", import.meta.url));
const UR_DIR = fileURLToPath(new URL("../../selfhost/lexer/", import.meta.url));
const UR_FILE = "charclass.ur";
const NAMES = ["isUnicodeLetter", "isIdentStart", "isIdentContinue"] as const;
const SIG = "(cp: number): boolean {";

function extract(src: string, name: string): string {
  const head = `function ${name}${SIG}`;
  const at = src.indexOf(head);
  expect(at, `${name} not found in lexer.ts`).toBeGreaterThan(-1);
  expect(src.indexOf(head, at + 1), `${name} found more than once`).toBe(-1);
  let depth = 0;
  for (let k = at + head.length - 1; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(at, k + 1).replace(SIG, "(cp) {");
  }
  throw new Error(`${name}: unbalanced braces`);
}

function reference(): number[] {
  const src = readFileSync(LEXER, "utf-8");
  const code = NAMES.map(n => extract(src, n)).join("\n");
  const [start, cont] = new Function(`${code}\nreturn [isIdentStart, isIdentContinue];`)() as Array<(cp: number) => boolean>;
  const out: number[] = [];
  for (let b = 0; b < 16; b++) {
    let s = 0, c = 0, sw = 0, cw = 0;
    for (let cp = b * 4096; cp < (b + 1) * 4096; cp++) {
      const off = cp - b * 4096 + 1;
      if (start(cp)) { s++; sw += off; }
      if (cont(cp)) { c++; cw += off; }
    }
    out.push(s, c, sw, cw);
  }
  return out;
}

function runUr(dir: string, file: string) {
  return spawnSync(process.execPath, [TSX_CLI, CLI, "run", file], { cwd: dir, encoding: "utf-8", timeout: 180_000 });
}

function printed(stdout: string): number[] {
  return stdout.split(/\r?\n/).filter(l => l.trim() !== "").map(Number);
}

describe("UR-in-UR: charclass.ur is equivalent to the TypeScript lexer predicates over 0..65535", () => {
  const ref = reference();

  it("the reference is non-trivial (letters and continue-only marks are present)", () => {
    expect(ref.length).toBe(64);
    expect(ref[0]).toBeGreaterThan(0);
    expect(ref[1]).toBeGreaterThan(ref[0]);
  });

  it("charclass.ur through the real CLI prints exactly the reference numbers", () => {
    const r = runUr(UR_DIR, UR_FILE);
    console.log(`[charclass] exit=${r.status}\n--- stderr ---\n${r.stderr}`);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(printed(r.stdout)).toEqual(ref);
  }, 240_000);

  it("negative control: narrowing one range by one code point is detected", () => {
    const src = readFileSync(join(UR_DIR, UR_FILE), "utf-8");
    const from = "if cp >= 2406 && cp <= 2415";
    expect(src.split(from).length - 1).toBe(1);
    const tmp = mkdtempSync(join(tmpdir(), "ur-charclass-mutant-"));
    try {
      writeFileSync(join(tmp, UR_FILE), src.replace(from, "if cp >= 2406 && cp <= 2414"));
      const r = runUr(tmp, UR_FILE);
      expect(r.status, r.stderr).toBe(0);
      expect(printed(r.stdout)).not.toEqual(ref);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 240_000);
});
