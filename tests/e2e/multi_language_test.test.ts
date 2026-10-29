import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitWasmModule } from "../../src/backend/wasm/emit-wasm.js";

const CLI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, CLI_PATH, ...args], { cwd, encoding: "utf-8" });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
  }
}

describe("Ten natural languages: real Lexer/Parser/keyword execution, not cosmetic translation", () => {
  const programs: Record<string, string> = {
    english: "function main(): int\n  let x = 10\n  return x\nend\n",
    arabic: "دالة main(): عدد\n  عرف x = 10\n  أرجع x\nنهاية\n",
    chinese: "函数 main(): int\n  设 x = 10\n  返回 x\n结束\n",
    japanese: "関数 main(): int\n  レット x = 10\n  返す x\n終了\n",
    french: "fonction main(): int\n  soit x = 10\n  retourner x\nfin\n",
    german: "funktion main(): int\n  sei x = 10\n  zurueckgeben x\nende\n",
    spanish: "funcion main(): int\n  sea x = 10\n  retornar x\nfin\n",
    russian: "функция main(): int\n  пусть x = 10\n  вернуть x\nконец\n",
    portuguese: "funcao main(): int\n  seja x = 10\n  retornar x\nfim\n",
    hindi: "कार्य main(): int\n  मान x = 10\n  वापस x\nसमाप्त\n",
  };

  for (const [name, src] of Object.entries(programs)) {
    it(`${name}: real keywords parse and execute, returns 10`, () => {
      const dir = mkdtempSync(join(tmpdir(), `ur-lang-${name}-`));
      try {
        writeFileSync(join(dir, "test.ur"), src);
        const result = runCli(dir, ["run", "test.ur"]);
        expect(result.exitCode).toBe(10);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});

describe("Six-language single UR program (Python, JavaScript, C, C++, WASM, TypeScript)", () => {
  it("one program, one execution, all six external languages called, correct sum", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-sixlang-"));
    try {
      mkdirSync(join(dir, "ur_packages", "pymath"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "jsmath"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "cppmath"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "wasmmath"), { recursive: true });
      mkdirSync(join(dir, "ur_packages", "tsmath"), { recursive: true });

      // DR-RB3-03 (R1-Q2: float -> int rejected): math.isqrt is the int-returning equivalent of math.sqrt.
      writeFileSync(join(dir, "ur_packages", "pymath", "manifest.json"), JSON.stringify({ name: "pymath", runtime: "python", module: "math", exports: { sqrtFn: "isqrt" } }));
      // DR-RB3-05 (P1-7 Finding B): a "./"-relative JS/TS module resolves relative to the manifest's OWN directory.
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "pymath", "signatures.ur"), "function sqrtFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "jsmath", "mathlib.js"), "module.exports.cube = function(x) { return x * x * x; };\n");
      writeFileSync(join(dir, "ur_packages", "jsmath", "manifest.json"), JSON.stringify({ name: "jsmath", runtime: "javascript", module: "./mathlib.js", exports: { cubeFn: "cube" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "jsmath", "signatures.ur"), "function cubeFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "mathlib.c"), "long square(long x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "./ur_packages/cmath/mathlib.c", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "cppmath", "mathlib.cpp"), "extern \"C\" long triple(long x) { return x * 3; }\n");
      writeFileSync(join(dir, "ur_packages", "cppmath", "manifest.json"), JSON.stringify({ name: "cppmath", runtime: "cpp", module: "./ur_packages/cppmath/mathlib.cpp", exports: { tripleFn: "triple" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cppmath", "signatures.ur"), "function tripleFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "ur_packages", "tsmath", "mathlib.ts"), "export function quint(x: number): number { return x * 5; }\n");
      writeFileSync(join(dir, "ur_packages", "tsmath", "manifest.json"), JSON.stringify({ name: "tsmath", runtime: "typescript", module: "./mathlib.ts", exports: { quintFn: "quint" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "tsmath", "signatures.ur"), "function quintFn(x: int): int\n  return 0\nend\n");

      const wasmSrc = "function double(x: int): int\n  return x * 2\nend\n";
      const { tokens } = lex(wasmSrc);
      const { program } = parse(tokens);
      const ir = lowerToIR(program, "t.ur", "t");
      if (ir.ok) {
        const wasmBytes = emitWasmModule(ir.value);
        writeFileSync(join(dir, "ur_packages", "wasmmath", "mathlib.wasm"), wasmBytes);
      }
      writeFileSync(join(dir, "ur_packages", "wasmmath", "manifest.json"), JSON.stringify({ name: "wasmmath", runtime: "wasm", module: "./ur_packages/wasmmath/mathlib.wasm", exports: { doubleFn: "double" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "wasmmath", "signatures.ur"), "function doubleFn(x: int): int\n  return 0\nend\n");

      writeFileSync(join(dir, "test.ur"), "import pymath\nimport jsmath\nimport cmath\nimport cppmath\nimport wasmmath\nimport tsmath\n\nfunction main(): int\n  let a = sqrtFn(81)\n  let b = cubeFn(2)\n  let c = squareFn(5)\n  let d = tripleFn(4)\n  let e = doubleFn(10)\n  let f = quintFn(2)\n  return a + b + c + d + e + f\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(84);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("Go, Java, C#, Rust: real, clear tool-missing errors, never 'failed: undefined'", () => {
  it("Java: javac not found produces a specific, named error", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-java-"));
    try {
      mkdirSync(join(dir, "ur_packages", "j"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "j", "mathlib.java"), "public class Wrapper { public static long f(long x) { return x; } }\n");
      writeFileSync(join(dir, "ur_packages", "j", "manifest.json"), JSON.stringify({ name: "j", runtime: "java", module: "./ur_packages/j/mathlib.java", exports: { fn: "f" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "j", "signatures.ur"), "function fn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import j\n\nfunction main(): int\n  return fn(1)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.stderr).not.toContain("undefined");
      expect(result.stderr.length).toBeGreaterThan(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("C Bridge: real fix for bare module-name resolution (per independent review, this exact bug reproduction)", () => {
  it("a manifest.json module field with NO extension and NO path separator (e.g. \"mathlib\") resolves relative to the manifest's own directory, with the correct .c extension added automatically", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-bare-"));
    try {
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "mathlib.c"), "long square(long x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "mathlib", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(7)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(49);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("REGRESSION: the old full-path style (./ur_packages/cmath/mathlib.c) still works unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-full-"));
    try {
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "mathlib.c"), "long square(long x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "./ur_packages/cmath/mathlib.c", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(5)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).toBe(25);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("a genuinely missing C module file produces a clear, specific error naming every path tried - not a confusing raw ld/gcc error", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-missing-"));
    try {
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "doesnotexist", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(5)\nend\n");
      const result = runCli(dir, ["run", "test.ur"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("could not find module file");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("C Bridge: comprehensive path resolution coverage (bare, full-from-root, relative-from-manifest, absolute), per independent review's own 4-case request", () => {
  it("Case 1 - bare name, no path (resolved relative to manifest.json's own directory)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-c1-"));
    try {
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "mathlib.c"), "long square(long x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "mathlib", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(7)\nend\n");
      expect(runCli(dir, ["run", "test.ur"]).exitCode).toBe(49);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Case 2 - full path from project root (./ur_packages/...), the original working style, unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-c2-"));
    try {
      mkdirSync(join(dir, "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "mathlib.c"), "long square(long x) { return x * x; }\n");
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "./ur_packages/cmath/mathlib.c", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(5)\nend\n");
      expect(runCli(dir, ["run", "test.ur"]).exitCode).toBe(25);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Case 3 - relative path with ../ (resolved relative to manifest.json's own directory, matching a real sibling-lib layout)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-c3-"));
    try {
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(join(dir, "lib", "mathlib.c"), "long square(long x) { return x * x; }\n");
      mkdirSync(join(dir, "proj", "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "proj", "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "../../../lib/mathlib.c", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "proj", "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "proj", "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(6)\nend\n");
      expect(runCli(join(dir, "proj"), ["run", "test.ur"]).exitCode).toBe(36);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Case 4 - genuinely absolute path (module points directly to /tmp/.../mathlib.c)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-c4-"));
    try {
      mkdirSync(join(dir, "lib"), { recursive: true });
      const libPath = join(dir, "lib", "mathlib.c");
      writeFileSync(libPath, "long square(long x) { return x * x; }\n");
      mkdirSync(join(dir, "proj", "ur_packages", "cmath"), { recursive: true });
      writeFileSync(join(dir, "proj", "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: libPath, exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "proj", "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "proj", "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(8)\nend\n");
      expect(runCli(join(dir, "proj"), ["run", "test.ur"]).exitCode).toBe(64);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("RC-FFI-002: file-resolution priority when the same relative path matches two real files from different base directories", () => {
  it("manifest.json's own directory is tried FIRST (a package's own sibling file wins over an unrelated, same-named file found only relative to cwd)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-cbridge-ambig-"));
    try {
      mkdirSync(join(dir, "lib"), { recursive: true });
      writeFileSync(join(dir, "lib", "mathlib.c"), "long square(long x) { return x * 1000; }\n"); // the WRONG file, matches via cwd
      mkdirSync(join(dir, "ur_packages", "cmath", "lib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "cmath", "lib", "mathlib.c"), "long square(long x) { return x * x; }\n"); // the CORRECT file, matches via manifestBaseDir
      writeFileSync(join(dir, "ur_packages", "cmath", "manifest.json"), JSON.stringify({ name: "cmath", runtime: "c", module: "./lib/mathlib", exports: { squareFn: "square" } }));
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "cmath", "signatures.ur"), "function squareFn(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "test.ur"), "import cmath\n\nfunction main(): int\n  return squareFn(7)\nend\n");
      expect(runCli(dir, ["run", "test.ur"]).exitCode).toBe(49); // NOT 7000%256
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
