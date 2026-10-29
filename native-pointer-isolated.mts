import { createPlatformExecutor } from "./src/ffi/native/executor-factory.ts";

const executor = createPlatformExecutor("windows");
const sqlite = executor.load("D:/test/tests/fixtures/sqlite/sqlite3.dll");
const adapter = executor.load("D:/test/tests/fixtures/sqlite/ur_sqlite_adapter.dll");

let db = 0n;

try {
  const opened = executor.execute(adapter, [{
    symbol: "ur_sqlite3_open",
    args: [{ kind: "str", value: ":memory:" }],
    returnKind: "ptr",
  }])[0];

  console.log("OPEN_RESULT:", JSON.stringify(opened, (_, v) =>
    typeof v === "bigint" ? v.toString() : v
  ));

  if (opened?.kind !== "ptr" || opened.value === 0n) {
    throw new Error("SQLite open did not return a valid pointer");
  }

  db = opened.value;

  const rc = executor.execute(adapter, [{
    symbol: "ur_sqlite3_last_open_rc",
    args: [],
    returnKind: "i32",
  }])[0];

  console.log("OPEN_RC:", JSON.stringify(rc));

  const changes = executor.execute(sqlite, [{
    symbol: "sqlite3_changes",
    args: [{ kind: "ptr", value: db }],
    returnKind: "i32",
  }])[0];

  console.log("CHANGES_RESULT:", JSON.stringify(changes));

  if (rc?.kind !== "i32" || rc.value !== 0 ||
      changes?.kind !== "i32" || changes.value !== 0) {
    throw new Error("Pointer round-trip validation failed");
  }

  const closed = executor.execute(sqlite, [{
    symbol: "sqlite3_close",
    args: [{ kind: "ptr", value: db }],
    returnKind: "i32",
  }])[0];

  console.log("CLOSE_RESULT:", JSON.stringify(closed));
  if (closed?.kind !== "i32" || closed.value !== 0) {
    throw new Error("SQLite close failed");
  }

  db = 0n;
  console.log("NATIVE_POINTER_ROUNDTRIP: PASS");
} finally {
  if (db !== 0n) {
    try {
      executor.execute(sqlite, [{
        symbol: "sqlite3_close",
        args: [{ kind: "ptr", value: db }],
        returnKind: "i32",
      }]);
    } catch {}
  }
  executor.unload(adapter);
  executor.unload(sqlite);
}
