# UR-Bridge v27-rc1 — Release Notes

**Release date:** 2026-06-24
**Tests:** 906/906 passing
**TypeScript errors:** 0

---

## What was added

### Phase 6 — Stable ABI + FFI Runtime
- Full C header parser (`parseCHeader`) and ABI type converter (`convertCHeaderToAbi`)
- Itanium C++ ABI layout computation (`computeLayout`, `buildStructType`)
- FFI runtime memory marshaling: `encodeString`, `decodeString`, `marshalStruct`, `unmarshalStruct`
- `FfiCallbackRegistry` and `FfiArena` for native callback and allocation management
- ABI versioning and version constraint checking (`checkAbiCompatibility`)
- UR binding emitter (`emitUrBindings`) and TypeScript declaration emitter (`emitTsDeclarations`)
- Incremental compilation pipeline with content-hash-based caching and dependency tracking

### Phase 6.5 — Hardening Pass
- Fixed stale cache bug: dependency-propagated files now bypass cache correctly
- Fixed `hashContent` producing 32-char output instead of documented 64-char (rewritten with 8-lane FNV-1a + avalanche)
- Fixed timing flake in performance baseline test (median-of-7 sampling)
- Updated STATUS_REPORT and ROADMAP_LOCK with full audit trail

### Phase 7 — C++ Binding Pipeline (RC1, frozen)
**Itanium ABI Mangler** (`src/ffi/bindgen/cpp/itanium-mangle.ts`)
- Verified against real g++ 13.3.0 via `nm` — every fixture is ground truth, not spec-derived
- Supports: namespaces, classes, ctors/dtors (C1/D1), const/static methods, overloads, explicit template instantiation, full substitution compression (S_, S0_, …)
- 3 real bugs found and permanently covered by regression tests

**C++ Header Parser** (`src/ffi/bindgen/cpp/cpp-header-parser.ts`)
- Phase 7 scope: namespaces (full), classes (basic), ctors/dtors, const/static methods, overloads, simple template instantiation
- Gracefully skips private data members (opaque-handle bindings don't need field layout)

**Binding Plan Generator** (`src/ffi/bindgen/cpp/cpp-converter.ts`)
- Public-only filtering, explicit template instantiation, unbound templates reported (never silently dropped)

**Exception Trampoline Generator** (`src/ffi/bindgen/cpp/cpp-exceptions.ts`)
- Catches `std::invalid_argument`, `std::out_of_range`, `std::logic_error`, `std::runtime_error`, `std::exception`, plus `catch(...)` safety net for non-`std::exception` throws (`throw 42;`)
- Catch-order is load-bearing and tested statically + end-to-end
- Destructors intentionally NOT wrapped (implicitly noexcept)

**End-to-end C++ proofs** (real g++, real dlopen/dlsym, zero simulation)
- `cpp-real-native-e2e.test.ts`: Widget class, shapes::Circle, Box<int> — every ctor/dtor/method/static via dlsym by pipeline-generated mangled names
- `cpp-exception-mapping-full-matrix-e2e.test.ts`: 7 exception cases, 35 internal assertions, direct-vs-trampoline comparison

### Phase 7 — SQLite3 Integration + Generic Native FFI Loader
**Generic Native FFI Loader** (`src/ffi/native/`)
- `types.ts`: `NativeArg`, `NativeCallResult`, `NativeCall`, `IPlatformExecutor`, `INativeDriver<T>`, `DiagnosticEvent` — zero Node/platform imports
- `loader.ts`: `NativeFfiLoader` — library cache, ABI version verification (`checkVersionCompatibility`), diagnostic logging, `bind()`, `unloadAll()`. Fixed: 2-component version strings like `"1.3"` (zlib) now parse correctly
- `platform-executors.ts`: `LinuxExecutorStub`, `MacOsExecutorStub`, `WindowsExecutorStub`, `WasmExecutorStub`, `detectPlatform()`
- `driver-registry.ts`: Generic `DriverRegistry` with `CapabilityFlag` system, `VersionPolicy`, `register()`, `find()`, `findByCapability()`, `checkVersionPolicy()`

**C parser fix** — `parseTypeRef()` rewritten as a proper specifier-collection loop
- Previously: single-token parser — `long long`, `unsigned long`, `const void*` silently dropped
- Now: handles all standard C type specifier combinations in any order
- Regression: `long long` was blocking SQLite3's `sqlite3_bind_int64`, `sqlite3_column_int64`, `sqlite3_last_insert_rowid`
- 15 regression tests covering valid combos + 3 invalid rejections

**SQLite3 Integration**
- Real C adapter (`sqlite3_adapter.c`) flattening `**ppDb`/`**ppStmt` double-pointer out-params
- `HarnessExecutor` (tests/) — real gcc C harness for actual native calls
- `Sqlite3Driver` (tests/) — typed `INativeDriver<Sqlite3Api>`, 27 symbols
- CRUD verification ladder: 13 end-to-end tests, 0 simulation
  - Version/ABI verification, open, CREATE TABLE, INSERT, SELECT, UPDATE, DELETE
  - Error paths (invalid SQL, NOT NULL violation, READONLY open)
  - NULL values, UTF-8 (Arabic/Japanese/emoji), transactions/ROLLBACK, resource cleanup

**urpm scaffold**: `cmdCreateProject("قاعدة_بيانات", "database")` — database/vision/inference/robotics templates

**Genericity proof**: `libz 1.3` bound using the same generic loader with zero changes to the loader

### Phase 7.5 — Platform SDK
**Platform SDK** (`src/platform-sdk/index.ts`)
- `PlatformSDK` — single abstraction layer above `DriverRegistry` and `NativeFfiLoader`
- `bindByCapability(group, libraryPath)` — library-name-free driver resolution
- `bindById(driverId, libraryPath)` and `bindDriver(driver)` for direct access
- `query()`, `canHandle()`, `hasCapability()` — driver discovery without library coupling
- `NativeResourceManager` — centralized handle tracking, leak detection, `releaseAll()`
- Unified error hierarchy: `NativeError` → `DatabaseError`, `VisionError`, `InferenceError`, …
- CapabilityGroup routing (database/vision/inference/robotics/compression/networking/cryptography)

**DriverRegistry enhancements**
- `CapabilityFlag` system (35 flags across all library categories)
- `VersionPolicy`: `any`, `exact`, `minimum`, `range`
- `findByCapability()`, `findByCapabilityGroup()`, `supports()`
- `_resetForTests()` for clean test isolation

**Architecture Tests** (`tests/platform/architecture-rules.test.ts`)
- Statically enforce: no library-specific imports in generic layer, no circular dependencies, no SQLite/OpenCV symbol names in Platform SDK, `DriverRegistry.register()` is the only registration method, `types.ts` has zero imports

**Driver stubs registered**: OpenCV stub, ONNX Runtime stub, ROS2 stub (all deferred pending real libraries/headers)

---

## What was fixed (regression-covered)

| Bug | Impact | Fix | Test |
|---|---|---|---|
| Incremental cache served stale artifacts for dependency-propagated files | Silent wrong output | Cache bypass for propagated files | `tests/regression/dependency-cache-staleness.test.ts` |
| `hashContent` returned 32 chars instead of 64 | Hash collisions possible | 8-lane FNV-1a + avalanche | `tests/regression/fingerprint-hash-length.test.ts` |
| Itanium mangler: ctor/dtor tokens length-prefixed as identifiers | Wrong mangled names | Emit raw `C1`/`D1` tokens | `tests/ffi/cpp/itanium-mangle.test.ts` |
| Itanium mangler: multi-component named param types missing `N...E` | Wrong mangled names | Add nested-name wrapper | Same |
| Itanium mangler: function name incorrectly registered as substitution prefix | Wrong substitution indices | Skip function name registration | Same — 3-reference deep test case |
| C header parser: `long long` / `unsigned long` / `const void*` dropped | Broke SQLite3 binding entirely | Specifier-collection loop | `tests/ffi/bindgen.test.ts` — 15 cases |
| C parser: `const T*` where T is a typedef failed with the new parser | Parse error on valid C | Handle `kw_void` in collection loop | Same — OpenCV test restored |
| Exception mapping: no `catch(...)` safety net for non-std::exception throws | `throw 42;` would crash process | Added `UR_UNKNOWN_THROWN_VALUE` | `tests/ffi/cpp/cpp-exception-mapping-full-matrix-e2e.test.ts` |
| `checkVersionCompatibility`: 2-component version strings like `"1.3"` unparseable | zlib compatibility check failed | Patch defaults to 0 | `tests/ffi/native/loader.test.ts` |

---

## What is deferred (explicitly documented, not omitted)

| Feature | Status | Reason |
|---|---|---|
| End-to-end UR Source → FFI → SQLite3 | Deferred | UR Frontend (lexer/parser/semantic/types/module) not in this project slice |
| OpenCV, ONNX Runtime, ROS2 full integration | Stubs only | Library headers not available in current environment |
| Rust FFI bridge | Architecture only | No `rustc` in current environment |
| urpm build-from-source (CMake/Meson/Ninja) | Deferred | Out of scope for this RC |
| Multiple/single inheritance in C++ bindgen | Deferred | Requires `this`-pointer adjustment thunks |

---

## Frozen APIs (changes require regression test + doc update)

- `NativeArg` / `NativeCallResult` / `NativeCall` shape
- `IPlatformExecutor` interface
- `INativeDriver<T>` interface
- `NativeFfiLoader` public methods
- `DriverRegistry.register()` signature and `CapabilityFlag` enum
- `checkVersionCompatibility` version compatibility policy
- Itanium mangling API (`itaniumMangle`, `CppType`, `CppFunctionToMangle`)
- Exception mapping API (`UrErrorCode` values, catch-clause order, trampoline calling convention)
- `PlatformSDK` public methods

---

## Known limitations

- `HarnessExecutor` spawns a new gcc process per `execute()` call — adequate for testing, not for production. Production execution will use in-process native calls or the UR runtime's own code-generation path.
- `Sqlite3Driver.open()` / `prepare()` require the C adapter (`sqlite3_adapter.c`) to be compiled alongside test code.
- The Platform SDK's `bindByCapability` uses first-match rather than priority-based driver selection. Priority ordering is a planned enhancement.
