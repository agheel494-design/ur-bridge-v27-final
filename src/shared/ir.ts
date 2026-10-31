// ─────────────────────────────────────────────────────────────────────────────
// UR — Intermediate Representation (SSA)
// Level 2 — Phase 2.1
// ─────────────────────────────────────────────────────────────────────────────
//
// SCOPE (per approved Level 2 execution plan): this IR supports exactly
// what the first end-to-end proof needs — variables, arithmetic, function
// calls, return — and nothing more. Deliberately NOT included in this
// phase: control flow (if/while/for → branches + phi nodes), structs,
// arrays, FFI calls, modules/imports. These will extend this IR in later
// phases WITHOUT redesigning it — the instruction/terminator shape below
// is deliberately open (discriminated unions) so new variants slot in
// alongside existing ones.
//
// Why SSA: every value is defined exactly once (each instruction produces
// a fresh virtual register, referenced by a monotonically increasing id).
// Reassignment (`x = expr`) does not mutate a register — it rebinds which
// register the *name* `x` currently refers to in the lowering pass's local
// environment (see src/compiler/codegen/lower-to-ir.ts). This is the
// standard SSA construction technique and is what makes optimizations
// (constant folding, dead code elimination) and future control flow
// (phi nodes at block-join points) straightforward to add later without
// redesigning this IR.
//
// This phase is intentionally single-basic-block only: since control flow
// is out of scope, every function lowers to exactly one basic block ending
// in a single terminator (return / return_void). The `blocks: IRBasicBlock[]`
// array and `entryBlock` field already model the general multi-block case
// so that introducing branches later is an additive change to the lowering
// pass, not a change to this file.
// ─────────────────────────────────────────────────────────────────────────────

import type { SourceLocation } from "../shared/locations.js";

// ── Types ─────────────────────────────────────────────────────────────────────
//
// Deliberately small: exactly the UR 1.0 tier-1 types this phase's scope
// touches (int, bool). Float/string/void are included since they're part
// of UR 1.0's type system and cost nothing to model now, but only
// int/bool/void are exercised by this phase's tests (arithmetic + return).

export type IRType = "i64" | "f64" | "bool" | "string" | "void" | "ptr" | "array_ref";
// "ptr": Native Pointer ABI Gate B (authorized, narrow scope) - an
// opaque foreign-pointer handle crossing the Native FFI boundary only.
// Represented as an unsigned 64-bit address (carried as a bigint, same
// representation already used for exact-integer i64 values elsewhere in
// this interpreter) - never dereferenced, never arithmetic'd, by this
// compiler or interpreter. See types.ts's own T_NATIVE_PTR comment for
// the full scope boundary.

// ── SSA values ────────────────────────────────────────────────────────────────

/** A reference to a previously-defined SSA value (an instruction's or parameter's id). */
export type IRValueRef = {
  readonly id: number;
  /**
   * Struct-by-value argument support (per LANGUAGE_SYNTAX_1_1_SPEC.md
   * §2.5's own ratified "Parameter passing: BY VALUE" requirement):
   * present iff this value ref represents an EXISTING struct
   * variable's own slot passed whole (e.g. `useIt(p)`), rather than a
   * plain scalar SSA value. `id` is unused/ignored when this is set —
   * kept only so every existing consumer of IRValueRef that reads
   * `.id` continues to compile unchanged; Backends check `structSlot`
   * FIRST and use the slot's own name/layout when present.
   */
  readonly structSlot?: number;
  /**
   * Array-by-reference argument support (Priority 3 Stabilization
   * Sprint): present iff this value ref represents an EXISTING array
   * variable's own slot passed whole (e.g. `sumArr(a)`), matching the
   * SAME real pattern as `structSlot` above (a compound, storage-
   * backed type passed to another function). Kept as a separate field
   * from `structSlot` deliberately - unifying the two into one general
   * "does this ref refer to a storage-backed slot" concept remains a
   * real, ratified future design direction (per the Priority 3
   * design's own §2), not something decided or forced during this
   * implementation.
   */
  readonly arraySlot?: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

export type IRConstant =
  | { readonly kind: "const_int"; readonly value: bigint }
  | { readonly kind: "const_float"; readonly value: number }
  | { readonly kind: "const_bool"; readonly value: boolean }
  | { readonly kind: "const_string"; readonly value: string };

// ── Operators ─────────────────────────────────────────────────────────────────

export type IRBinOp =
  | "add" | "sub" | "mul" | "div" | "mod"
  | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
  | "and" | "or";

export type IRUnOp = "neg" | "not";

// ── Instructions ──────────────────────────────────────────────────────────────
//
// Every instruction defines exactly one new SSA value, identified by `id`.
// `id`s are unique within a function and monotonically increasing in
// definition order (enforced by the IRBuilder, not by this type itself).

// ── Local slots (Level 2.6.1) ───────────────────────────────────────────────
//
// A named, mutable local storage location within a function — NOT an SSA
// value. Introduced specifically to represent UR `let`/reassignable
// variables that survive a CFG merge point (e.g. a loop-carried variable
// read at a loop header) WITHOUT phi nodes — see CFG_SPEC.md §1 for the
// full rationale. `load` reads a slot's current value into a fresh SSA
// id; `store` writes an SSA value into a slot and produces no SSA id of
// its own (matching how a void-typed `call` already produces no result
// value that needs to be used).
//
// This is deliberately NOT a redesign of SSA: every value flowing through
// arithmetic/calls/etc. remains exactly as single-assignment as before
// this phase. Only the storage for a subset of local variables gains an
// explicit load/store indirection. A future Optimizer phase may promote
// provably-single-definition slots back to pure SSA (a classic
// "mem2reg"-style pass) — Level 2.6 does not require that pass to exist.

export type IRLocalSlot = {
  readonly id: number;      // unique within the function; a SEPARATE id space from SSA value ids
  readonly name: string;    // original UR variable name, for debug symbols
  readonly type: IRType;
  /** Level 2.8: for a fixed-size array slot, the element count (>1). undefined/1 means an ordinary scalar slot (Level 2.6 behavior, unchanged) UNLESS isArray is explicitly true (see below). */
  readonly length?: number;
  /**
   * Priority 3 Stabilization Sprint: present iff this slot represents
   * an ARRAY PARAMETER (e.g. `function f(a: int[])`), as opposed to a
   * fixed-size array LOCAL (`let a = [1,2,3]`, using `isArray`+`length`
   * above, completely unchanged). A real, precise distinction: a
   * parameter's own real array has no compile-time-known length (`int[]`
   * carries no fixed size) and is passed by reference (matching real C
   * array-parameter semantics, which itself decays to a pointer) -
   * requiring a real pointer declaration (`int64_t* name;`), not a
   * fixed-size array declaration (`int64_t name[N];`, which cannot be
   * assigned a pointer value in real C). Mutually exclusive with
   * `isArray`+`length` in practice (a slot is either a fixed-size
   * local or a pointer-backed parameter, never both).
   */
  readonly isArrayParam?: boolean;
  /**
   * Gate 2R Remediation (per direct instruction): present iff this
   * slot holds the result of an Array-returning function call
   * (populated via resultArraySlot, not a direct array literal). Its
   * length is a genuine runtime-only value (the callee decides how
   * many elements it returns) — unlike a literal's `length`, which is
   * always known at compile time from the element count written in
   * source. Consumers that gate on "is this really an array slot"
   * (e.g. IndexExpression's own array-vs-scalar check) must accept
   * this marker exactly as they already accept `length`/`isArrayParam`.
   */
  readonly isArrayResult?: boolean;
  /**
   * ADR-005 (Array Object as source of truth for Length): present iff
   * this is an array-PARAMETER slot (`isArrayParam === true`) whose
   * real bounds-check length is a RUNTIME value (a real companion C
   * parameter), not a compile-time literal. Holds the real C
   * identifier name of that companion length parameter — e.g.
   * `"p_a_length"`. This is the SOLE source of truth for such a
   * slot's own bounds-check length; `length` (above) remains
   * undefined for array-parameter slots and must never be treated as
   * a fallback or Sentinel.
   */
  readonly runtimeLengthCName?: string;
  /**
   * FIX (per issues/level-2.8-single-element-array-c-backend-bug.md):
   * explicitly disambiguates a genuine one-element array (length === 1)
   * from an ordinary scalar slot — the two were previously indistinguishable,
   * since "undefined/1 means scalar" (see the `length` comment above) was
   * the ONLY signal every consumer (C Backend declaration emission, WASM
   * Backend's scalar/array local partitioning, this file's own invariant
   * checker) used to decide "is this an array." Lowering now sets this
   * explicitly to `true` for every array slot it creates, regardless of
   * length — consumers should prefer checking `isArray === true` over
   * inferring array-ness from `length > 1` alone. Undefined/false means
   * an ordinary scalar, matching all pre-existing behavior unchanged.
   */
  readonly isArray?: boolean;
  /**
   * Level 2.8 (Struct IR support, per STRUCT_IR_DESIGN.md/
   * STRUCT_MEMORY_LAYOUT.md): present iff this slot holds a struct
   * value. The layout is always computed by the single, shared
   * StructLayoutCalculator (src/compiler/typesystem/struct-layout-
   * calculator.ts) — this file only defines the SHAPE of that
   * result, not the computation itself, to avoid a circular import
   * (the Calculator imports IRType from this file).
   */
  readonly structLayout?: StructLayoutResult;
};

/** Per STRUCT_MEMORY_LAYOUT.md §5/§9 — computed once by the single, shared StructLayoutCalculator, consumed identically by TypeChecker, Lowering, and both Backends. */
export type StructLayoutField = {
  readonly name: string;
  readonly type: IRType;
  /** Present iff this field's own type is itself a struct (nested, inline — see STRUCT_ABI_SPEC.md §8). */
  readonly nestedLayout?: StructLayoutResult;
  readonly offset: number;
};

export type StructLayoutResult = {
  readonly structName: string;
  readonly fields: readonly StructLayoutField[];
  readonly size: number;
  readonly alignment: number;
};

export type IRInstruction =
  | {
      readonly kind: "param";
      readonly id: number;
      readonly type: IRType;
      readonly index: number;
      readonly name: string; // original UR parameter name, for debug symbols
      readonly location: SourceLocation;
    }
  | {
      readonly kind: "const";
      readonly id: number;
      readonly type: IRType;
      readonly value: IRConstant;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: "binop";
      readonly id: number;
      readonly type: IRType;
      readonly op: IRBinOp;
      readonly left: IRValueRef;
      readonly right: IRValueRef;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: "unop";
      readonly id: number;
      readonly type: IRType;
      readonly op: IRUnOp;
      readonly operand: IRValueRef;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: "int_to_float";
      readonly id: number;
      readonly type: "f64";
      readonly operand: IRValueRef;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: "call";
      readonly id: number;
      readonly type: IRType;
      /** Qualified callee name (see src/shared/symbols.ts's qualifiedName). */
      readonly callee: string;
      readonly args: readonly IRValueRef[];
      readonly location: SourceLocation;
      /**
       * Struct-return support (Priority 2, ratified Solution A — the
       * callee genuinely returns the struct by value, matching C's
       * own native semantics, the SAME real philosophy already used
       * for struct-by-value parameters via IRValueRef.structSlot):
       * present iff the callee's own real return type is a struct.
       * `id` is unused/ignored when this is set (kept only so every
       * existing consumer that reads `.id` continues to compile
       * unchanged) — the real result lives in this slot, allocated by
       * the CALLER exactly as a direct struct-constructor call would
       * be (see IRBuilder.lowerStructConstruction), not filled via a
       * separate copy step.
       */
      readonly resultStructSlot?: number;
      /**
       * Gate 2R Remediation (per direct instruction): the exact same
       * mechanism as resultStructSlot immediately above, for a call
       * whose declared return type is an Array instead of a Struct.
       * `id` is likewise unused/ignored when this is set — the real
       * array lives in this slot, allocated by the caller exactly as
       * a direct array literal would be (see IRBuilder.lowerArrayLiteral).
       */
      readonly resultArraySlot?: number;
    }
  | {
      /** Reads a local slot's current value into a fresh SSA id. */
      readonly kind: "load";
      readonly id: number;
      readonly type: IRType;
      readonly slot: number;
      readonly location: SourceLocation;
    }
  | {
      /** Writes an SSA value into a local slot. Produces no SSA id — analogous to a void-typed call. */
      readonly kind: "store";
      readonly slot: number;
      readonly value: IRValueRef;
      readonly location: SourceLocation;
    }
  | {
      /** Level 2.8: reads one element of an array slot at a runtime-computed index. Bounds-checked by the Backend (never by an explicit IR-level branch — keeps the IR itself simple, per review). */
      readonly kind: "array_load";
      readonly id: number;
      readonly type: IRType;
      readonly slot: number;
      readonly index: IRValueRef;
      readonly location: SourceLocation;
      /**
       * v29-D4 (Nested Array Model, first vertical slice): when present,
       * the base address is NOT `slot` (a fixed local) — it is obtained
       * by evaluating this reference instead, which is itself the
       * MATERIALIZED result of a prior array_load (per the ratified
       * Nested Array Reference Representation Contract: outer[i]
       * yields a reference — a base address only, never a copy of the
       * inner array's own length — which THIS field then feeds into a
       * second, ordinary array_load as its own base). `slot` is set to
       * -1 (a sentinel, matching the existing arraySlot-reference
       * convention already used elsewhere in this IR) whenever
       * `baseRef` is present, so every EXISTING consumer of `slot`
       * that has not been updated for this case fails loudly (an
       * invalid slot id) rather than silently misreading a fixed
       * local that was never the real base. Absent (undefined) for
       * every depth-1 array_load — byte-for-byte unchanged behavior.
       */
      readonly baseRef?: IRValueRef;
    }
  | {
      /**
       * Stage 6C (per direct instruction, Option C): reads an array
       * slot's TRUE RUNTIME element count into a fresh SSA id, as a
       * real int value usable in subsequent instructions (e.g. a
       * for-loop's own desugared bound check). Deliberately reads only
       * the real runtime array's own length at the moment this
       * instruction executes — never IRLocal.length or any other
       * compile-time-known metadata — so it produces the identical,
       * correct value regardless of whether the array slot was
       * populated by a direct literal or by a function call's return
       * value (resultArraySlot, per Gate 2R).
       */
      readonly kind: "array_length";
      readonly id: number;
      readonly type: IRType;
      readonly slot: number;
      readonly location: SourceLocation;
      /** v29-D4: same baseRef convention as array_load above — reads
       *  the runtime length of the array referenced by baseRef's own
       *  materialized value, not of any fixed local slot, when present. */
      readonly baseRef?: IRValueRef;
    }
  | {
      /** Level 2.8: writes one element of an array slot at a runtime-computed index. Bounds-checked by the Backend. Produces no SSA id. */
      readonly kind: "array_store";
      readonly slot: number;
      readonly index: IRValueRef;
      readonly value: IRValueRef;
      readonly location: SourceLocation;
      /** v29-D4: same baseRef convention as array_load above. */
      readonly baseRef?: IRValueRef;
    }
  | {
      /**
       * Struct IR support (per STRUCT_IR_DESIGN.md §3.2): reads one
       * field of a struct-typed slot. `fieldIndex` (not a runtime
       * IRValueRef, unlike array_load's `index`) is always a
       * statically-known position into the slot's own
       * `structLayout.fields` — struct field access is never
       * dynamically indexed, so no bounds check is needed (unlike
       * array_load, which the Backend bounds-checks against a
       * runtime index).
       */
      readonly kind: "field_load";
      readonly id: number;
      readonly type: IRType;
      readonly slot: number;
      readonly fieldIndex: number;
      readonly location: SourceLocation;
    }
  | {
      /** Struct IR support: writes one field of a struct-typed slot. Produces no SSA id, matching array_store's own shape. */
      readonly kind: "field_store";
      readonly slot: number;
      readonly fieldIndex: number;
      readonly value: IRValueRef;
      readonly location: SourceLocation;
    };

// ── Terminators ───────────────────────────────────────────────────────────────
//
// Every basic block ends in exactly one terminator. This phase only
// produces `return`/`return_void` (single-block functions). `branch` and
// `cond_branch` are declared now (matching the SSA design the reviewer
// specified) so control-flow lowering in a later phase is additive.

export type IRTerminator =
  | { readonly kind: "return"; readonly value: IRValueRef; readonly location: SourceLocation }
  | { readonly kind: "return_void"; readonly location: SourceLocation }
  | { readonly kind: "branch"; readonly target: number; readonly location: SourceLocation }
  | {
      readonly kind: "cond_branch";
      readonly condition: IRValueRef;
      readonly thenTarget: number;
      readonly elseTarget: number;
      readonly location: SourceLocation;
    };

// ── Basic blocks and functions ─────────────────────────────────────────────────

export type IRBasicBlock = {
  readonly id: number;
  readonly label: string;
  readonly instructions: readonly IRInstruction[];
  readonly terminator: IRTerminator;
};

export type IRParam = {
  readonly name: string;
  readonly type: IRType;
  /** Present iff this parameter is struct-typed - lets the Backend emit a real by-value struct parameter (per LANGUAGE_SYNTAX_1_1_SPEC.md §2.5), not a void/scalar placeholder. */
  readonly structLayout?: StructLayoutResult;
  /**
   * Present iff this parameter is array-typed - a real, storage-backed
   * memory description (Priority 3 Stabilization Sprint), matching the
   * SAME conceptual pattern already established by `structLayout`
   * above (a compound type needs a memory description, not a plain
   * SSA value, to support indexed/composite access). Kept as a
   * SEPARATE field from `structLayout` deliberately - unifying the two
   * into one general "does this parameter have a memory description"
   * concept is a real, ratified future design direction, not
   * something decided or forced during this implementation. Absence
   * is a true no-op: every parameter without this field (including
   * every existing struct parameter, whose own `structLayout` is
   * completely untouched by this addition) behaves exactly as before.
   */
  readonly arrayLength?: number;
  /**
   * ADR-005 (Array Object as source of truth for Length): present
   * iff this is an array parameter (`arrayLength !== undefined`) -
   * the real C identifier name for a synthesized companion parameter
   * that carries the real, runtime `Length` value at the call
   * boundary (e.g. `"a_length"` for a parameter named `a`). This is
   * the sole source of truth for the transported `Length`; the
   * numeric `arrayLength` field above remains a pure "is this an
   * array parameter" marker only (unchanged, per backward
   * compatibility) and must never be read as a real length value.
   */
  readonly lengthParamCName?: string;
};

export type IRFunction = {
  /** Qualified name (see src/shared/symbols.ts's qualifiedName) — used as the emitted symbol name. */
  readonly qualifiedName: string;
  /** Original UR source name, for diagnostics/debug symbols. */
  readonly sourceName: string;
  readonly params: readonly IRParam[];
  readonly returnType: IRType;
  /** Present iff this function's own real return type is a struct (Priority 2, Solution A) - matches the SAME established pattern as IRParam.structLayout, not a Union type (kept consistent with every other real precedent in this file). `returnType` remains "void" when this is set (unused/ignored, kept only for existing consumers). */
  readonly returnStructLayout?: StructLayoutResult;
  readonly blocks: readonly IRBasicBlock[];
  readonly entryBlock: number;
  readonly location: SourceLocation;
  /** Local storage slots for reassignable variables that survive a CFG merge point (Level 2.6.1) — see IRLocalSlot above. Empty for straight-line functions with no such variables. */
  readonly locals: readonly IRLocalSlot[];
  /** FRI: present iff this function's own body is a real external call (Manifest-declared library function) rather than UR-compiled code. The interpreter executes this directly instead of running `blocks`. */
  readonly external?: { readonly runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript" | "native"; readonly module: string; readonly symbol: string; readonly rawArgs?: string; readonly manifestBaseDir?: string };
};

// ── Extern symbols ────────────────────────────────────────────────────────────
//
// A function declared but not defined anywhere in this module — e.g. a
// Runtime function or, in a future phase,
// an FFI/DLL/shared-library import. Modeled as a full contract from the
// start (not a bare string list) specifically so that adding Runtime, FFI,
// DLL/shared-library support, or LLVM/WASM import declarations later never
// requires redesigning this shape — only adding new ExternSymbol entries
// and, if ever needed, a new CallingConvention variant.
//
// Level 2.4 scope: only `kind: "runtime"` externs exist (the Runtime Core
// function table — see RUNTIME_SPEC.md §4.3). "ffi"/"system"/"future" exist
// now specifically so FFI/DLL/shared-library/future backend imports are
// representable the moment a future phase needs them, without another
// IRModule shape change then (per explicit review decision — do not wait
// until they're needed to add the enum).

export type CallingConvention = "c"; // only C calling convention exists in this phase; reserved for future variants (e.g. "stdcall") without a shape change

export type ExternKind = "runtime" | "ffi" | "system" | "future";

/**
 * Marks an extern's role in program startup/shutdown, discovered by the
 * Backend via this tag rather than by a hardcoded name string — see
 * emit-c.ts, which looks up `module.externs.find(e => e.lifecycleRole ===
 * "init")` and NEVER writes any Runtime function's literal name anywhere
 * in its own source (enforced by tests/backend/c/no-hardcoded-runtime.test.ts).
 *
 * STRICTLY LIMITED to "init" | "shutdown" | "none" — ordinary Runtime
 * functions (print/input/panic/free) are NOT lifecycle roles and must
 * always be "none". Lifecycle roles exist only for the two functions the
 * Backend auto-invokes without any explicit UR-level call instruction;
 * everything else is an ordinary callable extern with no special Backend
 * behavior attached to it.
 */
export type ExternLifecycleRole = "init" | "shutdown" | "none";

export type ExternSymbol = {
  readonly name: string;             // the real, final symbol name — already qualified, no further mangling applied
  readonly returnType: IRType;
  readonly parameterTypes: readonly IRType[];
  readonly callingConvention: CallingConvention;
  readonly kind: ExternKind;
  readonly lifecycleRole: ExternLifecycleRole;
  /** Absolute path to the real shared library this extern must be linked
   *  against — set only for `kind: "ffi"` externs (Stage 3.1, Native
   *  Library Registry). `undefined` for "runtime" externs, which are
   *  always linked via the fixed Runtime Core object file instead. */
  readonly sourceLibraryPath?: string;
  /**
   * Stage 3.2 — the REAL, exact C return/parameter types (e.g. "int",
   * "double"), when these differ from what `returnType`/`parameterTypes`'
   * own `cType()` mapping would naturally produce. Set only for `kind:
   * "ffi"` externs. When present, the C Backend declares the extern's
   * prototype using THESE exact types (matching the real library's own
   * ABI) and generates a thin, explicitly-casting wrapper function for
   * Lowering's `call` instruction to target instead of the raw symbol —
   * this is what makes narrowing (e.g. a real `int`-returning C function
   * represented as UR's own `i64`) fully defined behavior, rather than
   * relying on any particular platform's calling convention.
   */
  readonly cReturnType?: string;
  readonly cParameterTypes?: readonly string[];
  /** Stage 3.3 — set only when this FFI extern has an output parameter
   *  (see native-library-registry.ts's own NativeFunctionSignature.outParam
   *  for the full explanation). Undefined for every ordinary extern. */
  readonly outParam?: {
    readonly realParamIndex: number;
    readonly pointeeCType: string;
  };
};

export type IRModule = {
  readonly moduleName: string;
  readonly functions: readonly IRFunction[];
  readonly externs: readonly ExternSymbol[];
};

// ── Structural invariant checks (used by tests, not by the builder itself) ────
//
// These are pure, standalone checks — they do not throw, they return a list
// of violations, so tests can assert `checkModuleInvariants(m).length === 0`.
// This is the SSA discipline verifier: every value used must be defined
// before use (by a lower or equal id, since ids are monotonically
// increasing in definition order within a function), and every block must
// end in exactly one terminator (guaranteed by the type system already,
// but checked here for parameter/instruction id uniqueness too).

export type IRInvariantViolation = {
  readonly functionName: string;
  readonly message: string;
};

export function checkModuleInvariants(module: IRModule): IRInvariantViolation[] {
  const violations: IRInvariantViolation[] = [];

  // Runtime lifecycle safety (checked once, at module level, before the
  // Backend ever runs): exactly one Init and exactly one Shutdown extern
  // must exist. Zero would mean no program can start/stop correctly;
  // more than one would make the Backend's lifecycle-role lookup
  // ambiguous. This check has no "functionName" — it applies to the
  // module as a whole — so the module's own name is used for that field.
  const initExterns = module.externs.filter(e => e.lifecycleRole === "init");
  const shutdownExterns = module.externs.filter(e => e.lifecycleRole === "shutdown");
  if (initExterns.length === 0) {
    violations.push({ functionName: module.moduleName, message: `no extern with lifecycleRole "init" found — a program cannot start without one` });
  } else if (initExterns.length > 1) {
    violations.push({ functionName: module.moduleName, message: `multiple externs with lifecycleRole "init" found (${initExterns.map(e => e.name).join(", ")}) — exactly one is required` });
  }
  if (shutdownExterns.length === 0) {
    violations.push({ functionName: module.moduleName, message: `no extern with lifecycleRole "shutdown" found — a program cannot stop cleanly without one` });
  } else if (shutdownExterns.length > 1) {
    violations.push({ functionName: module.moduleName, message: `multiple externs with lifecycleRole "shutdown" found (${shutdownExterns.map(e => e.name).join(", ")}) — exactly one is required` });
  }

  for (const fn of module.functions) {
    const definedIds = new Set<number>();
    // Level 2.8: tracks each defined SSA id's declared IRType, enabling
    // the array-slot-consistency checks below. This is NOT full
    // dataflow/type analysis (that remains explicitly deferred per
    // CFG_VERIFIER_AUDIT.md) — it is a direct, single-pass record of
    // each instruction's own declared `type` field, exactly the kind of
    // structural fact the Verifier already tracks for ids in `definedIds`.
    const idTypes = new Map<number, IRType>();
    const blockIds = new Set<number>();
    const duplicateBlockIds = new Set<number>();

    for (const block of fn.blocks) {
      if (blockIds.has(block.id)) duplicateBlockIds.add(block.id);
      blockIds.add(block.id);
    }
    for (const dup of duplicateBlockIds) {
      violations.push({ functionName: fn.sourceName, message: `duplicate block id ${dup}` });
    }

    const slotIds = new Set(fn.locals.map(l => l.id));
    const slotsById = new Map(fn.locals.map(l => [l.id, l] as const));

    // Rule: no duplicate local slot ids or names (Level 2.6.1.6, per review).
    const seenSlotIds = new Set<number>();
    const seenSlotNames = new Set<string>();
    for (const slot of fn.locals) {
      if (seenSlotIds.has(slot.id)) {
        violations.push({ functionName: fn.sourceName, message: `duplicate local slot id ${slot.id}` });
      }
      seenSlotIds.add(slot.id);
      if (seenSlotNames.has(slot.name)) {
        violations.push({ functionName: fn.sourceName, message: `duplicate local slot name '${slot.name}'` });
      }
      seenSlotNames.add(slot.name);
    }

    // Rule: every declared slot must be used by at least one load or store
    // — a dead local slot almost always indicates a Lowering bug, not a
    // harmless optimization opportunity, so this is a VERIFIER ERROR (per
    // explicit review decision), not a warning.
    const usedSlotIds = new Set<number>();
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "load" || inst.kind === "store" || inst.kind === "array_load" || inst.kind === "array_store" || inst.kind === "field_load" || inst.kind === "field_store") usedSlotIds.add(inst.slot);
      }
    }
    for (const slot of fn.locals) {
      if (!usedSlotIds.has(slot.id)) {
        violations.push({ functionName: fn.sourceName, message: `local slot ${slot.id} ('${slot.name}') is declared but never used by any load or store` });
      }
    }

    // Rule: conservative load-before-store check. This is NOT full
    // dataflow analysis (deliberately deferred per review — "لا تحتاج
    // تحليل تدفق كامل؛ يكفي التحقق المحافظ ضمن النطاق الحالي"). It walks
    // blocks in their array order and accumulates a single "stored so
    // far" set across the whole function — correct for the common case
    // where blocks are created in the same order the program can reach
    // them (true for straight-line code and for the if/while lowering
    // shapes planned in CFG_SPEC.md §3-4: entry stores are appended
    // before any later block that loads the same slot). This is a
    // conservative approximation, not a soundness guarantee for
    // arbitrary future CFG shapes — to be revisited once a real
    // dataflow-based check is needed.
    const storedSoFar = new Set<number>();
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        if (inst.kind === "store" || inst.kind === "array_store") storedSoFar.add(inst.slot);
        else if ((inst.kind === "load" || inst.kind === "array_load") && slotIds.has(inst.slot) && !storedSoFar.has(inst.slot)) {
          violations.push({
            functionName: fn.sourceName,
            message: `load of local slot ${inst.slot} before any store to it was observed (conservative check, block array order) — in instruction %${inst.id}`,
          });
        }
      }
    }

    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        // `store`/`array_store` define no SSA id (analogous to a
        // void-typed call) — handled separately below, never added to
        // definedIds.
        if (inst.kind === "store") {
          if (!definedIds.has(inst.value.id)) {
            violations.push({
              functionName: fn.sourceName,
              message: `store uses undefined SSA value %${inst.value.id} before definition`,
            });
          }
          if (!slotIds.has(inst.slot)) {
            violations.push({ functionName: fn.sourceName, message: `store references undefined local slot ${inst.slot}` });
          }
          continue;
        }
        if (inst.kind === "array_store") {
          if (!definedIds.has(inst.value.id)) {
            violations.push({ functionName: fn.sourceName, message: `array_store uses undefined SSA value %${inst.value.id} before definition` });
          }
          if (!definedIds.has(inst.index.id)) {
            violations.push({ functionName: fn.sourceName, message: `array_store uses undefined SSA index value %${inst.index.id} before definition` });
          }
          if (!slotIds.has(inst.slot)) {
            violations.push({ functionName: fn.sourceName, message: `array_store references undefined local slot ${inst.slot}` });
          } else {
            const slot = slotsById.get(inst.slot)!;
            // Rule (per review, FIX per issues/level-2.8-single-element-array-c-backend-bug.md):
            // array_load/array_store must target a genuine array slot —
            // checked via the explicit isArray field, not length > 1 (which
            // incorrectly rejected a genuine one-element array, length === 1).
            if (slot.isArray !== true) {
              violations.push({ functionName: fn.sourceName, message: `array_store targets slot ${inst.slot} ('${slot.name}'), which is not an array (no length > 1 declared)` });
            }
            // Rule (per review): the value's type must match the
            // array's declared element type — a genuine type mismatch
            // here would indicate a Lowering bug, since TypeChecker
            // already guarantees this for any valid UR program before
            // Lowering runs.
            const valueType = idTypes.get(inst.value.id);
            if (valueType && valueType !== slot.type) {
              violations.push({ functionName: fn.sourceName, message: `array_store into slot ${inst.slot} ('${slot.name}', element type '${slot.type}') was given a value of type '${valueType}'` });
            }
          }
          continue;
        }
        if (inst.kind === "field_store") {
          if (!definedIds.has(inst.value.id)) {
            violations.push({ functionName: fn.sourceName, message: `field_store uses undefined SSA value %${inst.value.id} before definition` });
          }
          if (!slotIds.has(inst.slot)) {
            violations.push({ functionName: fn.sourceName, message: `field_store references undefined local slot ${inst.slot}` });
          } else {
            const slot = slotsById.get(inst.slot)!;
            if (!slot.structLayout) {
              violations.push({ functionName: fn.sourceName, message: `field_store targets slot ${inst.slot} ('${slot.name}'), which is not a struct (no structLayout declared)` });
            } else if (inst.fieldIndex < 0 || inst.fieldIndex >= slot.structLayout.fields.length) {
              violations.push({ functionName: fn.sourceName, message: `field_store targets field index ${inst.fieldIndex} on slot ${inst.slot} ('${slot.name}'), which only has ${slot.structLayout.fields.length} field(s)` });
            }
          }
          continue;
        }

        if (definedIds.has(inst.id)) {
          violations.push({ functionName: fn.sourceName, message: `duplicate SSA id ${inst.id}` });
        }
        definedIds.add(inst.id);
        if ("type" in inst) idTypes.set(inst.id, inst.type);

        if (inst.kind === "load" && !slotIds.has(inst.slot)) {
          violations.push({ functionName: fn.sourceName, message: `load references undefined local slot ${inst.slot} (in instruction %${inst.id})` });
        }
        if (inst.kind === "array_load") {
          if (!slotIds.has(inst.slot)) {
            violations.push({ functionName: fn.sourceName, message: `array_load references undefined local slot ${inst.slot} (in instruction %${inst.id})` });
          } else {
            const slot = slotsById.get(inst.slot)!;
            // FIX (per issues/level-2.8-single-element-array-c-backend-bug.md):
            // use the explicit isArray field, not length > 1.
            if (slot.isArray !== true) {
              violations.push({ functionName: fn.sourceName, message: `array_load targets slot ${inst.slot} ('${slot.name}'), which is not an array (no length > 1 declared) (in instruction %${inst.id})` });
            }
          }
        }

        // Every operand reference must point to an already-defined id.
        const refs: IRValueRef[] = [];
        if (inst.kind === "binop") { refs.push(inst.left, inst.right); }
        else if (inst.kind === "unop") { refs.push(inst.operand); }
        else if (inst.kind === "call") { refs.push(...inst.args); }
        else if (inst.kind === "array_load") { refs.push(inst.index); }

        for (const ref of refs) {
          if (!definedIds.has(ref.id)) {
            violations.push({
              functionName: fn.sourceName,
              message: `use of undefined SSA value %${ref.id} before definition (in instruction %${inst.id})`,
            });
          }
        }

        // Call targets must resolve to either a real function defined in
        // this module, OR a declared extern (e.g. a Runtime function —
        // see RUNTIME_SPEC.md §4.2/§4.3). No other callee is valid.
        if (inst.kind === "call") {
          const targetIsLocalFn = module.functions.some(f => f.qualifiedName === inst.callee);
          const targetIsExtern = module.externs.some(e => e.name === inst.callee);
          if (!targetIsLocalFn && !targetIsExtern) {
            violations.push({
              functionName: fn.sourceName,
              message: `call to unresolved function '${inst.callee}' — not defined anywhere in module '${module.moduleName}' and not declared as an extern`,
            });
          }
        }
      }

      // Terminator-level checks.
      if (block.terminator.kind === "return") {
        if (!definedIds.has(block.terminator.value.id)) {
          violations.push({
            functionName: fn.sourceName,
            message: `return uses undefined SSA value %${block.terminator.value.id}`,
          });
        }
      } else if (block.terminator.kind === "branch") {
        if (!blockIds.has(block.terminator.target)) {
          violations.push({
            functionName: fn.sourceName,
            message: `branch target block ${block.terminator.target} does not exist (from block ${block.id})`,
          });
        }
      } else if (block.terminator.kind === "cond_branch") {
        if (!definedIds.has(block.terminator.condition.id)) {
          violations.push({
            functionName: fn.sourceName,
            message: `cond_branch condition uses undefined SSA value %${block.terminator.condition.id}`,
          });
        }
        if (!blockIds.has(block.terminator.thenTarget)) {
          violations.push({
            functionName: fn.sourceName,
            message: `cond_branch 'then' target block ${block.terminator.thenTarget} does not exist (from block ${block.id})`,
          });
        }
        if (!blockIds.has(block.terminator.elseTarget)) {
          violations.push({
            functionName: fn.sourceName,
            message: `cond_branch 'else' target block ${block.terminator.elseTarget} does not exist (from block ${block.id})`,
          });
        }
      }
    }

    if (!fn.blocks.some(b => b.id === fn.entryBlock)) {
      violations.push({ functionName: fn.sourceName, message: `entryBlock ${fn.entryBlock} does not exist` });
      continue; // reachability check below would be meaningless without a valid entry
    }

    // CFG reachability: every block must be reachable from the entry block
    // by following branch/cond_branch edges. An unreachable block is dead
    // code that should never have been constructed by the lowering pass —
    // this check is meaningful today for hand-built/future multi-block IR
    // even though the current lowering pass only ever emits a single block.
    const reachable = new Set<number>();
    const queue: number[] = [fn.entryBlock];
    const blockById = new Map(fn.blocks.map(b => [b.id, b]));
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const block = blockById.get(id);
      if (!block) continue;
      if (block.terminator.kind === "branch") queue.push(block.terminator.target);
      else if (block.terminator.kind === "cond_branch") {
        queue.push(block.terminator.thenTarget);
        queue.push(block.terminator.elseTarget);
      }
    }
    for (const block of fn.blocks) {
      if (!reachable.has(block.id)) {
        violations.push({ functionName: fn.sourceName, message: `block ${block.id} ('${block.label}') is unreachable from the entry block` });
      }
    }
  }

  return violations;
}
