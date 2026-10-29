import { describe, it, expect } from "vitest";
import { fromSemanticDiagnostic } from "../../../src/compiler/diagnostics/adapter.js";

// KNOWN LIMITATION, not a bug: reporter.ts's own Diagnostic.related
// type is Array<{ severity: Severity; message: string }> - it has no
// span field to begin with. The adapter cannot lose data into a field
// that was never there to receive it; the limitation belongs to the
// target contract (reporter.ts), not to this adapter's own
// implementation. This test exists to make that limitation visible
// and permanent, not to mark it as something to "fix" here - fixing
// it means extending reporter.ts's own contract, a separate, future
// architectural decision.
describe("Known limitation: reporter.ts's own Diagnostic.related cannot represent a span", () => {
  it("a related entry's own span is necessarily absent from the converted output, because the target contract has no field for it", () => {
    const syntheticDiag = {
      severity: "error" as const,
      code: "SE2001",
      message: "duplicate variable 'x'",
      span: { startLine: 5, startColumn: 3, endLine: 5, endColumn: 4 },
      related: [{ message: "previously declared here", span: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 4 } }],
    };
    const converted = fromSemanticDiagnostic(syntheticDiag, "test.ur");
    expect("span" in (converted.related?.[0] ?? {})).toBe(false);
    expect(converted.related?.[0].message).toBe("previously declared here");
  });
});
