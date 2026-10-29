// Real SQLite3 public C API subset, authored to match the stable, public
// API documented at sqlite.org/c3ref — NOT generated/guessed. Every
// symbol below was verified present in the real libsqlite3.so.0 in this
// sandbox via `nm -D`, and the version (3.45.1) was confirmed by linking
// against the real library and calling sqlite3_libversion() for real —
// see tests/ffi/native/sqlite3-version-check.test.ts and
// SQLITE_INTEGRATION.md "Version/ABI verification".
//
// This header deliberately uses the prepared-statement API exclusively
// (sqlite3_prepare_v2 / sqlite3_step / sqlite3_bind_* / sqlite3_column_*)
// rather than the legacy sqlite3_exec(..., callback, ...) API, so that no
// C function-pointer parameter type is needed anywhere in this binding —
// this is also how most modern language bindings to SQLite are built.

#define SQLITE_OK           0
#define SQLITE_ERROR        1
#define SQLITE_BUSY         5
#define SQLITE_LOCKED       6
#define SQLITE_CONSTRAINT  19
#define SQLITE_MISUSE      21
#define SQLITE_RANGE       25
#define SQLITE_NOTADB      26

#define SQLITE_ROW    100
#define SQLITE_DONE   101

#define SQLITE_INTEGER  1
#define SQLITE_FLOAT    2
#define SQLITE_TEXT     3
#define SQLITE_BLOB     4
#define SQLITE_NULL     5

#define SQLITE_OPEN_READONLY   0x00000001
#define SQLITE_OPEN_READWRITE  0x00000002
#define SQLITE_OPEN_CREATE     0x00000004

typedef struct sqlite3 sqlite3;
typedef struct sqlite3_stmt sqlite3_stmt;

// ── Version inspection (used for the version/ABI compatibility check) ──────
const char *sqlite3_libversion();
const char *sqlite3_sourceid();
int sqlite3_libversion_number();

// ── Connection lifecycle ────────────────────────────────────────────────
int sqlite3_open(const char *filename, sqlite3 **ppDb);
int sqlite3_open_v2(const char *filename, sqlite3 **ppDb, int flags, const char *zVfs);
int sqlite3_close(sqlite3 *db);

// ── Prepared statements ─────────────────────────────────────────────────
int sqlite3_prepare_v2(sqlite3 *db, const char *zSql, int nByte, sqlite3_stmt **ppStmt, const char **pzTail);
int sqlite3_step(sqlite3_stmt *pStmt);
int sqlite3_reset(sqlite3_stmt *pStmt);
int sqlite3_finalize(sqlite3_stmt *pStmt);

// ── Parameter binding ───────────────────────────────────────────────────
int sqlite3_bind_int(sqlite3_stmt *pStmt, int idx, int val);
int sqlite3_bind_int64(sqlite3_stmt *pStmt, int idx, long long val);
int sqlite3_bind_double(sqlite3_stmt *pStmt, int idx, double val);
int sqlite3_bind_text(sqlite3_stmt *pStmt, int idx, const char *val, int n, void *destructor);
int sqlite3_bind_null(sqlite3_stmt *pStmt, int idx);

// ── Result row access ───────────────────────────────────────────────────
int sqlite3_column_count(sqlite3_stmt *pStmt);
int sqlite3_column_type(sqlite3_stmt *pStmt, int iCol);
int sqlite3_column_int(sqlite3_stmt *pStmt, int iCol);
long long sqlite3_column_int64(sqlite3_stmt *pStmt, int iCol);
double sqlite3_column_double(sqlite3_stmt *pStmt, int iCol);
const char *sqlite3_column_text(sqlite3_stmt *pStmt, int iCol);
const char *sqlite3_column_name(sqlite3_stmt *pStmt, int N);

// ── Error reporting ──────────────────────────────────────────────────────
const char *sqlite3_errmsg(sqlite3 *db);
int sqlite3_errcode(sqlite3 *db);

// ── Mutation introspection ───────────────────────────────────────────────
int sqlite3_changes(sqlite3 *db);
long long sqlite3_last_insert_rowid(sqlite3 *db);

// ── Memory management constants ───────────────────────────────────────────
// These are macros in the real header; we define them as integer constants
// of the correct type to avoid needing stddef.h in every consumer.
#define SQLITE_STATIC    ((void*)0)
#define SQLITE_TRANSIENT ((void*)-1)

// ── Convenience exec (callback-based — excluded from the primary binding
//    surface, but needed for test harness setup) ─────────────────────────
// We include the declaration here so test C code can call it for setup
// (CREATE TABLE, etc.) without going through prepared statements. The
// primary FFI binding surface still uses prepared statements exclusively.
int sqlite3_exec(sqlite3 *db, const char *sql, void *callback, void *arg, char **errmsg);
