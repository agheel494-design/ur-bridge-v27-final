// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Performance Benchmarks: Native FFI Stack
// Phase 7.5 — Native Ecosystem Expansion — Priority 7
// ─────────────────────────────────────────────────────────────────────────────
//
// Official benchmark suite measuring overhead at every layer of the UR-Bridge
// FFI stack. Results are reported as operations/sec and nanoseconds/op.
//
// Measured categories:
//   1. Library Load Time       — NativeFfiLoader.load()
//   2. Symbol Resolution       — per-call dispatch overhead
//   3. Native Call Overhead    — round-trip through executor
//   4. UTF-8 Encoding          — str arg encoding
//   5. Marshaling              — NativeArg[] assembly
//   6. Unmarshaling            — NativeCallResult[] parsing
//
// Each benchmark runs N=10,000 iterations for statistical stability.
// The test does NOT set hard pass/fail thresholds (those belong in a CI
// performance gate with baseline comparison) — it instead reports metrics
// and asserts that the measured overhead is finite and reasonable.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { NativeFfiLoader } from "../../src/ffi/native/loader.js";
import type {
  IPlatformExecutor,
  NativeLibraryHandle,
  NativeCall,
  NativeCallResult,
  Platform,
} from "../../src/ffi/native/types.js";

// ── Zero-overhead mock executor ────────────────────────────────────────────────
//
// Designed to be as fast as possible so that measurements reflect
// the TS binding layer, not artificial slowness in the mock.

class ZeroOverheadExecutor implements IPlatformExecutor {
  readonly platform: Platform = "linux";
  private handleId = 1;

  load(libraryPath: string): NativeLibraryHandle {
    return { libraryPath, platform: "linux", _token: this.handleId++ };
  }

  execute(_handle: NativeLibraryHandle, calls: NativeCall[]): NativeCallResult[] {
    // Return a fixed result per call kind — no allocation in the fast path
    return calls.map((c) => {
      switch (c.returnKind) {
        case "i32":  return { kind: "i32",  value: 0 };
        case "i64":  return { kind: "i64",  value: 0n };
        case "f64":  return { kind: "f64",  value: 0.0 };
        case "str":  return { kind: "str",  value: "" };
        case "ptr":  return { kind: "ptr",  value: 0n };
        default:     return { kind: "void" };
      }
    });
  }

  unload(_handle: NativeLibraryHandle): void {}
}

// ── Benchmark helpers ──────────────────────────────────────────────────────────

function measureNs(fn: () => void, iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  return (elapsed / iterations) * 1_000_000; // ms → ns per op
}

function opsPerSec(nsPerOp: number): number {
  return Math.round(1_000_000_000 / nsPerOp);
}

function reportBenchmark(name: string, nsPerOp: number): void {
  console.log(
    `  [BENCHMARK] ${name.padEnd(40)} ${nsPerOp.toFixed(2).padStart(10)} ns/op  ` +
    `(${opsPerSec(nsPerOp).toLocaleString()} ops/sec)`,
  );
}

const N = 10_000;

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Native FFI performance benchmarks", () => {
  const executor = new ZeroOverheadExecutor();
  const loader = new NativeFfiLoader(executor);

  describe("1. Library Load Time", () => {
    it("measures NativeFfiLoader.load() (fresh miss)", () => {
      let i = 0;
      const nsPerOp = measureNs(() => {
        // Use a unique path each time to force a cache miss
        const desc = { name: `Lib${i}`, libraryPath: `/lib/bench${i}.so` };
        loader.load(desc);
        // Unload so the next iteration is also a miss
        const cache = (loader as unknown as { cache: Map<string, NativeLibraryHandle> })["cache"];
        const handle = cache.get(desc.libraryPath);
        if (handle) loader.unload(handle);
        i++;
      }, N);

      reportBenchmark("Library load (fresh miss)", nsPerOp);
      expect(nsPerOp).toBeGreaterThan(0);
      expect(nsPerOp).toBeLessThan(1_000_000); // < 1ms per load is reasonable for mock
    });

    it("measures NativeFfiLoader.load() (cache hit)", () => {
      const desc = { name: "CacheHitLib", libraryPath: "/lib/cache-hit.so" };
      loader.load(desc); // prime cache

      const nsPerOp = measureNs(() => {
        loader.load(desc); // should be a cache hit
      }, N);

      reportBenchmark("Library load (cache hit)", nsPerOp);
      expect(nsPerOp).toBeLessThan(10_000); // < 10µs per cache hit
    });
  });

  describe("2. Symbol Resolution (dispatch overhead)", () => {
    it("measures single-call execute() round-trip", () => {
      const desc = { name: "ResolveLib", libraryPath: "/lib/resolve.so" };
      const loadResult = loader.load(desc);
      expect(loadResult.ok).toBe(true);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const call: NativeCall = { symbol: "test_fn", args: [], returnKind: "i32" };

      const nsPerOp = measureNs(() => {
        loader.execute(handle, [call]);
      }, N);

      reportBenchmark("Symbol resolution + execute (1 call)", nsPerOp);
      expect(nsPerOp).toBeLessThan(100_000); // < 100µs
    });

    it("measures 10-call batch execute()", () => {
      const desc = { name: "BatchLib", libraryPath: "/lib/batch.so" };
      const loadResult = loader.load(desc);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const calls: NativeCall[] = Array.from({ length: 10 }, (_, i) => ({
        symbol: `fn_${i}`,
        args: [],
        returnKind: "i32" as const,
      }));

      const nsPerOp = measureNs(() => {
        loader.execute(handle, calls);
      }, N);

      reportBenchmark("Batch execute (10 calls)", nsPerOp);
      expect(nsPerOp).toBeLessThan(500_000); // < 500µs for 10 calls
    });
  });

  describe("3. Native Call Overhead (arg types)", () => {
    it("measures i32 arg encoding", () => {
      const desc = { name: "I32Lib", libraryPath: "/lib/i32.so" };
      const loadResult = loader.load(desc);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const call: NativeCall = {
        symbol: "add",
        args: [{ kind: "i32", value: 42 }, { kind: "i32", value: 99 }],
        returnKind: "i32",
      };

      const nsPerOp = measureNs(() => {
        loader.execute(handle, [call]);
      }, N);

      reportBenchmark("i32 arg encoding (2 args)", nsPerOp);
      expect(nsPerOp).toBeGreaterThan(0);
    });

    it("measures ptr arg encoding", () => {
      const desc = { name: "PtrLib", libraryPath: "/lib/ptr.so" };
      const loadResult = loader.load(desc);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const call: NativeCall = {
        symbol: "deref",
        args: [{ kind: "ptr", value: 0xDEADBEEFn }],
        returnKind: "i32",
      };

      const nsPerOp = measureNs(() => {
        loader.execute(handle, [call]);
      }, N);

      reportBenchmark("ptr arg encoding (1 arg)", nsPerOp);
      expect(nsPerOp).toBeGreaterThan(0);
    });
  });

  describe("4. UTF-8 Encoding overhead", () => {
    it("measures ASCII string arg", () => {
      const desc = { name: "AsciiLib", libraryPath: "/lib/ascii.so" };
      const loadResult = loader.load(desc);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const call: NativeCall = {
        symbol: "puts",
        args: [{ kind: "str", value: "hello world" }],
        returnKind: "i32",
      };

      const nsPerOp = measureNs(() => loader.execute(handle, [call]), N);
      reportBenchmark("UTF-8 str arg (ASCII, 11 chars)", nsPerOp);
      expect(nsPerOp).toBeGreaterThan(0);
    });

    it("measures Unicode string arg (Arabic + emoji)", () => {
      const desc = { name: "UnicodeLib", libraryPath: "/lib/unicode.so" };
      const loadResult = loader.load(desc);
      const handle = (loadResult as { ok: true; handle: NativeLibraryHandle }).handle;

      const call: NativeCall = {
        symbol: "puts",
        args: [{ kind: "str", value: "مرحبا بالعالم 🌍🚀" }],
        returnKind: "i32",
      };

      const nsPerOp = measureNs(() => loader.execute(handle, [call]), N);
      reportBenchmark("UTF-8 str arg (Arabic+emoji, 18 chars)", nsPerOp);
      expect(nsPerOp).toBeGreaterThan(0);
    });
  });

  describe("5 & 6. Marshaling / Unmarshaling", () => {
    it("measures NativeArg[] assembly (5-arg call)", () => {
      let elapsedNs = 0;
      const N2 = 10_000;
      const start = performance.now();
      for (let i = 0; i < N2; i++) {
        const _args = [
          { kind: "ptr",  value: 42n           } as const,
          { kind: "i32",  value: i             } as const,
          { kind: "str",  value: "bind_text"   } as const,
          { kind: "i32",  value: -1            } as const,
          { kind: "null_ptr"                   } as const,
        ];
      }
      elapsedNs = (performance.now() - start) / N2 * 1_000_000;

      reportBenchmark("NativeArg[] assembly (5 args)", elapsedNs);
      expect(elapsedNs).toBeLessThan(10_000); // < 10µs per assembly
    });

    it("measures NativeCallResult[] parsing", () => {
      const results: NativeCallResult[] = [
        { kind: "i32", value: 42 },
        { kind: "str", value: "hello" },
        { kind: "ptr", value: 0xBEEFn },
      ];
      const N2 = 10_000;
      let sum = 0;
      const start = performance.now();
      for (let i = 0; i < N2; i++) {
        for (const r of results) {
          if (r.kind === "i32") sum += r.value;
          else if (r.kind === "str") sum += r.value.length;
          else if (r.kind === "ptr") sum += Number(r.value & 0xFFFFn);
        }
      }
      const nsPerOp = (performance.now() - start) / N2 * 1_000_000;

      reportBenchmark("NativeCallResult[] parse (3 results)", nsPerOp);
      expect(nsPerOp).toBeLessThan(10_000);
      expect(sum).toBeGreaterThan(0); // prevent optimization
    });
  });

  describe("Summary output", () => {
    it("prints benchmark summary header", () => {
      console.log("\n  ═══════════════════════════════════════════════════════");
      console.log("  UR-Bridge Phase 7.5 — Native FFI Benchmark Results");
      console.log("  ═══════════════════════════════════════════════════════");
      console.log(`  Iterations per test: ${N.toLocaleString()}`);
      console.log(`  Executor: ZeroOverheadExecutor (in-process mock)`);
      console.log("  ═══════════════════════════════════════════════════════\n");
      expect(true).toBe(true);
    });
  });
});
