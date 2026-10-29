// ─────────────────────────────────────────────────────────────────────────────
// UR — Compiler Pipeline: AST → IR Lowering
// Level 2 — Phase 2.2
// ─────────────────────────────────────────────────────────────────────────────
//
//   UR Source → Lexer → Parser → AST → Semantic → Type Checker → IR
//                                                                  ^^^^ HERE
//
// PRECONDITION: the caller MUST have already run the Program through
// analyze() (Semantic) and typeCheck() (Type Checker) with ZERO error
// diagnostics before calling lowerToIR(). This pass does not re-validate
// semantic correctness — it assumes a well-formed, well-typed program and
// focuses purely on IR construction. Passing an invalid program produces
// undefined lowering behavior (most likely a CG9001 internal-error
// diagnostic from a failed lookup, not a crash — but correctness is only
// guaranteed for programs that already passed Semantic + TypeChecker).
//
// SCOPE (per approved Level 2 execution plan — do not expand without a new
// approved phase): variable declarations, assignment to a plain identifier,
// arithmetic/comparison/logical binary and unary expressions, function
// calls, return statements. Any other statement or expression kind
// (if/while/for/break/continue/switch/try-catch, struct/array literals,
// member/index expressions as assignment targets, imports) produces a
// CG1001 UNSUPPORTED_CONSTRUCT diagnostic — this pass never silently
// mishandles a construct it doesn't support.
//
// This pass reuses TypeSystem's own exported, stable functions
// (binaryOpResultType, unaryOpResultType, resolveTypeRef) rather than
// re-deriving type rules — per the Level 2 rule against modifying Type
// System, nothing in typesystem/*.ts is changed; this file only consumes
// its public API.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Program, FunctionDecl, Statement, Expression, BlockStatement,
} from "../frontend/ast.js";
import { resolveTypeRef } from "../typesystem/type-env.js";
import { binaryOpResultType, unaryOpResultType } from "../typesystem/compatibility.js";
import { T_INT, T_FLOAT, T_BOOL, T_STRING, T_CHAR, T_UNKNOWN, tArray, tStruct, type URType } from "../typesystem/types.js";
import type {
  IRModule, IRFunction, IRBasicBlock, IRInstruction, IRTerminator,
  IRType, IRValueRef, IRBinOp, IRUnOp, IRLocalSlot, ExternSymbol, StructLayoutResult,
} from "../../shared/ir.js";
import { computeStructLayout, StructLayoutRejectionError } from "../typesystem/struct-layout-calculator.js";
import { lookupNativeLibrary, lookupNativeFunction } from "../semantic/native-library-registry.js";
import { fromAstSpan, type SourceLocation } from "../../shared/locations.js";
import { qualifiedName as makeQualifiedName } from "../../shared/symbols.js";
import { makeDiagnostic, CODEGEN_CODES, type SharedDiagnostic } from "../../shared/diagnostics.js";
import { buildOk, buildFail, type BuildResult } from "../../shared/build.js";
import { RUNTIME_CORE_EXTERNS, resolveBuiltinExtern } from "../../shared/runtime-table.js";
import { lookupBuiltin } from "../semantic/builtins-registry.js";

// ── URType → IRType mapping ─────────────────────────────────────────────────

// toIRType/collectAssignedNames/collectAssignedNamesInIf moved to
// lower-to-ir-helpers.ts, and IRBuilder moved to ir-builder.ts
// (Architecture Freeze Audit) - pure separation, zero behavioral change.
import { toIRType, collectAssignedNames, collectAssignedNamesInIf, type FnSignature } from "./lower-to-ir-helpers.js";
import { IRBuilder } from "./ir-builder.js";

export function lowerToIR(program: Program, file: string, moduleName: string, externalStructTypes?: ReadonlyMap<string, URType>, externalStructLayouts?: ReadonlyMap<string, StructLayoutResult>, externalFunctions?: ReadonlyMap<string, { runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript" | "native"; module: string; symbol: string; rawArgs?: string; manifestBaseDir?: string }>): BuildResult<IRModule> {
  const allDiagnostics: SharedDiagnostic[] = [];

  // Real cross-module wiring (mirrors the same, already-established
  // pattern used for analyze()'s externalFunctionNames and
  // typeCheck()'s externalStructTypes) — local struct URTypes, merged
  // with any imported struct types the caller supplies, consulted by
  // every resolveTypeRef() call below so a struct-typed parameter
  // whose struct is declared in ANOTHER module still resolves
  // correctly here, not just in Semantic/TypeChecker.
  const localStructUrTypes = new Map<string, URType>();
  for (const s of program.structs) {
    localStructUrTypes.set(s.name, tStruct(s.name, s.fields.map(f => ({ name: f.name, type: resolveTypeRef(f.type) }))));
  }
  const knownStructUrTypes = new Map<string, URType>(externalStructTypes ?? []);
  for (const [name, ty] of localStructUrTypes) knownStructUrTypes.set(name, ty);

  // Build the function-signature table (qualified name, return/param URTypes)
  // up front, so calls to any function in the module resolve regardless of
  // declaration order — matching the Frontend's own forward-declaration
  // semantics (Semantic Analyzer already validated this).
  const functionSignatures = new Map<string, FnSignature>();
  for (const fn of program.functions) {
    const returnType = fn.returnType ? resolveTypeRef(fn.returnType, undefined, knownStructUrTypes) : T_UNKNOWN;
    const paramTypes = fn.params.map(p => p.type ? resolveTypeRef(p.type, undefined, knownStructUrTypes) : T_UNKNOWN);
    functionSignatures.set(fn.name, {
      qualifiedName: makeQualifiedName({ name: fn.name, kind: "function", location: fromAstSpan(file, fn.span), module: moduleName }),
      returnType,
      paramTypes,
    });
  }

  // Struct layout registry (Level 2.8, revised per STRUCT_MEMORY_LAYOUT.md
  // §9's binding single-source-of-truth requirement) — built once via the
  // single, shared StructLayoutCalculator, shared read-only across all
  // functions, mirroring functionSignatures above. This REPLACES the
  // prior structFields (a plain URType list with no offset/size info) —
  // the Calculator is now the only place that computes field positions.
  //
  // Gate R1.5: a preliminary, name-only stub map of EVERY struct in the
  // program (empty `fields` — not yet resolved, and not needed here:
  // the loop below only ever consults `fieldType.kind === "Struct"` and
  // `fieldType.name` to look up `structLayouts`, never the stub's own
  // `fields`) is built BEFORE the main loop, precisely so resolveTypeRef
  // can recognize ANY struct-typed field reference regardless of
  // processing order — including a struct referencing itself, where an
  // INCREMENTALLY-built map (adding one entry per loop iteration, as
  // checker.ts's own separate hoisting pass does) would still be missing
  // the current struct's own name at the exact moment its own fields are
  // being resolved. This is the proven root cause (Gate R1.4, corrected
  // location) — resolveTypeRef() previously received no struct-name map
  // at this exact call site, causing an Error-kind URType, which
  // toIRType() then mapped to "void", producing the "field has type
  // 'void'" crash for every struct-typed field.
  const structNameStubs = new Map<string, URType>(
    program.structs.map(s => [s.name, tStruct(s.name, [])]),
  );
  // Gate R1.5 (Implementation): structLayouts is now computed LAZILY
  // and MEMOIZED, keyed by dependency order (which struct references
  // which), NOT by declaration order — proven necessary and correct
  // via an isolated prototype (Gate R1.5's own Discovery+Design) before
  // this exact implementation. A struct referencing a LATER-declared
  // struct, or referencing itself, previously failed because
  // structLayouts.get(name) returned undefined at the exact moment it
  // was needed (declaration-order, single-pass building) — this had
  // NOTHING to do with toIRType() or struct-layout-calculator.ts, both
  // of which remain untouched, and the type:"void"+nestedLayout pattern
  // below is byte-identical to before; only the ORDER/TIMING of when
  // each struct's own layout gets computed has changed.
  const declsByName = new Map(program.structs.map(s => [s.name, s]));
  const structLayouts = new Map<string, StructLayoutResult>();
  const inProgress = new Set<string>();

  function getOrComputeStructLayout(name: string): StructLayoutResult | undefined {
    if (structLayouts.has(name)) return structLayouts.get(name);
    const decl = declsByName.get(name);
    if (!decl) return undefined; // not a real struct name — resolveTypeRef's
                                  // own unknown-type diagnostic already covers this
    if (inProgress.has(name)) {
      // Cycle detected — a struct that (directly or transitively)
      // contains itself BY VALUE has no finite size. This is a real,
      // explicit, diagnosable rejection (Gate R1.5's own Discovery:
      // Layout must cleanly reject this, not attempt a placeholder) —
      // NOT the "field has type 'void'" internal-error crash this
      // Gate's own work replaces.
      throw new StructLayoutRejectionError(
        `struct '${name}' is recursive by value (directly or indirectly contains itself) — ` +
        `this requires a reference/pointer-based representation, which is not supported`,
      );
    }
    inProgress.add(name);
    const fieldInputs = decl.fields.map(f => {
      const fieldType = resolveTypeRef(f.type, undefined, structNameStubs);
      const nested = fieldType.kind === "Struct" ? getOrComputeStructLayout(fieldType.name) : undefined;
      // v29-D5 (Slice 2, Reference Representation Contract §1/§2): a
      // struct field whose own type is Array-kind (int[] OR int[][] —
      // depth makes no difference, per the Design's own explicit
      // statement that a nested array is entirely the array's own
      // internal structure, invisible to the struct) resolves to the
      // real, distinct "array_ref" IRType, NEVER toIRType()'d directly
      // — mirroring the identical fix already applied twice in D4 (a
      // function parameter's own element type; a nested array's own
      // outer element type). toIRType()'s own documented contract
      // explicitly excludes Array types; calling it on one here would
      // silently produce "void" again (the exact D5 Discovery finding,
      // confirmed empirically before this fix existed). array_ref is
      // NOT converted to "ptr" anywhere — the two remain genuinely
      // distinct IRTypes, per the Design's own explicit refusal to
      // unify reference semantics.
      const fieldIrType = fieldType.kind === "Array" ? "array_ref" : toIRType(fieldType);
      return { name: f.name, type: fieldIrType, nestedLayout: nested };
    });
    inProgress.delete(name);
    const layout = computeStructLayout(name, fieldInputs);
    structLayouts.set(name, layout);
    return layout;
  }

  // Gate V1-GAP-002-SELF-REFERENCE-DIAGNOSTIC: getOrComputeStructLayout
  // (cycle detection) and computeStructLayout (unresolvable field type,
  // called from within it) both throw StructLayoutRejectionError for a
  // KNOWN, diagnosable struct-layout problem — caught HERE, specifically
  // (never a general catch-all: only this one error type is caught;
  // anything else propagates normally, preserving visibility into any
  // genuinely unexpected internal error). Converted into the SAME
  // structured {ok:false, diagnostics:[...]} contract every other
  // Lowering-stage error in this function already uses.
  for (const s of program.structs) {
    if (!structLayouts.has(s.name)) {
      try {
        getOrComputeStructLayout(s.name);
      } catch (e) {
        if (e instanceof StructLayoutRejectionError) {
          allDiagnostics.push(makeDiagnostic("codegen", "error", CODEGEN_CODES.INVALID_STRUCT_LAYOUT, e.message, fromAstSpan(file, s.span)));
          return buildFail(allDiagnostics);
        }
        throw e;
      }
    }
  }
  // Real cross-module wiring: merge in layouts for imported structs
  // (pre-computed by the caller, typically via ModuleRegistry) - local
  // declarations take precedence on a name collision, same pattern
  // already used for externalFunctionNames/externalStructTypes above.
  if (externalStructLayouts) {
    for (const [name, layout] of externalStructLayouts) {
      if (!structLayouts.has(name)) structLayouts.set(name, layout);
    }
  }

  // Stage 3.1 — Native Library Registry member-call support: the set of
  // names actually `import`ed in this program (confirmed directly:
  // `program.modules` holds `ImportDecl { path: string[] }` entries —
  // `path[0]` is the imported name for the single-segment case this
  // Stage's own scope covers, e.g. `import sqlite3`).
  const importedNames = new Set<string>();
  for (const imp of program.imports) {
    if (imp.path.length > 0) importedNames.add(imp.path[0]!);
  }
  // One shared map across every function in this module — a real C
  // program only needs ONE `extern` declaration per symbol regardless of
  // how many functions call it; this Map (keyed by symbol name) achieves
  // the same de-duplication at the IR level.
  const ffiExterns = new Map<string, ExternSymbol>();

  const irFunctions: IRFunction[] = [];
  let sawFailure = false;

  for (const fn of program.functions) {
    const sig = functionSignatures.get(fn.name)!;
    const ext = externalFunctions?.get(fn.name);
    if (ext) {
      irFunctions.push({
        qualifiedName: sig.qualifiedName,
        sourceName: fn.name,
        params: fn.params.map(p => ({ name: p.name, type: toIRType(sig.paramTypes[fn.params.indexOf(p)] ?? T_UNKNOWN) })),
        returnType: toIRType(sig.returnType),
        blocks: [],
        entryBlock: 0,
        location: fromAstSpan(file, fn.span),
        locals: [],
        external: ext,
      });
      continue;
    }
    const builder = new IRBuilder(file, functionSignatures, structLayouts, knownStructUrTypes, importedNames, ffiExterns);
    const irFn = builder.lowerFunction(fn, sig.qualifiedName, sig.returnType, sig.paramTypes);
    allDiagnostics.push(...builder.getDiagnostics());
    if (!irFn) { sawFailure = true; continue; }
    irFunctions.push(irFn);
  }

  if (sawFailure) {
    return buildFail(allDiagnostics);
  }

  return buildOk({ moduleName, functions: irFunctions, externs: [...RUNTIME_CORE_EXTERNS, ...ffiExterns.values()] }, allDiagnostics);
}
