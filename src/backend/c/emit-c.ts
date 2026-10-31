// ─────────────────────────────────────────────────────────────────────────────
// UR — Backend: C Emitter
// Level 2 — Phase 2.3 (first official Backend)
// ─────────────────────────────────────────────────────────────────────────────
//
//   IR → C → gcc → Executable
//
// Chosen as the first Backend (not LLVM, not WASM) per the approved Level 2
// plan: C is portable, trivially verifiable (any system has a C compiler),
// and directly executable — ideal for proving the first full compiler
// pipeline works before investing in a heavier backend. Future backends
// (LLVM, WASM) consume the SAME IR — nothing about this file's existence
// constrains them.
//
// SCOPE: emits exactly what Phase 2.1/2.2's IR can produce — i64/f64/bool/
// string/void types, straight-line single-basic-block functions (no
// branches/phi — control flow is a later phase), arithmetic, function
// calls, return. No structs/arrays/FFI yet.
//
// Every SSA value becomes a C local variable named `%_<id>` is not a valid
// C identifier, so we use `v<id>` (e.g. `v0`, `v1`, ...) — declared and
// assigned in one step at its definition point, which is always valid C
// since SSA guarantees single-assignment and our IR guarantees
// definition-before-use (checked by checkModuleInvariants in tests).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  IRModule, IRFunction, IRInstruction, IRTerminator, IRType, IRBinOp, IRUnOp, IRLocalSlot, StructLayoutResult,
} from "../../shared/ir.js";
import { resolveBuiltinExtern } from "../../shared/runtime-table.js";

function cType(t: IRType): string {
  switch (t) {
    case "i64":    return "int64_t";
    case "f64":    return "double";
    case "bool":   return "bool";
    case "string": return "const char*";
    case "void":   return "void";
    // v29-D4 (Nested Array Model, first vertical slice): a reference to
    // another array is represented, per the ratified Nested Array
    // Reference Representation Contract, as a base-address-only pointer
    // — int64_t* on this 64-bit target (confirmed to fit ELEMENT_SIZE=8
    // exactly). The EXISTING isArrayParam declaration pattern
    // (`${cType(slot.type)}* ${name}`) already appends one more `*`,
    // so an outer int[][] parameter's own element type resolving to
    // "array_ref" here correctly, automatically produces `int64_t**` —
    // no other change to the declaration-emission code was needed.
    case "array_ref": return "int64_t*";
    // B-1 Gate (D-2, known limitation — NOT a new capability): "ptr" is the
    // IR type of a Native-FFI `nativeptr` value, which the C Backend does
    // not support in V1.0 (EXPECTED_VALUES.md case 43: "not applicable to
    // the C Backend as a general concept"). Previously this switch fell
    // through and returned `undefined`, which was interpolated into the C
    // text as the literal type name "undefined" and rejected by gcc
    // (BE1001). The emitted type name is now an explicit, self-describing
    // marker that is deliberately NOT a valid C type, so gcc still rejects
    // the program at the same phase (BE1001) — but the message names the
    // actual reason instead of "unknown type name 'undefined'".
    case "ptr": return C_UNSUPPORTED_NATIVEPTR_TYPE;
  }
}

/** B-1 Gate (D-2): the marker emitted for the IR type "ptr" (nativeptr).
 *  It is intentionally not a declared C type; see cType above. It does not
 *  use the "ur_" prefix, which is reserved for Runtime symbols
 *  (tests/backend/c/no-hardcoded-runtime.test.ts). */
export const C_UNSUPPORTED_NATIVEPTR_TYPE = "nativeptr_unsupported_by_c_backend";

function cValueName(id: number): string {
  return `v${id}`;
}

const BINOP_C: Record<IRBinOp, string> = {
  add: "+", sub: "-", mul: "*", div: "/", mod: "%",
  eq: "==", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=",
  and: "&&", or: "||",
};

const UNOP_C: Record<IRUnOp, string> = { neg: "-", not: "!" };

function emitConstant(value: IRInstruction & { kind: "const" }): string {
  switch (value.value.kind) {
    case "const_int":    return value.value.value.toString(); // bigint -> C integer literal (no suffix needed for values in i64 range)
    case "const_float":  return formatCFloat(value.value.value);
    case "const_bool":   return value.value.value ? "true" : "false";
    case "const_string": return `"${escapeCString(value.value.value)}"`;
  }
}

function formatCFloat(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return n.toString();
}

function escapeCString(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else out += ch;
  }
  return out;
}

function cSlotName(name: string): string {
  return `slot_${name}`;
}

function cStructTypeName(structName: string): string {
  return `ur_struct_${structName}`;
}

function emitInstruction(inst: IRInstruction, slotsById: ReadonlyMap<number, IRLocalSlot>, idTypes: ReadonlyMap<number, IRType>, structFieldShadowIndex: ReadonlyMap<string, number>, arraySlotShadowIndex: ReadonlyMap<number, number>): string {
  switch (inst.kind) {
    case "param":
      // Parameters are C function parameters already, bound by name — but
      // since the rest of the IR refers to them by SSA id (v<id>), emit an
      // alias assignment so `v<id>` is a valid reference throughout the body.
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = p_${inst.name};`;
    case "const":
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${emitConstant(inst)};`;
    case "binop": {
      // Compiler & Runtime Stabilization FIX — confirmed real bug: the
      // type checker (compatibility.ts's own binaryOpResultType) accepts
      // `string == string` / `!=` / `<` / `<=` / `>` / `>=`, but this
      // emission previously translated every binop into a RAW C infix
      // operator regardless of operand type — for `const char*`
      // operands, `==`/`<`/etc. in C is ALWAYS pointer comparison
      // (comparing memory addresses), never content comparison. This is
      // a genuine, silent-wrong-answer risk: a prior manual check
      // ("abc" == "abc" printed "true") only APPEARED correct because
      // gcc pools identical string literals to the same address at
      // -O0 — confirmed directly by inspecting the generated C
      // (`bool v2 = v0 == v1;` on two `const char*`), not by any actual
      // content-comparison logic. Fixed: string-operand comparisons now
      // emit a real `strcmp()` call, comparing content correctly
      // regardless of whether the two pointers happen to alias.
      const isComparison = ["==", "!=", "<", "<=", ">", ">="].includes(BINOP_C[inst.op]);
      const leftIsString = idTypes.get(inst.left.id) === "string";
      if (isComparison && leftIsString) {
        const cOp = BINOP_C[inst.op];
        const cmpExpr = `strcmp(${cValueName(inst.left.id)}, ${cValueName(inst.right.id)})`;
        return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${cmpExpr} ${cOp} 0;`;
      }
      // Compiler & Runtime Stabilization FIX — confirmed real, Critical
      // (Category A) bug via Runtime Stabilization's own explicit
      // "division by zero" check: integer division/modulo by zero
      // previously compiled to a RAW C `/`/`%` with no check at all —
      // C's own behavior for integer division-by-zero is to raise
      // SIGFPE, an UNHANDLED CRASH (confirmed directly: exit code -1,
      // signal SIGFPE, zero UR-level diagnostic — the process simply
      // died). Float division-by-zero is NOT affected (IEEE 754 defines
      // it as producing `inf`, confirmed directly to already work
      // correctly — this fix is deliberately scoped to i64-typed
      // operands only, matching how the fix was verified). Fixed:
      // matches the SAME established pattern as array-bounds-checking
      // (resolveBuiltinExtern("Panic"), a clean, controlled panic
      // instead of a raw crash) — divisor checked at the point of
      // division; zero divisor panics cleanly with a clear message
      // instead of raising SIGFPE.
      const isIntDivOrMod = (inst.op === "div" || inst.op === "mod") && idTypes.get(inst.left.id) === "i64";
      if (isIntDivOrMod) {
        const panicExtern = resolveBuiltinExtern("Panic");
        const panicCall = panicExtern ? `${panicExtern.name}("division by zero")` : `/* internal error: no Panic extern resolved */(void)0`;
        const rightName = cValueName(inst.right.id);
        const opExpr = `${cValueName(inst.left.id)} ${BINOP_C[inst.op]} ${rightName}`;
        return `  ${cType(inst.type)} ${cValueName(inst.id)} = (${rightName} != 0) ? (${opExpr}) : (${panicCall}, ${cZeroValue(inst.type)});`;
      }
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${cValueName(inst.left.id)} ${BINOP_C[inst.op]} ${cValueName(inst.right.id)};`;
    }
    case "unop":
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${UNOP_C[inst.op]}${cValueName(inst.operand.id)};`;
    case "int_to_float":
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = (double)${cValueName(inst.operand.id)};`;
    case "call": {
      // Real fix for CG9001: an argument with a real structSlot (per
      // LANGUAGE_SYNTAX_1_1_SPEC.md §2.5's ratified BY VALUE
      // requirement) passes the slot's own name directly - C's own
      // native by-value struct-copy semantics take care of the actual
      // copy at the call boundary, same as passing any C struct
      // variable directly as an argument.
      const args = inst.args.flatMap(a => {
        if (a.structSlot !== undefined) {
          const slot = slotsById.get(a.structSlot);
          return [slot ? cSlotName(slot.name) : `slot_${a.structSlot}`];
        }
        if (a.arraySlot !== undefined) {
          const slot = slotsById.get(a.arraySlot);
          const slotName = slot ? cSlotName(slot.name) : `slot_${a.arraySlot}`;
          // ADR-005: the real length passed at this call site is
          // derived from the ACTUAL argument's own slot - either a
          // real compile-time literal (a local, let-bound array) or a
          // real runtime companion variable name (when forwarding a
          // parameter through another parameter, correctly chaining
          // the real value across multiple call boundaries). Never a
          // Sentinel.
          // v29-D6: an isArrayResult slot (an array-returning call's
          // own result, passed on as an argument — e.g.
          // `useIt(make())`) has neither runtimeLengthCName nor
          // length — confirmed directly this round, this previously
          // fell back to the literal string "0", producing a real
          // bounds-check failure at the callee. Gate A9.2: reads via
          // the new, unified ur_array_length() — replacing the direct
          // header-pointer-arithmetic this comment originally
          // described, now that ur_gc_alloc_array() gives every array
          // a consistent header this call can rely on uniformly.
          const lengthArg = slot?.isArrayResult
            ? `ur_array_length(${slotName})`
            : (slot?.runtimeLengthCName ?? String(slot?.length ?? 0));
          return [slotName, lengthArg];
        }
        return [cValueName(a.id)];
      }).join(", ");
      // Priority 2 (Struct Return, Solution A — ratified): the callee
      // genuinely returns the struct by value (its own real C
      // signature already declares `struct X callee(...)`, per the
      // function-declaration code below). The result slot was already
      // declared upfront (same real declare-then-initialize pattern
      // every other local uses, confirmed directly above) - a plain
      // assignment, NOT a combined "struct X name = ..." declaration
      // (which would conflict with that upfront declaration) - same
      // real pattern already used for struct parameters
      // (`slot_p = p_p;`, confirmed directly above).
      if (inst.resultStructSlot !== undefined) {
        const slot = slotsById.get(inst.resultStructSlot);
        const slotName = slot ? cSlotName(slot.name) : `slot_${inst.resultStructSlot}`;
        const assignLine = `  ${slotName} = ${inst.callee}(${args});`;
        // Gate A9.3: mirror each of the returned struct's own
        // array_ref fields into their own shadow roots.
        if (slot?.structLayout) {
          const setRootLines: string[] = [];
          slot.structLayout.fields.forEach((field, fi) => {
            if (field.type !== "array_ref") return;
            const idx = structFieldShadowIndex.get(`${inst.resultStructSlot}:${fi}`);
            if (idx !== undefined) setRootLines.push(`  ur_gc_set_root(__ur_shadow_base + ${idx}, (int64_t*)${slotName}.${field.name});`);
          });
          if (setRootLines.length > 0) return [assignLine, ...setRootLines].join("\n");
        }
        return assignLine;
      }
      // v29-D6 (Layer A/B): the array-returning analog of
      // resultStructSlot immediately above — "Gate 2R Remediation"
      // already produced this exact call shape at Lowering
      // (resultArraySlot set, id: -1, type: "void"), but the C
      // backend never had a matching case, so this call always fell
      // through to the generic "void" branch below, silently
      // discarding the callee's own real return value entirely
      // (confirmed directly this round: the caller's own slot was
      // left as an unrelated, empty, length-1 allocation while the
      // real call result was thrown away). Mirrors resultStructSlot's
      // own working pattern exactly: a plain assignment to the
      // already-declared slot variable.
      if (inst.resultArraySlot !== undefined) {
        const slot = slotsById.get(inst.resultArraySlot);
        const slotName = slot ? cSlotName(slot.name) : `slot_${inst.resultArraySlot}`;
        // v29-D6: an explicit cast to the SLOT's own declared type
        // (${cType(slot.type)}*, one level of indirection deeper than
        // the function's own return type, mirroring the isArrayParam
        // declaration convention exactly). The function's own return
        // type stays uniformly opaque (cType(fn.returnType) alone);
        // the receiving slot's own declared type may be one level
        // deeper for a nested array result. Confirmed necessary
        // directly by a real gcc -Werror this round.
        const slotCType = slot ? `${cType(slot.type)}*` : "int64_t*";
        const assignLine = `  ${slotName} = (${slotCType})${inst.callee}(${args});`;
        // Gate A9.3: mirror this array-returning call's own result into
        // its own shadow root.
        const idx = arraySlotShadowIndex.get(inst.resultArraySlot);
        if (idx !== undefined) return `${assignLine}\n  ur_gc_set_root(__ur_shadow_base + ${idx}, (int64_t*)${slotName});`;
        return assignLine;
      }
      if (inst.type === "void") {
        return `  ${inst.callee}(${args});`;
      }
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${inst.callee}(${args});`;
    }
    case "load": {
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`; // fallback should never trigger given checkModuleInvariants' slot-validity check
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${slotName};`;
    }
    case "store": {
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      return `  ${slotName} = ${cValueName(inst.value.id)};`;
    }
    case "array_length": {
      // Stage 6C (per direct instruction, Option C): mirrors
      // array_load's own existing runtime-length resolution above -
      // ADR-005's runtimeLengthCName for a runtime-length (array-
      // parameter) slot, falling back to the compile-time literal
      // length for a local array-literal slot. Not independently
      // validated end-to-end via this backend in this Gate, since the
      // interpreter (ur run) is this project's own primary execution
      // path for every Gate so far - this keeps the C backend
      // compiling correctly and internally consistent with
      // array_load's own established pattern.
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      const base = inst.baseRef ? cValueName(inst.baseRef.id) : slotName;
      const length = (inst.baseRef || slot?.isArrayResult)
        ? `ur_array_length(${base})`
        : (slot?.runtimeLengthCName ?? slot?.length ?? 0);
      return `int64_t ${cValueName(inst.id)} = ${length};\n`;
    }
    case "array_load": {
      // Level 2.8, LANGUAGE_SYNTAX_1_1_SPEC.md §1.5: bounds-checked read.
      // ur_panic's actual C name is NEVER hardcoded here — resolved via
      // the same resolveBuiltinExtern() mechanism Lowering already uses
      // for print/input/free, keeping this file name-agnostic.
      //
      // v29-D4 (Nested Array Model, first vertical slice): when
      // inst.baseRef is present, the base is NOT a fixed local slot —
      // it is the value already computed by a prior array_load (the
      // outer[i] reference, per the ratified Nested Array Reference
      // Representation Contract). The referenced (inner) array's own
      // real length is read from ITS OWN small header — per the
      // Contract's own explicit, C-specific decision: an inner array
      // (an array that is itself an element of another array) carries
      // an 8-byte length field immediately preceding its own element
      // data, mirroring WASM's already-existing header design. This
      // does NOT apply to, and does not change, a depth-1 local
      // (D3, heap, no header) or parameter (D2, companion length) —
      // both keep using `length` (the existing branch below) exactly
      // as before; only a baseRef-driven access reads a header.
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      const base = inst.baseRef ? cValueName(inst.baseRef.id) : slotName;
      // ADR-005: an array-parameter slot's real length is a RUNTIME
      // value (the companion length parameter), never the compile-time
      // literal used for local array slots - this is the sole source
      // of truth, never a Sentinel.
      // v29-D6: an isArrayResult slot (an array-returning call's own
      // result) ALSO always reads its own real length from the
      // header, for the identical reason as baseRef — the caller has
      // no compile-time knowledge of an array it received from a
      // call, exactly as it has none for a nested/field-sourced
      // reference. Confirmed necessary directly: without this, the
      // bounds check fell back to a hardcoded 0.
      const length = (inst.baseRef || slot?.isArrayResult) ? `ur_array_length(${base})` : (slot?.runtimeLengthCName ?? slot?.length ?? 0);
      const idx = cValueName(inst.index.id);
      const panicExtern = resolveBuiltinExtern("Panic");
      const panicCall = panicExtern ? `${panicExtern.name}("array index out of bounds")` : `/* internal error: no Panic extern resolved */(void)0`;
      // v29-D5 (Slice 3): when the ELEMENT itself is array_ref-typed
      // (this array's own elements are references — e.g. reading
      // g.rows[i] where g.rows: int[][], through a struct field whose
      // own uniform C type per the Design's own §2 principle does not
      // encode nesting depth), `base` may be too shallow a pointer
      // level (int64_t*) to directly index and yield another int64_t*
      // — confirmed directly by a real gcc -Werror ("pointer/integer
      // type mismatch in conditional expression") this round. Casting
      // base to one pointer level deeper before indexing reconciles
      // this — the underlying bytes are identical (both are 8-byte
      // pointers on this target); this changes only how C's own type
      // checker sees the read, not what is actually stored or read.
      const elementBase = inst.type === "array_ref" ? `((${cType(inst.type)}*)${base})` : base;
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = (${idx} >= 0 && ${idx} < ${length}) ? ${elementBase}[${idx}] : (${panicCall}, ${cZeroValue(inst.type)});`;
    }
    case "array_store": {
      // v29-D4: same baseRef/inner-header pattern as array_load above.
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      const base = inst.baseRef ? cValueName(inst.baseRef.id) : slotName;
      const length = (inst.baseRef || slot?.isArrayResult) ? `ur_array_length(${base})` : (slot?.runtimeLengthCName ?? slot?.length ?? 0);
      const idx = cValueName(inst.index.id);
      const panicExtern = resolveBuiltinExtern("Panic");
      const panicCall = panicExtern ? `${panicExtern.name}("array index out of bounds")` : `/* internal error: no Panic extern resolved */(void)0`;
      // v29-D4 (Gap A, Nested Literal Construction): when the stored
      // VALUE is itself an array reference (id:-1, arraySlot set — the
      // same sentinel shape already proven for call arguments, D2's
      // own work), it is NOT an ordinary SSA value — cValueName(-1)
      // would produce the nonsensical, invalid "v-1" (confirmed
      // directly by a real generated-C inspection this round). The
      // correct value is the referenced inner array's own C variable
      // name (its own base pointer), matching exactly how the SAME
      // arraySlot shape is already resolved for a call argument.
      // Finding R1.5-CGEN-001 (array_store half, mirroring the
      // field_store fix): the identical gap existed for a STRUCT-
      // valued VALUE (structSlot set — e.g. `a[0] = Point(9,9)` for an
      // array-of-structs) — confirmed directly, a real generated-C
      // "slot_a[v] = v-1;" for this exact case. structSlot is checked
      // FIRST here, mirroring the exact ordering already proven correct
      // at call-argument resolution, the `return` terminator, and
      // field_store.
      const value = inst.value.structSlot !== undefined
        ? (() => {
            const innerSlot = slotsById.get(inst.value.structSlot!);
            return innerSlot ? cSlotName(innerSlot.name) : `slot_${inst.value.structSlot}`;
          })()
        : inst.value.arraySlot !== undefined
        ? (() => {
            const innerSlot = slotsById.get(inst.value.arraySlot!);
            return innerSlot ? cSlotName(innerSlot.name) : `slot_${inst.value.arraySlot}`;
          })()
        : cValueName(inst.value.id);
      return `  if (${idx} >= 0 && ${idx} < ${length}) { ${base}[${idx}] = ${value}; } else { ${panicCall}; }`;
    }
    case "field_load": {
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      const fieldName = slot?.structLayout?.fields[inst.fieldIndex]?.name ?? `field_${inst.fieldIndex}`;
      return `  ${cType(inst.type)} ${cValueName(inst.id)} = ${slotName}.${fieldName};`;
    }
    case "field_store": {
      const slot = slotsById.get(inst.slot);
      const slotName = slot ? cSlotName(slot.name) : `slot_${inst.slot}`;
      const field = slot?.structLayout?.fields[inst.fieldIndex];
      const fieldName = field?.name ?? `field_${inst.fieldIndex}`;
      // v29-D5 (Slice 3, C Contract §3): when the stored VALUE is
      // itself an array reference (arraySlot set — the same sentinel
      // shape D4 already proved for call arguments and array_store),
      // it is NOT an ordinary SSA value — cValueName(-1) would produce
      // the invalid "v-1" (confirmed directly by a real generated-C
      // inspection this round, for `struct Box { values: int[] }`'s
      // own construction). The correct value is the referenced inner
      // array's own C variable name, mirroring the identical fix D4
      // already made for array_store's own value emission.
      // Finding R1.5-CGEN-001: the identical gap existed for a STRUCT-
      // valued VALUE (structSlot set, per the same sentinel shape
      // already correctly handled at call-argument resolution and the
      // `return` terminator — confirmed, before this fix, NEITHER
      // arraySlot NOR structSlot was true for this case, so it fell
      // through to cValueName(-1), producing the same invalid "v-1").
      // structSlot is checked FIRST here, mirroring the exact ordering
      // already proven correct at those two other call sites.
      const value = inst.value.structSlot !== undefined
        ? (() => {
            const innerSlot = slotsById.get(inst.value.structSlot!);
            return innerSlot ? cSlotName(innerSlot.name) : `slot_${inst.value.structSlot}`;
          })()
        : inst.value.arraySlot !== undefined
        ? (() => {
            const innerSlot = slotsById.get(inst.value.arraySlot!);
            return innerSlot ? cSlotName(innerSlot.name) : `slot_${inst.value.arraySlot}`;
          })()
        : cValueName(inst.value.id);
      // v29-D5 (Slice 3): an explicit cast to the FIELD's own declared
      // type. Per the Design's own §2 principle ("the struct layout
      // itself does not need to know... that the referenced array is
      // itself nested"), a field's own C type stays uniformly
      // cType("array_ref") regardless of nesting depth — but the
      // ACTUAL value being assigned (e.g. a nested outer array's own
      // int64_t** storage) may have a deeper real pointer level.
      // Confirmed necessary directly by a real gcc -Werror
      // (incompatible-pointer-types) this round. The cast is safe: both
      // sides are real pointers of identical width on this 64-bit
      // target — this reconciles C's own strict pointer-level typing
      // with the design's own deliberately opaque field representation,
      // it does not change what is stored.
      // Finding R1.5-CGEN-001 (cast-handling half): a struct-typed
      // field's own IRType tag is deliberately "void" (the established,
      // correct pattern — type:"void" + nestedLayout — confirmed
      // elsewhere in this codebase and NOT something this fix changes).
      // Applying cType("void") as a cast here would produce the literal,
      // invalid C keyword "void" as a cast target (confirmed directly:
      // a real gcc error, "void value not ignored as it ought to be").
      // No cast is needed at all in this case — C's own native struct-
      // to-struct assignment (the same mechanism already proven correct
      // for `struct X tmp = other_struct;` elsewhere in this backend)
      // handles the copy directly. This check is scoped exactly to
      // struct-typed fields (identified via nestedLayout, the same
      // signal already used elsewhere in this file to distinguish
      // struct fields) — scalar and array_ref fields are completely
      // unaffected, continuing to use the existing cast exactly as
      // before.
      const castedValue = field?.nestedLayout ? value : field ? `(${cType(field.type)})${value}` : value;
      const assignLine = `  ${slotName}.${fieldName} = ${castedValue};`;
      // Gate A9.3: mirror an array_ref-typed field's own newly-stored
      // value into its own shadow root, in the same statement group.
      if (field?.type === "array_ref") {
        const idx = structFieldShadowIndex.get(`${inst.slot}:${inst.fieldIndex}`);
        if (idx !== undefined) {
          return `${assignLine}\n  ur_gc_set_root(__ur_shadow_base + ${idx}, (int64_t*)${slotName}.${fieldName});`;
        }
      }
      return assignLine;
    }
  }
}

function cZeroValue(t: IRType): string {
  switch (t) {
    case "i64": return "0";
    case "f64": return "0.0";
    case "bool": return "false";
    case "string": return "NULL";
    case "void": return "0"; // never actually used as a value; kept total for exhaustiveness
    case "array_ref": return "NULL"; // v29-D4: a reference is a pointer; NULL is its natural zero/panic-fallback value
    // B-1 Gate (D-2): previously fell through to `undefined`. A "ptr" value
    // can only appear in a function whose types already contain the
    // unsupported-nativeptr marker (cType above), so gcc rejects that
    // program regardless; NULL is the natural zero of a pointer and keeps
    // this function total.
    case "ptr": return "NULL";
  }
}

// ── Control-flow emission primitives (Level 2.6.6) ──────────────────────────
//
// The ONLY three functions in this file that emit literal C goto/label
// syntax. emitTerminator (below) calls these rather than constructing
// goto/label strings inline in multiple places — so if this project ever
// changes its C control-flow emission strategy (e.g. structured
// if/while instead of goto, for readability), exactly these three
// functions change, not every call site.

function blockName(blockId: number): string {
  return `block_${blockId}`;
}

function emitLabel(blockId: number): string {
  return `${blockName(blockId)}:`;
}

function emitJump(targetBlockId: number): string {
  return `  goto ${blockName(targetBlockId)};`;
}

function emitBranch(conditionRef: string, thenBlockId: number, elseBlockId: number): string {
  return `  if (${conditionRef}) { goto ${blockName(thenBlockId)}; } else { goto ${blockName(elseBlockId)}; }`;
}

function emitTerminator(term: IRTerminator, slotsById: ReadonlyMap<number, IRLocalSlot>, fnReturnType: IRType | undefined, totalShadowRoots: number, blockId: number): string {
  const popFrame = totalShadowRoots > 0 ? `  ur_gc_pop_frame(${totalShadowRoots});\n` : "";
  const tmpName = `__ur_ret_tmp_${blockId}`;
  switch (term.kind) {
    case "return": {
      if (term.value.structSlot !== undefined) {
        const slot = slotsById.get(term.value.structSlot);
        const slotName = slot ? cSlotName(slot.name) : `slot_${term.value.structSlot}`;
        // Gate A9.3: capture the return value into a plain C temporary
        // FIRST (unique per BLOCK, since a function may have multiple
        // return statements, each its own C-scope-level declaration —
        // reusing one name across blocks would be an illegal
        // redeclaration in C, confirmed and fixed directly here, before
        // this was ever compiled) — this reads from the named C
        // variable (slotName), which the shadow stack's own bookkeeping
        // never owns or touches — THEN pop this frame's own roots,
        // THEN return the already-captured value. This ordering is
        // explicit and safe by construction: ur_gc_pop_frame() only
        // adjusts the shadow stack's own top index; it does not
        // invalidate slotName or the heap allocation(s) it points to
        // (no collector reads the shadow stack synchronously here —
        // none is wired in yet, Gate A9.3's own explicit scope
        // boundary) — but the ordering is written out explicitly
        // regardless, so it remains correct once a future collector IS
        // wired in and could, in principle, run between any two
        // statements.
        return `  struct ${cStructTypeName(slot!.structLayout!.structName)} ${tmpName} = ${slotName};\n${popFrame}  return ${tmpName};`;
      }
      if (term.value.arraySlot !== undefined) {
        const slot = slotsById.get(term.value.arraySlot);
        const slotName = slot ? cSlotName(slot.name) : `slot_${term.value.arraySlot}`;
        const castType = fnReturnType ? `(${cType(fnReturnType)})` : "";
        const retType = fnReturnType ? cType(fnReturnType) : "int64_t*";
        return `  ${retType} ${tmpName} = ${castType}${slotName};\n${popFrame}  return ${tmpName};`;
      }
      if (totalShadowRoots > 0) {
        // Scalar/plain SSA return: the value itself is never shadow-
        // stack-resident (only arrays/struct-array_ref-fields are),
        // so no capture-before-pop is needed for the value itself —
        // but THIS function's own frame must still be popped before
        // returning, for the SAME reason every other path does.
        return `  int64_t ${tmpName} = ${cValueName(term.value.id)};\n${popFrame}  return ${tmpName};`;
      }
      return `  return ${cValueName(term.value.id)};`;
    }
    case "return_void": return `${popFrame}  return;`;
    case "branch":      return emitJump(term.target);
    case "cond_branch":
      return emitBranch(cValueName(term.condition.id), term.thenTarget, term.elseTarget);
  }
}

/** Collects every SSA id referenced by any instruction operand or by the block terminator (i.e. every "used" value). */
function collectUsedIds(fn: IRFunction): Set<number> {
  const used = new Set<number>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "binop") { used.add(inst.left.id); used.add(inst.right.id); }
      else if (inst.kind === "unop") { used.add(inst.operand.id); }
      else if (inst.kind === "call") { for (const a of inst.args) used.add(a.id); }
      else if (inst.kind === "store") { used.add(inst.value.id); } // NEW: a value stored into a slot IS used, even though store itself defines no id
      else if (inst.kind === "array_load") { used.add(inst.index.id); if (inst.baseRef) used.add(inst.baseRef.id); }
      else if (inst.kind === "array_store") { used.add(inst.index.id); used.add(inst.value.id); if (inst.baseRef) used.add(inst.baseRef.id); }
    }
    if (block.terminator.kind === "return") used.add(block.terminator.value.id);
    else if (block.terminator.kind === "cond_branch") used.add(block.terminator.condition.id);
  }
  return used;
}

function emitFunction(fn: IRFunction): string {
  const params = fn.params.flatMap(p => p.structLayout
    ? [`struct ${cStructTypeName(p.structLayout.structName)} p_${p.name}`]
    : p.arrayLength !== undefined
    ? [`${cType(p.type)} p_${p.name}[]`, `int64_t ${p.lengthParamCName}`]
    : [`${cType(p.type)} p_${p.name}`]
  ).join(", ");
  const returnTypeStr = fn.returnStructLayout ? `struct ${cStructTypeName(fn.returnStructLayout.structName)}` : cType(fn.returnType);
  const signature = `${returnTypeStr} ${fn.qualifiedName}(${params})`;
  const slotsById = new Map(fn.locals.map(l => [l.id, l] as const));

  // Suppress legitimate-but-noisy -Wunused-variable warnings for any UR
  // value that is genuinely defined but never referenced again (e.g. `let
  // y = 20` when the function never uses `y`). This is a standard, safe,
  // zero-behavior C technique — `(void)vN;` has no runtime effect and does
  // not change program semantics. It does NOT hide a real UR-level bug
  // (an unused-variable *lint* is a Semantic Analyzer concern, out of
  // scope for Level 2's "no Type System changes" rule) — it only prevents
  // the C compiler's warning about the Backend's own emitted C variable
  // from leaking through as if it were a Backend defect.
  const usedIds = collectUsedIds(fn);
  const allDefinedIds: number[] = [];
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      // `store` defines no SSA id at all — nothing to suppress.
      // Void-typed instructions (currently: only void-returning `call`s,
      // e.g. print()) never declare a C variable at all — emitInstruction's
      // `call` case emits a bare `callee(args);` statement with no
      // assignment when `inst.type === "void"`. Including such an id in
      // the unused-suppression list would emit `(void)vN;` for a `vN`
      // that was never declared — a real compile error ("undeclared
      // identifier"), confirmed and fixed here. Found via the first
      // print() end-to-end test (Level 2.5.1).
      if (inst.kind !== "store" && inst.kind !== "array_store" && inst.kind !== "field_store" && inst.type !== "void") allDefinedIds.push(inst.id);
    }
  }
  const unusedIds = allDefinedIds.filter(id => !usedIds.has(id));

  // CONFIRMED BUG (fixed): a local slot that is stored to but never
  // loaded from (e.g. a variable assigned in an if/else but never read
  // afterward, or an array only ever written to) triggers a real,
  // legitimate gcc `-Wunused-but-set-variable` warning — this gap
  // predates Level 2.8 (it applies to ordinary scalar slots from Level
  // 2.6 just as much as to array slots), but no prior E2E test happened
  // to exercise a write-only slot, so it was never caught until an
  // array out-of-bounds test surfaced it here. Fixed with the same
  // `(void)` suppression technique already used for SSA values above —
  // `(void)slot_name;` (or `(void)slot_array_name;`, which decays to a
  // pointer and is equally valid) has zero runtime effect.
  const loadedSlotIds = new Set<number>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "load" || inst.kind === "array_load") loadedSlotIds.add(inst.slot);
    }
  }
  const unusedSlots = fn.locals.filter(s => !loadedSlotIds.has(s.id));

  // Only blocks actually targeted by some OTHER block's branch/cond_branch
  // need a C label — the entry block is reached by normal C function
  // entry, not by a goto, so it needs no label unless something loops
  // back to it (e.g. a future while's loop header). Emitting a label for
  // every block unconditionally produced a real, legitimate gcc
  // -Wunused-label warning the moment a function had a branch point with
  // no loop-back — found via the first real if/else E2E test (Phase 2.6.2).
  const targetedBlockIds = new Set<number>();
  for (const block of fn.blocks) {
    if (block.terminator.kind === "branch") targetedBlockIds.add(block.terminator.target);
    else if (block.terminator.kind === "cond_branch") {
      targetedBlockIds.add(block.terminator.thenTarget);
      targetedBlockIds.add(block.terminator.elseTarget);
    }
  }

  // Gate A9.3 — Production Shadow Stack Integration: compute, per
  // function, the SAME root set Gates A4-A5.1's own experimental
  // codegen already proved mechanically derivable from real IR
  // metadata — every array-typed local/parameter/result slot, plus
  // every struct-typed local's own array_ref field. This is an
  // ADDITIVE, PARALLEL tracking layer: existing named C variables
  // (slot_x) remain the sole source of truth for every read/write
  // exactly as before (array_load/array_store/field_load/field_store/
  // call-argument resolution are UNCHANGED) — the shadow stack is
  // updated alongside them at every point an array-typed value is
  // established, so real, precise roots exist in production without
  // touching the already-proven value-resolution logic at all.
  const arraySlotShadowIndex = new Map<number, number>();
  const structFieldShadowIndex = new Map<string, number>();
  let __nextShadowIndex = 0;
  for (const slot of fn.locals) {
    if (slot.isArray || slot.isArrayParam || slot.isArrayResult) {
      arraySlotShadowIndex.set(slot.id, __nextShadowIndex++);
    }
    if (slot.structLayout) {
      slot.structLayout.fields.forEach((field, fi) => {
        if (field.type === "array_ref") structFieldShadowIndex.set(`${slot.id}:${fi}`, __nextShadowIndex++);
      });
    }
  }
  const totalShadowRoots = __nextShadowIndex;
  const emitSetRoot = (idx: number, valueExpr: string) => `  ur_gc_set_root(__ur_shadow_base + ${idx}, (int64_t*)${valueExpr});`;

  const lines: string[] = [`${signature} {`];
  // Gate A9.3: reserve every root slot for this function's own frame
  // BEFORE any array-typed value is established, so every subsequent
  // ur_gc_set_root() call below has a valid slot to write into.
  if (totalShadowRoots > 0) lines.push(`  int64_t __ur_shadow_base = ur_gc_push_frame(${totalShadowRoots});`);
  // Compiler & Runtime Stabilization phase — id->type map, built once
  // per function by scanning every value-producing instruction, so
  // emitInstruction's own binop case can special-case STRING comparison
  // (== != < <= > >=) as a real strcmp() call rather than raw C pointer
  // comparison. See emitInstruction's own comment on this exact bug
  // (confirmed directly: "abc" == "abc" only happened to print `true`
  // because gcc pools identical string literals to the same address at
  // -O0 — the generated C was `v0 == v1` on two `const char*`, an
  // undefined-by-content pointer comparison, not string equality).
  const idTypes = new Map<number, IRType>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if ("id" in inst) idTypes.set(inst.id, inst.type);
    }
  }
  // v29-D4 (Gap A, Nested Literal Construction): the set of local array
  // slots that are ever STORED as an element of another array (i.e.
  // ever appear as an array_store's own value.arraySlot within this
  // function) — these need a real header (per the ratified Nested
  // Array Reference Representation Contract's own C-specific decision:
  // an INNER array carries its own 8-byte length prefix, since C's
  // existing depth-1 local convention, D3's own frozen work, has no
  // header and relies on a compile-time-known length that an outer
  // array's own dynamically-indexed element cannot provide). This does
  // NOT change how an ordinary (never-nested) local array is declared —
  // only slots actually used as an inner reference get a header.
  const innerArraySlotIds = new Set<number>();
  for (const block of fn.blocks) {
    for (const inst of block.instructions) {
      if (inst.kind === "array_store" && inst.value.arraySlot !== undefined) {
        innerArraySlotIds.add(inst.value.arraySlot);
      }
      if (inst.kind === "field_store" && inst.value.arraySlot !== undefined) {
        innerArraySlotIds.add(inst.value.arraySlot);
      }
    }
    // v29-D6 (Layer A/B): an array RETURNED from this function needs
    // the identical treatment — its own real length must be readable
    // by the CALLER (who has no compile-time knowledge of it, exactly
    // the same reasoning that already gives an inner array its own
    // header). Confirmed directly this round: without this, the
    // caller's own bounds check fell back to a hardcoded 0 (neither
    // `length` nor `runtimeLengthCName` exists for the callee's own
    // array slot from the caller's own perspective), rejecting every
    // access as out-of-bounds.
    if (block.terminator.kind === "return" && block.terminator.value.arraySlot !== undefined) {
      innerArraySlotIds.add(block.terminator.value.arraySlot);
    }
  }
  // Gate A9.3 — Production Shadow Stack Integration: root-index maps
  // are computed once, earlier in this function (before `lines` is
  // declared) — see that computation for the full scope comment.
  // Local slots (Level 2.6.1): declared once, uninitialized, at the top
  // of the function — every UR `let`/reassignable variable becomes a
  // real C local here; every subsequent `load`/`store` reads/writes it
  // directly (see IR_SPEC.md / CFG_SPEC.md §1 for why this avoids
  // needing phi nodes at CFG merge points).
  for (const slot of fn.locals) {

    // use the explicit isArray field, not length > 1 (which incorrectly
    // treated a genuine one-element array, length === 1, as an ordinary
    // scalar, causing subsequent array_load/array_store references to
    // index a non-array C declaration).
    const isInnerArray = slot.isArray === true && innerArraySlotIds.has(slot.id);
    // Gate A9.2 — Array Allocation Migration & Header Unification: both
    // the previously-headerless (plain isArray) and previously-headered
    // (isInnerArray) cases now allocate through the SAME, unified
    // ur_gc_alloc_array() contract (Gate A9.1's own runtime foundation)
    // — removing the two-shape inconsistency Gate A8 identified. Layer
    // 1/2 semantics (aliasing, struct-field sharing) are unchanged by
    // this migration: it changes ONLY how an array's own header/length
    // is represented internally, never what array_load/array_store/
    // assignment/struct-copy observably do.
    const elementKindFor = (s: IRLocalSlot) => (s.type === "array_ref" ? "UR_GC_ELEMENT_ARRAY_REF" : "UR_GC_ELEMENT_SCALAR");
    const decl = slot.structLayout
      ? `  struct ${cStructTypeName(slot.structLayout.structName)} ${cSlotName(slot.name)};`
      : slot.isArrayParam
      ? `  ${cType(slot.type)}* ${cSlotName(slot.name)};`
      : slot.isArrayResult
      ? // v29-D6 (Layer A/B, array-returning call results — "Gate 2R
        // Remediation," a pre-existing, deliberate Lowering mechanism
        // that was never matched by a corresponding backend fix,
        // confirmed directly this round): this slot's own real array
        // comes from a function CALL's own return value, not from a
        // local allocation this function performs itself — mirroring
        // isArrayParam's own identical reasoning exactly (a value
        // received from elsewhere, never allocated here). Declared as
        // a plain, uninitialized pointer; the call instruction's own
        // emission (below) assigns its own real value.
        `  ${cType(slot.type)}* ${cSlotName(slot.name)};`
      : slot.isArray
      ? // Gate A9.2: unified allocation for EVERY owning array local,
        // whether or not it is ever used as an inner/field/returned
        // reference (isInnerArray's own prior distinction no longer
        // affects ALLOCATION — every array now carries the same
        // header, read uniformly via ur_array_length() everywhere
        // else in this file, replacing the old *(base - 1) pattern).
        `  ${cType(slot.type)}* ${cSlotName(slot.name)} = (${cType(slot.type)}*)ur_gc_alloc_array(${slot.length ?? 1}, ${elementKindFor(slot)});`
      : `  ${cType(slot.type)} ${cSlotName(slot.name)};`;
    lines.push(decl);
    // Gate A9.3: mirror this array's own freshly-allocated value into
    // its own shadow root, immediately, in the same declaration group.
    if (slot.isArray && !slot.isArrayParam && !slot.isArrayResult && !slot.structLayout) {
      lines.push(emitSetRoot(arraySlotShadowIndex.get(slot.id)!, cSlotName(slot.name)));
    }
    // Gate A9.2: ur_register_array_allocation()'s own double-free-
    // tracking role is superseded, for slots allocated through the new
    // unified path, by ur_gc_alloc_array()'s own header/sweep-list
    // membership — confirmed safe to omit entirely: ur_free_array()
    // itself is never emitted by this backend at all (confirmed
    // directly, zero call sites), so no existing free-path depended on
    // this registration for these slots.
  }
  // Real fix for CG9001 (per LANGUAGE_SYNTAX_1_1_SPEC.md §2.5's own
  // ratified "Parameter passing: BY VALUE" requirement): a struct
  // parameter's own real value (already passed by C's own native
  // by-value struct-copy semantics, via the real `struct Name p_name`
  // parameter) is copied into the internal working slot used by
  // field_load/field_store throughout the function body - one real C
  // struct assignment (`slot_p = p_p;`), which C itself lowers to a
  // full field-by-field copy automatically. No manual per-field copy
  // code is needed here.
  for (const p of fn.params) {
    if (p.structLayout) {
      lines.push(`  ${cSlotName(p.name)} = p_${p.name};`);
      // Gate A9.3: mirror each of this struct parameter's own
      // array_ref fields into their own shadow roots, now that the
      // struct-copy assignment above has given them their real values.
      const paramSlot = fn.locals.find(l => l.name === p.name);
      if (paramSlot?.structLayout) {
        paramSlot.structLayout.fields.forEach((field, fi) => {
          if (field.type !== "array_ref") return;
          const idx = structFieldShadowIndex.get(`${paramSlot.id}:${fi}`);
          if (idx !== undefined) lines.push(emitSetRoot(idx, `${cSlotName(p.name)}.${field.name}`));
        });
      }
    }
    if (p.arrayLength !== undefined) {
      lines.push(`  ${cSlotName(p.name)} = p_${p.name};`);
      // Gate A9.3: mirror this array parameter's own value into its
      // own shadow root.
      const paramSlot = fn.locals.find(l => l.name === p.name);
      if (paramSlot) {
        const idx = arraySlotShadowIndex.get(paramSlot.id);
        if (idx !== undefined) lines.push(emitSetRoot(idx, cSlotName(p.name)));
      }
    }
  }
  for (const block of fn.blocks) {
    if (targetedBlockIds.has(block.id)) lines.push(emitLabel(block.id));
    for (const inst of block.instructions) lines.push(emitInstruction(inst, slotsById, idTypes, structFieldShadowIndex, arraySlotShadowIndex));
    lines.push(emitTerminator(block.terminator, slotsById, fn.returnType, totalShadowRoots, block.id));
  }
  for (const id of unusedIds) lines.splice(lines.length - 1, 0, `  (void)${cValueName(id)};`);
  for (const slot of unusedSlots) lines.splice(lines.length - 1, 0, `  (void)${cSlotName(slot.name)};`);
  lines.push(`}`);
  return lines.join("\n");
}

/** Emits a forward declaration (prototype) for a function, used so call order in C never matters (matches UR's own forward-declaration semantics). */
function emitPrototype(fn: IRFunction): string {
  const params = fn.params.flatMap(p => p.structLayout
    ? [`struct ${cStructTypeName(p.structLayout.structName)}`]
    : p.arrayLength !== undefined
    ? [`${cType(p.type)}[]`, `int64_t`]
    : [cType(p.type)]
  ).join(", ") || "void";
  const returnTypeStr = fn.returnStructLayout ? `struct ${cStructTypeName(fn.returnStructLayout.structName)}` : cType(fn.returnType);
  return `${returnTypeStr} ${fn.qualifiedName}(${params});`;
}

/**
 * Emits complete, compilable C99 source for an IRModule.
 *
 * The module must have a function named "main" (UR source-level `main`) to
 * produce a runnable executable — its qualified name is wired to C's `main`
 * entry point via a thin wrapper, since UR's `main` returns `int64_t` (or
 * void) but C's `main` must return `int`.
 */
export function emitC(module: IRModule): string {
  const lines: string[] = [
    `// Generated by UR C Backend (Level 2, Phase 2.3/2.4) — do not edit by hand.`,
    `#include <stdint.h>`,
    `#include <stdbool.h>`,
    // v29-D3-1 / Gate A9.2: kept for the standard library surface
    // generated code may still rely on elsewhere (array allocation
    // itself no longer calls malloc() directly here — Gate A9.2's own
    // migration routes every owning array through ur_gc_alloc_array(),
    // declared in ur_runtime.h, not through a direct malloc() call in
    // generated code).
    `#include <stdlib.h>`,
    // Compiler & Runtime Stabilization phase — needed for strcmp(),
    // used by binop emission for real string content comparison (==
    // != < <= > >=) instead of raw C pointer comparison. See
    // emitInstruction's own "binop" case comment for the full bug
    // this fixes.
    `#include <string.h>`,
    `#include "ur_runtime.h"`,
    ``,
    // Runtime ABI Version Contract (RUNTIME_SPEC.md §4.4) — every generated
    // file declares the ABI version it was built against; the Runtime's
    // Init function (discovered below purely by role, never by name)
    // checks this against its own compiled-in version at program startup.
    `#define UR_RUNTIME_ABI_REQUIRED 1`,
    ``,
  ];

  const nonRuntimeExterns = module.externs.filter(e => e.kind !== "runtime");

  // Stage 3.3 — forward-declare every distinct opaque struct type an FFI
  // extern's real C signature references via a pointer (e.g. `sqlite3*`)
  // — the real library's own header is never #included here (this
  // project's own FFI model never includes a third-party header), so any
  // such type must be forward-declared as `typedef struct X X;` (an
  // OPAQUE handle — the real struct's fields are never accessed, only
  // pointers to it are passed around, so no field layout is needed).
  // Confirmed directly: without this, gcc fails with "unknown type name"
  // for the real out-param/pointer-argument cases (sqlite3_open/close).
  const opaqueStructNames = new Set<string>();
  const KNOWN_C_PRIMITIVE_POINTER_BASES = new Set(["const char", "char", "void", "int", "double", "float"]);
  function collectOpaqueBase(cTypeStr: string) {
    const base = cTypeStr.replace(/\*+$/, "").trim();
    if (cTypeStr.endsWith("*") && !KNOWN_C_PRIMITIVE_POINTER_BASES.has(base) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) {
      opaqueStructNames.add(base);
    }
  }
  for (const ext of nonRuntimeExterns) {
    if (ext.kind !== "ffi") continue;
    for (const t of ext.cParameterTypes ?? []) collectOpaqueBase(t);
    if (ext.outParam) collectOpaqueBase(ext.outParam.pointeeCType + "*");
  }
  for (const name of opaqueStructNames) lines.push(`typedef struct ${name} ${name};`);
  if (opaqueStructNames.size > 0) lines.push(``);

  // Real struct type declarations (per STRUCT_MEMORY_LAYOUT.md §9): every
  // distinct structLayout used anywhere in the module (any function's own
  // locals) is collected, deduplicated by structName, and emitted as ONE
  // real C struct declaration each — using the SAME, single, already-
  // computed structLayout (field order/offset already determined by the
  // one shared StructLayoutCalculator, never recomputed here).
  const structDecls = new Map<string, StructLayoutResult>();
  function collectStructLayouts(layout: StructLayoutResult) {
    if (structDecls.has(layout.structName)) return;
    // Nested structs must be declared before the struct that embeds them
    // (C requires a complete type for an inline member) — recurse first.
    for (const f of layout.fields) if (f.nestedLayout) collectStructLayouts(f.nestedLayout);
    structDecls.set(layout.structName, layout);
  }
  for (const fn of module.functions) {
    for (const slot of fn.locals) if (slot.structLayout) collectStructLayouts(slot.structLayout);
  }
  for (const layout of structDecls.values()) {
    lines.push(`struct ${cStructTypeName(layout.structName)} {`);
    for (const field of layout.fields) {
      const fieldCType = field.nestedLayout ? `struct ${cStructTypeName(field.nestedLayout.structName)}` : cType(field.type);
      lines.push(`  ${fieldCType} ${field.name};`);
    }
    lines.push(`};`);
  }
  if (structDecls.size > 0) lines.push(``);

  // Extern declarations. Runtime-kind externs are already declared by
  // ur_runtime.h (#include'd above) — emitting a SECOND, independently-
  // derived prototype here would risk exactly the kind of type-mismatch
  // bug found during Runtime Core's own implementation (int vs int64_t)
  // the moment the two declarations drift apart. Only non-Runtime externs
  // (a future FFI/DLL/shared-library phase — none exist yet in Level 2.4)
  // get a synthesized prototype here, since they have no pre-existing
  // header to include.
  for (const ext of nonRuntimeExterns) lines.push(emitExternPrototype(ext));
  if (nonRuntimeExterns.length > 0) lines.push(``);

  // Stage 3.2 — one explicitly-casting wrapper per FFI extern, called by
  // every `call` IR instruction targeting a native-library function
  // instead of the raw symbol. See emitFfiWrapper's own header comment
  // for why this is required for defined-behavior correctness, not
  // optional/cosmetic.
  const ffiExterns = module.externs.filter(e => e.kind === "ffi");
  for (const ext of ffiExterns) lines.push(emitFfiWrapper(ext));
  if (ffiExterns.length > 0) lines.push(``);

  for (const fn of module.functions) lines.push(emitPrototype(fn));
  lines.push(``);

  for (const fn of module.functions) {
    lines.push(emitFunction(fn));
    lines.push(``);
  }

  // Program lifecycle (RUNTIME_SPEC.md §3): the Backend discovers WHICH
  // extern to call at startup/shutdown purely by lifecycleRole — it never
  // hardcodes any Runtime function's literal name anywhere in this file
  // (enforced by tests/backend/c/no-hardcoded-runtime.test.ts, which scans
  // this file's own source for forbidden literals). Adding, renaming, or
  // replacing a Runtime function never requires a Backend change as long
  // as its lifecycleRole is set correctly in the shared Runtime table.
  //
  // checkModuleInvariants() (src/shared/ir.ts) already guarantees, before
  // this function is ever called, that EXACTLY one "init" and EXACTLY one
  // "shutdown" extern exist — so the non-null assertions below are safe
  // by that upstream contract, not a local assumption.
  const initExtern = module.externs.find(e => e.lifecycleRole === "init")!;
  const shutdownExtern = module.externs.find(e => e.lifecycleRole === "shutdown")!;

  const urMain = module.functions.find(f => f.sourceName === "main");
  if (urMain) {
    if (urMain.returnType === "i64" || urMain.returnType === "bool") {
      // Both integer and boolean UR `main` results become the real process
      // exit code — C's `(int)` cast on a C `bool` correctly yields 0/1.
      lines.push(`int main(void) {`);
      lines.push(`  ${initExtern.name}(UR_RUNTIME_ABI_REQUIRED);`);
      lines.push(`  int result = (int)${urMain.qualifiedName}();`);
      lines.push(`  ${shutdownExtern.name}();`);
      lines.push(`  return result;`);
      lines.push(`}`);
    } else {
      lines.push(`int main(void) {`);
      lines.push(`  ${initExtern.name}(UR_RUNTIME_ABI_REQUIRED);`);
      lines.push(`  ${urMain.qualifiedName}();`);
      lines.push(`  ${shutdownExtern.name}();`);
      lines.push(`  return 0;`);
      lines.push(`}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** Emits a synthesized extern prototype for a non-Runtime extern. For `kind: "ffi"` externs (Stage 3.1/3.2/3.3), uses the REAL C types (cReturnType/cParameterTypes) when present, matching the actual native library's own ABI exactly — never a UR-internal-type-derived prototype for these, which would risk an undefined-behavior ABI mismatch. For an output-parameter extern (Stage 3.3), the out-pointer's type is inserted at its real parameter position — the prototype MUST match the real function's FULL signature, including the parameter UR's own visible signature omits entirely. */
function emitExternPrototype(ext: {
  name: string; returnType: IRType; parameterTypes: readonly IRType[];
  cReturnType?: string; cParameterTypes?: readonly string[];
  outParam?: { realParamIndex: number; pointeeCType: string };
}): string {
  const returnTypeStr = ext.cReturnType ?? cType(ext.returnType);
  const baseParamTypeStrs = ext.cParameterTypes ?? ext.parameterTypes.map(cType);
  let paramTypeStrs: string[] = [...baseParamTypeStrs];
  if (ext.outParam) {
    paramTypeStrs = [
      ...paramTypeStrs.slice(0, ext.outParam.realParamIndex),
      `${ext.outParam.pointeeCType}*`,
      ...paramTypeStrs.slice(ext.outParam.realParamIndex),
    ];
  }
  const params = paramTypeStrs.join(", ") || "void";
  return `extern ${returnTypeStr} ${ext.name}(${params});`;
}

/**
 * Stage 3.2 — generates a thin, explicitly-casting wrapper for an FFI
 * extern whose real C type differs from UR's own internal representation
 * (e.g. a real `int`-returning C function, represented internally as UR's
 * `i64`). The wrapper calls the REAL, correctly-prototyped extern (declared
 * by emitExternPrototype above) and casts its result — this is fully
 * defined C behavior (a function call matching its own true prototype,
 * followed by a standard numeric conversion), unlike declaring the extern
 * itself with a mismatched, widened prototype (undefined behavior per the
 * C standard, and the exact bug this Stage fixes from Stage 3.1).
 *
 * Every `call` IR instruction Lowering emits for a native-library call
 * targets THIS wrapper's name (`__ur_ffi_<realSymbol>`), never the raw
 * symbol directly — see lower-to-ir.ts's own CallExpression/MemberExpression
 * handling.
 */
/**
 * Stage 3.2/3.3 — generates a thin, explicitly-casting wrapper for an FFI
 * extern whose real C signature differs from UR's own internal
 * representation. Handles two distinct cases:
 *
 * 1. Return-type narrowing (Stage 3.2): a real `int`-returning C function
 *    represented internally as UR's `i64` — the wrapper calls the REAL,
 *    correctly-prototyped extern and casts its result. Fully defined C
 *    behavior (a function call matching its own true prototype, followed
 *    by a standard numeric conversion), unlike declaring the extern
 *    itself with a mismatched, widened prototype.
 *
 * 2. Output parameters (Stage 3.3, e.g. `sqlite3_open`'s own
 *    `sqlite3** ppDb`): the wrapper declares a LOCAL variable of the
 *    out-param's pointee type, passes its ADDRESS at the real C
 *    parameter position (a position entirely absent from UR's own
 *    visible signature), calls the real function (discarding its own
 *    return value — see native-library-registry.ts's own documented
 *    convention), and returns the local variable's final value, cast to
 *    UR's return type.
 *
 * Ordinary POINTER arguments (a real C parameter whose type ends in `*`,
 * corresponding to a UR `i64`-typed argument representing an opaque
 * handle — e.g. `sqlite3_close(sqlite3* db)`) are cast from the incoming
 * `int64_t` to the real pointer type at the call site — this is what
 * lets a handle `open()` returned be passed back into `close()` safely,
 * without UR itself ever having a pointer type.
 *
 * Every `call` IR instruction Lowering emits for a native-library call
 * targets THIS wrapper's name (`__ur_ffi_<realSymbol>`), never the raw
 * symbol directly — see lower-to-ir.ts's own CallExpression/MemberExpression
 * handling.
 */
function emitFfiWrapper(ext: {
  name: string; returnType: IRType; parameterTypes: readonly IRType[];
  cParameterTypes?: readonly string[];
  outParam?: { realParamIndex: number; pointeeCType: string };
}): string {
  const wrapperName = `__ur_ffi_${ext.name}`;
  const urReturnType = cType(ext.returnType);

  // UR-visible wrapper parameters (never includes the out-param slot,
  // which is entirely internal to the wrapper's own body).
  const wrapperParams = ext.parameterTypes.map((t, i) => `${cType(t)} a${i}`).join(", ") || "void";

  // Build the REAL C call's argument list, in the REAL function's own
  // parameter order — inserting the out-param's address at its real
  // position, and casting any ordinary pointer-typed argument from its
  // UR-side int64_t representation to the real pointer type.
  const cParamTypes = ext.cParameterTypes ?? ext.parameterTypes.map(cType);
  const realArgCount = cParamTypes.length + (ext.outParam ? 1 : 0);
  const callArgs: string[] = [];
  let urArgIndex = 0;
  for (let realIndex = 0; realIndex < realArgCount; realIndex++) {
    if (ext.outParam && realIndex === ext.outParam.realParamIndex) {
      callArgs.push("&__ur_ffi_out");
      continue;
    }
    const realCType = cParamTypes[urArgIndex]!;
    const urArgName = `a${urArgIndex}`;
    const naturalCType = cType(ext.parameterTypes[urArgIndex]!);
    if (realCType !== naturalCType) {
      // The real C parameter's type differs from what UR's own internal
      // representation would naturally produce — an explicit cast is
      // required for defined behavior, whether the difference is a
      // pointer (an opaque i64 handle cast to its real pointer type) or
      // a narrower/different-width numeric type (e.g. a real `int32_t`/
      // `uint8_t` parameter, with UR only ever passing `i64`). Stage 4.2
      // fix: this was previously pointer-only, missing exactly this
      // narrowing case for non-pointer arguments — found and fixed while
      // registering ur_mem_write_i32/writeU8, which need it directly.
      callArgs.push(`(${realCType})${urArgName}`);
    } else {
      callArgs.push(urArgName);
    }
    urArgIndex++;
  }

  if (ext.outParam) {
    const lines = [
      `static inline ${urReturnType} ${wrapperName}(${wrapperParams}) {`,
      `  ${ext.outParam.pointeeCType} __ur_ffi_out = 0;`,
      `  ${ext.name}(${callArgs.join(", ")});`,
      `  return (${urReturnType})__ur_ffi_out;`,
      `}`,
    ];
    return lines.join("\n");
  }

  const args = callArgs.join(", ");
  if (ext.returnType === "void") {
    return `static inline ${urReturnType} ${wrapperName}(${wrapperParams}) {\n  ${ext.name}(${args});\n}`;
  }
  return `static inline ${urReturnType} ${wrapperName}(${wrapperParams}) {\n  return (${urReturnType})${ext.name}(${args});\n}`;
}
