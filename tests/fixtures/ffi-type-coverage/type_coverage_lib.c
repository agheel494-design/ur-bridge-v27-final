// Synthetic C library covering every type Stage 4.1 requires, so the
// wrapper mechanism can be proven correct for widths no convenient real
// library function happens to expose (int8/16/32, uint8/16/32/64).
#include <stdint.h>
#include <stdbool.h>

int8_t   ur_test_i8(int8_t x)   { return x + 1; }
int16_t  ur_test_i16(int16_t x) { return x + 1; }
int32_t  ur_test_i32(int32_t x) { return x + 1; }
int64_t  ur_test_i64(int64_t x) { return x + 1; }
uint8_t  ur_test_u8(uint8_t x)  { return x + 1; }
uint16_t ur_test_u16(uint16_t x){ return x + 1; }
uint32_t ur_test_u32(uint32_t x){ return x + 1; }
uint64_t ur_test_u64(uint64_t x){ return x + 1; }
float    ur_test_float(float x) { return x + 1.0f; }
double   ur_test_double(double x) { return x + 1.0; }
bool     ur_test_bool(bool x)   { return !x; }
const char* ur_test_charptr(const char* s) { return s; }
void*    ur_test_voidptr(void* p) { return p; }
