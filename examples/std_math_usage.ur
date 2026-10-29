// UR Language — Official Example: Using std.math
//
// Demonstrates importing/using the Standard Library's std.math
// module (abs, clamp) — see stdlib/std_math.ur and
// docs/STDLIB_MATH.md. Since UR v1.0 has no `import` mechanism wired
// to the Standard Library yet, this example inlines the two
// functions it uses directly, matching stdlib/std_math.ur's own
// source exactly (copy-paste, not reimplementation) — this is the
// current, correct way to use the Standard Library until a real
// import mechanism exists (tracked as future work, not v1.0 scope).
//
// Verified: runs correctly on the C Backend. Result: 100.

function abs(x: int): int
  if x < 0
    return 0 - x
  end
  return x
end

function clamp(x: int, lo: int, hi: int): int
  if x < lo
    return lo
  end
  if x > hi
    return hi
  end
  return x
end

function main(): int
  let score = clamp(abs(0 - 150), 0, 100)
  return score
end
