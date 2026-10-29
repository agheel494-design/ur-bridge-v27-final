// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Architecture Rules (Static Invariants)
// Phase 7.5 — Native Ecosystem Expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests enforce the architecture constraints described in the Phase 7.5
// directive by READING the actual source file contents and asserting that
// no forbidden import or pattern exists. They run at every CI check and
// cannot be satisfied by mocking — a real violation in a real file will
// cause a real failure.
//
// Rules enforced:
//   1. Generic layer (src/ffi/native/) does NOT import from any specific driver.
//   2. Platform SDK (src/platform-sdk/) does NOT import from specific drivers.
//   3. No library-specific names (sqlite3, opencv, onnx, ros2) in generic layer.
//   4. No circular: drivers must not import from Platform SDK.
//   5. DriverRegistry does NOT contain register*() methods for specific libraries.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";

function readFile(path: string): string {
  return readFileSync(path, "utf-8");
}

function allTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...allTsFiles(full));
    else if (full.endsWith(".ts")) results.push(full);
  }
  return results;
}

// Files that ARE allowed to know about specific drivers (the drivers themselves)
const DRIVER_FILES = new Set([
  ...allTsFiles("src/ffi/drivers"),
]);

// Generic layer files that must NEVER reference specific library names
const GENERIC_LAYER_FILES = [
  "src/ffi/native/types.ts",
  "src/ffi/native/loader.ts",
  "src/ffi/native/driver-registry.ts",
  "src/ffi/native/platform-executors.ts",
];

const PLATFORM_SDK_FILES = allTsFiles("src/platform-sdk");

// Library-specific names that must not appear in the generic layer as code
// (comments are excluded from the check — only import statements and code)
const FORBIDDEN_IN_GENERIC = ["sqlite3_", "sqlite3Open", "cv::", "OrtCreate", "rcl_init"];

// Import path patterns forbidden in the generic layer
const FORBIDDEN_IMPORTS_IN_GENERIC = [
  /from.*drivers\/sqlite/,
  /from.*drivers\/opencv/,
  /from.*drivers\/onnx/,
  /from.*drivers\/ros2/,
];

const FORBIDDEN_IMPORTS_IN_SDK = [
  /from.*drivers\/sqlite/,
  /from.*drivers\/opencv/,
  /from.*drivers\/onnx/,
  /from.*drivers\/ros2/,
];

// Import patterns forbidden inside drivers (no circular back into Platform SDK)
const FORBIDDEN_IMPORTS_IN_DRIVERS = [
  /from.*platform-sdk/,
];

function getImportLines(src: string): string[] {
  return src.split("\n").filter(l => l.trimStart().startsWith("import"));
}

function getCodeLines(src: string): string[] {
  // Strip single-line comments and blank lines for code-pattern checks
  return src.split("\n")
    .filter(l => !l.trimStart().startsWith("//"))
    .filter(l => l.trim().length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Architecture Rules — Generic Layer", () => {
  for (const filePath of GENERIC_LAYER_FILES) {
    describe(filePath, () => {
      let src: string;
      try { src = readFile(filePath); }
      catch { src = ""; } // file may not exist yet → rules pass vacuously

      it("does not import from any specific driver directory", () => {
        const importLines = getImportLines(src);
        for (const forbidden of FORBIDDEN_IMPORTS_IN_GENERIC) {
          const violation = importLines.find(l => forbidden.test(l));
          expect(violation, `Found forbidden import in ${filePath}: "${violation}"`).toBeUndefined();
        }
      });

      it("does not contain library-specific C symbol names as code (only documentation/comments)", () => {
        const codeLines = getCodeLines(src);
        for (const name of FORBIDDEN_IN_GENERIC) {
          const violation = codeLines.find(l => l.includes(name));
          expect(violation, `Found library-specific name "${name}" in generic layer ${filePath}: "${violation}"`).toBeUndefined();
        }
      });
    });
  }
});

describe("Architecture Rules — Platform SDK", () => {
  for (const filePath of PLATFORM_SDK_FILES) {
    describe(filePath, () => {
      let src: string;
      try { src = readFile(filePath); }
      catch { src = ""; }

      it("does not import from any specific driver directory", () => {
        const importLines = getImportLines(src);
        for (const forbidden of FORBIDDEN_IMPORTS_IN_SDK) {
          const violation = importLines.find(l => forbidden.test(l));
          expect(violation, `Platform SDK imports specific driver in ${filePath}: "${violation}"`).toBeUndefined();
        }
      });

      it("does not contain registerSQLite / registerOpenCV / registerONNX style methods", () => {
        const forbidden = ["registerSQLite", "registerOpenCV", "registerONNX", "registerROS2"];
        for (const name of forbidden) {
          expect(src, `Platform SDK contains library-specific registration method "${name}" in ${filePath}`).not.toContain(name);
        }
      });
    });
  }
});

describe("Architecture Rules — Drivers do not import Platform SDK", () => {
  for (const filePath of DRIVER_FILES) {
    it(`${filePath} does not import from platform-sdk (no circular dependency)`, () => {
      let src: string;
      try { src = readFile(filePath); }
      catch { return; }

      const importLines = getImportLines(src);
      for (const forbidden of FORBIDDEN_IMPORTS_IN_DRIVERS) {
        const violation = importLines.find(l => forbidden.test(l));
        // Exception: drivers ARE allowed to import from driver-registry
        // (to auto-register themselves) — but not from platform-sdk/index
        if (violation && !violation.includes("driver-registry")) {
          expect.fail(`Driver ${filePath} imports from platform-sdk: "${violation}"`);
        }
      }
    });
  }
});

describe("Architecture Rules — DriverRegistry has no library-specific methods", () => {
  it("DriverRegistry does not define registerSQLite/registerOpenCV/etc.", () => {
    const src = readFile("src/ffi/native/driver-registry.ts");
    const forbidden = ["registerSQLite", "registerOpenCV", "registerONNX", "registerROS2", "loadSQLite"];
    for (const name of forbidden) {
      expect(src).not.toContain(name);
    }
  });

  it("DriverRegistry.register() is the ONLY registration method", () => {
    const src = readFile("src/ffi/native/driver-registry.ts");
    // Count public static methods named register*
    const registerMethods = src.match(/static\s+register\w+/g) ?? [];
    // Only 'register' and '_resetForTests' are allowed
    const unexpected = registerMethods.filter(m =>
      m !== "static register" && m !== "static _resetForTests"
    );
    expect(unexpected, `Unexpected registration methods: ${unexpected.join(", ")}`).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Localization layer (Language Mapper) — mission Task 8
// ─────────────────────────────────────────────────────────────────────────────
//
// The Language Mapper (src/compiler/localization/) must know NOTHING about
// the Parser, Semantic Analyzer, Type Checker, or Runtime. It is
// responsible only for mapping surface keyword text to canonical
// keywords/TokenKind. Its only permitted "downstream" reference is
// TokenKind itself (the Lexer's token vocabulary) — the Mapper's entire
// purpose is to feed the Lexer, so that one reference is intentional.

const LOCALIZATION_FILES = allTsFiles("src/compiler/localization");

const FORBIDDEN_IMPORTS_IN_LOCALIZATION = [
  /from.*frontend\/parser/,
  /from.*\/semantic\//,
  /from.*\/typesystem\//,
  /from.*\/module\//,
  /from.*compiler\/incremental/,
];

describe("Architecture Rules — Localization layer (Language Mapper)", () => {
  for (const filePath of LOCALIZATION_FILES) {
    it(`${filePath} does not import from Parser, Semantic, TypeSystem, Module, or Incremental`, () => {
      let src: string;
      try { src = readFile(filePath); }
      catch { return; }
      const importLines = getImportLines(src);
      for (const forbidden of FORBIDDEN_IMPORTS_IN_LOCALIZATION) {
        const violation = importLines.find(l => forbidden.test(l));
        expect(violation, `Localization file ${filePath} imports a forbidden downstream module: "${violation}"`).toBeUndefined();
      }
    });
  }

  it("per-language files (ar.ts, en.ts, ...) export ONLY a LanguageDescriptor — pure data, no logic", () => {
    const perLanguageFiles = LOCALIZATION_FILES.filter(f =>
      !f.endsWith("canonical.ts") && !f.endsWith("index.ts")
    );
    expect(perLanguageFiles.length).toBeGreaterThanOrEqual(10); // ar,en,fr,es,de,it,ru,zh,pt,hi
    for (const filePath of perLanguageFiles) {
      const src = readFile(filePath);
      // No function declarations, no classes, no control flow — pure data only.
      expect(/\bfunction\s+\w+\s*\(/.test(src), `${filePath} should contain no function declarations`).toBe(false);
      expect(/\bclass\s+\w+/.test(src), `${filePath} should contain no class declarations`).toBe(false);
      expect(/\b(if|for|while)\s*\(/.test(src), `${filePath} should contain no if/for/while statements`).toBe(false);
    }
  });

  it("Language Mapper (index.ts) does not import Parser/Semantic/TypeSystem/Module (only TokenKind from lexer.ts, which is expected)", () => {
    const src = readFile("src/compiler/localization/index.ts");
    const importLines = getImportLines(src);
    for (const forbidden of FORBIDDEN_IMPORTS_IN_LOCALIZATION) {
      const violation = importLines.find(l => forbidden.test(l));
      expect(violation).toBeUndefined();
    }
    // The one permitted downstream reference: TokenKind from lexer.ts.
    expect(importLines.some(l => l.includes("lexer.js"))).toBe(true);
  });
});

describe("Architecture Rules — Repository Invariants", () => {
  it("zero RUNTIME circular dependencies across all of src/ (import type excluded, since it is compile-time erased)", () => {
    // Verified during RC review: a naive check that treats `import type`
    // the same as a value import flags two false positives between
    // lexer.ts and localization/{index,canonical}.ts — but both of those
    // are `import type { TokenKind }`, fully erased by TypeScript, and
    // proven empirically (runtime_proof script) to cause zero init-order
    // failure. This test only counts import lines that are NOT `import type`.
    const files = allTsFiles(SRC);
    const graph = new Map<string, string[]>();

    for (const file of files) {
      const src = readFile(file);
      const imports: string[] = [];
      for (const line of src.split("\n")) {
        if (/^\s*import\s+type\s/.test(line)) continue; // erased at compile time
        const m = line.match(/from\s+["']([^"']+)["']/);
        if (m && m[1].startsWith(".")) {
          const resolved = join(file.split("/").slice(0, -1).join("/"), m[1]).replace(/\.js$/, ".ts");
          imports.push(resolved);
        }
      }
      graph.set(file, imports);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    function dfs(node: string, path: string[]): void {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      inStack.add(node);
      for (const dep of graph.get(node) ?? []) dfs(dep, [...path, node]);
      inStack.delete(node);
    }

    for (const file of graph.keys()) if (!visited.has(file)) dfs(file, []);

    expect(cycles, `Real runtime circular dependencies found: ${JSON.stringify(cycles)}`).toEqual([]);
  });

  // P0 D-A4 (PM decision 2026-10-18): the rule is kept, with a CLOSED list of
  // exemptions. Each exemption is tied to an existing backlog record in
  // docs/architecture/COMPILER_BACKLOG.md that defers that driver's
  // auto-registration. An exemption records a deferral only; it is NOT evidence
  // that the driver is sound or ready. Go has its own record (FRI-BACKLOG-003);
  // it is not covered by FRI-BACKLOG-001.
  const DRIVER_REGISTRY_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
    ["src/ffi/drivers/python/python-driver.ts", "FRI-BACKLOG-001"],
    ["src/ffi/drivers/rust/rust-bridge.ts", "FRI-BACKLOG-001"],
    ["src/ffi/drivers/javascript/js-bridge.ts", "FRI-BACKLOG-001"],
    ["src/ffi/drivers/go/go-driver.ts", "FRI-BACKLOG-003"],
  ]);
  const toPosix = (p: string) => p.split("\\").join("/");

  it("every file in src/ffi/drivers/ imports from driver-registry to auto-register, except the closed, recorded exemption list", () => {
    const missing: string[] = [];
    const exemptButRegistered: string[] = [];
    for (const filePath of DRIVER_FILES) {
      const src = readFile(filePath); // an unreadable driver file is a failure, not a skip
      const key = toPosix(filePath);
      const imports = src.includes("driver-registry");
      if (DRIVER_REGISTRY_EXEMPTIONS.has(key)) {
        if (imports) exemptButRegistered.push(key);
      } else if (!imports) {
        missing.push(key);
      }
    }
    expect(missing, `Drivers that do not import from driver-registry and have no recorded exemption: ${JSON.stringify(missing)}`).toEqual([]);
    expect(exemptButRegistered, `Exempted drivers now import driver-registry - remove them from the exemption list and update their backlog record: ${JSON.stringify(exemptButRegistered)}`).toEqual([]);
  });

  it("every driver-registry exemption names an existing driver file and an existing backlog record", () => {
    const driverFiles = new Set([...DRIVER_FILES].map(toPosix));
    const backlog = readFile("docs/architecture/COMPILER_BACKLOG.md");
    for (const [file, record] of DRIVER_REGISTRY_EXEMPTIONS) {
      expect(driverFiles.has(file), `exempted file does not exist under src/ffi/drivers/: ${file}`).toBe(true);
      expect(backlog, `backlog record ${record} (exemption for ${file}) not found in COMPILER_BACKLOG.md`).toContain(`## ${record} `);
    }
  });

  it("src/ffi/native/loader.ts imports from types.ts only (no driver-specific imports)", () => {
    const src = readFile("src/ffi/native/loader.ts");
    // Collect all complete from-clauses (handles multi-line imports)
    const fromClauses = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]!);
    const nonTypeImports = fromClauses.filter(
      path => !path.includes("./types") && !path.includes("./types.js")
    );
    expect(nonTypeImports,
      `loader.ts has imports beyond types.ts: ${nonTypeImports.join("; ")}`
    ).toHaveLength(0);
  });

  it("src/ffi/native/types.ts has zero imports (it is the root type module)", () => {
    const src = readFile("src/ffi/native/types.ts");
    const importLines = getImportLines(src);
    expect(importLines, `types.ts should have zero imports, found: ${importLines.join("; ")}`).toHaveLength(0);
  });
});
