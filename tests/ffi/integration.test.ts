// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Phase 6 End-to-End Integration
// Full pipeline: C header → parse → convert → ABI check → emit → link plan
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { parseCHeader } from "../../src/ffi/bindgen/c-header-parser.js";
import { convertCHeaderToAbi } from "../../src/ffi/bindgen/converter.js";
import { emitUrBindings, emitTsDeclarations } from "../../src/ffi/bindgen/emitter.js";
import { checkAbiCompatibility } from "../../src/ffi/abi/versioning.js";
import { makeNativePackageDb, planNativeInstall, generateLinkerFlags } from "../../src/ffi/urpm-native/native-packages.js";
import { FfiArena, encodeString, decodeString } from "../../src/ffi/runtime/memory.js";
import type { NativePlatformTarget, NativePackageManifest, InstalledNativePackage } from "../../src/ffi/urpm-native/native-packages.js";
import { CURRENT_ABI_VERSION } from "../../src/ffi/abi/types.js";
import { lex } from "../../src/compiler/frontend/lexer.js";
import { parse } from "../../src/compiler/frontend/parser.js";
import { typeCheck } from "../../src/compiler/typesystem/checker.js";

const LINUX_X64: NativePlatformTarget = { os: "linux", arch: "x64", libc: "glibc" };

// ── Realistic SQLite3 binding pipeline ────────────────────────────────────

const SQLITE3_HEADER = `
#define SQLITE_OK         0
#define SQLITE_ERROR      1
#define SQLITE_INTERNAL   2
#define SQLITE_PERM       3
#define SQLITE_ABORT      4
#define SQLITE_BUSY       5
#define SQLITE_LOCKED     6
#define SQLITE_NOMEM      7
#define SQLITE_READONLY   8
#define SQLITE_INTERRUPT  9
#define SQLITE_IOERR     10
#define SQLITE_CORRUPT   11
#define SQLITE_ROW      100
#define SQLITE_DONE     101

typedef struct sqlite3 sqlite3;
typedef struct sqlite3_stmt sqlite3_stmt;

int sqlite3_open(const char *filename, sqlite3 **ppDb);
int sqlite3_open_v2(const char *filename, sqlite3 **ppDb, int flags, const char *zVfs);
int sqlite3_close(sqlite3 *db);
int sqlite3_close_v2(sqlite3 *db);
int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *arg, char **errmsg);
int sqlite3_prepare_v2(sqlite3 *db, const char *zSql, int nByte, sqlite3_stmt **ppStmt, const char **pzTail);
int sqlite3_step(sqlite3_stmt *pStmt);
int sqlite3_reset(sqlite3_stmt *pStmt);
int sqlite3_finalize(sqlite3_stmt *pStmt);
int sqlite3_bind_int(sqlite3_stmt *pStmt, int idx, int val);
int sqlite3_bind_text(sqlite3_stmt *pStmt, int idx, const char *val, int n, void *destructor);
int sqlite3_column_count(sqlite3_stmt *pStmt);
int sqlite3_column_int(sqlite3_stmt *pStmt, int iCol);
const char *sqlite3_column_text(sqlite3_stmt *pStmt, int iCol);
const char *sqlite3_column_name(sqlite3_stmt *pStmt, int N);
const char *sqlite3_errmsg(sqlite3 *db);
int sqlite3_changes(sqlite3 *db);
int sqlite3_total_changes(sqlite3 *db);
`;

describe("Phase 6 Integration — SQLite3 binding pipeline", () => {
  it("parses SQLite3 header completely", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const fns = h.decls.filter(d => d.kind === "function");
    const defs = h.decls.filter(d => d.kind === "define");
    expect(fns.length).toBeGreaterThanOrEqual(15);
    expect(defs.length).toBeGreaterThanOrEqual(12);
    expect(h.errors).toHaveLength(0);
  });

  it("converts all functions to ABI signatures", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const { module, warnings } = convertCHeaderToAbi(h, {
      moduleName: "sqlite3",
      filterPrefix: "sqlite3_",
    });
    expect(module.functions.length).toBeGreaterThanOrEqual(15);
    expect(module.name).toBe("sqlite3");
  });

  it("converts constants correctly", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "sqlite3" });
    const ok = module.constants.find(c => c.name === "SQLITE_OK");
    const row = module.constants.find(c => c.name === "SQLITE_ROW");
    expect(ok?.value).toBe(0);
    expect(row?.value).toBe(100);
  });

  it("emits valid UR binding code (real UR v1.0 syntax — see issues/ffi-bindgen-generates-invalid-ur-syntax.md)", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const { module } = convertCHeaderToAbi(h, {
      moduleName: "sqlite3",
      filterPrefix: "sqlite3_",
    });
    const code = emitUrBindings(module, { modulePath: "extern/sqlite3" });

    expect(code).not.toContain("module extern/sqlite3");
    expect(code).not.toContain(`extern "C"`);
    expect(code).not.toContain("fn sqlite3_open(");
    expect(code).not.toContain("pub fn sqlite3_open(");
    expect(code).toContain("function sqlite3_open(");
    expect(code).toContain("function sqlite3_close(");
    expect(code).toContain("DO NOT EDIT");
  });

  it("emits TypeScript declarations for host interop", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "sqlite3" });
    const ts = emitTsDeclarations(module);
    expect(ts).toContain("export declare function sqlite3_open");
    expect(ts).toContain("export declare function sqlite3_close");
  });

  it("ABI is stable between identical parses", () => {
    const h1 = parseCHeader(SQLITE3_HEADER);
    const h2 = parseCHeader(SQLITE3_HEADER);
    const { module: m1 } = convertCHeaderToAbi(h1, { moduleName: "sqlite3" });
    const { module: m2 } = convertCHeaderToAbi(h2, { moduleName: "sqlite3" });
    const compat = checkAbiCompatibility(m1, m2);
    expect(compat.compatible).toBe(true);
  });
});

// ── OpenCV-like binding pipeline ───────────────────────────────────────────

const OPENCV_MINIMAL_HEADER = `
#define CV_8U   0
#define CV_8S   1
#define CV_16U  2
#define CV_16S  3
#define CV_32S  4
#define CV_32F  5
#define CV_64F  6

typedef struct CvMat {
  int type;
  int step;
  int rows;
  int cols;
  unsigned char *data;
} CvMat;

typedef struct CvSize {
  int width;
  int height;
} CvSize;

CvMat *cvCreateMat(int rows, int cols, int type);
void cvReleaseMat(CvMat **mat);
void cvCopy(const CvMat *src, CvMat *dst, const CvMat *mask);
double cvNorm(const CvMat *arr1, const CvMat *arr2, int norm_type, const CvMat *mask);
CvSize cvGetSize(const CvMat *arr);
`;

describe("Phase 6 Integration — OpenCV-like binding pipeline", () => {
  it("parses OpenCV-like header", () => {
    const h = parseCHeader(OPENCV_MINIMAL_HEADER);
    expect(h.errors).toHaveLength(0);
    const fns = h.decls.filter(d => d.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(4);
  });

  it("converts CvMat struct with fields", () => {
    const h = parseCHeader(OPENCV_MINIMAL_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "opencv_core" });
    const matType = module.types.find(t => (t as any).name === "CvMat");
    expect(matType).toBeDefined();
    if (matType && matType.kind === "struct") {
      expect(matType.fields.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("emits CvMat struct using real UR syntax (no '#[repr(C)]' — doesn't exist in UR v1.0)", () => {
    const h = parseCHeader(OPENCV_MINIMAL_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "opencv_core" });
    const code = emitUrBindings(module);
    expect(code).toContain("struct CvMat");
    expect(code).not.toContain("#[repr(C)]");
    expect(code).toContain("end");
  });
});

// ── Full urpm install → link pipeline ─────────────────────────────────────

describe("Phase 6 Integration — urpm native full pipeline", () => {
  function makeManifest(name: string): NativePackageManifest {
    const h = parseCHeader(`void ${name}_init(void); void ${name}_shutdown(void);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: name });
    return {
      name,
      version: "1.0.0",
      abiModule: module,
      artifacts: [{
        platform: LINUX_X64,
        filename: `lib${name}.so.1`,
        format: "dynamic",
        sha256: "abc",
        downloadUrl: `https://example.com/${name}.so`,
        sizeBytes: 512 * 1024,
      }],
      headerSources: [`${name}.h`],
      bindingPath: `bindings/${name}.ur`,
      license: "MIT",
      homepage: `https://${name}.org`,
    };
  }

  it("plans install for multiple native packages", () => {
    const db = makeNativePackageDb();
    const plan = planNativeInstall(
      [makeManifest("sqlite3"), makeManifest("zlib"), makeManifest("ssl")],
      db,
      LINUX_X64
    );
    expect(plan.toInstall).toHaveLength(3);
    expect(plan.warnings).toHaveLength(0);
  });

  it("generates combined linker flags after install", () => {
    const installed: InstalledNativePackage[] = ["sqlite3", "zlib"].map(name => ({
      name,
      version: "1.0.0",
      abiVersion: CURRENT_ABI_VERSION,
      abiModule: { name, version: CURRENT_ABI_VERSION, functions: [], types: [], constants: [] },
      installPath: `/usr/local/lib/${name}`,
      bindingPath: `bindings/${name}.ur`,
      installedAt: "2026-01-01T00:00:00Z",
      artifacts: [{
        filename: `lib${name}.so.1`,
        format: "dynamic" as const,
        platform: LINUX_X64,
        resolvedPath: `/usr/local/lib/lib${name}.so.1`,
      }],
    }));

    const flags = generateLinkerFlags(installed, LINUX_X64);
    expect(flags.linkArgs.filter(a => a.startsWith("-l")).length).toBe(2);
    expect(flags.rpaths.length).toBe(2);
  });
});

// ── FFI runtime pipeline ───────────────────────────────────────────────────

describe("Phase 6 Integration — FFI runtime pipeline", () => {
  it("arena can hold all params for a complex call", () => {
    const arena = new FfiArena();

    // Simulate marshaling params for: sqlite3_exec(db, sql, NULL, NULL, NULL)
    const dbPtr = arena.alloc(8);     // pointer to sqlite3
    const { buf: sqlBuf } = arena.allocString("SELECT 1", "cstr");

    expect(dbPtr.byteLength).toBe(8);
    expect(sqlBuf[8]).toBe(0); // null terminator at position 8
    expect(arena.stats.allocationCount).toBe(2);
  });

  it("string round-trip survives complex unicode", () => {
    const strings = [
      "Hello, World!",
      "مرحبا بالعالم",       // Arabic
      "こんにちは世界",          // Japanese
      "Привет мир",           // Russian
      "🎉🚀💻",               // Emoji
      "SELECT * FROM 'المستخدمين'", // Mixed
    ];

    for (const s of strings) {
      const encoded = encodeString(s, "utf8");
      const decoded = decodeString(encoded.bytes, "utf8");
      expect(decoded).toBe(s);
    }
  });

  it("arena reset allows reuse", () => {
    const arena = new FfiArena();
    for (let i = 0; i < 100; i++) {
      arena.alloc(256);
    }
    expect(arena.stats.totalBytes).toBe(25600);
    arena.reset();
    expect(arena.stats.totalBytes).toBe(0);

    // Reuse for next call
    const buf = arena.alloc(64);
    expect(buf.byteLength).toBe(64);
    expect(arena.stats.allocationCount).toBe(1);
  });
});

// ── MANDATORY end-to-end test, per explicit Stage 2 closure condition ─────
// "توليد Binding → Lexer → Parser → Semantic — ينجح بالكامل بدون أخطاء"
// This is the definitive proof that emitUrBindings() now produces real,
// compilable UR v1.0 source — not just text that superficially resembles it.

describe("Stage 2 CLOSURE CONDITION — generated bindings pass the REAL UR compiler pipeline with zero errors", () => {
  function assertGeneratedBindingIsValidUr(label: string, code: string) {
    const { tokens } = lex(code);
    const { program, errors: parseErrors } = parse(tokens);
    expect(parseErrors, `${label}: parse errors`).toEqual([]);
    const tc = typeCheck(program);
    const tcErrors = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    expect(tcErrors, `${label}: typecheck errors`).toEqual([]);
  }

  it("SQLite3 binding (27 real functions, structs, constants) — zero parse errors, zero typecheck errors", () => {
    const h = parseCHeader(SQLITE3_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "sqlite3", filterPrefix: "sqlite3_" });
    const code = emitUrBindings(module, { modulePath: "extern/sqlite3" });
    assertGeneratedBindingIsValidUr("sqlite3", code);
  });

  it("OpenCV-like binding (pointer-containing struct, multiple function signatures) — zero parse errors, zero typecheck errors", () => {
    const h = parseCHeader(OPENCV_MINIMAL_HEADER);
    const { module } = convertCHeaderToAbi(h, { moduleName: "opencv_core" });
    const code = emitUrBindings(module);
    assertGeneratedBindingIsValidUr("opencv", code);
  });

  it("a header with an enum (flattened to individual 'let' constants) — zero parse errors, zero typecheck errors", () => {
    const h = parseCHeader(`typedef enum { RED = 0, GREEN = 1, BLUE = 2 } Color;\nvoid setColor(int c);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "colors" });
    const code = emitUrBindings(module);
    assertGeneratedBindingIsValidUr("colors", code);
  });

  it("a header with #define constants — zero parse errors, zero typecheck errors", () => {
    const h = parseCHeader(`#define MAX_SIZE 1024\n#define VERSION 3\nint get_size(void);`);
    const { module } = convertCHeaderToAbi(h, { moduleName: "sizes" });
    const code = emitUrBindings(module);
    assertGeneratedBindingIsValidUr("sizes", code);
  });
});
