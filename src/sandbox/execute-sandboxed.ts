// ─────────────────────────────────────────────────────────────────────────────
// UR Capability Runtime — MVP v0.1 (per direct instruction)
//
// executeSandboxed(code, policy): the ONE public entry point for this Gate.
// Policy is mandatory - there is no overload that accepts code alone, per
// direct instruction ("Deny-by-default must be a Runtime interface property,
// not a developer convention"). TypeScript's own type system enforces this:
// there is no second signature for this function.
//
// Zero change to Lexer/Parser/Semantic/TypeChecker/IR/Lowering - every stage
// below is called exactly as it already exists, unmodified, in-process (not
// via a generated wrapper script and a subprocess, which is how the CLI's
// own `ur run` works) - this is a genuine embeddable library call, proving
// Architecture Gate 2's "already self-contained, callable as a library"
// finding in practice, not just by inspection.
//
// Import is banned in sandboxed mode: checked on the parsed Program's own
// `imports` array, BEFORE semantic analysis/type checking/lowering ever run -
// a rejected snippet costs nothing beyond parsing.
// ─────────────────────────────────────────────────────────────────────────────

import { lex } from "../compiler/frontend/lexer.js";
import { parse } from "../compiler/frontend/parser.js";
import { analyze } from "../compiler/semantic/index.js";
import { typeCheck } from "../compiler/typesystem/checker.js";
import { lowerToIR } from "../compiler/codegen/lower-to-ir.js";
import { interpretModule, type SandboxPolicy, type SandboxAuditEvent } from "../interpreter/interpret.js";

export type { SandboxPolicy, SandboxAuditEvent, SandboxCapabilityGrant } from "../interpreter/interpret.js";

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  auditLog: SandboxAuditEvent[];
}

export interface ExecuteSandboxedOptions {
  /** Mandatory. There is no default-allow - an empty allow list denies everything, explicitly. */
  policy: SandboxPolicy;
  /** Mandatory. No infinite-loop protection is optional in this Runtime. */
  timeoutMs: number;
  /** Host-registered real URLs for named network endpoints - the snippet never supplies a raw URL itself. */
  networkEndpoints?: Record<string, string>;
  /** Entry function name, matching the existing interpreter's own convention. */
  entryFunctionName?: string;
}

/**
 * The single, mandatory-policy entry point for MVP v0.1. There is no
 * `execute(code)` overload anywhere in this module - per direct instruction,
 * the API surface itself makes deny-by-default structural, not conventional.
 */
const SANDBOX_EXTERNAL_FUNCTIONS = new Map<string, { runtime: "python" | "javascript" | "c" | "rust" | "cpp" | "wasm" | "go" | "java" | "typescript"; module: string; symbol: string }>([
  ["sandbox_fs_read", { runtime: "javascript", module: "sandbox_fs", symbol: "read" }],
  ["sandbox_net_request", { runtime: "javascript", module: "sandbox_net", symbol: "request" }],
  // Agent Readiness Gate (per direct instruction: minimal string standard
  // library, general-purpose primitives, not a full CSV/parsing library).
  // These require zero capability - pure computation, zero I/O of any kind.
  ["string_length", { runtime: "javascript", module: "ur_stdlib_string", symbol: "length" }],
  ["string_trim", { runtime: "javascript", module: "ur_stdlib_string", symbol: "trim" }],
  ["string_split", { runtime: "javascript", module: "ur_stdlib_string", symbol: "split" }],
  ["string_split_get", { runtime: "javascript", module: "ur_stdlib_string", symbol: "split_get" }],
  ["string_join", { runtime: "javascript", module: "ur_stdlib_string", symbol: "join" }],
  ["string_contains", { runtime: "javascript", module: "ur_stdlib_string", symbol: "contains" }],
  ["string_starts_with", { runtime: "javascript", module: "ur_stdlib_string", symbol: "starts_with" }],
  ["string_ends_with", { runtime: "javascript", module: "ur_stdlib_string", symbol: "ends_with" }],
  ["string_substring", { runtime: "javascript", module: "ur_stdlib_string", symbol: "substring" }],
  ["string_to_int", { runtime: "javascript", module: "ur_stdlib_string", symbol: "to_int" }],
  ["string_to_float", { runtime: "javascript", module: "ur_stdlib_string", symbol: "to_float" }],
  ["int_to_string", { runtime: "javascript", module: "ur_stdlib_string", symbol: "int_to_string" }],
  ["float_to_string", { runtime: "javascript", module: "ur_stdlib_string", symbol: "float_to_string" }],
]);

export function executeSandboxed(code: string, options: ExecuteSandboxedOptions): SandboxExecutionResult {
  const auditLog: SandboxAuditEvent[] = [];
  const executionId = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const lexResult = lex(code);
  if (lexResult.errors.length > 0) {
    return { stdout: "", stderr: `sandbox rejected: lex error: ${lexResult.errors[0]!.message}`, exitCode: 1, auditLog };
  }

  const parseResult = parse(lexResult.tokens);
  if (parseResult.errors.length > 0) {
    return { stdout: "", stderr: `sandbox rejected: parse error: ${parseResult.errors[0]!.message}`, exitCode: 1, auditLog };
  }

  // MVP v0.1 (per direct instruction): Import is banned in sandbox mode -
  // checked here, on the parsed AST, before any further compilation stage
  // runs. This is not a capability that can be granted; it is categorically
  // unavailable in this execution mode, since the module-resolution system
  // lives outside this self-contained pipeline entirely (Architecture Gate 2,
  // §6) and bringing it in is explicitly out of scope for this Gate.
  if (parseResult.program.imports.length > 0) {
    return { stdout: "", stderr: "sandbox rejected: 'import' is not permitted in sandboxed execution (MVP v0.1 scope)", exitCode: 1, auditLog };
  }

  const externalNames = new Set(SANDBOX_EXTERNAL_FUNCTIONS.keys());
  const semanticResult = analyze(parseResult.program, externalNames);
  if (!semanticResult.valid) {
    return { stdout: "", stderr: `sandbox rejected: semantic error: ${semanticResult.diagnostics[0]?.message ?? "invalid program"}`, exitCode: 1, auditLog };
  }

  const typeCheckResult = typeCheck(parseResult.program);
  if (!typeCheckResult.valid) {
    return { stdout: "", stderr: `sandbox rejected: type error: ${typeCheckResult.diagnostics[0]?.message ?? "invalid program"}`, exitCode: 1, auditLog };
  }

  const buildResult = lowerToIR(parseResult.program, "<sandbox>", "sandbox", undefined, undefined, SANDBOX_EXTERNAL_FUNCTIONS);
  if (!buildResult.ok) {
    return { stdout: "", stderr: `sandbox rejected: build error: ${buildResult.diagnostics[0]?.message ?? "lowering failed"}`, exitCode: 1, auditLog };
  }

  const result = interpretModule(buildResult.value, options.entryFunctionName ?? "main", {
    policy: options.policy,
    timeoutMs: options.timeoutMs,
    executionId,
    networkEndpoints: options.networkEndpoints,
    onAudit: (event) => auditLog.push(event),
  });

  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, auditLog };
}
