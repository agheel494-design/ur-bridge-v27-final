// ─────────────────────────────────────────────────────────────────────────────
// run-tests.ts — Minimal vitest-compatible runner using tsx
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "fs";
import { pathToFileURL } from "url";

// ── Globals ───────────────────────────────────────────────────────────────────

type TestFn = () => void | Promise<void>;

interface Suite {
  name: string;
  tests: Array<{ name: string; fn: TestFn }>;
  beforeEach: TestFn[];
}

const suites: Suite[] = [];
let current: Suite | null = null;

(globalThis as any).describe = (name: string, fn: () => void) => {
  const suite: Suite = { name, tests: [], beforeEach: [] };
  suites.push(suite);
  const prev = current;
  current = suite;
  fn();
  current = prev;
};

(globalThis as any).it = (name: string, fn: TestFn) => {
  if (!current) throw new Error("it() outside describe()");
  current.tests.push({ name, fn });
};

(globalThis as any).beforeEach = (fn: TestFn) => {
  if (!current) throw new Error("beforeEach() outside describe()");
  current.beforeEach.push(fn);
};

// ── Expect ────────────────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(msg: string) { super(msg); this.name = "AssertionError"; }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    // Match vitest/Jest `toEqual` semantics: a key whose value is
    // `undefined` is treated as equivalent to the key being absent.
    const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined).sort();
    const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined).sort();
    if (!deepEqual(ka, kb)) return false;
    return ka.every((k) => deepEqual((a as any)[k], (b as any)[k]));
  }
  return false;
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected)
        throw new AssertionError(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected))
        throw new AssertionError(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeNull() {
      if (actual !== null)
        throw new AssertionError(`Expected null, got ${JSON.stringify(actual)}`);
    },
    toBeUndefined() {
      if (actual !== undefined)
        throw new AssertionError(`Expected undefined, got ${JSON.stringify(actual)}`);
    },
    toBeDefined() {
      if (actual === undefined)
        throw new AssertionError(`Expected defined`);
    },
    toBeGreaterThan(n: number) {
      if ((actual as number) <= n)
        throw new AssertionError(`Expected ${actual} > ${n}`);
    },
    toBeGreaterThanOrEqual(n: number) {
      if ((actual as number) < n)
        throw new AssertionError(`Expected ${actual} >= ${n}`);
    },
    toContain(item: unknown) {
      if (Array.isArray(actual)) {
        if (!actual.includes(item))
          throw new AssertionError(`Expected array to contain ${JSON.stringify(item)}`);
      } else if (typeof actual === "string") {
        if (!actual.includes(item as string))
          throw new AssertionError(`Expected string to contain ${JSON.stringify(item)}`);
      } else {
        throw new AssertionError(`toContain called on non-array/string`);
      }
    },
    toHaveProperty(key: string) {
      if (actual === null || actual === undefined || !(key in (actual as object)))
        throw new AssertionError(`Expected object to have property "${key}"`);
    },
    toThrow() {
      let threw = false;
      try { (actual as () => void)(); } catch { threw = true; }
      if (!threw) throw new AssertionError(`Expected function to throw`);
    },
    toBeLessThan(n: number) {
      if ((actual as number) >= n)
        throw new AssertionError(`Expected ${actual} < ${n}`);
    },
    toBeLessThanOrEqual(n: number) {
      if ((actual as number) > n)
        throw new AssertionError(`Expected ${actual} <= ${n}`);
    },
    toBeCloseTo(expected: number, precision = 2) {
      const diff = Math.abs((actual as number) - expected);
      const threshold = Math.pow(10, -precision) / 2;
      if (diff > threshold)
        throw new AssertionError(`Expected ${actual} to be close to ${expected} (precision ${precision})`);
    },
    toHaveLength(length: number) {
      const len = (actual as { length?: number } | null | undefined)?.length;
      if (len !== length)
        throw new AssertionError(`Expected length ${length}, got ${JSON.stringify(len)} (value: ${JSON.stringify(actual)})`);
    },
    toMatch(pattern: RegExp | string) {
      const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
      if (typeof actual !== "string" || !re.test(actual))
        throw new AssertionError(`Expected ${JSON.stringify(actual)} to match ${pattern}`);
    },
    not: {
      toBeNull() {
        if (actual === null)
          throw new AssertionError(`Expected non-null`);
      },
      toBe(expected: unknown) {
        if (actual === expected)
          throw new AssertionError(`Expected not ${JSON.stringify(expected)}`);
      },
      toContain(item: unknown) {
        if (Array.isArray(actual)) {
          if (actual.includes(item))
            throw new AssertionError(`Expected array NOT to contain ${JSON.stringify(item)}`);
        } else if (typeof actual === "string") {
          if (actual.includes(item as string))
            throw new AssertionError(`Expected string NOT to contain ${JSON.stringify(item)}`);
        }
      },
      toThrow() {
        let threw = false;
        try { (actual as () => void)(); } catch { threw = true; }
        if (threw) throw new AssertionError(`Expected function NOT to throw`);
      },
      toBeDefined() {
        if (actual !== undefined)
          throw new AssertionError(`Expected undefined`);
      },
    },
  };
}

(globalThis as any).expect = expect;

// ── Runner ────────────────────────────────────────────────────────────────────

async function run(testFile: string) {
  await import(pathToFileURL(testFile).href);

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const suite of suites) {
    console.log(`\n  ${suite.name}`);
    for (const test of suite.tests) {
      try {
        for (const bef of suite.beforeEach) await bef();
        await test.fn();
        console.log(`    ✓ ${test.name}`);
        passed++;
      } catch (e: any) {
        console.log(`    ✗ ${test.name}`);
        console.log(`      ${e.message}`);
        failures.push(`${suite.name} > ${test.name}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`Tests:  ${passed + failed} total`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failures.length) {
    console.log(`\nFailures:`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} tests passed`);
  }
}

const file = process.argv[2];
if (!file) { console.error("Usage: tsx run-tests.ts <testfile>"); process.exit(1); }
run(file).catch((e) => { console.error(e); process.exit(1); });
