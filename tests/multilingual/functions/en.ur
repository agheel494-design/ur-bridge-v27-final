function calculate(a: int, b: int): int
  return (a + b) * 2
end

function main(): int
  let r1: int = calculate(10, 5)
  let r2: int = calculate(100, 25)
  let r3: int = calculate(7, 3)
  print(r1)
  print(r2)
  print(r3)
  return 0
end
