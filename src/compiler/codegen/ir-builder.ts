// ─────────────────────────────────────────────────────────────────────────────
// UR — Compiler Pipeline: IRBuilder (AST → IR lowering machinery)
// ─────────────────────────────────────────────────────────────────────────────
//
// Extracted from lower-to-ir.ts (Architecture Freeze Audit, per official
// directive: split files exceeding 1,000 lines). Pure separation, zero
// behavioral change - IRBuilder's own body is byte-for-byte identical to
// its own prior body in lower-to-ir.ts, only the file/module boundary moved.
//
// lower-to-ir.ts's own lowerToIR() function is the orchestrator: it walks
// the Program's top-level declarations and calls this class's own
// lowerFunction() once per real UR function - all the actual expression/
// statement lowering machinery for a SINGLE function lives here.

import type {
  Program, FunctionDecl, Statement, Expression, BlockStatement,
} from "../frontend/ast.js";
import { resolveTypeRef } from "../typesystem/type-env.js";
import { binaryOpResultType, unaryOpResultType } from "../typesystem/compatibility.js";
import { T_INT, T_FLOAT, T_BOOL, T_STRING, T_CHAR, T_UNKNOWN, tArray, tStruct, type URType } from "../typesystem/types.js";
import type {
  IRModule, IRFunction, IRBasicBlock, IRInstruction, IRTerminator,
  IRType, IRValueRef, IRBinOp, IRUnOp, IRLocalSlot, ExternSymbol, StructLayoutResult, IRParam,
} from "../../shared/ir.js";
import { computeStructLayout } from "../typesystem/struct-layout-calculator.js";
import { lookupNativeLibrary, lookupNativeFunction } from "../semantic/native-library-registry.js";
import { fromAstSpan, type SourceLocation } from "../../shared/locations.js";
import { qualifiedName as makeQualifiedName } from "../../shared/symbols.js";
import { makeDiagnostic, CODEGEN_CODES, type SharedDiagnostic } from "../../shared/diagnostics.js";
import { RUNTIME_CORE_EXTERNS, resolveBuiltinExtern } from "../../shared/runtime-table.js";
import { lookupBuiltin } from "../semantic/builtins-registry.js";
import { toIRType, collectAssignedNames, collectAssignedNamesInIf, BINOP_MAP, UNOP_MAP, type FnSignature, type VarBinding } from "./lower-to-ir-helpers.js";

export
class IRBuilder {
  private nextId = 0;
  private instructions: IRInstruction[] = []; // accumulator for the CURRENT block being built
  private readonly diagnostics: SharedDiagnostic[] = [];
  private readonly valueTypes = new Map<number, URType>(); // SSA id -> its URType, for downstream binop resolution
  private readonly varEnv = new Map<string, VarBinding>();  // current binding (ssa or slot) for a variable name
  private readonly varTypes = new Map<string, URType>();    // declared/inferred URType for a variable name

  // ── Multi-block CFG state (Phase 2.6.2) ──────────────────────────────────
  private blocks: IRBasicBlock[] = [];      // finished blocks so far
  private currentBlockId = 0;
  private currentBlockLabel = "entry";
  private nextBlockId = 1;                  // 0 is always the entry block
  private locals: IRLocalSlot[] = [];       // local slots declared so far
  private nextSlotId = 0;

  // ── Loop context stack (Phase 2.6.4) ─────────────────────────────────────
  //
  // Pushed on entering a `while`'s body lowering, popped on exit. `break`
  // jumps to the innermost loop's exit block (playing the same role as
  // if/else's merge block — the single reconvergence point after the
  // construct). `continue` jumps to the innermost loop's HEADER block
  // (the condition re-check), never the body — per explicit review
  // requirement, so a `continue` correctly re-evaluates the loop
  // condition rather than skipping straight back into the body.
  private loopStack: Array<{ headerBlockId: number; exitBlockId: number }> = [];

  // ── Struct state (Level 2.8) ──────────────────────────────────────────────
  //
  // REVISED (per STRUCT_IR_DESIGN.md/STRUCT_MEMORY_LAYOUT.md, superseding
  // the prior "each field is its own Local Slot" approach described
  // above for historical context): a struct-typed variable is now ONE
  // real IRLocalSlot carrying its own `structLayout`, accessed via the
  // real `field_load`/`field_store` instructions — not N independent
  // scalar slots joined only by external, Lowering-pass-only
  // bookkeeping. `structVarSlot` tracks, for each struct-typed variable
  // currently in scope, that ONE slot's id (and its own layout, for
  // convenience — same object already stored on the IRLocalSlot itself).
  private readonly structVarSlot = new Map<string, { slotId: number; layout: StructLayoutResult }>();

  constructor(
    private readonly file: string,
    private readonly functionSignatures: Map<string, FnSignature>,
    private readonly structLayouts: Map<string, StructLayoutResult>,
    /** Real, resolved URType per struct name (local + imported), used for varTypes bookkeeping so a struct field's own real type (not a T_UNKNOWN placeholder) is known for print()/type-dependent codegen decisions. Fixes a real bug found live: field values were previously typed T_UNKNOWN, causing print() to reject them as 'void'. */
    private readonly structUrTypes: Map<string, URType> = new Map(),
    // Stage 3.1 — Native Library Registry member-call support: the set of
    // names actually `import`ed in this program (so `x.y()` where `x` was
    // never imported is rejected with a clear message, not silently
    // resolved), and a MODULE-LEVEL shared map (not per-IRBuilder — every
    // function in the module shares one extern table, matching how a real
    // C program only needs one `extern` declaration per symbol regardless
    // of how many functions call it) accumulating exactly one ExternSymbol
    // per distinct native function actually called anywhere in the module.
    private readonly importedNames: ReadonlySet<string> = new Set(),
    private readonly ffiExterns: Map<string, ExternSymbol> = new Map(),
  ) {}

  private freshId(): number {
    return this.nextId++;
  }

  private allocBlockId(): number {
    return this.nextBlockId++;
  }

  /**
   * Ends the CURRENT block with the given terminator, pushing it into
   * `this.blocks`, then switches to a new (empty) current block with the
   * given id/label. This is the ONLY place a block is "finished" — every
   * control-flow construct (if/else today; while/break/continue in later
   * phases) is built purely by calling this and allocBlockId(), never by
   * any construct-specific special-casing (per CFG_SPEC.md's "if is just
   * a use of the general CFG, not a special case" principle).
   */
  private finishBlockAndSwitchTo(terminator: IRTerminator, newBlockId: number, newBlockLabel: string): void {
    this.blocks.push({ id: this.currentBlockId, label: this.currentBlockLabel, instructions: this.instructions, terminator });
    this.currentBlockId = newBlockId;
    this.currentBlockLabel = newBlockLabel;
    this.instructions = [];
  }

  private loc(span: { startLine: number; startColumn: number; endLine: number; endColumn: number }): SourceLocation {
    return fromAstSpan(this.file, span);
  }

  private error(code: string, message: string, location: SourceLocation): void {
    this.diagnostics.push(makeDiagnostic("codegen", "error", code, message, location));
  }

  // Gate V1-MIXED-STRUCT-ARRAY-REJECTION: determines whether a
  // struct's own real, already-computed layout (StructLayoutResult)
  // is homogeneous — every field is either a plain scalar or every
  // field is a reference — or mixes the two kinds. This mirrors
  // EXACTLY the classification empirically validated in Gate
  // R1.5-CGEN-002's own real, forced-GC testing: Point (all-scalar)
  // and Box (all-reference) were both proven GC-safe as array
  // elements; Mixed (one scalar field + one reference field) was
  // proven, twice, to cause real memory-safety violations (a
  // demonstrated use-after-free under one representation, a
  // demonstrated segmentation fault under the other) regardless of
  // storage strategy. A struct-typed field (itself a nested struct,
  // i.e. field.nestedLayout is present) is conservatively treated as
  // disqualifying — this exact combination was never tested by that
  // Gate's own empirical work, and this check must not assume safety
  // for an untested case.
  private isStructArrayElementHomogeneous(layout: StructLayoutResult): boolean {
    let hasScalar = false;
    let hasReference = false;
    for (const field of layout.fields) {
      if (field.nestedLayout) return false; // untested combination — reject conservatively
      if (field.type === "array_ref") hasReference = true;
      else hasScalar = true;
    }
    return !(hasScalar && hasReference);
  }

  // Gate V1-MIXED-STRUCT-ARRAY-REJECTION: the one, shared diagnostic
  // emission for all three call sites (array literal, array-returning
  // function, array parameter) — a struct with mixed scalar/reference
  // fields used as an array element type is rejected here, at
  // Lowering, with a real UR diagnostic, per the ALREADY-FROZEN
  // Array<Struct> Language Contract (Gate R1.5-CGEN-002's own Point 3)
  // — this Gate implements that already-decided policy; it does not
  // reopen or re-decide it.
  private rejectMixedStructArrayElement(structName: string, location: SourceLocation): void {
    this.error(
      "CG1002",
      `Array element struct '${structName}' contains mixed scalar and reference fields, which is not currently supported.`,
      location,
    );
  }

  // ── Variable resolution (plain SSA or slot-backed) ──────────────────────────
  //
  // See CFG_SPEC.md §1.2-1.3: a variable becomes slot-backed only when a
  // branch construct needs it to survive a CFG merge point without a phi
  // node. Every other variable stays pure SSA (rebind-on-assignment),
  // exactly as in Level 2.1-2.5 — Phase 2.6.2 does not change that
  // behavior for variables that never cross a branch.

  /** Resolves a variable read: returns its current SSA value, emitting a `load` if it is slot-backed. */
  private resolveVar(name: string, location: SourceLocation): { ref: IRValueRef; type: URType } | null {
    const binding = this.varEnv.get(name);
    const type = this.varTypes.get(name);
    if (!binding || !type) return null;
    if (binding.kind === "ssa") return { ref: binding.ref, type };
    // Compiler & Runtime Stabilization FIX — confirmed real Category A
    // bug (Stage: Functions bug hunt): this function previously called
    // `toIRType(type)` unconditionally for EVERY slot-backed variable
    // reference, including array-typed ones. `toIRType()`'s own comment
    // explicitly documents its precondition: "Anything else
    // (Array/...) is out of scope... callers must check for CG1001
    // before this would ever be reached" — but this exact call site
    // never performed that check, silently falling through to
    // `toIRType`'s own "void" fallback for the unrepresentable Array
    // case. Confirmed directly: `return a` (a bare array-identifier
    // return) produced invalid C (`void v6 = slot_a;`), a hard gcc
    // compile failure with zero UR-level diagnostic — the exact same
    // "type system promises it, backend can't deliver, silent crash
    // instead of a clear message" pattern as the earlier string-concat
    // and array-type-annotation fixes this same phase already closed.
    // Fixed: reject bare array-identifier references (in contexts other
    // than indexing, which already has its own IndexExpression-specific
    // handling and check) with the same clear, established diagnostic
    // used elsewhere for this project's own documented array
    // limitation — never silently emit a broken load.
    if (type.kind === "Array") {
      this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${name}' is an array — arrays cannot be used as a plain value (e.g. returned directly, assigned as a whole, or passed by value) in this Level 2 phase; only indexed element access ('${name}[i]') is supported`, location);
      return null;
    }
    const id = this.freshId();
    this.instructions.push({ kind: "load", id, type: toIRType(type), slot: binding.slotId, location });
    this.valueTypes.set(id, type);
    return { ref: { id }, type };
  }

  /** Records a variable write: emits a `store` if the variable is slot-backed, otherwise rebinds it to a fresh SSA value (existing Level 2.1-2.5 behavior, unchanged). */
  private assignVar(name: string, value: { ref: IRValueRef; type: URType }, location: SourceLocation): void {
    const existing = this.varEnv.get(name);
    if (existing?.kind === "slot") {
      this.instructions.push({ kind: "store", slot: existing.slotId, value: value.ref, location });
    } else {
      this.varEnv.set(name, { kind: "ssa", ref: value.ref });
    }
    this.varTypes.set(name, value.type);
  }

  /**
   * Promotes a variable that currently has a plain SSA binding into a
   * slot-backed binding, emitting a `store` of its current value into a
   * freshly-allocated slot. No-op if the variable is already slot-backed.
   * Called before lowering a branch construct's bodies, for every OUTER
   * variable that construct's collectAssignedNames() determined is
   * reassigned inside at least one branch.
   */
  private promoteToSlot(name: string, location: SourceLocation): void {
    const existing = this.varEnv.get(name);
    const type = this.varTypes.get(name);
    if (!existing || !type || existing.kind === "slot") return;
    const slotId = this.nextSlotId++;
    this.locals.push({ id: slotId, name, type: toIRType(type) });
    this.instructions.push({ kind: "store", slot: slotId, value: existing.ref, location });
    this.varEnv.set(name, { kind: "slot", slotId });
  }

  // ── Expression lowering ────────────────────────────────────────────────────

  /** Returns the SSA value id for the lowered expression, or null if lowering failed (diagnostic already recorded). */
  /**
   * Single source of truth for lowering an array literal (`[1,2,3]`)
   * into a real slot + array_store sequence. Used by BOTH
   * `VariableDeclaration` (`let a = [1,2,3]`, where `varName` is the
   * real, named variable) and the general `lowerExpr` case (`sum([1,2,3])`
   * — a direct call argument, `varName` undefined, per ADR-004:
   * confirmed via real AST-level evidence that both positions share
   * the same readiness point, and the difference was a real,
   * disclosed implementation gap, not an architectural one). Extracted
   * per direct instruction — a single function, not duplicated logic.
   *
   * Returns `null` only on a real lowering failure (a diagnostic has
   * already been recorded via `this.error(...)`).
   */
  private lowerArrayLiteral(elements: readonly Expression[], varName: string | undefined, location: SourceLocation, emptyElementType?: URType): { ref: IRValueRef; type: URType } | null {
    if (elements.length === 0) {
      if (varName === undefined || emptyElementType === undefined || emptyElementType.kind === "Unknown") {
        this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `empty array literal requires a declared array element type`, location);
        return null;
      }
      const slotId = this.nextSlotId++;
      const elementIRType: IRType = emptyElementType.kind === "Array" ? "array_ref" : toIRType(emptyElementType);
      this.locals.push({ id: slotId, name: varName, type: elementIRType, length: 0, isArray: true });
      this.varEnv.set(varName, { kind: "slot", slotId });
      const arrayType = tArray(emptyElementType);
      this.varTypes.set(varName, arrayType);
      return { ref: { id: -1, arraySlot: slotId }, type: arrayType };
    }
    const loweredElements: Array<{ ref: IRValueRef; type: URType }> = [];
    for (const el of elements) {
      const lowered = this.lowerExpr(el);
      if (!lowered) return null;
      loweredElements.push(lowered);
    }
    if (loweredElements[0]!.type.kind === "Array") {
      // v29-D4 (Gap A, Nested Literal Construction): the REAL general
      // case — an element that is itself an ArrayLiteral has ALREADY
      // lowered successfully, recursively, through this exact same
      // function (elements are lowered via lowerExpr() above, and a
      // nested ArrayLiteral is handled by the SAME "ArrayLiteral" case
      // in lowerExpr — confirmed directly, not assumed). Its own
      // result is already a real array reference
      // ({id:-1, arraySlot: innerSlotId}) — the SAME shape already
      // proven to flow correctly through call-argument encoding
      // (D2's own work). Per the ratified Nested Array Reference
      // Representation Contract, the outer array's own element type
      // is "array_ref" (a real, distinct IR type — not toIRType()'d,
      // exactly mirroring the same fix already applied to a int[][]
      // parameter's own element type in this file), and each element
      // is STORED as a reference (the inner array's own base address),
      // never a copy of the inner array's own contents.
      const elementIRType: IRType = "array_ref";
      const slotId = this.nextSlotId++;
      this.locals.push({ id: slotId, name: varName ?? `array_tmp_${slotId}`, type: elementIRType, length: elements.length, isArray: true });
      for (let i = 0; i < loweredElements.length; i++) {
        const idxId = this.freshId();
        this.instructions.push({ kind: "const", id: idxId, type: "i64", value: { kind: "const_int", value: BigInt(i) }, location });
        this.instructions.push({ kind: "array_store", slot: slotId, index: { id: idxId }, value: loweredElements[i]!.ref, location });
      }
      const arrayType = tArray(loweredElements[0]!.type);
      if (varName !== undefined) {
        this.varEnv.set(varName, { kind: "slot", slotId });
        this.varTypes.set(varName, arrayType);
      }
      return { ref: { id: -1, arraySlot: slotId }, type: arrayType };
    }
    // Gate V1-MIXED-STRUCT-ARRAY-REJECTION: a struct-typed array
    // element whose own real layout mixes scalar and reference
    // fields must be rejected here, with a real diagnostic — BEFORE
    // any IRLocalSlot is created for this array — per the already-
    // frozen Array<Struct> Language Contract (Gate R1.5-CGEN-002's
    // own Point 3). This does not affect homogeneous-scalar or
    // homogeneous-reference struct elements at all.
    if (loweredElements[0]!.type.kind === "Struct") {
      const layout = this.structLayouts.get(loweredElements[0]!.type.name);
      if (layout && !this.isStructArrayElementHomogeneous(layout)) {
        this.rejectMixedStructArrayElement(loweredElements[0]!.type.name, location);
        return null;
      }
    }
    const elementIRType = toIRType(loweredElements[0]!.type);
    const slotId = this.nextSlotId++;
    this.locals.push({ id: slotId, name: varName ?? `array_tmp_${slotId}`, type: elementIRType, length: elements.length, isArray: true });
    for (let i = 0; i < loweredElements.length; i++) {
      const idxId = this.freshId();
      this.instructions.push({ kind: "const", id: idxId, type: "i64", value: { kind: "const_int", value: BigInt(i) }, location });
      this.instructions.push({ kind: "array_store", slot: slotId, index: { id: idxId }, value: loweredElements[i]!.ref, location });
    }
    const arrayType = tArray(loweredElements[0]!.type);
    if (varName !== undefined) {
      this.varEnv.set(varName, { kind: "slot", slotId });
      this.varTypes.set(varName, arrayType);
    }
    return { ref: { id: -1, arraySlot: slotId }, type: arrayType };
  }

  private lowerExpr(expr: Expression): { ref: IRValueRef; type: URType } | null {
    const location = this.loc(expr.span);

    switch (expr.kind) {
      case "ArrayLiteral": {
        // General expression position (e.g. `sum([1,2,3])`, a direct
        // call argument) - routed through the SAME single, shared
        // lowerArrayLiteral used by VariableDeclaration (see its own
        // doc comment above). Closes Defer Log Item 1's own real
        // implementation gap (ADR-004): the readiness point is the
        // same as VariableDeclaration's own case, confirmed via real
        // AST-level evidence, not assumed.
        return this.lowerArrayLiteral(expr.elements, undefined, location);
      }
      case "IntLiteral": {
        const id = this.freshId();
        this.instructions.push({ kind: "const", id, type: "i64", value: { kind: "const_int", value: BigInt(expr.value) }, location });
        this.valueTypes.set(id, T_INT);
        return { ref: { id }, type: T_INT };
      }
      case "FloatLiteral": {
        const id = this.freshId();
        this.instructions.push({ kind: "const", id, type: "f64", value: { kind: "const_float", value: expr.value }, location });
        this.valueTypes.set(id, T_FLOAT);
        return { ref: { id }, type: T_FLOAT };
      }
      case "BoolLiteral": {
        const id = this.freshId();
        this.instructions.push({ kind: "const", id, type: "bool", value: { kind: "const_bool", value: expr.value }, location });
        this.valueTypes.set(id, T_BOOL);
        return { ref: { id }, type: T_BOOL };
      }
      case "StringLiteral": {
        const id = this.freshId();
        this.instructions.push({ kind: "const", id, type: "string", value: { kind: "const_string", value: expr.value }, location });
        this.valueTypes.set(id, T_STRING);
        return { ref: { id }, type: T_STRING };
      }
      case "CharLiteral": {
        // V1-STABILIZATION-S1 (ratified Design): char is a Unicode scalar
        // value (U+0000..U+10FFFF) per UR_LANGUAGE_SPEC_1_0.md §6.1 — an
        // integer, not a string. Lowered as a real i64 const, using the
        // literal's own real Unicode code point (codePointAt(0) is
        // code-point-aware, not UTF-16-code-unit-based — correct even for
        // surrogate-pair characters beyond the Basic Multilingual Plane).
        const id = this.freshId();
        this.instructions.push({ kind: "const", id, type: "i64", value: { kind: "const_int", value: BigInt(expr.value.codePointAt(0)!) }, location });
        this.valueTypes.set(id, T_CHAR);
        return { ref: { id }, type: T_CHAR };
      }
      case "Identifier": {
        // REAL FIX (CG9001, per LANGUAGE_SYNTAX_1_1_SPEC.md §2.5's own
        // ratified "Parameter passing: BY VALUE" requirement — this is
        // NOT deferred ABI design, it is an official v1.0 requirement):
        // a plain identifier referring to an EXISTING struct variable
        // (as opposed to `p.x` — MemberExpression, already handled) must
        // resolve to the WHOLE struct value, via its own slot — checked
        // before the ordinary SSA varEnv lookup, since a struct's own
        // identity lives in structVarSlot, not varEnv.
        const structVar = this.structVarSlot.get(expr.name);
        if (structVar) {
          const structType = this.varTypes.get(expr.name) ?? T_UNKNOWN;
          return { ref: { id: -1, structSlot: structVar.slotId }, type: structType };
        }
        // Stage 7E Remediation (per direct instruction): the exact
        // array-shaped counterpart to the structVarSlot check
        // immediately above, narrowly scoped to a plain identifier
        // referring to a known, slot-backed array variable - mirrors
        // its position and shape exactly. Without this, `return arr`
        // (or `arr` used bare anywhere else) fell through to the
        // generic SSA-based resolveVar path below, which has no way
        // to represent "this identifier is a whole array" - exactly
        // the gap Stage 7D localized.
        const arrBinding = this.varEnv.get(expr.name);
        const arrType = this.varTypes.get(expr.name);
        if (arrBinding?.kind === "slot" && arrType?.kind === "Array") {
          return { ref: { id: -1, arraySlot: arrBinding.slotId }, type: arrType };
        }
        const resolved = this.resolveVar(expr.name, location);
        if (!resolved) {
          // Precondition violation: Semantic already guarantees this name
          // resolves. Reaching here means either an out-of-scope construct
          // slipped through, or a genuine internal-error bug.
          this.error(CODEGEN_CODES.INTERNAL_ERROR, `internal error: unresolved identifier '${expr.name}' during IR lowering (Semantic should have caught this)`, location);
          return null;
        }
        return resolved;
      }
      case "BinaryExpression": {
        const left = this.lowerExpr(expr.left);
        const right = this.lowerExpr(expr.right);
        if (!left || !right) return null;
        const op = BINOP_MAP[expr.operator];
        if (!op) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `unsupported binary operator '${expr.operator}' in this Level 2 phase`, location);
          return null;
        }
        const resultType = binaryOpResultType(expr.operator, left.type, right.type);
        // Gate V1-STRUCT-EQUALITY-FLAT: `==`/`!=` on two Struct-kind
        // operands is desugared HERE, at Lowering, into a field-by-
        // field comparison — per the corrected, ratified contract
        // (LANGUAGE_SYNTAX_1_1_SPEC.md §2.4, point 2, as amended by
        // Gate V1-STRUCT-EQUALITY-CONTRACT-CORRECTION): ALL fields are
        // evaluated (no short-circuit), combined with logical AND.
        // Uses ONLY existing IR instruction kinds (field_load, binop,
        // unop, const) — the SAME field_load+structSlot pattern
        // already proven elsewhere in this file (e.g. struct-to-struct
        // copy assignment) — no new IRType, no new instruction kind,
        // no CFG/branching change. TypeChecker (run before Lowering in
        // the real pipeline) already rejects mismatched struct names
        // or non-Struct operands (TY3001); this code only runs once
        // both operands are confirmed to be the SAME Struct type.
        if ((expr.operator === "==" || expr.operator === "!=") && left.type.kind === "Struct" && right.type.kind === "Struct") {
          const layout = this.structLayouts.get(left.type.name);
          if (layout && left.ref.structSlot !== undefined && right.ref.structSlot !== undefined) {
            let resultId: number;
            if (layout.fields.length === 0) {
              // Vacuous case: a struct with zero fields is trivially
              // equal to itself — no fields to differ.
              resultId = this.freshId();
              this.instructions.push({ kind: "const", id: resultId, type: "bool", value: { kind: "const_bool", value: true }, location });
            } else {
              let accId: number | null = null;
              for (let i = 0; i < layout.fields.length; i++) {
                const field = layout.fields[i]!;
                const leftFieldId = this.freshId();
                this.instructions.push({ kind: "field_load", id: leftFieldId, type: field.type, slot: left.ref.structSlot, fieldIndex: i, location });
                const rightFieldId = this.freshId();
                this.instructions.push({ kind: "field_load", id: rightFieldId, type: field.type, slot: right.ref.structSlot, fieldIndex: i, location });
                const eqId = this.freshId();
                this.instructions.push({ kind: "binop", id: eqId, type: "bool", op: "eq", left: { id: leftFieldId }, right: { id: rightFieldId }, location });
                if (accId === null) {
                  accId = eqId;
                } else {
                  const andId = this.freshId();
                  this.instructions.push({ kind: "binop", id: andId, type: "bool", op: "and", left: { id: accId }, right: { id: eqId }, location });
                  accId = andId;
                }
              }
              resultId = accId!;
            }
            if (expr.operator === "!=") {
              const notId = this.freshId();
              this.instructions.push({ kind: "unop", id: notId, type: "bool", op: "not", operand: { id: resultId }, location });
              resultId = notId;
            }
            this.valueTypes.set(resultId, T_BOOL);
            return { ref: { id: resultId }, type: T_BOOL };
          }
        }
        const id = this.freshId();
        this.instructions.push({ kind: "binop", id, type: toIRType(resultType), op, left: left.ref, right: right.ref, location });
        this.valueTypes.set(id, resultType);
        return { ref: { id }, type: resultType };
      }
      case "UnaryExpression": {
        const operand = this.lowerExpr(expr.operand);
        if (!operand) return null;
        const op = UNOP_MAP[expr.operator];
        if (!op) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `unsupported unary operator '${expr.operator}' in this Level 2 phase`, location);
          return null;
        }
        const resultType = unaryOpResultType(expr.operator, operand.type);
        const id = this.freshId();
        this.instructions.push({ kind: "unop", id, type: toIRType(resultType), op, operand: operand.ref, location });
        this.valueTypes.set(id, resultType);
        return { ref: { id }, type: resultType };
      }
      case "CallExpression": {
        // Struct construction as a general expression (e.g. `return
        // Point(a, b)`, per PRIORITY_2 stabilization) — routed through
        // the SAME single, shared lowerStructConstruction used by
        // VariableDeclaration (see its own doc comment). Checked
        // first; falls through unchanged to every other real call
        // kind below if this isn't a struct construction at all.
        {
          const structResult = this.lowerStructConstruction(expr, undefined, this.loc(expr.span));
          if (structResult === "failed") return null;
          if (structResult !== "not_a_struct_construction" && structResult !== null) return structResult;
        }
        // Stage 3.1 — Native Library Registry member-call support.
        // `x.y(...)` is checked FIRST against the registry, before the
        // general "member-call not supported" rejection. Per explicit
        // scope: this is NOT general member-call support — it activates
        // ONLY when `x` is both (a) an identifier actually `import`ed in
        // this program, AND (b) a name present in the Native Library
        // Registry. Any other member-call shape (including a call on an
        // ordinary variable, or an imported-but-unregistered name) falls
        // straight through to the existing, unmodified rejection below —
        // this is what makes "calling on a normal object is rejected"
        // work automatically, with no separate check needed for it.
        if (expr.callee.kind === "MemberExpression" && expr.callee.object.kind === "Identifier") {
          const libName = expr.callee.object.name;
          const methodName = expr.callee.property;
          const libEntry = lookupNativeLibrary(libName);
          if (libEntry) {
            if (!this.importedNames.has(libName)) {
              this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${libName}' is a known native library, but is not imported in this file — add 'import ${libName}' before calling '${libName}.${methodName}(...)'`, location);
              return null;
            }
            const fnSig = lookupNativeFunction(libName, methodName);
            if (!fnSig) {
              this.error(CODEGEN_CODES.UNRESOLVED_CALL, `'${libName}.${methodName}' is not a registered function on native library '${libName}'`, location);
              return null;
            }
            if (expr.args.length !== fnSig.paramTypes.length) {
              this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `${libName}.${methodName}() requires exactly ${fnSig.paramTypes.length} argument(s), got ${expr.args.length}`, location);
              return null;
            }
            const loweredArgs: IRValueRef[] = [];
            for (let i = 0; i < expr.args.length; i++) {
              const lowered = this.lowerExpr(expr.args[i]!);
              if (!lowered) return null;
              const actualType = toIRType(lowered.type);
              const expectedType = fnSig.paramTypes[i]!;
              if (actualType !== expectedType) {
                this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `${libName}.${methodName}() argument ${i + 1}: expected '${expectedType}', got '${actualType}'`, location);
                return null;
              }
              loweredArgs.push(lowered.ref);
            }
            // Register exactly one ExternSymbol per distinct native
            // function actually called anywhere in the module — a
            // Map keyed by symbol name naturally de-duplicates repeated
            // calls to the same function across the program.
            if (!this.ffiExterns.has(fnSig.symbol)) {
              this.ffiExterns.set(fnSig.symbol, {
                name: fnSig.symbol,
                returnType: fnSig.returnType,
                parameterTypes: fnSig.paramTypes,
                callingConvention: "c",
                kind: "ffi",
                lifecycleRole: "none",
                sourceLibraryPath: libEntry.libraryPath,
                cReturnType: fnSig.cReturnType,
                cParameterTypes: fnSig.cParamTypes,
                outParam: fnSig.outParam,
              });
            }
            const id = this.freshId();
            // Stage 3.2: the call instruction targets the WRAPPER name
            // (see emit-c.ts's own emitFfiWrapper), never the raw symbol
            // directly — the wrapper is what performs the real-C-type ->
            // UR-internal-type cast safely, with a correctly-declared
            // extern prototype underneath it.
            this.instructions.push({ kind: "call", id, type: fnSig.returnType, callee: `__ur_ffi_${fnSig.symbol}`, args: loweredArgs, location });
            const resultType = fnSig.returnType === "string" ? T_STRING : fnSig.returnType === "bool" ? T_BOOL : fnSig.returnType === "f64" ? T_FLOAT : fnSig.returnType === "i64" ? T_INT : T_UNKNOWN;
            this.valueTypes.set(id, resultType);
            return { ref: { id }, type: resultType };
          }
        }
        if (expr.callee.kind !== "Identifier") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `only direct calls to a named function are supported in this Level 2 phase (no member-call/computed-call)`, location);
          return null;
        }
        const calleeName = expr.callee.name;

        // User-defined functions always take precedence over builtins —
        // a UR program defining its own `print`/`input` function is not
        // silently overridden by the Runtime builtin dispatch below.
        const sig = this.functionSignatures.get(calleeName);
        if (sig) {
          const args: IRValueRef[] = [];
          for (const a of expr.args) {
            // Array-by-reference argument support (Priority 3
            // Stabilization Sprint): scoped precisely to THIS position
            // (a real function-call argument) - a bare array-identifier
            // resolves to its own existing slot here, matching struct-
            // by-value's own precedent, WITHOUT touching the general
            // Identifier-lowering rejection that correctly still
            // applies everywhere else (e.g. `return a`).
            if (a.kind === "Identifier") {
              const binding = this.varEnv.get(a.name);
              const argType = this.varTypes.get(a.name);
              if (binding && binding.kind === "slot" && argType?.kind === "Array") {
                args.push({ id: -1, arraySlot: binding.slotId });
                continue;
              }
            }
            const lowered = this.lowerExpr(a);
            if (!lowered) return null;
            args.push(lowered.ref);
          }
          // Struct-return support (Priority 2, Solution A — ratified:
          // the callee genuinely returns the struct by value, same
          // real philosophy as struct-by-value parameters). The
          // returned slot is unnamed here (a real, compiler-
          // synthesized slot, exactly as lowerStructConstruction's own
          // doc comment describes) — VariableDeclaration registers it
          // under a real name afterward, when this call is a `let`'s
          // own initializer.
          if (sig.returnType.kind === "Struct") {
            const layout = this.structLayouts.get(sig.returnType.name);
            if (layout) {
              const slotId = this.nextSlotId++;
              this.locals.push({ id: slotId, name: `struct_tmp_${slotId}`, type: "void", structLayout: layout });
              this.instructions.push({ kind: "call", id: -1, type: "void", callee: sig.qualifiedName, args, location, resultStructSlot: slotId });
              return { ref: { id: -1, structSlot: slotId }, type: sig.returnType };
            }
          }
          // Array-return support (Gate 2R Remediation, per direct
          // instruction): mirrors the Struct-return pattern immediately
          // above verbatim. Arrays are ALWAYS slot-backed (never plain
          // SSA — one SSA id cannot represent multiple elements, per
          // lowerArrayLiteral's own established invariant), so a
          // function that returns an array needs the exact same kind
          // of compiler-synthesized slot a struct-returning call
          // already gets, threaded through the call instruction so the
          // interpreter can materialize the real array into that slot.
          // VariableDeclaration registers it under a real name
          // afterward, exactly as it already does for the Struct case.
          if (sig.returnType.kind === "Array") {
            // Gate V1-MIXED-STRUCT-ARRAY-REJECTION: same rejection as
            // the array-literal case, applied here for a function
            // whose own declared return type is Array<Struct> with a
            // mixed-field struct element.
            if (sig.returnType.element.kind === "Struct") {
              const layout = this.structLayouts.get(sig.returnType.element.name);
              if (layout && !this.isStructArrayElementHomogeneous(layout)) {
                this.rejectMixedStructArrayElement(sig.returnType.element.name, location);
                return null;
              }
            }
            const slotId = this.nextSlotId++;
            this.locals.push({ id: slotId, name: `array_tmp_${slotId}`, type: toIRType(sig.returnType.element), isArray: true, isArrayResult: true });
            this.instructions.push({ kind: "call", id: -1, type: "void", callee: sig.qualifiedName, args, location, resultArraySlot: slotId });
            return { ref: { id: -1, arraySlot: slotId }, type: sig.returnType };
          }
          const id = this.freshId();
          this.instructions.push({ kind: "call", id, type: toIRType(sig.returnType), callee: sig.qualifiedName, args, location });
          this.valueTypes.set(id, sig.returnType);
          return { ref: { id }, type: sig.returnType };
        }

        // Builtins (Level 2.5): print/input/free. Each UR-source identifier
        // is looked up in the Builtins Registry (Semantic's
        // builtins-registry.ts, via its shared BuiltinId) and resolved to
        // a concrete Runtime extern via resolveBuiltinExtern()
        // (src/shared/runtime-table.ts) — the ONLY function in the
        // compiler that knows concrete Runtime C function names. This
        // file (lower-to-ir.ts) never contains a Runtime name literal and
        // never guesses a callee by matching type signatures alone —
        // that approach was tried and found broken (ur_print_string,
        // ur_free, and ur_panic all share the exact (string)->void
        // signature; a structural-only match would have non-
        // deterministically picked the wrong one for `free()`).
        const builtin = lookupBuiltin(calleeName);
        if (builtin) {
          if (expr.args.length !== builtin.arity) {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `${calleeName}() requires exactly ${builtin.arity} argument(s), got ${expr.args.length}`, location);
            return null;
          }
          const loweredArgs: Array<{ ref: IRValueRef; type: URType }> = [];
          for (const a of expr.args) {
            const lowered = this.lowerExpr(a);
            if (!lowered) return null;
            loweredArgs.push(lowered);
          }
          // v29-D3-2 (Owner Authority): free() on an array argument is a
          // NEW, distinct capability from free(string) - dispatched here,
          // before the generic string-only extern check below, since
          // arrays report IR type "i64" (same as any scalar), which
          // resolveBuiltinExtern's own type-dispatch cannot distinguish
          // from a genuine scalar without slot-level information.
          //
          // Authority rule (per the ratified Free Authority Contract):
          // only an OWNING local array slot (isArray === true, and NOT
          // isArrayResult - array return is a separate, unauthorized
          // capability, deliberately excluded here too) may be freed.
          // A parameter (isArrayParam) or any other non-owning
          // reference is rejected at this point, at compile time - no
          // new IR field, no runtime check, no D2 ABI change: this
          // reuses the isArray/isArrayParam distinction the IR already
          // carries, exactly as the Contract specified.
          if (builtin.id === "Free" && loweredArgs[0]?.ref.arraySlot !== undefined) {
            const targetSlotId = loweredArgs[0].ref.arraySlot;
            const targetSlot = this.locals.find(s => s.id === targetSlotId);
            const isOwningArray = targetSlot?.isArray === true && targetSlot?.isArrayResult !== true;
            if (!isOwningArray) {
              this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT,
                `free() may only be called on an owning local array (a direct 'let' binding of an array literal), not a parameter or other non-owning reference — per the v29-D3 Free Authority Contract (Owner-only)`, location);
              return null;
            }
            // v29-D3-3: Owner Authority (D3-2, above) has already
            // granted permission at this point. Emit a real call to the
            // reclamation extern, using the EXACT same pattern D2's own
            // user-function calls already use for an array-slot
            // argument (args: loweredArgs.map(a => a.ref) — the
            // arraySlot-tagged reference flows through identically,
            // confirmed against the existing extern-call code
            // immediately below this block).
            //
            // B-1 Gate (D-1, known limitation — behaviour unchanged): the
            // former call passed a third argument (`true`) that
            // resolveBuiltinExtern (runtime-table.ts) does not declare
            // (TS2554); JavaScript ignored it, so this has ALWAYS resolved
            // to the generic "Free" extern, `ur_free` — no `ur_free_array`
            // extern is registered in RUNTIME_CORE_EXTERNS. The dead
            // argument is removed and the comment/message now state what
            // actually happens. Registering `ur_free_array` would be a new
            // capability (V29-D3 is NOT OPENED per ROADMAP_LOCK) and is
            // deliberately not done here: free(array) remains unsupported
            // on the C Backend in V1.0 (gcc rejects `ur_free(slot, n)`,
            // BE1001), exactly as in C5-r2.
            const freeArrayExtern = resolveBuiltinExtern("Free");
            if (!freeArrayExtern) {
              this.error(CODEGEN_CODES.INTERNAL_ERROR, `internal error: the "Free" builtin extern is not registered`, location);
              return null;
            }
            const freeArrayId = this.freshId();
            this.instructions.push({
              kind: "call", id: freeArrayId, type: freeArrayExtern.returnType, callee: freeArrayExtern.name,
              args: loweredArgs.map(a => a.ref), location,
            });
            this.valueTypes.set(freeArrayId, T_UNKNOWN);
            return { ref: { id: freeArrayId }, type: T_UNKNOWN };
          }
          // Print is the only overloaded builtin — its target extern
          // depends on the (single) argument's type. Input/Free are not
          // overloaded; resolveBuiltinExtern ignores the type argument
          // for them.
          const argIRType = loweredArgs.length > 0 ? toIRType(loweredArgs[0]!.type) : undefined;
          const extern = resolveBuiltinExtern(builtin.id, argIRType);
          if (!extern) {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `${calleeName}() is not supported for values of type '${argIRType}' in this phase`, location);
            return null;
          }
          // CONFIRMED BUG (fixed): resolving the extern by name alone
          // does not guarantee the CALLER's actual argument types match
          // its declared parameterTypes — found via free(42): it resolved
          // to ur_free (correct name) but passed an i64 constant where
          // ur_free's C signature expects `const char*`, which would have
          // compiled to a real type-mismatched C call. Every argument's
          // IRType is now checked against the resolved extern's declared
          // parameterTypes before emitting the call.
          for (let i = 0; i < loweredArgs.length; i++) {
            const actualType = toIRType(loweredArgs[i]!.type);
            const expectedType = extern.parameterTypes[i];
            if (expectedType !== undefined && actualType !== expectedType) {
              this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT,
                `${calleeName}() argument ${i + 1}: expected '${expectedType}', got '${actualType}'`, location);
              return null;
            }
          }
          const id = this.freshId();
          this.instructions.push({
            kind: "call", id, type: extern.returnType, callee: extern.name,
            args: loweredArgs.map(a => a.ref), location,
          });
          const resultType = extern.returnType === "string" ? T_STRING : T_UNKNOWN;
          this.valueTypes.set(id, resultType);
          return { ref: { id }, type: resultType };
        }

        this.error(CODEGEN_CODES.UNRESOLVED_CALL, `call to unresolved function '${calleeName}'`, location);
        return null;
      }
      case "MemberExpression": {
        // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.2: `p.x` field read.
        // REVISED: uses the real field_load instruction against the
        // struct variable's own single slot + structLayout, per
        // STRUCT_IR_DESIGN.md/STRUCT_MEMORY_LAYOUT.md — not the prior
        // per-field-slot bookkeeping.
        if (expr.object.kind !== "Identifier") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `field access target must be a plain variable (e.g. 'p.x'), not a more complex expression`, location);
          return null;
        }
        const objectName = expr.object.name;
        const objectType = this.varTypes.get(objectName);
        const arrayBinding = this.varEnv.get(objectName);

        if (
          expr.property === "length" &&
          objectType?.kind === "Array" &&
          arrayBinding?.kind === "slot"
        ) {
          const id = this.freshId();
          this.instructions.push({
            kind: "array_length",
            id,
            type: "i64",
            slot: arrayBinding.slotId,
            location,
          });
          this.valueTypes.set(id, T_INT);
          return { ref: { id }, type: T_INT };
        }

        const varSlot = this.structVarSlot.get(expr.object.name);
        if (!varSlot) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${expr.object.name}' is not a known struct variable`, location);
          return null;
        }
        const fieldIndex = varSlot.layout.fields.findIndex(f => f.name === expr.property);
        if (fieldIndex === -1) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `internal error: field '${expr.property}' not found on '${expr.object.name}' during Lowering (Semantic/TypeChecker should have caught this)`, location);
          return null;
        }
        const fieldIrType = varSlot.layout.fields[fieldIndex]!.type;
        const structType = this.varTypes.get(expr.object.name);
        const fieldUrType = structType && structType.kind === "Struct" ? structType.fields.find(f => f.name === expr.property)?.type : undefined;
        const id = this.freshId();
        this.instructions.push({ kind: "field_load", id, type: fieldIrType, slot: varSlot.slotId, fieldIndex, location });
        this.valueTypes.set(id, fieldUrType ?? T_UNKNOWN);
        return { ref: { id }, type: fieldUrType ?? T_UNKNOWN };
      }
      case "IndexExpression": {
        // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1: `arr[i]` read access.
        // v29-D4 (Nested Array Model, first vertical slice): a nested
        // target (`a[i][j]` — expr.object is ITSELF an IndexExpression,
        // not a plain Identifier) is permitted here, but ONLY when the
        // outer access's own lowered TYPE confirms it is a real array
        // reference (Array-kind, per the type system's own already-
        // correct nested representation — resolveTypeRef already wraps
        // int[][] as Array<Array<int>>, confirmed directly before this
        // change was written) — per the ratified Nested Array
        // Reference Representation Contract: outer[i] yields a
        // reference (base address only), which becomes the SECOND
        // load's own baseRef, never a copy of the inner array's own
        // length. Any other non-Identifier target remains rejected,
        // unchanged.
        if (expr.object.kind !== "Identifier") {
          if (expr.object.kind === "IndexExpression" || expr.object.kind === "MemberExpression") {
            // v29-D5 (Slice 3, C Contract §3): a struct field access
            // (`b.values[1]`, expr.object.kind === "MemberExpression")
            // is handled by the IDENTICAL mechanism D4 already proved
            // for a nested array index (`a[i][j]`) — lower the outer
            // access first (here, an ordinary field_load, already
            // correctly typed as "array_ref" per Slice 2's own fix),
            // confirm its own result is a real array reference, then
            // feed it as this array_load's own baseRef. This is a
            // direct, natural use of the EXISTING baseRef mechanism
            // (ir.ts's own documentation already states it accepts any
            // IRValueRef producing an array_ref value — never
            // restricted to "must originate from another array_load"
            // specifically) — no new IR instruction, no new backend
            // mechanism, only widening which expression kinds may
            // supply baseRef's own value.
            const outer = this.lowerExpr(expr.object);
            if (!outer) return null;
            if (outer.type.kind !== "Array") {
              this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `array indexing target must itself be an array reference (got a non-array result from the outer expression)`, location);
              return null;
            }
            const idx = this.lowerExpr(expr.index);
            if (!idx) return null;
            const innerElementType = outer.type.element;
            const id = this.freshId();
            // slot: -1 is the required sentinel per baseRef's own
            // contract (ir.ts) — there is no fixed local slot for a
            // dynamically-obtained inner array reference; any backend
            // path not yet updated for baseRef must fail loudly on an
            // invalid slot id rather than silently misreading slot -1
            // as a real local.
            // v29-D5 (Slice 3): innerElementType may ITSELF be Array-
            // kind (e.g. g.rows[1] where g.rows: int[][] — the field
            // access adds one more level of indirection before the
            // array chain even begins, so a depth-2 field produces a
            // 3-deep access here). This exact toIRType(Array) gap was
            // already found and fixed twice before (a parameter's own
            // element type, D4; a struct field's own type, D5 Slice 2)
            // — it was never triggered at THIS specific call site
            // before, because D4's own scope was strictly depth-2 only
            // (int[][], never reaching a third level) — confirmed
            // directly by a real gcc error this round ("v12 declared
            // void") before this fix.
            const innerIrType = innerElementType.kind === "Array" ? "array_ref" : toIRType(innerElementType);
            this.instructions.push({ kind: "array_load", id, type: innerIrType, slot: -1, index: idx.ref, location, baseRef: outer.ref });
            this.valueTypes.set(id, innerElementType);
            return { ref: { id }, type: innerElementType };
          }
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `array indexing target must be a plain variable (e.g. 'arr[i]'), not a more complex expression`, location);
          return null;
        }
        const binding = this.varEnv.get(expr.object.name);
        if (!binding || binding.kind !== "slot") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${expr.object.name}' is not a known array variable`, location);
          return null;
        }
        const slot = this.locals.find(s => s.id === binding.slotId);
        if (!slot || (!slot.length && !slot.isArrayParam && !slot.isArrayResult)) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${expr.object.name}' is not an array`, location);
          return null;
        }
        const idx = this.lowerExpr(expr.index);
        if (!idx) return null;
        const varType = this.varTypes.get(expr.object.name);
        const elementType = varType && varType.kind === "Array" ? varType.element : T_UNKNOWN;
        const id = this.freshId();
        this.instructions.push({ kind: "array_load", id, type: slot.type, slot: slot.id, index: idx.ref, location });
        this.valueTypes.set(id, elementType);
        return { ref: { id }, type: elementType };
      }
      default:
        this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `expression kind '${expr.kind}' is not supported in this Level 2 phase (scope: literals, identifiers, binary/unary ops, direct calls)`, location);
        return null;
    }
  }

  // ── Statement lowering ─────────────────────────────────────────────────────

  /** Returns false if lowering failed (diagnostic already recorded) or a terminator was already emitted (stop lowering further statements). */
  /**
   * Single source of truth for lowering a struct-constructor call
   * (`Point(1, 2)`) into a real slot + field_store sequence. Used by
   * BOTH `VariableDeclaration` (`let p = Point(1, 2)`, where `varName`
   * is the real, named variable) and any other expression position
   * (`return Point(1, 2)`, where `varName` is undefined — a real,
   * compiler-synthesized slot with no name, exactly as
   * STRUCT_IR_DESIGN_V2.md's own §1 "Slot + Layout" cost disclosure
   * predicted: "an intermediate struct expression not bound to a let
   * needs a compiler-synthesized slot"). Extracted per direct
   * instruction — a single function, not duplicated logic, so a
   * future third call site (e.g. `foo(Point(1, 2))`) needs one change,
   * not three.
   *
   * Returns `null` if `expr` is not a struct-constructor call at all
   * (caller should fall through to its own next check) — NOT the same
   * as a real lowering failure (`"failed"`), which is signaled via
   * `this.error(...)` having already been called and a real, distinct
   * sentinel return.
   */
  private lowerStructConstruction(expr: Expression, varName: string | undefined, location: SourceLocation): { ref: IRValueRef; type: URType } | null | "not_a_struct_construction" | "failed" {
    if (expr.kind !== "CallExpression" || expr.callee.kind !== "Identifier") return "not_a_struct_construction";
    const structName = expr.callee.name;
    const layout = this.structLayouts.get(structName);
    // A same-named user function takes precedence (matches Semantic's
    // identical precedence rule) — only treat this as construction if
    // no ordinary function of this name exists.
    if (!layout || this.functionSignatures.has(structName)) return "not_a_struct_construction";

    const args = expr.args;
    const slotId = this.nextSlotId++;
    this.locals.push({ id: slotId, name: varName ?? `struct_tmp_${slotId}`, type: "void", structLayout: layout });
    if (varName !== undefined) this.structVarSlot.set(varName, { slotId, layout });
    for (let i = 0; i < layout.fields.length; i++) {
      const field = layout.fields[i]!;
      const argExpr = args[i];
      if (!argExpr) { this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `internal error: struct construction arity mismatch reached Lowering (Semantic should have caught this)`, location); return "failed"; }
      const lowered = this.lowerExpr(argExpr);
      if (!lowered) return "failed";
      this.instructions.push({ kind: "field_store", slot: slotId, fieldIndex: i, value: lowered.ref, location });
      void field; // field itself only needed for its own index/offset, already captured by fieldIndex
    }
    const realStructType = this.structUrTypes.get(structName);
    const structType = realStructType ?? tStruct(structName, layout.fields.map(f => ({ name: f.name, type: T_UNKNOWN })));
    if (varName !== undefined) this.varTypes.set(varName, structType);
    return { ref: { id: -1, structSlot: slotId }, type: structType };
  }

  private lowerStatement(stmt: Statement): "continue" | "terminated" | "terminated_and_pushed" | "failed" {
    const location = this.loc(stmt.span);

    switch (stmt.kind) {
      case "VariableDeclaration": {
        if (!stmt.initializer) {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `variable declarations without an initializer are not supported in this Level 2 phase`, location);
          return "failed";
        }
        // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.7: struct
        // construction (`let p = Point(1, 2)`) — now routed through
        // the single, shared lowerStructConstruction (see its own
        // doc comment above) — same real behavior as before, byte-
        // for-byte, just no longer duplicated.
        {
          const result = this.lowerStructConstruction(stmt.initializer, stmt.name, location);
          if (result === "failed") return "failed";
          if (result !== "not_a_struct_construction" && result !== null) return "continue";
        }
        // Priority 2 (Struct Return, Solution A): `let p = makePoint(...)`
        // where `makePoint` is a real, user-defined function whose own
        // return type is a struct — NOT a direct struct-constructor
        // call (that's the case immediately above). Checks the
        // callee's own real return type FIRST (before calling
        // lowerExpr at all) — a real bug was found and fixed here
        // during this same implementation: calling lowerExpr
        // unconditionally for ANY function call (even a plain
        // int-returning one) caused it to be lowered once here, then
        // fall through with no `return`, reaching the general
        // fallback path below and being lowered AGAIN - a real,
        // confirmed double-call bug (caught via the full regression
        // suite, tests/codegen/golden/golden.test.ts's own
        // 08-arabic-keywords case, which has no struct involved at
        // all yet still called its own function twice). Fixed by
        // checking `sig.returnType.kind === "Struct"` first — only
        // then is lowerExpr called here at all, guaranteed to
        // produce a real structSlot, never falling through.
        if (stmt.initializer.kind === "CallExpression" && stmt.initializer.callee.kind === "Identifier") {
          const sig = this.functionSignatures.get(stmt.initializer.callee.name);
          if (sig && sig.returnType.kind === "Struct") {
          const lowered = this.lowerExpr(stmt.initializer);
          if (!lowered) return "failed";
          if (lowered.ref.structSlot !== undefined) {
            const slotId = lowered.ref.structSlot;
            const layout = this.locals.find(l => l.id === slotId)?.structLayout;
            if (layout) {
              this.structVarSlot.set(stmt.name, { slotId, layout });
              this.varTypes.set(stmt.name, lowered.type);
              // Rename the compiler-synthesized slot to the real,
              // user-given name for readability in emitted C — a
              // real, cosmetic-only change (the slot id itself,
              // which every reference actually uses, is unchanged).
              const localIndex = this.locals.findIndex(l => l.id === slotId);
              if (localIndex !== -1) this.locals[localIndex] = { ...this.locals[localIndex]!, name: stmt.name };
              return "continue";
            }
          }
          }
        }
        // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.3: struct copy
        // (`let q = p`, where `p` is a known struct-typed variable).
        // REVISED: allocates ONE new slot for `q` (sharing the SAME
        // structLayout object as `p`'s slot — the layout is immutable,
        // structural data, safe to share) and copies every field via
        // real field_load+field_store pairs — a real, minimal
        // (exactly N loads + N stores for N fields), fully independent
        // duplication. No aliasing is possible afterward, since `q`'s
        // own slot is entirely separate storage from `p`'s.
        if (stmt.initializer.kind === "Identifier" && this.structVarSlot.has(stmt.initializer.name)) {
          const source = this.structVarSlot.get(stmt.initializer.name)!;
          const sourceType = this.varTypes.get(stmt.initializer.name);
          const newSlotId = this.nextSlotId++;
          this.locals.push({ id: newSlotId, name: stmt.name, type: "void", structLayout: source.layout });
          for (let i = 0; i < source.layout.fields.length; i++) {
            const loadId = this.freshId();
            this.instructions.push({ kind: "field_load", id: loadId, type: source.layout.fields[i]!.type, slot: source.slotId, fieldIndex: i, location });
            this.instructions.push({ kind: "field_store", slot: newSlotId, fieldIndex: i, value: { id: loadId }, location });
          }
          this.structVarSlot.set(stmt.name, { slotId: newSlotId, layout: source.layout });
          if (sourceType) this.varTypes.set(stmt.name, sourceType);
          return "continue";
        }
        // Stage 3B Remediation (per direct instruction, Option A):
        // `let t0 = arr[i]` where `arr` is a known array of structs.
        // Narrowly scoped to exactly this shape - IndexExpression on a
        // known array-of-struct variable - not any other Composite
        // Value path. Loads the indexed element via the array's own
        // existing arraySlot (array_load is already proven correct for
        // struct elements, per A1's own Localization Gate), stores that
        // real struct value into a fresh, compiler-synthesized struct
        // slot, then registers structVarSlot exactly as the three
        // branches above already do for their own initializer shapes.
        if (stmt.initializer.kind === "IndexExpression" && stmt.initializer.object.kind === "Identifier") {
          const arrBinding = this.varEnv.get(stmt.initializer.object.name);
          const elementType = this.varTypes.get(stmt.initializer.object.name);
          if (arrBinding?.kind === "slot" && elementType?.kind === "Array" && elementType.element.kind === "Struct") {
            const layout = this.structLayouts.get(elementType.element.name);
            if (layout) {
              const idx = this.lowerExpr(stmt.initializer.index);
              if (!idx) return "failed";
              const elemId = this.freshId();
              this.instructions.push({ kind: "array_load", id: elemId, type: "void", slot: arrBinding.slotId, index: idx.ref, location });
              const newSlotId = this.nextSlotId++;
              this.locals.push({ id: newSlotId, name: stmt.name, type: "void", structLayout: layout });
              this.instructions.push({ kind: "store", slot: newSlotId, value: { id: elemId }, location });
              this.structVarSlot.set(stmt.name, { slotId: newSlotId, layout });
              this.varTypes.set(stmt.name, elementType.element);
              return "continue";
            }
          }
        }
        // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1: an array literal
        // initializer always creates a NEW array slot directly — arrays
        // are ALWAYS slot-backed (never plain SSA), since one SSA id
        // cannot represent multiple elements. This is a distinct path
        // from the generic lowerExpr()+assignVar() used for scalars.
        if (stmt.initializer.kind === "ArrayLiteral") {
          const declaredType = stmt.type ? resolveTypeRef(stmt.type) : undefined;
          const emptyElementType = declaredType?.kind === "Array" ? declaredType.element : undefined;
          const result = this.lowerArrayLiteral(stmt.initializer.elements, stmt.name, location, emptyElementType);
          if (!result) return "failed";
          return "continue";
        }
        const lowered = this.lowerExpr(stmt.initializer);
        if (!lowered) return "failed";
        if (lowered.ref.arraySlot !== undefined) {
          this.varEnv.set(stmt.name, { kind: "slot", slotId: lowered.ref.arraySlot });
          this.varTypes.set(stmt.name, lowered.type);
          return "continue";
        }
        this.assignVar(stmt.name, lowered, location);
        return "continue";
      }
      case "Assignment": {
        if (stmt.target.kind === "MemberExpression") {
          // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §2.2/§2.3: `p.x = value`
          // field assignment — a store into that field's OWN slot, never
          // touching any other struct variable's fields (matches value-
          // copy semantics: `q = p` already gave `q` fully independent
          // field slots, so `q.x = 10` here can never affect `p.x`).
          if (stmt.target.object.kind !== "Identifier") {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `field assignment target must be a plain variable (e.g. 'p.x = value'), not a more complex expression`, location);
            return "failed";
          }
          const varSlot = this.structVarSlot.get(stmt.target.object.name);
          if (!varSlot) {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${stmt.target.object.name}' is not a known struct variable`, location);
            return "failed";
          }
          const targetProperty = stmt.target.property;
          const fieldIndex = varSlot.layout.fields.findIndex(f => f.name === targetProperty);
          if (fieldIndex === -1) {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `internal error: field '${targetProperty}' not found on '${stmt.target.object.name}' during Lowering`, location);
            return "failed";
          }
          const value = this.lowerExpr(stmt.value);
          if (!value) return "failed";
          this.instructions.push({ kind: "field_store", slot: varSlot.slotId, fieldIndex, value: value.ref, location });
          return "continue";
        }
        if (stmt.target.kind === "IndexExpression") {
          // Level 2.8: `arr[i] = value` — array element assignment.
          if (stmt.target.object.kind !== "Identifier") {
            if (stmt.target.object.kind === "IndexExpression" || stmt.target.object.kind === "MemberExpression") {
              // v29-D5 (Slice 3, C Contract §3): the write-side mirror
              // of the read-side extension above — `b.values[i] = x`
              // (object.kind === "MemberExpression") or a nested
              // `a[i][j] = x` (object.kind === "IndexExpression", D4's
              // own case, now also reachable from a statement target,
              // not only an expression) both lower the outer access
              // first, confirm it is a real array reference, then use
              // its own result as this array_store's own baseRef —
              // identical reasoning to the read-side fix.
              const outer = this.lowerExpr(stmt.target.object);
              if (!outer) return "failed";
              if (outer.type.kind !== "Array") {
                this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `array assignment target must itself be an array reference (got a non-array result from the outer expression)`, location);
                return "failed";
              }
              const idx = this.lowerExpr(stmt.target.index);
              if (!idx) return "failed";
              const value = this.lowerExpr(stmt.value);
              if (!value) return "failed";
              this.instructions.push({ kind: "array_store", slot: -1, index: idx.ref, value: value.ref, location, baseRef: outer.ref });
              return "continue";
            }
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `array assignment target must be a plain variable (e.g. 'arr[i] = x'), not a more complex expression`, location);
            return "failed";
          }
          const binding = this.varEnv.get(stmt.target.object.name);
          if (!binding || binding.kind !== "slot") {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${stmt.target.object.name}' is not a known array variable`, location);
            return "failed";
          }
          const idx = this.lowerExpr(stmt.target.index);
          if (!idx) return "failed";
          const value = this.lowerExpr(stmt.value);
          if (!value) return "failed";
          this.instructions.push({ kind: "array_store", slot: binding.slotId, index: idx.ref, value: value.ref, location });
          return "continue";
        }
        if (stmt.target.kind !== "Identifier") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `assignment to a member/index expression is not supported in this Level 2 phase (plain variable assignment only)`, location);
          return "failed";
        }
        // 3R-E Fix (per direct instruction): a reassignment to an
        // existing struct-typed variable (`p = Point(9,9)` or `p = q`)
        // was previously falling through to the generic assignVar(),
        // which knows nothing about structVarSlot and so produced no
        // IR instruction at all for this case - the destination
        // variable's own structVarSlot entry (and its slot's real
        // storage) was silently left completely untouched. Reusing the
        // exact same, already-proven field_load+field_store x N
        // mechanism used for `let q = p` (struct-to-struct copy) and
        // for struct-returning-call/struct-return consumption, but
        // targeting the EXISTING slot already registered for this
        // variable - not a newly-allocated one - is a real, complete,
        // independent BY VALUE copy: no aliasing is possible
        // afterward, since the copy is field-by-field into storage
        // that was already exclusively owned by this variable.
        if (this.structVarSlot.has(stmt.target.name)) {
          const lowered = this.lowerExpr(stmt.value);
          if (!lowered) return "failed";
          if (lowered.ref.structSlot !== undefined) {
            const existing = this.structVarSlot.get(stmt.target.name)!;
            for (let i = 0; i < existing.layout.fields.length; i++) {
              const loadId = this.freshId();
              this.instructions.push({ kind: "field_load", id: loadId, type: existing.layout.fields[i]!.type, slot: lowered.ref.structSlot, fieldIndex: i, location });
              this.instructions.push({ kind: "field_store", slot: existing.slotId, fieldIndex: i, value: { id: loadId }, location });
            }
            return "continue";
          }
          this.assignVar(stmt.target.name, lowered, location);
          return "continue";
        }
        const lowered = this.lowerExpr(stmt.value);
        if (!lowered) return "failed";
        this.assignVar(stmt.target.name, lowered, location);
        return "continue";
      }
      case "IfStatement": {
        const cond = this.lowerExpr(stmt.condition);
        if (!cond) return "failed";

        // Promote every OUTER variable reassigned inside either branch to
        // a slot BEFORE branching — see CFG_SPEC.md §1 for why this is
        // the mechanism that avoids needing a phi node at the merge
        // block below. Variables declared fresh INSIDE a branch (not
        // already in varEnv) are untouched — they are branch-local and
        // stay pure SSA within that branch.
        for (const name of collectAssignedNamesInIf(stmt)) {
          if (this.varEnv.has(name)) this.promoteToSlot(name, location);
        }

        // General CFG construction — if/else is a USE of this, not a
        // special case (per review): condition block -> cond_branch ->
        // then block -> merge block, else block -> merge block. A merge
        // block is ALWAYS created, even when there is no `else` at all
        // and even when a branch's body is trivial — never elided as
        // "unnecessary" (per explicit review instruction; this keeps
        // `while`'s later reuse of the same machinery uniform).
        const thenBlockId = this.allocBlockId();
        const elseBlockId = this.allocBlockId();
        const mergeBlockId = this.allocBlockId();

        this.finishBlockAndSwitchTo(
          { kind: "cond_branch", condition: cond.ref, thenTarget: thenBlockId, elseTarget: elseBlockId, location },
          thenBlockId, "then",
        );

        const thenResult = this.lowerStatementList(stmt.thenBranch.statements);
        if (thenResult === "failed") return "failed";
        let mergeReachableFromThen = true;
        if (thenResult === "continue") {
          this.finishBlockAndSwitchTo({ kind: "branch", target: mergeBlockId, location }, elseBlockId, "else");
        } else if (thenResult === "terminated") {
          // The then-branch ended in its own real terminator (e.g. a
          // plain `return` statement lowered directly inside it) — push
          // it using that terminator, then open the else block. No edge
          // from then into merge.
          this.blocks.push({ id: this.currentBlockId, label: this.currentBlockLabel, instructions: this.instructions, terminator: this.terminator! });
          this.terminator = null;
          this.currentBlockId = elseBlockId;
          this.currentBlockLabel = "else";
          this.instructions = [];
          mergeReachableFromThen = false;
        } else {
          // thenResult === "terminated_and_pushed": a NESTED if/else
          // inside the then-branch already pushed every block it needed
          // and determined its OWN merge was unreachable. There is
          // nothing to push here — just open the else block directly.
          this.currentBlockId = elseBlockId;
          this.currentBlockLabel = "else";
          this.instructions = [];
          mergeReachableFromThen = false;
        }

        let mergeReachableFromElse = true;
        if (stmt.elseBranch) {
          const elseResult = stmt.elseBranch.kind === "IfStatement"
            ? this.lowerStatement(stmt.elseBranch)
            : this.lowerStatementList(stmt.elseBranch.statements);
          if (elseResult === "failed") return "failed";
          if (elseResult === "continue") {
            this.finishBlockAndSwitchTo({ kind: "branch", target: mergeBlockId, location }, mergeBlockId, "merge");
          } else if (elseResult === "terminated") {
            this.blocks.push({ id: this.currentBlockId, label: this.currentBlockLabel, instructions: this.instructions, terminator: this.terminator! });
            this.terminator = null;
            mergeReachableFromElse = false;
          } else {
            // elseResult === "terminated_and_pushed": nothing to push.
            mergeReachableFromElse = false;
          }
        } else {
          // No `else` at all: the implicit empty else block ALWAYS falls
          // through to merge — merge is unconditionally reachable via
          // this path regardless of what the then-branch did.
          this.finishBlockAndSwitchTo({ kind: "branch", target: mergeBlockId, location }, mergeBlockId, "merge");
        }

        if (!mergeReachableFromThen && !mergeReachableFromElse) {
          // Both branches terminated (every path through this if/else
          // already returned, directly or via a nested if/else) — the
          // merge block is genuinely unreachable and must NOT be emitted
          // (per the explicit "no unreachable blocks" requirement — see
          // checkModuleInvariants' reachability check, IR_SPEC.md §7).
          // Propagate "terminated_and_pushed" so the caller knows both
          // that processing must stop (like a plain return) AND that
          // there is nothing left for IT to push either.
          this.currentBlockId = mergeBlockId; // reserved id, never actually pushed to this.blocks
          this.currentBlockLabel = "merge";
          this.instructions = [];
          return "terminated_and_pushed";
        }

        // At least one branch reaches merge — if the OTHER branch didn't
        // (it terminated instead), we still need to actually open the
        // merge block now (it wasn't opened above in that branch's arm).
        if (!mergeReachableFromElse) {
          this.currentBlockId = mergeBlockId;
          this.currentBlockLabel = "merge";
          this.instructions = [];
        }

        return "continue"; // subsequent statements are lowered into the new (reachable) merge block
      }
      case "WhileStatement": {
        // General CFG construction, matching CFG_SPEC.md §4 exactly —
        // entry -> loop_header -> loop_body -> loop_header (back edge)
        // -> loop_exit. Not a special case: built from the same
        // allocBlockId()/finishBlockAndSwitchTo() primitives if/else uses.
        const headerBlockId = this.allocBlockId();
        const bodyBlockId = this.allocBlockId();
        const exitBlockId = this.allocBlockId();

        // Promote every OUTER variable reassigned anywhere in the body to
        // a slot BEFORE branching into the loop at all (unlike if/else,
        // where promotion happens after lowering the condition — here it
        // MUST happen first, because the condition itself is re-evaluated
        // on every iteration inside loop_header, a block separate from
        // the one currently accumulating instructions; it must `load`
        // the CURRENT value on each pass, not a stale SSA reference
        // captured before the loop began).
        for (const name of collectAssignedNames(stmt.body)) {
          if (this.varEnv.has(name)) this.promoteToSlot(name, location);
        }

        this.finishBlockAndSwitchTo({ kind: "branch", target: headerBlockId, location }, headerBlockId, "loop_header");

        const cond = this.lowerExpr(stmt.condition);
        if (!cond) return "failed";

        this.finishBlockAndSwitchTo(
          { kind: "cond_branch", condition: cond.ref, thenTarget: bodyBlockId, elseTarget: exitBlockId, location },
          bodyBlockId, "loop_body",
        );

        this.loopStack.push({ headerBlockId, exitBlockId });
        const bodyResult = this.lowerStatementList(stmt.body.statements);
        this.loopStack.pop();
        if (bodyResult === "failed") return "failed";

        if (bodyResult === "continue") {
          // Body fell through normally — back edge to loop_header for the
          // next condition check (CFG_SPEC.md §4's "re-entering
          // loop_header" mechanism — this is what correctly reads the
          // slot's latest value without needing a phi node).
          this.finishBlockAndSwitchTo({ kind: "branch", target: headerBlockId, location }, exitBlockId, "loop_exit");
        } else if (bodyResult === "terminated") {
          // The body ended in its own real terminator (a `return`
          // directly inside it, or a `break`/`continue` handled below via
          // the SAME "terminated" signal as return — no back edge is
          // correct here since control already left via that terminator).
          this.blocks.push({ id: this.currentBlockId, label: this.currentBlockLabel, instructions: this.instructions, terminator: this.terminator! });
          this.terminator = null;
          this.currentBlockId = exitBlockId;
          this.currentBlockLabel = "loop_exit";
          this.instructions = [];
        } else {
          // bodyResult === "terminated_and_pushed": a nested if/else or
          // while inside the body already pushed every block it needed.
          this.currentBlockId = exitBlockId;
          this.currentBlockLabel = "loop_exit";
          this.instructions = [];
        }

        // loop_exit is ALWAYS reachable regardless of what the body did
        // — loop_header's cond_branch has an unconditional edge to it
        // (the "condition is false" case) that exists no matter how the
        // body behaves. Unlike if/else's merge block, there is no
        // "genuinely unreachable, omit it" case for a while loop's exit
        // block — per review's specific "no orphaned BasicBlocks" concern,
        // this is exactly why: the exit block's reachability never
        // depends on the body's control flow at all.
        return "continue";
      }
      case "ForStatement": {
        // Stage 6C (per direct instruction, Option C): only a plain
        // identifier referring to a known, slot-backed array is
        // supported as the iterable - the same restriction every other
        // array-consuming construct in this file already applies
        // (IndexExpression, array assignment, etc).
        if (stmt.iterable.kind !== "Identifier") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `for-loop iterable must be a plain variable (e.g. 'for i in arr'), not a more complex expression`, location);
          return "failed";
        }
        const arrBinding = this.varEnv.get(stmt.iterable.name);
        const arrType = this.varTypes.get(stmt.iterable.name);
        if (!arrBinding || arrBinding.kind !== "slot" || arrType?.kind !== "Array") {
          this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `'${stmt.iterable.name}' is not a known array variable`, location);
          return "failed";
        }
        const arrSlotId = arrBinding.slotId;
        const elementType = arrType.element;

        // A fresh, compiler-synthesized index slot - promoted to a
        // real slot from the start, exactly as WhileStatement promotes
        // outer-reassigned variables before branching into the loop,
        // since the header re-checks it on every iteration.
        const idxSlotId = this.nextSlotId++;
        this.locals.push({ id: idxSlotId, name: `for_idx_${idxSlotId}`, type: "i64" });
        const zeroId = this.freshId();
        this.instructions.push({ kind: "const", id: zeroId, type: "i64", value: { kind: "const_int", value: 0n }, location });
        this.instructions.push({ kind: "store", slot: idxSlotId, value: { id: zeroId }, location });

        for (const name of collectAssignedNames(stmt.body)) {
          if (this.varEnv.has(name)) this.promoteToSlot(name, location);
        }

        const headerBlockId = this.allocBlockId();
        const incrementBlockId = this.allocBlockId();
        const bodyBlockId = this.allocBlockId();
        const exitBlockId = this.allocBlockId();

        this.finishBlockAndSwitchTo({ kind: "branch", target: headerBlockId, location }, headerBlockId, "loop_header");

        // The loop bound: the iterable's TRUE RUNTIME length (Stage
        // 6B.1's own proven mechanism) - identical whether `arr` came
        // from a literal, a function return, or a module boundary.
        const lenId = this.freshId();
        this.instructions.push({ kind: "array_length", id: lenId, type: "i64", slot: arrSlotId, location });
        const idxLoadId = this.freshId();
        this.instructions.push({ kind: "load", id: idxLoadId, type: "i64", slot: idxSlotId, location });
        const condId = this.freshId();
        this.instructions.push({ kind: "binop", id: condId, type: "bool", op: "lt", left: { id: idxLoadId }, right: { id: lenId }, location });

        this.finishBlockAndSwitchTo(
          { kind: "cond_branch", condition: { id: condId }, thenTarget: bodyBlockId, elseTarget: exitBlockId, location },
          bodyBlockId, "loop_body",
        );

        // Bind the loop variable to the current element, reusing
        // Stage 3B's own established pattern for a struct-typed
        // element, or a plain ssa binding for a scalar element.
        const idxForLoadId = this.freshId();
        this.instructions.push({ kind: "load", id: idxForLoadId, type: "i64", slot: idxSlotId, location });
        if (elementType.kind === "Struct") {
          const layout = this.structLayouts.get(elementType.name);
          if (!layout) {
            this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `internal error: no layout found for struct '${elementType.name}' during for-loop lowering`, location);
            return "failed";
          }
          const elemId = this.freshId();
          this.instructions.push({ kind: "array_load", id: elemId, type: "void", slot: arrSlotId, index: { id: idxForLoadId }, location });
          const bindSlotId = this.nextSlotId++;
          this.locals.push({ id: bindSlotId, name: stmt.binding, type: "void", structLayout: layout });
          this.instructions.push({ kind: "store", slot: bindSlotId, value: { id: elemId }, location });
          this.structVarSlot.set(stmt.binding, { slotId: bindSlotId, layout });
          this.varTypes.set(stmt.binding, elementType);
        } else {
          const elemId = this.freshId();
          this.instructions.push({ kind: "array_load", id: elemId, type: toIRType(elementType), slot: arrSlotId, index: { id: idxForLoadId }, location });
          this.varEnv.set(stmt.binding, { kind: "ssa", ref: { id: elemId } });
          this.varTypes.set(stmt.binding, elementType);
        }

        // `continue`'s own target (loopStack.headerBlockId) is the
        // INCREMENT block, not the condition-check header - so a
        // `continue` still always advances the index before the
        // condition is re-checked, exactly matching a real for-loop's
        // own semantics. Without this, `continue` would skip the
        // increment entirely and loop forever.
        this.loopStack.push({ headerBlockId: incrementBlockId, exitBlockId });
        const bodyResult = this.lowerStatementList(stmt.body.statements);
        this.loopStack.pop();
        if (bodyResult === "failed") return "failed";

        if (bodyResult === "continue") {
          this.finishBlockAndSwitchTo({ kind: "branch", target: incrementBlockId, location }, incrementBlockId, "loop_increment");
        } else if (bodyResult === "terminated") {
          this.blocks.push({ id: this.currentBlockId, label: this.currentBlockLabel, instructions: this.instructions, terminator: this.terminator! });
          this.terminator = null;
          this.currentBlockId = incrementBlockId;
          this.currentBlockLabel = "loop_increment";
          this.instructions = [];
        } else {
          this.currentBlockId = incrementBlockId;
          this.currentBlockLabel = "loop_increment";
          this.instructions = [];
        }

        // The increment block: always advances the index, then
        // branches back to the real condition-check header. Reached
        // both by falling off the end of the body AND by an explicit
        // `continue` inside it (via loopStack's own redirected target
        // above) - a single, shared increment point, never duplicated.
        const curIdxId = this.freshId();
        this.instructions.push({ kind: "load", id: curIdxId, type: "i64", slot: idxSlotId, location });
        const oneId = this.freshId();
        this.instructions.push({ kind: "const", id: oneId, type: "i64", value: { kind: "const_int", value: 1n }, location });
        const nextIdxId = this.freshId();
        this.instructions.push({ kind: "binop", id: nextIdxId, type: "i64", op: "add", left: { id: curIdxId }, right: { id: oneId }, location });
        this.instructions.push({ kind: "store", slot: idxSlotId, value: { id: nextIdxId }, location });
        this.finishBlockAndSwitchTo({ kind: "branch", target: headerBlockId, location }, exitBlockId, "loop_exit");
        return "continue";
      }
      case "BreakStatement": {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (!loop) {
          // Precondition violation: Semantic's SE5001 already guarantees
          // `break` never appears outside a loop in a valid program.
          this.error(CODEGEN_CODES.INTERNAL_ERROR, `internal error: 'break' encountered with no enclosing loop during IR lowering (Semantic should have caught this)`, location);
          return "failed";
        }
        this.terminator = { kind: "branch", target: loop.exitBlockId, location };
        return "terminated";
      }
      case "ContinueStatement": {
        const loop = this.loopStack[this.loopStack.length - 1];
        if (!loop) {
          this.error(CODEGEN_CODES.INTERNAL_ERROR, `internal error: 'continue' encountered with no enclosing loop during IR lowering (Semantic should have caught this)`, location);
          return "failed";
        }
        // Jumps to the HEADER (condition re-check), never the body — per
        // explicit review requirement.
        this.terminator = { kind: "branch", target: loop.headerBlockId, location };
        return "terminated";
      }
      case "ReturnStatement": {
        if (stmt.value) {
          const lowered = this.lowerExpr(stmt.value);
          if (!lowered) return "failed";
          this.terminator = { kind: "return", value: lowered.ref, location };
        } else {
          this.terminator = { kind: "return_void", location };
        }
        return "terminated";
      }
      case "ExpressionStatement": {
        const lowered = this.lowerExpr(stmt.expression);
        if (!lowered) return "failed";
        return "continue"; // side-effect only; result value intentionally discarded
      }
      default:
        this.error(CODEGEN_CODES.UNSUPPORTED_CONSTRUCT, `statement kind '${stmt.kind}' is not supported in this Level 2 phase (scope: variable declarations, assignment, return, expression statements, if/else, while, break, continue — no for/switch/try-catch)`, location);
        return "failed";
    }
  }

  private terminator: IRTerminator | null = null;

  /**
   * Lowers a list of statements into the CURRENT block (and any further
   * blocks created by nested control-flow constructs), stopping early if
   * a statement terminates its block (e.g. return) or fails. This is the
   * shared helper both lowerFunction's top-level body and if/else's
   * then/else branches use — control flow constructs are not lowered
   * differently depending on where they appear.
   */
  private lowerStatementList(statements: readonly Statement[]): "continue" | "terminated" | "terminated_and_pushed" | "failed" {
    for (const stmt of statements) {
      const result = this.lowerStatement(stmt);
      if (result === "failed") return "failed";
      if (result === "terminated" || result === "terminated_and_pushed") return result;
    }
    return "continue";
  }

  /** Lowers a function's body. Returns the built IRFunction, or null if any diagnostic was recorded. */
  lowerFunction(fn: FunctionDecl, qualifiedName: string, returnType: URType, paramTypes: URType[]): IRFunction | null {
    this.nextId = 0;
    this.instructions = [];
    this.terminator = null;
    this.varEnv.clear();
    this.varTypes.clear();
    this.valueTypes.clear();
    this.blocks = [];
    this.currentBlockId = 0;
    this.currentBlockLabel = "entry";
    this.nextBlockId = 1;
    this.locals = [];
    this.nextSlotId = 0;

    const params = fn.params.map((p, i) => {
      const paramUrType = paramTypes[i]!;
      const irType = toIRType(paramUrType);
      // Struct-typed parameter: per LANGUAGE_SYNTAX_1_1_SPEC.md §2.5's
      // ratified "Parameter passing: BY VALUE" requirement (CG9001 fix,
      // NOT deferred ABI design). No ordinary scalar `param` instruction
      // is emitted here — a struct value has no single-scalar SSA
      // representation (emitting one would produce invalid C: a `void`
      // param-init). Instead: this registers the parameter's own real
      // struct slot (structVarSlot), and the C Backend emits a real,
      // direct struct-copy assignment (`slot_p = p_p;`) at the top of
      // the function body — real by-value copy semantics, using C's
      // own native struct assignment (no manual field-by-field copy
      // needed for the parameter-receiving side; STRUCT_ABI_SPEC.md §5's
      // already-established copy convention covers `let q = p` separately).
      if (paramUrType.kind === "Struct") {
        const layout = this.structLayouts.get(paramUrType.name);
        if (layout) {
          const slotId = this.nextSlotId++;
          this.locals.push({ id: slotId, name: p.name, type: "void", structLayout: layout });
          this.structVarSlot.set(p.name, { slotId, layout });
          this.varTypes.set(p.name, paramUrType);
          return { name: p.name, type: irType, structLayout: layout };
        }
      }
      // Array-typed parameter (Priority 3 Stabilization Sprint): same
      // real principle as the Struct branch above (a compound type
      // needs a real, storage-backed slot, not a plain SSA value, to
      // support indexed access) — kept as a fully separate, parallel
      // branch, not touching the Struct branch at all. `length` is a
      // real, non-zero sentinel (confirmed directly: IndexExpression's
      // own real array_load lowering never uses this value
      // numerically, only checks it for truthiness) - a general
      // parameter's own real length is genuinely unknown at its own
      // declaration (`int[]` carries no fixed size), matching real C
      // semantics for an array parameter (which itself decays to a
      // pointer, needing no compile-time-known length in its own
      // signature).
      if (paramUrType.kind === "Array") {
        // v29-D4 (Nested Array Model, first vertical slice): when the
        // element itself is Array-kind (a int[][] parameter), toIRType()
        // is deliberately never called on it — its own documented
        // contract explicitly excludes Array types ("out of scope for
        // this phase... callers must check for CG1001"), and calling it
        // anyway previously silently produced "void" (its own fallback
        // for any unhandled URType), directly breaking C code
        // generation (confirmed empirically: a real, invalid `void[]`
        // parameter declaration was produced before this fix). The
        // correct, real element type here is "array_ref" — a genuine,
        // distinct IRType (this Design's own required "int[] vs
        // int[][] real type distinction"), not a byte-identical
        // scalar and not a fallback.
        // Gate V1-MIXED-STRUCT-ARRAY-REJECTION: same rejection,
        // applied here for an array PARAMETER whose own declared
        // element type is a mixed-field struct.
        if (paramUrType.element.kind === "Struct") {
          const layout = this.structLayouts.get(paramUrType.element.name);
          if (layout && !this.isStructArrayElementHomogeneous(layout)) {
            this.rejectMixedStructArrayElement(paramUrType.element.name, this.loc(p.span));
            return null;
          }
        }
        const elementIrType = paramUrType.element.kind === "Array" ? "array_ref" : toIRType(paramUrType.element);
        const slotId = this.nextSlotId++;
        // ADR-005: real companion length parameter name, matching the
        // existing `p_<name>` naming convention already used for
        // every other parameter in emit-c.ts - this is the sole
        // source of truth for this slot's own bounds-check length,
        // never a Sentinel.
        const lengthParamCName = `p_${p.name}_length`;
        this.locals.push({ id: slotId, name: p.name, type: elementIrType, isArrayParam: true, runtimeLengthCName: lengthParamCName });
        this.varEnv.set(p.name, { kind: "slot", slotId });
        this.varTypes.set(p.name, paramUrType);
        return { name: p.name, type: elementIrType, arrayLength: 1, lengthParamCName };
      }
      const id = this.freshId();
      this.instructions.push({ kind: "param", id, type: irType, index: i, name: p.name, location: this.loc(p.span) });
      this.varEnv.set(p.name, { kind: "ssa", ref: { id } });
      this.varTypes.set(p.name, paramUrType);
      return { name: p.name, type: irType };
    });

    const result = this.lowerStatementList(fn.body.statements);
    if (result === "failed") return null;

    if (result === "continue") {
      // The final active block (the entry block itself for straight-line
      // functions, or the last reachable merge block after any if/else
      // chains) is still open and needs its own terminator — either an
      // explicit `return` already recorded, or (for a void function) an
      // implicit `return_void`, or a real error for a non-void function
      // with no return on this path.
      if (!this.terminator) {
        if (returnType.kind === "Unknown") {
          this.terminator = { kind: "return_void", location: this.loc(fn.span) };
        } else {
          this.error(
            CODEGEN_CODES.UNSUPPORTED_CONSTRUCT,
            `function '${fn.name}' does not end with an explicit return statement on every path — this Level 2 phase requires an explicit return for non-void functions (no control-flow-aware reachability analysis yet)`,
            this.loc(fn.span),
          );
          return null;
        }
      }
      this.blocks.push({
        id: this.currentBlockId,
        label: this.currentBlockLabel,
        instructions: this.instructions,
        terminator: this.terminator,
      });
    } else if (result === "terminated") {
      // A plain top-level `return` (not wrapped in any if/else) ended
      // the function body directly — its block has a real terminator
      // already recorded in this.terminator and must still be pushed.
      this.blocks.push({
        id: this.currentBlockId,
        label: this.currentBlockLabel,
        instructions: this.instructions,
        terminator: this.terminator!,
      });
    }
    // If result === "terminated_and_pushed": every path already returned
    // inside a nested if/else, which already pushed every real,
    // reachable block itself. Nothing further to do — this.blocks
    // already contains every real block; no unreachable block exists.

    // B-1 Gate (L-2, latent): a parameter is mapped to null only after
    // rejectMixedStructArrayElement has recorded CG1002 (see the Array
    // branch above). Previously the function was still returned with a
    // `null` entry in `params` (TS2322), so lowerToIR reported ok:true
    // alongside an error diagnostic. Return null instead, as this
    // method's own doc comment states ("null if any diagnostic was
    // recorded"); the body has already been lowered above, so the
    // diagnostics collected are exactly the same as before. Unreachable
    // from the CLI: semantic analysis rejects such a struct first (SE6001).
    const validParams: IRParam[] = [];
    for (const p of params) {
      if (p === null) return null;
      validParams.push(p);
    }

    return {
      qualifiedName,
      sourceName: fn.name,
      params: validParams,
      returnType: toIRType(returnType),
      returnStructLayout: returnType.kind === "Struct" ? this.structLayouts.get(returnType.name) : undefined,
      blocks: this.blocks,
      entryBlock: 0,
      location: this.loc(fn.span),
      locals: this.locals,
    };
  }

  getDiagnostics(): SharedDiagnostic[] {
    return this.diagnostics;
  }
}

// ── Public entry point ─────────────────────────────────────────────────────────

