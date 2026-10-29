/**
 * REAL LOWERING EXPERIMENT — per direct instruction. Closes the one
 * missing loop from the prior two experiments: does the REAL UR
 * compiler frontend (lex/parse/typeCheck) combined with the REAL,
 * existing v2 `buildArrayObjectModelFromProgram` produce a real
 * `length` value that can drive a (pointer, length) C emission -
 * WITHOUT touching ir-builder.ts or emit-c.ts (both remain completely
 * untouched, per direct instruction to keep them protected).
 *
 * This file's own C-emission logic is a NEW, standalone, throwaway
 * experimental emitter - not a modification of the real emit-c.ts,
 * and not wired into the real compiler pipeline.
 */
import { writeFileSync } from "fs";
import { execSync } from "child_process";
import { lex } from "../src/compiler/frontend/lexer.js";
import { parse } from "../src/compiler/frontend/parser.js";
import { typeCheck } from "../src/compiler/typesystem/checker.js";
import { buildArrayObjectModelFromProgram } from "../src/compiler/typesystem/array-object-model-builder.js";
import { validateArrayObjectModel } from "../src/shared/array-object-model.js";

// ============================================================
// Step 1: REAL UR source, REAL frontend, completely untouched
// ============================================================
const src = `function main(): int
  let a = [10, 20, 30]
  return a[0]
end
`;
const { tokens } = lex(src);
const { program, errors } = parse(tokens);
console.log("1. Real Parser:", errors.length === 0 ? "PASS" : "FAIL " + JSON.stringify(errors));

const tc = typeCheck(program);
const tcErr = (tc.diagnostics ?? []).filter((d: any) => d.severity === "error");
console.log("2. Real TypeChecker:", tcErr.length === 0 ? "PASS" : "FAIL " + JSON.stringify(tcErr));

// ============================================================
// Step 2: REAL, existing v2 ArrayObjectModel builder, untouched
// ============================================================
const model = buildArrayObjectModelFromProgram(program);
console.log("3. Real buildArrayObjectModelFromProgram output:", JSON.stringify(model));
console.log("4. Real validateArrayObjectModel:", JSON.stringify(validateArrayObjectModel(model)));

const realObject = model.objects[0];
if (!realObject) { console.log("FAIL: no Object produced"); process.exit(1); }
const realLength = realObject.descriptive.length;
console.log(`5. REAL length extracted from REAL UR source via REAL Semantic pipeline: ${realLength} (expected 3)`);

// ============================================================
// Step 3: NEW, isolated experimental C emitter - (pointer, length)
// style, informed by the REAL extracted length above. This is NOT
// emit-c.ts - a separate, throwaway experimental emitter.
// ============================================================
const experimentalC = `
#include <stdio.h>
#include <stdlib.h>
static void ur_panic(const char *msg) { fprintf(stderr, "UR panic: %s\\n", msg); exit(101); }
static int64_t bounds_checked_read(int64_t *a, int64_t a_length, int64_t index) {
  if (index < 0 || index >= a_length) ur_panic("array index out of bounds");
  return a[index];
}
int64_t f(int64_t *a, int64_t a_length) { return bounds_checked_read(a, a_length, 0) + bounds_checked_read(a, a_length, 2); }
int64_t g(int64_t *a, int64_t a_length) { return f(a, a_length); }
int64_t h(int64_t *a, int64_t a_length) { return g(a, a_length); }
int main(void) {
  int64_t slot_a[${realLength}] = {10, 20, 30};
  int64_t a_length = ${realLength}; /* <-- REAL length, extracted above from REAL UR source via REAL Semantic pipeline, not hand-typed as a constant in a prior experiment */
  printf("%lld\\n", (long long)h(slot_a, a_length));
  int64_t bad = bounds_checked_read(slot_a, a_length, 5);
  printf("unreachable: %lld\\n", (long long)bad);
  return 0;
}
`;
writeFileSync("/tmp/real_lowering_experiment.c", experimentalC);
console.log("6. Experimental C emission (NOT emit-c.ts): PASS");

execSync("gcc /tmp/real_lowering_experiment.c -o /tmp/real_lowering_bin");
console.log("7. gcc: PASS");

const exitCode = (() => { try { execSync("/tmp/real_lowering_bin", { stdio: ["ignore", "pipe", "pipe"] }); return 0; } catch (e: any) { console.log(e.stdout?.toString()); return e.status; } })();
console.log(`8. Real execution EXIT: ${exitCode} (expected 101 - real out-of-bounds panic using the REAL, extracted length)`);
