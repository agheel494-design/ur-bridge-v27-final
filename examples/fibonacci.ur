// UR Language — Official Example: Fibonacci (iterative)
//
// Computes the 10th Fibonacci number (0-indexed: 0, 1, 1, 2, 3, 5, 8,
// 13, 21, 34, 55, ...) using a while loop — no recursion needed.
//
// Verified: runs correctly on the C Backend. Result: 55.

function main(): int
  let a = 0
  let b = 1
  let i = 0
  while i < 10
    let temp = a + b
    a = b
    b = temp
    i = i + 1
  end
  return a
end
