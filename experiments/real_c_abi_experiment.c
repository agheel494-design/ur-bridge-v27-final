/* REAL C ABI EXPERIMENT — hand-written C, explicitly isolated per
 * direct instruction: does NOT go through emit-c.ts or the real
 * compiler pipeline. Tests whether the (pointer, length) ABI concept
 * actually works with real gcc + real execution, across a real
 * multi-hop call chain (f -> g -> h), before ir-builder.ts/emit-c.ts
 * are ever touched.
 *
 * This simulates the exact (pointer, length) signature style the
 * proof_of_representation.ts prototype proposed:
 *   sum(int64_t* a, int64_t a_length)
 */
#include <stdio.h>
#include <stdlib.h>

static void ur_panic(const char *msg) {
  fprintf(stderr, "UR panic: %s\n", msg);
  exit(101);
}

/* Real bounds-checked read, using the REAL length parameter - not a
 * sentinel, not slot.length from the real emit-c.ts mechanism. */
static int64_t bounds_checked_read(int64_t *a, int64_t a_length, int64_t index) {
  if (index < 0 || index >= a_length) ur_panic("array index out of bounds");
  return a[index];
}

/* f -> g -> h, each receiving the SAME (pointer, length) pair
 * unchanged - matching Invariant 3 (identity does not change when
 * passed between functions). */
int64_t f(int64_t *a, int64_t a_length) {
  return bounds_checked_read(a, a_length, 0) + bounds_checked_read(a, a_length, 2);
}
int64_t g(int64_t *a, int64_t a_length) {
  return f(a, a_length);
}
int64_t h(int64_t *a, int64_t a_length) {
  return g(a, a_length);
}

int main(void) {
  int64_t arr[3] = {10, 20, 30};
  int64_t result = h(arr, 3);
  printf("%lld\n", (long long)result);

  /* Real out-of-bounds test at the DEEPEST hop, same (pointer,length) pair */
  int64_t bad = bounds_checked_read(arr, 3, 5);
  printf("unreachable: %lld\n", (long long)bad);
  return 0;
}
