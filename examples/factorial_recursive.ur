// UR Language — Official Example: Factorial (recursive)
//
// Demonstrates recursive function calls with explicit-typed
// parameters (required on v1.0 — see docs/STDLIB_MATH.md's own note
// on why explicit types are needed).
//
// Verified: runs correctly on the C Backend. Result: 120 (5!).

function factorial(n: int): int
  if n <= 1
    return 1
  end
  return n * factorial(n - 1)
end

function main(): int
  return factorial(5)
end
