#!/usr/bin/env python3
"""R2 closure O-2 / O-3 — UR-level FRI on Windows (real path, no helper-only shortcuts).

Path under test:  ur run  →  interpret.ts  →  Windows FRI supervisor  →  ur-fri-jobrun.exe  →  Job Object  →  foreign
This script lives OUTSIDE the UR tree so that running it does not change the freeze target.
It never edits UR, the helper, or FRI; it only writes throw-away fixtures in a temp dir.

Usage (Windows):
  python test_windows_ur_fri.py --repo <ur-bridge-v27-final> --evidence <dir> [--tsx <path to tsx cli.mjs>]
    --repo must contain src/native/bin/ur-fri-jobrun.exe built from the approved ur-fri-jobrun.c.
    UR is launched as: node <tsx cli.mjs> <repo>/src/cli/index.ts run <file>  (tsx from npm; see RUNBOOK)
Exit code = number of FAIL. NOT RUN / NOT TRIGGERABLE cases are reported, never counted as PASS.
On POSIX it runs in 'harness self-check' mode (Linux cgroup path) — that is NOT Windows evidence.
"""
import argparse, ctypes, glob, json, os, platform, shutil, subprocess, sys, tempfile, time

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True); ap.add_argument("--evidence", required=True); ap.add_argument("--tsx")
A = ap.parse_args()
REPO = os.path.abspath(A.repo); EV = os.path.abspath(A.evidence); os.makedirs(EV, exist_ok=True)
WIN = os.name == "nt"
TSX = A.tsx or shutil.which("tsx")
if TSX and not TSX.endswith(".mjs"):   # resolve npm shim to the real cli.mjs when possible
    cand = os.path.join(os.path.dirname(os.path.realpath(TSX)), "node_modules", "tsx", "dist", "cli.mjs")
    if os.path.isfile(cand): TSX = cand
CLI = os.path.join(REPO, "src", "cli", "index.ts")
HELPER = os.path.join(REPO, "src", "native", "bin", "ur-fri-jobrun.exe")
LOG = open(os.path.join(EV, "ur-windows-fri.log"), "a", encoding="utf-8")
FAILS = 0; SUMMARY = []

def w(s=""): LOG.write(s + "\n"); LOG.flush(); print(s)
def verdict(name, status, detail=""):
    global FAILS
    if status == "FAIL": FAILS += 1
    SUMMARY.append((name, status)); w(f"RESULT {name}: {status}" + (f"   ({detail})" if detail else ""))

def alive(pid):
    if not pid: return False
    if WIN:
        k = ctypes.WinDLL("kernel32"); k.OpenProcess.restype = ctypes.c_void_p
        h = k.OpenProcess(0x1000 | 0x00100000, False, int(pid))
        if not h: return False
        code = ctypes.c_ulong(); ok = k.GetExitCodeProcess(ctypes.c_void_p(h), ctypes.byref(code)); k.CloseHandle(ctypes.c_void_p(h))
        return bool(ok) and code.value == 259
    try:   # POSIX: a killed-but-unreaped process (zombie, state Z) is dead
        st = open(f"/proc/{int(pid)}/status").read()
        return "\nState:\tZ" not in st
    except OSError: return False

def friTmp(): return sorted(glob.glob(os.path.join(tempfile.gettempdir(), "ur-fri-*")))

def ur(fx, prog, env_extra=None, timeout=180, repo=None):
    cli = os.path.join(repo or REPO, "src", "cli", "index.ts")
    f = os.path.join(fx, "case.ur"); open(f, "w", encoding="utf-8").write(prog)
    env = dict(os.environ); env.update(env_extra or {})
    t0 = time.time()
    p = subprocess.run(["node", TSX, cli, "run", f], cwd=fx, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=timeout)
    ms = int((time.time() - t0) * 1000)
    w(f"$ ur run  ({prog.splitlines()[-4].strip() if len(prog.splitlines()) >= 4 else ''})  exit={p.returncode}  {ms} ms")
    for l in (p.stdout + p.stderr).splitlines()[:12]: w("    " + l)
    return p.returncode, p.stdout, p.stderr, ms

# ── header ────────────────────────────────────────────────────────────────
w("=" * 70); w(f"date_utc: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
w(f"os: {platform.platform()}   mode: {'WINDOWS' if WIN else 'POSIX SELF-CHECK (not Windows evidence)'}")
w(f"python: {sys.version.split()[0]}  node: {subprocess.run(['node','--version'],capture_output=True,text=True).stdout.strip()}  tsx: {TSX}")
w(f"repo: {REPO}"); w(f"helper: {HELPER}  exists={os.path.isfile(HELPER)}")
for c in ("python3", "python", "node", "tsx", "gcc", "g++", "cmd"):
    w(f"which {c}: {shutil.which(c)}")
if not TSX or not os.path.isfile(TSX): w("tsx not found — cannot launch UR"); verdict("U0-ur-launchable", "FAIL", "tsx missing"); sys.exit(FAILS)
pre_tmp = friTmp(); w(f"pre-existing ur-fri temp entries: {len(pre_tmp)}")

FX = tempfile.mkdtemp(prefix="ur-o2-fixture-")
pk = os.path.join(FX, "ur_packages", "wt"); os.makedirs(pk)
open(os.path.join(pk, "wt_impl.py"), "w").write(r'''
import os, subprocess, sys, time, json
D = os.environ["UR_O2_DIR"]
open(os.path.join(D, "canary"), "w").write(str(os.getpid()))
def _tree(tag):
    c = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"])
    g = subprocess.Popen([sys.executable, "-c", "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(3600)']); open(" + repr(os.path.join(D, tag + ".gg")) + ",'w').write(str(p.pid)); time.sleep(3600)"])
    time.sleep(1.5)
    json.dump({"root": os.getpid(), "child": c.pid, "mid": g.pid}, open(os.path.join(D, tag + ".json"), "w"))
def ok(x): return x + 1
def spin(x):
    _tree("spin")
    while True: time.sleep(0.1)
def flood(x):
    _tree("flood"); sys.stdout.write("x" * (17 * 1024 * 1024)); sys.stdout.flush(); time.sleep(3600)
def boom(x):
    _tree("boom"); raise RuntimeError("deliberate failure")
def e126(x):
    sys.exit(126)
def probe_forge(x):
    # T10 / FRI-FINDING-003: try to forge status-channel line 2 through ANY inherited pipe handle.
    res = {"platform": os.name, "tried": 0, "wrote": 0, "handles": []}
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.GetFileType.argtypes = [wintypes.HANDLE]; k.GetFileType.restype = wintypes.DWORD
        k.GetStdHandle.restype = wintypes.HANDLE
        k.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_char_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        own = {k.GetStdHandle(-10), k.GetStdHandle(-11), k.GetStdHandle(-12)}
        for hv in range(4, 16384, 4):
            if hv in own: continue
            if k.GetFileType(hv) != 3: continue          # FILE_TYPE_PIPE
            res["tried"] += 1
            for msg in (b"R:fail:99\r\n", b"R:ok\r\n"):
                n = wintypes.DWORD(0)
                if k.WriteFile(hv, msg, len(msg), ctypes.byref(n), None) and n.value:
                    res["wrote"] += 1; res["handles"].append(hex(hv))
    else:
        for fd in range(3, 64):
            try: os.write(fd, b"R:fail:99\n"); res["wrote"] += 1; res["handles"].append(fd)
            except OSError: pass
            res["tried"] += 1
    open(os.path.join(D, "probe_forge.json"), "w").write(json.dumps(res))
    return x + 1
def bg_ok(x):
    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)"], creationflags=0x00000008 if os.name == "nt" else 0, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    open(os.path.join(D, "bg.pid"), "w").write(str(p.pid)); return 5
''')
FNS = ["ok", "spin", "flood", "boom", "bg_ok", "e126", "probe_forge"]
json.dump({"name": "wt", "version": "0.1.0", "runtime": "python", "module": "wt_impl", "exports": {f: f for f in FNS}, "timeouts": {"runMs": 4000}}, open(os.path.join(pk, "manifest.json"), "w"))
open(os.path.join(pk, "signatures.ur"), "w").write("".join(f"function {f}(x: int): int\n  return 0\nend\n" for f in FNS))
pj = os.path.join(FX, "ur_packages", "wj"); os.makedirs(pj)
open(os.path.join(pj, "wj_impl.js"), "w").write("exports.jok = (x) => x * 3;\n")
json.dump({"name": "wj", "version": "0.1.0", "runtime": "javascript", "module": "./wj_impl.js", "exports": {"jok": "jok"}}, open(os.path.join(pj, "manifest.json"), "w"))
open(os.path.join(pj, "signatures.ur"), "w").write("function jok(x: int): int\n  return 0\nend\n")
pt = os.path.join(FX, "ur_packages", "wtsx"); os.makedirs(pt)
open(os.path.join(pt, "t_impl.ts"), "w").write("export function tok(x: number): number { return x * 4; }\n")
json.dump({"name": "wtsx", "version": "0.1.0", "runtime": "typescript", "module": os.path.join(pt, "t_impl.ts"), "exports": {"tok": "tok"}}, open(os.path.join(pt, "manifest.json"), "w"))
open(os.path.join(pt, "signatures.ur"), "w").write("function tok(x: int): int\n  return 0\nend\n")
pc = os.path.join(FX, "ur_packages", "wc"); os.makedirs(pc)
open(os.path.join(pc, "wc_impl.c"), "w").write("long cok(long a){ return a * 5; }\n")
json.dump({"name": "wc", "version": "0.1.0", "runtime": "c", "module": "wc_impl", "exports": {"cok": "cok"}}, open(os.path.join(pc, "manifest.json"), "w"))
open(os.path.join(pc, "signatures.ur"), "w").write("function cok(x: int): int\n  return 0\nend\n")
def prog(pkg, call): return f"import {pkg}\nfunction main(): int\n  print({call})\n  return 0\nend\n"
D = os.path.join(FX, "o2"); os.makedirs(D); ENV = {"UR_O2_DIR": D}
def tree_state(tag):
    try:
        d = json.load(open(os.path.join(D, tag + ".json"))); d["grandchild"] = int(open(os.path.join(D, tag + ".gg")).read())
        return d, {k: alive(v) for k, v in d.items()}
    except Exception as e: return None, {"error": str(e)}

# ── U1: helper discovery — helper absent ⇒ FRI_CONTAINMENT_UNAVAILABLE, canary absent (Windows only) ──
if WIN:
    alt = tempfile.mkdtemp(prefix="ur-o2-nohelper-"); alt_repo = os.path.join(alt, "ur")
    shutil.copytree(REPO, alt_repo, ignore=shutil.ignore_patterns("node_modules", "bin", "__pycache__"))
    if os.path.isdir(os.path.join(REPO, "node_modules")):
        try: os.symlink(os.path.join(REPO, "node_modules"), os.path.join(alt_repo, "node_modules"), target_is_directory=True)
        except OSError as e: w(f"    (node_modules not linked into the no-helper copy: {e}; UR itself needs no npm deps under tsx)")
    for f in glob.glob(os.path.join(D, "canary")): os.remove(f)
    rc, out, err, _ = ur(FX, prog("wt", "ok(1)"), ENV, repo=alt_repo)
    canary = os.path.exists(os.path.join(D, "canary"))
    verdict("U1-no-helper-fail-closed", "PASS" if rc != 0 and "FRI_CONTAINMENT_UNAVAILABLE" in err and not canary else "FAIL", f"canary={'present' if canary else 'absent'}")
    shutil.rmtree(alt, ignore_errors=True)
else: verdict("U1-no-helper-fail-closed", "NOT RUN", "Windows-only case")

# ── U2/U3: helper discovery positive + path resolution per runtime ──
rc, out, err, _ = ur(FX, prog("wt", "ok(1)"), ENV)
verdict("U2-helper-discovered-python-ok", "PASS" if rc == 0 and out.strip() == "2" else "FAIL", f"python runtime launches 'python3'; which python3 = {shutil.which('python3')}")
rc, out, err, _ = ur(FX, prog("wj", "jok(2)"), ENV)
verdict("U3-path-resolution-node", "PASS" if rc == 0 and out.strip() == "6" else "FAIL")
# ── U4: .cmd handling (typescript runtime → 'tsx' → tsx.cmd on Windows) ──
rc, out, err, _ = ur(FX, prog("wtsx", "tok(2)"), ENV)
verdict("U4-cmd-handling-typescript", "PASS" if rc == 0 and out.strip() == "8" else "FAIL", f"which tsx = {shutil.which('tsx')}")
# ── U5: compiled runtime through the helper (gcc compile step + wrapper.bin run step) ──
if shutil.which("gcc"):
    rc, out, err, _ = ur(FX, prog("wc", "cok(3)"), ENV)
    verdict("U5-c-runtime-compile-and-run", "PASS" if rc == 0 and out.strip() == "15" else "FAIL")
else: verdict("U5-c-runtime-compile-and-run", "NOT RUN", "gcc not on PATH")
# ── U6: timeout ⇒ FRI_TIMEOUT, whole tree dead ──
rc, out, err, ms = ur(FX, prog("wt", "spin(1)"), ENV); time.sleep(1.5)
d, st = tree_state("spin"); w(f"    tree: {d}  alive-after: {st}")
verdict("U6-timeout-tree-dead", "PASS" if rc != 0 and "FRI_TIMEOUT" in err and d and not any(st.values()) else "FAIL", f"{ms} ms for runMs 4000")
# ── U7: output limit ⇒ FRI_OUTPUT_LIMIT, tree dead ──
rc, out, err, ms = ur(FX, prog("wt", "flood(1)"), ENV); time.sleep(1.5)
d, st = tree_state("flood"); w(f"    tree: {d}  alive-after: {st}")
verdict("U7-output-limit-tree-dead", "PASS" if rc != 0 and "FRI_OUTPUT_LIMIT" in err and d and not any(st.values()) else "FAIL")
# ── U8: failure propagation ⇒ FRI_FAILED with foreign stderr, descendants dead ──
rc, out, err, ms = ur(FX, prog("wt", "boom(1)"), ENV); time.sleep(1.5)
d, st = tree_state("boom"); w(f"    tree: {d}  alive-after: {st}")
verdict("U8-failure-propagation-tree-dead", "PASS" if rc != 0 and "FRI_FAILED" in err and "deliberate failure" in err and d and not any(v for k, v in st.items() if k != "root") else "FAIL")
# ── U9: OPEN-3 through UR — success keeps background child ──
rc, out, err, ms = ur(FX, prog("wt", "bg_ok(1)"), ENV); time.sleep(1.0)
bg = int(open(os.path.join(D, "bg.pid")).read()) if os.path.exists(os.path.join(D, "bg.pid")) else None
verdict("U9-open3-success-background-alive", "PASS" if rc == 0 and out.strip() == "5" and alive(bg) else "FAIL", f"bg pid {bg} alive={alive(bg)}")
if bg and alive(bg):
    subprocess.run(["taskkill", "/F", "/PID", str(bg)] if WIN else ["kill", "-9", str(bg)], capture_output=True)
# ── U10: foreign exit 125 classification, plus FRI-FINDING-001 marker spoof ──
pf125 = os.path.join(FX, "ur_packages", "x125"); os.makedirs(pf125)
impl = "\n".join([
    "import sys, os",
    "def e125(x): sys.exit(125)",
    "def spoof(x):",
    "    open(os.path.join(os.environ['UR_O2_DIR'], 'spoof_canary'), 'w').write('RAN')",
    "    sys.stderr.write('UR_FRI_CONTAINMENT_FAILED:join\\n'); sys.exit(125)",
    "",
])
open(os.path.join(pf125, "i.py"), "w").write(impl)
json.dump({"name": "x125", "version": "0.1.0", "runtime": "python", "module": "i", "exports": {"e125": "e125", "spoof": "spoof"}, "timeouts": {"runMs": 4000}}, open(os.path.join(pf125, "manifest.json"), "w"))
open(os.path.join(pf125, "signatures.ur"), "w").write("function e125(x: int): int\n  return 0\nend\nfunction spoof(x: int): int\n  return 0\nend\n")
rc, out, err, _ = ur(FX, prog("x125", "e125(1)"), ENV)
verdict("U10-foreign125-no-marker-is-FRI_FAILED", "PASS" if rc != 0 and "FRI_FAILED" in err and "exit 125" in err else "FAIL")
for f in glob.glob(os.path.join(D, "spoof_canary")): os.remove(f)
rc, out, err, _ = ur(FX, prog("x125", "spoof(1)"), ENV); ran = os.path.exists(os.path.join(D, "spoof_canary"))
repro = ("FRI_CONTAINMENT_UNAVAILABLE" in err and ran)
verdict("U10b-marker-spoof-FRI-FINDING-001", "KNOWN-DEFECT" if repro else "CHANGED",
        "FRI-FINDING-001 reproduced: foreign code RAN but UR reported CONTAINMENT_UNAVAILABLE" if repro else "not reproduced")
# ── U11: induced helper-release failure in a disposable repo copy (Windows only) ──
if not WIN:
    verdict("U11-helper-release-failure-R-fail", "NOT RUN", "Windows-only: POSIX self-check is not evidence")
elif not shutil.which("gcc"):
    verdict("U11-helper-release-failure-R-fail", "NOT RUN", "gcc not on PATH; temporary helper cannot be rebuilt")
else:
    u11_root = tempfile.mkdtemp(prefix="ur-o2-u11-")
    u11_repo = os.path.join(u11_root, "repo")
    try:
        shutil.copytree(
            REPO, u11_repo,
            ignore=shutil.ignore_patterns("node_modules", ".git", "__pycache__", ".pytest_cache")
        )
        u11_c = os.path.join(u11_repo, "src", "native", "ur-fri-jobrun.c")
        u11_exe = os.path.join(u11_repo, "src", "native", "bin", "ur-fri-jobrun.exe")
        if not os.path.isfile(u11_c):
            raise FileNotFoundError("temporary copy is missing src/native/ur-fri-jobrun.c")
        c_text = open(u11_c, "r", encoding="utf-8").read()
        release_call = "SetInformationJobObject(job, JobObjectExtendedLimitInformation, &keep, sizeof keep)"
        injected_call = "SetInformationJobObject(NULL, JobObjectExtendedLimitInformation, &keep, sizeof keep)"
        if c_text.count(release_call) != 1:
            raise RuntimeError(
                "expected exactly one release call to inject; source mismatch or ambiguous target "
                f"(matches={c_text.count(release_call)})"
            )
        with open(u11_c, "w", encoding="utf-8", newline="") as f:
            f.write(c_text.replace(release_call, injected_call, 1))
        os.makedirs(os.path.dirname(u11_exe), exist_ok=True)
        build = subprocess.run(
            [shutil.which("gcc"), "-municode", u11_c, "-O2", "-o", u11_exe],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120
        )
        if build.returncode != 0 or not os.path.isfile(u11_exe):
            raise RuntimeError(
                "temporary injected helper build failed: "
                + (build.stderr[-3000:] or build.stdout[-3000:] or f"exit={build.returncode}")
            )
        u11_canary = os.path.join(D, "canary")
        if os.path.exists(u11_canary):
            os.remove(u11_canary)
        rc, out, err, ms = ur(FX, prog("wt", "ok(21)"), ENV, repo=u11_repo)
        canary = os.path.isfile(u11_canary)
        ok = rc == 101 and "FRI_CLEANUP_FAILED" in err and canary
        verdict(
            "U11-helper-release-failure-R-fail",
            "PASS" if ok else "FAIL",
            f"exit={rc}; FRI_CLEANUP_FAILED={'yes' if 'FRI_CLEANUP_FAILED' in err else 'no'}; "
            f"foreign-execution-canary={'present' if canary else 'absent'}; elapsed={ms} ms; "
            "failure injected only in disposable helper source"
        )
    except Exception as e:
        verdict("U11-helper-release-failure-R-fail", "NOT RUN", f"test setup/injection unavailable: {type(e).__name__}: {e}")
    finally:
        shutil.rmtree(u11_root, ignore_errors=True)
# ── U13: T10 / FRI-FINDING-003 — foreign tries to forge status line 2 via inherited pipe handles ──
pf_path = os.path.join(D, "probe_forge.json")
if os.path.exists(pf_path): os.remove(pf_path)
rc, out, err, _ = ur(FX, prog("wt", "probe_forge(1)"), ENV)
pr = json.load(open(pf_path)) if os.path.exists(pf_path) else None
w(f"    probe_forge: {pr}")
verdict("U13-T10-status-line2-not-forgeable", "PASS" if rc == 0 and out.strip() == "2" and pr is not None and "FRI_CLEANUP_FAILED" not in err else "FAIL",
        f"foreign pipe-handle writes that succeeded: {pr and pr['wrote']} (writes to its own non-status pipes are harmless; the verdict is the UR classification)")
# ── U14: foreign exit 126 ⇒ FRI_FAILED: exit 126 (never FRI_CLEANUP_FAILED / CONTAINMENT_UNAVAILABLE) ──
rc, out, err, _ = ur(FX, prog("wt", "e126(1)"), ENV)
verdict("U14-foreign-exit126-is-FRI_FAILED", "PASS" if rc != 0 and "FRI_FAILED" in err and "exit 126" in err and "FRI_CLEANUP_FAILED" not in err and "FRI_CONTAINMENT_UNAVAILABLE" not in err else "FAIL")
# ── U12: cleanup — no new ur-fri temp entries ──
new = [p for p in friTmp() if p not in pre_tmp]
verdict("U12-cleanup-no-temp-left", "PASS" if not new else "FAIL", f"new entries: {new}")

# ── O-3: calibration (legitimate per-call cost through UR, Windows) ──
w("-" * 70); w("CALIBRATION (per-call cost = (10-call run − 0-call run) / 10, 3 repetitions)")
base = f"function main(): int\n  print(1)\n  return 0\nend\n"
def timed(p): return ur(FX, p, ENV)[3]
b = [timed(base) for _ in range(3)]; w(f"baseline 0 calls: {b}")
loops = {"python": ("wt", "ok(i)"), "javascript": ("wj", "jok(i)"), "typescript": ("wtsx", "tok(i)")}
if shutil.which("gcc"): loops["c (compile+run per call)"] = ("wc", "cok(i)")
cal = {}
for name, (pkg, call) in loops.items():
    p = f"import {pkg}\nfunction main(): int\n  let i = 0\n  while i < 10\n    print({call})\n    i = i + 1\n  end\n  return 0\nend\n"
    t = [timed(p) for _ in range(3)]; per = [(x - min(b)) / 10 for x in t]; cal[name] = max(per)
    w(f"{name}: 10-call runs {t} → per-call ≈ {[round(x) for x in per]} ms (max {round(max(per))})")
if shutil.which("gcc"):
    src = os.path.join(FX, "m.c"); open(src, "w").write("int main(){return 0;}\n")
    ts = []
    for _ in range(3):
        t0 = time.time(); subprocess.run(["gcc", src, "-o", os.path.join(FX, "m.exe" if WIN else "m.out")], capture_output=True); ts.append(int((time.time() - t0) * 1000))
    w(f"raw gcc compile+link: {ts} ms")
w(f"CALIBRATION max legitimate per-call (ms): {json.dumps({k: round(v) for k, v in cal.items()})}")
w(f"acceptance rule (R2 §2): max ≤ runMs/10 = 3000 ms → {'HOLDS' if cal and max(cal.values()) <= 3000 else 'DOES NOT HOLD / NO DATA'}")

shutil.rmtree(FX, ignore_errors=True)
w("-" * 70); w(f"FAILS={FAILS}"); [w(f"  {n}: {s}") for n, s in SUMMARY]
sys.exit(FAILS)
