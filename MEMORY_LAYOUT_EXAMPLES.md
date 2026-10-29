# Memory Layout Examples

**Purpose**: concrete, worked examples of `WASM_MEMORY_MODEL_SPEC.md`
§2/§4's layout and address formula — nothing new is decided here, this
page exists purely to eliminate any future ambiguity about what the
abstract formula means in practice.

---

## Example 1: `let arr = [10, 20, 30]` (3 elements), allocated at base `1024`

| Address | Contents | Field |
|---|---|---|
| `1024` | `3` | `length` (offset `arrBase + 0`) |
| `1032` | `10` | `arr[0]` (offset `arrBase + 8 + 0*8`) |
| `1040` | `20` | `arr[1]` (offset `arrBase + 8 + 1*8`) |
| `1048` | `30` | `arr[2]` (offset `arrBase + 8 + 2*8`) |

Total size: `8 + 3*8 = 32` bytes (addresses `1024` through `1055`
inclusive). The bump pointer, after this allocation, becomes `1024 +
32 = 1056` — the base address of whatever the *next* array allocates.

**Reading `arr[1]`**: `elementAddress = 1024 + 8 + 1*8 = 1040` → reads
`20`. Matches the table above exactly.

---

## Example 2: Two arrays declared in sequence

```
let a = [7, 8]        // 2 elements
let b = [1, 2, 3, 4]  // 4 elements
```

Assume `a` is allocated first, at base `1024` (same starting point as
Example 1, for a fresh module instance).

**Array `a`** (2 elements, total size `8 + 2*8 = 24` bytes):

| Address | Contents | Field |
|---|---|---|
| `1024` | `2` | `length` |
| `1032` | `7` | `a[0]` |
| `1040` | `8` | `a[1]` |

Bump pointer after `a`: `1024 + 24 = 1048`.

**Array `b`** (4 elements, total size `8 + 4*8 = 40` bytes), allocated
starting exactly where `a` ended — **no gap, no overlap**, per
`BUMP_MONOTONIC_CONTRACT`:

| Address | Contents | Field |
|---|---|---|
| `1048` | `4` | `length` |
| `1056` | `1` | `b[0]` |
| `1064` | `2` | `b[1]` |
| `1072` | `3` | `b[2]` |
| `1080` | `4` | `b[3]` |

Bump pointer after `b`: `1048 + 40 = 1088`.

**Reading `b[2]`**: `elementAddress = 1048 + 8 + 2*8 = 1072` → reads
`3`. Matches the table above exactly.

**This is the concrete illustration of
`BUMP_MONOTONIC_CONTRACT`**: `b`'s base (`1048`) equals exactly `a`'s
base (`1024`) plus `a`'s total size (`24`) — confirmed by direct
arithmetic here, and this is exactly what that Contract's test asserts
programmatically against real emitted/executed memory contents.

---

## Example 3: A computed index (`arr[i]`, not a literal) — same formula, no exception

Given `arr` from Example 1 (base `1024`, 3 elements) and a runtime
variable `i` currently holding the value `2`:

`elementAddress = 1024 + 8 + i*8 = 1024 + 8 + 2*8 = 1048` → reads `30`
(`arr[2]`). **Identical formula, identical result, whether `2` arrives
as a literal or as whatever `i` happens to hold at runtime** — the
exact point `WASM_MEMORY_MODEL_SPEC.md` §4's Single-Formula Commitment
makes abstractly, shown here concretely.
