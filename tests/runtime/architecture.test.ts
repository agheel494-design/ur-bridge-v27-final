// ─────────────────────────────────────────────────────────────────────────────
// UR — Tests: Runtime Architecture Invariants
// Level 2.4 — RUNTIME_SPEC.md §1.4
// ─────────────────────────────────────────────────────────────────────────────
//
// Enforces: "The Runtime must know nothing about any compiler stage."
// ur_runtime.h and ur_runtime.c must contain zero references to Lexer,
// Parser, AST, Semantic Analyzer, Type Checker, IR, or Optimizer. This
// mirrors tests/platform/architecture-rules.test.ts's existing Localization-
// layer independence checks — the same discipline applied to Runtime Core.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, "..", "..", "runtime");

const FORBIDDEN_TERMS = [
  "Lexer", "lexer", "Parser", "parser", "Semantic", "semantic",
  "TypeChecker", "typechecker", "TypeSystem", "typesystem",
  "Optimizer", "optimizer", "IRModule", "IRFunction", "IRInstruction",
  "AST", "ast.ts", "checkModuleInvariants",
  "Frontend", "frontend", "Backend", "backend",
];

/** Strips // line comments before scanning — comments *explaining* the independence invariant (like this file's own header comments) must not trigger a false positive against the very terms they're describing. */
function codeOnly(content: string): string {
  // RB3-TEST-REALIGNMENT (STALE REFERENCE / test heuristic, RB3-B2): block comments (/* ... */ and /** ... */) are
  // comments too. Without stripping them, the explanatory word "backend" inside ur_runtime.h's own doc block
  // (line ~208) was reported as a Compiler reference "in actual code" - a false positive of the heuristic.
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map(line => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

describe("Runtime — Compiler independence (RUNTIME_SPEC.md §1.4)", () => {
  for (const file of ["ur_runtime.h", "ur_runtime.c"]) {
    it(`${file} contains zero references to any Compiler stage (in actual code, not explanatory comments)`, () => {
      const content = codeOnly(readFileSync(join(RUNTIME_DIR, file), "utf-8"));
      for (const term of FORBIDDEN_TERMS) {
        expect(content.includes(term), `${file} contains forbidden Compiler-stage reference in code: "${term}"`).toBe(false);
      }
    });

    it(`${file} does not #include any TypeScript/compiler-generated file`, () => {
      const content = readFileSync(join(RUNTIME_DIR, file), "utf-8");
      // Runtime headers may only include standard C headers and its own
      // sibling header (ur_runtime.h from ur_runtime.c) — never anything
      // path-shaped that would suggest a dependency on generated/compiler code.
      const includeLines = content.split("\n").filter(l => l.trim().startsWith("#include"));
      for (const line of includeLines) {
        const isStdHeader = /#include\s*<[a-z_]+\.h>/.test(line);
        const isOwnHeader = line.includes('"ur_runtime.h"');
        expect(isStdHeader || isOwnHeader, `unexpected #include: "${line}"`).toBe(true);
      }
    });
  }

  it("Runtime's only three responsibilities (Memory, I/O, Panic) are reflected in the function table — no unrelated concerns", () => {
    const header = readFileSync(join(RUNTIME_DIR, "ur_runtime.h"), "utf-8");
    // Every function declared in the header must be one of these prefixes.
    const declLines = header.split("\n").filter(l => /^\s*(void|char\*|bool|int64_t|double)\s+ur_/.test(l));
    for (const line of declLines) {
      const isLifecycle = line.includes("ur_runtime_init") || line.includes("ur_runtime_shutdown");
      const isIO = line.includes("ur_print_") || line.includes("ur_input_");
      // RB3-TEST-REALIGNMENT (STALE REFERENCE, RB3-B2): this allow-list predates Gate A9.2 (garbage collection of
      // owning arrays). The A9.2 functions documented in ur_runtime.h are all MEMORY responsibility: allocation
      // registration (ur_register_array_allocation), array header access (ur_array_length) and the collector /
      // shadow-stack API (ur_gc_*). Lifecycle, I/O and Panic are unchanged; any other concern still fails here.
      const isMemory = line.includes("ur_free") || line.includes("ur_alloc") || line.includes("ur_register_array_allocation")
        || line.includes("ur_array_length") || /\bur_gc_\w+\(/.test(line);
      const isPanic = line.includes("ur_panic");
      expect(isLifecycle || isIO || isMemory || isPanic, `unexpected Runtime function declaration: "${line}"`).toBe(true);
    }
  });
});
