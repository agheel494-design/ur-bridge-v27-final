function add(a: int, b: int): int
  return a + b
end

function subtract(a: int, b: int): int
  return a - b
end

function multiply(a: int, b: int): int
  return a * b
end

function divideOrZero(a: int, b: int): int
  if b == 0
    return 0
  end
  return a / b
end

function isPrime(n: int): bool
  if n < 2
    return false
  end
  let i = 2
  while i * i <= n
    if n / i * i == n
      return false
    end
    i = i + 1
  end
  return true
end

function main(): int
  let x = 17
  let y = 5

  print(x + y)
  print(subtract(x, y))
  print(multiply(x, y))
  print(divideOrZero(x, y))
  print(divideOrZero(x, 0))
  print(isPrime(x))
  print(isPrime(20))

  return 0
end
