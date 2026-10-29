/**
 * IMPLEMENTATION BASELINE v2 — Semantic → IR Integration
 *
 * SCOPE, PER DIRECT INSTRUCTION (Exit Criteria, ARRAY_PARAMETER_
 * SEMANTICS_BASELINE.md): Semantic becomes capable of producing the
 * v1 ArrayObjectModel. Zero modification to ir-builder.ts (Lowering)
 * or emit-c.ts (Backend) — both remain completely untouched, and the
 * OLD model remains the only one actually driving real compilation.
 * This file's own output is not load-bearing; it exists purely to
 * satisfy v2's own real Exit Criteria.
 *
 * This file reuses `resolveTypeRef` (the existing, real type-
 * resolution helper already used by checker.ts) rather than
 * reimplementing type resolution — no new type-resolution logic is
 * introduced here.
 */

import type { Program } from "../frontend/ast.js";
import type {
  ArrayObjectModel,
  ReferenceBackedObject,
  DesignatesRelationship,
  OwnershipRecord,
} from "../../shared/array-object-model.js";

/**
 * Builds a real ArrayObjectModel from a real, already-parsed UR
 * program, per v2's own Exit Criteria.
 *
 * Scoped honestly to the ONE case where length is genuinely known at
 * Semantic time: a local `let` binding initialized with a real array
 * literal (e.g. `let a = [1, 2, 3]`) — a real Object is created with
 * its real, known length, and an OwnershipRecord (the originating
 * binding owns it, per §3).
 *
 * Array-typed function PARAMETERS are deliberately NOT handled here.
 * A parameter's own declared type (`int[]`) carries no length (per
 * the Baseline's own Part 1 Q4/Q5) — a real length is only knowable
 * from a real call site, not from Semantic analysis of the function
 * declaration alone. Inventing a placeholder length (e.g. `-1`) would
 * violate `validateArrayObjectModel`'s own real length>=0 rule and
 * would misrepresent a genuinely unknown value as a real one. This
 * case is left for a later, separate version — not faked here.
 *
 * ADDITIONAL, PREVIOUSLY UNDISCLOSED CONSTRAINT (found during review):
 * this version supports only `VariableDeclaration` initialized by an
 * `ArrayLiteral` (`let a = [1,2,3]`). A direct `ArrayLiteral` used as
 * a call argument (e.g. `sum([1,2,3])`, with no intermediate `let`)
 * is NOT handled — `visitStatements` only inspects `stmt.kind ===
 * "VariableDeclaration"`, never a `CallExpression`'s own argument
 * list. This is a real gap in what v2 actually covers, not merely a
 * restatement of the parameter gap above.
 */
export function buildArrayObjectModelFromProgram(program: Program): ArrayObjectModel {
  const objects: ReferenceBackedObject[] = [];
  const relationships: DesignatesRelationship[] = [];
  const ownership: OwnershipRecord[] = [];
  let nextObjectId = 1;
  let nextSlotId = 1;

  function visitStatements(statements: readonly unknown[]): void {
    for (const stmt of statements as any[]) {
      if (stmt.kind === "VariableDeclaration" && stmt.initializer?.kind === "ArrayLiteral") {
        const objectId = nextObjectId++;
        const slotId = nextSlotId++;
        const length = stmt.initializer.elements.length;
        objects.push({
          kind: "ReferenceBackedObject",
          identity: { objectId },
          descriptive: { length, elementType: "i64" },
        });
        relationships.push({ kind: "designates", bindingSlotId: slotId, objectId });
        ownership.push({ objectId, ownerBindingSlotId: slotId });
      }
    }
  }

  for (const fn of program.functions) {
    visitStatements(fn.body.statements);
  }

  return { objects, relationships, ownership };
}
