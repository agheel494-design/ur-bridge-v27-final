// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Tests: cmdCreateProject (urpm project template command)
// Phase 7 — Native Ecosystem Hardening — SQLite3 Integration
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { cmdCreateProject } from "../../src/urpm/commands.js";

describe("cmdCreateProject — database template", () => {
  it("returns ok with a valid scaffold for a well-formed project name", () => {
    const result = cmdCreateProject("my_app", "database");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.data?.scaffold.template).toBe("database");
  });

  it("scaffold includes a manifest with the correct project name and version", () => {
    const r = cmdCreateProject("my_app", "database");
    expect(r.data?.scaffold.manifest.name).toBe("my_app");
    expect(r.data?.scaffold.manifest.version).toBe("0.1.0");
  });

  it("scaffold contains src/main.ur and README.md files", () => {
    const r = cmdCreateProject("my_app", "database");
    const files = r.data?.scaffold.files ?? {};
    expect("src/main.ur" in files).toBe(true);
    expect("README.md" in files).toBe(true);
  });

  it("the generated .ur stub includes the disclaimer about compilability scope", () => {
    const r = cmdCreateProject("my_app", "database");
    const mainUr = r.data?.scaffold.files["src/main.ur"] ?? "";
    expect(mainUr).toContain("GENERATED ILLUSTRATION");
    expect(mainUr).toContain("STATUS_REPORT.md");
  });

  it("the generated .ur stub references all CRUD operations", () => {
    const r = cmdCreateProject("my_app", "database");
    const mainUr = r.data?.scaffold.files["src/main.ur"] ?? "";
    expect(mainUr).toContain("db.open");
    expect(mainUr).toContain("db.prepare");
    expect(mainUr).toContain("db.step");
    expect(mainUr).toContain("db.close");
    expect(mainUr).toContain("ROLLBACK");
  });

  it("README contains the verified capability list", () => {
    const r = cmdCreateProject("my_app", "database");
    const readme = r.data?.scaffold.files["README.md"] ?? "";
    expect(readme).toContain("UTF-8 round-trip");
    expect(readme).toContain("ROLLBACK");
    expect(readme).toContain("NOT NULL constraint");
  });

  it("notes array is non-empty and documents the scope boundary", () => {
    const r = cmdCreateProject("my_app", "database");
    const notes = r.data?.scaffold.notes ?? [];
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some(n => n.includes("FFI"))).toBe(true);
    expect(notes.some(n => n.includes("Frontend") || n.includes("compilability"))).toBe(true);
  });

  it("accepts Arabic characters in project name", () => {
    const r = cmdCreateProject("قاعدة_بيانات", "database");
    expect(r.ok).toBe(true);
    expect(r.data?.scaffold.name).toBe("قاعدة_بيانات");
  });
});

describe("cmdCreateProject — other templates", () => {
  it("vision template returns a stub scaffold", () => {
    const r = cmdCreateProject("my_cv_app", "vision");
    expect(r.ok).toBe(true);
    expect(r.data?.scaffold.template).toBe("vision");
    expect(r.data?.scaffold.notes.some(n => n.includes("OpenCV"))).toBe(true);
  });

  it("inference template returns a stub scaffold noting ONNX status", () => {
    const r = cmdCreateProject("my_ai_app", "inference");
    expect(r.ok).toBe(true);
    expect(r.data?.scaffold.notes.some(n => n.includes("ONNX"))).toBe(true);
  });

  it("robotics template returns a stub scaffold noting ROS2 status", () => {
    const r = cmdCreateProject("my_robot", "robotics");
    expect(r.ok).toBe(true);
    expect(r.data?.scaffold.notes.some(n => n.includes("ROS2"))).toBe(true);
  });
});

describe("cmdCreateProject — validation", () => {
  it("rejects an empty project name", () => {
    const r = cmdCreateProject("", "database");
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some(d => d.code === "INVALID_PROJECT_NAME")).toBe(true);
  });

  it("rejects a project name with invalid characters", () => {
    const r = cmdCreateProject("my app!", "database");
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some(d => d.code === "INVALID_PROJECT_NAME")).toBe(true);
  });

  it("accepts hyphens and underscores in project names", () => {
    expect(cmdCreateProject("my-project_v2", "database").ok).toBe(true);
  });
});
