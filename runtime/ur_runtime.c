// ─────────────────────────────────────────────────────────────────────────────
// UR Runtime Core — Implementation
// Level 2.4
// ─────────────────────────────────────────────────────────────────────────────
//
// ARCHITECTURAL INVARIANT (RUNTIME_SPEC.md §1.4): this file contains ZERO
// references to any Compiler stage. Its only responsibilities are Memory,
// I/O, and Panic/fatal-error handling. See tests/runtime/architecture.test.ts
// for the automated check enforcing this.
// ─────────────────────────────────────────────────────────────────────────────

#include "ur_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Forward declaration — ur_input_string() (below) registers every real
// allocation it makes via this function, defined later in the "Memory"
// section alongside ur_free() and the rest of the allocation-tracking
// mechanism (Compiler & Runtime Stabilization phase). Disabled under
// AddressSanitizer — see ur_free's own comment for why.
#ifndef __SANITIZE_ADDRESS__
static void ur_track_allocated(void* ptr);
#endif

// ── Program lifecycle ───────────────────────────────────────────────────────

void ur_runtime_init(int64_t abi_required) {
    if (abi_required != UR_RUNTIME_ABI_VERSION) {
        fprintf(stderr,
            "UR Runtime ABI mismatch: program requires ABI %lld, runtime provides ABI %d\n",
            (long long)abi_required, UR_RUNTIME_ABI_VERSION);
        exit(102);
    }
    /* reserved for future initialization (e.g. locale setup for I/O) */
}

void ur_runtime_shutdown(void) {
    /* reserved for future teardown */
}

// ── I/O ──────────────────────────────────────────────────────────────────────

void ur_print_int(int64_t value) {
    printf("%lld\n", (long long)value);
}

void ur_print_float(double value) {
    printf("%g\n", value);
}

void ur_print_bool(bool value) {
    printf("%s\n", value ? "true" : "false");
}

void ur_print_string(const char* value) {
    printf("%s\n", value ? value : "");
}

char* ur_input_string(void) {
    // Read one line from stdin without a fixed-size buffer limitation:
    // grow a heap buffer as needed via realloc, matching a real getline()-
    // style implementation without relying on the POSIX-only getline().
    size_t capacity = 128;
    size_t length = 0;
    char* buffer = (char*)malloc(capacity);
    if (!buffer) {
        // Allocation failure here is itself a fatal condition — there is
        // no sensible heap-allocated string to return.
        ur_panic("ur_input_string: out of memory");
    }

    int c;
    while ((c = fgetc(stdin)) != EOF && c != '\n') {
        if (length + 1 >= capacity) {
            size_t newCapacity = capacity * 2;
            char* newBuffer = (char*)realloc(buffer, newCapacity);
            if (!newBuffer) {
                free(buffer);
                ur_panic("ur_input_string: out of memory");
            }
            buffer = newBuffer;
            capacity = newCapacity;
        }
        buffer[length++] = (char)c;
    }
    buffer[length] = '\0';
#ifndef __SANITIZE_ADDRESS__
    ur_track_allocated(buffer); // Compiler & Runtime Stabilization: register this as a real, known allocation so ur_free() can validate against it — disabled under ASan, see ur_free's own comment for why
#endif
    return buffer; // caller owns this; must release via ur_free()
}

// ── Memory ───────────────────────────────────────────────────────────────────
//
// Compiler & Runtime Stabilization phase — confirmed real Critical bug:
// double-free (calling ur_free() twice on the same pointer, or on any
// already-freed pointer) previously called C's own free() a second time,
// which glibc's own malloc implementation detects and responds to with an
// UNCAUGHT SIGABRT ("free(): double free detected in tcache 2") — a real
// crash, not a controlled UR-level panic, confirmed directly. This is a
// SMALL, CONTAINED fix (touches only this one function, the sole free()
// wrapper in the Runtime Core) — NOT the same class of problem as stack-
// overflow detection (which needs platform-specific signal handling); this
// is a simple, bounded pointer-tracking table, the same proven pattern
// already used for the FFI runtime's own memory arena.
//
// Scope, stated precisely: this catches double-free (re-freeing the SAME
// pointer). It does NOT catch use-after-free on a subsequent READ (e.g.
// print(s) after free(s)) — confirmed directly this is still silent,
// undetected UB — because that would require intercepting every
// consumption site of a string value (print, comparisons, FFI calls, ...),
// a broader change not attempted here. Documented as a separate, still-
// open finding.

// Compiler & Runtime Stabilization phase — extends the SAME small,
// contained fix to catch a SECOND confirmed Critical bug: calling
// ur_free() on a pointer that was never allocated by ur_input_string()
// in the first place (e.g. a static string literal, or an arbitrary
// int reinterpreted as a pointer — confirmed directly: UR's own type
// checker does NOT currently restrict free()'s argument type at all,
// a separate, disclosed gap). Previously this reached glibc's own
// free() directly, which correctly detects it's not a valid heap
// pointer and aborts with an uncaught SIGABRT ("free(): invalid
// pointer") — confirmed directly. Fixed the same way as double-free:
// every pointer ur_input_string() actually allocates is recorded;
// ur_free() only proceeds if the incoming pointer is a KNOWN, live
// allocation.
//
// IMPORTANT SIDE EFFECT FOUND AND FIXED: storing every allocated
// pointer in a global array made LeakSanitizer's own reachability
// analysis consider EVERY allocation "still reachable" via that
// global array — confirmed directly: this broke the project's own
// pre-existing "input() without free() is DETECTED by LeakSanitizer"
// test (LSan scans global/static memory for anything pointer-shaped,
// and treats whatever it finds as a reachable root, regardless of the
// declared C type). Fixed: ALL of this tracking (both the freed-set
// and the allocated-set, and both helper functions) is disabled
// entirely — declarations included, not just the logic that uses them
// (a second, real bug this round found: declaring the freed-tracking
// variables OUTSIDE this guard while their only consumer was INSIDE
// it left them orphaned/unused under ASan builds, a real compiler
// warning caught directly by this project's own captureWarnings-
// enabled tests) — when AddressSanitizer/LeakSanitizer is active
// (`__SANITIZE_ADDRESS__`, the standard GCC/Clang macro set by
// `-fsanitize=address`) — those tools already provide STRICTLY BETTER
// detection for every case this tracking exists to catch when
// enabled; this lightweight tracking exists specifically for NORMAL,
// non-sanitized builds, where no other protection is present at all.
#ifndef __SANITIZE_ADDRESS__
#define UR_FREED_TRACKING_MAX 4096
static void* ur_freed_pointers[UR_FREED_TRACKING_MAX];
static int ur_freed_count = 0;

#define UR_ALLOCATED_TRACKING_MAX 4096
static void* ur_allocated_pointers[UR_ALLOCATED_TRACKING_MAX];
static int ur_allocated_count = 0;

// Compiler & Runtime Stabilization phase — REAL BUG found and fixed
// directly by a 50,000-cycle stress test (part of the explicit Runtime
// Stabilization "long-running execution" check): the tracking tables
// above previously only ever GREW (entries added on allocation/free,
// never removed) — meaning the FIXED 4096-entry capacity reflected the
// TOTAL LIFETIME allocation count across the whole process run, not
// the number of SIMULTANEOUSLY LIVE allocations. Confirmed directly:
// a program doing 50,000 sequential input()+free() cycles (never
// holding more than ONE live allocation at a time) incorrectly
// panicked with "invalid pointer passed to free" after roughly the
// 4096th cycle, because ur_track_allocated() had silently stopped
// recording new allocations once the table filled with STALE entries
// for already-freed pointers that were never removed. Fixed: a
// pointer is REMOVED from ur_allocated_pointers[] when it is
// successfully freed (swap-with-last-element removal), so the table's
// real capacity is "how many allocations are live AT ONCE", not "how
// many were EVER made" — a program cycling through allocations
// sequentially now has no practical limit from this table at all.
// Also: if malloc() reuses an address that was previously freed (a
// completely normal, expected allocator behavior), that address is
// removed from ur_freed_pointers[] when it is freshly re-allocated —
// otherwise a legitimately-new allocation at a reused address would
// be incorrectly flagged as an immediate "double free" the next time
// it's freed, a second real bug this same fix closes.

static void ur_remove_from_allocated(void* ptr) {
    for (int i = 0; i < ur_allocated_count; i++) {
        if (ur_allocated_pointers[i] == ptr) {
            ur_allocated_pointers[i] = ur_allocated_pointers[ur_allocated_count - 1];
            ur_allocated_count--;
            return;
        }
    }
}

static void ur_remove_from_freed(void* ptr) {
    for (int i = 0; i < ur_freed_count; i++) {
        if (ur_freed_pointers[i] == ptr) {
            ur_freed_pointers[i] = ur_freed_pointers[ur_freed_count - 1];
            ur_freed_count--;
            return;
        }
    }
}

static void ur_track_allocated(void* ptr) {
    // A freshly (re-)allocated address is, by definition, no longer
    // "freed" — even if malloc() happens to reuse a previously-freed
    // address, matching normal allocator behavior.
    ur_remove_from_freed(ptr);
    if (ur_allocated_count < UR_ALLOCATED_TRACKING_MAX) {
        ur_allocated_pointers[ur_allocated_count++] = ptr;
    }
    // Table exhaustion here means more than 4096 allocations are
    // SIMULTANEOUSLY live at once — a real, disclosed coverage limit
    // (matching the freed-tracking table's own documented bound
    // below) — the allocation itself is unaffected either way.
}

static bool ur_is_known_allocation(void* ptr) {
    for (int i = 0; i < ur_allocated_count; i++) {
        if (ur_allocated_pointers[i] == ptr) return true;
    }
    return false;
}

static bool ur_was_already_freed(void* ptr) {
    for (int i = 0; i < ur_freed_count; i++) {
        if (ur_freed_pointers[i] == ptr) return true;
    }
    return false;
}

// v29-D3-3: extracted from ur_free()'s own original body, verbatim in
// logic (every comment below is the SAME reasoning that already applied
// to ur_free() alone) — now shared between ur_free() (strings) and
// ur_free_array() (arrays), so both get the identical, already-tested
// double-free/invalid-pointer detection with zero duplicated logic and
// zero risk of the two paths silently diverging from each other over
// time. Takes void* since the underlying tracking tables above are
// already void*-typed — genuinely, not merely nominally, reusable
// across pointer types.
static void ur_free_tracked(void* ptr) {
    // Compiler & Runtime Stabilization phase — REAL bug found and fixed
    // directly by re-testing after the removal fix above: checking
    // ur_is_known_allocation() FIRST incorrectly classified a genuine
    // double-free as "invalid pointer" — because the FIRST free() call
    // already REMOVED the pointer from ur_allocated_pointers[] (correct,
    // needed for the capacity fix above), so by the SECOND free() call,
    // the pointer legitimately no longer appears "known allocated",
    // even though it's a real double-free, not a truly-invalid pointer.
    // Fixed: check ur_was_already_freed() FIRST — only if THAT is false
    // do we ask "was this ever a real allocation at all".
    if (ur_was_already_freed(ptr)) {
        ur_panic("double free detected");
    }
    if (!ur_is_known_allocation(ptr)) {
        ur_panic("invalid pointer passed to free");
    }
    ur_remove_from_allocated(ptr); // no longer live — see this fix's own header comment for why this matters at scale
    if (ur_freed_count < UR_FREED_TRACKING_MAX) {
        ur_freed_pointers[ur_freed_count++] = ptr;
    }
    // If the tracking table is exhausted, this specific free() is no
    // longer double-free-checked (a real, disclosed bound — matching how
    // the FFI memory arena's own tracking table has a finite, documented
    // capacity too) but the free() itself still happens correctly below;
    // this is a coverage limit, not a correctness regression for the
    // free() actually being performed.
    free(ptr);
}
#endif

void ur_free(char* ptr) {
    if (ptr == NULL) return; // freeing NULL is always a safe no-op, not a double-free
#ifndef __SANITIZE_ADDRESS__
    ur_free_tracked((void*)ptr);
#else
    free(ptr); // ASan itself provides double-free/invalid-pointer detection here
#endif
}

// v29-D3-3: registers a freshly malloc'd array (emit-c.ts emits this call
// immediately after the array's own inline malloc(), for every isArray
// local slot) — the array-typed counterpart to what ur_input_string()
// already does internally via ur_track_allocated() for strings. Public
// (not static) because generated code, in a separate translation unit,
// must be able to call it — ur_track_allocated() itself stays static/
// internal, exactly as it already was before this addition.
//
// v29-D4: parameter widened from int64_t* to void* — an OUTER array's
// own storage (an array of references) is genuinely int64_t**, not
// int64_t*; this function never dereferences ptr's own pointee type,
// only forwards it to the void*-typed tracking table below, so the
// widening changes no behavior, only removes a real type mismatch.
void ur_register_array_allocation(void* ptr) {
    if (ptr == NULL) return;
#ifndef __SANITIZE_ADDRESS__
    ur_track_allocated(ptr);
#endif
}

// v29-D3-3: the array-typed counterpart to ur_free() above, sharing the
// exact same tracking logic via ur_free_tracked() — no duplicated
// double-free/invalid-pointer detection code, no risk of the two paths
// silently diverging. Per the ratified Free Authority Contract, ownership
// (who is ALLOWED to call this) is the COMPILER's own responsibility
// (ir-builder.ts, v29-D3-2) — this function, like ur_free() above,
// performs only liveness tracking, never an ownership check.
//
// `length` is unused (freeing needs only the address) — present only
// because emit-c.ts's own existing, frozen call-argument encoding
// unconditionally attaches it to any arraySlot-tagged call argument;
// see this function's own header declaration for the full reasoning.
void ur_free_array(int64_t* ptr, int64_t length) {
    (void)length;
    if (ptr == NULL) return;
#ifndef __SANITIZE_ADDRESS__
    ur_free_tracked((void*)ptr);
#else
    free(ptr); // ASan itself provides double-free/invalid-pointer detection here
#endif
}

// ── Panic ────────────────────────────────────────────────────────────────────

void ur_panic(const char* message) {
    fprintf(stderr, "UR panic: %s\n", message ? message : "(no message)");
    exit(101);
}

// ═════════════════════════════════════════════════════════════════════════
// GC FOUNDATION (Gate A9.1) — implementation. See ur_runtime.h for the
// full scope statement. ADDITIVE ONLY — not called by any existing
// path.
// ═════════════════════════════════════════════════════════════════════════

static UrGcHeader *ur_gc_all_allocations = NULL;

// ── Hybrid GC Trigger Policy (Gate A9.5.7) ──────────────────────────────────
// Implements the FROZEN contract from Gate A9.5.6, literally — no
// redesign. Trigger fires (checked, in this exact order, inside
// ur_gc_alloc_array(), BEFORE the new object is allocated — the same
// single, structural safepoint proven in Gate A9.5.2/A9.5.3) when:
//   alloc_count_since_gc >= N
//   OR bytes_since_gc >= B
//   OR (live_bytes_baseline >= R_FLOOR AND bytes_since_gc >= R * live_bytes_baseline)
// Defaults, per Gate A9.5.6's own frozen contract:
#define UR_GC_DEFAULT_N       1000                 // allocations
#define UR_GC_DEFAULT_B       4194304LL             // 4 MiB
#define UR_GC_DEFAULT_R       1.0                   // ratio
#define UR_GC_DEFAULT_R_FLOOR 65536LL                // 64 KiB

static int64_t ur_gc_param_n       = UR_GC_DEFAULT_N;
static int64_t ur_gc_param_b       = UR_GC_DEFAULT_B;
static double  ur_gc_param_r       = UR_GC_DEFAULT_R;
static int64_t ur_gc_param_r_floor = UR_GC_DEFAULT_R_FLOOR;

static int64_t ur_gc_alloc_count_since_gc = 0;
static int64_t ur_gc_bytes_since_gc       = 0;
static int64_t ur_gc_live_bytes_baseline  = 0;
static int64_t ur_gc_automatic_collect_total = 0;

static UrGcHeader *ur_gc_header_of(int64_t *ref) {
    return ((UrGcHeader *)ref) - 1;
}

// Gate A9.5.6's own Decision 4: a saturating add — clamps at
// INT64_MAX rather than wrapping to a negative value. A silent
// wraparound could make `bytes_since_gc >= B` evaluate false when it
// should be true — a real, non-cosmetic trigger-suppression bug, not
// merely a cosmetic counter error (named explicitly in the frozen
// contract as the failure mode this pattern must prevent).
static int64_t ur_gc_saturating_add(int64_t a, int64_t b) {
    if (a > INT64_MAX - b) return INT64_MAX;
    return a + b;
}

/** Test-only: override N, B, R, R_FLOOR for testing each branch of
 *  the hybrid independently at a testable scale. Also resets the
 *  since-last-gc counters, matching a fresh policy start. Passing the
 *  UR_GC_DEFAULT_* constants restores the frozen production values. */
void ur_gc_set_trigger_params(int64_t n, int64_t b, double r, int64_t r_floor) {
    ur_gc_param_n = n;
    ur_gc_param_b = b;
    ur_gc_param_r = r;
    ur_gc_param_r_floor = r_floor;
    ur_gc_alloc_count_since_gc = 0;
    ur_gc_bytes_since_gc = 0;
}

int64_t ur_gc_automatic_collect_count(void) {
    return ur_gc_automatic_collect_total;
}

/** Test-only introspection into the hybrid's own current state. */
int64_t ur_gc_get_alloc_count_since_gc(void) { return ur_gc_alloc_count_since_gc; }
int64_t ur_gc_get_bytes_since_gc(void)       { return ur_gc_bytes_since_gc; }
int64_t ur_gc_get_live_bytes_baseline(void)  { return ur_gc_live_bytes_baseline; }

static int ur_gc_should_trigger(void) {
    if (ur_gc_alloc_count_since_gc >= ur_gc_param_n) return 1;
    if (ur_gc_bytes_since_gc >= ur_gc_param_b) return 1;
    if (ur_gc_live_bytes_baseline >= ur_gc_param_r_floor) {
        // Guard against a double->int64_t comparison itself overflowing
        // for a pathologically large baseline*R; in any realistic
        // scenario (per Gate A9.5.6's own overflow analysis) this branch
        // is only ever reached with baseline values many orders of
        // magnitude below where that would matter.
        double threshold = ur_gc_param_r * (double)ur_gc_live_bytes_baseline;
        if ((double)ur_gc_bytes_since_gc >= threshold) return 1;
    }
    return 0;
}

int64_t* ur_gc_alloc_array(int64_t length, UrGcElementKind element_kind) {
    // GC Trigger Contract (Gate A9.5.3, extended by the Gate A9.5.6
    // frozen hybrid contract in A9.5.7): the safepoint decision and
    // any resulting collection happen HERE, BEFORE the new object is
    // allocated — this remains the ONLY automatic-collection entry
    // point in the entire runtime. At this exact point, per the GC
    // Safepoint proof (Gate A9.5.2), everything already allocated in
    // this or any calling frame is already correctly rooted, and
    // nothing new exists yet that could be incorrectly swept.
    if (ur_gc_should_trigger()) {
        ur_gc_collect(); // resets alloc_count_since_gc, bytes_since_gc
                          // to 0 and sets live_bytes_baseline to the
                          // value accumulated during THIS sweep pass
                          // itself (Gate A9.5.6's own Decision 3) —
                          // done inside ur_gc_collect() itself, below.
        ur_gc_automatic_collect_total++;
    }
    int64_t this_allocation_bytes = (int64_t)sizeof(UrGcHeader) + length * (int64_t)sizeof(int64_t);
    UrGcHeader *header = (UrGcHeader *)malloc((size_t)this_allocation_bytes);
    if (!header) {
        ur_panic("ur_gc_alloc_array: out of memory");
    }
    header->next = ur_gc_all_allocations;
    header->length = length;
    header->marked = 0;
    header->element_kind = element_kind;
    ur_gc_all_allocations = header;
    int64_t *data = (int64_t *)(header + 1);
    memset(data, 0, (size_t)length * sizeof(int64_t));
    ur_gc_alloc_count_since_gc = ur_gc_saturating_add(ur_gc_alloc_count_since_gc, 1);
    ur_gc_bytes_since_gc = ur_gc_saturating_add(ur_gc_bytes_since_gc, this_allocation_bytes);
    return data;
}


int64_t ur_array_length(int64_t *ref) {
    return ur_gc_header_of(ref)->length;
}

// ── Shadow Stack / Precise Roots (Gate A9.3) — implementation ──────────────

#define UR_GC_SHADOW_STACK_CAPACITY 65536
static int64_t *ur_gc_shadow_stack[UR_GC_SHADOW_STACK_CAPACITY];
static int64_t ur_gc_shadow_top = 0;

int64_t ur_gc_push_frame(int64_t count) {
    if (ur_gc_shadow_top + count > UR_GC_SHADOW_STACK_CAPACITY) {
        ur_panic("ur_gc_push_frame: shadow stack overflow");
    }
    int64_t base = ur_gc_shadow_top;
    for (int64_t i = 0; i < count; i++) ur_gc_shadow_stack[base + i] = NULL;
    ur_gc_shadow_top += count;
    return base;
}

void ur_gc_pop_frame(int64_t count) {
    if (count > ur_gc_shadow_top) {
        ur_panic("ur_gc_pop_frame: shadow stack underflow");
    }
    ur_gc_shadow_top -= count;
}

void ur_gc_set_root(int64_t slot, int64_t *value) {
    ur_gc_shadow_stack[slot] = value;
}

int64_t *ur_gc_get_root(int64_t slot) {
    return ur_gc_shadow_stack[slot];
}

/**
 * Test/introspection only: reports the shadow stack's own current
 * depth (top index). Used to verify push/pop balance directly —
 * after a fully-returned top-level call, this MUST read back to
 * exactly whatever it was before that call (typically 0), for any
 * program, regardless of how many nested/recursive calls occurred in
 * between. A nonzero residual after a complete call is a real,
 * concrete bug: a push without a matching pop somewhere on some path.
 */
int64_t ur_gc_shadow_stack_depth(void) {
    return ur_gc_shadow_top;
}

/** Test/introspection only: counts current entries in the live-
 *  allocation sweep list, for adversarial test verification. */
int64_t ur_gc_live_count(void) {
    int64_t count = 0;
    for (UrGcHeader *cur = ur_gc_all_allocations; cur; cur = cur->next) count++;
    return count;
}

// ── Mark, Sweep, Collect (Gate A9.4) — implementation ───────────────────────
// See ur_runtime.h for the full safety-invariant statement this
// design relies on.

static void ur_gc_mark_recursive(int64_t *ref) {
    if (ref == NULL) return;
    UrGcHeader *h = ur_gc_header_of(ref);
    if (h->marked) return; // already visited — safe against sharing,
                            // and, by the same mechanism, against any
                            // future cycle should one ever become
                            // constructible (not a separate feature).
    h->marked = 1;
    if (h->element_kind == UR_GC_ELEMENT_ARRAY_REF) {
        for (int64_t i = 0; i < h->length; i++) {
            int64_t *child = (int64_t *)ref[i]; // element IS the raw
                                                  // pointer (confirmed
                                                  // representation)
            ur_gc_mark_recursive(child);
        }
    }
}

int64_t ur_gc_collect(void) {
    // MARK — walk the FULL, cumulative shadow-stack range
    // [0, ur_gc_shadow_top), covering every currently-active frame's
    // own roots simultaneously, not merely the innermost one
    // (confirmed, Architecture Discovery's own Question 1).
    for (int64_t i = 0; i < ur_gc_shadow_top; i++) {
        ur_gc_mark_recursive(ur_gc_shadow_stack[i]);
    }
    // SWEEP — one pass over the real, already-existing, unbounded
    // sweep list (ur_gc_all_allocations, built by every
    // ur_gc_alloc_array() call since Gate A9.1) — not the old,
    // fixed-4096-capacity tracking table, confirmed distinct.
    // Gate A9.5.6/A9.5.7: live_bytes_baseline is accumulated DURING
    // this same, already-necessary traversal of every survivor — NOT
    // a separate, later walk (Gate A9.5.5's own measured finding: a
    // standalone walk of a 50,000-node list cost 0.2762ms, comparable
    // to a full collection cycle; folding the sum into this existing
    // pass makes it effectively free).
    UrGcHeader **link = &ur_gc_all_allocations;
    int64_t freed = 0;
    int64_t live_bytes = 0;
    while (*link) {
        UrGcHeader *cur = *link;
        if (!cur->marked) {
            *link = cur->next;
            free(cur);
            freed++;
        } else {
            cur->marked = 0;
            live_bytes += (int64_t)sizeof(UrGcHeader) + cur->length * (int64_t)sizeof(int64_t);
            link = &cur->next;
        }
    }
    // Gate A9.5.6's own frozen Decision 3: after a collection, the
    // since-last-gc counters reset to 0, but live_bytes_baseline is
    // set to what was JUST measured during this sweep pass — NOT to
    // 0. A reset to 0 here would silently discard the fact that a
    // large, persistently-live heap remains present (Gate A9.5.5's
    // own direct experiment: ~16MB of live heap invisible to a naive
    // reset-to-zero policy) — every future collection will still need
    // to re-mark that same live heap regardless of how little NEW
    // garbage accumulates, and the R-based branch specifically needs
    // this real baseline to make that visible to the trigger decision.
    ur_gc_alloc_count_since_gc = 0;
    ur_gc_bytes_since_gc = 0;
    ur_gc_live_bytes_baseline = live_bytes;
    return freed;
}

