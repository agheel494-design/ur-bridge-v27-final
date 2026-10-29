#!/usr/bin/env bash
# GATE-026 D6 - FRI cleanup verification matrix (11 paths). Evidence only; production code is not modified.
# Usage: test_gate026_d6_cleanup.sh <ur-repo-root> <evidence-dir>
# Proof per cell:
#   (a) the per-call directory EXISTED: a ctypes inotify watcher on $TMPDIR records every IN_CREATE / IN_DELETE of
#       "ur-fri-res-*" during the call (catches even millisecond-lived directories; no polling);
#   (b) it is GONE afterwards: every created directory has a matching delete AND no longer exists;
#   (c) the expected typed outcome is printed;
#   (d) where foreign code runs, it also writes dirname(UR_FRI_RESULT_PATH) to a canary (independent existence proof).
# Cells for tools absent on the host are recorded NOT AVAILABLE (never MATCHES). Exit code = DOES-NOT-MATCH count.
set -u
REPO="$(cd "$1" && pwd)"; EV="$(mkdir -p "$2" && cd "$2" && pwd)"; LOG="$EV/d6-cleanup.log"
TSX="$(readlink -f "$(command -v tsx)")"; CLI="$REPO/src/cli/index.ts"; FX="$(mktemp -d /tmp/ur-d6-fixture-XXXX)"; TMPW="${TMPDIR:-/tmp}"
FAILS=0; NA=0; CAN="$FX/canary"; mkdir -p "$CAN"
{ echo "=== GATE-026 D6 cleanup matrix  $(date -u +%FT%TZ)"; echo "repo: $REPO"
  echo "fingerprint: $(node "$(dirname "$0")/tree-hash.mjs" "$REPO" 2>/dev/null || echo n/a)"
  echo "os: $(uname -srm)  node: $(node --version)  python3: $(python3 --version 2>&1)  gcc: $(gcc --version | head -1)  user: $(id -un)"
  echo "tools: go=$(command -v go || echo absent) javac=$(command -v javac || echo absent) java=$(command -v java || echo absent) chattr=$(command -v chattr || echo absent)"
  echo "watched dir: $TMPW"; } > "$LOG"
# ---------- inotify watcher (python ctypes; Linux) ----------
cat > "$FX/watch.py" <<'EOF'
import ctypes, os, struct, sys, select
libc = ctypes.CDLL("libc.so.6", use_errno=True)
IN_CREATE, IN_DELETE, IN_MOVED_TO, IN_ISDIR = 0x100, 0x200, 0x80, 0x40000000
fd = libc.inotify_init1(0)
wd = libc.inotify_add_watch(fd, sys.argv[1].encode(), IN_CREATE | IN_DELETE | IN_MOVED_TO)
out = open(sys.argv[2], "w", buffering=1); open(sys.argv[3], "w").close()   # ready flag
while True:
    r, _, _ = select.select([fd], [], [], 0.5)
    if os.path.exists(sys.argv[4]): break                                    # stop flag
    if not r: continue
    buf = os.read(fd, 65536); i = 0
    while i < len(buf):
        _, mask, _, ln = struct.unpack_from("iIII", buf, i); name = buf[i+16:i+16+ln].rstrip(b"\0").decode(errors="replace"); i += 16 + ln
        if name.startswith("ur-fri-res-"): out.write(("CREATE " if mask & (IN_CREATE | IN_MOVED_TO) else "DELETE ") + name + "\n")
EOF
# ---------- fixtures ----------
P="$FX/ur_packages"; mkdir -p "$P"
pkg(){ # name runtime module json-extra   + signatures from $SIG
  mkdir -p "$P/$1"; printf '{"name":"%s","version":"0.1.0","runtime":"%s","module":"%s","exports":{"ok":"ok","fail":"fail","slow":"slow","sig":"sig","flood":"flood","bad":"bad","pin":"pin"}%s}\n' "$1" "$2" "$3" "${4:-}" > "$P/$1/manifest.json"
  printf 'function ok(x: int): int\n  return 0\nend\nfunction fail(x: int): int\n  return 0\nend\nfunction slow(x: int): int\n  return 0\nend\nfunction sig(x: int): int\n  return 0\nend\nfunction flood(x: int): int\n  return 0\nend\nfunction bad(x: int): int\n  return 0\nend\nfunction pin(x: int): int\n  return 0\nend\n' > "$P/$1/signatures.ur"; }
TO=',"timeouts":{"runMs":3000,"compileMs":60000}'   # manifest schema: one runMs/compileMs per package (slow() sleeps 30 s -> must time out)
CANARY_PY='open(os.environ["D6_CANARY"]+"/"+os.environ["D6_CELL"],"w").write(os.path.dirname(os.environ["UR_FRI_RESULT_PATH"]))'
pkg py python d6py "$TO"; cat > "$P/py/d6py.py" <<EOF
import os, signal, subprocess, time
def _c(): $CANARY_PY
def ok(x): _c(); return x + 1
def fail(x): _c(); raise RuntimeError("deliberate foreign failure")
def slow(x): _c(); time.sleep(30); return 0
def sig(x): _c(); os.kill(os.getpid(), signal.SIGKILL)
def flood(x): _c(); print("y" * (64 * 1024 * 1024)); return 0
def bad(x): _c(); return "not-an-int"
def pin(x):
    _c(); d = os.path.dirname(os.environ["UR_FRI_RESULT_PATH"]); open(d + "/pinned", "w").write("x")
    subprocess.run(["chattr", "+i", d + "/pinned"], check=True); return x + 1
EOF
pkg js javascript "$P/js/d6js.js" "$TO"; cat > "$P/js/d6js.js" <<'EOF'
const fs = require("fs"), path = require("path");
const c = () => fs.writeFileSync(process.env.D6_CANARY + "/" + process.env.D6_CELL, path.dirname(process.env.UR_FRI_RESULT_PATH));
module.exports = { ok: x => { c(); return x + 1; }, fail: x => { c(); throw new Error("deliberate"); },
  slow: x => { c(); const e = Date.now() + 30000; while (Date.now() < e) {} return 0; }, bad: x => { c(); return "not-an-int"; } };
EOF
pkg ts typescript "$P/ts/d6ts.ts" ',"timeouts":{"runMs":30000}'; cat > "$P/ts/d6ts.ts" <<'EOF'
import * as fs from "fs"; import * as path from "path";
const c = (): void => fs.writeFileSync(process.env.D6_CANARY + "/" + process.env.D6_CELL, path.dirname(process.env.UR_FRI_RESULT_PATH as string));
export function ok(x: number): number { c(); return x + 1; }
export function fail(x: number): number { c(); throw new Error("deliberate"); }
EOF
CANARY_C='{ const char *d=getenv("D6_CANARY"), *c=getenv("D6_CELL"), *r=getenv("UR_FRI_RESULT_PATH"); char p[4096], q[4096]; snprintf(q,sizeof q,"%s",r); char *s=strrchr(q,47); if(s) *s=0; snprintf(p,sizeof p,"%s/%s",d,c); FILE *f=fopen(p,"w"); if(f){ fputs(q,f); fclose(f);} }'
for L in c cpp; do
  pkg $L $L "$P/$L/d6.$L" "$TO"; X=""; [ $L = cpp ] && X='extern "C" '
  cat > "$P/$L/d6.$L" <<EOF
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
#include <string.h>
static void cn(void) $CANARY_C
${X}long ok(long x){ cn(); return x+1; }
${X}long fail(long x){ cn(); exit(3); }
${X}long slow(long x){ cn(); sleep(30); return 0; }
${X}long sig(long x){ cn(); raise(SIGSEGV); return 0; }
${X}long flood(long x){ cn(); for(long i=0;i<64L*1024*1024;i++) putchar('y'); return 0; }
EOF
done
pkg cbad c "$P/cbad/broken.c" "$TO"; echo 'long ok(long x) { return x + ; }' > "$P/cbad/broken.c"
pkg cppbad cpp "$P/cppbad/broken.cpp" "$TO"; echo 'extern "C" long ok(long x) { return x + ; }' > "$P/cppbad/broken.cpp"
gcc -shared -fPIC -o "$P/libd6.so" -x c - <<EOF
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <signal.h>
#include <unistd.h>
static void cn(void) $CANARY_C
long okz(void){ cn(); return 7; }
long failz(void){ cn(); exit(5); }
long slowz(void){ cn(); sleep(30); return 0; }
long sigz(void){ cn(); raise(SIGKILL); return 0; }
EOF
mkdir -p "$P/nat"; echo "{\"name\":\"nat\",\"version\":\"0.1.0\",\"runtime\":\"native\",\"module\":\"$P/libd6.so\",\"nativeLibrary\":{\"path\":\"$P/libd6.so\"},\"exports\":{\"okz\":\"okz\",\"failz\":\"failz\",\"slowz\":\"slowz\",\"sigz\":\"sigz\"},\"timeouts\":{\"runMs\":3000,\"compileMs\":60000}}" > "$P/nat/manifest.json"
printf 'function okz(): int\n  return 0\nend\nfunction failz(): int\n  return 0\nend\nfunction slowz(): int\n  return 0\nend\nfunction sigz(): int\n  return 0\nend\n' > "$P/nat/signatures.ur"
python3 - "$P/wasm.wasm" <<'EOF'
import sys
b = bytes.fromhex("0061736d01000000" "0106016001" "7e017e" "03020100" "070601026f6b0000" "0a09010700200042017c0b")
open(sys.argv[1], "wb").write(b)
EOF
mkdir -p "$P/wa"; echo "{\"name\":\"wa\",\"version\":\"0.1.0\",\"runtime\":\"wasm\",\"module\":\"$P/wasm.wasm\",\"exports\":{\"ok\":\"ok\"}}" > "$P/wa/manifest.json"; printf 'function ok(x: int): int\n  return 0\nend\n' > "$P/wa/signatures.ur"
for g in go java; do mkdir -p "$P/$g"; echo "{\"name\":\"$g\",\"version\":\"0.1.0\",\"runtime\":\"$g\",\"module\":\"$P/$g/m.$g\",\"exports\":{\"ok\":\"f\"}}" > "$P/$g/manifest.json"; printf 'function ok(x: int): int\n  return 0\nend\n' > "$P/$g/signatures.ur"; done
printf 'package main\nfunc f(a int64) int64 { return a + 1 }\n' > "$P/go/m.go"; printf 'class M { static long f(long a){ return a+1; } }\n' > "$P/java/m.java"
prog(){ printf 'import %s\nfunction main(): int\n%s  return 0\nend\n' "$2" "$3" > "$FX/$1.ur"; }
# ---------- runner ----------
cell(){ # id  ur-file  expect-regex  expect-dir(created|none|leftover)  [env assignments...]
  local id=$1 f=$2 rx=$3 dirx=$4; shift 4
  local wl="$FX/w-$id.log"; rm -f "$FX/ready" "$FX/stop"
  python3 "$FX/watch.py" "$TMPW" "$wl" "$FX/ready" "$FX/stop" & local wp=$!
  for i in $(seq 1 50); do [ -e "$FX/ready" ] && break; sleep 0.05; done
  local out; out="$(cd "$FX" && env D6_CANARY="$CAN" D6_CELL="$id" "$@" timeout 120 node "$TSX" "$CLI" run "$f" 2>&1)"; local ec=$?
  sleep 0.3; touch "$FX/stop"; wait $wp 2>/dev/null
  local created; created="$(grep '^CREATE ' "$wl" | awk '{print $2}' | sort -u)"; local nc; nc="$(echo -n "$created" | grep -c . || true)"
  local left=0; for d in $created; do grep -qx "DELETE $d" "$wl" || left=$((left+1)); [ -e "$TMPW/$d" ] && left=$((left+1)); done
  local canv="-"; [ -f "$CAN/$id" ] && canv="$(cat "$CAN/$id")"
  local canmatch="n/a"; [ "$canv" != "-" ] && { echo "$created" | grep -qx "$(basename "$canv")" && canmatch=yes || canmatch=NO; }
  { echo "--- $id  ($f)  env: $*"; echo "$out" | head -c 600 | sed 's/^/    /'; echo
    echo "    exit=$ec dirs_created=$nc [$(echo $created)] leftovers=$left canary_dir=$canv canary_matches_created=$canmatch"; } >> "$LOG"
  local ok=1; echo "$out" | grep -Eq -- "$rx" || ok=0
  case "$dirx" in
    created)  { [ "$nc" -ge 1 ] && [ "$left" = 0 ]; } || ok=0; [ "$canmatch" = NO ] && ok=0 ;;
    leftover) { [ "$nc" -ge 1 ] && [ "$left" -ge 1 ]; } || ok=0 ;;   # P10: removal failed AND was reported
    none)     [ "$nc" = 0 ] || ok=0 ;;
  esac
  if [ $ok = 1 ]; then echo "RESULT $id: MATCHES-EXPECTED" >> "$LOG"; else echo "RESULT $id: DOES-NOT-MATCH-EXPECTED" >> "$LOG"; FAILS=$((FAILS+1)); fi
}
na(){ echo "RESULT $1: NOT AVAILABLE ($2)" >> "$LOG"; NA=$((NA+1)); }
S='^UR panic: '
# P1 success
for L in py js ts c cpp; do prog p1-$L $L "  print(ok(1))\n"; done; prog p1-nat nat "  print(okz())\n"; prog p1-wasm wa "  print(ok(1))\n"
for L in py js ts c cpp; do sed -i 's/\\n/\n/g' "$FX/p1-$L.ur"; cell p1-$L p1-$L.ur '^2$' created; done
sed -i 's/\\n/\n/g' "$FX/p1-nat.ur" "$FX/p1-wasm.ur"; cell p1-nat p1-nat.ur '^7$' created; cell p1-wasm p1-wasm.ur '^2$' created
# P2 foreign failure
for L in py js ts c cpp; do prog p2-$L $L "  print(fail(1))\n"; sed -i 's/\\n/\n/g' "$FX/p2-$L.ur"; cell p2-$L p2-$L.ur "${S}FRI_FAILED" created; done
prog p2-nat nat "  print(failz())\n"; sed -i 's/\\n/\n/g' "$FX/p2-nat.ur"; cell p2-nat p2-nat.ur "${S}(FRI_FAILED|external call)" created
# P3 timeout
for L in py js c; do prog p3-$L $L "  print(slow(1))\n"; sed -i 's/\\n/\n/g' "$FX/p3-$L.ur"; cell p3-$L p3-$L.ur "${S}FRI_TIMEOUT" created; done
prog p3-nat nat "  print(slowz())\n"; sed -i 's/\\n/\n/g' "$FX/p3-nat.ur"; cell p3-nat p3-nat.ur "${S}FRI_TIMEOUT" created
# P4 signal
for L in py c; do prog p4-$L $L "  print(sig(1))\n"; sed -i 's/\\n/\n/g' "$FX/p4-$L.ur"; cell p4-$L p4-$L.ur "${S}FRI_SIGNAL" created; done
prog p4-nat nat "  print(sigz())\n"; sed -i 's/\\n/\n/g' "$FX/p4-nat.ur"; cell p4-nat p4-nat.ur "${S}FRI_SIGNAL" created
# P5 compile failure
prog p5-c cbad "  print(ok(1))\n"; prog p5-cpp cppbad "  print(ok(1))\n"; sed -i 's/\\n/\n/g' "$FX/p5-c.ur" "$FX/p5-cpp.ur"
cell p5-c p5-c.ur "${S}FRI_COMPILE_FAILED" created; cell p5-cpp p5-cpp.ur "${S}FRI_COMPILE_FAILED" created
# P6 runtime/tool not found
prog p6-py py "  print(ok(1))\n"; sed -i 's/\\n/\n/g' "$FX/p6-py.ur"; cell p6-py p6-py.ur "${S}FRI_RUNTIME_NOT_FOUND" created PYTHON_BIN=ur-d6-no-such-python
if command -v go >/dev/null; then na p6-go "go toolchain present: not-found path not inducible without PATH changes"; else prog p6-go go "  print(ok(1))\n"; sed -i 's/\\n/\n/g' "$FX/p6-go.ur"; cell p6-go p6-go.ur "${S}FRI_RUNTIME_NOT_FOUND" created; fi
if command -v javac >/dev/null; then na p6-java "javac present: not-found path not inducible without PATH changes"; else prog p6-java java "  print(ok(1))\n"; sed -i 's/\\n/\n/g' "$FX/p6-java.ur"; cell p6-java p6-java.ur "${S}FRI_RUNTIME_NOT_FOUND" created; fi
# P7 output limit
for L in py c; do prog p7-$L $L "  print(flood(1))\n"; sed -i 's/\\n/\n/g' "$FX/p7-$L.ur"; cell p7-$L p7-$L.ur "${S}FRI_OUTPUT_LIMIT" created; done
# P8 UR panic while decoding the result (inside the call)
for L in py js; do prog p8-$L $L "  print(bad(1))\n"; sed -i 's/\\n/\n/g' "$FX/p8-$L.ur"; cell p8-$L p8-$L.ur "${S}" created; done
# P9 UR panic after a successful call
prog p9-py py "  let v = ok(1)\n  print(v / 0)\n"; sed -i 's/\\n/\n/g' "$FX/p9-py.ur"; cell p9-py p9-py.ur "${S}" created
# P10 cleanup failure (immutable file pinned inside the call dir by the foreign code; root + chattr required)
if command -v chattr >/dev/null && [ "$(id -u)" = 0 ]; then
  prog p10-py py "  print(pin(1))\n"; sed -i 's/\\n/\n/g' "$FX/p10-py.ur"
  cell p10-py p10-py.ur "${S}FRI_CLEANUP_FAILED" leftover   # the leftover IS the reported failure; the harness removes it below
  for f in "$TMPW"/ur-fri-res-*/pinned; do [ -e "$f" ] && chattr -i "$f"; done; rm -rf "$TMPW"/ur-fri-res-*
else na p10-py "needs root + chattr"; fi
# P11 rejected before the directory exists (D4 / D5)
mkdir -p "$P/bad5"; echo '{"name":"bad5","version":"0.1.0","runtime":"python","module":"os;x","exports":{"ok":"ok"}}' > "$P/bad5/manifest.json"; printf 'function ok(x: int): int\n  return 0\nend\n' > "$P/bad5/signatures.ur"
prog p11-d5 bad5 "  print(ok(1))\n"; sed -i 's/\\n/\n/g' "$FX/p11-d5.ur"; cell p11-d5 p11-d5.ur "${S}FRI_INVALID_MANIFEST_IDENTIFIER" none
echo "FAILS=$FAILS NOT_AVAILABLE=$NA" >> "$LOG"; grep -E '^RESULT|^FAILS' "$LOG"; rm -rf "$FX"; exit $FAILS
