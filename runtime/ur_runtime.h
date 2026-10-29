// ─────────────────────────────────────────────────────────────────────────────
// UR Runtime Core — Public Header
// Level 2.4
// ─────────────────────────────────────────────────────────────────────────────
//
// This header declares exactly the Runtime Core function table specified
// in RUNTIME_SPEC.md §4.3, matching src/shared/runtime-table.ts's
// RUNTIME_CORE_EXTERNS one-for-one. Every function here is what generated
// UR programs (via src/backend/c/emit-c.ts) may call.
//
// ARCHITECTURAL INVARIANT (RUNTIME_SPEC.md §1.4): this file and
// ur_runtime.c contain ZERO references to, and ZERO dependencies on, any
// Compiler stage — no Lexer, Parser, AST, Semantic Analyzer, Type
// Checker, IR, or Optimizer concept appears anywhere below. This file's
// only concerns are Memory, I/O, and Panic/fatal-error handling. This
// invariant is enforced by a dedicated architecture test — see
// tests/runtime/architecture.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

#ifndef UR_RUNTIME_H
#define UR_RUNTIME_H

#include <stdint.h>
#include <stdbool.h>

// ── Runtime ABI Version Contract (RUNTIME_SPEC.md §4.4) ────────────────────
//
// Every ur_runtime.c build declares this constant. Every generated .c file
// (emit-c.ts) embeds UR_RUNTIME_ABI_REQUIRED and ur_runtime_init() checks
// they match at program startup. Increment ONLY on a breaking change to
// the function table below (a function removed, a signature changed, or
// semantics changed incompatibly) — adding a new function is not breaking.

#define UR_RUNTIME_ABI_VERSION 1

// ── Program lifecycle (RUNTIME_SPEC.md §3) ──────────────────────────────────

/**
 * Called once, before any UR code runs. Checks UR_RUNTIME_ABI_REQUIRED
 * (defined by the generated program, see emit-c.ts) against
 * UR_RUNTIME_ABI_VERSION above; exits with code 102 on mismatch (a
 * build/toolchain problem, distinct from a program panic — see
 * ur_panic's exit code 101 below). Reserved for future initialization
 * (e.g. locale setup for I/O) — currently does nothing else.
 */
void ur_runtime_init(int64_t abi_required);

/**
 * Called once, after UR's own `main` returns normally. NOT called on a
 * panic path (ur_panic exits directly — a panic is not a normal return).
 * Reserved for future teardown; currently does nothing.
 */
void ur_runtime_shutdown(void);

// ── I/O (RUNTIME_SPEC.md §4.3) ──────────────────────────────────────────────
//
// Every print function writes its argument followed by a newline to
// stdout. The Lowering pass (a future step — print()/input() wiring is
// explicitly NOT part of this step) will choose which of these four to
// call based on the UR expression's static type; the Runtime itself
// performs no overload resolution (RUNTIME_SPEC.md §4.3's confirmed
// decision).

void ur_print_int(int64_t value);
void ur_print_float(double value);
void ur_print_bool(bool value);
void ur_print_string(const char* value);

/**
 * Reads one line from stdin (without the trailing newline) and returns
 * it as a heap-allocated, null-terminated string OWNED BY THE CALLER.
 * The caller must release it via ur_free() — never C's free() directly
 * (RUNTIME_SPEC.md §2.2). Returns an empty, still-heap-allocated string
 * on EOF/read error (never NULL) so callers never need a null check
 * before eventually calling ur_free().
 */
char* ur_input_string(void);

// ── Memory (RUNTIME_SPEC.md §2.2) ───────────────────────────────────────────

/**
 * The ONLY sanctioned way to release memory returned by ur_input_string().
 * Generated code and any future Standard Library code must never call
 * C's free() directly — this indirection is what lets a future phase
 * replace malloc/free with an arena allocator, reference counting, or a
 * garbage collector without changing any already-compiled UR program.
 */
void ur_free(char* ptr);

/**
 * v29-D3-3 (Array Lifetime & Reclamation, C code generation path only): registers a
 * freshly malloc'd array allocation (emitted inline by emit-c.ts, at
 * the array's own literal-construction site) as a known, live
 * allocation — the array-typed counterpart to what ur_input_string()
 * already does internally for strings. Must be called exactly once,
 * immediately after the array's own malloc(), for ur_free_array()'s
 * own double-free/invalid-pointer detection to have anything real to
 * check against. Reuses the SAME internal tracking table ur_free()
 * already uses — see ur_runtime.c's own ur_free_tracked() helper.
 * Takes `void*`, not `int64_t*` — a real, minimal widening added in
 * v29-D4 (Gap A, Nested Literal Construction): an OUTER array's own
 * storage (an array of references) is genuinely `int64_t**`, not
 * `int64_t*` — confirmed directly by a real `gcc -Wall` warning this
 * round (`passing argument... from incompatible pointer type`).
 * Internally this function only ever passes its own parameter through
 * to a `void*`-typed tracking table (see ur_runtime.c's own
 * ur_track_allocated(), unchanged) — it never dereferences or
 * interprets the pointee's own type, so this widening changes no
 * behavior, only removes a real, avoidable type mismatch at every
 * call site the code generator produces.
 */
void ur_register_array_allocation(void* ptr);

/**
 * v29-D3-3: the array-typed counterpart to ur_free() above — same
 * sanctioned-only-path rule, same double-free/invalid-pointer
 * detection (via the shared ur_free_tracked() internal helper), same
 * real free() underneath. Per the ratified v29-D3 Free Authority
 * Contract, the COMPILER (ir-builder.ts, v29-D3-2) — not this
 * function — is responsible for ensuring only an owning array
 * reference ever reaches this call; this function itself performs no
 * ownership check, only liveness tracking, exactly mirroring how
 * ur_free() above performs no ownership check either.
 *
 * Takes `length` because emit-c.ts's own EXISTING, already-frozen
 * (D2/ADR-005) call-argument encoding unconditionally expands any
 * arraySlot-tagged call argument into a (pointer, length) C argument
 * pair, for every callee — not just user functions expecting an
 * array parameter. Rather than touch that shared, frozen encoding
 * logic (which the v29-D3-3 authorization explicitly forbids),
 * ur_free_array's own signature was adapted to match what it already,
 * unconditionally produces. `length` is intentionally unused —
 * freeing an allocation needs only its address, not its size.
 */
void ur_free_array(int64_t* ptr, int64_t length);

// ── Panic / fatal errors (RUNTIME_SPEC.md §7) ───────────────────────────────

/**
 * Prints "UR panic: <message>" to stderr and terminates the process with
 * exit code 101. Never returns. This is the ONLY sanctioned way generated
 * code may terminate abnormally — never a raw C exit()/abort() call.
 */
void ur_panic(const char* message);

// ═════════════════════════════════════════════════════════════════════════
// GC FOUNDATION (Gate A9.1 — UR-MEMORY-RESOURCE-MODEL Architecture Charter)
// ═════════════════════════════════════════════════════════════════════════
// ADDITIVE ONLY. Nothing below is called by any existing code path —
// emit-c.ts does not emit calls to any of this yet (that is Gate A9.2's
// own, later, separately-gated scope). This section exists so the
// unified per-allocation header ADR-MEM-001/Gate A8 identified as
// missing can be independently built and tested BEFORE any codegen
// change touches it, per the Charter's own "controlled integration,
// not one large change" discipline.
//
// Scope, precisely: unified allocation metadata, allocation, and
// length query only. Mark/sweep and root management are explicitly
// OUT of this section's own scope — a collector needs roots to mark
// from, and root management (the shadow stack) is Gate A9.3's own,
// separate, not-yet-begun work. Nothing here performs collection.

typedef enum {
    UR_GC_ELEMENT_SCALAR = 0,     // elements are plain int64_t values
    UR_GC_ELEMENT_ARRAY_REF = 1   // elements are themselves references
                                   // to other GC-managed allocations
} UrGcElementKind;

// The unified header EVERY array allocated through ur_gc_alloc_array()
// carries, replacing the two INCONSISTENT shapes emit-c.ts currently
// produces (Gate A8's own confirmed finding: some arrays get an inline
// length header, others get none at all) with exactly one.
typedef struct UrGcHeader {
    struct UrGcHeader *next;      // sweep-list link — every live
                                   // allocation is linked here,
                                   // replacing ur_allocated_pointers[]'s
                                   // own fixed 4096-entry capacity
                                   // (Gate A8's own confirmed finding)
                                   // for allocations made through this
                                   // new path.
    int64_t length;
    int marked;                    // reserved for Gate A9.3's own mark
                                   // phase — written here (always 0
                                   // after allocation) so the header's
                                   // own shape is stable and complete
                                   // now, not extended piecemeal later.
    UrGcElementKind element_kind;
} UrGcHeader;

/**
 * Allocates a new, header-tracked array of `length` int64_t elements,
 * zero-initialized, linked into the live-allocation sweep list.
 * `element_kind` records whether this array's own elements are plain
 * scalars or themselves references to other GC-managed allocations —
 * read directly by a future mark phase (Gate A9.3), not re-derived
 * from anywhere else.
 */
int64_t* ur_gc_alloc_array(int64_t length, UrGcElementKind element_kind);

/**
 * Returns the length of a LIVE array previously returned by
 * ur_gc_alloc_array(), read directly from its own header. This is the
 * ONE official way to query an array's own length for allocations made
 * through this path — intended (pending Gate A9.2's own migration
 * decision) to replace ad-hoc header-pointer arithmetic
 * (`*(base - 1)`) currently duplicated across call sites in emit-c.ts,
 * so this internal detail does not need to independently leak into
 * the C backend, a future WASM backend, and future tooling
 * separately.
 */
int64_t ur_array_length(int64_t* ref);

// ── Automatic Collection Trigger Contract (Gate A9.5.3, extended by
//    the FROZEN Hybrid Policy Contract, Gate A9.5.6, implemented here
//    in Gate A9.5.7) ─────────────────────────────────────────────────
// GC TRIGGER CONTRACT, enforced structurally, not by convention:
//   1. ur_gc_collect() is NEVER called automatically from generated
//      code directly. The ONLY automatic collection entry point is
//      INSIDE ur_gc_alloc_array() itself.
//   2. Inside ur_gc_alloc_array(), the trigger check (and any
//      resulting collection) happens BEFORE the new object is
//      allocated — never after allocation and before its own root is
//      established (Hazard 1, Gate A9.5.2), and never anywhere near
//      the function-return-to-caller-reroot window (Hazard 2, Gate
//      A9.5.2 — this window contains no allocation calls at all, so
//      this design structurally cannot fire inside it).
// The frozen hybrid trigger fires when:
//   alloc_count_since_gc >= N
//   OR bytes_since_gc >= B
//   OR (live_bytes_baseline >= R_FLOOR AND bytes_since_gc >= R * live_bytes_baseline)
// Defaults (Gate A9.5.6's own frozen contract): N=1000, B=4MiB,
// R=1.0, R_FLOOR=64KiB. R is explicitly the least evidence-backed of
// the three (a standard convention, not a measured UR value) and is
// named as such in that Gate's own contract, not claimed as tuned.

/**
 * Test-only configuration: overrides N, B, R, R_FLOOR — for testing
 * each branch of the hybrid independently at a testable scale. Also
 * resets the since-last-gc counters. Pass the UR_GC_DEFAULT_* values
 * (declared in ur_runtime.c) to restore the frozen production
 * defaults.
 */
void ur_gc_set_trigger_params(int64_t n, int64_t b, double r, int64_t r_floor);

/** Test-only introspection: how many automatic collections have
 *  actually fired so far. */
int64_t ur_gc_automatic_collect_count(void);

/** Test-only introspection into the hybrid's own current counters. */
int64_t ur_gc_get_alloc_count_since_gc(void);
int64_t ur_gc_get_bytes_since_gc(void);
int64_t ur_gc_get_live_bytes_baseline(void);

// ── Shadow Stack / Precise Roots (Gate A9.3) ────────────────────────────────
// ADDITIVE ONLY. Adds precise root tracking to the production runtime,
// mirroring exactly the design already proven across this Charter's
// own PoC work (Gates A4-A7): a single, explicit, compiler-generated
// root array, pushed at function entry and popped before every
// return, with every array-typed local/parameter/struct-array_ref-
// field's own current value kept live in it. This section does NOT
// perform any collection — no mark, no sweep, nothing here frees
// anything. It exists so root tracking itself can be proven correct
// in production BEFORE any collector is wired to read it (a future,
// separate Gate's own scope, per the Charter's own "controlled
// integration" discipline).

/**
 * Reserves `count` new, contiguous root slots on the shadow stack,
 * all initialized to NULL, and returns the base index of the
 * reserved block. Called once, at the very start of every generated
 * function that has 1 or more array-typed locals/parameters/struct-
 * array_ref-fields.
 */
int64_t ur_gc_push_frame(int64_t count);

/**
 * Releases the top `count` root slots. Called immediately before
 * every return path of the function that reserved them.
 */
void ur_gc_pop_frame(int64_t count);

/**
 * Sets the root slot at absolute index `slot` to `value`. Called
 * whenever an array-typed local/field is assigned a new value.
 */
void ur_gc_set_root(int64_t slot, int64_t* value);

/**
 * Reads the root slot at absolute index `slot`. Called whenever
 * generated code needs the CURRENT value of an array-typed local/
 * field — the single source of truth for where that array currently
 * lives, replacing direct reads of a raw local C pointer variable.
 */
int64_t* ur_gc_get_root(int64_t slot);

int64_t ur_gc_shadow_stack_depth(void);

/** Test/introspection only. */
int64_t ur_gc_live_count(void);

// ── Mark, Sweep, Collect (Gate A9.4) ────────────────────────────────────────
// Implements the Architecture Discovery's own design exactly — no new
// invention here, a direct implementation of what that Discovery
// already specified and this Gate's own review approved.
//
// SAFETY INVARIANT this design relies on (verified exhaustively before
// implementation, not assumed): every value ever written to the
// shadow stack (all 7 real call sites in emit-c.ts, confirmed
// directly) traces back, transitively, to either a direct
// ur_gc_alloc_array() call or a copy of an already-valid root —
// never from FFI/extern, raw pointer arithmetic, or any other
// non-GC source (confirmed: resultArraySlot/resultStructSlot are
// never associated with FFI/extern calls anywhere in Lowering).
// mark_recursive() below is therefore safe to dereference every
// shadow-stack entry as a real UrGcHeader-prefixed allocation,
// WITHIN THIS PHASE'S OWN SCOPE ONLY. This is not a permanent
// guarantee: the moment FFI resources, foreign pointers, or any
// other non-GC-owned reference category can ever reach the shadow
// stack, this invariant must be re-verified and a real "is this a
// known GC allocation" check added — not assumed to still hold.

/**
 * Runs one full mark-sweep collection cycle. Returns the number of
 * allocations freed this cycle.
 */
int64_t ur_gc_collect(void);

#endif // UR_RUNTIME_H
