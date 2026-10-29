#!/usr/bin/env python3
"""FRI R2-B — Windows Job Object helper tests (V1.0-FRI-REMEDIATION-GATE).

Usage (Windows only):  python test_windows_jobrun.py <path\\to\\ur-fri-jobrun.exe> <evidence-dir>

Every case prints PASS / FAIL with raw evidence and writes it to <evidence-dir>.
Process liveness is checked through the Win32 API (OpenProcess + GetExitCodeProcess),
never assumed. Exit code = number of FAILs. On non-Windows it exits 2 (BLOCKED).

W1 timeout → tree dead            W5 success → background child survives (OPEN-3)
W2 grandchild → tree dead         W6 failing root (compile-failure analogue) → descendants dead
W3 breakaway attempt → rejected   W7 output limit (supervisor kills helper) → descendants dead
W4 helper killed externally → tree dead
W8 nested job that cannot accept the process → clean rejection, foreign code never runs
"""
import ctypes, json, os, platform, subprocess, sys, tempfile, time

if os.name != "nt":
    print("BLOCKED: Windows required (os.name=%s)" % os.name); sys.exit(2)

from ctypes import wintypes
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
SYNCHRONIZE, PROCESS_QUERY_LIMITED_INFORMATION, STILL_ACTIVE = 0x00100000, 0x1000, 259
k32.OpenProcess.restype = wintypes.HANDLE

def alive(pid):
    h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid)
    if not h: return False
    code = wintypes.DWORD()
    ok = k32.GetExitCodeProcess(h, ctypes.byref(code)); k32.CloseHandle(h)
    return bool(ok) and code.value == STILL_ACTIVE

def kill(pid):
    subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)

HELPER, EV = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(EV, exist_ok=True)
WORK = tempfile.mkdtemp(prefix="ur-jobrun-test-")
PY = sys.executable
FAILS = 0

def header(name, cmd):
    return "\n".join([f"=== {name} ===", f"date_utc: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
                      f"os: {platform.platform()}", f"python: {sys.version.split()[0]}", f"user: {os.getlogin() if hasattr(os, 'getlogin') else '?'}",
                      f"helper: {HELPER}", f"command: {cmd}", "--- raw output ---"])

def record(log, name, ok, lines):
    global FAILS
    with open(os.path.join(EV, log), "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + f"\nRESULT {name}: {'PASS' if ok else 'FAIL'}\n")
    if not ok: FAILS += 1
    print(f"RESULT {name}: {'PASS' if ok else 'FAIL'}")

def script(body):
    p = os.path.join(WORK, f"s{time.time_ns()}.py"); open(p, "w").write(body); return p

def pids_file():
    return os.path.join(WORK, f"pids{time.time_ns()}.json")

# Foreign program: records its pid, starts a child (which starts a grandchild), then does <tail>.
def tree_program(pf, tail, child_flags="0"):
    # R2-WIN-TEST-REMEDIATION-003:
    # Fix: build child_code as a variable, then pass it via repr(child_code)
    # to the -c argument. Without this repr layer, Windows CommandLine
    # parsing strips one backslash level, causing Python child to see
    # invalid escape sequences (\U, \A, etc.) and die with SyntaxError.
    child_code = (
        "import subprocess,sys,time,json; "
        "gg=subprocess.Popen([sys.executable,'-c','import time; time.sleep(3600)']); "
        "open(" + repr(pf) + "+'.gg','w').write(str(gg.pid)); "
        "time.sleep(3600)"
    )
    return script(f'''
import json, os, subprocess, sys, time
g = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"])
c = subprocess.Popen([sys.executable, "-c", {repr(child_code)}], creationflags={child_flags})
time.sleep(1.0)
json.dump({{"root": os.getpid(), "child": c.pid, "sib": g.pid}}, open({pf!r}, "w"))
{tail}
''')

def run_helper(prog_args, backstop=60000, **kw):
    return subprocess.Popen([HELPER, str(backstop), "--"] + prog_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)

def read_pids(pf):
    for _ in range(100):
        if os.path.exists(pf) and os.path.exists(pf + ".gg"):
            d = json.load(open(pf)); d["grandchild"] = int(open(pf + ".gg").read()); return d
        time.sleep(0.1)
    return None

# W1 / W2: supervisor-style timeout = kill the helper at the budget; tree must die.
pf = pids_file(); prog = tree_program(pf, "time.sleep(3600)")
h = run_helper([PY, prog]); d = read_pids(pf); time.sleep(0.5)
before = {k: alive(v) for k, v in (d or {}).items()}
t0 = time.time(); kill(h.pid); h.wait(); time.sleep(1.0)
after = {k: alive(v) for k, v in (d or {}).items()}
lines = [header("fri-timeout-windows.log", f"{HELPER} 60000 -- {PY} {prog}; helper killed at budget"),
         f"pids: {d}", f"alive before: {before}", f"alive after: {after}", f"helper exit: {h.returncode}"]
record("fri-timeout-windows.log", "W1-timeout-tree-dead", bool(d) and all(before.values()) and not any(after.values()), lines)
record("fri-timeout-windows.log", "W2-grandchild-dead", bool(d) and before.get("grandchild") and not after.get("grandchild"), [f"grandchild {d and d.get('grandchild')}: before={before.get('grandchild')} after={after.get('grandchild')}"])

# W3: breakaway attempt (CREATE_BREAKAWAY_FROM_JOB) must be refused by the job.
res = os.path.join(WORK, "w3.txt")
prog = script(f'''
import subprocess, sys
try:
    subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"], creationflags=0x01000000)
    open({res!r}, "w").write("BREAKAWAY_SUCCEEDED")
except OSError as e:
    open({res!r}, "w").write("REJECTED winerror=%s" % getattr(e, "winerror", "?"))
''')
h = run_helper([PY, prog]); out, err = h.communicate(timeout=60)
outcome = open(res).read() if os.path.exists(res) else "NO RESULT"
record("fri-breakaway-windows.log", "W3-breakaway-rejected", outcome.startswith("REJECTED"),
       [header("fri-breakaway-windows.log", f"{HELPER} -- {PY} {prog}"), f"outcome: {outcome}", f"helper exit: {h.returncode}", f"stderr: {err.decode(errors='replace')}"])

# W4: helper killed externally while the foreign tree runs → KILL_ON_JOB_CLOSE ends the tree.
pf = pids_file(); prog = tree_program(pf, "time.sleep(3600)")
h = run_helper([PY, prog], backstop=0); d = read_pids(pf); time.sleep(0.5)
before = {k: alive(v) for k, v in (d or {}).items()}
subprocess.run(["taskkill", "/F", "/PID", str(h.pid)], capture_output=True); h.wait(); time.sleep(1.0)
after = {k: alive(v) for k, v in (d or {}).items()}
record("fri-helper-crash.log", "W4-helper-killed-tree-dead", bool(d) and all(before.values()) and not any(after.values()),
       [header("fri-helper-crash.log", "helper started with no backstop, then TerminateProcess(helper) from outside"), f"pids: {d}", f"alive before: {before}", f"alive after: {after}"])

# W5: OPEN-3 — root exits 0, a background descendant must survive.
bg = os.path.join(WORK, "w5.pid")
prog = script(f'''
import subprocess, sys
p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"], creationflags=0x00000008)  # DETACHED_PROCESS
open({bg!r}, "w").write(str(p.pid))
''')
h = run_helper([PY, prog]); out, err = h.communicate(timeout=60); time.sleep(1.0)
bpid = int(open(bg).read()) if os.path.exists(bg) else None
surv = bool(bpid) and alive(bpid)
record("fri-open3-windows.log", "W5-success-background-survives", h.returncode == 0 and surv,
       [header("fri-open3-windows.log", f"{HELPER} -- {PY} {prog}"), f"helper exit: {h.returncode}", f"background pid {bpid} alive: {surv}", f"stderr: {err.decode(errors='replace')}"])
if bpid: kill(bpid)

# W6: failing root (non-zero exit, as a failed compile step would) → descendants dead.
pf = pids_file(); prog = tree_program(pf, "sys.exit(3)")
h = run_helper([PY, prog]); d = read_pids(pf); h.wait(timeout=60); time.sleep(1.0)
after = {k: alive(v) for k, v in (d or {}).items() if k != "root"}
record("fri-open3-windows.log", "W6-failure-descendants-dead", h.returncode == 3 and bool(d) and not any(after.values()),
       [f"W6 helper exit: {h.returncode}", f"descendants alive after failure: {after}"])

# W7: output flood; the supervisor's response is to kill the helper → descendants dead.
pf = pids_file(); prog = tree_program(pf, "sys.stdout.write('x' * (17 * 1024 * 1024)); sys.stdout.flush(); time.sleep(3600)")
h = run_helper([PY, prog]); d = read_pids(pf)
n = 0
while n <= 16 * 1024 * 1024:
    chunk = h.stdout.read(1 << 20)
    if not chunk: break
    n += len(chunk)
kill(h.pid); h.wait(); time.sleep(1.0)
after = {k: alive(v) for k, v in (d or {}).items()}
record("fri-output-limit-windows.log", "W7-output-limit-descendants-dead", n > 16 * 1024 * 1024 and bool(d) and not any(after.values()),
       [header("fri-output-limit-windows.log", "17 MiB flood; helper killed after 16 MiB"), f"bytes read: {n}", f"alive after: {after}"])

# W8: the helper itself runs in an outer job that allows only 1 active process → the
# foreign process cannot be created/assigned; helper must reject cleanly (exit 125,
# UR_FRI_CONTAINMENT_FAILED) and the foreign code must never run (canary).
canary = os.path.join(WORK, "w8.canary")
prog = script(f'open({canary!r}, "w").write("RAN")')
JobObjectExtendedLimitInformation, JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 9, 0x8
class BASIC(ctypes.Structure):
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
class IOC(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint64) for n in ("R", "W", "O", "RB", "WB", "OB")]
class EXT(ctypes.Structure):
    _fields_ = [("Basic", BASIC), ("Io", IOC), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
k32.CreateJobObjectW.restype = wintypes.HANDLE
outer = k32.CreateJobObjectW(None, None)
ext = EXT(); ext.Basic.LimitFlags = JOB_OBJECT_LIMIT_ACTIVE_PROCESS; ext.Basic.ActiveProcessLimit = 1
k32.SetInformationJobObject(outer, JobObjectExtendedLimitInformation, ctypes.byref(ext), ctypes.sizeof(ext))
h = subprocess.Popen([HELPER, "60000", "--", PY, prog], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=0x00000004)  # CREATE_SUSPENDED
hp = k32.OpenProcess(0x1F0FFF, False, h.pid); k32.AssignProcessToJobObject(outer, hp)
k32.NtResumeProcess = ctypes.WinDLL("ntdll").NtResumeProcess; k32.NtResumeProcess(hp); k32.CloseHandle(hp)
out, err = h.communicate(timeout=60); e = err.decode(errors="replace")
ran = os.path.exists(canary)
record("fri-nested-job-windows.log", "W8-nested-job-clean-rejection", h.returncode == 125 and "UR_FRI_CONTAINMENT_FAILED" in e and not ran,
       [header("fri-nested-job-windows.log", "helper inside an outer job with ActiveProcessLimit=1"), f"helper exit: {h.returncode}", f"stderr: {e}", f"canary (foreign code ran): {ran}"])

print(f"FAILS={FAILS}")
sys.exit(FAILS)
