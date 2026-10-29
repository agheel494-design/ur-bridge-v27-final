import { describe, it, expect } from "vitest";
import { validateArrayObjectModel, type ArrayObjectModel } from "../../src/shared/array-object-model.js";

// Implementation Baseline v1 — validates ONLY that the new IR
// structure matches the Architecture Baseline (docs/proposals/
// ARRAY_PARAMETER_SEMANTICS_BASELINE.md, Part 5). Does not touch or
// depend on ir-builder.ts, emit-c.ts, Lowering, or any Backend.

describe("Implementation Baseline v1: ArrayObjectModel structural validation", () => {
  it("a valid model (one Object, one designating binding, one owner) passes with zero failures", () => {
    const model: ArrayObjectModel = {
      objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } }],
      relationships: [{ kind: "designates", bindingSlotId: 100, objectId: 1 }],
      ownership: [{ objectId: 1, ownerBindingSlotId: 100 }],
    };
    expect(validateArrayObjectModel(model)).toEqual([]);
  });

  it("a second binding designating the SAME object (parameter passing) is valid - no new owner created", () => {
    const model: ArrayObjectModel = {
      objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } }],
      relationships: [
        { kind: "designates", bindingSlotId: 100, objectId: 1 },
        { kind: "designates", bindingSlotId: 200, objectId: 1 }, // e.g. a callee's own parameter, same Object
      ],
      ownership: [{ objectId: 1, ownerBindingSlotId: 100 }], // only ONE owner, per §3
    };
    expect(validateArrayObjectModel(model)).toEqual([]);
  });

  it("REJECTS: duplicate Object identity (violates unique-identity Structural Validation)", () => {
    const model: ArrayObjectModel = {
      objects: [
        { kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } },
        { kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 5, elementType: "i64" } },
      ],
      relationships: [],
      ownership: [],
    };
    const failures = validateArrayObjectModel(model);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some(f => f.rule.includes("unique Object identity"))).toBe(true);
  });

  it("REJECTS: a relationship designating a non-existent Object (dangling reference)", () => {
    const model: ArrayObjectModel = {
      objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } }],
      relationships: [{ kind: "designates", bindingSlotId: 100, objectId: 999 }],
      ownership: [],
    };
    const failures = validateArrayObjectModel(model);
    expect(failures.some(f => f.rule.includes("valid relationship target"))).toBe(true);
  });

  it("REJECTS: two owners for the same Object (violates single-ownership Semantic Validation, §3)", () => {
    const model: ArrayObjectModel = {
      objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } }],
      relationships: [],
      ownership: [
        { objectId: 1, ownerBindingSlotId: 100 },
        { objectId: 1, ownerBindingSlotId: 200 },
      ],
    };
    const failures = validateArrayObjectModel(model);
    expect(failures.some(f => f.rule.includes("single ownership"))).toBe(true);
  });

  it("REJECTS: a negative length (Descriptive Metadata validity)", () => {
    const model: ArrayObjectModel = {
      objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: -1, elementType: "i64" } }],
      relationships: [],
      ownership: [],
    };
    const failures = validateArrayObjectModel(model);
    expect(failures.some(f => f.rule.includes("Descriptive Metadata validity"))).toBe(true);
  });

  it("REJECTS: ownership claimed for a non-existent Object", () => {
    const model: ArrayObjectModel = {
      objects: [],
      relationships: [],
      ownership: [{ objectId: 1, ownerBindingSlotId: 100 }],
    };
    const failures = validateArrayObjectModel(model);
    expect(failures.some(f => f.rule.includes("ownership targets a real Object"))).toBe(true);
  });
});

describe("Implementation Baseline v2: real Semantic-layer consumer exists, Backend/Lowering do not (per TRANSITION_NOTE_v1_to_v2.md)", () => {
  it("exactly one real consumer exists: the Semantic builder (array-object-model-builder.ts) - Backend/Lowering are NOT among the consumers", async () => {
    const { execSync } = await import("child_process");
    const { fileURLToPath } = await import("url");
    const { dirname, resolve } = await import("path");
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    let output = "";
    try {
      output = execSync(`grep -rl "array-object-model" src/ --include="*.ts"`, { cwd: projectRoot }).toString();
    } catch {
      output = "";
    }
    const files = output.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.endsWith("array-object-model.ts"));
    if (process.platform !== "win32") { expect(files).toEqual(["src/compiler/typesystem/array-object-model-builder.ts"]); }
    expect(files.some(f => f.includes("ir-builder.ts"))).toBe(false);
    expect(files.some(f => f.includes("emit-c.ts"))).toBe(false);
  });

  it("Semantic can produce a real, valid ArrayObjectModel from a real UR program (v2's own Exit Criterion)", async () => {
    const { lex } = await import("../../src/compiler/frontend/lexer.js");
    const { parse } = await import("../../src/compiler/frontend/parser.js");
    const { buildArrayObjectModelFromProgram } = await import("../../src/compiler/typesystem/array-object-model-builder.js");
    const src = "function main(): int\n  let a = [1,2,3]\n  return a[0]\nend\n";
    const { tokens } = lex(src);
    const { program } = parse(tokens);
    const model = buildArrayObjectModelFromProgram(program);
    expect(model.objects).toEqual([{ kind: "ReferenceBackedObject", identity: { objectId: 1 }, descriptive: { length: 3, elementType: "i64" } }]);
    expect(validateArrayObjectModel(model)).toEqual([]);
  });

  it("the old model remains load-bearing: ir-builder.ts and emit-c.ts real output is completely unaffected by this new builder existing", async () => {
    const { readFileSync } = await import("fs");
    const { fileURLToPath } = await import("url");
    const { dirname, resolve } = await import("path");
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const irBuilderSrc = readFileSync(resolve(projectRoot, "src/compiler/codegen/ir-builder.ts"), "utf-8");
    const emitCSrc = readFileSync(resolve(projectRoot, "src/backend/c/emit-c.ts"), "utf-8");
    expect(irBuilderSrc.includes("array-object-model")).toBe(false);
    expect(emitCSrc.includes("array-object-model")).toBe(false);
  });
});

