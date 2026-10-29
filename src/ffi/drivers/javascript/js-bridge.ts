// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — FFI Drivers: JavaScript (Runtime Bridge)
// FFI Multi-Language Bridges — JavaScript, Core API v1.0 (partial)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per the adopted architectural classification (see
// docs/architecture/JS_BRIDGE_ARCHITECTURE.md):
//
//   Core Bridge
//   |-- Native Bridge (C, Rust, Python) - dlopen()/dlsym(), in-process
//   `-- Runtime Bridge (JavaScript/Node) - delegates to a real,
//       live Node child process; that process does require() + a
//       real function call natively, with no dlopen step of its own
//
// Same Core API SHAPE as the Native Bridge (call()/callBatch(), a
// unified outcome type) - the public contract stays consistent.
// Only the internal execution mechanism differs: this driver depends
// on an IJsRuntimeExecutor-shaped engine (see
// tests/ffi/native/js-runtime-executor.ts for the real
// implementation, which spawns a genuine Node child process) - it
// does not touch NativeFfiLoader/HarnessExecutor at all.
//
// withResource() IS DELIBERATELY NOT IMPLEMENTED IN THIS ROUND -
// disclosed honestly, not silently skipped: an initial draft called
// use(createdValue) from TypeScript and then ran the use-calls in a
// SEPARATE real Node child process from the one that created the
// value - the created JS value cannot survive across two separate
// process invocations (it is not a raw pointer like the Native
// Bridge's own ptr values; a real, complex JS object cannot
// round-trip through JSON). This is the same class of real
// architectural mistake already caught and fixed for the Rust
// Bridge's own withResource() - caught here BEFORE saving/testing,
// not shipped and found by a failing test. A correct
// create-use-free-in-one-process implementation needs the create
// and use calls encoded into the SAME generated script (referencing
// the created value by a real in-script variable, not passed back
// through TypeScript) - a real, larger design task, deferred rather
// than shipped half-correct. Neither of this round's own proof
// targets (sharp.format, sharp.cache()) needs create/free at all, so
// this is not blocking real progress.
//
// Async/Callbacks remain Bridge Extensions (v2, Draft) - not
// implemented here. This Core API is synchronous.
// ─────────────────────────────────────────────────────────────────────────────

export type JsFunctionCallSpec = {
  moduleSpecifier: string;
  propertyPath: string[];
  args: unknown[];
};

export type JsCallOutcome<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** The minimal shape this driver depends on - satisfied by JsRuntimeExecutor, kept abstract here so src/ has no child_process/fs dependency. */
export interface IJsRuntimeExecutor {
  execute(calls: JsFunctionCallSpec[]): Array<{ kind: "value"; value: unknown } | { kind: "error"; message: string }>;
}

export type JsBridgeApi = {
  /** Calls (or reads) a single, named JS value/function generically, via a real Node child process. */
  call(spec: JsFunctionCallSpec): JsCallOutcome;

  /** Calls a batch of specs in one real Node child process invocation - the correct way to run several related calls together. */
  callBatch(specs: JsFunctionCallSpec[]): JsCallOutcome<unknown[]>;
};

export class JsBridgeDriver {
  constructor(private readonly executor: IJsRuntimeExecutor) {}

  bind(): JsBridgeApi {
    const executor = this.executor;
    return {
      call: (spec) => {
        const result = executor.execute([spec])[0]!;
        if (result.kind === "error") return { ok: false, error: result.message };
        return { ok: true, value: result.value };
      },

      callBatch: (specs) => {
        const results = executor.execute(specs);
        const firstError = results.find((r) => r.kind === "error");
        if (firstError && firstError.kind === "error") return { ok: false, error: firstError.message };
        return { ok: true, value: results.map((r) => (r as { kind: "value"; value: unknown }).value) };
      },
    };
  }
}
