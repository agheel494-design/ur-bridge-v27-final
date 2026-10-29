// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Regression: hashContent must produce a full 64-char hex digest.
//
// BUG (found during Hardening phase, v27 audit):
//
//   hashContent() was documented (interface comment on FileFingerprint.hash
//   and the function's own JSDoc) to return a 64-char hex digest, but the
//   implementation only concatenated 4 segments of 8 hex chars each = 32
//   chars total. The two extra "segments" (seg2, seg3) were also low-value:
//   they were derived purely from values (hashA, hashB) already fully
//   consumed by seg0/seg1, so they added no new entropy, and were dropped
//   from the final string regardless. Net effect: hashContent silently
//   returned half its documented digest length, with the dropped half
//   not even being entropy-bearing.
//
//   Practically, a shorter-than-documented hash widens the collision
//   surface for the build cache and dependency fingerprinting (both keyed
//   on this hash) and breaks any caller relying on the documented 64-char
//   contract (e.g. fixed-width storage, hex-string parsing).
//
// FIX: hashContent now mixes content through 8 independent FNV-1a lanes
//   (distinct prime/offset seeds) with a Murmur-style avalanche finalizer
//   per lane, emitting one real 8-hex-char (32-bit) segment per lane for a
//   genuine 64 hex characters of digest, while remaining pure JS (no crypto
//   API — must run identically in Node, browsers, and WASM hosts) and O(n).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { hashContent, makeFingerprint } from "../../src/compiler/incremental/fingerprint.js";

describe("Regression: hashContent produces a full 64-char hex digest", () => {
  it("returns exactly 64 hex characters for typical content", () => {
    const h = hashContent("fn main() { return 0; }");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns exactly 64 hex characters for empty input", () => {
    expect(hashContent("")).toHaveLength(64);
  });

  it("returns exactly 64 hex characters for long input (100k chars)", () => {
    expect(hashContent("x".repeat(100_000))).toHaveLength(64);
  });

  it("returns exactly 64 hex characters for unicode (Arabic) input", () => {
    expect(hashContent("دالة حساب(أ: عدد): عدد { أرجع أ + 1 }")).toHaveLength(64);
  });

  it("makeFingerprint's hash field is also 64 chars", () => {
    expect(makeFingerprint("a.ur", "fn a() {}").hash).toHaveLength(64);
  });

  it("remains deterministic and content-sensitive after the fix", () => {
    expect(hashContent("same")).toBe(hashContent("same"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
    // Distinguishes inputs that differ only in their second half — guards
    // against a regression where only the first N bytes are mixed in.
    expect(hashContent("aaaa" + "a")).not.toBe(hashContent("aaaa" + "b"));
  });
});
