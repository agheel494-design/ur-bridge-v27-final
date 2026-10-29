/**
 * ADR-007 / Integration Contract v1.0 — Package Location Validator
 *
 * SCOPE, PER THE RATIFIED PR CONTRACT: this file introduces exactly
 * the interfaces specified — ResolvedPackage, PackageLocationValidator,
 * ValidationResult — and nothing else. It does NOT touch
 * urpm.Manifest, does NOT introduce runtime/exports into urpm, does
 * NOT redesign Module Identity, does NOT resolve transitive
 * dependencies, does NOT change any Backend, and does NOT modify
 * resolveAndMergeImports. This is a new, standalone module.
 *
 * Position in the pipeline, per Integration Contract v1.0:
 *   Package Resolver → ResolvedPackage → PackageLocationValidator
 *                                              │
 *                            ┌─────────────────┴─────────────────┐
 *                            ▼                                   ▼
 *                      valid path                          invalid path
 *                     → Module Resolver              → RESOLVED_PACKAGE_LOCATION_INVALID
 *
 * F1 (package not found) and F3 (multiple versions) are explicitly
 * OUT OF SCOPE here — they remain entirely within Package Resolver's
 * own existing code (urpm's real `undefined` returns and
 * `pickBestVersion`), untouched by this file.
 *
 * Audit resolution (recorded in ARCHITECTURE_DECISION_RECORDS.md):
 * "valid" here means exactly "resolvedPath exists as a real
 * directory" — nothing about index.ur/main, per this Contract's own
 * Section 6 prohibition (Package Resolver/this layer MUST NOT know
 * about index.ur — that is Module Resolver's own, later territory,
 * explicitly out of scope for this PR).
 */
import { existsSync, statSync } from "fs";

/**
 * The minimal semantic output of Package Resolution, per Integration
 * Contract v1.0 §2: PackageIdentity (name+version) and
 * ResolvedLocation (resolvedPath) kept as one real record, but
 * conceptually separated — Import Resolver may read `resolvedPath`
 * only; it may never re-derive or re-select `name`/`version`.
 */
export interface ResolvedPackage {
  readonly name: string;
  readonly version: string;
  readonly resolvedPath: string;
}

/** F2's own, distinct diagnostic — never aliased with any existing "module not found" code. */
export const RESOLVED_PACKAGE_LOCATION_INVALID = "RESOLVED_PACKAGE_LOCATION_INVALID" as const;

export type ValidationResult =
  | { readonly ok: true; readonly pkg: ResolvedPackage }
  | { readonly ok: false; readonly code: typeof RESOLVED_PACKAGE_LOCATION_INVALID; readonly message: string; readonly path: string };

export interface PackageLocationValidator {
  validate(pkg: ResolvedPackage): ValidationResult;
}

/**
 * Real, default implementation. Checks exactly one thing, per the
 * Audit Resolution above: does `resolvedPath` exist as a real
 * directory on disk. Does not touch `name`/`version` — they pass
 * through unchanged on success, confirming this layer performs no
 * Package-identity re-resolution of its own (Invariant 4).
 */
export function createFilesystemPackageLocationValidator(): PackageLocationValidator {
  return {
    validate(pkg: ResolvedPackage): ValidationResult {
      let exists = false;
      let isDirectory = false;
      try {
        exists = existsSync(pkg.resolvedPath);
        if (exists) isDirectory = statSync(pkg.resolvedPath).isDirectory();
      } catch {
        exists = false;
      }
      if (exists && isDirectory) {
        return { ok: true, pkg };
      }
      return {
        ok: false,
        code: RESOLVED_PACKAGE_LOCATION_INVALID,
        message: `resolved package location for '${pkg.name}@${pkg.version}' does not exist or is not a directory: ${pkg.resolvedPath}`,
        path: pkg.resolvedPath,
      };
    },
  };
}
