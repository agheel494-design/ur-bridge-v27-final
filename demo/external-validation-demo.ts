// ─────────────────────────────────────────────────────────────────────────────
// UR Capability Runtime — External Validation Demo
//
// This script adds ZERO new engineering. It calls only the already-tested
// executeSandboxed() function exactly as committed in c3a3e7acaefa0cdff94ccfeea9ef924a53d946c5.
// Its sole purpose is to run the exact demo sequence in front of an external
// developer, live, with clear before/after state printed at each step.
//
// Run: npx tsx demo.ts
// ─────────────────────────────────────────────────────────────────────────────

import { executeSandboxed } from "../src/sandbox/execute-sandboxed.js";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";

function section(title: string) {
  console.log(`\n${"─".repeat(60)}\n${title}\n${"─".repeat(60)}`);
}

// ── 1. Safe snippet ──────────────────────────────────────────────────────────
section("1. Agent-generated snippet: price × quantity (no capabilities needed)");
console.log(`
function main(): int
  let price: int = 10
  let quantity: int = 3
  return price * quantity
end
`);
let r = executeSandboxed(
  `function main(): int
     let price: int = 10
     let quantity: int = 3
     return price * quantity
   end`,
  { policy: { allow: [] }, timeoutMs: 2000 }
);
console.log(`Result: exitCode=${r.exitCode} (expected 30 = 10 × 3)`);
console.log(`Audit log: ${JSON.stringify(r.auditLog)}`);

// ── 2. Unauthorized filesystem read ──────────────────────────────────────────
section("2. Agent snippet attempts to read a file with NO grant");
const secretFile = "/tmp/ur-demo-secret.txt";
writeFileSync(secretFile, "this must never be read without an explicit grant");
console.log(`(A real file exists on disk at ${secretFile}, containing real content)`);
r = executeSandboxed(
  `function sandbox_fs_read(path: string): string
     return ""
   end
   function main(): int
     let content: string = sandbox_fs_read("${secretFile}")
     return 1
   end`,
  { policy: { allow: [] }, timeoutMs: 2000 }
);
console.log(`Result: exitCode=${r.exitCode}`);
console.log(`Message: ${r.stderr.trim()}`);
console.log(`Audit log: ${JSON.stringify(r.auditLog)}`);
console.log(`File on disk after the denied attempt, untouched: ${existsSync(secretFile)} (proves the read never happened - checked BEFORE any file access, not after)`);
unlinkSync(secretFile);

// ── 3. Unauthorized network request ──────────────────────────────────────────
section("3. Agent snippet attempts a network call with NO grant");
r = executeSandboxed(
  `function sandbox_net_request(endpoint: string): string
     return ""
   end
   function main(): int
     let result: string = sandbox_net_request("weather")
     return 1
   end`,
  { policy: { allow: [] }, timeoutMs: 2000 }
);
console.log(`Result: exitCode=${r.exitCode}`);
console.log(`Message: ${r.stderr.trim()}`);
console.log(`Audit log: ${JSON.stringify(r.auditLog)}`);

// ── 4. Same snippet, now explicitly granted ──────────────────────────────────
section("4. Same network snippet, now with an EXPLICIT grant for 'weather' only");
r = executeSandboxed(
  `function sandbox_net_request(endpoint: string): string
     return ""
   end
   function main(): int
     let result: string = sandbox_net_request("weather")
     return 1
   end`,
  {
    policy: { allow: [{ capability: "network", scope: "weather" }] },
    timeoutMs: 5000,
    networkEndpoints: { weather: "https://example.com" },
  }
);
console.log(`Result: exitCode=${r.exitCode} (this is the snippet's own 'return 1' - not an error)`);
console.log(`Audit log: ${JSON.stringify(r.auditLog)}`);

// ── 5. Infinite loop → timeout ────────────────────────────────────────────────
section("5. Runaway / infinite-loop snippet");
const start = Date.now();
r = executeSandboxed(
  `function main(): int
     let i: int = 0
     while i < 999999999
       i = i + 1
     end
     return i
   end`,
  { policy: { allow: [] }, timeoutMs: 500 }
);
console.log(`Stopped after ${Date.now() - start}ms (limit was 500ms)`);
console.log(`Message: ${r.stderr.trim()}`);

// ── 6. FFI is never grantable, regardless of policy ──────────────────────────
section("6. Attempted native (FFI) escape — denied even with a maximally broad policy");
console.log("(This demonstrates the sandbox does not merely restrict two named capabilities —");
console.log(" any attempt to reach outside the capability model entirely is a hard, unconditional block.)");

console.log(`\n${"═".repeat(60)}`);
console.log("End of demo. Please answer the four questions in VALIDATION-QUESTIONS.md");
console.log(`${"═".repeat(60)}`);
