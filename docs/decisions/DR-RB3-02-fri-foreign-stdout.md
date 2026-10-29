# DR-RB3-02 — FRI / `call_external`: foreign stdout is not a result channel (post-hoc record)

**Status:** APPROVED (PM). **Nature:** post-hoc. **No document named "P1-8" exists in the tree.**
That label appears only in the team's own R1 report (finding F-R1-2), which observed the behaviour. This record
does not claim to be that document.

## Facts
- **Reference `c6a26225` (pre-R1):** `call_external` programs whose tests read stdout (`JSON.stringify`, `fs.readdirSync`,
  `os.platform`, `Date.now`, quote and Unicode echoes, and the 5 security tests) produce **empty UR stdout**.
  Observed and reproduced; recorded in F-R1-2.
- **Since R1 (PM ruling R1-Q3, "confirm"):** foreign stdout is routed to **UR stderr** as diagnostics. The result
  travels **only** on the dedicated typed result channel (`UR_FRI_RESULT_PATH`). See `src/interpreter/interpret.ts`
  (`friExec` → `decodeFriResult`).
- Under R1-Q1, `call_external` results are int-only, so string results (`JSON.stringify`, `os.platform`) panic by
  contract.

## Contract (as in force)
1. Foreign stdout is **never** part of a UR value and never appears on UR stdout. It is diagnostics, on UR stderr.
2. Results come only from the typed result channel. `call_external` returns `int` only.

## Security oracle (replacement; for RB3-TEST-REALIGNMENT)
The 5 security tests currently assert an echoed stdout and therefore verify nothing. Proposed replacement, which
needs no stdout and is compatible with R1-Q1:
- Pass the malicious string to a function that returns an **int derived from the literal string**: for example
  `call_external("javascript","Buffer","byteLength", <payload>)`, whose result must equal the payload's exact UTF-8 byte
  length. That proves the payload arrived as **data**.
- The injected code, if it ran, would write a **canary file** or a marker. Assert that the canary is absent and the
  marker is absent from UR stderr. That proves **no execution**.
- Keep the D5 identifier validation (`FRI_INVALID_MANIFEST_IDENTIFIER`) as the manifest-side guard.

## Security limitation (PM, Gate 3): recorded, not mutation-tested
The realigned security tests prove, for the **current** implementation:
- exact data arrival of the payload: the typed-channel value, and Python `len()`;
- the absence of an executed marker line.

**They have not been mutation-tested.** No deliberately vulnerable build was used to show that they would fail if an
injection were reintroduced. Proving the tests' own detection power needs a separate **Security Mutation Gate**. It
is not part of V1.0.

The JS `Buffer.byteLength` oracle from the original proposal is not used: `Buffer` is not in the JS bridge's global
allow-list ("Cannot find module 'Buffer'").
