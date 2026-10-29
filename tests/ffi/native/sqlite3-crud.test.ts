// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: Real SQLite3 CRUD (end-to-end, no simulation)
// Phase 7 — Native Ecosystem Hardening — SQLite3 Integration
// ─────────────────────────────────────────────────────────────────────────────
//
// Full pipeline used:
//   Generic NativeFfiLoader + HarnessExecutor (Step 1)
//   Custom C harness using ur_sqlite3 adapter + real libsqlite3.so.0 (Steps 2–11)
//
// The C adapter (fixtures/sqlite3_adapter.c) flattens SQLite's double-pointer
// out-params (sqlite3_open→**ppDb, sqlite3_prepare_v2→**ppStmt) into
// single-return-value functions compatible with the generic NativeCall model.
// Every test compiles real C against the real library — zero simulation.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeFfiLoader, checkVersionCompatibility } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "./harness-executor.js";
import {
  SQLITE_OK, SQLITE_ROW, SQLITE_DONE,
  SQLITE_INTEGER, SQLITE_TEXT, SQLITE_NULL,
} from "./sqlite3-driver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES   = join(__dirname, "fixtures");
const SQLITE_LIB = "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0";
const ADAPTER_C  = join(FIXTURES, "sqlite3_adapter.c");
const HEADER_VERSION = "3.45.1";

function hasGcc(): boolean {
  return spawnSync("gcc", ["--version"], { stdio: "ignore" }).status === 0;
}

// ── Dedicated harness runner with adapter + fixture header ────────────────
// Compiles adapter + test C source together against the real library.
// The adapter resolves double-pointer out-params; the test code uses the
// flat ur_sqlite3_* wrappers alongside direct sqlite3_* symbol calls.

function runSqliteHarness(testCSrc: string): { lines: string[]; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "ur-sqlite-crud-"));
  const testSrc = join(dir, "test.c");
  const bin     = join(dir, "crud");
  try {
    writeFileSync(testSrc, testCSrc);
    const compile = spawnSync("gcc", [
      "-o", bin,
      ADAPTER_C, testSrc,
      SQLITE_LIB,
      "-I", FIXTURES,
      "-ldl",
      "-Wno-incompatible-pointer-types",
    ], { stdio: "pipe" });

    if (compile.status !== 0) {
      return { lines: [], stderr: `COMPILE_ERROR: ${compile.stderr?.toString()}` };
    }
    const run = spawnSync(bin, [], { stdio: "pipe" });
    return {
      lines: (run.stdout?.toString() ?? "").trim().split("\n").filter(Boolean),
      stderr: run.stderr?.toString() ?? "",
    };
  } finally {
    try { unlinkSync(testSrc); } catch { /* */ }
    try { unlinkSync(bin); } catch { /* */ }
    try { spawnSync("rmdir", [dir], { stdio: "ignore" }); } catch { /* */ }
  }
}

// Adapter function declarations (used in all test harnesses)
const ADAPTER_DECLS = `
#include "sqlite3.h"
extern void* ur_sqlite3_open(const char* path);
extern void* ur_sqlite3_open_v2(const char* path, int flags);
extern int   ur_sqlite3_last_open_rc(void);
extern void* ur_sqlite3_prepare(void* db, const char* sql);
extern int   ur_sqlite3_last_prepare_rc(void);
#include <stdio.h>
`;

const gccAvailable = hasGcc();
const libExists    = existsSync(SQLITE_LIB);

// ── Step 1: Version / ABI verification via generic loader ─────────────────

describe("SQLite3 FFI — Step 1: version/ABI (generic loader + HarnessExecutor)", () => {
  if (!gccAvailable || !libExists) {
    it.skip("SKIPPED: gcc or library not available", () => { expect(true).toBe(true); }); return;
  }

  it("loads real library; sqlite3_libversion() and sqlite3_sourceid() succeed", () => {
    const executor = new HarnessExecutor([FIXTURES]);
    const loader   = new NativeFfiLoader(executor);
    const result   = loader.load({
      name: "SQLite3", libraryPath: SQLITE_LIB,
      expectedVersion: HEADER_VERSION,
      versionSymbol: "sqlite3_libversion",
      versionExtractor: (r) => (r.kind === "str" ? r.value : ""),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [ver, src] = loader.execute(result.handle, [
      { symbol: "sqlite3_libversion", args: [], returnKind: "str" },
      { symbol: "sqlite3_sourceid",   args: [], returnKind: "str" },
    ]);

    expect(ver?.kind).toBe("str");
    expect(src?.kind).toBe("str");
    if (ver?.kind === "str") {
      const check = checkVersionCompatibility(HEADER_VERSION, ver.value);
      expect(check.compatible).toBe(true);
      expect(ver.value).toMatch(/^3\.\d+\.\d+$/);
    }
    if (src?.kind === "str") expect(src.value.length).toBeGreaterThan(10);
    loader.unloadAll();
  });
});

// ── Steps 2–11: Full CRUD ──────────────────────────────────────────────────

describe("SQLite3 FFI — Steps 2–11: full CRUD with real library, no simulation", () => {
  if (!gccAvailable || !libExists) {
    it.skip("SKIPPED: gcc or library not available", () => { expect(true).toBe(true); }); return;
  }

  it("Step 2: open in-memory db — handle is non-null, rc is SQLITE_OK", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  printf("OPEN_RC:%d\\n", ur_sqlite3_last_open_rc());
  printf("DB_NONNULL:%d\\n", db != 0 ? 1 : 0);
  if (db) sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("OPEN_RC:0");
    expect(lines).toContain("DB_NONNULL:1");
  });

  it("Step 3: CREATE TABLE returns SQLITE_DONE", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  void *stmt = ur_sqlite3_prepare(db,
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)");
  int rc = sqlite3_step((sqlite3_stmt*)stmt);
  printf("CREATE_RC:%d\\n", rc);
  sqlite3_finalize((sqlite3_stmt*)stmt);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain(`CREATE_RC:${SQLITE_DONE}`);
  });

  it("Step 4: INSERT with parameter binding — changes() and last_insert_rowid()", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db,
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)",
    NULL, NULL, NULL);

  void *stmt = ur_sqlite3_prepare(db, "INSERT INTO items (name, value) VALUES (?, ?)");
  sqlite3_bind_text((sqlite3_stmt*)stmt, 1, "alpha", -1, SQLITE_STATIC);
  sqlite3_bind_double((sqlite3_stmt*)stmt, 2, 1.5);
  sqlite3_step((sqlite3_stmt*)stmt);
  sqlite3_reset((sqlite3_stmt*)stmt);

  sqlite3_bind_text((sqlite3_stmt*)stmt, 1, "beta", -1, SQLITE_STATIC);
  sqlite3_bind_double((sqlite3_stmt*)stmt, 2, 2.5);
  sqlite3_step((sqlite3_stmt*)stmt);
  sqlite3_finalize((sqlite3_stmt*)stmt);

  printf("CHANGES:%d\\n", sqlite3_changes((sqlite3*)db));
  printf("LAST_ROWID:%lld\\n", (long long)sqlite3_last_insert_rowid((sqlite3*)db));
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("CHANGES:1");
    expect(lines).toContain("LAST_ROWID:2");
  });

  it("Step 5: SELECT — column count, types, values correct for both rows", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db,
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)",
    NULL, NULL, NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO items (name,value) VALUES ('alpha',1.5)", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO items (name,value) VALUES ('beta',2.5)",  NULL,NULL,NULL);

  void *stmt = ur_sqlite3_prepare(db, "SELECT id,name,value FROM items ORDER BY id");
  printf("COL_COUNT:%d\\n", sqlite3_column_count((sqlite3_stmt*)stmt));

  int row = 0;
  while (sqlite3_step((sqlite3_stmt*)stmt) == SQLITE_ROW) {
    row++;
    printf("ROW%d_ID:%d\\n",        row, sqlite3_column_int((sqlite3_stmt*)stmt, 0));
    printf("ROW%d_NAME:%s\\n",      row, sqlite3_column_text((sqlite3_stmt*)stmt, 1));
    printf("ROW%d_VAL:%.1f\\n",     row, sqlite3_column_double((sqlite3_stmt*)stmt, 2));
    printf("ROW%d_ID_TYPE:%d\\n",   row, sqlite3_column_type((sqlite3_stmt*)stmt, 0));
    printf("ROW%d_NAME_TYPE:%d\\n", row, sqlite3_column_type((sqlite3_stmt*)stmt, 1));
  }
  printf("TOTAL_ROWS:%d\\n", row);
  sqlite3_finalize((sqlite3_stmt*)stmt);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("COL_COUNT:3");
    expect(lines).toContain("TOTAL_ROWS:2");
    expect(lines).toContain("ROW1_ID:1");
    expect(lines).toContain("ROW1_NAME:alpha");
    expect(lines).toContain("ROW1_VAL:1.5");
    expect(lines).toContain(`ROW1_ID_TYPE:${SQLITE_INTEGER}`);
    expect(lines).toContain(`ROW1_NAME_TYPE:${SQLITE_TEXT}`);
    expect(lines).toContain("ROW2_ID:2");
    expect(lines).toContain("ROW2_NAME:beta");
  });

  it("Step 6: UPDATE and DELETE — changes() reports correct affected row count", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db,
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO items (name) VALUES ('a')", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO items (name) VALUES ('b')", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO items (name) VALUES ('c')", NULL,NULL,NULL);

  sqlite3_exec((sqlite3*)db, "UPDATE items SET name='updated' WHERE id=1", NULL,NULL,NULL);
  printf("UPDATE_CHANGES:%d\\n", sqlite3_changes((sqlite3*)db));

  sqlite3_exec((sqlite3*)db, "DELETE FROM items WHERE id IN (2,3)", NULL,NULL,NULL);
  printf("DELETE_CHANGES:%d\\n", sqlite3_changes((sqlite3*)db));

  void *stmt = ur_sqlite3_prepare(db, "SELECT COUNT(*) FROM items");
  sqlite3_step((sqlite3_stmt*)stmt);
  printf("REMAINING:%d\\n", sqlite3_column_int((sqlite3_stmt*)stmt, 0));
  sqlite3_finalize((sqlite3_stmt*)stmt);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("UPDATE_CHANGES:1");
    expect(lines).toContain("DELETE_CHANGES:2");
    expect(lines).toContain("REMAINING:1");
  });

  it("Step 7a: invalid SQL → non-zero rc, non-empty errmsg", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
#include <string.h>
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  void *stmt = ur_sqlite3_prepare(db, "THIS IS NOT SQL AT ALL");
  int rc = ur_sqlite3_last_prepare_rc();
  printf("PREP_RC_NONZERO:%d\\n", rc != 0 ? 1 : 0);
  const char *msg = sqlite3_errmsg((sqlite3*)db);
  printf("ERRMSG_NONEMPTY:%d\\n", msg && strlen(msg) > 0 ? 1 : 0);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("PREP_RC_NONZERO:1");
    expect(lines).toContain("ERRMSG_NONEMPTY:1");
  });

  it("Step 7b: NOT NULL constraint violation → SQLITE_CONSTRAINT (19)", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db,
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)", NULL,NULL,NULL);
  void *stmt = ur_sqlite3_prepare(db, "INSERT INTO items (name) VALUES (?)");
  sqlite3_bind_null((sqlite3_stmt*)stmt, 1);
  int rc = sqlite3_step((sqlite3_stmt*)stmt);
  printf("CONSTRAINT_RC:%d\\n", rc);
  sqlite3_finalize((sqlite3_stmt*)stmt);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("CONSTRAINT_RC:19");
  });

  it("Step 7c: open nonexistent path with READONLY → fails gracefully (rc != 0)", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open_v2("/nonexistent/path/db.sqlite",
    SQLITE_OPEN_READONLY);
  int rc = ur_sqlite3_last_open_rc();
  printf("OPEN_FAIL_NONZERO:%d\\n", rc != 0 ? 1 : 0);
  if (db) sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("OPEN_FAIL_NONZERO:1");
  });

  it("Step 8: NULL values — bind_null → column_type returns SQLITE_NULL (5)", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db, "CREATE TABLE t (a TEXT, b INTEGER)", NULL,NULL,NULL);
  void *stmt = ur_sqlite3_prepare(db, "INSERT INTO t (a,b) VALUES (?,?)");
  sqlite3_bind_null((sqlite3_stmt*)stmt, 1);
  sqlite3_bind_int((sqlite3_stmt*)stmt, 2, 42);
  sqlite3_step((sqlite3_stmt*)stmt);
  sqlite3_finalize((sqlite3_stmt*)stmt);

  void *sel = ur_sqlite3_prepare(db, "SELECT a, b FROM t");
  sqlite3_step((sqlite3_stmt*)sel);
  printf("A_TYPE:%d\\n", sqlite3_column_type((sqlite3_stmt*)sel, 0));
  printf("B_VALUE:%d\\n", sqlite3_column_int((sqlite3_stmt*)sel, 1));
  sqlite3_finalize((sqlite3_stmt*)sel);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain(`A_TYPE:${SQLITE_NULL}`);
    expect(lines).toContain("B_VALUE:42");
  });

  it("Step 9: UTF-8 round-trip — Arabic, Japanese, emoji survive bind/column intact", () => {
    const arabicHex   = "\xd9\x85\xd8\xb1\xd8\xad\xd8\xa8\xd8\xa7";
    const japaneseHex = "\xe3\x81\x93\xe3\x82\x93\xe3\x81\xab\xe3\x81\xa1\xe3\x81\xaf";
    const emojiHex    = "\xf0\x9f\x98\x80\xf0\x9f\x9a\x80\xe2\x9d\xa4";
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
#include <string.h>
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db, "CREATE TABLE t (s TEXT)", NULL,NULL,NULL);
  const char *vals[3] = {
    "${arabicHex}",
    "${japaneseHex}",
    "${emojiHex}"
  };
  for (int i=0; i<3; i++) {
    void *ins = ur_sqlite3_prepare(db, "INSERT INTO t (s) VALUES (?)");
    sqlite3_bind_text((sqlite3_stmt*)ins, 1, vals[i], -1, SQLITE_STATIC);
    sqlite3_step((sqlite3_stmt*)ins);
    sqlite3_finalize((sqlite3_stmt*)ins);
  }
  void *sel = ur_sqlite3_prepare(db, "SELECT s FROM t ORDER BY rowid");
  int row = 0;
  while (sqlite3_step((sqlite3_stmt*)sel) == SQLITE_ROW) {
    const char *s = (const char*)sqlite3_column_text((sqlite3_stmt*)sel, 0);
    printf("UTF8_ROW%d_MATCH:%d\\n", row+1, strcmp(s, vals[row])==0 ? 1 : 0);
    printf("UTF8_ROW%d_TYPE:%d\\n",  row+1, sqlite3_column_type((sqlite3_stmt*)sel, 0));
    row++;
  }
  sqlite3_finalize((sqlite3_stmt*)sel);
  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("UTF8_ROW1_MATCH:1");
    expect(lines).toContain("UTF8_ROW2_MATCH:1");
    expect(lines).toContain("UTF8_ROW3_MATCH:1");
    expect(lines).toContain(`UTF8_ROW1_TYPE:${SQLITE_TEXT}`);
    expect(lines).toContain(`UTF8_ROW3_TYPE:${SQLITE_TEXT}`);
  });

  it("Step 10: BEGIN + ROLLBACK — row absent after rollback", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db, "CREATE TABLE t (v INTEGER)", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO t VALUES (1)", NULL,NULL,NULL);

  sqlite3_exec((sqlite3*)db, "BEGIN", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO t VALUES (2)", NULL,NULL,NULL);

  void *cnt = ur_sqlite3_prepare(db, "SELECT COUNT(*) FROM t");
  sqlite3_step((sqlite3_stmt*)cnt);
  printf("IN_TXN_COUNT:%d\\n", sqlite3_column_int((sqlite3_stmt*)cnt, 0));
  sqlite3_finalize((sqlite3_stmt*)cnt);

  sqlite3_exec((sqlite3*)db, "ROLLBACK", NULL,NULL,NULL);

  void *cnt2 = ur_sqlite3_prepare(db, "SELECT COUNT(*) FROM t");
  sqlite3_step((sqlite3_stmt*)cnt2);
  printf("POST_ROLLBACK_COUNT:%d\\n", sqlite3_column_int((sqlite3_stmt*)cnt2, 0));
  sqlite3_finalize((sqlite3_stmt*)cnt2);

  sqlite3_close((sqlite3*)db);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain("IN_TXN_COUNT:2");
    expect(lines).toContain("POST_ROLLBACK_COUNT:1");
  });

  it("Step 11: sqlite3_close returns SQLITE_OK — clean resource release", () => {
    const { lines, stderr } = runSqliteHarness(`
${ADAPTER_DECLS}
int main(void) {
  void *db = ur_sqlite3_open(":memory:");
  sqlite3_exec((sqlite3*)db, "CREATE TABLE t (x INTEGER)", NULL,NULL,NULL);
  sqlite3_exec((sqlite3*)db, "INSERT INTO t VALUES (99)", NULL,NULL,NULL);
  int rc = sqlite3_close((sqlite3*)db);
  printf("CLOSE_RC:%d\\n", rc);
  return 0;
}
`);
    expect(stderr).toBe("");
    expect(lines).toContain(`CLOSE_RC:${SQLITE_OK}`);
  });
});
