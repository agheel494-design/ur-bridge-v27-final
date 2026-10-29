#!/usr/bin/env bash
# GATE-026 D4-a — nativeptr must be rejected at the FRI boundary BEFORE any foreign process starts.
# Usage: test_gate026_d4_nativeptr.sh <ur-repo-root> <evidence-dir>
# Self-contained: builds its own test library (libd4box.so) in a temp dir. Linux (native runtime is dlopen-based).
# Proof of "no foreign process": the library has an ELF constructor that writes ONE canary file per process
# that loads it (dlopen in the FRI wrapper), and read_box() writes its own "read_box-called" marker.
# In T1/T2 the producer call (make_static/make_heap) legitimately loads the library once, so exactly ONE
# process canary is expected; a second one, or the read_box marker, would mean the rejected call started.
# Exit code = number of FAIL.
set -u
REPO="$(cd "$1" && pwd)"; EV="$(mkdir -p "$2" && cd "$2" && pwd)"; LOG="$EV/d4-nativeptr.log"
TSX="$(readlink -f "$(command -v tsx)")"; CLI="$REPO/src/cli/index.ts"; FX="$(mktemp -d /tmp/ur-d4-fixture-XXXX)"; FAILS=0
{ echo "=== GATE-026 D4 nativeptr harness  $(date -u +%FT%TZ)"; echo "repo: $REPO"; echo "fingerprint: $(node "$REPO/../../../pkg/verification-kit/tree-hash.mjs" "$REPO" 2>/dev/null || echo n/a)"
  echo "os: $(uname -srm)  node: $(node --version)  gcc: $(gcc --version | head -1)  user: $(id -un)"; } > "$LOG"
mkdir -p "$FX/ur_packages/box" "$FX/ur_packages/pyp" "$FX/canary"
cat > "$FX/d4box.c" <<'EOF'
#include <stdio.h>
#include <stdlib.h>
static long static_box = 777;
__attribute__((constructor)) static void d4_canary(void) {
  const char *d = getenv("D4_CANARY_DIR"); if (!d) return;
  char p[4096]; snprintf(p, sizeof p, "%s/loaded-%d", d, (int)getpid()); FILE *f = fopen(p, "w"); if (f) { fputs("foreign process loaded libd4box\n", f); fclose(f); }
}
void *make_static(void) { return &static_box; }
void *make_heap(void) { long *p = malloc(sizeof *p); *p = 777; return p; }
long read_box(void *p) {
  const char *d = getenv("D4_CANARY_DIR");
  if (d) { char q[4096]; snprintf(q, sizeof q, "%s/read_box-called", d); FILE *f = fopen(q, "w"); if (f) fclose(f); }
  return *(long *)p;
}
long answer(void) { return 42; }
EOF
gcc -shared -fPIC -O2 -o "$FX/ur_packages/box/libd4box.so" "$FX/d4box.c" >> "$LOG" 2>&1
echo "{\"name\":\"box\",\"version\":\"0.1.0\",\"runtime\":\"native\",\"nativeLibrary\":{\"path\":\"$FX/ur_packages/box/libd4box.so\"},\"module\":\"x\",\"exports\":{\"make_heap\":\"make_heap\",\"make_static\":\"make_static\",\"read_box\":\"read_box\",\"answer\":\"answer\"}}" > "$FX/ur_packages/box/manifest.json"
printf 'function make_heap(): nativeptr\n  return 0\nend\nfunction make_static(): nativeptr\n  return 0\nend\nfunction read_box(p: nativeptr): int\n  return 0\nend\nfunction answer(): int\n  return 0\nend\n' > "$FX/ur_packages/box/signatures.ur"
# T3 fixture: a NON-native runtime (python) declaring a nativeptr parameter
printf 'import os\ndef take(p):\n    open(os.environ["D4_CANARY_DIR"] + "/python-started", "w").write("x")\n    return 1\n' > "$FX/ur_packages/pyp/pyp_impl.py"
echo '{"name":"pyp","version":"0.1.0","runtime":"python","module":"pyp_impl","exports":{"take":"take"}}' > "$FX/ur_packages/pyp/manifest.json"
printf 'function take(p: nativeptr): int\n  return 0\nend\n' > "$FX/ur_packages/pyp/signatures.ur"
w(){ printf 'import box\n%sfunction main(): int\n%s  return 0\nend\n' "$2" "$3" > "$FX/$1.ur"; }
w t1 "" '  print(read_box(make_static()))\n'
w t2 "" '  print(read_box(make_heap()))\n'
printf 'import box\nimport pyp\nfunction main(): int\n  print(take(make_static()))\n  return 0\nend\n' > "$FX/t3.ur"
w t4 "" '  let p = make_static()\n  print(1)\n'
w t5 "" '  print(answer())\n'
sed -i 's/\\n/\n/g' "$FX"/t*.ur
fri(){ ls -d /tmp/ur-fri-* 2>/dev/null | sort; }
run(){ # id expect-regex expected-number-of-loading-processes (or "any")
  local id=$1 rx=$2 can=$3; rm -f "$FX/canary/"*; local before; before="$(fri)"
  local out; out="$(cd "$FX" && D4_CANARY_DIR="$FX/canary" node "$TSX" "$CLI" run "$id.ur" 2>&1)"; local ec=$?
  local after; after="$(fri)"; local newdirs; newdirs="$(comm -13 <(echo "$before") <(echo "$after") | sed '/^$/d' | wc -l)"
  local cn; cn="$(ls "$FX/canary" | grep -c '^loaded-' || true)"; local rb; rb="$( [ -e "$FX/canary/read_box-called" ] && echo yes || echo no)"
  { echo "--- $id  (src: $(tr '\n' ' ' < "$FX/$id.ur"))"; echo "$out" | sed 's/^/    /'; echo "    exit=$ec  processes_that_loaded_lib=$cn  read_box_called=$rb  new_ur-fri_dirs_left=$newdirs"; } >> "$LOG"
  local ok=1; echo "$out" | grep -Eq -- "$rx" || ok=0
  [ "$can" != any ] && [ "$cn" != "$can" ] && ok=0
  [ "$id" = t1 -o "$id" = t2 ] && [ "$rb" = yes ] && ok=0
  [ "$newdirs" != 0 ] && ok=0
  if [ $ok = 1 ]; then echo "RESULT $id: MATCHES-EXPECTED" >> "$LOG"; else echo "RESULT $id: DOES-NOT-MATCH-EXPECTED" >> "$LOG"; FAILS=$((FAILS+1)); fi
}
run t1 '^UR panic: FRI_UNSUPPORTED_ARGUMENT: .*read_box.*parameter 1 is .nativeptr.' 1
run t2 '^UR panic: FRI_UNSUPPORTED_ARGUMENT: .*read_box.*parameter 1 is .nativeptr.' 1
run t3 'FRI_UNSUPPORTED_ARGUMENT: .*take.*parameter 1|error\[' 1
# T3 detail: whichever comes first (type checker or FRI), python must not have started
[ -e "$FX/canary/python-started" ] && { echo "T3 python-started canary PRESENT" >> "$LOG"; FAILS=$((FAILS+1)); } || echo "T3 python-started canary: absent" >> "$LOG"
run t4 '^1$' 1
run t5 '^42$' 1
echo "FAILS=$FAILS" >> "$LOG"; grep -E '^RESULT|FAILS|T3 python' "$LOG"; rm -rf "$FX"; exit $FAILS
