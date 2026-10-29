// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Language Core E2E Regression Suite
// ─────────────────────────────────────────────────────────────────────────────
//
// The 16 real programs from the Language Core Usability Audit, converted
// into a permanent regression suite. Each test is independent (its own
// temp dir, no shared state, no dependency on run order), invokes the
// real `ur run` CLI as a real subprocess (matching this project's own
// established test pattern in tests/cli/cli.test.ts), and asserts the
// EXACT expected outcome already proven in the audit - not merely that
// the process didn't crash.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CLI_ENTRY = join(process.cwd(), "src/cli/index.ts");
// RB3-TEST-INFRA-FIX: run the project's own tsx (devDependency) through the current node binary -
// portable across hosts and Windows (no authoring-sandbox path, no .cmd shim).
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

function runCli(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], { cwd, encoding: "utf-8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? -1 };
}

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ur-e2e-lang-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runProgram(source: string) {
  return withTempDir(dir => {
    writeFileSync(join(dir, "main.ur"), source);
    return runCli(["run", "main.ur"], dir);
  });
}

describe("UR Language Core E2E Regression Suite (16 programs, per direct instruction)", () => {

  it("01 hello: print outputs the exact string, exit 0", () => {
    const r = runProgram(`function main(): int\n  print("Hello, UR!")\n  return 0\nend\n`);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Hello, UR!");
  });

  it("02 variables: definition + reassignment", () => {
    const r = runProgram(`function main(): int\n  let x: int = 5\n  let y: int = 10\n  x = x + y\n  return x\nend\n`);
    expect(r.exitCode).toBe(15);
  });

  it("03 variable used before definition -> SE1001, clean diagnostic", () => {
    const r = runProgram(`function main(): int\n  return undefinedVar\nend\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("SE1001");
    expect(r.stdout + r.stderr).toContain("undefinedVar");
  });

  it("04 functions: arguments + return", () => {
    const r = runProgram(`function add(a: int, b: int): int\n  return a + b\nend\n\nfunction main(): int\n  return add(3, 4)\nend\n`);
    expect(r.exitCode).toBe(7);
  });

  it("05 recursion: factorial(5) = 120", () => {
    const r = runProgram(`function fact(n: int): int\n  if n <= 1\n    return 1\n  end\n  return n * fact(n - 1)\nend\n\nfunction main(): int\n  return fact(5)\nend\n`);
    expect(r.exitCode).toBe(120);
  });

  it("06 control flow: if/else", () => {
    const r = runProgram(`function classify(x: int): int\n  if x > 0\n    return 1\n  else\n    return -1\n  end\nend\n\nfunction main(): int\n  return classify(5) + classify(-3)\nend\n`);
    expect(r.exitCode).toBe(0);
  });

  it("07 loops: while accumulator, sum(0..9) = 45", () => {
    const r = runProgram(`function main(): int\n  let sum: int = 0\n  let i: int = 0\n  while i < 10\n    sum = sum + i\n    i = i + 1\n  end\n  return sum\nend\n`);
    expect(r.exitCode).toBe(45);
  });

  it("08 arrays: indexing", () => {
    const r = runProgram(`function main(): int\n  let a: int[] = [10, 20, 30]\n  return a[1]\nend\n`);
    expect(r.exitCode).toBe(20);
  });

  it("09 nested functions: inner(5)*2 + 1 = 11", () => {
    const r = runProgram(`function outer(x: int): int\n  return inner(x) + 1\nend\n\nfunction inner(x: int): int\n  return x * 2\nend\n\nfunction main(): int\n  return outer(5)\nend\n`);
    expect(r.exitCode).toBe(11);
  });

  it("10 type error: assigning String to Int -> TY2002, clean diagnostic", () => {
    const r = runProgram(`function main(): int\n  let x: int = "not a number"\n  return x\nend\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("TY2002");
  });

  it("11 return inside loop/if: finds first i==3", () => {
    const r = runProgram(`function findFirst(n: int): int\n  let i: int = 0\n  while i < n\n    if i == 3\n      return i\n    end\n    i = i + 1\n  end\n  return -1\nend\n\nfunction main(): int\n  return findFirst(10)\nend\n`);
    expect(r.exitCode).toBe(3);
  });

  it("12 repeated reassignment: 1+1+1 = 3", () => {
    const r = runProgram(`function main(): int\n  let x: int = 1\n  x = x + 1\n  x = x + 1\n  return x\nend\n`);
    expect(r.exitCode).toBe(3);
  });

  it("13 imports (Decision 2C/2D contract, unopened, used as-is): double(21) = 42", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib\n\nfunction main(): int\n  return double(21)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(42);
    });
  });

  it("14 FFI (fn.external, unmodified): triple(14) = 42", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "jsffi"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "jsffi", "jsffi.js"), "export function triple(x) { return x * 3; }\n");
      writeFileSync(join(dir, "ur_packages", "jsffi", "manifest.json"), JSON.stringify({
        name: "jsffi", runtime: "javascript", module: "./jsffi.js", exports: { triple: "triple" },
      }));
      // DR-RB3-05 (P1-7 Finding B): a "./"-relative JS/TS module resolves relative to the manifest's OWN directory.
      // DR-RB3-04 (P1-7): every manifest-based package needs a sibling signatures.ur (IM1001 otherwise).
      writeFileSync(join(dir, "ur_packages", "jsffi", "signatures.ur"), "function triple(x: int): int\n  return 0\nend\n");
      writeFileSync(join(dir, "main.ur"), "import jsffi\n\nfunction main(): int\n  return triple(14)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(42);
    });
  });

  it("15 syntax error: PE001, clean diagnostic", () => {
    const r = runProgram(`function main(): int\n  let x = \n  return 0\nend\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("PE001");
  });

  it("16 missing 'end': PE002, clean diagnostic", () => {
    const r = runProgram(`function main(): int\n  return 0\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("PE002");
  });

  it("17 struct lifecycle: Declaration -> Constructor Call -> Field Access -> Field Mutation -> IR -> Interpreter", () => {
    // Real, discovered convention (per direct instruction, Struct Lifecycle
    // Audit): instance creation uses Constructor Call syntax (Point(3, 4)),
    // not a {key: value} literal.
    const r = runProgram(`struct Point\n  x: int\n  y: int\nend\n\nfunction main(): int\n  let p: Point = Point(3, 4)\n  p.x = 100\n  return p.x + p.y\nend\n`);
    expect(r.exitCode).toBe(104);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Import & Module E2E Hardening (per direct instruction, Import Contract
// Hardening) — converts the 9 real cases proven live in the Import & Module
// E2E Hardening Audit into a permanent regression suite. Does NOT touch
// resolveAndMergeImports, PackageLocationValidator, or any production code.
// Decision 2C/2D's own already-ratified contract is used as-is, not reopened.
// ─────────────────────────────────────────────────────────────────────────────

describe("UR Import & Module E2E Hardening (9 cases, per direct instruction)", () => {

  it("1: import of an existing module -> real function call succeeds", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib\n\nfunction main(): int\n  return double(21)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(42);
    });
  });

  it("2: multi-module import -> both modules' functions available together", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
      mkdirSync(join(dir, "ur_packages", "strlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "strlib", "index.ur"), "function triple(x: int): int\n  return x * 3\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib\nimport strlib\n\nfunction main(): int\n  return double(5) + triple(5)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(25);
    });
  });

  it("3: struct defined in an imported module -> merged into the same namespace, usable directly", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "geomlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "geomlib", "index.ur"), "struct Point\n  x: int\n  y: int\nend\n\nfunction makeOrigin(): Point\n  return Point(0, 0)\nend\n");
      writeFileSync(join(dir, "main.ur"), "import geomlib\n\nfunction main(): int\n  let p: Point = Point(3, 4)\n  return p.x + p.y\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(7);
    });
  });

  it("4: duplicate import of the same module -> no error, functions remain usable once", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
      writeFileSync(join(dir, "main.ur"), "import mathlib\nimport mathlib\n\nfunction main(): int\n  return double(10)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(20);
    });
  });

  it("5: import order does not change the result", () => {
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "mathlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
      mkdirSync(join(dir, "ur_packages", "strlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "strlib", "index.ur"), "function triple(x: int): int\n  return x * 3\nend\n");
      writeFileSync(join(dir, "main.ur"), "import strlib\nimport mathlib\n\nfunction main(): int\n  return double(5) + triple(5)\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(25); // same as case 2, order reversed
    });
  });

  it("6: cwd() portability - a package outside the real working directory is correctly not found (current contract, per Decision 2B)", () => {
    withTempDir(dirA => {
      withTempDir(dirB => {
        mkdirSync(join(dirA, "ur_packages", "mathlib"), { recursive: true });
        writeFileSync(join(dirA, "ur_packages", "mathlib", "index.ur"), "function double(x: int): int\n  return x * 2\nend\n");
        writeFileSync(join(dirB, "main.ur"), "import mathlib\n\nfunction main(): int\n  return double(1)\nend\n");
        const r = runCli(["run", "main.ur"], dirB);
        expect(r.exitCode).toBe(1);
        expect(r.stdout + r.stderr).toContain("cannot find module 'mathlib'");
      });
    });
  });

  it("7 (F1): package not found -> the accepted, clean diagnostic", () => {
    withTempDir(dir => {
      writeFileSync(join(dir, "main.ur"), "import doesnotexist\n\nfunction main(): int\n  return 0\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stdout + r.stderr).toContain("cannot find module 'doesnotexist'");
    });
  });

  it("8 (F2, HISTORICAL - not fixed here): path exists but is not a readable file -> uncaught EISDIR, confirmed pre-existing behavior, protected as-is", () => {
    withTempDir(dir => {
      // index.ur as a real DIRECTORY, not a file.
      mkdirSync(join(dir, "ur_packages", "badmod", "index.ur"), { recursive: true });
      writeFileSync(join(dir, "main.ur"), "import badmod\n\nfunction main(): int\n  return 0\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      // This guards the real, current, historical behavior - not an ideal
      // one. See issues/improve-import-read-failure-semantics.md.
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("EISDIR");
    });
  });

  it("9 (imported-global-variable-unsupported): a top-level `let` in an imported module is NOT merged - this is a real, current, documented contract boundary, not a bug", () => {
    // Real evidence (src/cli/index.ts's own resolveAndMergeImports):
    // mergedFunctions and mergedStructs are both real and supported -
    // program.functions and program.structs from an imported module are
    // merged into the same namespace (see cases 1-3 above). There is NO
    // equivalent merging of GlobalVariableDecl anywhere in that same
    // function. This is a real, current contract boundary - documented
    // here deliberately, not fixed within this task. If global-variable
    // import is ever wanted, it belongs to its own, separate, future
    // Issue - not decided or implemented here.
    withTempDir(dir => {
      mkdirSync(join(dir, "ur_packages", "constlib"), { recursive: true });
      writeFileSync(join(dir, "ur_packages", "constlib", "index.ur"), "let MAX_VALUE: int = 100\n");
      writeFileSync(join(dir, "main.ur"), "import constlib\n\nfunction main(): int\n  return MAX_VALUE\nend\n");
      const r = runCli(["run", "main.ur"], dir);
      expect(r.exitCode).toBe(1);
      expect(r.stdout + r.stderr).toContain("SE1001");
      expect(r.stdout + r.stderr).toContain("MAX_VALUE");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Expression & Type-System Permanent E2E Protection (per direct instruction)
// — protects only behavior already proven live in the Expression &
// Type-System E2E Hardening Audit. `and`/`not`/`for`/`switch`/`try-catch`
// are deliberately NOT included here - real evidence shows they are
// currently unsupported, but their future language design remains an open
// question, not decided by this task. Struct member access is already
// covered by test 17 above and is not duplicated here.
// ─────────────────────────────────────────────────────────────────────────────

describe("Expression & Type-System Permanent E2E Protection", () => {

  it("arithmetic + precedence: 2 + 3 * 4 = 14", () => {
    const r = runProgram(`function main(): int\n  return 2 + 3 * 4\nend\n`);
    expect(r.exitCode).toBe(14);
  });

  it("comparisons: >, !=, >= all evaluate correctly", () => {
    const r = runProgram(`function main(): int\n  if 5 > 3\n    if 5 != 4\n      if 5 >= 5\n        return 1\n      end\n    end\n  end\n  return 0\nend\n`);
    expect(r.exitCode).toBe(1);
  });

  it("logical && and ! (symbol operators, the real supported syntax)", () => {
    const r = runProgram(`function main(): int\n  let a: bool = true\n  let b: bool = false\n  if a && !b\n    return 1\n  end\n  return 0\nend\n`);
    expect(r.exitCode).toBe(1);
  });

  it("unary minus: -5 + 10 = 5", () => {
    const r = runProgram(`function main(): int\n  let x: int = -5\n  return x + 10\nend\n`);
    expect(r.exitCode).toBe(5);
  });

  it("array indexing: correct index returns the correct element", () => {
    const r = runProgram(`function main(): int\n  let a: int[] = [10, 20, 30]\n  return a[1]\nend\n`);
    expect(r.exitCode).toBe(20);
  });

  it("array out-of-bounds: clean UrPanic, not a raw crash", () => {
    const r = runProgram(`function main(): int\n  let a: int[] = [1, 2, 3]\n  return a[10]\nend\n`);
    expect(r.exitCode).toBe(101);
    expect(r.stderr).toContain("array index out of bounds");
  });

  it("function argument type mismatch: TY5002, identifies the argument position", () => {
    const r = runProgram(`function add(a: int, b: int): int\n  return a + b\nend\n\nfunction main(): int\n  return add("hello", 3)\nend\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("TY5002");
  });

  it("null: clean TypeChecker diagnostic when assigned to a non-Optional type", () => {
    const r = runProgram(`function main(): int\n  let x: int = null\n  return 0\nend\n`);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain("TY2002");
  });

  it("char: real expression usage (comparison), verified live end-to-end before inclusion per direct instruction", () => {
    const r = runProgram(`function main(): int\n  let c: char = 'A'\n  let d: char = 'B'\n  if c != d\n    return 1\n  end\n  return 0\nend\n`);
    expect(r.exitCode).toBe(1);
  });
});
