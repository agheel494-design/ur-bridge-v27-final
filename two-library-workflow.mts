import { createPlatformExecutor } from "./src/ffi/native/executor-factory.ts";
import { NativeFfiLoader } from "./src/ffi/native/loader.ts";

const loader = new NativeFfiLoader(createPlatformExecutor("windows"));
let db;
let stmt;
let adapterHandle;
let sqliteHandle;
let dbClosed = false;

function call(handle, symbol, returnKind, args = []) {
  const result = loader.execute(handle, [{ symbol, returnKind, args }])[0];
  if (!result || result.kind === "error") {
    throw new Error(`${symbol}: ${JSON.stringify(result)}`);
  }
  return result;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const adapter = loader.load({
    name: "ur_sqlite_adapter",
    libraryPath: "D:/test/tests/fixtures/sqlite/ur_sqlite_adapter.dll",
  });
  check(adapter.ok, "Adapter load failed: " + JSON.stringify(adapter));
  adapterHandle = adapter.handle;

  const sqlite = loader.load({
    name: "sqlite3",
    libraryPath: "D:/test/tests/fixtures/sqlite/sqlite3.dll",
  });
  check(sqlite.ok, "SQLite load failed: " + JSON.stringify(sqlite));
  sqliteHandle = sqlite.handle;

  db = call(adapterHandle, "ur_sqlite3_open", "ptr", [
    { kind: "str", value: ":memory:" },
  ]).value;
  check(db !== 0n, "SQLite returned a null database pointer");

  check(
    call(adapterHandle, "ur_sqlite3_last_open_rc", "i32").value === 0,
    "SQLite open result code was not zero",
  );

  function exec(sql) {
    const result = call(sqliteHandle, "sqlite3_exec", "i32", [
      { kind: "ptr", value: db },
      { kind: "str", value: sql },
      { kind: "null_ptr" },
      { kind: "null_ptr" },
      { kind: "null_ptr" },
    ]);
    check(result.value === 0, `SQL failed (${result.value}): ${sql}`);
  }

  exec("CREATE TABLE shared_test (id INTEGER PRIMARY KEY, value TEXT)");
  exec("INSERT INTO shared_test VALUES (7, 'TWO-LIBRARY-WORKFLOW')");

  stmt = call(adapterHandle, "ur_sqlite3_prepare", "ptr", [
    { kind: "ptr", value: db },
    { kind: "str", value: "SELECT id, value FROM shared_test WHERE id = 7" },
  ]).value;
  check(stmt !== 0n, "SQLite prepare returned a null statement pointer");

  check(
    call(adapterHandle, "ur_sqlite3_last_prepare_rc", "i32").value === 0,
    "SQLite prepare result code was not zero",
  );

  check(
    call(sqliteHandle, "sqlite3_step", "i32", [
      { kind: "ptr", value: stmt },
    ]).value === 100,
    "Expected SQLITE_ROW (100)",
  );

  const id = call(sqliteHandle, "sqlite3_column_int", "i32", [
    { kind: "ptr", value: stmt },
    { kind: "i32", value: 0 },
  ]).value;

  const value = call(sqliteHandle, "sqlite3_column_text", "str", [
    { kind: "ptr", value: stmt },
    { kind: "i32", value: 1 },
  ]).value;

  check(id === 7, `Unexpected ID: ${id}`);
  check(value === "TWO-LIBRARY-WORKFLOW", `Unexpected value: ${value}`);

  check(
    call(sqliteHandle, "sqlite3_finalize", "i32", [
      { kind: "ptr", value: stmt },
    ]).value === 0,
    "sqlite3_finalize failed",
  );
  stmt = undefined;

  check(
    call(sqliteHandle, "sqlite3_close", "i32", [
      { kind: "ptr", value: db },
    ]).value === 0,
    "sqlite3_close failed",
  );
  dbClosed = true;

  console.log("LIBRARY_1: ur_sqlite_adapter PASS");
  console.log("LIBRARY_2: sqlite3 PASS");
  console.log("SHARED_DATABASE_OPERATION: PASS");
  console.log("SELECT_ID:", id);
  console.log("SELECT_VALUE:", value);
  console.log("STATEMENT_FINALIZE: PASS");
  console.log("DATABASE_CLOSE: PASS");
  console.log("TWO_LIBRARY_WORKFLOW: PASS");
} finally {
  try {
    if (stmt !== undefined && sqliteHandle && db !== undefined) {
      loader.execute(sqliteHandle, [{
        symbol: "sqlite3_finalize",
        returnKind: "i32",
        args: [{ kind: "ptr", value: stmt }],
      }]);
    }

    if (!dbClosed && db !== undefined && sqliteHandle) {
      loader.execute(sqliteHandle, [{
        symbol: "sqlite3_close",
        returnKind: "i32",
        args: [{ kind: "ptr", value: db }],
      }]);
    }
  } finally {
    loader.unloadAll();
  }
}
