// Synthetic C library for Stage 4.2 — generic pointer read/write/
// arithmetic, backing UR's "pointer to any type" capability (UR itself
// has no pointer type; every handle is an opaque i64 — these functions
// let a UR program read/write through such a handle safely, and compute
// offset addresses, entirely via registered native calls).
//
// SAFETY LAYER (added per explicit review request, before Stage 4.2 is
// considered closed): every allocation is tracked (base, size, freed
// status) in a fixed-size table. Every read/write/free validates the
// target address against this table BEFORE touching memory — out-of-
// bounds access, use-after-free, and double-free are all DETECTED and
// reported via a clear error code, never silently corrupting memory or
// crashing the whole process. Pointer arithmetic (ur_mem_offset) itself
// is NOT bounds-checked at computation time (matching real C semantics —
// computing an out-of-range address is allowed; the actual violation is
// checked at the point of DEREFERENCE, i.e. read/write) — this is
// deliberate and documented here, not an oversight (per the review's own
// 4th question: "at least document the behavior clearly").
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

#define UR_MEM_MAX_TRACKED 4096

typedef struct {
  void* base;
  int64_t size;
  int freed;    // 0 = live, 1 = freed
  int inUse;    // 0 = this table slot is empty/available
} UrMemTrackedAlloc;

static UrMemTrackedAlloc g_tracked[UR_MEM_MAX_TRACKED];

// Error codes, readable via ur_mem_last_error() after any operation.
#define UR_MEM_OK               0
#define UR_MEM_ERR_OOB          1  // out-of-bounds access
#define UR_MEM_ERR_USE_AFTER_FREE 2
#define UR_MEM_ERR_UNKNOWN_PTR  3  // pointer not tracked at all (never allocated by ur_mem_alloc, or already fully forgotten)
#define UR_MEM_ERR_DOUBLE_FREE  4
#define UR_MEM_ERR_INVALID_SIZE 5  // negative size, or a size beyond a sane cap
#define UR_MEM_ERR_ALLOC_FAILED 6  // malloc() itself returned NULL (real OOM), distinct from an invalid SIZE request

// A deliberately generous but finite cap — large enough that no
// legitimate test in this project's own scope needs anywhere close to
// it, small enough that a request for it is unambiguously a caller
// error, not a real workload (matches this synthetic library's own
// testing purpose, not a production allocator's real limit).
#define UR_MEM_MAX_SANE_SIZE (1024LL * 1024LL * 1024LL) // 1 GiB

static int g_last_error = UR_MEM_OK;

int32_t ur_mem_last_error(void) { return g_last_error; }

static UrMemTrackedAlloc* find_tracked(void* p) {
  for (int i = 0; i < UR_MEM_MAX_TRACKED; i++) {
    if (g_tracked[i].inUse && g_tracked[i].base == p) return &g_tracked[i];
  }
  return NULL;
}

// Validates that [p, p+accessSize) lies entirely within a LIVE (non-
// freed) tracked allocation. Sets g_last_error and returns 0 on any
// violation; returns 1 (and sets UR_MEM_OK) if the access is valid.
static int validate_access(void* p, int64_t accessSize) {
  for (int i = 0; i < UR_MEM_MAX_TRACKED; i++) {
    UrMemTrackedAlloc* a = &g_tracked[i];
    if (!a->inUse) continue;
    char* base = (char*)a->base;
    char* target = (char*)p;
    if (target < base || target >= base + a->size) continue; // not in THIS allocation's range at all
    if (a->freed) { g_last_error = UR_MEM_ERR_USE_AFTER_FREE; return 0; }
    if (target + accessSize > base + a->size) { g_last_error = UR_MEM_ERR_OOB; return 0; }
    g_last_error = UR_MEM_OK;
    return 1;
  }
  g_last_error = UR_MEM_ERR_UNKNOWN_PTR;
  return 0;
}

void* ur_mem_alloc(int64_t size) {
  if (size <= 0 || size > UR_MEM_MAX_SANE_SIZE) {
    g_last_error = UR_MEM_ERR_INVALID_SIZE;
    return NULL;
  }
  void* p = malloc((size_t)size);
  if (!p) { g_last_error = UR_MEM_ERR_ALLOC_FAILED; return NULL; }
  // Stage 4.2 follow-up fix (found via direct handle-reuse testing):
  // malloc() on Linux/glibc frequently returns the SAME address a
  // just-freed allocation used. The tracking table previously always
  // appended a NEW slot, leaving the OLD (freed) entry for that same
  // address still present — validate_access()'s linear scan then found
  // the STALE, freed entry first, incorrectly flagging the brand-new,
  // perfectly valid allocation as a use-after-free. Fix: reuse (rewrite)
  // any EXISTING slot for this exact address first — freed or not —
  // before falling back to an empty slot. This guarantees at most ONE
  // tracking entry per address at any time, eliminating the stale-match
  // possibility entirely.
  for (int i = 0; i < UR_MEM_MAX_TRACKED; i++) {
    if (g_tracked[i].inUse && g_tracked[i].base == p) {
      g_tracked[i].size = size;
      g_tracked[i].freed = 0;
      g_last_error = UR_MEM_OK;
      return p;
    }
  }
  for (int i = 0; i < UR_MEM_MAX_TRACKED; i++) {
    if (!g_tracked[i].inUse) {
      g_tracked[i].base = p;
      g_tracked[i].size = size;
      g_tracked[i].freed = 0;
      g_tracked[i].inUse = 1;
      g_last_error = UR_MEM_OK;
      return p;
    }
  }
  // Tracking table exhausted — free immediately and report as unknown,
  // rather than return an untracked pointer that would silently bypass
  // all future safety checks.
  free(p);
  g_last_error = UR_MEM_ERR_UNKNOWN_PTR;
  return NULL;
}

void ur_mem_free(void* p) {
  UrMemTrackedAlloc* a = find_tracked(p);
  if (!a) { g_last_error = UR_MEM_ERR_UNKNOWN_PTR; return; }
  if (a->freed) { g_last_error = UR_MEM_ERR_DOUBLE_FREE; return; }
  free(p);
  a->freed = 1;
  g_last_error = UR_MEM_OK;
}

// Pointer arithmetic: returns base + offsetBytes (byte-granular).
// Deliberately NOT bounds-checked here — see the file header comment.
void* ur_mem_offset(void* base, int64_t offsetBytes) {
  g_last_error = UR_MEM_OK;
  return (char*)base + offsetBytes;
}

int32_t ur_mem_read_i32(void* p) {
  if (!validate_access(p, sizeof(int32_t))) return 0;
  int32_t v; memcpy(&v, p, sizeof v); return v;
}
void ur_mem_write_i32(void* p, int32_t v) {
  if (!validate_access(p, sizeof(int32_t))) return;
  memcpy(p, &v, sizeof v);
}
int64_t ur_mem_read_i64(void* p) {
  if (!validate_access(p, sizeof(int64_t))) return 0;
  int64_t v; memcpy(&v, p, sizeof v); return v;
}
void ur_mem_write_i64(void* p, int64_t v) {
  if (!validate_access(p, sizeof(int64_t))) return;
  memcpy(p, &v, sizeof v);
}
double ur_mem_read_f64(void* p) {
  if (!validate_access(p, sizeof(double))) return 0.0;
  double v; memcpy(&v, p, sizeof v); return v;
}
void ur_mem_write_f64(void* p, double v) {
  if (!validate_access(p, sizeof(double))) return;
  memcpy(p, &v, sizeof v);
}
uint8_t ur_mem_read_u8(void* p) {
  if (!validate_access(p, sizeof(uint8_t))) return 0;
  uint8_t v; memcpy(&v, p, sizeof v); return v;
}
void ur_mem_write_u8(void* p, uint8_t v) {
  if (!validate_access(p, sizeof(uint8_t))) return;
  memcpy(p, &v, sizeof v);
}
void* ur_mem_read_ptr(void* p) {
  if (!validate_access(p, sizeof(void*))) return NULL;
  void* v; memcpy(&v, p, sizeof v); return v;
}
void ur_mem_write_ptr(void* p, void* v) {
  if (!validate_access(p, sizeof(void*))) return;
  memcpy(p, &v, sizeof v);
}
