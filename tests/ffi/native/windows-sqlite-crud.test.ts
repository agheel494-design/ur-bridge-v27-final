import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const isWindows = process.platform === "win32";

describe.skipIf(!isWindows)("Windows SQLite CRUD — reproducible fixture", () => {
  it("builds its adapter from scratch and runs native CRUD in a child process", () => {
    const temp = mkdtempSync(join(tmpdir(), "ur-sqlite-crud-"));
    const gcc = process.env.GCC_EXE ?? "C:\\mingw64\\bin\\gcc.exe";
    const sourceDll = resolve(root, "tests/fixtures/sqlite/sqlite3.dll");
    const sourceAdapter = resolve(root, "tests/ffi/native/fixtures/sqlite3_adapter.c");
    const headerDir = resolve(root, "tests/ffi/native/fixtures");
    const dll = join(temp, "sqlite3.dll");
    const adapter = join(temp, "ur_sqlite_adapter.dll");
    const probe = join(temp, "crud-probe.mts");
    const tsxCli = resolve(root, "node_modules/tsx/dist/cli.mjs");

    try {
      expect(existsSync(gcc), `GCC not found: ${gcc}`).toBe(true);
      expect(existsSync(sourceDll), `SQLite DLL missing: ${sourceDll}`).toBe(true);
      expect(existsSync(sourceAdapter), `Adapter source missing: ${sourceAdapter}`).toBe(true);
      expect(existsSync(tsxCli), `tsx CLI missing: ${tsxCli}`).toBe(true);

      copyFileSync(sourceDll, dll);

      const build = spawnSync(
        gcc,
        ["-shared", "-O2", `-I${headerDir}`, sourceAdapter, dll, "-o", adapter],
        { cwd: root, encoding: "utf8", timeout: 30000, windowsHide: true },
      );
      expect(
        build.status,
        `Adapter build failed.\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`,
      ).toBe(0);
      expect(existsSync(adapter), "Adapter DLL was not created").toBe(true);

      const factoryPath = resolve(root, "src/ffi/native/executor-factory.ts").replace(/\\/g, "/");
      const loaderPath = resolve(root, "src/ffi/native/loader.ts").replace(/\\/g, "/");

      writeFileSync(probe, `
import { createPlatformExecutor } from ${JSON.stringify(pathToFileURL(factoryPath).href)};
import { NativeFfiLoader } from ${JSON.stringify(pathToFileURL(loaderPath).href)};

const loader = new NativeFfiLoader(createPlatformExecutor("windows"));
let db;
let stmt;
let closed = false;

function call(handle, symbol, returnKind, args = []) {
  const [result] = loader.execute(handle, [{ symbol, returnKind, args }]);
  if (!result || result.kind === "error") {
    throw new Error(symbol + ": " + JSON.stringify(result));
  }
  return result;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const ar = loader.load({
    name: "ur_sqlite_adapter",
    libraryPath: ${JSON.stringify(adapter)},
  });
  requireValue(ar.ok, "Adapter load failed: " + JSON.stringify(ar));
  const adapterHandle = ar.handle;

  const sr = loader.load({
    name: "sqlite3",
    libraryPath: ${JSON.stringify(dll)},
  });
  requireValue(sr.ok, "SQLite load failed: " + JSON.stringify(sr));
  const sqlite = sr.handle;

  const opened = call(adapterHandle, "ur_sqlite3_open", "ptr", [
    { kind: "str", value: ":memory:" },
  ]);
  requireValue(opened.kind === "ptr" && opened.value !== 0n, "SQLite open failed");
  db = opened.value;

  requireValue(
    call(adapterHandle, "ur_sqlite3_last_open_rc", "i32").value === 0,
    "SQLite open result code was not zero",
  );

  function exec(sql) {
    const result = call(sqlite, "sqlite3_exec", "i32", [
      { kind: "ptr", value: db },
      { kind: "str", value: sql },
      { kind: "null_ptr" },
      { kind: "null_ptr" },
      { kind: "null_ptr" },
    ]);
    requireValue(result.value === 0, "SQL failed: " + sql);
  }

  exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)");
  exec("INSERT INTO probe (id, value) VALUES (42, 'UR-WINDOWS-CRUD')");

  const prepared = call(adapterHandle, "ur_sqlite3_prepare", "ptr", [
    { kind: "ptr", value: db },
    { kind: "str", value: "SELECT id, value FROM probe WHERE id = 42" },
  ]);
  requireValue(prepared.kind === "ptr" && prepared.value !== 0n, "Prepare failed");
  stmt = prepared.value;

  requireValue(
    call(adapterHandle, "ur_sqlite3_last_prepare_rc", "i32").value === 0,
    "Prepare result code was not zero",
  );
  requireValue(
    call(sqlite, "sqlite3_step", "i32", [{ kind: "ptr", value: stmt }]).value === 100,
    "Expected SQLITE_ROW (100)",
  );

  const id = call(sqlite, "sqlite3_column_int", "i32", [
    { kind: "ptr", value: stmt }, { kind: "i32", value: 0 },
  ]);
  const value = call(sqlite, "sqlite3_column_text", "str", [
    { kind: "ptr", value: stmt }, { kind: "i32", value: 1 },
  ]);

  requireValue(id.value === 42, "Unexpected selected ID: " + id.value);
  requireValue(value.value === "UR-WINDOWS-CRUD", "Unexpected selected value: " + value.value);

  requireValue(
    call(sqlite, "sqlite3_finalize", "i32", [{ kind: "ptr", value: stmt }]).value === 0,
    "Finalize failed",
  );
  stmt = undefined;

  requireValue(
    call(sqlite, "sqlite3_close", "i32", [{ kind: "ptr", value: db }]).value === 0,
    "Close failed",
  );
  closed = true;

  console.log("WINDOWS_SQLITE_CRUD: PASS");
  console.log("SELECT_ID:", id.value);
  console.log("SELECT_VALUE:", value.value);
  console.log("FINALIZE: PASS");
  console.log("CLOSE: PASS");
} finally {
  try {
    if (stmt !== undefined && db !== undefined) {
      const sr = loader.load({
        name: "sqlite3",
        libraryPath: ${JSON.stringify(dll)},
      });
      if (sr.ok) {
        loader.execute(sr.handle, [{
          symbol: "sqlite3_finalize",
          returnKind: "i32",
          args: [{ kind: "ptr", value: stmt }],
        }]);
      }
    }
    if (!closed && db !== undefined) {
      const sr = loader.load({
        name: "sqlite3",
        libraryPath: ${JSON.stringify(dll)},
      });
      if (sr.ok) {
        loader.execute(sr.handle, [{
          symbol: "sqlite3_close",
          returnKind: "i32",
          args: [{ kind: "ptr", value: db }],
        }]);
      }
    }
  } finally {
    loader.unloadAll();
  }
}
`, "utf8");

      const run = spawnSync(process.execPath, [tsxCli, probe], {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        windowsHide: true,
      });

      const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      console.log(output);
      expect(run.error, output).toBeUndefined();
      expect(run.status, output).toBe(0);
      expect(output).toContain("WINDOWS_SQLITE_CRUD: PASS");
      expect(output).toContain("SELECT_ID: 42");
      expect(output).toContain("SELECT_VALUE: UR-WINDOWS-CRUD");
      expect(output).toContain("FINALIZE: PASS");
      expect(output).toContain("CLOSE: PASS");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 60000);
});


