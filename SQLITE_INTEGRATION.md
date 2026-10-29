# SQLite3 Native Integration (Phase 7 — CLOSED)

## Status

**Closed.** Scope: FFI layer only (Stable ABI → FFI Runtime → Binding Generator → SQLite3 Integration). End-to-end from UR Source requires the full UR Frontend — explicitly deferred until `src/compiler/{lexer,parser,semantic,types,module}` are included in this project slice. See STATUS_REPORT.md SECTION 2B.

## Architecture

```
Generic NativeFfiLoader  (src/ffi/native/loader.ts)
    │  — library cache, ABI version check, diagnostic log, platform dispatch
    ▼
IPlatformExecutor  (src/ffi/native/platform-executors.ts)
    └── HarnessExecutor  (tests/ffi/native/harness-executor.ts)
            — compiles + runs a real gcc C harness per call sequence
            — lives in tests/ (uses node:child_process, node:fs)
    ▼
C Adapter (tests/ffi/native/fixtures/sqlite3_adapter.c)
    — flattens sqlite3_open(**ppDb) and sqlite3_prepare_v2(**ppStmt)
      into single-return-value functions compatible with NativeCall
    ▼
libsqlite3.so.0 (real, dynamically loaded, version 3.45.1 verified)
    ▼
NativeCallResult — typed result surfaced back to TS / UR Runtime
```

### Why a C adapter?

SQLite3's `sqlite3_open(**ppDb)` and `sqlite3_prepare_v2(**ppStmt)` use double-pointer out-parameters: the caller passes a `sqlite3**`, SQLite writes the handle through it. The generic `NativeCall` model (one return value, typed arg list) cannot express this pattern without special-casing it. The adapter (`sqlite3_adapter.c`) wraps these two functions and returns the handle directly — making them compatible with the generic layer without changing the generic layer itself. This is the same pattern as the C++ exception trampolines: a compiled shim adapting an incompatible calling convention.

### Why generic first?

The `NativeFfiLoader` / `IPlatformExecutor` / `HarnessExecutor` chain knows nothing about SQLite. It is the reusable infrastructure layer; SQLite is its first driver. Every future library (OpenCV, ONNX Runtime, zlib, OpenSSL, libcurl) adds only a driver — it does not change the loader or executor.

## Files

| File | Purpose |
|---|---|
| `src/ffi/native/types.ts` | Core types: `NativeArg`, `NativeCallResult`, `NativeCall`, `IPlatformExecutor`, `INativeDriver`, `DiagnosticEvent` |
| `src/ffi/native/loader.ts` | `NativeFfiLoader` — cache, ABI verify, bind, unloadAll; `checkVersionCompatibility` |
| `src/ffi/native/platform-executors.ts` | Stubs: `LinuxExecutorStub`, `MacOsExecutorStub`, `WindowsExecutorStub`, `WasmExecutorStub`; `detectPlatform()` |
| `tests/ffi/native/harness-executor.ts` | `HarnessExecutor` — real gcc-compiled C harness execution |
| `tests/ffi/native/sqlite3-driver.ts` | `Sqlite3Driver` (INativeDriver<Sqlite3Api>); typed API; constants |
| `tests/ffi/native/fixtures/sqlite3.h` | Stable SQLite3 public C API header (3.45.1, verified against real .so) |
| `tests/ffi/native/fixtures/sqlite3_adapter.c` | C adapter flattening double-pointer out-params |
| `tools/sqlite3-version-check.ts` | Build-time version verification tool (uses Node APIs — not in src/) |
| `src/urpm/commands.ts` | `cmdCreateProject()` — scaffold database / vision / inference / robotics projects |

## Version/ABI verification

The loader calls `sqlite3_libversion()` via the real library before returning any handle. Compatibility policy:

| Difference | Result |
|---|---|
| Same exact version | ✅ compatible |
| Same major, different minor/patch | ✅ compatible + `[WARN]` diagnostic |
| Different major | ❌ incompatible — generation halted, clear error emitted |
| Unparseable version string | ❌ incompatible — error emitted |

Verified runtime: **3.45.1** (`sqlite3_sourceid` also confirmed via real call).

## Test coverage

| Test | Kind | Coverage |
|---|---|---|
| `tests/ffi/native/loader.test.ts` | Unit (18 tests, no toolchain) | Cache, ABI check, diagnostics, bind(), teardown, error handling |
| `tests/ffi/native/sqlite3-crud.test.ts` | End-to-end, real gcc + libsqlite3.so.0 (13 tests) | All 11 steps below |

### CRUD verification ladder (13 tests, 0 simulation)

| Step | Verified |
|---|---|
| 1 | Version/ABI — `sqlite3_libversion()` + `sqlite3_sourceid()` via generic loader; version compatibility check passes for 3.45.1 |
| 2 | Open — in-memory database; handle non-null, `ur_sqlite3_last_open_rc()` == SQLITE_OK |
| 3 | CREATE TABLE — `sqlite3_step()` returns SQLITE_DONE |
| 4 | INSERT with parameter binding — `sqlite3_bind_text()`, `sqlite3_bind_double()`, `sqlite3_reset()`, `sqlite3_changes()` == 1, `sqlite3_last_insert_rowid()` == 2 |
| 5 | SELECT — column count, integer/text/real types, both rows correct |
| 6 | UPDATE + DELETE — `sqlite3_changes()` reflects actual affected row count |
| 7a | Invalid SQL → `sqlite3_prepare_v2()` non-zero rc, `sqlite3_errmsg()` non-empty |
| 7b | NOT NULL constraint violation → SQLITE_CONSTRAINT (19) |
| 7c | Open nonexistent path with SQLITE_OPEN_READONLY → non-zero rc (graceful) |
| 8 | NULL values — `sqlite3_bind_null()` → `sqlite3_column_type()` returns SQLITE_NULL (5) |
| 9 | UTF-8 round-trip — Arabic (مرحبا), Japanese (こんにちは), emoji (😀🚀❤) — all three `strcmp()` == 0 after bind/column |
| 10 | Transactions — `BEGIN` / `ROLLBACK` — row absent after rollback (count: 2 inside, 1 after) |
| 11 | Resource cleanup — `sqlite3_close()` returns SQLITE_OK |

## urpm project template

`cmdCreateProject("قاعدة_بيانات", "database")` scaffolds a new UR project with:
- `manifest.json` (correct name/version)
- `src/main.ur` — illustrated UR call surface (see disclaimer in the file)
- `README.md` — full capability list and architecture diagram

The scaffolding logic is real and fully tested (14 tests). The `.ur` stub is labelled as an illustration — compilability requires the UR Frontend, which is not included in this project slice.

Template types: `database` (SQLite3, real), `vision` (OpenCV stub), `inference` (ONNX stub), `robotics` (ROS2 stub).

## Regression tests added this phase

| Bug/root cause | Regression test |
|---|---|
| `parseTypeRef()` only handled single-token types — `long long` was silently dropped, corrupting SQLite3 binding (sqlite3_bind_int64, sqlite3_column_int64, sqlite3_last_insert_rowid) | `tests/ffi/bindgen.test.ts` — "multi-token type specifiers" suite (15 cases) |
| `const void*` failed with the new specifier-collection parser (kw_void not handled inside the loop when qualifiers already consumed) | Same suite — existing "handles extern C wrapper" test restored; OpenCV test guards against regression |
| `unsigned int`/`unsigned long`/`unsigned long long`/`signed char`/etc. missing from `builtinRegistry()` | `tests/ffi/bindgen.test.ts` — "full SQLite3 header parses with zero errors and all 27 functions" |
| SQLite3 `**ppDb` double-pointer out-param incompatible with generic NativeCall model | `tests/ffi/native/fixtures/sqlite3_adapter.c` — C adapter; covered by all CRUD tests |

## Known limitations / next steps

- End-to-end from UR Source deferred until the UR Frontend is included in this project slice.
- OpenCV, ONNX Runtime, ROS2: stubs only — no libraries/headers in this environment.
- `HarnessExecutor` spawns a new process per `execute()` call — adequate for testing, but the production execution model will use in-process native calls (N-API, or the UR runtime's own code-gen → compiled binary path).
- The `Sqlite3Driver.open()` / `prepare()` methods use the C adapter symbols (`ur_sqlite3_open`, `ur_sqlite3_prepare`) — these require the adapter to be compiled and linked together with the test code. The pure-TS driver API (`Sqlite3Api`) is fully defined and ready for use when a production execution environment is available.
