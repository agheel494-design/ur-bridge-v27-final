# Item 2 — examples/: Report

**Written LAST, summarizing the `item2-examples-real-only` CHANGELOG
entry, written first.**

---

## Task

"إنشاء أمثلة تعمل فعلياً فقط. يمنع إنشاء أمثلة لميزات غير موجودة."

## Delivered

- 1 new example: `examples/basics_rectangle_area.ur` (verified on
  BOTH backends: C=60, WASM=60).
- `docs/EXAMPLES.md` reorganized into 5 real categories (Basics,
  Functions, Loops, Arrays, Structs), each entry citing its verified
  result and backend support.
- Explicit documentation of every category NOT included (AI,
  Robotics, Networking, Web, Packages, file I/O), each traced to a
  specific, confirmed `KNOWN_LIMITATIONS.md` gap — not silently
  omitted.

## Policy Compliance

Zero examples or documentation created for any unsupported feature.
Every one of the 8 examples in `examples/` (7 pre-existing + 1 new
this round) is directly tested and verified correct in
`tests/examples.test.ts` (10 tests, all passing).

## Follow-Up Item (registered, not resolved this round)

Independent confirmation that `.github/workflows/ci.yml` (from Item
1) actually succeeds on a real GitHub Actions run after push — cannot
be triggered or observed from this environment. Remains open,
tracked, not silently dropped.

## Recommendation

Item 2 complete by its own stated criteria. Proceed to Item 3
(documentation unification: CHANGELOG/ROADMAP/SPEC/KNOWN_LIMITATIONS/
CONTRIBUTING/RELEASE_PROCESS) upon review approval.
