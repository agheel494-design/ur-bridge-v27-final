# CALL_EXTERNAL_DESIGN_LIMITATIONS.md

Official documentation, per direct review request: is the rejection
of `let`-variable arguments and nested `call_external(...)` calls a
Bug or an intentional design constraint? Answer: **intentional design
constraint, directly caused by the security fix (see
FRI_SECURITY_AND_BEHAVIOR_NOTES.md), not a Bug.**

## Reproduction, confirmed live

```
let n = 25
let x = call_external("python", "math", "sqrt", n)
```
Error: `arguments for 'sqrt' are not valid JSON literals ... received: n`

```
let x = call_external("python", "math", "sqrt", call_external("python", "math", "pow", 2, 6))
```
Error: `arguments for 'sqrt' are not valid JSON literals ... received: call_external(...)`

## Why this is intentional, not a Bug

The security fix (this same session, prior commit) deliberately
changed `call_external`'s own argument-handling from "splice raw
source text into the executed script" (a real code-injection
vulnerability) to "parse the raw argument text as strict JSON, reject
anything that is not a valid JSON literal." This closes the injection
vulnerability completely, but as a direct, unavoidable consequence,
it also rejects anything that is real UR *code* rather than a literal
*value* — a variable reference (`n`) and a nested call
(`call_external(...)`) are both real UR expressions requiring
evaluation, not JSON literals.

**Supporting these would require a different, larger architectural
change**: `call_external`'s own arguments would need to be evaluated
as real UR expressions at runtime (via the real IR/Interpreter, the
same way any other function call's arguments already are), with the
resulting VALUE then serialized to JSON — rather than being captured
as raw source text at rewrite time (before any UR compilation/
evaluation happens at all, per the current, real source-rewrite
design of `call_external`). This is a real, different design (a real
IR instruction with real IRValueRef arguments, not a text-substitution
macro) — not attempted in this pass, since it is new architectural
work, not a bug fix, and was not requested as such.

## Current, disclosed scope boundary

`call_external(...)`'s own 4th+ arguments must be literal JSON values
written directly in the call itself (numbers, `"strings"`, `[arrays]`,
`{"objects":1}`, `true`/`false`/`null`) — NOT variable references, NOT
nested `call_external(...)` calls, NOT any other UR expression.

**Workaround available today, confirmed working**: Manifest-based
imports (`import mymodule` then `myFn(n)`) do NOT have this
limitation — `n` (a real UR variable) is evaluated normally by UR's
own real interpreter and passed as a real value, because
Manifest-based functions are real IR functions with real parameters,
not a source-text rewrite. `call_external(...)`'s own text-substitution
design is what specifically introduces this constraint; Manifest-based
import does not share it.
