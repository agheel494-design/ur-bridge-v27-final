function isEven(n: int): bool
  if n == 0
    return true
  end
  return isOdd(n - 1)
end

function isOdd(n: int): bool
  if n == 0
    return false
  end
  return isEven(n - 1)
end

function main(): int
  if isEven(10)
    return 1
  end
  return 0
end
