/**
 * PROOF-OF-REPRESENTATION PROTOTYPE — explicitly isolated, per direct
 * instruction. Does NOT touch ir-builder.ts or emit-c.ts. Does NOT
 * modify the Architecture Baseline or any Invariant. This is a
 * throwaway experiment testing whether:
 *
 *   ArrayObjectModel (Object id=17, length=3, elementType) —lowered—>
 *   (pointer, length) ABI representation —passed through—> a
 *   multi-hop call chain (f -> g -> h), preserving Object identity,
 *   Length, Element Type, the `designates` relationship, and correct
 *   Bounds Check — WITHOUT inventing a new concept or violating any
 *   ratified Invariant.
 *
 * Success/failure here is evidence for ADR-005, not a decision itself.
 */

import {
  validateArrayObjectModel,
  type ArrayObjectModel,
} from "../src/shared/array-object-model.js";

/** The (pointer, length) ABI-level representation this prototype's
 * own "Lowering Adapter" produces - a real, minimal simulation of
 * what a C function boundary would actually carry, not the real C
 * backend. */
interface LoweredArrayArg {
  readonly objectId: number; // preserved for identity-tracking in this prototype only - a real C ABI would not carry this, only (pointer, length); kept here so THIS experiment can verify identity survival directly.
  readonly pointerSymbol: string; // simulates a real C pointer value (e.g. "slot_a")
  readonly length: number;
  readonly elementType: "i64" | "f64" | "bool" | "string";
}

/** The Lowering Adapter: converts a real ArrayObjectModel + a target
 * objectId into the (pointer, length) representation. This is the
 * ONLY new logic in this prototype - everything else is the real,
 * existing v1 model and its real validation. */
function lowerArrayObjectToABI(model: ArrayObjectModel, objectId: number, pointerSymbol: string): LoweredArrayArg | null {
  const obj = model.objects.find(o => o.identity.objectId === objectId);
  if (!obj) return null;
  return {
    objectId: obj.identity.objectId,
    pointerSymbol,
    length: obj.descriptive.length,
    elementType: obj.descriptive.elementType,
  };
}

/** Simulates a Bounds Check using ONLY the (pointer, length)
 * representation's own real length - not a sentinel, not slot.length
 * from the real, separate emit-c.ts mechanism. */
function boundsCheck(arg: LoweredArrayArg, index: number): "OK" | "PANIC: array index out of bounds" {
  if (index < 0 || index >= arg.length) return "PANIC: array index out of bounds";
  return "OK";
}

/** Simulates passing the SAME (pointer, length) argument across a
 * multi-hop call chain (f -> g -> h), unchanged - matching Invariant
 * 3 (identity does not change when passed between functions). */
function simulateCallChain(arg: LoweredArrayArg, hops: number): LoweredArrayArg[] {
  const trace: LoweredArrayArg[] = [];
  let current = arg;
  for (let i = 0; i < hops; i++) {
    // A real call boundary in this prototype's own model: the SAME
    // (pointer, length) triple is forwarded unchanged - no new Object
    // is created, no length is recomputed or lost.
    trace.push(current);
    current = { ...current };
  }
  return trace;
}

// ============================================================
// EXPERIMENT: let a = [10,20,30]; sum(a)
// ============================================================

const model: ArrayObjectModel = {
  objects: [{ kind: "ReferenceBackedObject", identity: { objectId: 17 }, descriptive: { length: 3, elementType: "i64" } }],
  relationships: [{ kind: "designates", bindingSlotId: 1, objectId: 17 }],
  ownership: [{ objectId: 17, ownerBindingSlotId: 1 }],
};

console.log("=== Step 1: real v1 model validity ===");
console.log("validateArrayObjectModel:", JSON.stringify(validateArrayObjectModel(model)));

console.log("\n=== Step 2: Lowering Adapter produces (pointer, length) ===");
const lowered = lowerArrayObjectToABI(model, 17, "slot_a");
console.log("Lowered:", JSON.stringify(lowered));

console.log("\n=== Step 3: Bounds Check using the REAL length (not a sentinel) ===");
console.log("index 0:", boundsCheck(lowered!, 0));
console.log("index 2:", boundsCheck(lowered!, 2));
console.log("index 3 (out of bounds):", boundsCheck(lowered!, 3));

// ============================================================
// EXPERIMENT: let a = [10,20,30]; f(a); g(a); h(a)
// ============================================================

console.log("\n=== Step 4: multi-hop chain f -> g -> h ===");
const chain = simulateCallChain(lowered!, 3);
chain.forEach((hop, i) => {
  const identityPreserved = hop.objectId === 17;
  const lengthPreserved = hop.length === 3;
  const elementTypePreserved = hop.elementType === "i64";
  console.log(`Hop ${i + 1} (${["f", "g", "h"][i]}): identity=${identityPreserved}, length=${lengthPreserved}, elementType=${elementTypePreserved}, boundsCheck(2)=${boundsCheck(hop, 2)}, boundsCheck(3)=${boundsCheck(hop, 3)}`);
});

console.log("\n=== Step 5: does this violate any Invariant? ===");
console.log("Invariant 1 (Reference-backed Object, never Atomic):", model.objects[0]!.kind === "ReferenceBackedObject" ? "PRESERVED" : "VIOLATED");
console.log("Invariant 3 (identity unchanged across calls):", chain.every(h => h.objectId === 17) ? "PRESERVED" : "VIOLATED");
console.log("Invariant 4 (Length belongs to entity, not type):", chain.every(h => h.length === 3) ? "PRESERVED" : "VIOLATED");
console.log("Object Definition (Identity+Length+ElementType all present):", (lowered!.objectId !== undefined && lowered!.length >= 0 && lowered!.elementType !== undefined) ? "SATISFIED" : "NOT SATISFIED");
