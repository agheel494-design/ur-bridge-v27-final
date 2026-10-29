import { createPlatformExecutor } from "./src/ffi/native/executor-factory.ts";

const executor = createPlatformExecutor("windows");
const handle = executor.load("D:/test/tests/fixtures/sqlite/sqlite3.dll");

try {
  const results = executor.execute(handle, [
    { symbol: "sqlite3_libversion", args: [], returnKind: "str" },
    { symbol: "sqlite3_libversion_number", args: [], returnKind: "i32" },
  ]);

  console.log("STRING_RESULT:", JSON.stringify(results[0]));
  console.log("INTEGER_RESULT:", JSON.stringify(results[1]));

  if (
    results[0]?.kind !== "str" ||
    typeof results[0].value !== "string" ||
    results[1]?.kind !== "i32" ||
    typeof results[1].value !== "number" ||
    results[1].value <= 0
  ) {
    throw new Error("Native return-type validation failed");
  }

  console.log("NATIVE_TYPES_ISOLATED: PASS");
} finally {
  executor.unload(handle);
}
