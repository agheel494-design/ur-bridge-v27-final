// ─────────────────────────────────────────────────────────────────────────────
// UR — Tests: Backend has ZERO hardcoded Runtime function names
// Level 2.4 — per explicit review requirement
// ─────────────────────────────────────────────────────────────────────────────
//
// The Backend (src/backend/c/emit-c.ts) must discover which extern to call
// for program lifecycle purely via ExternKind + lifecycleRole — never by
// writing any Runtime function's literal name in its own source. This test
// scans emit-c.ts's actual source code (not its output) for forbidden
// literals, guaranteeing this stays true regardless of future edits.
//
// Adding, renaming, or replacing any Runtime function must NEVER require
// touching emit-c.ts, as long as its lifecycleRole (if any) is set
// correctly in src/shared/runtime-table.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMIT_C_PATH = join(__dirname, "..", "..", "..", "src", "backend", "c", "emit-c.ts");

/** Strips // line comments and /* block comments before scanning — this test checks CODE, not documentation that legitimately discusses these names (e.g. explaining WHY they must never appear in code). */
function codeOnly(content: string): string {
  const noBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlockComments
    .split("\n")
    .map(line => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const FORBIDDEN_RUNTIME_LITERALS = [
  "ur_runtime_init",
  "ur_runtime_shutdown",
  "ur_print_int",
  "ur_print_float",
  "ur_print_bool",
  "ur_print_string",
  "ur_input_string",
  "ur_free",
  "ur_panic",
];

describe("Backend — emit-c.ts contains zero hardcoded Runtime function names", () => {
  const source = codeOnly(readFileSync(EMIT_C_PATH, "utf-8"));

  for (const literal of FORBIDDEN_RUNTIME_LITERALS) {
    it(`does not contain the literal "${literal}" anywhere in its code`, () => {
      expect(source.includes(literal), `emit-c.ts contains a hardcoded Runtime function name: "${literal}"`).toBe(false);
    });
  }

  it("discovers Init/Shutdown purely via lifecycleRole (the sanctioned mechanism)", () => {
    expect(source).toContain('lifecycleRole === "init"');
    expect(source).toContain('lifecycleRole === "shutdown"');
  });

  it("does not contain any generic 'ur_' prefix string literal outside of the sanctioned lifecycleRole/kind lookups", () => {
    // A broader sweep: find any quoted string starting with "ur_" anywhere
    // in the code. The only ones expected are things like qualifiedName
    // prefixes ("ur_") used generically for ALL UR symbols (not
    // Runtime-specific), which is fine — but any *_-suffixed Runtime-looking
    // literal should have already been caught above. This test documents
    // the sweep exists, for defense-in-depth against a new Runtime
    // function being hardcoded under a name not yet in FORBIDDEN_RUNTIME_LITERALS.
    const quotedUrStrings = source.match(/["'`]ur_[a-z_]+["'`]/g) ?? [];
    for (const match of quotedUrStrings) {
      const isKnownGenericPrefix = match === '"ur_"' || match === "'ur_'" || match === "`ur_`";
      expect(isKnownGenericPrefix, `Found a suspicious "ur_*" string literal in emit-c.ts: ${match} — verify this isn't a new hardcoded Runtime name`).toBe(true);
    }
  });
});
