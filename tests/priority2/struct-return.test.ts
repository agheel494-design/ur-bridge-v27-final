import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../src/backend/c/emit-c.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Priority 2 (Struct Return Stabilization Sprint): the manager's own
// exact target example - a function returning a struct by value,
// called via `let`, with real field access and print.
// function makePoint(x, y): Point { return Point(x, y) }
// let p = makePoint(3, 4); print(p.x)

describe("Priority 2: struct return - the exact target example, full pipeline, zero bypass", () => {
  it("Parser -> TypeChecker -> IR -> C -> gcc -> Execution, all real, all pass", () => {
    const src = "struct Point\n  x: int\n  y: int\nend\nfunction makePoint(x: int, y: int): Point\n  return Point(x, y)\nend\nfunction main(): int\n  let p = makePoint(3, 4)\n  print(p.x)\n  return 0\nend\n";
    const { tokens } = lex(src);
    const { program, errors } = parse(tokens);
    expect(errors).toEqual([]);

    const tc = typeCheck(program);
    const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(tcErr).toEqual([]);

    const ir = lowerToIR(program, "priority2.ur", "priority2");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;

    const c = emitC(ir.value);
    const cPath = "/tmp/priority2_test.c";
    writeFileSync(cPath, c);
    execSync(`gcc ${cPath} runtime/ur_runtime.c -I runtime -o /tmp/priority2_test_bin`, { cwd: __dirname + "/../.." });
    const output = execSync("/tmp/priority2_test_bin").toString().trim();
    expect(output).toBe("3");
  });

  it("real field usage: makePoint(3,4).x + makePoint(3,4).y == 7", () => {
    const src = "struct Point\n  x: int\n  y: int\nend\nfunction makePoint(x: int, y: int): Point\n  return Point(x, y)\nend\nfunction main(): int\n  let p = makePoint(3, 4)\n  return p.x + p.y\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const ir = lowerToIR(program, "priority2b.ur", "priority2b");
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;
    const c = emitC(ir.value);
    writeFileSync("/tmp/priority2b_test.c", c);
    execSync(`gcc /tmp/priority2b_test.c runtime/ur_runtime.c -I runtime -o /tmp/priority2b_test_bin`, { cwd: __dirname + "/../.." });
    const exitCode = (() => { try { execSync("/tmp/priority2b_test_bin"); return 0; } catch (e: any) { return e.status; } })();
    expect(exitCode).toBe(7);
  });
});
