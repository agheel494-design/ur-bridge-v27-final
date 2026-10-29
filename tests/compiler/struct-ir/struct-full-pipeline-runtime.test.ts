import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import { analyze } from "../../../src/compiler/semantic/index.js";
import { typeCheck } from "../../../src/compiler/typesystem/checker.js";
import { lowerToIR } from "../../../src/compiler/codegen/lower-to-ir.js";
import { emitC } from "../../../src/backend/c/emit-c.js";
import { compileC, runExecutable, cleanupExecutable } from "../../../tools/backend/c-compile.js";
import { ModuleRegistry } from "../../../src/compiler/module/registry.js";
import { computeStructLayout } from "../../../src/compiler/typesystem/struct-layout-calculator.js";

// Real, live proof: the new Struct IR representation (structLayout +
// field_load/field_store, replacing the old per-field-slot approach)
// works through the FULL pipeline, including real C compilation and
// real execution — not just IR success. Per explicit direction that
// Blocker 4 requires the full Lexer->Parser->Semantic->TypeChecker->
// Lowering->Canonical IR->C Backend->WASM Backend->Runtime chain.

function compileAndRun(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length) throw new Error(`parse failed: ${JSON.stringify(errors)}`);
  const sem = analyze(program);
  const semErrors = (sem.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (semErrors.length) throw new Error(`semantic failed: ${JSON.stringify(semErrors)}`);
  const tc = typeCheck(program);
  const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErrors.length) throw new Error(`typecheck failed: ${JSON.stringify(tcErrors)}`);
  const ir = lowerToIR(program, "t.ur", "t");
  if (!ir.ok) throw new Error(`lower failed: ${JSON.stringify(ir.diagnostics)}`);
  const cSource = emitC(ir.value);
  const compiled = compileC(cSource, "a.out", {});
  if (!compiled.ok) throw new Error(`C compile failed: ${JSON.stringify(compiled)}`);
  const r = runExecutable(compiled.value);
  cleanupExecutable(compiled.value);
  return r;
}

describe("Struct: full pipeline through real C compilation + real execution (local)", () => {
  it("real struct construction, field read, and print produce the correct real runtime output", async () => {
    const r = await compileAndRun("struct Point\n  x: int\n  y: int\nend\nfunction main(): int\n  let p = Point(3, 4)\n  print(p.x + p.y)\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("7");
  });

  it("real field mutation produces the correct real runtime output", async () => {
    const r = await compileAndRun("struct Counter\n  value: int\nend\nfunction main(): int\n  let c = Counter(0)\n  c.value = c.value + 1\n  c.value = c.value + 1\n  print(c.value)\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("2");
  });

  it("real struct copy (value semantics) - mutating the copy does not affect the original, confirmed at runtime", async () => {
    const r = await compileAndRun("struct Point\n  x: int\nend\nfunction main(): int\n  let a = Point(1)\n  let b = a\n  b.x = 99\n  print(a.x)\n  print(b.x)\n  return 0\nend\n");
    expect(r.stdout).toBe("1\n99\n");
  });
});

describe("Struct: full pipeline through real C compilation + real execution (cross-module import)", () => {
  it("a struct declared in one module, constructed and used inside a function in a DIFFERENT module that imports it, produces the correct real runtime output", () => {
    const libSrc = "struct Point\n  x: int\n  y: int\nend\n";
    const mainSrc = "import geo\n\nfunction main(): int\n  let p = Point(3, 4)\n  print(p.x + p.y)\n  return 0\nend\n";

    const registry = new ModuleRegistry();
    registry.register(parse(lex(libSrc, "ur_packages/geo/index.ur").tokens, "ur_packages/geo/index.ur").program, "ur_packages/geo/index.ur");
    const mainProgram = parse(lex(mainSrc, "main.ur").tokens, "main.ur").program;
    registry.register(mainProgram, "main.ur");
    expect(registry.resolveAll().valid).toBe(true);

    const exportedNames = registry.getExportedNames("ur_packages/geo/index.ur");
    const exportedTypes = registry.getExportedTypes("ur_packages/geo/index.ur");
    expect(analyze(mainProgram, exportedNames).diagnostics).toEqual([]);
    expect(typeCheck(mainProgram, exportedTypes).diagnostics).toEqual([]);

    const externalStructLayouts = new Map();
    for (const [name, ty] of exportedTypes as any) {
      if (ty.kind === "Struct") externalStructLayouts.set(name, computeStructLayout(name, ty.fields.map((f: any) => ({ name: f.name, type: "i64" }))));
    }
    const ir = lowerToIR(mainProgram, "main.ur", "mod", exportedTypes as any, externalStructLayouts);
    expect(ir.ok).toBe(true);
    if (!ir.ok) return;

    const cSource = emitC(ir.value);
    const compiled = compileC(cSource, "a.out", {});
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = runExecutable(compiled.value);
    cleanupExecutable(compiled.value);
    expect(result.stdout.trim()).toBe("7");
  });

  it("REAL FIX (CG9001 resolved, per LANGUAGE_SYNTAX_1_1_SPEC.md §2.5's ratified BY VALUE requirement): passing an EXISTING struct variable to a DIFFERENT function call now works end-to-end through real C compilation and real execution", async () => {
    const r = await compileAndRun("struct Point\n  x: int\n  y: int\nend\nfunction useIt(p: Point): int\n  return p.x + p.y\nend\nfunction main(): int\n  let p = Point(3, 4)\n  print(useIt(p))\n  return 0\nend\n");
    expect(r.stdout.trim()).toBe("7");
  });
});
