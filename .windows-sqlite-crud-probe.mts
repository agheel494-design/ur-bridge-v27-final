import { createPlatformExecutor } from "./src/ffi/native/executor-factory.js";
import { NativeFfiLoader } from "./src/ffi/native/loader.js";

const loader = new NativeFfiLoader(createPlatformExecutor("windows"));
const adapterPath = `${process.env.TEMP}/ur-sqlite-adapter-probe/ur_sqlite_adapter.dll`;
const sqlitePath = `${process.env.TEMP}/ur-sqlite-adapter-probe/sqlite3.dll`;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function call(handle: any, symbol: string, returnKind: string, args: any[] = []) {
  return loader.execute(handle, [{ symbol, returnKind, args } as any])[0];
}

try {
  const a = loader.load({ name: "ur_sqlite_adapter", libraryPath: adapterPath });
  check(a.ok, `ADAPTER_LOAD_FAILED: ${JSON.stringify(a)}`);
  const adapter = a.handle;

  const s = loader.load({ name: "sqlite3", libraryPath: sqlitePath });
  check(s.ok, `SQLITE_LOAD_FAILED: ${JSON.stringify(s)}`);
  const sqlite = s.handle;

  const opened = call(adapter, "ur_sqlite3_open", "ptr", [
    { kind: "str", value: ":memory:" }
  ]);
  check(opened?.kind === "ptr" && opened.value, "OPEN_RETURNED_NULL");
  const db = opened.value;

  const openRc = call(adapter, "ur_sqlite3_last_open_rc", "i32");
  check(openRc?.value === 0, `SQLITE_OPEN_RC: ${JSON.stringify(openRc)}`);

  const exec = (sql: string) => {
    const result = call(sqlite, "sqlite3_exec", "i32", [
      { kind: "ptr", value: db },
      { kind: "str", value: sql },
      { kind: "null_ptr" },
      { kind: "null_ptr" },
      { kind: "null_ptr" }
    ]);
    check(result?.value === 0, `SQLITE_EXEC_FAILED: ${sql}; ${JSON.stringify(result)}`);
  };

  exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)");
  exec("INSERT INTO probe (id, value) VALUES (42, 'UR-WINDOWS-CRUD')");

  const prepared = call(adapter, "ur_sqlite3_prepare", "ptr", [
    { kind: "ptr", value: db },
    { kind: "str", value: "SELECT id, value FROM probe WHERE id = 42" }
  ]);
  check(prepared?.kind === "ptr" && prepared.value, "PREPARE_RETURNED_NULL");
  const stmt = prepared.value;

  const prepareRc = call(adapter, "ur_sqlite3_last_prepare_rc", "i32");
  check(prepareRc?.value === 0, `SQLITE_PREPARE_RC: ${JSON.stringify(prepareRc)}`);

  const step = call(sqlite, "sqlite3_step", "i32", [
    { kind: "ptr", value: stmt }
  ]);
  check(step?.value === 100, `EXPECTED_SQLITE_ROW_100: ${JSON.stringify(step)}`);

  const id = call(sqlite, "sqlite3_column_int", "i32", [
    { kind: "ptr", value: stmt }, { kind: "i32", value: 0 }
  ]);
  const value = call(sqlite, "sqlite3_column_text", "str", [
    { kind: "ptr", value: stmt }, { kind: "i32", value: 1 }
  ]);

  check(id?.value === 42, `WRONG_ID: ${JSON.stringify(id)}`);
  check(value?.value === "UR-WINDOWS-CRUD", `WRONG_VALUE: ${JSON.stringify(value)}`);

  const finalized = call(sqlite, "sqlite3_finalize", "i32", [
    { kind: "ptr", value: stmt }
  ]);
  check(finalized?.value === 0, `FINALIZE_FAILED: ${JSON.stringify(finalized)}`);

  const closed = call(sqlite, "sqlite3_close", "i32", [
    { kind: "ptr", value: db }
  ]);
  check(closed?.value === 0, `CLOSE_FAILED: ${JSON.stringify(closed)}`);

  console.log("WINDOWS_SQLITE_CRUD: PASS");
  console.log("DATABASE: :memory:");
  console.log("CREATE: PASS");
  console.log("INSERT: PASS");
  console.log("SELECT_ID:", id.value);
  console.log("SELECT_VALUE:", value.value);
  console.log("FINALIZE: PASS");
  console.log("CLOSE: PASS");
} catch (error) {
  console.error("WINDOWS_SQLITE_CRUD: FAIL");
  console.error(error);
  process.exitCode = 1;
} finally {
  loader.unloadAll();
}
