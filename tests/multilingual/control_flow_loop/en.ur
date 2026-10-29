function main(): int
  let sum: int = 0
  let i: int = 1
  while i <= 100
    sum = sum + i
    i = i + 1
  end
  print(sum)
  return 0
end
