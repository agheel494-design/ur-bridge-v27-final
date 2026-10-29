// ─────────────────────────────────────────────────────────────────────────────
// UR Optimizer — Pass Framework
// Level 2.9, OPTIMIZER_SPEC.md §2 (ratified)
// ─────────────────────────────────────────────────────────────────────────────
//
// This is the FIRST and ONLY item from OPTIMIZER_SPEC.md §2.1's fixed
// pipeline implemented in this batch, per the review-mandated
// "one pipeline item per development batch" execution rule (see the
// spec's header). No Dominator Tree, no Control Flow Analysis, no
// Dataflow Framework, and no actual optimization pass (Constant
// Folding / Dead Code Elimination / Copy Propagation) exist yet.
//
// This file provides exactly:
//   1. The OptimizationPass interface (§2).
//   2. runPipeline() — the driver, running checkModuleInvariants-
//      equivalent structural validation after every pass (§2, §2.1).
//   3. validateFunction() — a per-function wrapper around the existing,
//      UNMODIFIED checkModuleInvariants() (src/shared/ir.ts), per the
//      explicit instruction to never extend that function itself.
//
// With zero passes registered, runPipeline() is a correctly-behaving
// no-op: it returns the input function unchanged, after confirming it
// was already structurally valid — proving the framework itself
// introduces no behavior change before any real pass is ever added
// (OPTIMIZER_SPEC.md §8).

import type { IRFunction, IRModule, IRInvariantViolation, IRBasicBlock, IRLocalSlot } from "../shared/ir.js";
import { checkModuleInvariants } from "../shared/ir.js";
import { RUNTIME_CORE_EXTERNS } from "../shared/runtime-table.js";

/**
 * A single optimization pass — OPTIMIZER_SPEC.md §2.
 *
 * Per §2.2's Pass Contract: `run()` must accept a structurally valid
 * `IRFunction` and return a structurally valid `IRFunction` (the driver
 * enforces this by validating both before and after every pass — a
 * pass does not need to self-validate, though it may for its own
 * early-exit diagnostics).
 *
 * Per §2.3 (Pass Independence): a pass must never reach into another
 * pass's internal state. The only inputs a pass may use are its own
 * `fn` parameter and, once they exist in a later batch, published
 * analysis-result interfaces (`DominatorTree`, `LoopInfo`, dataflow
 * fact maps) obtained by calling that analysis's own entry point —
 * never a previous pass's private fields or closures.
 */
export interface OptimizationPass {
  readonly name: string;
  run(fn: IRFunction): IRFunction;
}

/**
 * Validates a single IRFunction using the existing, UNMODIFIED
 * checkModuleInvariants() (src/shared/ir.ts) — per the standing
 * architectural note (FREEZE_LOG.md, Level 2.6 tag): "do not extend
 * checkModuleInvariants() itself... create separate, independent
 * modules." This function does not add any new check; it only adapts
 * the existing MODULE-level check to a single-FUNCTION call site, by
 * wrapping the function in a minimal, throwaway IRModule that reuses
 * the real RUNTIME_CORE_EXTERNS table (so the module-level Runtime
 * lifecycle check — exactly one init, exactly one shutdown — always
 * passes trivially and never produces a false positive unrelated to
 * the function actually being validated).
 */
// Memoization cache for validateFunction's sibling-stub list, keyed by
// the `siblingFunctions` array's own object identity — every real call
// site passes the SAME array reference for every function within one
// module's own optimization run (e.g. `ir.value.functions`, unchanged
// across the whole loop), so this correctly builds the stub list ONCE
// per module, not once per function. A WeakMap (not a plain Map) is used
// so a module's own array can be garbage-collected normally once the
// caller is done with it — this cache never accumulates state across
// unrelated compilations.
const siblingStubCache = new WeakMap<readonly IRFunction[], readonly IRFunction[]>();

function getOrBuildSiblingStubs(siblingFunctions: readonly IRFunction[]): readonly IRFunction[] {
  const cached = siblingStubCache.get(siblingFunctions);
  if (cached) return cached;
  const stubs = siblingFunctions.map(f => ({
    qualifiedName: f.qualifiedName,
    sourceName: f.sourceName,
    params: f.params,
    returnType: f.returnType,
    blocks: [] as readonly IRBasicBlock[],
    entryBlock: -1,
    location: f.location,
    locals: [] as readonly IRLocalSlot[],
  }));
  siblingStubCache.set(siblingFunctions, stubs);
  return stubs;
}
export function validateFunction(fn: IRFunction, siblingFunctions: readonly IRFunction[] = []): IRInvariantViolation[] {
  // CONFIRMED BUG (fixed): an earlier version wrapped ONLY `fn` in the
  // synthetic module, meaning a call to a SIBLING function in the same
  // real module was incorrectly flagged as unresolved — checkModuleInvariants'
  // call-resolution check has no way to know about functions outside
  // the module it's given. Found via a real multi-function program
  // (main calling double(); main calling a recursive fact()) — every
  // prior test happened to use single-function or purely-self-recursive
  // programs, so this gap was never exercised until now. Fixed by
  // accepting the full sibling-function list from the real module;
  // defaulting to `[]` preserves the exact previous behavior (and
  // every existing call site/test) for genuinely single-function
  // validation.
  //
  // PERFORMANCE FIX (Compiler & Runtime Stabilization phase — found via
  // direct profiling, not guessed): the ABOVE fix, as originally
  // written, passed each sibling's FULL real body (every block and
  // instruction) into checkModuleInvariants' wrapper module —
  // checkModuleInvariants' own per-function loop then did FULL
  // structural re-validation (block-id/defined-id/type tracking, every
  // instruction) on EVERY sibling, EVERY time ANY function in the
  // module was validated. For a real, medium program (200 functions),
  // runPipeline calls validateFunction 3 times per function (once
  // before + once after each of 2 passes) = 600 calls, each RE-
  // VALIDATING all ~200 siblings' full bodies — confirmed directly via
  // profiling to be 92.9% of total (lex+parse+typecheck+lower+optimize+
  // emit) compile time for that program (1832ms of 1973ms total).
  //
  // Confirmed directly (see the call-resolution check's own code,
  // `module.functions.some(f => f.qualifiedName === inst.callee)`):
  // call resolution needs ONLY each sibling's `qualifiedName` — never
  // its blocks/instructions. Fix: siblings are now represented as
  // lightweight STUBS (real qualifiedName/sourceName/params/returnType,
  // but an EMPTY `blocks` array) — checkModuleInvariants' expensive
  // per-instruction loop does effectively zero work for each stub
  // (nothing to iterate), while call resolution against `fn`'s own
  // calls to any sibling still works correctly (name-based lookup is
  // unaffected by the sibling's body being stubbed out). `fn` ITSELF is
  // always passed with its real, full body — only siblings are
  // stubbed, so this function's own violations are still fully and
  // correctly detected.
  // SECOND PERFORMANCE FIX (found via the reviewer's own explicit
  // request to benchmark multiple sizes, not just one — this is exactly
  // why that request mattered): even with siblings stubbed (empty
  // blocks), the `.filter(...).map(...)` above was STILL O(n) work done
  // on EVERY validateFunction call — for a real module, this alone is
  // O(n²) total (n calls × O(n) filter/map each), just shifted from the
  // expensive structural-validation cost to a cheaper-but-still-
  // quadratic array-rebuilding cost. Invisible in the original 200-
  // function benchmark (200² is small) but confirmed directly at scale:
  // 5000 functions took 7.95ms/function (39.75s total) versus 0.7-1.5ms/
  // function at smaller sizes — clear continued superlinear growth, not
  // the near-constant per-function cost a correctly-fixed version should
  // show. Fixed: the stub list is now memoized (WeakMap, keyed by the
  // `siblingFunctions` array's own object identity) — built ONCE per
  // distinct array, reused across every subsequent call for the same
  // module. The stub list also intentionally includes a stub for `fn`
  // itself now (no longer filtered out per-call, since no duplicate-
  // qualifiedName check exists anywhere in checkModuleInvariants — a
  // harmless redundant stub entry costs nothing and lets the cache stay
  // ONE array shared across every function's own validateFunction call,
  // not one per fn).
  // show. Fixed: the EXPENSIVE part (mapping every real sibling into a
  // lightweight stub object) is now memoized (WeakMap, keyed by the
  // `siblingFunctions` array's own object identity) — built ONCE per
  // distinct array, reused across every subsequent call for the same
  // module. `fn`'s own stub is still excluded per call via `.filter()`
  // — a REAL bug was found directly by testing this exact fix at scale:
  // including a redundant self-stub alongside the real `fn` caused
  // checkModuleInvariants to see the stub's own empty-blocks/entryBlock
  // -1 shape and misattribute an "entryBlock does not exist" violation
  // to `fn` (both share the same `sourceName`, and the final filter
  // matches by name, not object identity) — confirmed directly:
  // `OptimizerValidationError: [f0] entryBlock -1 does not exist` on
  // perfectly valid input. This per-call `.filter()` is CHEAP now
  // (comparing already-built, tiny stub objects — no repeated object
  // construction), unlike the original per-call `.filter().map()` which
  // rebuilt full stub objects from scratch every time.
  const siblingStubs = getOrBuildSiblingStubs(siblingFunctions).filter(f => f.qualifiedName !== fn.qualifiedName);
  const wrapperModule: IRModule = {
    moduleName: `__optimizer_validation__${fn.qualifiedName}`,
    externs: RUNTIME_CORE_EXTERNS,
    functions: [fn, ...siblingStubs],
  };
  // Only report violations belonging to `fn` itself — sibling functions
  // are included solely to make call-resolution correct; they are not
  // what this call is meant to validate (a caller validating each
  // function in a loop will separately validate every sibling too, at
  // which point THAT sibling is the one passed with its own real body).
  return checkModuleInvariants(wrapperModule).filter(v => v.functionName === fn.sourceName);
}

/** Thrown by runPipeline() if a pass produces (or is given) invalid IR — never silently ignored. */
export class OptimizerValidationError extends Error {
  constructor(
    public readonly passName: string,
    public readonly stage: "before" | "after",
    public readonly violations: IRInvariantViolation[],
  ) {
    super(
      `Optimizer pass '${passName}' ${stage === "before" ? "received" : "produced"} invalid IR:\n` +
      violations.map(v => `  - [${v.functionName}] ${v.message}`).join("\n"),
    );
    this.name = "OptimizerValidationError";
  }
}

/**
 * Runs a sequence of passes over one IRFunction, in order — the driver
 * described in OPTIMIZER_SPEC.md §2 and §2.1's fixed pipeline shape.
 *
 * Structural validation runs both BEFORE and AFTER every single pass
 * (not just once at the end), so a broken pass is caught immediately at
 * its own boundary — never misattributed to a later, innocent pass.
 *
 * With `passes = []` (the only configuration this batch ships), this
 * is a correctly-behaving no-op: the input is validated once and
 * returned unchanged.
 */
export function runPipeline(fn: IRFunction, passes: readonly OptimizationPass[], siblingFunctions: readonly IRFunction[] = []): IRFunction {
  const initialViolations = validateFunction(fn, siblingFunctions);
  if (initialViolations.length > 0) {
    throw new OptimizerValidationError("<pipeline input>", "before", initialViolations);
  }

  let current = fn;
  for (const pass of passes) {
    const next = pass.run(current);
    const violations = validateFunction(next, siblingFunctions);
    if (violations.length > 0) {
      throw new OptimizerValidationError(pass.name, "after", violations);
    }
    current = next;
  }
  return current;
}
