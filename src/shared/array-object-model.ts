/**
 * IMPLEMENTATION BASELINE v1
 *
 * Real IR type definitions realizing the Structural Units established
 * in docs/proposals/ARRAY_PARAMETER_SEMANTICS_BASELINE.md, Part 5 §1
 * (Structural Units) through §5 (Validation Rules).
 *
 * SCOPE, PER DIRECT INSTRUCTION - this file answers exactly ONE
 * question: "does the IR structure match the Architecture Baseline?"
 * It does NOT answer "does the language work end-to-end?" It does
 * NOT touch ir-builder.ts, emit-c.ts, Lowering, or any Backend. Every
 * field below traces to a specific Decision/Invariant - see the
 * Baseline's own Dependency Graph and IR Implementation Contract.
 *
 * PHASE INVARIANT (v1 only) — NOT an Architecture Invariant. Per
 * direct instruction: no external layer depends on this file during
 * v1. Semantic knows nothing about it. Lowering knows nothing about
 * it. Backend knows nothing about it. Confirmed directly: zero file
 * in src/ imports from this module (verified via a real, direct grep
 * across the entire source tree). This file is exactly an IR Model +
 * Validation layer during v1, nothing more.
 *
 * THIS IS EXPECTED TO BE BROKEN, ON PURPOSE, BY v2. When Semantic
 * begins consuming this model (Implementation Baseline v2's own real
 * goal), the corresponding test below will fail — that failure is a
 * SUCCESS signal marking the exact point v1 ends and v2 begins, not a
 * regression. At that point the test must be deleted or replaced with
 * a v2-appropriate one, not "fixed" to keep passing.
 */

/**
 * A plain numeric identifier. Implementation Contract §3: the current
 * implementation adopts identifier-based relationships, matching real
 * existing precedent (IRValueRef.structSlot, VarBinding.slotId in
 * src/shared/ir.ts / lower-to-ir-helpers.ts) — not a direct object
 * reference.
 */
export type ObjectId = number;

/**
 * Identity Metadata (Baseline Part 4 Decision 3, Part 5 §1): the ONLY
 * thing that determines an Object's identity (Invariant 3). Mandatory
 * whenever a Reference-backed Object exists (Implementation Contract
 * §2) — an Object without this is not a valid Object under this
 * model.
 */
export interface IdentityMetadata {
  readonly objectId: ObjectId;
}

/**
 * Descriptive Metadata (Baseline Part 4 Decision 3, Part 5 §1):
 * describes the entity (Length, Element Type) — never determines
 * identity (Invariant 4). Mandatory whenever a Reference-backed
 * Object exists (Implementation Contract §2).
 *
 * `elementType` is restricted to scalar types — this document's own
 * ratified scope is `Array` of scalar elements; a nested/compound
 * element type is explicitly out of scope (not addressed anywhere in
 * the Baseline).
 */
export interface DescriptiveMetadata {
  readonly length: number;
  readonly elementType: "i64" | "f64" | "bool" | "string";
}

/**
 * The Structural Unit "Object" (Baseline Part 5 §1): a
 * Reference-backed Object (Part 4 Decision 1), carrying both
 * mandatory Metadata kinds as real attributes — NOT as independent
 * Structural Units of their own (§1's own explicit finding: Identity
 * Metadata and Descriptive Metadata are Attributes of Object, never
 * separate units).
 */
export interface ReferenceBackedObject {
  readonly kind: "ReferenceBackedObject";
  readonly identity: IdentityMetadata;
  readonly descriptive: DescriptiveMetadata;
}

/**
 * The relationship "VarBinding → designates → Object" (Baseline §2),
 * realized via an identifier (Implementation Contract §3): a
 * binding's own real 'slot' case denotes an ObjectId, matching
 * VarBinding's own real shape (`{ kind: "slot"; slotId: number }`,
 * lower-to-ir-helpers.ts:47) — this type does not replace or modify
 * VarBinding; it is a standalone structural description used only by
 * this file's own Validation layer (§5).
 */
export interface DesignatesRelationship {
  readonly kind: "designates";
  readonly bindingSlotId: number;
  readonly objectId: ObjectId;
}

/**
 * An ownership record (Baseline §3): exactly one `bindingSlotId` may
 * own a given `objectId` at a time — Invariant established directly
 * from Part 1 Q2 ("a reference does not transfer or share
 * ownership").
 */
export interface OwnershipRecord {
  readonly objectId: ObjectId;
  readonly ownerBindingSlotId: number;
}

/**
 * A single, self-contained IR-level model instance to validate: a set
 * of Objects, the Designates relationships pointing at them, and the
 * Ownership records governing them. This is a pure data structure for
 * Validation purposes (§5) — it is not wired into the real compiler
 * pipeline in this version.
 */
export interface ArrayObjectModel {
  readonly objects: readonly ReferenceBackedObject[];
  readonly relationships: readonly DesignatesRelationship[];
  readonly ownership: readonly OwnershipRecord[];
}

/** A single validation failure, naming the Validation Rule (§5) it violates. */
export interface ValidationFailure {
  readonly rule: string;
  readonly message: string;
}

/**
 * Validates an ArrayObjectModel against every Validation Rule from
 * the Baseline (Part 5 §5) that is checkable at this purely
 * structural level — no Backend, no C, no pointer.
 */
export function validateArrayObjectModel(model: ArrayObjectModel): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const objectIds = new Set(model.objects.map(o => o.identity.objectId));

  // Structural Validation: every Object must belong to a valid
  // structural category (§1, Invariant 1) — enforced by TypeScript's
  // own discriminated union (`kind: "ReferenceBackedObject"`), and
  // checked here for duplicate identities (an Object's identity must
  // be unique — Invariant 3, identity is the ONLY determining property).
  const seenIds = new Set<ObjectId>();
  for (const obj of model.objects) {
    if (seenIds.has(obj.identity.objectId)) {
      failures.push({ rule: "Structural Validation — unique Object identity", message: `duplicate objectId ${obj.identity.objectId}` });
    }
    seenIds.add(obj.identity.objectId);
    // Semantic Validation: Descriptive Metadata must never be treated
    // as identity (Invariant 4) — enforced structurally by keeping
    // `identity` and `descriptive` as separate fields (never merged
    // into one flat identity value elsewhere in this model).
    if (obj.descriptive.length < 0) {
      failures.push({ rule: "Semantic Validation — Descriptive Metadata validity", message: `objectId ${obj.identity.objectId} has a negative length (${obj.descriptive.length})` });
    }
  }

  // Structural Validation: every relationship must target a real,
  // existing Object (§2 — no dangling designation).
  for (const rel of model.relationships) {
    if (!objectIds.has(rel.objectId)) {
      failures.push({ rule: "Structural Validation — valid relationship target", message: `bindingSlotId ${rel.bindingSlotId} designates non-existent objectId ${rel.objectId}` });
    }
  }

  // Semantic Validation: an Object must never have more than one
  // owner (§3, Part 1 Q2 — "does not transfer or share ownership").
  const ownersPerObject = new Map<ObjectId, number>();
  for (const rec of model.ownership) {
    ownersPerObject.set(rec.objectId, (ownersPerObject.get(rec.objectId) ?? 0) + 1);
  }
  for (const [objectId, count] of ownersPerObject) {
    if (count > 1) {
      failures.push({ rule: "Semantic Validation — single ownership (§3)", message: `objectId ${objectId} has ${count} owners, expected at most 1` });
    }
  }
  for (const rec of model.ownership) {
    if (!objectIds.has(rec.objectId)) {
      failures.push({ rule: "Structural Validation — ownership targets a real Object", message: `ownerBindingSlotId ${rec.ownerBindingSlotId} claims ownership of non-existent objectId ${rec.objectId}` });
    }
  }

  return failures;
}
