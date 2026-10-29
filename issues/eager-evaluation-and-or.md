# Logical AND/OR (&&, ||) use Eager Evaluation, not Short-Circuit

**Status**: DOCUMENTED — a real, current, consistent language design
choice, not a bug. Baseline: 70299b4bf6025f3fae9de3a1e2dd319d3c1c89fc.
Zero production changes accompany this document.

## Summary

`&&` and `||` in UR evaluate **both** operands unconditionally, every
time, regardless of the left operand's value. This differs from the
short-circuit behavior found in most mainstream languages (JavaScript,
C, Python, etc.), where `false && x` never evaluates `x`, and
`true || x` never evaluates `x`.

## Real evidence

- Live-tested: `if false && sideEffect()` — `sideEffect()` (which
  prints a visible side effect) was called anyway.
- Live-tested: `if true || sideEffect()` — same result, `sideEffect()`
  was called anyway.
- Root cause confirmed directly in the Lowerer's own real code
  (`ir-builder.ts`, `BinaryExpression` case): both operands are
  lowered unconditionally (`lowerExpr(expr.left)` and
  `lowerExpr(expr.right)`), before the operator itself is even
  inspected, then a single `binop` instruction is emitted. `&&`/`||`
  are not distinguished architecturally from `+`, `-`, or any other
  binary operator — there is no dedicated conditional-branch lowering
  for them anywhere in the codebase.

## Precision — what this is NOT

This is **not** a Producer/Consumer mismatch in the sense of the 3R
family of fixes (where the Lowerer produced correct metadata the
Interpreter failed to consume). Here, Lowerer, IR, and Interpreter are
all in complete agreement: eager evaluation is the real, consistent
behavior implemented identically at every layer. There is no missing
consumption, no dropped metadata, no divergence between what is
produced and what is consumed.

## Real-world impact

Any UR program written assuming short-circuit semantics — for example,
a common defensive pattern like "check a condition before calling a
function that would be unsafe otherwise" — will have that unsafe call
executed anyway, since both sides of `&&`/`||` are always evaluated.
This is a real, practical difference from most languages' behavior
that authors of UR programs should be aware of.

## What is NOT decided here

No fix is proposed or scheduled. Introducing real short-circuit
evaluation would be a language design decision (whether it's wanted at
all, and how to implement the necessary conditional-branch lowering
for `&&`/`||` specifically) — not a small patch to the existing,
consistent `BinaryExpression` lowering path.
