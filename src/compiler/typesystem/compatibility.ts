// ─────────────────────────────────────────────────────────────────────────────
// UR-Bridge — Type System: Compatibility Rules
// ─────────────────────────────────────────────────────────────────────────────

import type { URType } from "./types.js";
import { typesEqual, isError, isUnknown, T_INT, T_FLOAT, T_BOOL, T_STRING, T_ERROR, T_UNKNOWN } from "./types.js";

// ── Assignability ─────────────────────────────────────────────────────────────

/**
 * Can a value of type `from` be used where `to` is expected?
 *
 * Rules (checked in order):
 *   1. ErrorType on either side → true (suppress cascading errors)
 *   2. UnknownType on either side → true (inference not yet resolved)
 *   3. Structural equality → true
 *   4. Int → Float (numeric widening)
 *   5. Int → Byte (per SPEC_IMPLEMENTATION_MATRIX.md's `byte` finding —
 *      integer literals default to Int; without this rule, `byte`
 *      would be unusable with any literal at all, e.g. `let x: byte
 *      = 5` or `return 1` from a `byte`-returning function. Mirrors
 *      rule 4's exact precedent: a known-safe-in-practice, unchecked-
 *      at-compile-time numeric conversion between related primitives
 *      — not a new inference capability.)
 *   6. T → Optional<T> (implicit wrapping)
 */
export function isAssignable(from: URType, to: URType): boolean {
  if (isError(from) || isError(to)) return true;
  if (isUnknown(from) || isUnknown(to)) return true;
  if (typesEqual(from, to)) return true;
  // Int widens to Float
  if (from.kind === "Primitive" && from.name === "Int" &&
      to.kind === "Primitive" && to.name === "Float") return true;
  // Int assignable to Byte (see rule 5 above)
  if (from.kind === "Primitive" && from.name === "Int" &&
      to.kind === "Primitive" && to.name === "Byte") return true;
  // T assignable to Optional<T>
  if (to.kind === "Optional") return isAssignable(from, to.inner);
  return false;
}

/** Symmetric compatibility — used for equality checks and ?? operator. */
export function isCompatible(a: URType, b: URType): boolean {
  return isAssignable(a, b) || isAssignable(b, a);
}

// ── Operator result types ─────────────────────────────────────────────────────

/**
 * Infers the result type of `left op right`.
 * Returns T_ERROR if the operator is not defined for those types.
 */
export function binaryOpResultType(op: string, left: URType, right: URType): URType {
  if (isError(left) || isError(right)) return T_ERROR;
  if (isUnknown(left) || isUnknown(right)) return T_UNKNOWN;

  const isNum = (t: URType) => t.kind === "Primitive" && (t.name === "Int" || t.name === "Float");
  const bothNum = isNum(left) && isNum(right);
  const bothInt = typesEqual(left, T_INT) && typesEqual(right, T_INT);

  switch (op) {
    case "+":
  if (bothInt) return T_INT;
  if (bothNum) return T_FLOAT;
  return T_ERROR;

    case "-": case "*": case "%":
      if (bothInt) return T_INT;
      if (bothNum) return T_FLOAT;
      return T_ERROR;

    case "/":
      if (bothInt) return T_INT;
      if (bothNum) return T_FLOAT;
      return T_ERROR;

    case "**":
      if (bothNum) return T_FLOAT;
      return T_ERROR;

    case "<": case "<=": case ">": case ">=":
      if (bothNum) return T_BOOL;
      if (typesEqual(left, T_STRING) && typesEqual(right, T_STRING)) return T_BOOL;
      return T_ERROR;

    case "==": case "!=": case "===": case "!==":
      return isCompatible(left, right) ? T_BOOL : T_ERROR;

    case "&&": case "||":
      if (typesEqual(left, T_BOOL) && typesEqual(right, T_BOOL)) return T_BOOL;
      return T_ERROR;

    case "??":
      if (left.kind === "Optional") return left.inner;
      return left;   // non-null left type passes through

    case "&": case "|": case "^": case "<<": case ">>":
      return bothInt ? T_INT : T_ERROR;

    default:
      return T_ERROR;
  }
}

/**
 * Infers the result type of `op operand`.
 * Returns T_ERROR if the operator is not defined for that type.
 */
export function unaryOpResultType(op: string, operand: URType): URType {
  if (isError(operand)) return T_ERROR;
  if (isUnknown(operand)) return T_UNKNOWN;

  const isNum = operand.kind === "Primitive" && (operand.name === "Int" || operand.name === "Float");

  switch (op) {
    case "+": case "-": return isNum ? operand : T_ERROR;
    case "!": return typesEqual(operand, T_BOOL) ? T_BOOL : T_ERROR;
    case "~": return typesEqual(operand, T_INT) ? T_INT : T_ERROR;
    default:  return T_ERROR;
  }
}





