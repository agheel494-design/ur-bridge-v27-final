/**
 * ADR-005 EVIDENCE: Scenarios 1-3, with strict traceability per
 * direct instruction: ObjectId, Length, and ElementType are passed
 * as EXPLICIT, SEPARATE C arguments at every hop - not inferred from
 * the pointer's address, not a Sentinel. Each C function prints what
 * it received so we can verify, hop by hop, that nothing was
 * re-derived.
 *
 * ir-builder.ts / emit-c.ts remain completely untouched.
 */
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { buildArrayObjectModelFromProgram } from "../src/compiler/typesystem/array-object-model-builder.js";
import { validateArrayObjectModel } from "../src/shared/array-object-model.js";

function realArrayObjectFromSource(src: string) {
  const { tokens } = lex(src);
  const { program, errors } = parse(tokens);
  if (errors.length > 0) throw new Error("parse: " + JSON.stringify(errors));
  const tc = typeCheck(program);
  const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
  if (tcErr.length > 0) throw new Error("typecheck: " + JSON.stringify(tcErr));
  const model = buildArrayObjectModelFromProgram(program);
  const failures = validateArrayObjectModel(model);
  if (failures.length > 0) throw new Error("validate: " + JSON.stringify(failures));
  const obj = model.objects[0];
  if (!obj) throw new Error("no Object produced");
  return { objectId: obj.identity.objectId, length: obj.descriptive.length, elementType: obj.descriptive.elementType };
}

// ============================================================
// Scenario 1: single function — real ObjectId/Length/ElementType
// extracted from real UR source
// ============================================================
const real1 = realArrayObjectFromSource(`function main(): int
  let a = [10, 20, 30]
  return a[0]
end
`);
console.log("Scenario 1 - real extracted:", JSON.stringify(real1));

// ============================================================
// Scenario 2 + 3 combined: f -> g -> h, AND the same array passed
// twice (once to h, once again directly to f) - tests repeated
// passing without re-derivation.
// ============================================================
const cCode = `
#include <stdio.h>
#include <stdlib.h>
static void ur_panic(const char *msg) { fprintf(stderr, "UR panic: %s\\n", msg); exit(101); }

/* Explicit, separate objectId/length/elementType arguments at EVERY
 * hop - proving these are TRACKED, not re-derived from the pointer's
 * own address or a Sentinel. Each hop prints what it received. */
static int64_t bounds_checked_read(int64_t *a, int64_t objectId, int64_t length, int64_t elementType, int64_t index) {
  printf("  bounds_checked_read: objectId=%lld length=%lld elementType=%lld index=%lld\\n", (long long)objectId, (long long)length, (long long)elementType, (long long)index);
  if (index < 0 || index >= length) ur_panic("array index out of bounds");
  return a[index];
}
int64_t f(int64_t *a, int64_t objectId, int64_t length, int64_t elementType) {
  printf("f: objectId=%lld length=%lld elementType=%lld\\n", (long long)objectId, (long long)length, (long long)elementType);
  return bounds_checked_read(a, objectId, length, elementType, 0) + bounds_checked_read(a, objectId, length, elementType, 2);
}
int64_t g(int64_t *a, int64_t objectId, int64_t length, int64_t elementType) {
  printf("g: objectId=%lld length=%lld elementType=%lld\\n", (long long)objectId, (long long)length, (long long)elementType);
  return f(a, objectId, length, elementType);
}
int64_t h(int64_t *a, int64_t objectId, int64_t length, int64_t elementType) {
  printf("h: objectId=%lld length=%lld elementType=%lld\\n", (long long)objectId, (long long)length, (long long)elementType);
  return g(a, objectId, length, elementType);
}

int main(void) {
  int64_t slot_a[${real1.length}] = {10, 20, 30};
  int64_t objectId = ${real1.objectId};    /* real, extracted */
  int64_t length = ${real1.length};        /* real, extracted */
  int64_t elementType = 0; /* i64 = 0, encoded for this experiment only */

  printf("=== Scenario 2: f -> g -> h ===\\n");
  int64_t r1 = h(slot_a, objectId, length, elementType);
  printf("h(a) result: %lld (expected 40)\\n", (long long)r1);

  printf("=== Scenario 3: same array passed AGAIN, directly to f ===\\n");
  int64_t r2 = f(slot_a, objectId, length, elementType);
  printf("f(a) second call result: %lld (expected 40, same objectId/length as before)\\n", (long long)r2);

  printf("=== Scenario 3b: real out-of-bounds using the SAME tracked length ===\\n");
  int64_t bad = bounds_checked_read(slot_a, objectId, length, elementType, 10);
  printf("unreachable: %lld\\n", (long long)bad);
  return 0;
}
`;
writeFileSync("/tmp/adr005_evidence.c", cCode);
execSync("gcc /tmp/adr005_evidence.c -o /tmp/adr005_evidence_bin");
console.log("gcc: PASS\n");
try {
  const out = execSync("/tmp/adr005_evidence_bin").toString();
  console.log(out);
} catch (e: any) {
  console.log(e.stdout?.toString());
  console.log("EXIT:", e.status, "(expected 101)");
}
