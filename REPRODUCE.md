# REPRODUCE.md

**This document describes how to reproduce this session's own
results. The run-logs/ directory attached alongside this file
contains the actual, real command output captured during this
session's own final clean re-run - not narration about results, the
results themselves. Treat any number in prose (in commit messages or
other .md files) as Reported until you have either inspected
run-logs/ or re-run the commands yourself.**

---

## Environment Requirements

- Node.js: v22.22.2 (or any Node 22.x - N-API version 10 was used;
  not tested against other major versions)
- gcc/g++: required for the Python and Rust Bridge tests (they
  compile small, real C programs on the fly via
  tests/ffi/native/harness-executor.ts)
- libpython3.12 (or a compatible libpython3.x.so) - required for the
  Python Bridge's own real tests. If absent, those tests are
  skipped (not failed).
- librav1e.so (any real, pre-compiled Rust shared library exporting
  a C ABI) - required for the Rust Bridge's own real proof-of-concept
  test. If absent, skipped, not failed.
- rustc/cargo: NOT required - the Rust Bridge's own Core API has no
  compile-time dependency on a Rust toolchain.
- A real npm global install of sharp and docx - required for two of
  the JavaScript Bridge's own real tests. If absent, those specific
  assertions will fail (not silently skip) - a real environment
  dependency, disclosed here rather than hidden.

## Build Commands

```bash
cd ur-bridge-v27-final
npm install   # or ensure node_modules/vitest, typescript, tsx are present
npx tsc --noEmit -p tsconfig.json
```

Expected result: exit code 0, no errors.

## Test Commands

Each test file is run individually via this project's own
run-tests.ts harness (not a standard vitest CLI - this project uses
a minimal local shim):

```bash
# Python Bridge
npx tsx run-tests.ts tests/ffi/drivers/python-driver-return-values.test.ts
npx tsx run-tests.ts tests/ffi/drivers/python-driver-native-e2e.test.ts
npx tsx run-tests.ts tests/ffi/drivers/python-driver-marshaling.test.ts
npx tsx run-tests.ts tests/ffi/drivers/python-driver-exceptions.test.ts
npx tsx run-tests.ts tests/ffi/drivers/python-driver-gil.test.ts
npx tsx run-tests.ts tests/ffi/drivers/python-driver-stability.test.ts

# Rust Bridge
npx tsx run-tests.ts tests/ffi/drivers/rust-bridge-mock.test.ts
npx tsx run-tests.ts tests/ffi/drivers/rust-rav1e-proof-of-concept.test.ts

# JavaScript Bridge
npx tsx run-tests.ts tests/ffi/drivers/js-bridge-sharp-proof-of-concept.test.ts
npx tsx run-tests.ts tests/ffi/drivers/js-bridge-generality.test.ts
npx tsx run-tests.ts tests/ffi/drivers/js-bridge-export-patterns.test.ts

# Unrelated sanity check (confirms the harness/environment itself is healthy)
npx tsx run-tests.ts tests/ffi/native/sqlite3-crud.test.ts
```

## Expected Result

Per this session's own actual, attached logs (run-logs/02 through
run-logs/05), with the per-file counts verified by direct addition
against each log's own printed "Tests: N total" line - not estimated:

```
Python Bridge:     5 + 3 + 24 + 9 + 4 + 2 = 47 tests, 0 failed
Rust Bridge:       9 + 3                  = 12 tests, 0 failed
JavaScript Bridge: 4 + 5 + 5               = 14 tests, 0 failed
SQLite3 (sanity):  13                      = 13 tests, 0 failed
-------------------------------------------------------
Total: 47 + 12 + 14 + 13 = 86 tests, 0 failed
```

## Approximate Execution Time

Based on this session's own real, timed run: Python Bridge's own
stability test (python-driver-stability.test.ts) alone runs 11,000
real Python interpreter calls across its own two sub-tests and takes
several seconds by itself; the full suite above completes in
approximately 30-90 seconds total, depending on machine speed and
whether libpython/librav1e/sharp/docx are present (their absence
shortens run time via skips, at the cost of not exercising those
real integrations).

## If a Number Differs From run-logs/

Re-run the specific failing test file with the exact command above
and compare its own real output directly - do not average, round, or
reconcile a discrepancy by editing this document's own numbers
without a fresh, real re-run backing the change.
