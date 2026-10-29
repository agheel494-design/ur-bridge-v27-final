/**
 * ADR-005 EVIDENCE: Scenario 7 (Bounds Check, comprehensive) - per
 * direct instruction, tests index=0, index=length-1, index=length,
 * index>length, zero-length array (capability-checked first),
 * mutation-then-read, f->g->h, repeated passing, and explicitly
 * confirms the length used in the check is the SAME real, tracked
 * length - never a Sentinel, never affected by ObjectId's own value.
 *
 * ir-builder.ts / emit-c.ts remain completely untouched.
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { buildArrayObjectModelFromProgram } from "../src/compiler/typesystem/array-object-model-builder.js";
import { validateArrayObjectModel } from "../src/shared/array-object-model.js";

// ============================================================
// Step 0: zero-length array — real capability check first
// ============================================================
{
  const { tokens } = lex("function main(): int\n  let a = []\n  return 0\nend\n");
  const { program, errors } = parse(tokens);
  if (errors.length === 0) {
    const tc = typeCheck(program);
    const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
    console.log("Step 0 (zero-length array []):", tcErr.length > 0 ? "UNSUPPORTED - " + JSON.stringify(tcErr.map((d: any) => d.code)) : "SUPPORTED");
  }
}

// ============================================================
// Step 1: real extraction for the main case (length=3)
// ============================================================
const src = `function main(): int
  let a = [10, 20, 30]
  return a[0]
end
`;
const { tokens } = lex(src);
const { program, errors } = parse(tokens);
if (errors.length > 0) throw new Error("parse: " + JSON.stringify(errors));
const tc = typeCheck(program);
const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
if (tcErr.length > 0) throw new Error("typecheck: " + JSON.stringify(tcErr));
const model = buildArrayObjectModelFromProgram(program);
const failures = validateArrayObjectModel(model);
if (failures.length > 0) throw new Error("validate: " + JSON.stringify(failures));
const obj = model.objects[0]!;
const real = { objectId: obj.identity.objectId, length: obj.descriptive.length };
console.log("Step 1: real extracted:", JSON.stringify(real));

// ============================================================
// Step 2: comprehensive C experiment
// ============================================================
const cCode = `
#include <stdio.h>
#include <stdlib.h>
static int panicCount = 0;
static void ur_panic(const char *msg) { printf("  PANIC: %s\\n", msg); panicCount++; }

static int64_t bounds_checked_read(int64_t *a, int64_t objectId, int64_t length, int64_t index) {
  if (index < 0 || index >= length) { ur_panic("array index out of bounds"); return -999; }
  return a[index];
}

int64_t f(int64_t *a, int64_t objectId, int64_t length, int64_t index) { return bounds_checked_read(a, objectId, length, index); }
int64_t g(int64_t *a, int64_t objectId, int64_t length, int64_t index) { return f(a, objectId, length, index); }
int64_t h(int64_t *a, int64_t objectId, int64_t length, int64_t index) { return g(a, objectId, length, index); }

int main(void) {
  int64_t slot_a[${real.length}] = {10, 20, 30};
  int64_t objectId = ${real.objectId};
  int64_t length = ${real.length};

  printf("=== index=0 (first) ===\\n");
  printf("result=%lld\\n", (long long)bounds_checked_read(slot_a, objectId, length, 0));

  printf("=== index=length-1 (last valid) ===\\n");
  printf("result=%lld\\n", (long long)bounds_checked_read(slot_a, objectId, length, length - 1));

  printf("=== index=length (one past end, should PANIC) ===\\n");
  bounds_checked_read(slot_a, objectId, length, length);

  printf("=== index=length+5 (well past end, should PANIC) ===\\n");
  bounds_checked_read(slot_a, objectId, length, length + 5);

  printf("=== Mutation then read (bounds must still use real length) ===\\n");
  slot_a[1] = 99;
  printf("a[1] after mutation=%lld, then index=length still PANICs:\\n", (long long)bounds_checked_read(slot_a, objectId, length, 1));
  bounds_checked_read(slot_a, objectId, length, length);

  printf("=== f -> g -> h, valid index ===\\n");
  printf("h result=%lld\\n", (long long)h(slot_a, objectId, length, 2));

  printf("=== f -> g -> h, out-of-bounds index (deepest hop) ===\\n");
  h(slot_a, objectId, length, length + 1);

  printf("=== Repeated passing, same object, different indices ===\\n");
  for (int64_t i = 0; i < length; i++) printf("  pass %lld: result=%lld\\n", (long long)i, (long long)bounds_checked_read(slot_a, objectId, length, i));

  printf("=== A SECOND object, DIFFERENT objectId (99), SAME length (3) ===\\n");
  int64_t slot_b[3] = {100, 200, 300};
  int64_t objectId_b = 99;
  int64_t length_b = 3;
  printf("object B index=2: %lld\\n", (long long)bounds_checked_read(slot_b, objectId_b, length_b, 2));
  printf("object B index=3 (out of bounds):\\n");
  bounds_checked_read(slot_b, objectId_b, length_b, 3);

  printf("\\n=== TOTAL PANICS: %d ===\\n", panicCount);
  return 0;
}
`;
writeFileSync("/tmp/adr005_scenario7.c", cCode);
execSync("gcc /tmp/adr005_scenario7.c -o /tmp/adr005_scenario7_bin");
console.log("\ngcc: PASS\n");
console.log(execSync("/tmp/adr005_scenario7_bin").toString());
