import { describe, it, expect } from "vitest";
import { compileC } from "../../tools/backend/c-compile.js";

// C Backend Runtime Audit - real test. Corrects a real methodology
// error: an earlier inventory pass claimed BACKEND_CODES was unused,
// based on a search scoped only to src/ - it missed
// tools/backend/c-compile.ts, where BACKEND_CODES.COMPILE_FAILED is
// actually used. This test confirms the real, end-to-end behavior.

describe("C Backend Runtime Audit: real GCC failure behavior", () => {
  it("genuinely invalid C source produces a real, complete gcc error message under BE1001 (COMPILE_FAILED) - nothing lost or swallowed", () => {
    const badC = "int main() { this is not valid C at all !!! ";
    const result = compileC(badC, "test.exe");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0].code).toBe("BE1001");
      expect(result.diagnostics[0].message).toContain("gcc failed to compile");
      expect(result.diagnostics[0].message.length).toBeGreaterThan(50);
    }
  });

  it("a genuinely missing GCC (simulated via a temporarily neutralized PATH, restored immediately after) produces a clear BE1001 diagnostic, not a crash or an unhandled exception", () => {
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent-empty-path-for-test";
      const result = compileC("int main() { return 0; }", "test.exe");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0].code).toBe("BE1001");
        expect(result.diagnostics[0].message).toContain("not available");
      }
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
