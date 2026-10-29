import { createPlatformExecutor } from "./src/ffi/native/executor-factory.js";
import { NativeFfiLoader } from "./src/ffi/native/loader.js";

const libraryPath = "D:/test/tests/fixtures/sqlite/sqlite3.dll";
const executor = createPlatformExecutor("windows");
const loader = new NativeFfiLoader(executor);

let handle: import("./src/ffi/native/types.js").NativeLibraryHandle | undefined;

try {
  if (executor.platform !== "windows") {
    throw new Error(`Unexpected platform: ${executor.platform}`);
  }

  const result = loader.load({
    name: "sqlite3",
    libraryPath,
  });

  if (!result.ok) {
    throw new Error(`Load failed: ${result.reason}`);
  }

  handle = result.handle;

  const version = loader.execute(handle, [{
    symbol: "sqlite3_libversion",
    returnKind: "str",
    args: [],
  }]);

  console.log("FACTORY_PLATFORM:", executor.platform);
  console.log("SQLITE_VERSION_RESULT:", JSON.stringify(version));

  if (version.length !== 1 || version[0]?.kind !== "str" || !version[0].value) {
    throw new Error("SQLite version result is invalid");
  }

  console.log("FACTORY_LOADER_INTEGRATION: PASS");
} catch (error) {
  console.error("FACTORY_LOADER_INTEGRATION: FAIL");
  console.error(error);
  process.exitCode = 1;
} finally {
  loader.unloadAll();
  console.log("UNLOAD_ALL: COMPLETED");
}
