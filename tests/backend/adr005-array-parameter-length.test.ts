import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

function fullPipeline(src: string): { c: string; ir: any } {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  expect(errors).toEqual([]);
  const tc = typeCheck(program);
  expect((tc.diagnostics ?? []).filter((d: any) => d.severity === "error")).toEqual([]);
  const ir = lowerToIR(program, "t.ur", "t");
  expect(ir.ok).toBe(true);
  if (!ir.ok) throw new Error("unreachable");
  return { c: emitC(ir.value), ir };
}

function compileAndRun(
  c: string,
  binName: string
): { exitCode: number; stdout: string } {
  const tempDir = tmpdir();

  mkdirSync(tempDir, { recursive: true });

  const cPath = join(tempDir, `${binName}.c`);
  const binPath = join(
    tempDir,
    process.platform === "win32"
      ? `${binName}_bin.exe`
      : `${binName}_bin`
  );

  writeFileSync(cPath, c);

  execSync(
    `gcc "${cPath}" runtime/ur_runtime.c -I runtime -o "${binPath}"`,
    { cwd: projectRoot }
  );

  try {
    const stdout = execSync(`"${binPath}"`).toString();
    return { exitCode: 0, stdout };
  } catch (e: any) {
    return {
      exitCode: e.status,
      stdout: e.stdout?.toString() ?? ""
    };
  }
}

// ADR-005: Array Object is the source of truth for Length; (pointer,
// length) is the Boundary Representation; IRParam is an internal
// representation only. arrayLength=1 is no longer the source of
// truth for bounds-checking.

describe("ADR-005 real implementation: within bounds", () => {
  it("let a=[10,20,30]; sum(a) - full pipeline, real result 60", () => {
    const src = "function sum(a: int[]): int\n  return a[0] + a[1] + a[2]\nend\nfunction main(): int\n  let a = [10,20,30]\n  return sum(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_within_bounds");
    expect(exitCode).toBe(60);
  });
});

describe("ADR-005 real implementation: bounds edge cases", () => {
  it("index == length panics (real length=3, real panic)", () => {
    const src = "function sum(a: int[]): int\n  return a[3]\nend\nfunction main(): int\n  let a = [10,20,30]\n  return sum(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_index_eq_length");
    expect(exitCode).toBe(101);
  });

  it("index > length panics", () => {
    const src = "function sum(a: int[]): int\n  return a[10]\nend\nfunction main(): int\n  let a = [10,20,30]\n  return sum(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_index_gt_length");
    expect(exitCode).toBe(101);
  });
});

describe("ADR-005 real implementation: Mutation with Length stability", () => {
  it("a[1]=99 changes content, real bounds check after mutation still uses real length=3", () => {
    const src = "function sum(a: int[]): int\n  a[1] = 99\n  return a[1]\nend\nfunction check(a: int[]): int\n  return a[3]\nend\nfunction main(): int\n  let a = [10,20,30]\n  let r = sum(a)\n  return check(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_mutation");
    expect(exitCode).toBe(101); // check(a) still correctly panics using length=3, not affected by mutation
  });
});

describe("ADR-005 real implementation: f -> g -> h chain", () => {
  it("real length threads correctly across 3 real call boundaries", () => {
    const src = "function f(a: int[]): int\n  return a[0] + a[2]\nend\nfunction g(a: int[]): int\n  return f(a)\nend\nfunction h(a: int[]): int\n  return g(a)\nend\nfunction main(): int\n  let a = [10,20,30]\n  return h(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_chain");
    expect(exitCode).toBe(40); // 10+30
  });

  it("out-of-bounds at the deepest hop still panics correctly", () => {
    const src = "function f(a: int[]): int\n  return a[10]\nend\nfunction g(a: int[]): int\n  return f(a)\nend\nfunction h(a: int[]): int\n  return g(a)\nend\nfunction main(): int\n  let a = [10,20,30]\n  return h(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_chain_oob");
    expect(exitCode).toBe(101);
  });
});

describe("ADR-005 real implementation: repeated passing", () => {
  it("same array passed to the same function twice - no consumption, no length drift", () => {
    const src = "function sum(a: int[]): int\n  return a[0] + a[1] + a[2]\nend\nfunction main(): int\n  let a = [10,20,30]\n  let r1 = sum(a)\n  let r2 = sum(a)\n  return r1 + r2\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_repeated");
    expect(exitCode).toBe(120); // (10+20+30)*2
  });
});

describe("ADR-005 real implementation: two independent objects", () => {
  it("two different-length arrays passed to the same function do not interfere", () => {
    const src = "function sum3(a: int[]): int\n  return a[0] + a[1] + a[2]\nend\nfunction sum5(a: int[]): int\n  return a[0] + a[1] + a[2] + a[3] + a[4]\nend\nfunction main(): int\n  let a = [10,20,30]\n  let b = [1,2,3,4,5]\n  return sum3(a) + sum5(b)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_independence");
    expect(exitCode).toBe(75); // 60 + 15
  });
});

describe("ADR-005: Sentinel prevention (CRITICAL - must fail if arrayLength=1 ever returns as a length source)", () => {
  it("the generated C signature contains a real companion length parameter, not just a bare pointer", () => {
    const src = "function sum(a: int[]): int\n  return a[0]\nend\nfunction main(): int\n  let a = [10,20,30]\n  return sum(a)\nend\n";
    const { c } = fullPipeline(src);
    // A real companion length parameter must exist in the signature.
    expect(c.includes("int64_t p_a[], int64_t p_a_length")).toBe(true);
  });

  it("the real bounds check in generated C references the runtime length variable, never a hard-coded literal '1'", () => {
    const src = "function sum(a: int[]): int\n  return a[0]\nend\nfunction main(): int\n  let a = [10,20,30]\n  return sum(a)\nend\n";
    const { c } = fullPipeline(src);
    // Extract the bounds-check line for the array_load inside sum().
    const boundsCheckLine = c.split("\n").find(l => l.includes(">= 0") && l.includes("p_a_length"));
    expect(boundsCheckLine).toBeDefined();
    // The bound must be the real runtime variable, never a literal "1".
    expect(boundsCheckLine!.includes("< p_a_length")).toBe(true);
    expect(boundsCheckLine!.includes("< 1)")).toBe(false);
  });

  it("REGRESSION GUARD: a real length-5 array passed to a parameter correctly allows index 4 (would incorrectly panic if Sentinel=1 were still in effect)", () => {
    const src = "function get(a: int[]): int\n  return a[4]\nend\nfunction main(): int\n  let a = [1,2,3,4,5]\n  return get(a)\nend\n";
    const { c } = fullPipeline(src);
    const { exitCode } = compileAndRun(c, "adr005_test_sentinel_guard");
    expect(exitCode).toBe(5); // a[4] = 5 - if Sentinel=1 were still used, this would incorrectly panic (EXIT:101)
  });
});