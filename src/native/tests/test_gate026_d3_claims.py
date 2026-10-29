#!/usr/bin/env python3
"""GATE-026 D3 - documentation contract check (Option A: FRI = trusted foreign execution, NO isolation guarantee).
Usage: python3 test_gate026_d3_claims.py <ur-repo-root>
1. Positive/negative controls prove the detector flags an isolation claim and accepts a negated statement.
2. Every Markdown/text document is scanned line by line. A line is a VIOLATION if it mentions FRI / foreign
   execution AND an isolation/sandbox/security-boundary claim WITHOUT a negating or deferring qualifier.
3. The D3 contract statement must be present in the FRI user guide, the FRI security notes and ROADMAP_LOCK.md.
Exit code = number of problems (violations + missing statements + failed controls)."""
import os, re, sys
ROOT = sys.argv[1]
FRI = re.compile(r"\bFRI\b|call_external|foreign (code|runtime|execution|process)|manifest-based (ffi|import)", re.I)
CLAIM = re.compile(r"isolat|sandbox|security boundary|secure(ly)? (execution|execute|isolation)|safe(ly)? (execution|execute)|trust boundary", re.I)
QUAL = re.compile(r"\b(no|not|never|none|without|cannot|isn't|doesn't|withdrawn|superseded|future|opt-in|backlog|planned|unless)\b", re.I)
# "dev/development sandbox" names the project's own build environment, not a property of FRI. Documented
# refinement after run 1 (it flagged docs/TEST_COVERAGE_MAP.md:30, which says the dev sandbox lacks toolchains).
ENV_SANDBOX = re.compile(r"\b(dev|development) sandbox\b", re.I)
def flagged(line):
    l = ENV_SANDBOX.sub("dev-environment", line)
    return bool(FRI.search(l) and CLAIM.search(l) and not QUAL.search(l))
problems = 0
controls = [("FRI provides secure isolation of foreign code.", True),
            ("Foreign code runs in a sandbox under FRI.", True),
            ("FRI is trusted foreign execution; it provides no isolation guarantee.", False),
            ("There is no sandboxing for call_external.", False),
            ("FRI tests: the dev sandbox lacks the toolchains", False),
            ("FRI runs in the dev sandbox and is isolated from the host", True)]
for text, expect in controls:
    ok = flagged(text) == expect; problems += 0 if ok else 1
    print(f"CONTROL {'OK ' if ok else 'BAD'} expect_flag={expect}: {text}")
scanned = 0; violations = []
for d, dirs, files in os.walk(ROOT):
    dirs[:] = [x for x in dirs if x not in ("node_modules", ".git", "dist")]
    for f in files:
        if not f.endswith((".md", ".txt")): continue
        p = os.path.join(d, f); scanned += 1
        for i, line in enumerate(open(p, encoding="utf-8", errors="replace"), 1):
            if flagged(line): violations.append(f"{os.path.relpath(p, ROOT)}:{i}: {line.strip()[:200]}")
print(f"documents scanned: {scanned}")
for v in violations: print("VIOLATION", v)
problems += len(violations)
REQ = ["docs/FRI_USER_GUIDE.md", "docs/architecture/FRI_SECURITY_AND_BEHAVIOR_NOTES.md", "ROADMAP_LOCK.md"]
for r in REQ:
    t = open(os.path.join(ROOT, r), encoding="utf-8").read().lower()
    ok = "trusted foreign execution" in t and "no isolation" in t
    problems += 0 if ok else 1
    print(f"CONTRACT {'PRESENT' if ok else 'MISSING'}: {r}")
print(f"PROBLEMS={problems}")
sys.exit(min(problems, 255))
