#!/usr/bin/env bash
# GATE-026 D5 - strict manifest identifier validation. Usage: test_gate026_d5_manifest_ident.sh <ur-repo-root> <evidence-dir>
# For every rejection case the harness proves the chain:
#   invalid input -> FRI_INVALID_MANIFEST_IDENTIFIER -> no canary -> no call directory -> no compiler/runtime invocation
#  - canary: each payload, if it ever executed, would create a file in $D5_CANARY
#  - call directory: no new /tmp/ur-fri-* entry
#  - tool invocation: shims named python3/python/gcc/g++/go/javac/java placed FIRST on PATH record every invocation,
#    then exec the real tool (so valid cases still work)
# Exit code = number of DOES-NOT-MATCH-EXPECTED.
set -u
REPO="$(cd "$1" && pwd)"; EV="$(mkdir -p "$2" && cd "$2" && pwd)"; LOG="$EV/d5-manifest-ident.log"
TSX="$(readlink -f "$(command -v tsx)")"; CLI="$REPO/src/cli/index.ts"; FX="$(mktemp -d /tmp/ur-d5-fixture-XXXX)"; FAILS=0
CAN="$FX/canary"; SHIMS="$FX/shims"; TOOLLOG="$FX/tool-invocations.log"; mkdir -p "$CAN" "$SHIMS"
{ echo "=== GATE-026 D5 harness  $(date -u +%FT%TZ)"; echo "repo: $REPO"
  echo "fingerprint: $(node "$REPO/../../../pkg/verification-kit/tree-hash.mjs" "$REPO" 2>/dev/null || echo n/a)"
  echo "os: $(uname -srm)  node: $(node --version)  gcc: $(gcc --version | head -1)  user: $(id -un)"; } > "$LOG"
for t in python3 python gcc g++ go javac java; do
  real="$(command -v $t || true)"
  printf '#!/bin/sh\necho "%s $*" >> "%s"\n%s\n' "$t" "$TOOLLOG" "$( [ -n "$real" ] && echo "exec \"$real\" \"\$@\"" || echo 'exit 127')" > "$SHIMS/$t"; chmod +x "$SHIMS/$t"
done
export PATH="$SHIMS:$PATH" D5_CANARY="$CAN"
mkpkg(){ # name runtime module symbol  (+ module file for compiled runtimes)
  local n=$1 rt=$2 mod=$3 sym=$4; mkdir -p "$FX/ur_packages/$n"
  python3 - "$FX/ur_packages/$n/manifest.json" "$n" "$rt" "$mod" "$sym" <<'EOF'
import json, sys
p, n, rt, mod, sym = sys.argv[1:6]
m = {"name": n, "version": "0.1.0", "runtime": rt, "module": mod, "exports": {"ufn": sym}}
if rt == "native": m["nativeLibrary"] = {"path": mod}
json.dump(m, open(p, "w"))
EOF
  printf 'function ufn(x: int): int\n  return 0\nend\n' > "$FX/ur_packages/$n/signatures.ur"
  printf 'import %s\nfunction main(): int\n  print(ufn(1))\n  return 0\nend\n' "$n" > "$FX/$n.ur"
}
# module source files for compiled runtimes (valid code; only the symbol is malicious)
mkdir -p "$FX/src"; printf 'long f(long a){return a+1;}\n' > "$FX/src/m.c"; printf 'extern "C" long f(long a){return a+1;}\n' > "$FX/src/m.cpp"
printf 'package main\nfunc f(a int64) int64 { return a + 1 }\n' > "$FX/src/m.go"; printf 'class M { static long f(long a){ return a+1; } }\n' > "$FX/src/m.java"
printf 'import os\ndef f(x):\n    return x + 1\n' > "$FX/src/okmod.py"
cp "$FX/src/okmod.py" "$FX/okmod.py"
PYCAN="__import__('os').open(__import__('os').environ['D5_CANARY']+'/py',64|1)"
# ---- rejection cases ----
mkpkg t1a python "os;$PYCAN" f
mkpkg t1b python $'okmod\nimport os; os.open(os.environ["D5_CANARY"]+"/py2",65)' f
mkpkg t1c python "okmod as m; $PYCAN; import okmod" f
mkpkg t1d python okmod 'f); __import__("os").system("touch $D5_CANARY/pysym"' 
mkpkg t2a c "$FX/src/m.c" 'f(long);int __attribute__((constructor)) z(void){return 0;}long g'
mkpkg t2b c "$FX/src/m.c" $'f\nint injected;'
mkpkg t2c c "$FX/src/m.c" 'f;system'
mkpkg t3a cpp "$FX/src/m.cpp" 'f(long);static int z=0;extern "C" long g'
mkpkg t3b cpp "$FX/src/m.cpp" $'f\n#include <cstdlib>'
mkpkg t4a go "$FX/src/m.go" 'f(a)); os.Exit(0); fmt.Println((1'
mkpkg t4b java "$FX/src/m.java" 'f(a); System.exit(0); Object o=(1'
mkpkg t5a native "/usr/lib/x86_64-linux-gnu/libc.so.6" 'abs"); system("touch /tmp/x'
mkpkg t5b native "/usr/lib/x86_64-linux-gnu/libc.so.6" 'abs\u0001'
mkpkg t5c native $'/usr/lib/x86_64-linux-gnu/libc.so.6\n' abs
# ---- valid controls (T6) ----
mkpkg t6py python okmod f
cp "$FX/src/okmod.py" "$FX/ur_packages/t6py/okmod.py"
mkpkg t6c c "$FX/src/m.c" f
mkpkg t6cpp cpp "$FX/src/m.cpp" f
mkpkg t6nat native "/usr/lib/x86_64-linux-gnu/libc.so.6" getpagesize
# the native FRI gate supports zero-argument calls only (besides the rejected ptr case): valid control = getpagesize()
printf 'function ufn(): int\n  return 0\nend\n' > "$FX/ur_packages/t6nat/signatures.ur"
printf 'import t6nat\nfunction main(): int\n  print(ufn())\n  return 0\nend\n' > "$FX/t6nat.ur"
fri(){ ls -d /tmp/ur-fri-* 2>/dev/null | sort; }
run(){ # id mode(reject|valid) expect-regex
  local id=$1 mode=$2 rx=$3; rm -f "$CAN"/* "$TOOLLOG"; local before; before="$(fri)"
  local out; out="$(cd "$FX" && node "$TSX" "$CLI" run "$id.ur" 2>&1)"; local ec=$?
  local nd; nd="$(comm -13 <(echo "$before") <(fri) | sed '/^$/d' | wc -l)"
  local nc; nc="$(ls "$CAN" | wc -l)"; local nt; nt="$( [ -f "$TOOLLOG" ] && wc -l < "$TOOLLOG" || echo 0)"
  { echo "--- $id [$mode]  manifest: $(cat "$FX/ur_packages/$id/manifest.json")"; echo "$out" | sed 's/^/    /'
    echo "    exit=$ec canary_files=$nc new_call_dirs=$nd tool_invocations=$nt $( [ -f "$TOOLLOG" ] && tr '\n' '|' < "$TOOLLOG")"; } >> "$LOG"
  local ok=1; echo "$out" | grep -Eq -- "$rx" || ok=0
  if [ "$mode" = reject ]; then [ "$nc" = 0 ] && [ "$nd" = 0 ] && [ "$nt" = 0 ] || ok=0; else [ "$nd" = 0 ] || ok=0; fi
  if [ $ok = 1 ]; then echo "RESULT $id: MATCHES-EXPECTED" >> "$LOG"; else echo "RESULT $id: DOES-NOT-MATCH-EXPECTED" >> "$LOG"; FAILS=$((FAILS+1)); fi
}
R='^UR panic: FRI_INVALID_MANIFEST_IDENTIFIER: '
for id in t1a t1b t1c; do run $id reject "${R}.*module "; done
run t1d reject "${R}.*symbol "
for id in t2a t2b t2c t3a t3b t4a t4b t5a t5b; do run $id reject "${R}.*symbol "; done
run t5c reject "${R}.*native library path "
run t6py valid '^2$'; run t6c valid '^2$'; run t6cpp valid '^2$'; run t6nat valid '^4096$'
echo "FAILS=$FAILS" >> "$LOG"; grep -E '^RESULT|^FAILS' "$LOG"; rm -rf "$FX"; exit $FAILS
