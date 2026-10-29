// ─────────────────────────────────────────────────────────────────────────────
// UR — Tests: Shared Contracts Package
// Level 2 — src/shared/
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { fromAstSpan, SYNTHETIC_LOCATION, isSynthetic } from "../../src/shared/locations.js";
import { makeDiagnostic, CODEGEN_CODES, BACKEND_CODES } from "../../src/shared/diagnostics.js";
import { makeSymbolRef, qualifiedName } from "../../src/shared/symbols.js";
import { buildOk, buildFail, hasErrors } from "../../src/shared/build.js";
import { checkModuleInvariants, type IRModule } from "../../src/shared/ir.js";
import { RUNTIME_CORE_EXTERNS } from "../../src/shared/runtime-table.js";

describe("shared/locations", () => {
  it("fromAstSpan converts a Frontend-style span correctly", () => {
    const loc = fromAstSpan("main.ur", { startLine: 3, startColumn: 5, endLine: 3, endColumn: 10 });
    expect(loc.file).toBe("main.ur");
    expect(loc.start).toEqual({ line: 3, column: 5 });
    expect(loc.end).toEqual({ line: 3, column: 10 });
  });

  it("SYNTHETIC_LOCATION is recognized by isSynthetic", () => {
    expect(isSynthetic(SYNTHETIC_LOCATION)).toBe(true);
  });

  it("a real location is not synthetic", () => {
    const loc = fromAstSpan("main.ur", { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 });
    expect(isSynthetic(loc)).toBe(false);
  });
});

describe("shared/diagnostics", () => {
  it("makeDiagnostic produces the correct shape", () => {
    const d = makeDiagnostic("codegen", "error", CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, "test message", SYNTHETIC_LOCATION);
    expect(d.source).toBe("codegen");
    expect(d.severity).toBe("error");
    expect(d.code).toBe("CG1001");
    expect(d.message).toBe("test message");
  });

  it("CODEGEN_CODES and BACKEND_CODES are distinct code ranges", () => {
    const codegenCodes = Object.values(CODEGEN_CODES);
    const backendCodes = Object.values(BACKEND_CODES);
    for (const c of codegenCodes) expect(c.startsWith("CG")).toBe(true);
    for (const c of backendCodes) expect(c.startsWith("BE")).toBe(true);
  });
});

describe("shared/symbols", () => {
  it("makeSymbolRef produces the correct shape", () => {
    const ref = makeSymbolRef("add", "function", SYNTHETIC_LOCATION, "main");
    expect(ref.name).toBe("add");
    expect(ref.kind).toBe("function");
    expect(ref.module).toBe("main");
  });

  it("qualifiedName sanitizes non-identifier characters in the module name", () => {
    const ref = makeSymbolRef("add", "function", SYNTHETIC_LOCATION, "utils/math.ur");
    const q = qualifiedName(ref);
    expect(q).toBe("ur_utils_math_ur_add");
  });

  it("qualifiedName preserves Arabic module/function names correctly encoded as underscores where needed", () => {
    // Non-ASCII characters are replaced with underscores in the qualified
    // name (C identifiers must be ASCII); the sourceName is preserved
    // separately in IRFunction.sourceName for diagnostics.
    const ref = makeSymbolRef("test", "function", SYNTHETIC_LOCATION, "رئيسية");
    const q = qualifiedName(ref);
    expect(q.startsWith("ur_")).toBe(true);
    expect(q.endsWith("_test")).toBe(true);
  });

  it("qualifiedName contains no regex-special or non-ASCII characters", () => {
    const ref = makeSymbolRef("f", "function", SYNTHETIC_LOCATION, "a.b-c d");
    const q = qualifiedName(ref);
    expect(/^[a-zA-Z0-9_]+$/.test(q)).toBe(true);
  });
});

describe("shared/build", () => {
  it("buildOk produces an ok:true result with the value and diagnostics", () => {
    const r = buildOk(42, []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("buildFail produces an ok:false result with diagnostics", () => {
    const d = makeDiagnostic("codegen", "error", "CG1001", "oops", SYNTHETIC_LOCATION);
    const r = buildFail([d]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toHaveLength(1);
  });

  it("hasErrors detects error-severity diagnostics", () => {
    const err = makeDiagnostic("codegen", "error", "CG1001", "e", SYNTHETIC_LOCATION);
    const warn = makeDiagnostic("codegen", "warning", "CG1001", "w", SYNTHETIC_LOCATION);
    expect(hasErrors([err])).toBe(true);
    expect(hasErrors([warn])).toBe(false);
    expect(hasErrors([])).toBe(false);
  });
});

describe("shared/ir — checkModuleInvariants (SSA discipline verifier)", () => {
  function loc() { return SYNTHETIC_LOCATION; }

  it("a well-formed straight-line function has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f",
        sourceName: "f",
        params: [],
        returnType: "i64",
        entryBlock: 0,
        location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 2n }, location: loc() },
            { kind: "binop", id: 2, type: "i64", op: "add", left: { id: 0 }, right: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 2 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("detects use of an undefined SSA value before definition", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            // Refers to id 5, which is never defined.
            { kind: "binop", id: 0, type: "i64", op: "add", left: { id: 5 }, right: { id: 6 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.message.includes("undefined SSA value"))).toBe(true);
  });

  it("detects a duplicate SSA id", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 2n }, location: loc() }, // duplicate id!
          ],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("duplicate"))).toBe(true);
  });

  it("detects a return referencing an undefined value", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [],
          terminator: { kind: "return", value: { id: 99 }, location: loc() }, // never defined
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("return uses undefined"))).toBe(true);
  });

  it("detects a missing entry block", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 99, location: loc(), locals: [],
        blocks: [{ id: 0, label: "entry", instructions: [], terminator: { kind: "return_void", location: loc() } }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("entryBlock"))).toBe(true);
  });

  it("params are valid definitions usable by later instructions", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f",
        params: [{ name: "x", type: "i64" }], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "param", id: 0, type: "i64", index: 0, name: "x", location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "binop", id: 2, type: "i64", op: "add", left: { id: 0 }, right: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 2 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("call instruction argument references are validated too", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "call", id: 0, type: "i64", callee: "ur_m_g", args: [{ id: 42 }], location: loc() }, // id 42 undefined
          ],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("undefined SSA value"))).toBe(true);
  });

  // ── CFG-level checks (branch targets, reachability, call resolution) ──────

  it("detects a branch terminator pointing to a nonexistent block", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(), locals: [],
        blocks: [{ id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 99, location: loc() } }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("branch target block 99 does not exist"))).toBe(true);
  });

  it("detects a cond_branch with a nonexistent then/else target", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "const", id: 0, type: "bool", value: { kind: "const_bool", value: true }, location: loc() }],
          terminator: { kind: "cond_branch", condition: { id: 0 }, thenTarget: 1, elseTarget: 99, location: loc() },
        }, {
          id: 1, label: "then", instructions: [], terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("'else' target block 99 does not exist"))).toBe(true);
  });

  it("detects a cond_branch condition that references an undefined value", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry", instructions: [],
          terminator: { kind: "cond_branch", condition: { id: 42 }, thenTarget: 0, elseTarget: 0, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("cond_branch condition uses undefined"))).toBe(true);
  });

  it("a valid two-block CFG (entry branches to a second block) has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [
          { id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 1, location: loc() } },
          {
            id: 1, label: "next",
            instructions: [{ kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() }],
            terminator: { kind: "return", value: { id: 0 }, location: loc() },
          },
        ],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("detects an unreachable block (dead code, not connected to the CFG from entry)", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(), locals: [],
        blocks: [
          { id: 0, label: "entry", instructions: [], terminator: { kind: "return_void", location: loc() } },
          { id: 1, label: "orphan", instructions: [], terminator: { kind: "return_void", location: loc() } }, // never branched to
        ],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("block 1") && v.message.includes("unreachable"))).toBe(true);
  });

  it("detects duplicate block ids within a function", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(), locals: [],
        blocks: [
          { id: 0, label: "a", instructions: [], terminator: { kind: "return_void", location: loc() } },
          { id: 0, label: "b", instructions: [], terminator: { kind: "return_void", location: loc() } }, // duplicate id
        ],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("duplicate block id"))).toBe(true);
  });

  it("detects a call to a function that does not exist anywhere in the module", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "call", id: 0, type: "i64", callee: "ur_m_nonexistent", args: [], location: loc() }],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("call to unresolved function 'ur_m_nonexistent'"))).toBe(true);
  });

  it("a call to a function that DOES exist elsewhere in the module produces zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [
        {
          qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
          blocks: [{
            id: 0, label: "entry",
            instructions: [{ kind: "call", id: 0, type: "i64", callee: "ur_m_g", args: [], location: loc() }],
            terminator: { kind: "return", value: { id: 0 }, location: loc() },
          }],
        },
        {
          qualifiedName: "ur_m_g", sourceName: "g", params: [], returnType: "i64", entryBlock: 0, location: loc(), locals: [],
          blocks: [{
            id: 0, label: "entry",
            instructions: [{ kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() }],
            terminator: { kind: "return", value: { id: 0 }, location: loc() },
          }],
        },
      ],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });
});

describe("shared/ir — checkModuleInvariants: Runtime lifecycle safety (per review)", () => {
  function loc() { return SYNTHETIC_LOCATION; }
  const minimalFn = {
    qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void" as const, entryBlock: 0, location: loc(), locals: [],
    blocks: [{ id: 0, label: "entry", instructions: [], terminator: { kind: "return_void" as const, location: loc() } }],
  };

  it("REQUIRED: a module with the full Runtime table (exactly one Init, one Shutdown) has zero lifecycle violations", () => {
    const module: IRModule = { moduleName: "m", externs: RUNTIME_CORE_EXTERNS, functions: [minimalFn] };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("REQUIRED: zero Init externs is a violation", () => {
    const externsNoInit = RUNTIME_CORE_EXTERNS.filter(e => e.lifecycleRole !== "init");
    const module: IRModule = { moduleName: "m", externs: externsNoInit, functions: [minimalFn] };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes('no extern with lifecycleRole "init"'))).toBe(true);
  });

  it("REQUIRED: zero Shutdown externs is a violation", () => {
    const externsNoShutdown = RUNTIME_CORE_EXTERNS.filter(e => e.lifecycleRole !== "shutdown");
    const module: IRModule = { moduleName: "m", externs: externsNoShutdown, functions: [minimalFn] };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes('no extern with lifecycleRole "shutdown"'))).toBe(true);
  });

  it("REQUIRED: two Init externs is a violation (ambiguous lifecycle role)", () => {
    const duplicateInit = [
      ...RUNTIME_CORE_EXTERNS,
      { name: "ur_bogus_init2", returnType: "void" as const, parameterTypes: [], callingConvention: "c" as const, kind: "runtime" as const, lifecycleRole: "init" as const },
    ];
    const module: IRModule = { moduleName: "m", externs: duplicateInit, functions: [minimalFn] };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes('multiple externs with lifecycleRole "init"'))).toBe(true);
  });

  it("REQUIRED: two Shutdown externs is a violation (ambiguous lifecycle role)", () => {
    const duplicateShutdown = [
      ...RUNTIME_CORE_EXTERNS,
      { name: "ur_bogus_shutdown2", returnType: "void" as const, parameterTypes: [], callingConvention: "c" as const, kind: "runtime" as const, lifecycleRole: "shutdown" as const },
    ];
    const module: IRModule = { moduleName: "m", externs: duplicateShutdown, functions: [minimalFn] };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes('multiple externs with lifecycleRole "shutdown"'))).toBe(true);
  });

  it("ordinary Runtime functions (print/input/free/panic) all correctly have lifecycleRole 'none'", () => {
    const ordinary = RUNTIME_CORE_EXTERNS.filter(e => e.lifecycleRole === "none");
    expect(ordinary.map(e => e.name).sort()).toEqual(
      ["ur_free", "ur_input_string", "ur_panic", "ur_print_bool", "ur_print_float", "ur_print_int", "ur_print_string"].sort()
    );
  });

  it("exactly one Init and one Shutdown exist in the real Runtime table (sanity)", () => {
    expect(RUNTIME_CORE_EXTERNS.filter(e => e.lifecycleRole === "init")).toHaveLength(1);
    expect(RUNTIME_CORE_EXTERNS.filter(e => e.lifecycleRole === "shutdown")).toHaveLength(1);
  });
});

describe("shared/ir — checkModuleInvariants: local slots (load/store, Phase 2.6.1)", () => {
  function loc() { return SYNTHETIC_LOCATION; }

  it("a valid load/store sequence through a local slot has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "i", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "store", slot: 0, value: { id: 0 }, location: loc() },
            { kind: "load", id: 1, type: "i64", slot: 0, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 1 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("detects a store referencing an undefined local slot", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "store", slot: 99, value: { id: 0 }, location: loc() }, // slot 99 doesn't exist
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("store references undefined local slot 99"))).toBe(true);
  });

  it("detects a load referencing an undefined local slot", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "load", id: 0, type: "i64", slot: 42, location: loc() }],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("load references undefined local slot 42"))).toBe(true);
  });

  it("detects a store using an undefined SSA value", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "x", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "store", slot: 0, value: { id: 77 }, location: loc() }], // id 77 never defined
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("store uses undefined SSA value %77"))).toBe(true);
  });

  it("store defines no SSA id — a subsequent instruction id can safely reuse the same numeric value store 'occupies' conceptually (store has no id at all)", () => {
    // This test documents that `store` genuinely has no id field, so it
    // never collides with or consumes a slot in the SSA id numbering
    // space — a real distinction from every other instruction kind.
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "x", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 5n }, location: loc() },
            { kind: "store", slot: 0, value: { id: 0 }, location: loc() }, // no id — does not collide with id 0 above
            { kind: "load", id: 1, type: "i64", slot: 0, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 1 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  // ── Four rules added per review (before Phase 2.6.2) ───────────────────────

  it("RULE 1: a declared local slot never used by any load/store is a VERIFIER ERROR (not a warning)", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "dead", type: "i64" }], // never load/store'd
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() }],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("declared but never used"))).toBe(true);
  });

  it("RULE 2: load of a slot with no preceding store anywhere is flagged (conservative check)", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "uninit", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          // load BEFORE any store — never definitely assigned.
          instructions: [{ kind: "load", id: 0, type: "i64", slot: 0, location: loc() }],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("before any store to it was observed"))).toBe(true);
  });

  it("RULE 2 (negative case): load AFTER a store in an earlier block (array order) is NOT flagged — matches the entry-stores/loop-header-loads shape", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "i", type: "i64" }],
        blocks: [
          {
            id: 0, label: "entry",
            instructions: [
              { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
              { kind: "store", slot: 0, value: { id: 0 }, location: loc() },
            ],
            terminator: { kind: "branch", target: 1, location: loc() },
          },
          {
            id: 1, label: "loop_header",
            instructions: [{ kind: "load", id: 1, type: "i64", slot: 0, location: loc() }], // store already happened in an earlier block (array order)
            terminator: { kind: "return", value: { id: 1 }, location: loc() },
          },
        ],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("RULE 3: store referencing an undefined slot is flagged (already covered above; re-asserted here for grouping)", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "store", slot: 5, value: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("store references undefined local slot 5"))).toBe(true);
  });

  it("RULE 4: duplicate local slot ids are flagged", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "a", type: "i64" }, { id: 0, name: "b", type: "i64" }], // duplicate id
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "store", slot: 0, value: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("duplicate local slot id 0"))).toBe(true);
  });

  it("RULE 4: duplicate local slot names (different ids) are also flagged", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "x", type: "i64" }, { id: 1, name: "x", type: "i64" }], // duplicate name
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "store", slot: 0, value: { id: 0 }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 2n }, location: loc() },
            { kind: "store", slot: 1, value: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("duplicate local slot name 'x'"))).toBe(true);
  });

  it("a fully valid multi-slot, multi-block function (matching all four rules) has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "i", type: "i64" }, { id: 1, name: "total", type: "i64" }],
        blocks: [
          {
            id: 0, label: "entry",
            instructions: [
              { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
              { kind: "store", slot: 0, value: { id: 0 }, location: loc() },
              { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
              { kind: "store", slot: 1, value: { id: 1 }, location: loc() },
            ],
            terminator: { kind: "branch", target: 1, location: loc() },
          },
          {
            id: 1, label: "check",
            instructions: [
              { kind: "load", id: 2, type: "i64", slot: 0, location: loc() },
              { kind: "load", id: 3, type: "i64", slot: 1, location: loc() },
              { kind: "binop", id: 4, type: "i64", op: "add", left: { id: 2 }, right: { id: 3 }, location: loc() },
            ],
            terminator: { kind: "return", value: { id: 4 }, location: loc() },
          },
        ],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });
});

describe("shared/ir - checkModuleInvariants: CFG Verifier coverage for loops (Phase 2.6.5)", () => {
  function loc() { return SYNTHETIC_LOCATION; }

  it("an orphaned block in a loop-containing function is still correctly detected (existing reachability check, unchanged, applies to loops too)", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_g", sourceName: "g", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [
          { id: 0, label: "entry", instructions: [], terminator: { kind: "return_void", location: loc() } },
          { id: 4, label: "orphan", instructions: [], terminator: { kind: "return_void", location: loc() } },
        ],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("block 4") && v.message.includes("unreachable"))).toBe(true);
  });

  it("HONEST FINDING (documented, not a defect): a structurally-valid-but-semantically-wrong back edge (self-loop) cannot be detected by structural IR verification alone - this is correctly the job of targeted Lowering-level tests (see lower-to-ir.test.ts WATCH-POINT 1), not a generic checkModuleInvariants rule", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [
          { id: 0, label: "entry", instructions: [], terminator: { kind: "branch", target: 1, location: loc() } },
          {
            id: 1, label: "loop_header", instructions: [{ kind: "const", id: 0, type: "bool", value: { kind: "const_bool", value: true }, location: loc() }],
            terminator: { kind: "cond_branch", condition: { id: 0 }, thenTarget: 2, elseTarget: 3, location: loc() },
          },
          { id: 2, label: "loop_body", instructions: [], terminator: { kind: "branch", target: 2, location: loc() } },
          { id: 3, label: "loop_exit", instructions: [], terminator: { kind: "return_void", location: loc() } },
        ],
      }],
    };
    // Both block 2 (self-loop) and block 3 (loop_exit, still reachable via
    // loop_header's OTHER edge) remain structurally reachable - the
    // verifier correctly reports ZERO violations for this structurally
    // legal (if semantically buggy) CFG shape.
    expect(checkModuleInvariants(module)).toEqual([]);
  });
});

describe("shared/ir - checkModuleInvariants: array_load/array_store (Level 2.8)", () => {
  function loc() { return SYNTHETIC_LOCATION; }

  it("a valid array_store then array_load sequence has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3, isArray: true }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 42n }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 0 }, value: { id: 1 }, location: loc() },
            { kind: "array_load", id: 2, type: "i64", slot: 0, index: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 2 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });

  it("detects an array_store referencing an undefined local slot", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "array_store", slot: 99, index: { id: 0 }, value: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("array_store references undefined local slot 99"))).toBe(true);
  });

  it("detects an array_load referencing an undefined local slot", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "array_load", id: 1, type: "i64", slot: 42, index: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 1 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("array_load references undefined local slot 42"))).toBe(true);
  });

  it("detects an array_store using an undefined SSA index value", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3 }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 1n }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 77 }, value: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("array_store uses undefined SSA index value %77"))).toBe(true);
  });

  it("detects an array_load using an undefined SSA index value", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3 }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [{ kind: "array_load", id: 0, type: "i64", slot: 0, index: { id: 55 }, location: loc() }],
          terminator: { kind: "return", value: { id: 0 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("use of undefined SSA value %55"))).toBe(true);
  });

  it("an array slot (length > 1) used only by array_load/array_store is NOT flagged as an unused slot", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3, isArray: true }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 5n }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 0 }, value: { id: 1 }, location: loc() },
            { kind: "array_load", id: 2, type: "i64", slot: 0, index: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 2 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });
});

describe("shared/ir - checkModuleInvariants: array-slot consistency (Level 2.8, per review request)", () => {
  function loc() { return SYNTHETIC_LOCATION; }

  it("REQUIRED: array_load targeting a SCALAR slot (no length > 1) is flagged", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_f", sourceName: "f", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "scalar", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "array_load", id: 1, type: "i64", slot: 0, index: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 1 }, location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("is not an array"))).toBe(true);
  });

  it("REQUIRED: array_store targeting a SCALAR slot (no length > 1) is flagged", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_g", sourceName: "g", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "scalar", type: "i64" }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 5n }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 0 }, value: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("is not an array"))).toBe(true);
  });

  it("REQUIRED: array_store with a value type that does not match the array's element type is flagged", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_h", sourceName: "h", params: [], returnType: "void", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3 }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "bool", value: { kind: "const_bool", value: true }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 0 }, value: { id: 1 }, location: loc() },
          ],
          terminator: { kind: "return_void", location: loc() },
        }],
      }],
    };
    const violations = checkModuleInvariants(module);
    expect(violations.some(v => v.message.includes("element type") && v.message.includes("bool"))).toBe(true);
  });

  it("a valid array_load/array_store on a genuine array slot (length > 1) with matching types has zero violations", () => {
    const module: IRModule = {
      moduleName: "m", externs: RUNTIME_CORE_EXTERNS,
      functions: [{
        qualifiedName: "ur_m_i", sourceName: "i", params: [], returnType: "i64", entryBlock: 0, location: loc(),
        locals: [{ id: 0, name: "arr", type: "i64", length: 3, isArray: true }],
        blocks: [{
          id: 0, label: "entry",
          instructions: [
            { kind: "const", id: 0, type: "i64", value: { kind: "const_int", value: 0n }, location: loc() },
            { kind: "const", id: 1, type: "i64", value: { kind: "const_int", value: 42n }, location: loc() },
            { kind: "array_store", slot: 0, index: { id: 0 }, value: { id: 1 }, location: loc() },
            { kind: "array_load", id: 2, type: "i64", slot: 0, index: { id: 0 }, location: loc() },
          ],
          terminator: { kind: "return", value: { id: 2 }, location: loc() },
        }],
      }],
    };
    expect(checkModuleInvariants(module)).toEqual([]);
  });
});
