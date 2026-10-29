import { createPlatformExecutor } from "./src/ffi/native/executor-factory.ts";
import { NativeFfiLoader } from "./src/ffi/native/loader.ts";

const loader = new NativeFfiLoader(createPlatformExecutor("windows"));

try {
  const adapter = loader.load({
    name: "ur_sqlite_adapter",
    libraryPath: "D:/test/tests/fixtures/sqlite/ur_sqlite_adapter.dll",
  });

  const sqlite = loader.load({
    name: "sqlite3",
    libraryPath: "D:/test/tests/fixtures/sqlite/sqlite3.dll",
  });

  if (!adapter.ok) throw new Error("Adapter load failed: " + JSON.stringify(adapter));
  if (!sqlite.ok) throw new Error("SQLite load failed: " + JSON.stringify(sqlite));

  const version = loader.execute(sqlite.handle, [{
    symbol: "sqlite3_libversion",
    args: [],
    returnKind: "str",
  }])[0];

  const openResult = loader.execute(adapter.handle, [{
    symbol: "ur_sqlite3_open",
    args: [{ kind: "str", value: ":memory:" }],
    returnKind: "ptr",
  }])[0];

  if (version?.kind !== "str") throw new Error("SQLite version call failed: " + JSON.stringify(version));
  if (openResult?.kind !== "ptr" || openResult.value === 0n) {
    throw new Error("SQLite open failed: " + JSON.stringify(openResult));
  }

  console.log("LIBRARY_1: ur_sqlite_adapter LOADED");
  console.log("LIBRARY_2: sqlite3 LOADED");
  console.log("SQLITE_VERSION:", version.value);
  console.log("TWO_LIBRARY_LOAD_TEST: PASS");
} finally {
  loader.unloadAll();
}
