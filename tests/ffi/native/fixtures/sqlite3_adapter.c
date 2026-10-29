// UR-Bridge SQLite3 C Adapter
// Flattens sqlite3's double-pointer out-param API into a single-return-value
// API that maps directly onto the generic NativeCall descriptor language.
//
// Why this exists:
//   sqlite3_open(path, **ppDb)  — ppDb is an output param; the caller must
//   pass a pointer-to-pointer. The generic NativeCall model (one return value,
//   typed args) cannot express this pattern directly.
//
//   The adapter wraps these calls and returns the handle/pointer directly,
//   making them compatible with the generic loader without any special cases
//   in the loader itself. This is exactly the same pattern as the C++
//   exception trampolines — a compiled shim that adapts an incompatible
//   calling convention to one the generic layer can handle.
//
// Functions exported by this adapter:
//   void* ur_sqlite3_open(const char* path)
//       Opens a database; returns the sqlite3* handle, or NULL on failure.
//   void* ur_sqlite3_open_v2(const char* path, int flags)
//       Same, with open flags.
//   int   ur_sqlite3_last_open_rc()
//       Returns the result code of the most recent ur_sqlite3_open* call.
//   void* ur_sqlite3_prepare(void* db, const char* sql)
//       Prepares a statement; returns the sqlite3_stmt*, or NULL on failure.
//   int   ur_sqlite3_last_prepare_rc()
//       Returns the result code of the most recent ur_sqlite3_prepare call.

#include "sqlite3.h"
#include <stddef.h>

// Thread-local state for result codes of out-param calls.
// Single-threaded UR runtime model — one active call at a time.
static int _last_open_rc   = 0;
static int _last_prepare_rc = 0;

void* ur_sqlite3_open(const char* path) {
    sqlite3 *db = NULL;
    _last_open_rc = sqlite3_open(path, &db);
    return (void*)db;
}

void* ur_sqlite3_open_v2(const char* path, int flags) {
    sqlite3 *db = NULL;
    _last_open_rc = sqlite3_open_v2(path, &db, flags, NULL);
    return (void*)db;
}

int ur_sqlite3_last_open_rc(void) {
    return _last_open_rc;
}

void* ur_sqlite3_prepare(void* db, const char* sql) {
    sqlite3_stmt *stmt = NULL;
    _last_prepare_rc = sqlite3_prepare_v2(
        (sqlite3*)db, sql, -1, &stmt, NULL);
    return (void*)stmt;
}

int ur_sqlite3_last_prepare_rc(void) {
    return _last_prepare_rc;
}
