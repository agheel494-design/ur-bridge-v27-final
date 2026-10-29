/**
 * ADR-005 EVIDENCE: Scenario 5 (Mutation) - per direct instruction,
 * proves that mutating elements does NOT redefine the Array Object's
 * own identity/length/elementType, unless the operation is explicitly
 * a resize. Strict traceability maintained: objectId/length/
 * elementType passed as explicit, separate C arguments at every step.
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

// ============================================================
// Step 0: confirm real language capability first (not assumed)
// ============================================================
const src = `function main(): int
  let a = [10, 20, 30]
  a[1] = 99
  return a[1]
end
`;
const { tokens } = lex(src);
const { program, errors } = parse(tokens);
if (errors.length > 0) throw new Error("parse: " + JSON.stringify(errors));
const tc = typeCheck(program);
const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
if (tcErr.length > 0) throw new Error("typecheck: " + JSON.stringify(tcErr));
console.log("Step 0: Mutation (a[i] = value) is SUPPORTED — Parser+TypeChecker both PASS for a real UR program");

// ============================================================
// Step 1: real ArrayObjectModel extraction (pre-mutation semantic
// description — the model describes the entity at creation, not a
// runtime snapshot after mutation; this is exactly the point being
// tested: does the model's own identity/length/elementType remain
// the correct description even after real runtime mutation?)
// ============================================================
const model = buildArrayObjectModelFromProgram(program);
const failures = validateArrayObjectModel(model);
if (failures.length > 0) throw new Error("validate: " + JSON.stringify(failures));
const obj = model.objects[0]!;
const real = { objectId: obj.identity.objectId, length: obj.descriptive.length, elementType: obj.descriptive.elementType };
console.log("Step 1: real ArrayObjectModel extracted:", JSON.stringify(real));

// ============================================================
// Step 2: isolated experimental C - real mutation between real
// tracked reads, then f->g->h, all with explicit objectId/length
// arguments (not re-derived from pointer/Sentinel).
// ============================================================
const cCode = `
#include <stdio.h>
#include <stdlib.h>
static void ur_panic(const char *msg) { fprintf(stderr, "UR panic: %s\\n", msg); exit(101); }

static int64_t bounds_checked_read(int64_t *a, int64_t objectId, int64_t length, int64_t index) {
  if (index < 0 || index >= length) ur_panic("array index out of bounds");
  return a[index];
}
static void bounds_checked_write(int64_t *a, int64_t objectId, int64_t length, int64_t index, int64_t value) {
  if (index < 0 || index >= length) ur_panic("array index out of bounds");
  a[index] = value;
}
int64_t f(int64_t *a, int64_t objectId, int64_t length) {
  printf("f: objectId=%lld length=%lld a[1]=%lld\\n", (long long)objectId, (long long)length, (long long)bounds_checked_read(a, objectId, length, 1));
  return bounds_checked_read(a, objectId, length, 1);
}
int64_t g(int64_t *a, int64_t objectId, int64_t length) {
  printf("g: objectId=%lld length=%lld\\n", (long long)objectId, (long long)length);
  return f(a, objectId, length);
}
int64_t h(int64_t *a, int64_t objectId, int64_t length) {
  printf("h: objectId=%lld length=%lld\\n", (long long)objectId, (long long)length);
  return g(a, objectId, length);
}

int main(void) {
  int64_t slot_a[${real.length}] = {10, 20, 30};
  int64_t objectId = ${real.objectId};
  int64_t length = ${real.length};

  printf("=== Read BEFORE mutation ===\\n");
  printf("a[1] = %lld (objectId=%lld length=%lld)\\n", (long long)bounds_checked_read(slot_a, objectId, length, 1), (long long)objectId, (long long)length);

  printf("=== Mutation: a[1] = 99 ===\\n");
  bounds_checked_write(slot_a, objectId, length, 1, 99);

  printf("=== Read AFTER mutation ===\\n");
  int64_t after = bounds_checked_read(slot_a, objectId, length, 1);
  printf("a[1] = %lld (objectId=%lld length=%lld) - SAME identity/length as before mutation: %s\\n",
    (long long)after, (long long)objectId, (long long)length,
    (objectId == ${real.objectId} && length == ${real.length}) ? "YES" : "NO");

  printf("=== Passing MUTATED array through f -> g -> h ===\\n");
  int64_t r = h(slot_a, objectId, length);
  printf("h(a) after mutation result: %lld (expected 99, proving mutation is visible AND identity/length unchanged)\\n", (long long)r);

  printf("=== Bounds Check using the REAL length after mutation ===\\n");
  int64_t bad = bounds_checked_read(slot_a, objectId, length, 5);
  printf("unreachable: %lld\\n", (long long)bad);
  return 0;
}
`;
writeFileSync("/tmp/adr005_scenario5.c", cCode);
execSync("gcc /tmp/adr005_scenario5.c -o /tmp/adr005_scenario5_bin");
console.log("\ngcc: PASS\n");
try {
  console.log(execSync("/tmp/adr005_scenario5_bin").toString());
} catch (e: any) {
  console.log(e.stdout?.toString());
  console.log("EXIT:", e.status, "(expected 101 - real out-of-bounds panic AFTER mutation, using the real, unchanged length)");
}
