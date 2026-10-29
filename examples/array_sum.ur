// UR Language — Official Example: Array Sum
//
// Sums every element of a fixed-size array using a while loop and
// dynamic indexing.
//
// Verified: runs correctly on the C Backend. Result: 108.

function main(): int
  let numbers = [4, 8, 15, 16, 23, 42]
  let sum = 0
  let i = 0
  while i < 6
    sum = sum + numbers[i]
    i = i + 1
  end
  return sum
end
