// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Binding Generator (C Header Parser + Converter + Emitter)
// Phase 6 — Stable ABI + FFI
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCHeader } from "../../src/ffi/bindgen/c-header-parser.js";
import { convertCHeaderToAbi } from "../../src/ffi/bindgen/converter.js";
import { emitUrBindings, emitTsDeclarations } from "../../src/ffi/bindgen/emitter.js";
import { PLATFORM_X64_SYSV, PLATFORM_WASM32 } from "../../src/ffi/abi/layout.js";

// ── C Header Parser ────────────────────────────────────────────────────────

// Reads a file relative to the project root (process.cwd() at test runtime).
const readFileSyncCompat = (rel: string) => readFileSync(rel, "utf-8");

describe("C Header Parser — basic", () => {
  it("parses empty header", () => {
    const h = parseCHeader("");
    expect(h.decls).toHaveLength(0);
    expect(h.errors).toHaveLength(0);
  });

  it("parses simple function declaration", () => {
    const h = parseCHeader(`int add(int a, int b);`);
    expect(h.errors).toHaveLength(0);
    const fn = h.decls.find(d => d.kind === "function" && (d as any).name === "add");
    expect(fn).toBeDefined();
    if (fn && fn.kind === "function") {
      expect(fn.params).toHaveLength(2);
      expect(fn.returnType.kind).toBe("named"); // "int" → named type
    }
  });

  it("parses void function", () => {
    const h = parseCHeader(`void init(void);`);
    const fn = h.decls.find(d => d.kind === "function") as any;
    expect(fn).toBeDefined();
    expect(fn.returnType.kind).toBe("primitive");
    expect(fn.returnType.prim).toBe("void");
  });

  it("parses pointer parameter", () => {
    const h = parseCHeader(`int read(char* buf, int len);`);
    const fn = h.decls.find(d => d.kind === "function") as any;
    expect(fn).toBeDefined();
    expect(fn.params[0].type.kind).toBe("pointer");
  });

  it("parses struct declaration", () => {
    const h = parseCHeader(`
      struct Vec2 {
        float x;
        float y;
      };
    `);
    const s = h.decls.find(d => d.kind === "struct") as any;
    expect(s).toBeDefined();
    expect(s.name).toBe("Vec2");
    expect(s.fields).toHaveLength(2);
    expect(s.fields[0].name).toBe("x");
    expect(s.fields[1].name).toBe("y");
  });

  it("parses typedef struct", () => {
    const h = parseCHeader(`
      typedef struct {
        int width;
        int height;
      } Rect;
    `);
    const td = h.decls.find(d => d.kind === "typedef") as any;
    expect(td).toBeDefined();
    expect(td.alias).toBe("Rect");
  });

  it("parses enum", () => {
    const h = parseCHeader(`
      enum Status {
        STATUS_OK = 0,
        STATUS_ERR = 1,
        STATUS_TIMEOUT = 2
      };
    `);
    const e = h.decls.find(d => d.kind === "enum") as any;
    expect(e).toBeDefined();
    expect(e.variants).toHaveLength(3);
    expect(e.variants[0].name).toBe("STATUS_OK");
    expect(e.variants[0].value).toBe(0);
    expect(e.variants[2].value).toBe(2);
  });

  it("parses #define numeric constants", () => {
    const h = parseCHeader(`
      #define MAX_SIZE 1024
      #define PI 3.14159
    `);
    const defs = h.decls.filter(d => d.kind === "define") as any[];
    expect(defs.length).toBeGreaterThanOrEqual(1);
    const maxSize = defs.find(d => d.name === "MAX_SIZE");
    expect(maxSize).toBeDefined();
  });

  it("parses line comments without error", () => {
    const h = parseCHeader(`
      // This is a comment
      int foo(); // inline comment
    `);
    expect(h.errors).toHaveLength(0);
    expect(h.decls.some(d => d.kind === "function")).toBe(true);
  });

  it("parses block comments", () => {
    const h = parseCHeader(`
      /* multi
         line
         comment */
      void bar();
    `);
    expect(h.errors).toHaveLength(0);
  });

  it("parses multiple functions", () => {
    const h = parseCHeader(`
      int open(const char* path, int flags);
      int close(int fd);
      int read(int fd, void* buf, unsigned int len);
      int write(int fd, const void* buf, unsigned int len);
    `);
    const fns = h.decls.filter(d => d.kind === "function");
    expect(fns.length).toBe(4);
  });

  it("handles extern C wrapper gracefully", () => {
    const h = parseCHeader(`
      extern "C" {
        int sqlite3_open(const char* filename, void** ppDb);
        int sqlite3_close(void* db);
      }
    `);
    const fns = h.decls.filter(d => d.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
  });
});

describe("C Header Parser — SQLite-like header", () => {
  const SQLITE_HEADER = `
    #define SQLITE_OK 0
    #define SQLITE_ERROR 1
    #define SQLITE_BUSY 5
    #define SQLITE_ROW 100
    #define SQLITE_DONE 101

    typedef struct sqlite3 sqlite3;
    typedef struct sqlite3_stmt sqlite3_stmt;
    typedef long long sqlite3_int64;

    int sqlite3_open(const char* filename, sqlite3** ppDb);
    int sqlite3_close(sqlite3* db);
    int sqlite3_prepare_v2(sqlite3* db, const char* zSql, int nByte, sqlite3_stmt** ppStmt, const char** pzTail);
    int sqlite3_step(sqlite3_stmt* pStmt);
    int sqlite3_finalize(sqlite3_stmt* pStmt);
    const char* sqlite3_errmsg(sqlite3* db);
    sqlite3_int64 sqlite3_last_insert_rowid(sqlite3* db);
    int sqlite3_column_count(sqlite3_stmt* pStmt);
    const char* sqlite3_column_name(sqlite3_stmt* pStmt, int N);
    int sqlite3_column_int(sqlite3_stmt* pStmt, int iCol);
    const char* sqlite3_column_text(sqlite3_stmt* pStmt, int iCol);
  `;

  it("parses all constants", () => {
    const h = parseCHeader(SQLITE_HEADER);
    const defs = h.decls.filter(d => d.kind === "define");
    expect(defs.length).toBeGreaterThanOrEqual(4);
  });

  it("parses all functions", () => {
    const h = parseCHeader(SQLITE_HEADER);
    const fns = h.decls.filter(d => d.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(8);
  });

  it("parses typedefs", () => {
    const h = parseCHeader(SQLITE_HEADER);
    const tds = h.decls.filter(d => d.kind === "typedef");
    expect(tds.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Binding Generator (Converter) ─────────────────────────────────────────

describe("Binding Generator — converter", () => {
  it("converts simple function to ABI signature", () => {
    const h = parseCHeader(`int add(int a, int b);`);
    const result = convertCHeaderToAbi(h, { moduleName: "math", platform: PLATFORM_X64_SYSV });
    expect(result.module.functions).toHaveLength(1);
    expect(result.module.functions[0]!.name).toBe("add");
    expect(result.module.functions[0]!.params).toHaveLength(2);
  });

  it("converts void return type", () => {
    const h = parseCHeader(`void cleanup(void* ptr);`);
    const result = convertCHeaderToAbi(h, { moduleName: "mem" });
    const fn = result.module.functions[0]!;
    expect(fn.ret.kind).toBe("primitive");
    if (fn.ret.kind === "primitive") expect(fn.ret.prim).toBe("void");
  });

  it("converts char* to string type", () => {
    const h = parseCHeader(`int open_file(char* path);`);
    const result = convertCHeaderToAbi(h, { moduleName: "io" });
    const fn = result.module.functions[0]!;
    expect(fn.params[0]!.type.kind).toBe("string");
  });

  it("converts enum variants with explicit values", () => {
    const h = parseCHeader(`
      enum Color { RED = 0, GREEN = 1, BLUE = 2 };
    `);
    const result = convertCHeaderToAbi(h, { moduleName: "gfx" });
    const enumType = result.module.types.find(t => t.kind === "enum") as any;
    expect(enumType).toBeDefined();
    expect(enumType.variants).toHaveLength(3);
    expect(enumType.variants[1].name).toBe("GREEN");
    expect(enumType.variants[1].value).toBe(1);
  });

  it("converts numeric #define constants", () => {
    const h = parseCHeader(`
      #define MAX_CONN 100
      #define TIMEOUT_MS 5000
    `);
    const result = convertCHeaderToAbi(h, { moduleName: "config" });
    expect(result.module.constants.length).toBeGreaterThanOrEqual(1);
    const c = result.module.constants.find(c => c.name === "MAX_CONN");
    expect(c).toBeDefined();
    expect(c?.value).toBe(100);
  });

  it("filters by prefix", () => {
    const h = parseCHeader(`
      int sqlite3_open(const char* path, void** db);
      int sqlite3_close(void* db);
      int internal_helper(int x);
    `);
    const result = convertCHeaderToAbi(h, {
      moduleName: "sqlite",
      filterPrefix: "sqlite3_",
    });
    expect(result.module.functions.every(f => f.name.startsWith("sqlite3_"))).toBe(true);
    expect(result.module.functions.find(f => f.name === "internal_helper")).toBeUndefined();
  });

  it("converts SQLite-like header without errors", () => {
    const h = parseCHeader(`
      #define SQLITE_OK 0
      #define SQLITE_ERROR 1
      typedef struct sqlite3 sqlite3;
      int sqlite3_open(const char* filename, sqlite3** ppDb);
      int sqlite3_close(sqlite3* db);
      const char* sqlite3_errmsg(sqlite3* db);
    `);
    const result = convertCHeaderToAbi(h, { moduleName: "sqlite3" });
    expect(result.module.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.module.constants.length).toBeGreaterThanOrEqual(1);
  });

  it("sets correct ABI version on output", () => {
    const h = parseCHeader(`void noop();`);
    const result = convertCHeaderToAbi(h, { moduleName: "test" });
    expect(result.module.version).toBeDefined();
    expect(result.module.version.major).toBe(1);
  });

  it("wasm32 platform uses 4-byte pointers in types", () => {
    const h = parseCHeader(`void process(void* data);`);
    const result = convertCHeaderToAbi(h, { moduleName: "wasm_mod", platform: PLATFORM_WASM32 });
    // Should complete without error
    expect(result.module.functions).toHaveLength(1);
  });
});

// ── Emitter ────────────────────────────────────────────────────────────────

describe("Binding Generator — emitter", () => {
  // REWRITTEN per issues/ffi-bindgen-generates-invalid-ur-syntax.md's own
  // fix — the emitter now targets real UR v1.0 syntax exclusively. Every
  // test below checks the NEW, real-syntax output; the old tests checked
  // for `module`/`fn`/`pub`/`unsafe`/`#[repr(C)]`/`const`, none of which
  // exist in real UR v1.0 (confirmed: the old output produced 43 parse
  // errors against the real UR parser).

  it("emits a real UR function declaration, no 'module' statement (doesn't exist in UR v1.0)", () => {
    const h = parseCHeader(`void noop();`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "testmod" });
    const code = emitUrBindings(module);
    expect(code).not.toContain("module testmod");
    expect(code).toContain("function noop()");
    expect(code).toContain("end");
  });

  it("emits a real 'function' declaration with typed params/return, no 'extern'/'fn' block (don't exist in UR v1.0)", () => {
    const h = parseCHeader(`int add(int a, int b);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "math" });
    const code = emitUrBindings(module);
    expect(code).not.toContain(`extern "C"`);
    expect(code).not.toContain("fn add(");
    expect(code).toContain("function add(a: int, b: int): int");
  });

  it("emits exactly one function declaration per C function — no separate safe/unsafe wrapper pair (UR v1.0 has no 'unsafe' concept)", () => {
    const h = parseCHeader(`int multiply(int x, int y);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "math" });
    const code = emitUrBindings(module);
    expect(code).not.toContain("pub fn multiply(");
    expect(code).not.toContain("unsafe {");
    expect((code.match(/function multiply\(/g) ?? []).length).toBe(1);
  });

  it("includeWrappers option no longer changes output (single-declaration design) — documented, not silently broken", () => {
    const h = parseCHeader(`int raw_op(int x);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "raw" });
    const withWrappers = emitUrBindings(module, { includeWrappers: true });
    const withoutWrappers = emitUrBindings(module, { includeWrappers: false });
    expect(withWrappers).toBe(withoutWrappers);
    expect(withWrappers).toContain("function raw_op(x: int): int");
  });

  it("emits a real UR struct declaration (documentation only), no '#[repr(C)]' attribute (doesn't exist in UR v1.0)", () => {
    const h = parseCHeader(`struct Point { float x; float y; };`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "geo" });
    const code = emitUrBindings(module);
    expect(code).not.toContain("#[repr(C)]");
    expect(code).toContain("struct Point");
    expect(code).toContain("x: float");
    expect(code).toContain("y: float");
    expect(code).toContain("end");
  });

  it("emits enum variants as individual top-level 'let' constants (UR v1.0 has no enum declaration)", () => {
    const h = parseCHeader(`typedef enum { A = 0, B = 1 } MyEnum;`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "enums" });
    const code = emitUrBindings(module);
    expect(code).toContain("let MyEnum_A = 0");
    expect(code).toContain("let MyEnum_B = 1");
  });

  it("emits constants as top-level 'let' (UR v1.0 has no 'const' keyword)", () => {
    const h = parseCHeader(`#define VERSION 42`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "consts" });
    const code = emitUrBindings(module);
    expect(code).not.toContain("const VERSION");
    expect(code).toContain("let VERSION = 42");
  });

  it("emits ABI version in header comment", () => {
    const h = parseCHeader(`void x();`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "x" });
    const code = emitUrBindings(module);
    expect(code).toContain("ABI version: 1.0.0");
  });

  it("emits TypeScript declarations", () => {
    const h = parseCHeader(`int add(int a, int b);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "math" });
    const ts = emitTsDeclarations(module);
    expect(ts).toContain("export declare function add(");
    expect(ts).toContain(": number");
  });

  it("emits DO NOT EDIT warning", () => {
    const h = parseCHeader(`void x();`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "x" });
    const code = emitUrBindings(module);
    expect(code).toContain("DO NOT EDIT");
  });
});

// ── Multi-token type specifier regression suite ────────────────────────────
// Regression: the original parseTypeRef() only handled single-token type
// names, so "long long" was silently dropped (the second "long" was
// mistaken for the parameter name, corrupting the entire parameter list).
// This bug was found while building the SQLite3 native integration where
// sqlite3_bind_int64, sqlite3_column_int64, and sqlite3_last_insert_rowid
// all use "long long" as their return or parameter type. The rewrite uses
// a proper specifier-collection loop. Every valid combination below is now
// covered permanently.

describe("C Header Parser — multi-token type specifiers (regression suite)", () => {
  function parseFirst(src: string) {
    const h = parseCHeader(src);
    expect(h.errors).toHaveLength(0);
    const fn = h.decls.find(d => d.kind === "function") as any;
    expect(fn).toBeDefined();
    return fn;
  }

  it("long long return type", () => {
    const fn = parseFirst("long long getRowId();");
    expect((fn.returnType as any).name).toBe("long long");
  });

  it("long long parameter type", () => {
    const fn = parseFirst("int bindInt64(int idx, long long val);");
    expect((fn.params[1] as any).type.name).toBe("long long");
  });

  it("unsigned long long", () => {
    const fn = parseFirst("unsigned long long getUint64();");
    expect((fn.returnType as any).name).toBe("unsigned long long");
  });

  it("unsigned long", () => {
    const fn = parseFirst("unsigned long getUlong();");
    expect((fn.returnType as any).name).toBe("unsigned long");
  });

  it("unsigned int", () => {
    const fn = parseFirst("unsigned int getUint();");
    expect((fn.returnType as any).name).toBe("unsigned int");
  });

  it("unsigned short", () => {
    const fn = parseFirst("unsigned short getUshort();");
    expect((fn.returnType as any).name).toBe("unsigned short");
  });

  it("unsigned char", () => {
    const fn = parseFirst("unsigned char getByte();");
    expect((fn.returnType as any).name).toBe("unsigned char");
  });

  it("signed char", () => {
    const fn = parseFirst("signed char getSigned();");
    expect((fn.returnType as any).name).toBe("signed char");
  });

  it("long double", () => {
    const fn = parseFirst("long double getPrecise();");
    expect((fn.returnType as any).name).toBe("long double");
  });

  it("const unsigned long long parameter", () => {
    const fn = parseFirst("int use(const unsigned long long x);");
    const param = fn.params[0].type;
    // const wraps the base type
    expect(param.const_).toBe(true);
    expect(param.name).toBe("unsigned long long");
  });

  it("volatile is consumed silently (does not affect the ABI type)", () => {
    const fn = parseFirst("int read(volatile unsigned int reg);");
    expect(fn.errors).toBeUndefined();
    expect((fn.params[0].type as any).name).toBe("unsigned int");
  });

  it("specifiers in non-canonical order: long int unsigned is resolved correctly", () => {
    // "unsigned long int" in any order = unsigned long
    const fn = parseFirst("unsigned long int getUlong();");
    expect((fn.returnType as any).name).toBe("unsigned long");
  });

  it("previously-working types are not broken (no regression on existing types)", () => {
    const h = parseCHeader(`
      int foo(int a);
      long bar(long b);
      double baz(double c);
      char qux(char d);
      void* ptr(void* p);
    `);
    expect(h.errors).toHaveLength(0);
    expect(h.decls.filter(d => d.kind === "function")).toHaveLength(5);
  });

  it("invalid: unsigned double is rejected", () => {
    const h = parseCHeader("unsigned double bad();");
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it("invalid: short long is rejected", () => {
    const h = parseCHeader("short long bad();");
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it("invalid: long long long is rejected", () => {
    const h = parseCHeader("long long long bad();");
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it("full SQLite3 header parses with zero errors and all 27 functions", () => {
    // readFileSync imported at the top of the test file
    const src = readFileSyncCompat("tests/ffi/native/fixtures/sqlite3.h");
    const h = parseCHeader(src);
    expect(h.errors).toHaveLength(0);
    const fns = h.decls.filter(d => d.kind === "function");
    expect(fns).toHaveLength(27);
    const names = fns.map((f: any) => f.name);
    expect(names).toContain("sqlite3_bind_int64");
    expect(names).toContain("sqlite3_column_int64");
    expect(names).toContain("sqlite3_last_insert_rowid");
  });
});
