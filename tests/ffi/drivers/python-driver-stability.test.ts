import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { PythonDriver } from "../../../src/ffi/drivers/python/python-driver.js";
import { NativeFfiLoader } from "../../../src/ffi/native/loader.js";
import { HarnessExecutor } from "../native/harness-executor.js";

// FFI Python Bridge, Phase 2, Task 5: Long-running Stability & Soak
// Tests. Runs entirely on the existing single-process harness
// (achievable without any Harness/core/ABI change, per explicit
// direction) - does not require Task 4's own blocked multi-thread
// capability.
//
// DISCLOSED LIMITATION: this does not measure real process RSS
// (memory) directly - it uses per-call elapsed-time trend across
// different call counts as an objective, if indirect, signal. A
// genuine memory leak causing real slowdown would show INCREASING
// per-call time as count grows; a stable or DEcreasing per-call time
// is real evidence against a leak affecting performance within the
// tested range, not an absolute guarantee of zero memory growth.

const PYTHON_LIB_CANDIDATES = [
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so",
  "/usr/lib/x86_64-linux-gnu/libpython3.12.so.1.0",
];

function findRealLibpython(): string | undefined {
  return PYTHON_LIB_CANDIDATES.find((p) => existsSync(p));
}

const libPath = findRealLibpython();

describe("FFI Python Bridge Phase 2 Task 5: Long-running Stability, no simulation", () => {
  if (!libPath) {
    it.skip("SKIPPED: no real libpython.so found", () => { expect(true).toBe(true); });
    return;
  }

  const executor = new HarnessExecutor();
  const loader = new NativeFfiLoader(executor);
  const loadResult = loader.load({ name: "CPython", libraryPath: libPath });
  if (!loadResult.ok) {
    // D-4b (UR-PM-DIRECTIVE-003): the library IS present (found above), so a load failure is a FAILURE, not a skip.
    const reason = String((loadResult as { reason?: unknown }).reason);
    it("libpython.so is present at " + libPath + " and must load (a load failure is a failure, not a skip)", () => {
      expect(loadResult.ok, `failed to load libpython.so at ${libPath}: ${reason}`).toBe(true);
    });
    return;
  }
  const handle = loadResult.handle;
  const api = new PythonDriver(libPath).bind({ execute: (calls: any) => loader.execute(handle, calls) });

  it("1000 consecutive real PyRun_SimpleString calls (each allocating/discarding a Python list) - zero errors, interpreter alive, clean finalize", () => {
    const result = api.stabilitySoakTest(1000);
    expect(result.errorCount).toBe(0);
    expect(result.finalIsInitialized).toBe(1);
    expect(result.finalizeOk).toBe(true);
  });

  it("10000 consecutive real calls - zero errors, interpreter alive, clean finalize, AND per-call time does not increase vs. the 1000-call run (real, objective evidence against a leak degrading performance in this range)", () => {
    const result1k = api.stabilitySoakTest(1000);
    const result10k = api.stabilitySoakTest(10000);
    expect(result10k.errorCount).toBe(0);
    expect(result10k.finalIsInitialized).toBe(1);
    expect(result10k.finalizeOk).toBe(true);
    // Real regression check: per-call time for 10x the work should
    // not be meaningfully worse - allow generous headroom (2x) since
    // this is a real, noisy timing measurement, not a precise metric.
    expect(result10k.perCallMs).toBeLessThan(result1k.perCallMs * 2);
  });
});
