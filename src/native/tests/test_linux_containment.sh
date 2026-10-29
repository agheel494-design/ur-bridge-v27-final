#!/usr/bin/env bash
# FRI R2-A — Linux containment harness (V1.0-FRI-REMEDIATION-GATE).
# Usage: test_linux_containment.sh <ur-repo-root> <evidence-dir> [nonroot-user]
# Runs the real CLI (`ur run`) against throw-away fixtures. Every check prints
# PASS / FAIL / BLOCKED with its raw evidence. Exit code = number of FAILs.
set -u
REPO="$(cd "${1:?repo root}" && pwd)"; EV="$(mkdir -p "${2:?evidence dir}" && cd "$2" && pwd)"; NONROOT="${3:-urtest}"
TSX_CLI="$(readlink -f "$(command -v tsx)" 2>/dev/null)"; [ -f "$TSX_CLI" ] || { echo "tsx not found"; exit 99; }
CLI="$REPO/src/cli/index.ts"
FX="$(mktemp -d /tmp/ur-containment-fixture-XXXX)"; chmod 755 "$FX"
FAILS=0
PRE_TMP="$(ls -d /tmp/ur-fri-* 2>/dev/null | sort)"   # pre-existing (not created by this run)
CG_MOUNT="$(awk '$3=="cgroup2"{print $2; exit}' /proc/mounts)"
hdr(){ { echo "=== $(basename "$1") ==="; echo "date_utc: $(date -u +%FT%TZ)"
  echo "fingerprint: $(node "$REPO/../../pkg/verification-kit/tree-hash.mjs" "$REPO" 2>/dev/null || echo "tree-hash tool not available: $(cd "$REPO" && find . -type f -not -path './node_modules/*' | sort | xargs sha256sum | sha256sum | cut -c1-64)")"
  echo "os: $(. /etc/os-release; echo "$PRETTY_NAME")"; echo "kernel: $(uname -srm)"; echo "node: $(node --version)"
  echo "compiler: $(gcc --version 2>/dev/null | head -1)"; echo "user: $(id)"; echo "cgroup2 mount: ${CG_MOUNT:-NONE}"
  echo "permissions: cgroup2 root $(stat -c '%A %U' "${CG_MOUNT:-/}" 2>/dev/null)"; echo "command: $2"; echo "--- raw output ---"; } > "$1"; }
alive(){ ps -eo args | grep -qx "sleep $1" && echo alive || echo dead; }
killmark(){ ps -eo pid,args | awk -v n="sleep $1" '{a=$2" "$3} a==n{print $1}' | xargs -r kill -9 2>/dev/null; }
verdict(){ local log="$1" name="$2" ok="$3"; if [ "$ok" = PASS ]; then echo "RESULT $name: PASS" >> "$log"; elif [ "$ok" = BLOCKED ]; then echo "RESULT $name: BLOCKED" >> "$log"; else echo "RESULT $name: FAIL" >> "$log"; FAILS=$((FAILS+1)); fi; }
ur(){ # ur <log> <ur-file> [runner-prefix...]  → appends raw output + exit code
  local log="$1" file="$2"; shift 2
  local s=$(date +%s%N); ( cd "$FX" && "$@" node "$TSX_CLI" "$CLI" run "$file" ) > "$FX/out" 2>&1; local ex=$?; local e=$(date +%s%N)
  { echo "\$ ur run $file   ($*)"; cat "$FX/out"; echo "exit_code: $ex   elapsed_ms: $(( (e-s)/1000000 ))"; } >> "$log"; LAST_EXIT=$ex; LAST_OUT="$(cat "$FX/out")"; }

# ── fixtures ─────────────────────────────────────────────────────────────
mkdir -p "$FX/ur_packages/ct"
cat > "$FX/ur_packages/ct/ct_impl.py" <<'EOF'
import os, subprocess, time, threading
open(os.environ.get("UR_CANARY_DIR", "/tmp") + "/ur_canary_started", "w").write(str(os.getpid()))
def tree_hang(x):
    subprocess.Popen(["sh", "-c", "sleep 3811 & exec sleep 3812"])
    while True: time.sleep(0.1)
def setsid_hang(x):
    subprocess.Popen(["sleep", "3821"], start_new_session=True)
    while True: time.sleep(0.1)
def ok_leave_bg(x):
    subprocess.Popen(["sleep", "3831"], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return 31
def fail_leave_bg(x):
    subprocess.Popen(["sleep", "3841"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    raise RuntimeError("deliberate failure")
def result_then_hang(x):
    threading.Thread(target=lambda: time.sleep(3600), daemon=False).start()
    return 61
def crash_target(x):
    subprocess.Popen(["sleep", "3851"], start_new_session=True)
    while True: time.sleep(0.1)
def plain(x): return x + 1
def pin_tmp(x):
    p = os.path.join(os.path.dirname(os.environ["UR_FRI_RESULT_PATH"]), "pinned")
    open(p, "w").write("x"); subprocess.run(["chattr", "+i", p], check=True)
    return 71
def pin_tmp_fail(x):
    pin_tmp(x); raise RuntimeError("deliberate failure after pinning")
EOF
FNS="tree_hang setsid_hang ok_leave_bg fail_leave_bg result_then_hang crash_target plain pin_tmp pin_tmp_fail"
python3 - "$FX" "$FNS" <<'EOF'
import json, sys
fx, fns = sys.argv[1], sys.argv[2].split()
json.dump({"name": "ct", "version": "0.1.0", "runtime": "python", "module": "ct_impl", "exports": {f: f for f in fns}, "timeouts": {"runMs": 2000}}, open(f"{fx}/ur_packages/ct/manifest.json", "w"))
open(f"{fx}/ur_packages/ct/signatures.ur", "w").write("".join(f"function {f}(x: int): int\n  return 0\nend\n" for f in fns))
EOF
for f in $FNS; do printf 'import ct\nfunction main(): int\n  print(%s(1))\n  return 0\nend\n' "$f" > "$FX/$f.ur"; done
chmod -R a+rwX "$FX"

# ── L1: containment unavailable → rejected, foreign NOT started (canary) ──
L="$EV/fri-preflight.log"; hdr "$L" "L1: ur run plain.ur as non-root user '$NONROOT' (cannot create cgroups); canary = file written at foreign module import"
if id "$NONROOT" >/dev/null 2>&1; then
  mkdir -p "$FX/canary"; chmod 777 "$FX/canary"; rm -f "$FX/canary/ur_canary_started"
  ur "$L" plain.ur su "$NONROOT" -s /bin/sh -c 'UR_CANARY_DIR='"$FX"'/canary exec "$0" "$@"'
  canary=$([ -e "$FX/canary/ur_canary_started" ] && echo PRESENT || echo ABSENT); echo "canary: $canary" >> "$L"
  if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q FRI_CONTAINMENT_UNAVAILABLE && [ "$canary" = ABSENT ]; then verdict "$L" L1 PASS; else verdict "$L" L1 FAIL; fi
else echo "user $NONROOT does not exist" >> "$L"; verdict "$L" L1 BLOCKED; fi
{ echo "--- positive control: same program as $(id -un) (cgroup available) ---"; } >> "$L"
rm -f "$FX/canary/ur_canary_started"; ur "$L" plain.ur env UR_CANARY_DIR="$FX/canary"
canary=$([ -e "$FX/canary/ur_canary_started" ] && echo PRESENT || echo ABSENT); echo "canary: $canary" >> "$L"
if [ "$LAST_EXIT" = 0 ] && [ "$LAST_OUT" = 2 ] && [ "$canary" = PRESENT ]; then verdict "$L" L1-control PASS; else verdict "$L" L1-control FAIL; fi

# ── L2: timeout kills root, child, grandchild; L6: result then hang ───────
L="$EV/fri-timeout.log"; hdr "$L" "L2 tree_hang (python → sh → sleep 3811 / sleep 3812), runMs 2000; L6 result_then_hang"
ur "$L" tree_hang.ur env UR_CANARY_DIR="$FX/canary"; root=$(cat "$FX/canary/ur_canary_started" 2>/dev/null); sleep 1
r_state=$([ -n "$root" ] && [ -e "/proc/$root" ] && echo alive || echo dead)
echo "root pid $root: $r_state; child/grandchild sleep 3811: $(alive 3811), sleep 3812: $(alive 3812)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_TIMEOUT' && [ "$r_state" = dead ] && [ "$(alive 3811)" = dead ] && [ "$(alive 3812)" = dead ]; then verdict "$L" L2 PASS; else verdict "$L" L2 FAIL; fi
killmark 3811; killmark 3812
ur "$L" result_then_hang.ur
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_TIMEOUT' && ! echo "$LAST_OUT" | grep -qx 61; then verdict "$L" L6 PASS; else verdict "$L" L6 FAIL; fi

# ── L3: setsid-escaped grandchild must not survive ────────────────────────
L="$EV/fri-setsid.log"; hdr "$L" "L3 setsid_hang (python → setsid sleep 3821), runMs 2000"
ur "$L" setsid_hang.ur; sleep 1; echo "setsid grandchild sleep 3821: $(alive 3821)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_TIMEOUT' && [ "$(alive 3821)" = dead ]; then verdict "$L" L3 PASS; else verdict "$L" L3 FAIL; fi
killmark 3821

# ── L4 / L5: OPEN-3 — success keeps descendants, failure kills them ───────
L="$EV/fri-open3.log"; hdr "$L" "L4 ok_leave_bg (setsid sleep 3831, returns 31); L5 fail_leave_bg (sleep 3841, raises)"
ur "$L" ok_leave_bg.ur; sleep 1; echo "background sleep 3831 after SUCCESS: $(alive 3831)" >> "$L"
if [ "$LAST_EXIT" = 0 ] && [ "$LAST_OUT" = 31 ] && [ "$(alive 3831)" = alive ]; then verdict "$L" L4 PASS; else verdict "$L" L4 FAIL; fi
killmark 3831
ur "$L" fail_leave_bg.ur; sleep 1; echo "background sleep 3841 after FAILURE: $(alive 3841)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_FAILED' && [ "$(alive 3841)" = dead ]; then verdict "$L" L5 PASS; else verdict "$L" L5 FAIL; fi
killmark 3841

# ── supervisor killed externally (Linux analogue of W4) ───────────────────
L="$EV/fri-helper-crash.log"; hdr "$L" "crash_target (setsid sleep 3851, hangs); after 1 s the supervisor (node -e … sup-N.json) is SIGKILLed externally"
( sleep 1.2; sp=$(ps -eo pid,args | awk '/sup-[0-9]+\.json/ && !/awk/ {print $1; exit}'); echo "killing supervisor pid: ${sp:-NONE FOUND}" >> "$L"; [ -n "$sp" ] && kill -9 "$sp" ) &
ur "$L" crash_target.ur; wait; sleep 1; echo "foreign grandchild sleep 3851: $(alive 3851)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_SPAWN_FAILED: .*supervisor ended without a report' && [ "$(alive 3851)" = dead ]; then verdict "$L" SUPERVISOR-CRASH PASS; else verdict "$L" SUPERVISOR-CRASH FAIL; fi
killmark 3851

# ── R2-RUST-CONTAINMENT-001: rust invocation points ───────────────────────
# The rust FRI branch is known BROKEN (it never writes its wrapper), and no real
# rustc exists here. A STUB 'rustc' on PATH therefore stands in for both the
# compiler and the binary it "produces". This proves that UR's rust compile and
# run steps go through the same containment runner. It proves NOTHING about Rust
# compilation, ABI or conversion.
L="$EV/fri-rust.log"; hdr "$L" "rust runtime package; R0 real toolchain lookup; R1-R6 with stub rustc (UR_STUB_MODE selects behaviour)"
mkdir -p "$FX/ur_packages/rs" "$FX/stubbin"
echo '// placeholder source; the rust branch reads it but never writes a wrapper' > "$FX/ur_packages/rs/rlib.rs"
python3 - "$FX" <<'EOF'
import json, sys
fx = sys.argv[1]
json.dump({"name": "rs", "version": "0.1.0", "runtime": "rust", "module": "rlib", "exports": {"rfn": "rfn"}, "timeouts": {"runMs": 2000, "compileMs": 2000}}, open(f"{fx}/ur_packages/rs/manifest.json", "w"))
open(f"{fx}/ur_packages/rs/signatures.ur", "w").write("function rfn(x: int): int\n  return 0\nend\n")
EOF
printf 'import rs\nfunction main(): int\n  print(rfn(1))\n  return 0\nend\n' > "$FX/rfn.ur"
cat > "$FX/stubbin/rustc" <<'EOF'
#!/bin/sh
# STUB rustc — args: <wrapper.rs> -o <bin>
out="$3"
case "$UR_STUB_MODE" in
  compile_hang) sh -c 'sleep 3861 & exec sleep 3862' & setsid sleep 3863 & sleep 3600 ;;
  compile_fail) echo "stub rustc: error[E0000]: deliberate compile failure" >&2; exit 1 ;;
  run_hang)    printf '#!/bin/sh\nsh -c "sleep 3871 & exec sleep 3872" &\nsetsid sleep 3873 &\nsleep 3600\n' > "$out" ;;
  run_success) printf '#!/bin/sh\nsetsid sleep 3881 >/dev/null 2>&1 &\nprintf %%s %s > "$UR_FRI_RESULT_PATH"\n' "'{\"t\":\"int\",\"v\":\"42\"}'" > "$out" ;;
  run_fail)    printf '#!/bin/sh\nsleep 3891 >/dev/null 2>&1 &\necho "stub binary: deliberate failure" >&2\nexit 3\n' > "$out" ;;
esac
chmod +x "$out" 2>/dev/null; exit 0
EOF
chmod +x "$FX/stubbin/rustc"; chmod -R a+rwX "$FX"
if command -v rustc >/dev/null; then echo "real rustc present: $(command -v rustc)" >> "$L"; verdict "$L" R0-real-rustc BLOCKED
else
  ur "$L" rfn.ur
  if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q "FRI_RUNTIME_NOT_FOUND: .*'rustc' not found"; then verdict "$L" R0-rustc-absent-not-started PASS; else verdict "$L" R0-rustc-absent-not-started FAIL; fi
fi
ur "$L" rfn.ur env PATH="$FX/stubbin:$PATH" UR_STUB_MODE=compile_hang; sleep 1
echo "compile step: child 3861 $(alive 3861), grandchild 3862 $(alive 3862), setsid 3863 $(alive 3863)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q 'FRI_COMPILE_TIMEOUT' && [ "$(alive 3861)$(alive 3862)$(alive 3863)" = deaddeaddead ]; then verdict "$L" R1-compile-timeout-zero-survivors PASS; else verdict "$L" R1-compile-timeout-zero-survivors FAIL; fi
killmark 3861; killmark 3862; killmark 3863
ur "$L" rfn.ur env PATH="$FX/stubbin:$PATH" UR_STUB_MODE=compile_fail
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q '^UR panic: FRI_COMPILE_FAILED'; then verdict "$L" R2-compile-failed PASS; else verdict "$L" R2-compile-failed FAIL; fi
ur "$L" rfn.ur env PATH="$FX/stubbin:$PATH" UR_STUB_MODE=run_hang; sleep 1
echo "run step: child 3871 $(alive 3871), grandchild 3872 $(alive 3872), setsid 3873 $(alive 3873)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q '^UR panic: FRI_TIMEOUT' && [ "$(alive 3871)$(alive 3872)$(alive 3873)" = deaddeaddead ]; then verdict "$L" R3-run-timeout-child-grandchild-setsid-zero-survivors PASS; else verdict "$L" R3-run-timeout-child-grandchild-setsid-zero-survivors FAIL; fi
killmark 3871; killmark 3872; killmark 3873
ur "$L" rfn.ur env PATH="$FX/stubbin:$PATH" UR_STUB_MODE=run_success; sleep 1
echo "after success: setsid background 3881 $(alive 3881)" >> "$L"
if [ "$LAST_EXIT" = 0 ] && [ "$LAST_OUT" = 42 ] && [ "$(alive 3881)" = alive ]; then verdict "$L" R4-success-OPEN3-background-survives PASS; else verdict "$L" R4-success-OPEN3-background-survives FAIL; fi
killmark 3881
ur "$L" rfn.ur env PATH="$FX/stubbin:$PATH" UR_STUB_MODE=run_fail; sleep 1
echo "after failure: background 3891 $(alive 3891)" >> "$L"
if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q '^UR panic: FRI_FAILED: .*exit 3' && [ "$(alive 3891)" = dead ]; then verdict "$L" R5-failure-descendants-dead PASS; else verdict "$L" R5-failure-descendants-dead FAIL; fi
killmark 3891
echo "NOTE: real Rust FRI (rustc + generated wrapper) is NOT exercised: the branch never writes wrapper.rs and no rustc exists here. R2-RUST real = BLOCKED." >> "$L"

# ── cleanup ───────────────────────────────────────────────────────────────
L="$EV/cleanup.log"; hdr "$L" "C1/C2: temp-dir removal forced to fail (immutable file inside the call dir); then leftovers after all cases"
if command -v chattr >/dev/null && [ "$(id -u)" = 0 ]; then
  ur "$L" pin_tmp.ur
  if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q '^UR panic: FRI_CLEANUP_FAILED' && ! echo "$LAST_OUT" | grep -qx 71; then verdict "$L" C1-success-then-cleanup-failure PASS; else verdict "$L" C1-success-then-cleanup-failure FAIL; fi
  ur "$L" pin_tmp_fail.ur
  if [ "$LAST_EXIT" = 101 ] && echo "$LAST_OUT" | grep -q '^UR panic: FRI_FAILED' && echo "$LAST_OUT" | grep -q '\[FRI_CLEANUP_FAILED: '; then verdict "$L" C2-failure-plus-cleanup-failure PASS; else verdict "$L" C2-failure-plus-cleanup-failure FAIL; fi
  for f in /tmp/ur-fri-res-*/pinned; do [ -e "$f" ] && chattr -i "$f"; done; rm -rf /tmp/ur-fri-res-*
  echo "(pinned test directories unpinned and removed by the harness)" >> "$L"
else echo "chattr unavailable or not root" >> "$L"; verdict "$L" C1-C2 BLOCKED; fi
cgl=$(find "${CG_MOUNT:-/nonexistent}" -maxdepth 4 -type d -name 'ur-fri-*' 2>/dev/null | wc -l)
NEW_TMP="$(comm -13 <(echo "$PRE_TMP") <(ls -d /tmp/ur-fri-* 2>/dev/null | sort) | sed '/^$/d')"; tmpl=$(echo -n "$NEW_TMP" | grep -c . || true)
echo "pre-existing /tmp/ur-fri-* (not created by this run, excluded): $(echo "$PRE_TMP" | grep -c . || true) $(echo $PRE_TMP)" >> "$L"
echo "created by this run and left behind: ${NEW_TMP:-none}" >> "$L"
marks=0; for n in 3811 3812 3821 3831 3841 3851 3861 3862 3863 3871 3872 3873 3881 3891; do [ "$(alive $n)" = alive ] && marks=$((marks+1)); done
echo "ur-fri cgroups left: $cgl; /tmp/ur-fri-* left by this run: $tmpl; marker processes alive (after harness cleanup): $marks" >> "$L"
if [ "$cgl" = 0 ] && [ "$tmpl" = 0 ] && [ "$marks" = 0 ]; then verdict "$L" CLEANUP PASS; else verdict "$L" CLEANUP FAIL; fi
rm -rf "$FX"
echo "FAILS=$FAILS"; grep -h '^RESULT' "$EV"/*.log
exit $FAILS
