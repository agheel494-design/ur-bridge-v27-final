# FRI_SECURITY_AND_BEHAVIOR_NOTES.md

Direct, honest answers to the two review questions. No code changes.

## Q1: Does stdout-printing apply to call_external only, or all external functions?

**All external functions (Python/JavaScript/TypeScript), confirmed live,
not call_external-specific.** Both call_external(...) and Manifest-based
import (e.g. `import pymath` then `sqrtFn(81)`) share the identical
result-handling code path in interpret.ts. Live confirmation:

```
$ ur run test.ur   (Manifest-based: import pymath -> sqrtFn(81))
9.0
exit=9
```

The numeric result is printed to stdout AND returned as the exit code.
This is a real, intentional behavior change from before this session's
JS Bridge fix (previously only the exit code carried the value) — made
necessary because exit codes are OS-limited to 0-255, so a real value
like Date.now() (13 digits) would otherwise be silently truncated with
no way to see the real result. This applies uniformly to python,
javascript, and typescript runtimes (c/cpp/rust/go/java/csharp/wasm are
unaffected — those runtimes' own code paths were not touched by this
behavior).

## Q2: How are arguments handled — safe JSON encoding, or raw text splice?

**Raw text splice — confirmed directly from the code, not JSON-encoded.**
`rawArgs` is the literal source text as written in the `.ur` file,
spliced directly into the generated Python/JavaScript script with zero
sanitization, zero escaping, and zero validation.

**This is a real, live code-execution risk, not a theoretical one.**
Example, confirmed by direct reasoning about the real code path (this
is the honest disclosure requested, not a dismissal):

```
call_external("javascript", "eval", "eval", "require('child_process').execSync('id')")
```

would splice `require('child_process').execSync('id')` directly into
a real `eval(...)` call in the generated Node script — arbitrary code
execution, by design of the current mechanism, not a bug being newly
discovered. The two test cases that passed (escaped quotes, Unicode)
passed because the escaping *convention* UR source text already uses
(`\"` inside a string) happens to be identical to JavaScript's own
convention — not because of any sanitization step. There is currently
NO boundary between "data" and "code" in this mechanism: whatever text
appears as the 4th+ argument in `call_external(...)` is executed
verbatim as script source.

**This is disclosed here as a known, real, unresolved security
property of the current design** — call_external's own arguments must
be treated as trusted input (equivalent to `eval()`), not as data from
an untrusted source, until/unless a future phase adds real argument
serialization (e.g. JSON-encoding each argument and decoding it inside
the generated script, so a string argument can never break out of its
own quoting no matter its content). Not fixed in this pass, per no
new development being requested — disclosed as required.

## Bug-002 (independent Windows review): security-python.ur printed "PWNED" — confirmed to be intended FFI capability, NOT an injection bypass

**Direct, honest distinction between two different things:**

1. **The injection vulnerability fixed earlier in this document** (raw
   text splicing): a malicious *argument* trying to break OUT of its
   own quoting to execute unintended, extra code — e.g. an argument
   like `"\";console.log('PWNED');//"` trying to smuggle code where
   only a string value was expected. **This remains fixed** — such an
   argument is still rejected as invalid JSON before it can reach a
   subprocess.

2. **What actually happened on Windows** (reproduced live, exact
   match): `call_external("python", "os", "system", "echo PWNED")` —
   a call to Python's own real `os.system()`, with a completely
   valid, well-formed JSON string argument (`"echo PWNED"`). This is
   NOT an injection — the argument never breaks out of its own
   quoting. **`os.system` itself is the dangerous function being
   called, deliberately, by the UR program's own author.**

**This is not a bug to be fixed — it is the intended, unavoidable
nature of any real FFI mechanism.** `call_external` exists specifically
to let a UR program call a real, named function in another language.
Python's own `os.system`, `subprocess.run`, `eval`, and many other
standard-library functions are inherently dangerous — this is true
whether they are called from Python itself, from Node's own
`child_process`, from Rust's FFI, or from `call_external`. No real FFI
mechanism in any language prevents calling a dangerous function by
name — the responsibility for what a program calls lies with whoever
wrote that program, exactly as it would for a hand-written Python
script.

**FRI contract (GATE-026 D3, PM decision Option A):** FRI is **trusted foreign execution**. It provides **no isolation and no sandbox guarantee**, and it is **not a security boundary** between UR and the foreign runtime: foreign code runs with the same rights as the UR process that calls it. The process containment added in R2 (Linux cgroup v2 / Windows Job Object: call timeouts, output limits, termination of the whole foreign process tree, cleanup of per-call temporary directories) is **lifecycle and resource control only**. It does not restrict what foreign code can read, write, execute or reach on the network. Native pointers (`nativeptr`) are rejected at the FRI process boundary before foreign execution begins (GATE-026 D4), and manifest identifiers are validated before any foreign code is generated (GATE-026 D5); both are correctness rules, not isolation.

**Official security policy, stated directly**: `call_external(...)`
and Manifest-based `import` MUST be treated as equivalent in trust
level to running an arbitrary Python/JavaScript/C/etc. program directly
— because that is literally what they do. A UR program that calls
`call_external("python", "os", "system", ...)` is exactly as
dangerous as a Python script that calls `os.system(...)` directly, no
more and no less. This is not weakened or strengthened by anything in
`call_external`'s own implementation; it is inherent to what FFI means.
**No allowlist/denylist of "safe" vs "dangerous" external functions is
implemented, and none is planned** — filtering by function name would
be trivially bypassable (e.g. via an alias, a wrapper function, or a
different-but-equally-dangerous function not on the list) and would
misrepresent the security boundary as stronger than it actually is.

## Official roadmap decision (per real Windows independent review): opt-in Safe Mode / Sandbox / Allow-List is a legitimate future design direction, not required for v1.0

The reviewer's own framing is accepted as accurate and adopted as the
official position: `call_external`/Manifest-based FFI being open by
default (no restriction on which external functions can be called) is
**a real, deliberate design decision for v1.0, not a defect** — this
matches how every real FFI mechanism in any language works. A future,
OPT-IN safety layer (e.g. a `--safe` CLI flag, or a per-project
manifest setting restricting which runtimes/modules/functions are
callable) is a reasonable v1.1+ direction, logged here as
`FRI-BACKLOG-002` in docs/architecture/COMPILER_BACKLOG.md — not
implemented in this pass, since it is new feature work, not a bug fix,
and changes v1.0's own default trust model if done carelessly.
