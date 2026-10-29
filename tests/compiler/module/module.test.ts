// ─────────────────────────────────────────────────────────────────────────────
// UR Language 1.0 — Module System Tests (ported from RC2)
// ─────────────────────────────────────────────────────────────────────────────
//
// Ported from RC2's tests/module/module.test.ts (101 original tests) per
// FRONTEND_TEST_MIGRATION_REPORT.md.
//
// Many tests below are KEPT VERBATIM (zero syntax change) because they
// construct ModuleDescriptor/ImportRecord objects directly and never touch
// the Parser (ImportResolver path resolution, topologicalOrder, checkExports
// against hand-built descriptors, MCODES constants). Tests that parse UR
// source through buildModuleDescriptor/ModuleRegistry.register are rewritten
// to UR 1.0 syntax. Tests exercising `module` declaration, `const`, or
// `import x as y` alias syntax are deferred — see the "Deferred tests" block
// and FRONTEND_TEST_MIGRATION_REPORT.md.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { lex } from "../../../src/compiler/frontend/lexer.js";
import { parse } from "../../../src/compiler/frontend/parser.js";
import {
  makeModuleDescriptor,
  type ModuleDescriptor,
} from "../../../src/compiler/module/module-descriptor.js";
import { ImportResolver, topologicalOrder } from "../../../src/compiler/module/import-resolver.js";
import {
  buildModuleDescriptor, checkExports, exportsOf, lookupExport, MCODES,
} from "../../../src/compiler/module/export-checker.js";
import { ModuleRegistry } from "../../../src/compiler/module/registry.js";
import { T_INT, T_BOOL, T_STRING, T_UNKNOWN } from "../../../src/compiler/typesystem/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsed(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length > 0) throw new Error(`parse errors: ${errors.map(e => e.message).join("; ")}`);
  return program;
}

function registry(...entries: Array<[string, string]>): Map<string, ModuleDescriptor> {
  const reg = new Map<string, ModuleDescriptor>();
  for (const [path, src] of entries) {
    const { descriptor } = buildModuleDescriptor(parsed(src), path);
    reg.set(path, descriptor);
  }
  return reg;
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleDescriptor — kept verbatim, no parser dependency (5 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleDescriptor — makeModuleDescriptor", () => {
  it("creates a descriptor with the given filePath", () => {
    const d = makeModuleDescriptor("/app/main.ur");
    expect(d.filePath).toBe("/app/main.ur");
  });

  it("derives module name from file stem when no name given", () => {
    expect(makeModuleDescriptor("/app/math.ur").name).toBe("math");
    expect(makeModuleDescriptor("/app/utils/string.ur").name).toBe("string");
  });

  it("uses explicit name when provided", () => {
    expect(makeModuleDescriptor("/app/main.ur", "myapp").name).toBe("myapp");
  });

  it("starts with empty exports and imports", () => {
    const d = makeModuleDescriptor("/app/main.ur");
    expect(d.exports.size).toBe(0);
    expect(d.imports).toEqual([]);
  });

  it("starts as unresolved", () => {
    expect(makeModuleDescriptor("/app/main.ur").resolved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildModuleDescriptor from AST — 11 of 16 rewritten to UR 1.0 syntax
// ─────────────────────────────────────────────────────────────────────────────

describe("buildModuleDescriptor — from AST", () => {
  it("exports functions as 'function' kind", () => {
    const { descriptor } = buildModuleDescriptor(parsed("function add(a: int, b: int): int\nend\n"), "/m.ur");
    expect(descriptor.exports.has("add")).toBe(true);
    expect(descriptor.exports.get("add")?.kind).toBe("function");
  });

  it("function export has correct param and return types", () => {
    const { descriptor } = buildModuleDescriptor(parsed("function add(a: int, b: int): int\nend\n"), "/m.ur");
    const exp = descriptor.exports.get("add")!;
    expect(exp.type.kind).toBe("Function");
    if (exp.type.kind === "Function") {
      expect(exp.type.params.length).toBe(2);
      expect(exp.type.ret).toEqual(T_INT);
    }
  });

  it("exports global let as 'variable' kind", () => {
    const { descriptor } = buildModuleDescriptor(parsed("let x: int = 5\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.exports.get("x")?.kind).toBe("variable");
    expect(descriptor.exports.get("x")?.type).toEqual(T_INT);
  });

  it("exports bool-typed global", () => {
    const { descriptor } = buildModuleDescriptor(parsed("let flag: bool = true\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.exports.get("flag")?.type).toEqual(T_BOOL);
  });

  it("exports string-typed global", () => {
    const { descriptor } = buildModuleDescriptor(parsed('let msg: string = "hi"\nfunction f()\nend\n'), "/m.ur");
    expect(descriptor.exports.get("msg")?.type).toEqual(T_STRING);
  });

  it("extracts import records with derived alias (single-segment path)", () => {
    const { descriptor } = buildModuleDescriptor(parsed("import io\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.imports.length).toBe(1);
    expect(descriptor.imports[0]?.path).toBe("io");
    expect(descriptor.imports[0]?.alias).toBe("io");
  });

  it("derives import alias from last segment of a dotted path", () => {
    const { descriptor } = buildModuleDescriptor(parsed("import std.io\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.imports[0]?.path).toBe("std/io");
    expect(descriptor.imports[0]?.alias).toBe("io");
  });

  it("handles multiple imports", () => {
    const src = "import io\nimport math\nfunction f()\nend\n";
    const { descriptor } = buildModuleDescriptor(parsed(src), "/m.ur");
    expect(descriptor.imports.length).toBe(2);
    expect(descriptor.imports.map(i => i.alias)).toEqual(["io", "math"]);
  });

  it("reports MD1001 for duplicate exports", () => {
    const src = "function add()\nend\nfunction add()\nend\n";
    const { diagnostics } = buildModuleDescriptor(parsed(src), "/m.ur");
    expect(diagnostics.some(d => d.code === MCODES.DUPLICATE_EXPORT)).toBe(true);
  });

  it("reports error for global and function with same name", () => {
    const src = "let add: int = 0\nfunction add()\nend\n";
    const { diagnostics } = buildModuleDescriptor(parsed(src), "/m.ur");
    expect(diagnostics.some(d => d.code === MCODES.DUPLICATE_EXPORT)).toBe(true);
  });

  it("zero diagnostics for clean module", () => {
    const { diagnostics } = buildModuleDescriptor(parsed("function f(a: int): int\n  return a\nend\n"), "/m.ur");
    expect(diagnostics).toEqual([]);
  });

  it("unannotated global has Unknown type", () => {
    const { descriptor } = buildModuleDescriptor(parsed("let x = 5\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.exports.get("x")?.type).toEqual(T_UNKNOWN);
  });

  it("empty program produces empty descriptor", () => {
    const { descriptor, diagnostics } = buildModuleDescriptor(parsed(""), "/m.ur");
    expect(diagnostics).toEqual([]);
    expect(descriptor.exports.size).toBe(0);
    expect(descriptor.imports.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ImportResolver — path resolution — kept verbatim, no parser dependency (10)
// ─────────────────────────────────────────────────────────────────────────────

describe("ImportResolver — path resolution", () => {
  const reg = new Map<string, ModuleDescriptor>();
  const resolver = new ImportResolver(reg, {
    stdlibRoot: "/stdlib",
    packagesRoot: "/pkgs",
    extension: ".ur",
  });

  it("resolves relative path ./utils from /app/main.ur", () => {
    const r = resolver.resolve("./utils", "/app/main.ur");
    expect(r.error).toBeUndefined();
    expect(r.resolvedPath).toBe("app/utils.ur");
  });

  it("resolves relative path ../shared from /app/sub/mod.ur", () => {
    const r = resolver.resolve("../shared", "/app/sub/mod.ur");
    expect(r.resolvedPath).toBe("app/shared.ur");
  });

  it("resolves std/io to stdlib root", () => {
    const r = resolver.resolve("std/io", "/app/main.ur");
    expect(r.resolvedPath).toBe("stdlib/io.ur");
  });

  it("resolves std/math to stdlib root", () => {
    const r = resolver.resolve("std/math", "/app/main.ur");
    expect(r.resolvedPath).toBe("stdlib/math.ur");
  });

  it("resolves bare package name to packages root index", () => {
    const r = resolver.resolve("mylib", "/app/main.ur");
    expect(r.resolvedPath).toBe("pkgs/mylib/index.ur");
  });

  it("resolves scoped package path", () => {
    const r = resolver.resolve("mylib/utils", "/app/main.ur");
    expect(r.resolvedPath).toBe("pkgs/mylib/utils.ur");
  });

  it("appends extension when not present", () => {
    const r = resolver.resolve("./helper", "/app/main.ur");
    expect(r.resolvedPath?.endsWith(".ur")).toBe(true);
  });

  it("does not double-append extension", () => {
    const r = resolver.resolve("./helper.ur", "/app/main.ur");
    expect(r.resolvedPath?.endsWith(".ur.ur")).toBe(false);
  });

  it("normalizes .. segments in path", () => {
    const r = resolver.resolve("../../root", "/a/b/c.ur");
    expect(r.resolvedPath).toBe("root.ur");
  });

  it("resolveAll mutates ImportRecord.resolvedPath", () => {
    const reg2 = new Map<string, ModuleDescriptor>();
    const resolver2 = new ImportResolver(reg2);
    const mod = makeModuleDescriptor("/app/main.ur");
    mod.imports.push({ path: "std/io", alias: "io" });
    const errors = resolver2.resolveAll(mod);
    expect(errors).toEqual([]);
    expect(mod.imports[0]?.resolvedPath).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ImportResolver — circular detection — kept verbatim (2 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ImportResolver — circular detection", () => {
  it("detects a 2-module circular dependency", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const a = makeModuleDescriptor("/a.ur");
    const b = makeModuleDescriptor("/b.ur");
    a.imports.push({ path: "./b", alias: "b", resolvedPath: "/b.ur" });
    b.imports.push({ path: "./a", alias: "a", resolvedPath: "/a.ur" });
    regMap.set("/a.ur", a);
    regMap.set("/b.ur", b);
    const resolver = new ImportResolver(regMap);
    const cycles = resolver.detectCycles();
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("returns no cycles for a clean DAG", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const a = makeModuleDescriptor("/a.ur");
    const b = makeModuleDescriptor("/b.ur");
    const c = makeModuleDescriptor("/c.ur");
    a.imports.push({ path: "./b", alias: "b", resolvedPath: "/b.ur" });
    b.imports.push({ path: "./c", alias: "c", resolvedPath: "/c.ur" });
    regMap.set("/a.ur", a); regMap.set("/b.ur", b); regMap.set("/c.ur", c);
    const cycles = new ImportResolver(regMap).detectCycles();
    expect(cycles).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// topologicalOrder — kept verbatim (3 tests, plus 2 more below)
// ─────────────────────────────────────────────────────────────────────────────

describe("topologicalOrder", () => {
  it("orders dependencies before dependents", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const a = makeModuleDescriptor("/a.ur", "a");
    const b = makeModuleDescriptor("/b.ur", "b");
    const c = makeModuleDescriptor("/c.ur", "c");
    a.imports.push({ path: "./b", alias: "b", resolvedPath: "/b.ur" });
    b.imports.push({ path: "./c", alias: "c", resolvedPath: "/c.ur" });
    regMap.set("/a.ur", a); regMap.set("/b.ur", b); regMap.set("/c.ur", c);
    const order = topologicalOrder(regMap).map(m => m.name);
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("a"));
  });

  it("handles single module", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    regMap.set("/a.ur", makeModuleDescriptor("/a.ur", "a"));
    expect(topologicalOrder(regMap).length).toBe(1);
  });

  it("handles empty registry", () => {
    expect(topologicalOrder(new Map())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export Checker — kept verbatim, operates on hand-built descriptors (3)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkExports", () => {
  it("no errors when all imports resolve to known modules", () => {
    const regMap = registry(
      ["/a.ur", "function helper()\nend\n"],
      ["/b.ur", "import a\nfunction main()\nend\n"],
    );
    const b = regMap.get("/b.ur")!;
    b.imports[0]!.resolvedPath = "/a.ur";
    const diags = checkExports(b, regMap);
    expect(diags).toEqual([]);
  });

  it("reports MD1005 when resolved module not in registry", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const mod = makeModuleDescriptor("/main.ur");
    mod.imports.push({ path: "missing", alias: "m", resolvedPath: "/missing.ur" });
    regMap.set("/main.ur", mod);
    const diags = checkExports(mod, regMap);
    expect(diags.some(d => d.code === MCODES.MISSING_MODULE)).toBe(true);
  });

  it("no errors when import has no resolvedPath (unresolved — handled by resolver)", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const mod = makeModuleDescriptor("/main.ur");
    mod.imports.push({ path: "unresolved", alias: "u" }); // no resolvedPath
    regMap.set("/main.ur", mod);
    expect(checkExports(mod, regMap)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportsOf / lookupExport — 4 rewritten to UR 1.0 syntax
// ─────────────────────────────────────────────────────────────────────────────

describe("exportsOf / lookupExport", () => {
  it("returns exports of the imported module by alias", () => {
    const regMap = registry(["/math.ur", "function add(a: int, b: int): int\nend\n"]);
    const main = makeModuleDescriptor("/main.ur");
    main.imports.push({ path: "./math", alias: "math", resolvedPath: "/math.ur" });
    regMap.set("/main.ur", main);
    const exports = exportsOf("math", main, regMap);
    expect(exports.has("add")).toBe(true);
  });

  it("returns empty map for unknown alias", () => {
    const regMap = new Map<string, ModuleDescriptor>();
    const main = makeModuleDescriptor("/main.ur");
    regMap.set("/main.ur", main);
    expect(exportsOf("unknown", main, regMap).size).toBe(0);
  });

  it("lookupExport finds an export by alias+name", () => {
    const regMap = registry(["/math.ur", "function add(a: int, b: int): int\nend\n"]);
    const main = makeModuleDescriptor("/main.ur");
    main.imports.push({ path: "./math", alias: "math", resolvedPath: "/math.ur" });
    regMap.set("/main.ur", main);
    const exp = lookupExport("math", "add", main, regMap);
    expect(exp).toBeDefined();
    expect(exp?.kind).toBe("function");
  });

  it("lookupExport returns undefined for missing name", () => {
    const regMap = registry(["/math.ur", "function add()\nend\n"]);
    const main = makeModuleDescriptor("/main.ur");
    main.imports.push({ path: "./math", alias: "math", resolvedPath: "/math.ur" });
    regMap.set("/main.ur", main);
    expect(lookupExport("math", "nonexistent", main, regMap)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry (end-to-end) — 4 rewritten to UR 1.0 syntax
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — registration", () => {
  it("registers a single module", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function f()\nend\n"), "/main.ur");
    expect(reg.size()).toBe(1);
    expect(reg.get("/main.ur")).toBeDefined();
  });

  it("registers multiple modules", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function a()\nend\n"), "/a.ur");
    reg.register(parsed("function b()\nend\n"), "/b.ur");
    expect(reg.size()).toBe(2);
  });

  it("register returns diagnostics for duplicate exports", () => {
    const reg = new ModuleRegistry();
    const diags = reg.register(parsed("function f()\nend\nfunction f()\nend\n"), "/m.ur");
    expect(diags.some(d => d.code === MCODES.DUPLICATE_EXPORT)).toBe(true);
  });

  it("all() returns all registered modules", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function a()\nend\n"), "/a.ur");
    reg.register(parsed("function b()\nend\n"), "/b.ur");
    expect(reg.all().length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry — resolveAll — 6 of 7 rewritten
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — resolveAll", () => {
  it("valid single-module build produces no errors", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function main()\nend\n"), "/main.ur");
    const { valid, diagnostics } = reg.resolveAll();
    expect(valid).toBe(true);
    expect(diagnostics).toEqual([]);
  });

  it("marks descriptors as resolved after resolveAll", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function f()\nend\n"), "/m.ur");
    reg.resolveAll();
    expect(reg.get("/m.ur")?.resolved).toBe(true);
  });

  it("produces a build order with one module", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function f()\nend\n"), "/a.ur");
    const { buildOrder } = reg.resolveAll();
    expect(buildOrder.length).toBe(1);
  });

  it("produces topological build order for two modules", () => {
    const reg = new ModuleRegistry({ extension: ".ur" });
    reg.register(parsed("function helper()\nend\n"), "/b.ur");
    reg.register(parsed("import b\nfunction main()\nend\n"), "/a.ur");
    const { buildOrder } = reg.resolveAll();
    const names = buildOrder.map(m => m.filePath);
    expect(names.indexOf("/b.ur")).toBeLessThan(names.indexOf("/a.ur"));
  });

  it("findExport locates a name across modules", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function add(a: int, b: int): int\nend\n"), "/math.ur");
    reg.resolveAll();
    const found = reg.findExport("add");
    expect(found?.filePath).toBe("/math.ur");
    expect(found?.descriptor.exports.get("add")?.kind).toBe("function");
  });

  it("findExport returns undefined for unknown name", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function f()\nend\n"), "/m.ur");
    expect(reg.findExport("nonexistent")).toBeUndefined();
  });

  it("resolveImport returns a path string", () => {
    const reg = new ModuleRegistry({ stdlibRoot: "/stdlib", extension: ".ur" });
    const path = reg.resolveImport("std/io", "/main.ur");
    expect(typeof path).toBe("string");
    expect(path?.includes("io")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry — RegistryResult shape — kept verbatim (2 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — RegistryResult shape", () => {
  it("result has diagnostics array and buildOrder array", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function f()\nend\n"), "/m.ur");
    const result = reg.resolveAll();
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(Array.isArray(result.buildOrder)).toBe(true);
    expect(typeof result.valid).toBe("boolean");
  });

  it("never throws on empty registry", () => {
    expect(() => new ModuleRegistry().resolveAll()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildModuleDescriptor — import alias derivation — 2 of 3 rewritten
// ─────────────────────────────────────────────────────────────────────────────

describe("buildModuleDescriptor — import alias derivation", () => {
  it("derives alias from single-segment import path", () => {
    const { descriptor } = buildModuleDescriptor(parsed("import list\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.imports[0]?.alias).toBe("list");
  });
  it("derives alias from last segment of a multi-part dotted path", () => {
    const { descriptor } = buildModuleDescriptor(parsed("import mylib.utils.string\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.imports[0]?.alias).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry — findExport across modules — kept, 2 rewritten
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — findExport across modules", () => {
  it("finds export in second of two modules", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function alpha()\nend\n"), "/a.ur");
    reg.register(parsed("function beta()\nend\n"), "/b.ur");
    reg.resolveAll();
    expect(reg.findExport("beta")?.filePath).toBe("/b.ur");
  });
  it("findExport returns the function export kind", () => {
    const reg = new ModuleRegistry();
    reg.register(parsed("function compute(x: int): int\n  return x\nend\n"), "/compute.ur");
    reg.resolveAll();
    expect(reg.findExport("compute")?.descriptor.exports.get("compute")?.kind).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// topologicalOrder — various shapes — kept verbatim (2 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("topologicalOrder — various shapes", () => {
  it("two independent modules both appear in result", () => {
    const reg = new Map<string, ReturnType<typeof makeModuleDescriptor>>();
    reg.set("/a.ur", makeModuleDescriptor("/a.ur", "a"));
    reg.set("/b.ur", makeModuleDescriptor("/b.ur", "b"));
    expect(topologicalOrder(reg).length).toBe(2);
  });
  it("self-referencing module (no resolvedPath) produces no crash", () => {
    const reg = new Map<string, ReturnType<typeof makeModuleDescriptor>>();
    const a = makeModuleDescriptor("/a.ur", "a");
    a.imports.push({ path: "./a", alias: "a" }); // no resolvedPath
    reg.set("/a.ur", a);
    expect(() => topologicalOrder(reg)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ImportResolver — resolveAll with custom config — kept verbatim (2)
// ─────────────────────────────────────────────────────────────────────────────

describe("ImportResolver — resolveAll with custom config", () => {
  it("uses custom stdlibRoot", () => {
    const r = new ImportResolver(new Map(), { stdlibRoot: "/custom/stdlib", extension: ".ur" });
    const result = r.resolve("std/io", "/m.ur");
    expect(result.resolvedPath?.startsWith("custom/stdlib")).toBe(true);
  });
  it("uses custom packagesRoot", () => {
    const r = new ImportResolver(new Map(), { packagesRoot: "/vendor", extension: ".ur" });
    expect(r.resolve("mylib", "/m.ur").resolvedPath?.startsWith("vendor")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry — resolveImport paths — kept verbatim (3)
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — resolveImport paths", () => {
  it("returns undefined-free string for stdlib import", () => {
    const reg = new ModuleRegistry({ stdlibRoot: "/stdlib", extension: ".ur" });
    const path = reg.resolveImport("std/math", "/app/main.ur");
    expect(path).toBeDefined();
    expect(path?.includes("math")).toBe(true);
  });
  it("relative import resolves correctly", () => {
    const reg = new ModuleRegistry({ extension: ".ur" });
    const path = reg.resolveImport("./helper", "/app/main.ur");
    expect(path?.endsWith("helper.ur")).toBe(true);
  });
  it("package import resolves to index file", () => {
    const reg = new ModuleRegistry({ packagesRoot: "/pkgs", extension: ".ur" });
    const path = reg.resolveImport("awesome-lib", "/m.ur");
    expect(path?.endsWith("index.ur")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleDescriptor — exports map operations — 2 of 3 rewritten
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleDescriptor — exports map operations", () => {
  it("can iterate all exports", () => {
    const { descriptor } = buildModuleDescriptor(parsed("function a()\nend\nfunction b()\nend\nfunction c()\nend\n"), "/m.ur");
    const names = Array.from(descriptor.exports.keys()).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });
  it("exports map values have name field matching key", () => {
    const { descriptor } = buildModuleDescriptor(parsed("function myFn()\nend\n"), "/m.ur");
    const exp = descriptor.exports.get("myFn")!;
    expect(exp.name).toBe("myFn");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ModuleRegistry — misc — kept verbatim (4 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ModuleRegistry — misc", () => {
  it("size() returns 0 for empty registry", () => expect(new ModuleRegistry().size()).toBe(0));
  it("get() returns undefined for unknown path", () => expect(new ModuleRegistry().get("/none.ur")).toBeUndefined());
  it("all() returns empty array for empty registry", () => expect(new ModuleRegistry().all()).toEqual([]));
  it("resolveAll returns valid:true for empty registry", () => expect(new ModuleRegistry().resolveAll().valid).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// Deferred tests — see FRONTEND_TEST_MIGRATION_REPORT.md (10 total)
// ─────────────────────────────────────────────────────────────────────────────

describe("module — deferred tests (10 total, documented gaps, not failures)", () => {
  it("DEFERRED: 'module' declaration keyword is not in the UR 1.0 grammar (1 test)", () => {
    // RC2 test deferred: "extracts module name from `module` declaration".
    // UR 1.0 has no top-level `module` keyword; Program.modules is always [].
    expect(parsed("function f()\nend\n").modules).toEqual([]);
  });

  it("DEFERRED: 'import x as y' alias syntax is not parsed by UR 1.0 (3 tests)", () => {
    // RC2 tests deferred: "extracts import records" (explicit alias form),
    // "import with no alias preserves path as fallback" (RC2's string-literal
    // import form `import "x"`), "import with alias" variants.
    const p = parsed("import io\nfunction f()\nend\n");
    expect(p.imports[0]?.alias).toBeUndefined(); // alias is only set by buildModuleDescriptor's derivation, not the Parser
  });

  it("DEFERRED: 'const' keyword — export kind 'const' vs 'variable' (3 tests)", () => {
    // RC2 tests deferred: "exports global const as 'const' kind",
    // "mixed globals and functions all exported" (used const), one more
    // const-specific export test. UR 1.0 has no const/let distinction yet;
    // all global bindings currently export as kind "variable".
    const { descriptor } = buildModuleDescriptor(parsed("let x: int = 5\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.exports.get("x")?.kind).toBe("variable"); // never "const" in UR 1.0 today
  });

  it("DEFERRED: RC2 string-literal import form 'import \"path\"' vs UR 1.0 identifier-path form (3 tests)", () => {
    // RC2 tests deferred: three variants of buildModuleDescriptor tests that
    // used RC2's `import "std/io" as io` string-literal import syntax.
    // UR 1.0 uses `import std.io` (identifier path, §5.2) — the equivalent
    // logic IS covered above in "buildModuleDescriptor — from AST" and
    // "import alias derivation", just with the correct UR 1.0 syntax.
    const { descriptor } = buildModuleDescriptor(parsed("import std.io\nfunction f()\nend\n"), "/m.ur");
    expect(descriptor.imports[0]?.path).toBe("std/io");
  });
});
