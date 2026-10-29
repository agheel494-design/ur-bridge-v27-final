// ─────────────────────────────────────────────────────────────────────────────
// UR — Struct Layout Calculator
//
// Per docs/architecture/STRUCT_MEMORY_LAYOUT.md §9 (binding requirement):
// this is the ONLY component that computes struct size/alignment/padding/
// offset. TypeChecker, IR/Lowering, C Backend, and WASM Backend all consume
// its output; none may compute these values independently.
//
// Rules implemented here (per STRUCT_MEMORY_LAYOUT.md §1-§6):
// - Field order: declaration order, never reordered.
// - Alignment: each field aligned to its own natural size.
// - Padding: standard, C-compatible (align next field, then align total
//   size to the struct's own overall alignment).
// - Real primitive sizes, confirmed from emit-c.ts's own cType() mapping:
//   i64/f64/string = 8 bytes/8-byte aligned; bool = 1 byte/1-byte aligned.
// ─────────────────────────────────────────────────────────────────────────────

import type { IRType, StructLayoutField, StructLayoutResult } from "../../shared/ir.js";

export type { StructLayoutField, StructLayoutResult };

// Gate V1-GAP-002-SELF-REFERENCE-DIAGNOSTIC: a narrow, specifically-
// named error type for struct-layout computation failures — used
// instead of a plain Error so that callers (specifically,
// lower-to-ir.ts's own single catch point) can distinguish a KNOWN,
// diagnosable struct-layout rejection from any OTHER, unrelated
// internal error, without a general catch-all that would swallow
// unrelated crashes (explicitly forbidden for this Gate).
export class StructLayoutRejectionError extends Error {}

export interface StructFieldInput {
  readonly name: string;
  readonly type: IRType;
  /** Provide this instead of `type` when the field's own type is a struct — nested layout must already be computed (structs are processed in an order such that a struct's own dependencies are computed first; providing an unresolved nested struct is a caller error, not handled here). */
  readonly nestedLayout?: StructLayoutResult;
}

/** Real, confirmed primitive sizes/alignments — STRUCT_MEMORY_LAYOUT.md §1, not invented. */
// B-1 Gate (L-1, latent): the key type now also excludes "ptr" (see
// sizeAndAlignOf below). Previously the Record type claimed a "ptr" entry
// it never had (TS2741), and a "ptr" field crashed with a TypeError.
const PRIMITIVE_SIZE_ALIGN: Record<Exclude<IRType, "void" | "ptr">, { size: number; align: number }> = {
  i64: { size: 8, align: 8 },
  f64: { size: 8, align: 8 },
  bool: { size: 1, align: 1 },
  string: { size: 8, align: 8 }, // const char* on a 64-bit target
  // v29-D5 (Slice 1, Reference Representation Contract §2): array_ref
  // shares string's own exact size/alignment — a real 64-bit C pointer
  // — because BOTH are reference values under this design's own
  // explicit width-only sharing rule (never a semantic unification:
  // array_ref's own length comes from a runtime header read, string's
  // own from null-termination — genuinely different operations that
  // happen to share this one width fact). "ptr" (Native Pointer, FFI)
  // remains its own separate, pre-existing gap in this Record,
  // untouched — Native FFI pointer semantics is explicitly out of
  // this Gate's own scope.
  array_ref: { size: 8, align: 8 },
};

function sizeAndAlignOf(field: StructFieldInput): { size: number; align: number } {
  if (field.nestedLayout) {
    return { size: field.nestedLayout.size, align: field.nestedLayout.alignment };
  }
  if (field.type === "void") {
    throw new StructLayoutRejectionError(`struct field '${field.name}' has an unresolvable type — the referenced type could not be found`);
  }
  // B-1 Gate (L-1, latent — no new capability): a Native-FFI pointer
  // ("ptr", i.e. `nativeptr`) has no struct layout in V1.0 (see the
  // comment in PRIMITIVE_SIZE_ALIGN). Previously the lookup returned
  // `undefined` and the caller crashed with "Cannot destructure property
  // 'size' ... as it is undefined". It is now rejected explicitly, through
  // the same diagnosable error type used for the "void" case above.
  // Unreachable from the CLI: semantic analysis rejects a `nativeptr`
  // struct field first (SE6001).
  if (field.type === "ptr") {
    throw new StructLayoutRejectionError(`struct field '${field.name}' has type nativeptr, which has no struct layout — Native FFI pointers cannot be struct fields`);
  }
  return PRIMITIVE_SIZE_ALIGN[field.type];
}

function roundUpTo(value: number, alignment: number): number {
  if (alignment <= 1) return value;
  const remainder = value % alignment;
  return remainder === 0 ? value : value + (alignment - remainder);
}

/**
 * Computes the full layout for a struct, given its fields in declaration
 * order. Pure function — no side effects, no internal caching (a caller
 * may cache the result per struct name if useful; this function itself
 * always recomputes).
 *
 * Real edge case (STRUCT_TEST_PLAN.md Scenario 1 — empty struct):
 * a struct with zero fields has size 0 and alignment 1 (no fields to
 * derive alignment from) — handled explicitly below, not left to fall
 * out of the general loop in a way that could divide by zero or produce
 * a negative offset.
 */
export function computeStructLayout(structName: string, fields: readonly StructFieldInput[]): StructLayoutResult {
  if (fields.length === 0) {
    return { structName, fields: [], size: 0, alignment: 1 };
  }

  const outFields: StructLayoutField[] = [];
  let offset = 0;
  let structAlignment = 1;

  for (const field of fields) {
    const { size, align } = sizeAndAlignOf(field);
    offset = roundUpTo(offset, align);
    outFields.push({
      name: field.name,
      type: field.type,
      nestedLayout: field.nestedLayout,
      offset,
    });
    offset += size;
    if (align > structAlignment) structAlignment = align;
  }

  const totalSize = roundUpTo(offset, structAlignment);

  return { structName, fields: outFields, size: totalSize, alignment: structAlignment };
}
