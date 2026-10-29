function fact(n: int): int
  if n <= 1
    return 1
  end
  return n * fact(n - 1)
end

function main(): int
  return fact(5)
end
